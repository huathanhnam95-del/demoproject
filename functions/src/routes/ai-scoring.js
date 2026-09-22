'use strict';

const express = require('express');
const { JobService } = require('../ai-scoring/job-service');
const { WalletService } = require('../ai-credits/wallet-service');
const { SettlementService } = require('../ai-credits/settlement-service');
const {
  parseRolloutFlags,
  isAiScoringQuotesEnabled,
  isAiScoringQuotesActive,
  isAiScoringQuotesShadow
} = require('../config/rollout-flags');

function createAiScoringRouter({ db, taskDispatcher = null, env = process.env }) {
  const router = express.Router();

  const walletService = new WalletService({ db });
  const settlementService = new SettlementService({ db, walletService });
  const jobService = new JobService({ db, walletService, settlementService, taskDispatcher });

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

      const { mode, inputMeta, questionId, preferredPackageId } = req.body;
      if (!mode || !inputMeta) {
        return res.status(400).json({ error: 'INVALID_REQUEST', message: 'mode and inputMeta are required' });
      }

      const accountType = await resolveAccountType(req.uid, req.user);

      const quote = await jobService.createQuote({
        uid: req.uid,
        mode,
        inputMeta,
        questionId,
        preferredPackageId,
        accountType
      });

      const isShadow = isAiScoringQuotesShadow(flags);
      return res.status(200).json({
        ...quote,
        ...(isShadow ? { shadow: true } : {})
      });
    } catch (err) {
      console.error('[AiScoringRouter] Error creating quote:', err);
      return res.status(err.code === 'UNSUPPORTED_MODE' ? 400 : 500).json({
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
        alreadyConfirmed: result.alreadyConfirmed
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
        expiresAt: job.expiresAt || null,
        updatedAt: job.updatedAt || null
      });
    } catch (err) {
      console.error('[AiScoringRouter] Error fetching assessment status:', err);
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
