'use strict';

const { WalletService } = require('../ai-credits/wallet-service');
const { SettlementService } = require('../ai-credits/settlement-service');

const TERMINAL = new Set(['ready', 'failed', 'unrateable', 'canceled', 'reference_unresolved']);

async function reconcileOutbox({ db, dispatch, now = new Date(), limit = 100 }) {
  const walletService = new WalletService({ db });
  const settlement = new SettlementService({ db, walletService });
  const snapshot = await db.collection('aiScoringOutbox').limit(limit).get();
  const summary = { examined: 0, dispatched: 0, expired: 0, failed: 0, skipped: 0 };
  for (const outboxDoc of snapshot.docs) {
    summary.examined++;
    const assessmentId = outboxDoc.id;
    try {
      const state = await db.runTransaction(async tx => {
        const jobRef = db.collection('aiScoringJobs').doc(assessmentId);
        const jobSnap = await tx.get(jobRef);
        const outboxSnap = await tx.get(outboxDoc.ref);
        if (!jobSnap.exists || !outboxSnap.exists) return 'missing';
        const job = jobSnap.data();
        const outbox = outboxSnap.data();
        if (TERMINAL.has(job.status)) {
          tx.delete(outboxDoc.ref);
          return 'terminal';
        }
        const deadline = Date.parse(job.deadlineAt);
        const leaseExpires = Date.parse(job.leaseExpiresAt);
        const activeLease = job.status === 'processing' && Number.isFinite(leaseExpires) && leaseExpires > now.getTime();
        const exhausted = job.engineVersion === 'bel.speech.v3' && Number(job.executionAttempts || 0) >= 3;
        if ((Number.isFinite(deadline) && deadline <= now.getTime()) || (exhausted && !activeLease)) {
          const archiveRef = job.engineVersion === 'bel.speech.v3' ? db.collection('speakingAttempts').doc(job.attemptId) : null;
          const archive = archiveRef ? await tx.get(archiveRef) : null;
          await settlement.releaseCreditsInTx(tx, { assessmentId, reason: exhausted ? 'EXECUTION_ATTEMPTS_EXHAUSTED' : 'JOB_DEADLINE_EXPIRED', now });
          tx.update(jobRef, { status: 'failed', stage: 'failed',
            error: exhausted ? 'EXECUTION_ATTEMPTS_EXHAUSTED' : 'JOB_DEADLINE_EXPIRED',
            leaseOwner: null, leaseExpiresAt: null, leaseVersion: Number(job.leaseVersion || 0) + 1,
            updatedAt: now.toISOString() });
          if (archive?.exists && archive.data().v3AssessmentId === assessmentId) {
            tx.update(archiveRef, { v3AssessmentState: 'failed', updatedAt: now.toISOString() });
          }
          tx.delete(outboxDoc.ref);
          return 'expired';
        }
        if (activeLease) return 'active';
        const retryAfter = Date.parse(outbox.retryAfterAt);
        if (Number.isFinite(retryAfter) && retryAfter > now.getTime()) return 'backoff';
        const lastDispatch = Date.parse(outbox.dispatchedAt);
        if (job.status === 'queued' && Number.isFinite(lastDispatch) && lastDispatch > now.getTime() - 60000) return 'recent';
        if (job.status === 'processing') {
          tx.update(jobRef, { status: 'queued', stage: 'retry_pending', leaseOwner: null,
            leaseExpiresAt: null, leaseVersion: Number(job.leaseVersion || 0) + 1,
            updatedAt: now.toISOString() });
        }
        tx.set(outboxDoc.ref, { dispatchStatus: 'dispatching', updatedAt: now.toISOString() }, { merge: true });
        return 'dispatch';
      });
      if (state === 'expired') { summary.expired++; continue; }
      if (state !== 'dispatch') { summary.skipped++; continue; }
      try {
        await dispatch(assessmentId);
        await db.runTransaction(async tx => {
          const current = await tx.get(outboxDoc.ref);
          if (current.exists) tx.update(outboxDoc.ref, { dispatchStatus: 'enqueued',
            dispatchedAt: now.toISOString(), updatedAt: now.toISOString() });
        });
        summary.dispatched++;
      } catch (error) {
        await db.runTransaction(async tx => {
          const current = await tx.get(outboxDoc.ref);
          if (current.exists) tx.update(outboxDoc.ref, { dispatchStatus: 'failed',
            lastDispatchError: String(error.message || error), updatedAt: now.toISOString() });
        });
        summary.failed++;
      }
    } catch (error) {
      console.error(`[AiScoringOutbox] ${assessmentId}:`, error);
      summary.failed++;
    }
  }
  return summary;
}

module.exports = { reconcileOutbox };
