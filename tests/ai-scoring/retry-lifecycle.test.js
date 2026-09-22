'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WalletService } = require('../../functions/src/ai-credits/wallet-service.js');
const { SettlementService } = require('../../functions/src/ai-credits/settlement-service.js');
const { JobService } = require('../../functions/src/ai-scoring/job-service.js');
const { ScoringWorker } = require('../../functions/src/ai-scoring/worker.js');

class MockCollectionRef {
  constructor(basePath, storage) {
    this.basePath = basePath;
    this.storage = storage;
  }
  doc(id) {
    const docPath = `${this.basePath}/${id}`;
    return {
      path: docPath,
      collection: (subCol) => new MockCollectionRef(`${docPath}/${subCol}`, this.storage),
      get: async () => {
        const docData = this.storage.get(docPath);
        return {
          exists: docData !== undefined,
          data: () => (docData ? JSON.parse(JSON.stringify(docData)) : undefined)
        };
      },
      set: async (val) => {
        this.storage.set(docPath, JSON.parse(JSON.stringify(val)));
      },
      update: async (val) => {
        const existing = this.storage.get(docPath) || {};
        this.storage.set(docPath, { ...existing, ...JSON.parse(JSON.stringify(val)) });
      },
      delete: async () => {
        this.storage.delete(docPath);
      }
    };
  }
}

class MockDb {
  constructor() {
    this.data = new Map();
  }
  collection(name) {
    return new MockCollectionRef(name, this.data);
  }
  async runTransaction(updateFunction) {
    const tx = {
      get: async (docRef) => {
        const docData = this.data.get(docRef.path);
        return {
          exists: docData !== undefined,
          data: () => (docData ? JSON.parse(JSON.stringify(docData)) : undefined)
        };
      },
      set: (docRef, val) => {
        this.data.set(docRef.path, JSON.parse(JSON.stringify(val)));
      },
      update: (docRef, val) => {
        const existing = this.data.get(docRef.path) || {};
        this.data.set(docRef.path, { ...existing, ...JSON.parse(JSON.stringify(val)) });
      },
      delete: (docRef) => {
        this.data.delete(docRef.path);
      }
    };
    return await updateFunction(tx);
  }
}

test('JobService: persists inputMeta and audio locators in job record', async () => {
  const db = new MockDb();
  const walletService = new WalletService({ db });
  const settlementService = new SettlementService({ db, walletService });
  const jobService = new JobService({ db, walletService, settlementService });

  const uid = 'user-locator-1';
  const quote = await jobService.createQuote({
    uid,
    mode: 'read_aloud',
    questionId: 'q-ra-101',
    inputMeta: {
      audioUrl: 'https://storage.googleapis.com/test-bucket/user-locator-1/audio.wav',
      storagePath: 'practice-attempts/user-locator-1/audio.wav',
      referenceText: 'Technology transforms learning.',
      sampleCount: 32000,
      sampleRateHz: 16000,
      inputHash: 'hash-abc-123'
    }
  });

  const confirmRes = await jobService.confirmQuote({
    uid,
    quoteId: quote.quoteId
  });

  assert.equal(confirmRes.alreadyConfirmed, false);
  const jobDoc = await db.collection('aiScoringJobs').doc(confirmRes.assessmentId).get();
  assert.ok(jobDoc.exists);
  const jobData = jobDoc.data();

  // Validate that inputMeta and referenceText are preserved
  assert.equal(jobData.inputMeta.audioUrl, 'https://storage.googleapis.com/test-bucket/user-locator-1/audio.wav');
  assert.equal(jobData.inputMeta.storagePath, 'practice-attempts/user-locator-1/audio.wav');
  assert.equal(jobData.referenceText, 'Technology transforms learning.');
  assert.equal(jobData.credits, 1);
});

test('JobService: allows retrying after previous attempt suffered terminal failure/refund', async () => {
  const db = new MockDb();
  const walletService = new WalletService({ db });
  const settlementService = new SettlementService({ db, walletService });
  const worker = new ScoringWorker({
    db,
    settlementService,
    stageExecutors: {
      read_aloud: async () => {
        throw new Error('PROVIDER_TIMEOUT');
      }
    }
  });
  const jobService = new JobService({ db, walletService, settlementService });

  const uid = 'user-retry-1';
  const inputMeta = {
    audioUrl: 'https://storage.googleapis.com/test/audio.wav',
    sampleCount: 32000,
    sampleRateHz: 16000,
    inputHash: 'hash-retry-123'
  };

  // 1. Initial attempt
  const q1 = await jobService.createQuote({
    uid,
    mode: 'read_aloud',
    questionId: 'q-retry-1',
    inputMeta
  });
  const res1 = await jobService.confirmQuote({ uid, quoteId: q1.quoteId });
  assert.equal(res1.alreadyConfirmed, false);

  // Initial attempt fails during execution
  await worker.processJob(res1.assessmentId);

  const job1Doc = await db.collection('aiScoringJobs').doc(res1.assessmentId).get();
  assert.equal(job1Doc.data().status, 'failed');

  // 2. User retries same question with new quote
  const q2 = await jobService.createQuote({
    uid,
    mode: 'read_aloud',
    questionId: 'q-retry-1',
    inputMeta
  });

  const res2 = await jobService.confirmQuote({ uid, quoteId: q2.quoteId });
  // Per §13.9, terminal-refunded jobs MUST NOT lock out retries
  assert.equal(res2.alreadyConfirmed, false);
  assert.notEqual(res2.assessmentId, res1.assessmentId);

  const job2Doc = await db.collection('aiScoringJobs').doc(res2.assessmentId).get();
  assert.equal(job2Doc.data().status, 'queued');
});

test('JobService: deduplicates identical concurrent operations while active', async () => {
  const db = new MockDb();
  const walletService = new WalletService({ db });
  const settlementService = new SettlementService({ db, walletService });
  const jobService = new JobService({ db, walletService, settlementService });

  const uid = 'user-dedupe-1';
  const inputMeta = {
    audioUrl: 'https://storage.googleapis.com/test/audio.wav',
    sampleCount: 16000,
    sampleRateHz: 16000,
    inputHash: 'hash-dedupe-999'
  };

  const q1 = await jobService.createQuote({
    uid,
    mode: 'read_aloud',
    questionId: 'q-dedupe-1',
    inputMeta
  });

  const res1 = await jobService.confirmQuote({ uid, quoteId: q1.quoteId });
  assert.equal(res1.alreadyConfirmed, false);

  // Second confirmation with same quote or duplicate call returns alreadyConfirmed: true
  const res2 = await jobService.confirmQuote({ uid, quoteId: q1.quoteId });
  assert.equal(res2.alreadyConfirmed, true);
  assert.equal(res2.assessmentId, res1.assessmentId);
});
