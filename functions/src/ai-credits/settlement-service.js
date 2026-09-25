'use strict';

/**
 * AI Credit Settlement Service
 * Manages atomic reservation, capture, and release/refund of credits.
 */

class SettlementService {
  constructor({ db, walletService }) {
    this.db = db;
    this.walletService = walletService;
  }

  getReservationRef(assessmentId) {
    return this.db.collection('aiCreditReservations').doc(assessmentId);
  }

  getLedgerRef(eventId) {
    return this.db.collection('aiCreditLedger').doc(eventId);
  }

  /**
   * Reserves credits for a confirmed assessment job inside a transaction.
   */
  async reserveCreditsInTx(tx, { uid, assessmentId, quote, accountType = 'eligible_learner', now = new Date() }) {
    if (!uid || !assessmentId || !quote) {
      throw new TypeError('MISSING_RESERVATION_PARAMS');
    }

    const reservationRef = this.getReservationRef(assessmentId);
    const existingRes = await tx.get(reservationRef);
    if (existingRes.exists) {
      // Idempotency: already reserved or completed
      return { status: existingRes.data().status, alreadyExists: true };
    }

    const wallet = await this.walletService.getOrCreateLifetimeWalletInTx(tx, uid, accountType, now);
    const requiredCredits = Number(quote.credits);

    if (wallet.availableCredits < requiredCredits) {
      const err = new Error('INSUFFICIENT_CREDITS');
      err.code = 'INSUFFICIENT_CREDITS';
      err.requiredCredits = requiredCredits;
      err.availableCredits = wallet.availableCredits;
      err.isLifetime = true;
      err.purchasable = true;
      throw err;
    }

    const walletRef = this.walletService.getWalletRef(uid);
    tx.update(walletRef, {
      reservedCredits: wallet.reservedCredits + requiredCredits,
      updatedAt: now.toISOString()
    });

    const reservation = {
      assessmentId,
      uid,
      periodId: 'lifetime',
      quoteId: quote.quoteId,
      credits: requiredCredits,
      packageId: quote.packageId,
      status: 'reserved',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
    tx.set(reservationRef, reservation);

    const ledgerEventRef = this.getLedgerRef(`${assessmentId}:reserve`);
    tx.set(ledgerEventRef, {
      eventId: `${assessmentId}:reserve`,
      assessmentId,
      uid,
      periodId: 'lifetime',
      type: 'reserve',
      credits: requiredCredits,
      createdAt: now.toISOString()
    });

    return {
      status: 'reserved',
      reservedCredits: requiredCredits,
      remainingAvailable: wallet.availableCredits - requiredCredits,
      periodId: 'lifetime'
    };
  }

  /**
   * Captures reserved credits upon successful delivery of assessment.
   */
  async captureCreditsInTx(tx, { assessmentId, now = new Date() }) {
    const reservationRef = this.getReservationRef(assessmentId);
    const resDoc = await tx.get(reservationRef);
    if (!resDoc.exists) {
      throw new Error('RESERVATION_NOT_FOUND');
    }
    const resData = resDoc.data();
    if (resData.status === 'captured') {
      return { status: 'captured', alreadySettled: true };
    }
    if (resData.status !== 'reserved') {
      throw new Error(`INVALID_RESERVATION_STATE: ${resData.status}`);
    }

    const { uid, credits } = resData;
    const walletRef = this.walletService.getWalletRef(uid);
    const walletDoc = await tx.get(walletRef);

    if (!walletDoc.exists) throw new Error('WALLET_NOT_FOUND_FOR_RESERVATION');
    const w = walletDoc.data();
    if (!Number.isSafeInteger(credits) || credits <= 0 || !Number.isSafeInteger(w.reservedCredits) ||
        w.reservedCredits < credits || !Number.isSafeInteger(w.spentCredits)) {
      throw new Error('WALLET_RESERVATION_INCONSISTENT');
    }
    tx.update(walletRef, {
      reservedCredits: w.reservedCredits - credits,
      spentCredits: w.spentCredits + credits,
      updatedAt: now.toISOString()
    });

    tx.update(reservationRef, {
      status: 'captured',
      capturedAt: now.toISOString(),
      updatedAt: now.toISOString()
    });

    const ledgerEventRef = this.getLedgerRef(`${assessmentId}:capture`);
    tx.set(ledgerEventRef, {
      eventId: `${assessmentId}:capture`,
      assessmentId,
      uid,
      periodId: 'lifetime',
      type: 'capture',
      credits,
      createdAt: now.toISOString()
    });

    return { status: 'captured', credits };
  }

  /**
   * Releases reserved credits back to the wallet upon job failure or unrateable result.
   */
  async releaseCreditsInTx(tx, { assessmentId, reason = 'TECHNICAL_FAILURE', now = new Date() }) {
    const reservationRef = this.getReservationRef(assessmentId);
    const resDoc = await tx.get(reservationRef);
    if (!resDoc.exists) {
      throw new Error('RESERVATION_NOT_FOUND');
    }
    const resData = resDoc.data();
    if (resData.status === 'released') {
      return { status: 'released', alreadySettled: true };
    }
    if (resData.status !== 'reserved') {
      throw new Error(`INVALID_RESERVATION_STATE: ${resData.status}`);
    }

    const { uid, credits } = resData;
    const walletRef = this.walletService.getWalletRef(uid);
    const walletDoc = await tx.get(walletRef);

    if (!walletDoc.exists) throw new Error('WALLET_NOT_FOUND_FOR_RESERVATION');
    const w = walletDoc.data();
    if (!Number.isSafeInteger(credits) || credits <= 0 || !Number.isSafeInteger(w.reservedCredits) || w.reservedCredits < credits) {
      throw new Error('WALLET_RESERVATION_INCONSISTENT');
    }
    tx.update(walletRef, {
      reservedCredits: w.reservedCredits - credits,
      updatedAt: now.toISOString()
    });

    tx.update(reservationRef, {
      status: 'released',
      releaseReason: reason,
      releasedAt: now.toISOString(),
      updatedAt: now.toISOString()
    });

    const ledgerEventRef = this.getLedgerRef(`${assessmentId}:release`);
    tx.set(ledgerEventRef, {
      eventId: `${assessmentId}:release`,
      assessmentId,
      uid,
      periodId: 'lifetime',
      type: 'release',
      credits,
      reason,
      createdAt: now.toISOString()
    });

    return { status: 'released', credits, reason };
  }

  /**
   * Releases reserved credits outside transaction context.
   * Supports both (uid, assessmentId, reason) and ({ assessmentId, reason }) signatures.
   */
  async releaseCredits(arg1, arg2, arg3) {
    let assessmentId;
    let reason = 'MANUAL_RELEASE';
    if (typeof arg1 === 'object' && arg1 !== null) {
      assessmentId = arg1.assessmentId;
      reason = arg1.reason || reason;
    } else if (typeof arg2 === 'string' && (typeof arg3 === 'string' || arg3 === undefined)) {
      // releaseCredits(uid, assessmentId, reason)
      assessmentId = arg2;
      reason = arg3 || reason;
    } else {
      // releaseCredits(assessmentId, reason)
      assessmentId = arg1;
      reason = arg2 || reason;
    }

    return this.db.runTransaction(async tx => {
      return this.releaseCreditsInTx(tx, { assessmentId, reason });
    });
  }

  /**
   * Captures reserved credits outside transaction context.
   */
  async captureCredits(arg1, arg2) {
    const assessmentId = (typeof arg1 === 'object' && arg1 !== null) ? arg1.assessmentId : (arg2 || arg1);
    return this.db.runTransaction(async tx => {
      return this.captureCreditsInTx(tx, { assessmentId });
    });
  }
}

module.exports = {
  SettlementService
};
