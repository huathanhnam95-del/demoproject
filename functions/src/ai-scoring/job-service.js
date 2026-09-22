'use strict';

const crypto = require('crypto');
const { quoteSpeaking, quoteWriting } = require('../ai-credits/quote-math');
const { resolvePackageForMode, getPackageConfig } = require('../ai-credits/rate-card');

const QUOTE_TTL_MS = 5 * 60 * 1000; // 5 minutes

class JobService {
  constructor({ db, walletService, settlementService, taskDispatcher = null }) {
    this.db = db;
    this.walletService = walletService;
    this.settlementService = settlementService;
    this.taskDispatcher = taskDispatcher;
  }

  getQuoteRef(quoteId) {
    return this.db.collection('aiCreditQuotes').doc(quoteId);
  }

  getJobRef(assessmentId) {
    return this.db.collection('aiScoringJobs').doc(assessmentId);
  }

  getOutboxRef(assessmentId) {
    return this.db.collection('aiScoringOutbox').doc(assessmentId);
  }

  getOperationRef(operationKey) {
    return this.db.collection('aiScoringOperations').doc(operationKey);
  }

  /**
   * Computes a deterministic server operationKey to prevent duplicate charges.
   */
  computeOperationKey({ uid, mode, questionId, inputHash, packageId }) {
    const raw = `${uid}:${mode}:${questionId || 'no_q'}:${packageId}:${inputHash}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Generates a binding quote. NO billable AI calls executed here.
   */
  async createQuote({ uid, mode, inputMeta, questionId = null, preferredPackageId = null, accountType = 'eligible_learner' }) {
    if (!uid || !mode || !inputMeta) {
      throw new TypeError('MISSING_QUOTE_PARAMS');
    }

    const pkg = resolvePackageForMode(mode, preferredPackageId);
    if (!pkg) {
      const err = new Error(`UNSUPPORTED_MODE_OR_PACKAGE: ${mode}`);
      err.code = 'UNSUPPORTED_MODE';
      throw err;
    }

    let quoteResult;
    if (pkg.kind === 'speaking') {
      const sampleCount = Number(inputMeta.sampleCount);
      const sampleRateHz = Number(inputMeta.sampleRateHz);
      if (!Number.isSafeInteger(sampleCount) || sampleCount <= 0 || !Number.isSafeInteger(sampleRateHz) || sampleRateHz <= 0) {
        throw new TypeError('AUDIO_SAMPLE_METADATA_REQUIRED');
      }
      quoteResult = quoteSpeaking({
        sampleCount,
        sampleRateHz,
        creditsPerMinute: pkg.creditsPerMinute,
        fixedComponentCredits: pkg.fixedComponentCredits || 0
      });
    } else {
      quoteResult = quoteWriting({ fixedCredits: pkg.fixedCredits });
    }

    const wallet = await this.walletService.getWallet(uid, accountType);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + QUOTE_TTL_MS);
    const quoteId = `quote-${crypto.randomBytes(12).toString('hex')}`;

    const quoteDoc = {
      quoteId,
      uid,
      mode,
      packageId: pkg.packageId,
      packageVersion: pkg.packageVersion,
      rateCardVersion: pkg.rateCardVersion,
      questionId,
      inputHash: inputMeta.inputHash || null,
      inputMeta: {
        audioUrl: inputMeta.audioUrl || null,
        storagePath: inputMeta.storagePath || null,
        audioBuffer: inputMeta.audioBuffer || null,
        inputHash: inputMeta.inputHash || null,
        sampleCount: inputMeta.sampleCount || null,
        sampleRateHz: inputMeta.sampleRateHz || null,
        referenceText: inputMeta.referenceText || null,
        textResponse: inputMeta.textResponse || inputMeta.text || null,
        text: inputMeta.text || inputMeta.textResponse || null
      },
      inputSummary: {
        kind: pkg.kind,
        quotedSeconds: quoteResult.quotedSeconds || null,
        credits: quoteResult.credits
      },
      credits: quoteResult.credits,
      includedComponents: pkg.includedComponents,
      availableCredits: wallet.availableCredits,
      availableAfterConfirmation: Math.max(0, wallet.availableCredits - quoteResult.credits),
      periodId: 'lifetime',
      isLifetime: true,
      state: 'offered',
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    };

    await this.getQuoteRef(quoteId).set(quoteDoc);

    return quoteDoc;
  }

  /**
   * Confirms a quote, atomically reserves credits, and enqueues a scoring job.
   */
  async confirmQuote({ uid, quoteId, accountType = 'eligible_learner' }) {
    const quoteRef = this.getQuoteRef(quoteId);

    const result = await this.db.runTransaction(async tx => {
      const qDoc = await tx.get(quoteRef);
      if (!qDoc.exists) {
        const err = new Error('QUOTE_NOT_FOUND');
        err.code = 'QUOTE_NOT_FOUND';
        throw err;
      }
      const quote = qDoc.data();
      if (quote.uid !== uid) {
        const err = new Error('UNAUTHORIZED_QUOTE');
        err.code = 'UNAUTHORIZED';
        throw err;
      }
      if (quote.state === 'consumed' && quote.assessmentId) {
        // Idempotency: return existing confirmed job
        return { assessmentId: quote.assessmentId, alreadyConfirmed: true };
      }
      if (quote.state !== 'offered') {
        const err = new Error(`INVALID_QUOTE_STATE: ${quote.state}`);
        err.code = 'INVALID_QUOTE_STATE';
        throw err;
      }
      if (new Date(quote.expiresAt).getTime() < Date.now()) {
        const err = new Error('QUOTE_EXPIRED');
        err.code = 'QUOTE_EXPIRED';
        throw err;
      }

      // Compute operation key to deduplicate identical concurrent operations
      const operationKey = this.computeOperationKey({
        uid,
        mode: quote.mode,
        questionId: quote.questionId,
        inputHash: quote.inputHash,
        packageId: quote.packageId
      });
      const opRef = this.getOperationRef(operationKey);
      const existingOp = await tx.get(opRef);
      if (existingOp.exists) {
        const existingJobId = existingOp.data().assessmentId;
        const existingJobDoc = await tx.get(this.getJobRef(existingJobId));
        if (existingJobDoc.exists) {
          const existingJob = existingJobDoc.data();
          // Idempotent deduplication: return already confirmed if active or successfully completed
          if (existingJob.status === 'queued' || existingJob.status === 'processing' || existingJob.status === 'ready') {
            tx.update(quoteRef, {
              state: 'consumed',
              assessmentId: existingJobId,
              updatedAt: new Date().toISOString()
            });
            return { assessmentId: existingJobId, alreadyConfirmed: true };
          }
          // If existing job reached terminal failure/refund, §13.9 authorizes a new generation to replace it
        }
      }

      const assessmentId = `asmt-${crypto.randomBytes(12).toString('hex')}`;

      // Reserve credits
      await this.settlementService.reserveCreditsInTx(tx, {
        uid,
        assessmentId,
        quote,
        accountType
      });

      // Create durable job record with audio/input locators
      const job = {
        assessmentId,
        quoteId,
        uid,
        mode: quote.mode,
        packageId: quote.packageId,
        packageVersion: quote.packageVersion,
        credits: quote.credits,
        questionId: quote.questionId || null,
        inputMeta: quote.inputMeta || null,
        referenceText: quote.inputMeta?.referenceText || null,
        status: 'queued',
        stage: 'queued',
        operationKey,
        leaseOwner: null,
        leaseVersion: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      tx.set(this.getJobRef(assessmentId), job);
      tx.set(opRef, {
        operationKey,
        assessmentId,
        generation: (existingOp.exists ? (existingOp.data().generation || 1) + 1 : 1),
        updatedAt: new Date().toISOString()
      });

      // Outbox pattern
      tx.set(this.getOutboxRef(assessmentId), {
        assessmentId,
        status: 'pending',
        createdAt: new Date().toISOString()
      });

      // Mark quote consumed
      tx.update(quoteRef, {
        state: 'consumed',
        assessmentId,
        updatedAt: new Date().toISOString()
      });

      return { assessmentId, alreadyConfirmed: false };
    });

    // Post-commit outbox dispatch
    if (this.taskDispatcher && !result.alreadyConfirmed) {
      try {
        await this.taskDispatcher.dispatch(result.assessmentId);
      } catch (dispatchErr) {
        console.warn(`[Outbox] Dispatch warning for ${result.assessmentId}:`, dispatchErr.message);
      }
    }

    return result;
  }

  /**
   * Retrieves live job status and result.
   */
  async getJobStatus(assessmentId, uid) {
    const jobDoc = await this.getJobRef(assessmentId).get();
    if (!jobDoc.exists) return null;
    const job = jobDoc.data();
    if (job.uid !== uid) {
      const err = new Error('UNAUTHORIZED');
      err.code = 'UNAUTHORIZED';
      throw err;
    }
    return job;
  }
}

module.exports = {
  JobService,
  QUOTE_TTL_MS
};
