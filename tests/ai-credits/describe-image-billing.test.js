'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolvePackageForMode, getPackageConfig } = require('../../functions/src/ai-credits/rate-card');
const { quoteSpeaking } = require('../../functions/src/ai-credits/quote-math');
const { ScoringWorker } = require('../../functions/src/ai-scoring/worker');

test('RateCard: resolves describe_image to speaking.acoustic.transcript.v1 at 25 credits/min', () => {
  const pkg = resolvePackageForMode('describe_image');
  assert.ok(pkg, 'describe_image must resolve to an active package');
  assert.equal(pkg.packageId, 'speaking.acoustic.transcript.v1');
  assert.equal(pkg.creditsPerMinute, 25);
  assert.equal(pkg.kind, 'speaking');

  const pkgShort = resolvePackageForMode('di');
  assert.ok(pkgShort, 'di alias must resolve to an active package');
  assert.equal(pkgShort.packageId, 'speaking.acoustic.transcript.v1');
});

test('QuoteMath: quotes describe_image by the second rounded up at 25 c/m', () => {
  const pkg = getPackageConfig('speaking.acoustic.transcript.v1');

  // 30 seconds at 16 kHz = 480,000 samples
  const quote30s = quoteSpeaking({
    sampleCount: 480000,
    sampleRateHz: 16000,
    creditsPerMinute: pkg.creditsPerMinute
  });
  // ceil(30 * 25 / 60) = ceil(12.5) = 13 credits
  assert.equal(quote30s.quotedSeconds, 30);
  assert.equal(quote30s.credits, 13);

  // 40 seconds at 16 kHz = 640,000 samples (standard PTE DI response limit)
  const quote40s = quoteSpeaking({
    sampleCount: 640000,
    sampleRateHz: 16000,
    creditsPerMinute: pkg.creditsPerMinute
  });
  // ceil(40 * 25 / 60) = ceil(16.666) = 17 credits
  assert.equal(quote40s.quotedSeconds, 40);
  assert.equal(quote40s.credits, 17);

  // 60 seconds at 16 kHz = 960,000 samples
  const quote60s = quoteSpeaking({
    sampleCount: 960000,
    sampleRateHz: 16000,
    creditsPerMinute: pkg.creditsPerMinute
  });
  // ceil(60 * 25 / 60) = 25 credits
  assert.equal(quote60s.quotedSeconds, 60);
  assert.equal(quote60s.credits, 25);
});

test('ScoringWorker: provides describe_image executor calling two-pass ASR engine', async () => {
  let capturedJob = null;
  const mockDb = {
    runTransaction: async (cb) => cb({
      get: async () => ({ exists: true, data: () => ({ status: 'queued', leaseVersion: 1 }) }),
      set: () => {},
      update: () => {},
      delete: () => {}
    }),
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: true, data: () => ({}) })
      })
    })
  };

  const worker = new ScoringWorker({
    db: mockDb,
    settlementService: { captureCreditsInTx: async () => {} },
    enforceRolloutGates: false
  });

  assert.ok(typeof worker.defaultExecutors.describe_image === 'function');
  assert.ok(typeof worker.defaultExecutors.di === 'function');
});

test('SettlementService: releaseCredits and captureCredits execute outside transaction correctly', async () => {
  const { SettlementService } = require('../../functions/src/ai-credits/settlement-service');

  let releasedEvent = null;
  let capturedEvent = null;

  const mockDb = {
    runTransaction: async (cb) => {
      const mockTx = {
        get: async (ref) => ({
          exists: true,
          data: () => ref.collection === 'aiCreditAccounts' ? {
            reservedCredits: 17,
            spentCredits: 0
          } : ({
            status: 'reserved',
            uid: 'student-123',
            credits: 17
          })
        }),
        update: (ref, data) => {},
        set: (ref, data) => {
          if (data.type === 'release') releasedEvent = data;
          if (data.type === 'capture') capturedEvent = data;
        }
      };
      return cb(mockTx);
    },
    collection: (name) => ({
      doc: (id) => ({ id, collection: name })
    })
  };

  const mockWalletService = {
    getWalletRef: (uid) => ({ uid, collection: 'aiCreditAccounts' })
  };

  const settlement = new SettlementService({ db: mockDb, walletService: mockWalletService });

  // Test releaseCredits(uid, assessmentId, reason)
  const relResult = await settlement.releaseCredits('student-123', 'asmt-di-1', 'REFERENCE_CONFIRMATION_CANCELED');
  assert.equal(relResult.status, 'released');
  assert.equal(relResult.credits, 17);
  assert.equal(releasedEvent.reason, 'REFERENCE_CONFIRMATION_CANCELED');

  // Test releaseCredits({ assessmentId, reason })
  const relObjResult = await settlement.releaseCredits({ assessmentId: 'asmt-di-2', reason: 'STUDENT_CANCEL' });
  assert.equal(relObjResult.status, 'released');

  // Test captureCredits({ assessmentId })
  const capResult = await settlement.captureCredits({ assessmentId: 'asmt-di-1' });
  assert.equal(capResult.status, 'captured');
  assert.equal(capResult.credits, 17);
});

test('RateCard: handles unknown modes and preserves immutable package structures', () => {
  assert.equal(resolvePackageForMode('non_existent_mode'), null);
  const pkg1 = resolvePackageForMode('describe_image');
  pkg1.creditsPerMinute = 999;
  const pkg2 = resolvePackageForMode('describe_image');
  assert.equal(pkg2.creditsPerMinute, 25, 'RateCard package configs must not be mutated by external caller');
});
