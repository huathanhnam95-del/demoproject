'use strict';

/**
 * AI Credit Wallet Service
 * Manages lifetime per-account credit balances, initial grants, top-ups/purchases, and balance inquiries.
 */

const DEFAULT_INITIAL_GRANT = 5000;
const DEFAULT_MONTHLY_GRANT = DEFAULT_INITIAL_GRANT; // Deprecated alias

function getCurrentPeriodInfo(date = new Date()) {
  return {
    periodId: 'lifetime',
    isLifetime: true,
    periodStart: null,
    renewsAt: null
  };
}

class WalletService {
  constructor({ db, defaultInitialGrant = DEFAULT_INITIAL_GRANT, defaultMonthlyGrant = DEFAULT_INITIAL_GRANT }) {
    this.db = db;
    this.defaultInitialGrant = defaultInitialGrant || defaultMonthlyGrant;
    this.defaultMonthlyGrant = this.defaultInitialGrant;
  }

  getWalletRef(uid) {
    return this.db.collection('aiCreditAccounts').doc(uid);
  }

  getLedgerRef(eventId) {
    return this.db.collection('aiCreditLedger').doc(eventId);
  }

  /**
   * Retrieves or initializes the lifetime account wallet for a user inside a transaction.
   */
  async getOrCreateLifetimeWalletInTx(tx, uid, accountType = 'eligible_learner', now = new Date()) {
    const walletRef = this.getWalletRef(uid);
    const doc = await tx.get(walletRef);

    if (doc.exists) {
      const data = doc.data();
      const initialGrant = Number(data.initialGrantCredits ?? data.grantCredits ?? 0);
      const purchased = Number(data.purchasedCredits || 0);
      const grant = initialGrant + purchased;
      const spent = Number(data.spentCredits || 0);
      const reserved = Number(data.reservedCredits || 0);
      const adjustments = Number(data.adjustments || 0);
      const available = Math.max(0, grant + adjustments - spent - reserved);

      return {
        uid,
        periodId: 'lifetime',
        initialGrantCredits: initialGrant,
        purchasedCredits: purchased,
        grantCredits: grant,
        spentCredits: spent,
        reservedCredits: reserved,
        adjustments,
        availableCredits: available,
        isLifetime: true,
        renewsAt: null,
        isNew: false
      };
    }

    // Determine initial grant based on account eligibility
    let initialGrant = 0;
    if (accountType === 'eligible_learner') {
      initialGrant = this.defaultInitialGrant;
    } else if (accountType === 'trial') {
      // 1 trial RA assessment allowance (up to 40s RA = 10 credits)
      initialGrant = 10;
    }

    const newWallet = {
      uid,
      accountType,
      initialGrantCredits: initialGrant,
      purchasedCredits: 0,
      grantCredits: initialGrant,
      spentCredits: 0,
      reservedCredits: 0,
      adjustments: 0,
      isLifetime: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    tx.set(walletRef, newWallet);

    // Record initial grant event in ledger if positive
    if (initialGrant > 0) {
      const grantEventRef = this.getLedgerRef(`${uid}:initial_grant`);
      tx.set(grantEventRef, {
        eventId: `${uid}:initial_grant`,
        uid,
        periodId: 'lifetime',
        type: 'grant',
        subtype: 'initial_grant',
        credits: initialGrant,
        createdAt: now.toISOString()
      });
    }

    return {
      uid,
      periodId: 'lifetime',
      initialGrantCredits: initialGrant,
      purchasedCredits: 0,
      grantCredits: initialGrant,
      spentCredits: 0,
      reservedCredits: 0,
      adjustments: 0,
      availableCredits: initialGrant,
      isLifetime: true,
      renewsAt: null,
      isNew: true
    };
  }

  /**
   * Backward-compatibility wrapper for getOrCreateLifetimeWalletInTx.
   */
  async getOrCreatePeriodWalletInTx(tx, uid, accountType = 'eligible_learner', now = new Date()) {
    return this.getOrCreateLifetimeWalletInTx(tx, uid, accountType, now);
  }

  /**
   * Adds purchased credits (top-up) to an account's lifetime wallet.
   */
  async addPurchasedCreditsInTx(tx, { uid, amount, purchaseId, metadata = {}, now = new Date() }) {
    const creditsToAdd = Number(amount);
    if (!Number.isFinite(creditsToAdd) || creditsToAdd <= 0) {
      throw new TypeError('PURCHASE_AMOUNT_MUST_BE_POSITIVE');
    }
    if (!purchaseId) {
      throw new TypeError('PURCHASE_ID_REQUIRED');
    }

    const wallet = await this.getOrCreateLifetimeWalletInTx(tx, uid, 'eligible_learner', now);
    const walletRef = this.getWalletRef(uid);

    const newPurchased = wallet.purchasedCredits + creditsToAdd;
    const newGrant = wallet.initialGrantCredits + newPurchased;

    tx.update(walletRef, {
      purchasedCredits: newPurchased,
      grantCredits: newGrant,
      updatedAt: now.toISOString()
    });

    const ledgerEventRef = this.getLedgerRef(`${uid}:purchase:${purchaseId}`);
    tx.set(ledgerEventRef, {
      eventId: `${uid}:purchase:${purchaseId}`,
      uid,
      periodId: 'lifetime',
      purchaseId,
      type: 'purchase',
      credits: creditsToAdd,
      metadata,
      createdAt: now.toISOString()
    });

    return {
      uid,
      periodId: 'lifetime',
      initialGrantCredits: wallet.initialGrantCredits,
      purchasedCredits: newPurchased,
      grantCredits: newGrant,
      spentCredits: wallet.spentCredits,
      reservedCredits: wallet.reservedCredits,
      availableCredits: wallet.availableCredits + creditsToAdd,
      isLifetime: true
    };
  }

  /**
   * Direct read-only balance inquiry.
   */
  async getWallet(uid, accountType = 'eligible_learner') {
    return this.db.runTransaction(async tx => {
      return this.getOrCreateLifetimeWalletInTx(tx, uid, accountType);
    });
  }
}

module.exports = {
  getCurrentPeriodInfo,
  WalletService,
  DEFAULT_INITIAL_GRANT,
  DEFAULT_MONTHLY_GRANT
};
