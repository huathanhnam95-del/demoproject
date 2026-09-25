'use strict';

const crypto = require('crypto');
const { quoteSpeaking, quoteWriting } = require('../ai-credits/quote-math');
const { resolvePackageForMode, getPackageConfig } = require('../ai-credits/rate-card');
const { normalizePracticeMode } = require('../practice-attempts/attempt-constraints');
const { resolveFixedReference } = require('../services/azure-speech/reference-registry');

const QUOTE_TTL_MS = 5 * 60 * 1000; // 5 minutes

class JobService {
  constructor({ db, walletService, settlementService, taskDispatcher = null, audioAssetService = null }) {
    this.db = db;
    this.walletService = walletService;
    this.settlementService = settlementService;
    this.taskDispatcher = taskDispatcher;
    this.audioAssetService = audioAssetService;
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
  computeOperationKey({ uid, mode, questionId, inputHash, packageId, attemptId }) {
    const raw = `${uid}:${mode}:${questionId || 'no_q'}:${packageId}:${inputHash}:${attemptId || 'no_attempt'}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Generates a binding quote. NO billable AI calls executed here.
   */
  async createQuote({ uid, mode, inputMeta, questionId = null, preferredPackageId = null, accountType = 'eligible_learner', speechV3 = false }) {
    if (!uid || !mode || !inputMeta) {
      throw new TypeError('MISSING_QUOTE_PARAMS');
    }

    mode = normalizePracticeMode(mode);
    const pkg = resolvePackageForMode(mode, preferredPackageId);
    if (!pkg) {
      const err = new Error(`UNSUPPORTED_MODE_OR_PACKAGE: ${mode}`);
      err.code = 'UNSUPPORTED_MODE';
      throw err;
    }

    let asset = null;
    let reference = null;
    if (speechV3) {
      if (!this.audioAssetService || !inputMeta.audioId || Object.keys(inputMeta).some(key => key !== 'audioId' && key !== 'referenceText')) {
        const err = new Error('V3_AUDIO_ID_REQUIRED');
        err.code = 'V3_AUDIO_ID_REQUIRED';
        throw err;
      }
      asset = await this.audioAssetService.getOwned(inputMeta.audioId, uid, mode);
      if (asset.status !== 'staged') {
        const err = new Error('AUDIO_ALREADY_CONFIRMED');
        err.code = 'AUDIO_ALREADY_CONFIRMED';
        err.status = 409;
        throw err;
      }
      const attempt = await this.db.collection('speakingAttempts').doc(asset.attemptId).get();
      if (!attempt.exists || attempt.data().ownerUid !== uid || attempt.data().v3AudioId !== asset.audioId) {
        const err = new Error('AUDIO_REVISION_REPLACED');
        err.code = 'AUDIO_REVISION_REPLACED';
        err.status = 409;
        throw err;
      }
      if (['read_aloud', 'repeat_sentence'].includes(mode)) {
        reference = resolveFixedReference(mode, questionId, inputMeta.referenceText);
      } else if (inputMeta.referenceText != null) {
        const err = new Error('CLIENT_REFERENCE_NOT_ALLOWED');
        err.code = 'CLIENT_REFERENCE_NOT_ALLOWED';
        throw err;
      }
    }

    let quoteResult;
    if (pkg.kind === 'speaking') {
      const sampleCount = Number(asset ? asset.manifest.sampleCount : inputMeta.sampleCount);
      const sampleRateHz = Number(asset ? asset.manifest.sampleRateHz : inputMeta.sampleRateHz);
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
      engineVersion: speechV3 ? 'bel.speech.v3' : null,
      audioId: asset?.audioId || null,
      audioStoragePath: asset?.storagePath || null,
      attemptId: asset?.attemptId || null,
      audioManifest: asset?.manifest || null,
      reference,
      inputHash: asset?.manifest.canonicalFileHash || inputMeta.inputHash || null,
      inputMeta: speechV3 ? {
        audioId: asset.audioId,
        attemptId: asset.attemptId,
        inputHash: asset.manifest.canonicalFileHash,
        sampleCount: asset.manifest.sampleCount,
        sampleRateHz: 16000,
        referenceText: reference?.text || null
      } : {
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
      if (quote.engineVersion === 'bel.speech.v3') {
        const attempt = await tx.get(this.db.collection('speakingAttempts').doc(quote.attemptId));
        if (!attempt.exists || attempt.data().ownerUid !== uid || attempt.data().v3AudioId !== quote.audioId) {
          const err = new Error('AUDIO_REVISION_REPLACED');
          err.code = 'AUDIO_REVISION_REPLACED';
          throw err;
        }
        const assetRef = this.db.collection('aiScoringAudio').doc(quote.audioId);
        const asset = await tx.get(assetRef);
        if (!asset.exists || asset.data().uid !== uid ||
            asset.data().status !== 'staged' ||
            asset.data().manifest?.canonicalFileHash !== quote.audioManifest?.canonicalFileHash ||
            Date.parse(asset.data().expiresAt) <= Date.now()) {
          const err = new Error('AUDIO_ASSET_EXPIRED_OR_CHANGED');
          err.code = 'AUDIO_ASSET_EXPIRED_OR_CHANGED';
          throw err;
        }
      }

      // Compute operation key to deduplicate identical concurrent operations
      const operationKey = this.computeOperationKey({
        uid,
        mode: quote.mode,
        questionId: quote.questionId,
        inputHash: quote.inputHash,
        packageId: quote.packageId,
        attemptId: quote.attemptId
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
        engineVersion: quote.engineVersion || null,
        audioId: quote.audioId || null,
        audioStoragePath: quote.audioStoragePath || null,
        attemptId: quote.attemptId || null,
        audioManifest: quote.audioManifest || null,
        reference: quote.reference || null,
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
        updatedAt: new Date().toISOString(),
        deadlineAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        executionAttempts: 0
      };
      tx.set(this.getJobRef(assessmentId), job);
      if (quote.engineVersion === 'bel.speech.v3') {
        tx.update(this.db.collection('speakingAttempts').doc(quote.attemptId), {
          v3AssessmentId: assessmentId,
          v3AudioId: quote.audioId,
          v3AssessmentState: 'queued',
          updatedAt: new Date().toISOString()
        });
        tx.update(this.db.collection('aiScoringAudio').doc(quote.audioId), {
          status: 'active', assessmentId, expiresAt: null, updatedAt: new Date().toISOString()
        });
      }
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
        attempts: 0,
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
        await this.db.runTransaction(async tx => {
          const ref = this.getOutboxRef(result.assessmentId);
          const doc = await tx.get(ref);
          if (doc.exists) tx.update(ref, { dispatchStatus: 'enqueued', dispatchedAt: new Date().toISOString() });
        });
      } catch (error) {
        await this.db.runTransaction(async tx => {
          const ref = this.getOutboxRef(result.assessmentId);
          const doc = await tx.get(ref);
          if (doc.exists) tx.update(ref, { dispatchStatus: 'failed',
            lastDispatchError: String(error.message || error), updatedAt: new Date().toISOString() });
        });
        result.dispatchPending = true;
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
    if (job.status === 'ready' && job.resultRef) {
      if (!this.audioAssetService) throw new Error('RESULT_STORAGE_UNAVAILABLE');
      const bucket = await this.audioAssetService.getBucket();
      const file = bucket.file(job.resultRef.path);
      const [[bytes], [metadata]] = await Promise.all([file.download(), file.getMetadata()]);
      const hash = crypto.createHash('sha256').update(bytes).digest('hex');
      if (String(metadata.generation) !== job.resultRef.generation || hash !== job.resultRef.sha256) {
        throw new Error('RESULT_IDENTITY_MISMATCH');
      }
      job.result = JSON.parse(bytes.toString('utf8'));
    }
    return job;
  }

  async cancelAssessment(assessmentId, uid) {
    const result = await this.db.runTransaction(async tx => {
      const jobRef = this.getJobRef(assessmentId);
      const doc = await tx.get(jobRef);
      if (!doc.exists) return { status: 'not_found' };
      const job = doc.data();
      if (job.uid !== uid) {
        const error = new Error('UNAUTHORIZED'); error.code = 'UNAUTHORIZED'; throw error;
      }
      if (job.status === 'ready') return { status: 'ready', captured: true };
      if (['failed', 'unrateable', 'canceled', 'reference_unresolved'].includes(job.status)) {
        return { status: job.status, captured: false };
      }
      const archiveRef = job.engineVersion === 'bel.speech.v3' ? this.db.collection('speakingAttempts').doc(job.attemptId) : null;
      const archive = archiveRef ? await tx.get(archiveRef) : null;
      await this.settlementService.releaseCreditsInTx(tx, {
        assessmentId, reason: 'USER_CANCELED'
      });
      tx.update(jobRef, { status: 'canceled', stage: 'canceled', leaseOwner: null,
        leaseExpiresAt: null, leaseVersion: Number(job.leaseVersion || 0) + 1,
        updatedAt: new Date().toISOString() });
      tx.delete(this.getOutboxRef(assessmentId));
      if (archive?.exists && archive.data().v3AssessmentId === assessmentId) {
        tx.update(archiveRef, { v3AssessmentState: 'canceled', updatedAt: new Date().toISOString() });
      }
      return { status: 'canceled', captured: false, released: true };
    });
    if (result.status === 'ready') {
      const job = await this.getJobStatus(assessmentId, uid);
      return { ...result, result: job.result };
    }
    return result;
  }
}

module.exports = {
  JobService,
  QUOTE_TTL_MS
};
