'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const {
  DEFAULT_ROLLOUT_FLAGS,
  parseRolloutFlags,
  isAiScoringQuotesEnabled,
  isAiScoringQuotesActive,
  isAiScoringQuotesShadow,
  isModeEnabledForPronunciationV2,
  isModeEnabledForTranscriptConditioning,
  isRlSpokenAssessmentEnabled,
  getPublicFeatureFlags
} = require('../functions/src/config/rollout-flags');

const { buildPublicFeatures } = require('../functions/src/public-feature-config');
const createAiScoringRouter = require('../functions/src/routes/ai-scoring');
const { ScoringWorker } = require('../functions/src/ai-scoring/worker');
const { resolveWordClipTiming } = require('../functions/src/services/azure-speech/word-clip-policy');
const { WalletService } = require('../functions/src/ai-credits/wallet-service');
const { SettlementService } = require('../functions/src/ai-credits/settlement-service');
const { JobService } = require('../functions/src/ai-scoring/job-service');

// In-memory mock Firestore for route and worker tests
class MockDoc {
  constructor(data = null) {
    this._data = data;
    this.exists = data !== null;
  }
  data() {
    return this._data ? JSON.parse(JSON.stringify(this._data)) : null;
  }
}

class MockDb {
  constructor() {
    this.store = new Map();
  }
  _key(col, id) {
    return `${col}/${id}`;
  }
  collection(colName) {
    return {
      doc: (id) => ({
        get: async () => new MockDoc(this.store.get(this._key(colName, id)) || null),
        set: async (d) => { this.store.set(this._key(colName, id), JSON.parse(JSON.stringify(d))); },
        collection: (subCol) => ({
          doc: (subId) => ({
            get: async () => new MockDoc(this.store.get(`${colName}/${id}/${subCol}/${subId}`) || null),
            set: async (d) => { this.store.set(`${colName}/${id}/${subCol}/${subId}`, JSON.parse(JSON.stringify(d))); },
            update: async (d) => {
              const k = `${colName}/${id}/${subCol}/${subId}`;
              const cur = this.store.get(k) || {};
              this.store.set(k, { ...cur, ...JSON.parse(JSON.stringify(d)) });
            }
          })
        })
      })
    };
  }
  async runTransaction(cb) {
    const tx = {
      get: async (ref) => ref.get(),
      set: (ref, d) => ref.set(d),
      update: (ref, d) => {
        if (typeof ref.update === 'function') return ref.update(d);
        return ref.set(d);
      },
      delete: (ref) => {}
    };
    return cb(tx);
  }
}

// 1. Flag parsing & defaults test
test('RolloutFlags: parses default values strictly per §15', () => {
  const flags = parseRolloutFlags({});
  assert.equal(flags.aiScoringQuotes, 'active');
  assert.equal(flags.aiCreditRateCardVersion, '2026.09.v1');
  assert.equal(flags.aiCreditMonthlyGrant, 5000);
  assert.equal(flags.aiCreditDailyCapEnabled, false);
  assert.equal(flags.entranceExactClipPolicy, 'active');
  assert.deepEqual(Array.from(flags.practicePronunciationV2Modes), ['read_aloud', 'repeat_sentence']);
  assert.deepEqual(Array.from(flags.practiceTranscriptConditionedModes), []);
  assert.equal(flags.pronounceTimingV42, 'active');
  assert.equal(flags.pronounceStressV2, 'active');
  assert.equal(flags.rlSpokenAssessment, false);
});

