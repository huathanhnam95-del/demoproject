'use strict';

const express = require('express');
const crypto = require('crypto');
const { JobService } = require('../ai-scoring/job-service');
const { WalletService } = require('../ai-credits/wallet-service');
const { SettlementService } = require('../ai-credits/settlement-service');
const { AudioAssetService, MAX_UPLOAD_BYTES } = require('../ai-scoring/audio-assets');
const { parseCanonicalWav } = require('../services/azure-speech/audio-manifest');
const { normalizePracticeMode } = require('../practice-attempts/attempt-constraints');
const {
  parseRolloutFlags,
  isAiScoringQuotesEnabled,
  isAiScoringQuotesActive,
  isAiScoringQuotesShadow,
  isSpeechV3Enabled
} = require('../config/rollout-flags');

function createAiScoringRouter({ db, taskDispatcher = null, getStorageBucket = null, env = process.env }) {
  const router = express.Router();

  const walletService = new WalletService({ db });
  const settlementService = new SettlementService({ db, walletService });
  const audioAssetService = getStorageBucket ? new AudioAssetService({ db, getBucket: getStorageBucket }) : null;
  const jobService = new JobService({ db, walletService, settlementService, taskDispatcher, audioAssetService });

  // Middleware to resolve authenticated user
  function requireAuth(req, res, next) {
    const uid = req.user?.uid || (process.env.NODE_ENV === 'test' ? (req.headers['x-user-id'] || req.query.uid) : null);
    if (!uid) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
    }
    req.uid = uid;
    next();
  }

  // Server-side account authorization: never trust client accountType
  async function resolveAccountType(uid, reqUser) {
    if (reqUser?.role === 'admin' || reqUser?.role === 'teacher' || reqUser?.role === 'student') {
      return 'eligible_learner';
    }
    if (db && typeof db.collection === 'function') {
      try {
        const studentDoc = await db.collection('students').doc(uid).get();
        if (studentDoc.exists) {
          return 'eligible_learner';
        }
      } catch (err) {
        console.warn('[AiScoringRouter] Failed to lookup student profile:', err.message);
      }
    }
    return 'trial';
  }

  router.post('/audio', requireAuth, express.raw({ type: 'audio/wav', limit: MAX_UPLOAD_BYTES }), async (req, res) => {
    try {
      const mode = normalizePracticeMode(req.headers['x-speech-mode']);
      if (!isSpeechV3Enabled(mode, parseRolloutFlags(env))) {
        return res.status(503).json({ error: 'SPEECH_V3_DISABLED' });
      }
      if (!audioAssetService) return res.status(503).json({ error: 'STORAGE_UNAVAILABLE' });
      const result = await audioAssetService.upload({
        uid: req.uid,
        mode,
        attemptId: req.headers['x-attempt-id'],
        uploadKey: req.headers['x-upload-idempotency-key'],
        buffer: req.body
      });
      return res.status(200).json(result);
    } catch (err) {
      return res.status(err.status || (err instanceof TypeError ? 400 : 500)).json({ error: err.code || err.message });
    }
  });

  // Saved V3 feedback replays the exact canonical samples that were scored.
  // Neither a Storage path nor an owner identity is accepted from the client.
  router.get('/audio/:audioId', requireAuth, async (req, res) => {
    try {
      const audioId = String(req.params.audioId || '');
      if (!/^aud-[0-9a-f]{40}$/.test(audioId)) return res.status(400).json({ error: 'INVALID_AUDIO_ID' });
      if (!audioAssetService) return res.status(503).json({ error: 'STORAGE_UNAVAILABLE' });
      const assetSnap = await audioAssetService.getRef(audioId).get();
      if (!assetSnap.exists || assetSnap.data()?.uid !== req.uid) return res.status(404).json({ error: 'AUDIO_NOT_FOUND' });
      const asset = assetSnap.data();
      if (asset.status !== 'active') return res.status(asset.status === 'deleting' ? 410 : 404).json({ error: 'AUDIO_UNAVAILABLE' });
      const attemptSnap = await db.collection('speakingAttempts').doc(String(asset.attemptId || '')).get();
      const attempt = attemptSnap.exists ? attemptSnap.data() : null;
      if (!attempt || attempt.ownerUid !== req.uid || attempt.v3AudioId !== audioId ||
          attempt.v3AssessmentState !== 'ready' || attempt.status !== 'submitted') {
        return res.status(404).json({ error: 'AUDIO_NOT_FOUND' });
      }
      const deleteAfter = attempt.deleteAfterAt?.toMillis?.() ?? Date.parse(attempt.deleteAfterAt || '');
      if (attempt.retentionState === 'deleted' || (Number.isFinite(deleteAfter) && deleteAfter <= Date.now())) {
        return res.status(410).json({ error: 'AUDIO_RETIRED' });
      }
      const bucket = await getStorageBucket();
      if (!bucket) return res.status(503).json({ error: 'STORAGE_UNAVAILABLE' });
      const expectedGeneration = Number(asset.manifest?.storageGeneration);
      if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration <= 0) {
        return res.status(409).json({ error: 'AUDIO_REVISION_CHANGED' });
      }
      const [metadata] = await bucket.file(asset.storagePath).getMetadata();
      if (String(metadata.generation) !== String(expectedGeneration)) {
        return res.status(409).json({ error: 'AUDIO_REVISION_CHANGED' });
      }
      const file = bucket.file(asset.storagePath, { generation: expectedGeneration });
      const [bytes] = await file.download();
      if (bytes.length > MAX_UPLOAD_BYTES ||
          crypto.createHash('sha256').update(bytes).digest('hex') !== asset.manifest?.canonicalFileHash ||
          parseCanonicalWav(bytes).sampleCount !== asset.manifest?.sampleCount) {
        return res.status(409).json({ error: 'AUDIO_IDENTITY_MISMATCH' });
      }
      res.set('Content-Type', 'audio/wav');
      res.set('Cache-Control', 'private, no-store');
      res.set('X-Content-Type-Options', 'nosniff');
      return res.send(bytes);
    } catch (error) {
      if (Number(error.code) === 404) return res.status(404).json({ error: 'AUDIO_NOT_FOUND' });
      return res.status(500).json({ error: 'AUDIO_READ_FAILED' });
    }
  });

  // 1. POST /api/ai-scoring/quotes (Zero paid AI calls)
  router.post('/quotes', requireAuth, async (req, res) => {
    try {
      const flags = parseRolloutFlags(env);
      if (!isAiScoringQuotesEnabled(flags)) {
        return res.status(503).json({
          error: 'FEATURE_DISABLED',
          message: 'AI scoring quotes are currently disabled'
        });
      }

      const { inputMeta, questionId, preferredPackageId } = req.body;
      const mode = normalizePracticeMode(req.body.mode);
      if (!mode || !inputMeta) {
        return res.status(400).json({ error: 'INVALID_REQUEST', message: 'mode and inputMeta are required' });
      }
      const speechV3 = isSpeechV3Enabled(mode, flags);
      if (inputMeta.audioId && !speechV3) return res.status(503).json({ error: 'SPEECH_V3_DISABLED' });

      const accountType = await resolveAccountType(req.uid, req.user);

      const quote = await jobService.createQuote({
        uid: req.uid,
        mode,
        inputMeta,
        questionId,
        preferredPackageId,
        accountType,
        speechV3
      });

      const isShadow = isAiScoringQuotesShadow(flags);
      return res.status(200).json({
        ...quote,
        ...(isShadow ? { shadow: true } : {})
      });
    } catch (err) {
      console.error('[AiScoringRouter] Error creating quote:', err);
      return res.status(err.status || (err.code === 'UNSUPPORTED_MODE' ? 400 : 500)).json({
        error: err.code || 'INTERNAL_ERROR',
        message: err.message
      });
    }
  });

  // 2. POST /api/ai-scoring/quotes/:quoteId/confirm (Atomic reservation and job queue)
  router.post('/quotes/:quoteId/confirm', requireAuth, async (req, res) => {
    try {
      const flags = parseRolloutFlags(env);
      if (!isAiScoringQuotesActive(flags)) {
        if (isAiScoringQuotesShadow(flags)) {
          return res.status(403).json({
            error: 'FEATURE_SHADOW_ONLY',
            message: 'AI scoring is in shadow mode; quote confirmation and credit debiting are disabled'
          });
        }
        return res.status(503).json({
          error: 'FEATURE_DISABLED',
          message: 'AI scoring confirmation is currently disabled'
        });
      }

      const { quoteId } = req.params;
      const accountType = await resolveAccountType(req.uid, req.user);

      const result = await jobService.confirmQuote({
        uid: req.uid,
        quoteId,
        accountType
      });

      return res.status(result.alreadyConfirmed ? 200 : 202).json({
        assessmentId: result.assessmentId,
        quoteId,
        state: 'queued',
        alreadyConfirmed: result.alreadyConfirmed,
        dispatchPending: result.dispatchPending || false
      });
    } catch (err) {
      console.error('[AiScoringRouter] Error confirming quote:', err);
      if (err.code === 'INSUFFICIENT_CREDITS') {
        return res.status(402).json({
          error: 'INSUFFICIENT_CREDITS',
          message: `Insufficient AI credits: required ${err.requiredCredits}, available ${err.availableCredits}`,
          requiredCredits: err.requiredCredits,
          availableCredits: err.availableCredits,
          isLifetime: err.isLifetime ?? true,
          purchasable: err.purchasable ?? true,
          renewsAt: err.renewsAt || null
        });
      }
      if (err.code === 'QUOTE_EXPIRED' || err.code === 'QUOTE_NOT_FOUND' || err.code === 'UNAUTHORIZED') {
        return res.status(400).json({ error: err.code, message: err.message });
      }
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
    }
  });

  // 3. GET /api/ai-scoring/assessments/:assessmentId (Polling job status)
  router.get('/assessments/:assessmentId', requireAuth, async (req, res) => {
    try {
      const { assessmentId } = req.params;
      const job = await jobService.getJobStatus(assessmentId, req.uid);
      if (!job) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Assessment job not found' });
      }

      return res.status(200).json({
        assessmentId: job.assessmentId,
        mode: job.mode,
        status: job.status,
        stage: job.stage,
        error: job.error || null,
        result: job.result || null,
        ambiguities: job.ambiguities || null,
        transcription: job.transcription || null,
        expiresAt: job.expiresAt || null,
        updatedAt: job.updatedAt || null
      });
    } catch (err) {
      console.error('[AiScoringRouter] Error fetching assessment status:', err);
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
    }
  });

  // 4. POST /api/ai-scoring/assessments/:assessmentId/confirm-reference (Plan V3 §11.3)
  router.post('/assessments/:assessmentId/cancel', requireAuth, async (req, res) => {
    try {
      const result = await jobService.cancelAssessment(req.params.assessmentId, req.uid);
      return res.status(result.status === 'not_found' ? 404 : 200).json({ assessmentId: req.params.assessmentId, ...result });
    } catch (error) {
      return res.status(error.code === 'UNAUTHORIZED' ? 403 : 500).json({ error: error.code || 'CANCEL_FAILED', message: error.message });
    }
  });

  router.post('/assessments/:assessmentId/confirm-reference', requireAuth, async (req, res) => {
    try {
      const { assessmentId } = req.params;
      const { action, confirmations } = req.body || {};

      const jobRef = db.collection('aiScoringJobs').doc(assessmentId);
      const jobDoc = await jobRef.get();
      if (!jobDoc.exists) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Job not found' });
      }
      const job = jobDoc.data();
      if (job.uid !== req.uid) {
        return res.status(403).json({ error: 'UNAUTHORIZED', message: 'Not authorized for this job' });
      }
      if (job.engineVersion === 'bel.speech.v3' || job.status !== 'awaiting_reference_confirmation') {
        return res.status(409).json({ error: 'LEGACY_CONFIRMATION_STATE_REQUIRED' });
      }

      if (action === 'cancel' || action === 'unresolved') {
        // Release reserved credits immediately without generating fake scores
        if (typeof settlementService?.releaseCredits === 'function') {
          await settlementService.releaseCredits(req.uid, assessmentId, 'REFERENCE_CONFIRMATION_CANCELED');
        } else if (typeof settlementService?.releaseCreditsInTx === 'function') {
          await db.runTransaction(async tx => {
            return settlementService.releaseCreditsInTx(tx, { assessmentId, reason: 'REFERENCE_CONFIRMATION_CANCELED' });
          });
        }
        await jobRef.update({
          status: 'reference_unresolved',
          stage: 'reference_unresolved',
          updatedAt: new Date().toISOString()
        });
        return res.status(200).json({ status: 'reference_unresolved', refunded: true });
      }

      if (!confirmations || typeof confirmations !== 'object') {
        return res.status(400).json({ error: 'INVALID_CONFIRMATIONS', message: 'confirmations map is required' });
      }

      await jobRef.update({
        confirmedAmbiguities: confirmations,
        status: 'queued',
        stage: 'queued',
        updatedAt: new Date().toISOString()
      });

      // Outbox pattern: re-enqueue into aiScoringOutbox so worker polling picks up the confirmed job
      await db.collection('aiScoringOutbox').doc(assessmentId).set({
        assessmentId,
        status: 'pending',
        confirmed: true,
        createdAt: new Date().toISOString()
      }, { merge: true });

      // Dispatch to outbox for worker pickup
      if (taskDispatcher) {
        await taskDispatcher.dispatch(assessmentId).catch(err => {
          console.warn('[AiScoringRouter] Dispatch error after confirmation:', err.message);
        });
      }

      return res.status(200).json({ status: 'queued', assessmentId });
    } catch (err) {
      console.error('[AiScoringRouter] Error confirming reference:', err);
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
    }
  });

  // 4. GET /api/ai-scoring/wallet (Inspect balance and renewal)
  router.get('/wallet', requireAuth, async (req, res) => {
    try {
      const accountType = await resolveAccountType(req.uid, req.user);
      const wallet = await walletService.getWallet(req.uid, accountType);
      return res.status(200).json(wallet);
    } catch (err) {
      console.error('[AiScoringRouter] Error inspecting wallet:', err);
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
    }
  });

  return router;
}

module.exports = createAiScoringRouter;
module.exports.createAiScoringRouter = createAiScoringRouter;
