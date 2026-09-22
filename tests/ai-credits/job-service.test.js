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
    return updateFunction(tx);
  }
}

test('JobService: createQuote does NOT reserve credits', async () => {
  const db = new MockDb();
  const walletService = new WalletService({ db });
  const settlementService = new SettlementService({ db, walletService });
  const jobService = new JobService({ db, walletService, settlementService });

  const quote = await jobService.createQuote({
    uid: 'learner-1',
    mode: 'read_aloud',
    inputMeta: { sampleCount: 368000, sampleRateHz: 16000, inputHash: 'hash-abc' } // 23s RA = 6 credits
  });

  assert.equal(quote.credits, 6);
  assert.equal(quote.state, 'offered');
  assert.equal(quote.availableCredits, 5000);
  assert.equal(quote.availableAfterConfirmation, 4994);

  // Verify wallet still has 5000 available, 0 reserved
  const wallet = await walletService.getWallet('learner-1');
  assert.equal(wallet.reservedCredits, 0);
  assert.equal(wallet.availableCredits, 5000);
});

test('JobService: confirmQuote reserves credits and creates job', async () => {
  const db = new MockDb();
  const walletService = new WalletService({ db });
  const settlementService = new SettlementService({ db, walletService });
  const jobService = new JobService({ db, walletService, settlementService });

  const quote = await jobService.createQuote({
    uid: 'learner-2',
    mode: 'read_aloud',
    inputMeta: { sampleCount: 320000, sampleRateHz: 16000, inputHash: 'hash-123' } // 20s RA = 5 credits
  });

  const confirmRes = await jobService.confirmQuote({ uid: 'learner-2', quoteId: quote.quoteId });
  assert.ok(confirmRes.assessmentId);
  assert.equal(confirmRes.alreadyConfirmed, false);

  // Check wallet reserved
  const wallet = await walletService.getWallet('learner-2');
  assert.equal(wallet.reservedCredits, 5);
  assert.equal(wallet.availableCredits, 4995);

  // Confirming again is idempotent
  const repeatConfirm = await jobService.confirmQuote({ uid: 'learner-2', quoteId: quote.quoteId });
  assert.equal(repeatConfirm.assessmentId, confirmRes.assessmentId);
  assert.equal(repeatConfirm.alreadyConfirmed, true);

  // Wallet reserved credits NOT doubled!
  const walletAfterRepeat = await walletService.getWallet('learner-2');
  assert.equal(walletAfterRepeat.reservedCredits, 5);
});

test('ScoringWorker: processes job and captures credits upon success', async () => {
  const db = new MockDb();
  const walletService = new WalletService({ db });
  const settlementService = new SettlementService({ db, walletService });
  const jobService = new JobService({ db, walletService, settlementService });

  const quote = await jobService.createQuote({
    uid: 'learner-3',
    mode: 'read_aloud',
    inputMeta: { sampleCount: 640000, sampleRateHz: 16000, inputHash: 'hash-40s' } // 40s RA = 10 credits
  });
  const { assessmentId } = await jobService.confirmQuote({ uid: 'learner-3', quoteId: quote.quoteId });

  const worker = new ScoringWorker({
    db,
    settlementService,
    stageExecutors: {
      default: async (job) => {
        return { accuracyScore: 85, mode: job.mode };
      }
    }
  });

  const runResult = await worker.processJob(assessmentId);
  assert.equal(runResult.status, 'ready');

  // Job should be ready
  const job = await jobService.getJobStatus(assessmentId, 'learner-3');
  assert.equal(job.status, 'ready');
  assert.equal(job.stage, 'completed');
  assert.equal(job.result.accuracyScore, 85);

  // Wallet credits captured: spent = 10, reserved = 0, available = 4990
  const wallet = await walletService.getWallet('learner-3');
  assert.equal(wallet.spentCredits, 10);
  assert.equal(wallet.reservedCredits, 0);
  assert.equal(wallet.availableCredits, 4990);
});

test('ScoringWorker: releases credits upon execution failure', async () => {
  const db = new MockDb();
  const walletService = new WalletService({ db });
  const settlementService = new SettlementService({ db, walletService });
  const jobService = new JobService({ db, walletService, settlementService });

  const quote = await jobService.createQuote({
    uid: 'learner-4',
    mode: 'read_aloud',
    inputMeta: { sampleCount: 160000, sampleRateHz: 16000, inputHash: 'hash-fail' } // 10s RA = 3 credits
  });
  const { assessmentId } = await jobService.confirmQuote({ uid: 'learner-4', quoteId: quote.quoteId });

  const worker = new ScoringWorker({
    db,
    settlementService,
    stageExecutors: {
      default: async () => {
        throw new Error('PROVIDER_SERVICE_UNAVAILABLE');
      }
    }
  });

  const runResult = await worker.processJob(assessmentId);
  assert.equal(runResult.status, 'failed');

  // Job status failed
  const job = await jobService.getJobStatus(assessmentId, 'learner-4');
  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'PROVIDER_SERVICE_UNAVAILABLE');

  // Wallet credits refunded: spent = 0, reserved = 0, available = 5000
  const wallet = await walletService.getWallet('learner-4');
  assert.equal(wallet.spentCredits, 0);
  assert.equal(wallet.reservedCredits, 0);
  assert.equal(wallet.availableCredits, 5000);
});