// 2. Custom environment overrides
test('RolloutFlags: parses custom environment overrides correctly', () => {
  const customEnv = {
    AI_SCORING_QUOTES: 'shadow',
    AI_CREDIT_RATE_CARD_VERSION: '2026.10.v2',
    AI_CREDIT_MONTHLY_GRANT: '2000',
    AI_CREDIT_DAILY_CAP_ENABLED: 'true',
    ENTRANCE_EXACT_CLIP_POLICY: 'legacy',
    PRACTICE_PRONUNCIATION_V2_MODES: 'read_aloud',
    PRACTICE_TRANSCRIPT_CONDITIONED_MODES: 'retell_lecture, summarize_group_discussion',
    PRONOUNCE_TIMING_V42: 'shadow',
    PRONOUNCE_STRESS_V2: 'off',
    RL_SPOKEN_ASSESSMENT: 'true'
  };

  const flags = parseRolloutFlags(customEnv);
  assert.equal(flags.aiScoringQuotes, 'shadow');
  assert.equal(flags.aiCreditRateCardVersion, '2026.10.v2');
  assert.equal(flags.aiCreditMonthlyGrant, 2000);
  assert.equal(flags.aiCreditDailyCapEnabled, true);
  assert.equal(flags.entranceExactClipPolicy, 'legacy');
  assert.deepEqual(Array.from(flags.practicePronunciationV2Modes), ['read_aloud']);
  assert.deepEqual(Array.from(flags.practiceTranscriptConditionedModes), ['retell_lecture', 'summarize_group_discussion']);
  assert.equal(flags.pronounceTimingV42, 'shadow');
  assert.equal(flags.pronounceStressV2, 'off');
  assert.equal(flags.rlSpokenAssessment, true);

  assert.equal(isAiScoringQuotesEnabled(flags), true);
  assert.equal(isAiScoringQuotesActive(flags), false);
  assert.equal(isAiScoringQuotesShadow(flags), true);
  assert.equal(isModeEnabledForPronunciationV2('read_aloud', flags), true);
  assert.equal(isModeEnabledForPronunciationV2('repeat_sentence', flags), false);
  assert.equal(isModeEnabledForTranscriptConditioning('retell_lecture', flags), true);
  assert.equal(isModeEnabledForTranscriptConditioning('respond_to_situation', flags), false);
  assert.equal(isRlSpokenAssessmentEnabled(flags), true);
});

// 3. Public capabilities exposition
test('RolloutFlags: buildPublicFeatures includes sanitized capability metadata', () => {
  const features = buildPublicFeatures({
    AI_SCORING_QUOTES: 'shadow',
    RL_SPOKEN_ASSESSMENT: 'false'
  });
  assert.equal(features.aiScoringQuotes, 'shadow');
  assert.equal(features.rlSpokenAssessment, false);
  assert.deepEqual(features.practicePronunciationV2Modes, ['read_aloud', 'repeat_sentence']);
  assert.ok('entranceExactClipPolicy' in features);
  assert.ok('pronounceTimingV42' in features);
});

// 4. Quoting route behavior: off, shadow, active
test('RolloutFlags: POST /quotes respects AI_SCORING_QUOTES states', async () => {
  const db = new MockDb();

  // Test 'off'
  {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { uid: 'u1', role: 'student' }; next(); });
    app.use('/api/ai-scoring', createAiScoringRouter({
      db,
      env: { AI_SCORING_QUOTES: 'off' }
    }));

    const server = app.listen(0);
    const port = server.address().port;
    try {
      const res = await fetch(`http://localhost:${port}/api/ai-scoring/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'read_aloud', inputMeta: { sampleRateHz: 16000, sampleCount: 16000 } })
      });
      assert.equal(res.status, 503);
      const data = await res.json();
      assert.equal(data.error, 'FEATURE_DISABLED');
    } finally {
      server.close();
    }
  }

  // Test 'shadow'
  {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { uid: 'u1', role: 'student' }; next(); });
    app.use('/api/ai-scoring', createAiScoringRouter({
      db,
      env: { AI_SCORING_QUOTES: 'shadow' }
    }));

    const server = app.listen(0);
    const port = server.address().port;
    try {
      // Quotes works with shadow: true
      const quoteRes = await fetch(`http://localhost:${port}/api/ai-scoring/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'read_aloud', inputMeta: { sampleRateHz: 16000, sampleCount: 16000 } })
      });
      assert.equal(quoteRes.status, 200);
      const quote = await quoteRes.json();
      assert.equal(quote.shadow, true);

      // Confirm rejects with 403 FEATURE_SHADOW_ONLY
      const confirmRes = await fetch(`http://localhost:${port}/api/ai-scoring/quotes/${quote.quoteId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      assert.equal(confirmRes.status, 403);
      const confirmData = await confirmRes.json();
      assert.equal(confirmData.error, 'FEATURE_SHADOW_ONLY');
    } finally {
      server.close();
    }
  }
});

// 5. Worker mode gating
test('RolloutFlags: ScoringWorker enforces mode rollout gates', async () => {
  const db = new MockDb();
  const walletService = new WalletService({ db });
  const settlementService = new SettlementService({ db, walletService });
  const jobService = new JobService({ db, walletService, settlementService });

  // Worker with strict rollout gates and empty transcript modes
  const worker = new ScoringWorker({
    db,
    settlementService,
    enforceRolloutGates: true,
    env: {
      PRACTICE_PRONUNCIATION_V2_MODES: 'read_aloud', // repeat_sentence is excluded
      PRACTICE_TRANSCRIPT_CONDITIONED_MODES: '', // empty
      RL_SPOKEN_ASSESSMENT: 'false'
    }
  });

  // Attempt 1: repeat_sentence should fail with MODE_NOT_RELEASED
  const quoteRs = await jobService.createQuote({
    uid: 'u-rs',
    mode: 'repeat_sentence',
    inputMeta: { sampleRateHz: 16000, sampleCount: 16000 }
  });
  const { assessmentId: asmtRs } = await jobService.confirmQuote({
    uid: 'u-rs',
    quoteId: quoteRs.quoteId
  });

  const resRs = await worker.processJob(asmtRs);
  assert.equal(resRs.status, 'failed');
  assert.ok(resRs.error.includes('MODE_NOT_RELEASED'));

  // Attempt 2: retell_lecture should fail with RL_SPOKEN_ASSESSMENT_DISABLED
  const quoteRl = await jobService.createQuote({
    uid: 'u-rl',
    mode: 'retell_lecture',
    inputMeta: { sampleRateHz: 16000, sampleCount: 16000 }
  });
  const { assessmentId: asmtRl } = await jobService.confirmQuote({
    uid: 'u-rl',
    quoteId: quoteRl.quoteId
  });

  const resRl = await worker.processJob(asmtRl);
  assert.equal(resRl.status, 'failed');
  assert.ok(resRl.error.includes('RL_SPOKEN_ASSESSMENT_DISABLED') || resRl.error.includes('MODE_NOT_RELEASED'));

  // Attempt 3: read_aloud is enabled and succeeds
  const quoteRa = await jobService.createQuote({
    uid: 'u-ra',
    mode: 'read_aloud',
    inputMeta: { sampleRateHz: 16000, sampleCount: 16000 }
  });
  const { assessmentId: asmtRa } = await jobService.confirmQuote({
    uid: 'u-ra',
    quoteId: quoteRa.quoteId
  });

  const resRa = await worker.processJob(asmtRa);
  assert.equal(resRa.status, 'ready');
});

// 6. WordClipPolicy: ENTRANCE_EXACT_CLIP_POLICY rollout support
test('RolloutFlags: WordClipPolicy supports legacy, shadow, and active clip policies', () => {
  const word = {
    word: 'international',
    startMs: 100,
    endMs: 800
  };

  // 1. Active: ending-preserving full span
  const activeClip = resolveWordClipTiming(word, null, { sampleRateHz: 16000 }, { clipPolicy: 'active' });
  assert.equal(activeClip.policy, 'active');
  assert.equal(activeClip.boundaryConvention, 'ending_preserving_v1');
  assert.deepEqual(activeClip.clipSpan, { startSample: 1600, endSample: 12800 });

  // 2. Legacy: 35ms shaved end
  const legacyClip = resolveWordClipTiming(word, null, { sampleRateHz: 16000 }, { clipPolicy: 'legacy' });
  assert.equal(legacyClip.policy, 'legacy');
  assert.equal(legacyClip.boundaryConvention, 'legacy_trimmed');
  // 35ms at 16kHz = 560 samples. 12800 - 560 = 12240
  assert.deepEqual(legacyClip.clipSpan, { startSample: 1600, endSample: 12240 });

  // 3. Shadow: ending-preserving clipSpan + legacyClipSpan attached
  const shadowClip = resolveWordClipTiming(word, null, { sampleRateHz: 16000 }, { clipPolicy: 'shadow' });
  assert.equal(shadowClip.policy, 'shadow');
  assert.equal(shadowClip.boundaryConvention, 'ending_preserving_v1');
  assert.deepEqual(shadowClip.clipSpan, { startSample: 1600, endSample: 12800 });
  assert.deepEqual(shadowClip.legacyClipSpan, { startSample: 1600, endSample: 12240 });
});
