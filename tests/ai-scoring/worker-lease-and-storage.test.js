'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ScoringWorker } = require('../../functions/src/ai-scoring/worker');
const { JobService } = require('../../functions/src/ai-scoring/job-service');
const { WalletService } = require('../../functions/src/ai-credits/wallet-service');
const { SettlementService } = require('../../functions/src/ai-credits/settlement-service');

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
    return updateFunction(tx);
  }
}

test('ScoringWorker: Stale lease guard prevents self-destruct refund trap (C-03)', async () => {
  const db = new MockDb();
  const walletService = new WalletService({ db });
  const settlementService = new SettlementService({ db, walletService });
  const jobService = new JobService({ db, walletService, settlementService });

  const quote = await jobService.createQuote({
    uid: 'u-lease',
    mode: 'read_aloud',
    inputMeta: { sampleRateHz: 16000, sampleCount: 16000 }
  });
  const { assessmentId } = await jobService.confirmQuote({
    uid: 'u-lease',
    quoteId: quote.quoteId
  });

  // Verify credits reserved
  const walletBefore = await walletService.getWallet('u-lease');
  assert.equal(walletBefore.reservedCredits, 1);

  // Worker A starts processing with a custom stage executor that takes time
  let triggerSupersede = null;
  const workerA = new ScoringWorker({
    db,
    settlementService,
    stageExecutors: {
      read_aloud: async (job) => {
        // While Worker A is evaluating, worker B steals the lease (leaseVersion increments)
        if (triggerSupersede) await triggerSupersede();
        return { assessmentId: job.assessmentId, score: 95 };
      }
    }
  });

  triggerSupersede = async () => {
    // Simulate Worker A lease expiring so Worker B acquires a new lease
    await db.collection('aiScoringJobs').doc(assessmentId).update({
      leaseExpiresAt: new Date(Date.now() - 1000).toISOString()
    });
    const workerB = new ScoringWorker({ db, settlementService });
    await db.runTransaction(async tx => {
      await workerB.acquireLeaseInTx(tx, assessmentId, 'worker-b', 60000);
    });
  };

  // Worker A runs to completion
  const resA = await workerA.processJob(assessmentId, 'worker-a');

  // Worker A must abort cleanly because leaseVersion was superseded!
  assert.equal(resA.status, 'aborted');
  assert.equal(resA.reason, 'STALE_LEASE');

  // CRITICAL: Worker A must NOT have refunded credits or failed the job!
  const walletAfterA = await walletService.getWallet('u-lease');
  assert.equal(walletAfterA.reservedCredits, 1, 'Credits must remain reserved for Worker B');

  const jobDoc = await db.collection('aiScoringJobs').doc(assessmentId).get();
  assert.equal(jobDoc.data().status, 'processing', 'Job status must not be failed');
  assert.equal(jobDoc.data().leaseOwner, 'worker-b');
});

test('ScoringWorker: resolveAudioBuffer downloads from storagePath (C-01)', async () => {
  const db = new MockDb();
  const walletService = new WalletService({ db });
  const settlementService = new SettlementService({ db, walletService });

  const fakePcmBytes = Buffer.from([0x01, 0x02, 0x03, 0x04]);
  let downloadedPath = null;
  const mockStorageBucket = {
    file: (filePath) => ({
      download: async () => {
        downloadedPath = filePath;
        return [fakePcmBytes];
      }
    })
  };

  const worker = new ScoringWorker({
    db,
    settlementService,
    storageBucket: mockStorageBucket
  });

  const job = {
    assessmentId: 'asmt-storage-1',
    inputMeta: {
      storagePath: 'practice-attempts/user-1/recording.wav'
    }
  };

  const buffer = await worker.resolveAudioBuffer(job);
  assert.equal(downloadedPath, 'practice-attempts/user-1/recording.wav');
  assert.deepEqual(buffer, fakePcmBytes);
});

test('ScoringWorker: writing modes (write_essay, swt, sst) execute correctly (H-02)', async () => {
  const db = new MockDb();
  const walletService = new WalletService({ db });
  const settlementService = new SettlementService({ db, walletService });
  const jobService = new JobService({ db, walletService, settlementService });

  const worker = new ScoringWorker({ db, settlementService });

  // 1. write_essay
  const essayQuote = await jobService.createQuote({
    uid: 'u-write',
    mode: 'write_essay',
    inputMeta: { text: 'In today\'s interconnected world, international trade plays an essential role in fostering cultural exchange and global economic stability. ' + 'Word '.repeat(220) }
  });
  const { assessmentId: essayJobId } = await jobService.confirmQuote({
    uid: 'u-write',
    quoteId: essayQuote.quoteId
  });
  const essayRes = await worker.processJob(essayJobId);
  assert.equal(essayRes.status, 'ready');
  const essayJob = await db.collection('aiScoringJobs').doc(essayJobId).get();
  assert.equal(essayJob.data().result.mode, 'write_essay');
  assert.equal(essayJob.data().result.scores.form.score, 2);
  assert.deepEqual(essayJob.data().result.stagesCompleted, ['essay_coherence', 'essay_lexical', 'essay_grammar', 'essay_score']);

  // 2. summarize_written_text
  const swtQuote = await jobService.createQuote({
    uid: 'u-write',
    mode: 'summarize_written_text',
    inputMeta: { text: 'Although urbanization provides substantial industrial efficiency, thoughtful municipal planning remains crucial for sustainable community development.' }
  });
  const { assessmentId: swtJobId } = await jobService.confirmQuote({
    uid: 'u-write',
    quoteId: swtQuote.quoteId
  });
  const swtRes = await worker.processJob(swtJobId);
  assert.equal(swtRes.status, 'ready');
  const swtJob = await db.collection('aiScoringJobs').doc(swtJobId).get();
  assert.equal(swtJob.data().result.mode, 'summarize_written_text');
  assert.equal(swtJob.data().result.scores.form.score, 1);
  assert.deepEqual(swtJob.data().result.stagesCompleted, ['swt_grammar', 'swt_vocabulary', 'swt_summary']);

  // 3. summarize_spoken_text
  const sstQuote = await jobService.createQuote({
    uid: 'u-write',
    mode: 'summarize_spoken_text',
    inputMeta: { text: 'The lecturer explained the economic impacts of carbon emissions and highlighted renewable alternatives. ' + 'detail '.repeat(50) }
  });
  const { assessmentId: sstJobId } = await jobService.confirmQuote({
    uid: 'u-write',
    quoteId: sstQuote.quoteId
  });
  const sstRes = await worker.processJob(sstJobId);
  assert.equal(sstRes.status, 'ready');
  const sstJob = await db.collection('aiScoringJobs').doc(sstJobId).get();
  assert.equal(sstJob.data().result.mode, 'summarize_spoken_text');
  assert.equal(sstJob.data().result.scores.form.score, 2);
  assert.deepEqual(sstJob.data().result.stagesCompleted, ['sst_audio_transcribe', 'sst_content', 'sst_grammar', 'sst_summary']);
});

test('ScoringWorker: extendLease extends leaseExpiresAt for matching owner and version', async () => {
  const db = new MockDb();
  const walletService = new WalletService({ db });
  const settlementService = new SettlementService({ db, walletService });
  const jobService = new JobService({ db, walletService, settlementService });
  const worker = new ScoringWorker({ db, settlementService });

  const quote = await jobService.createQuote({
    uid: 'u-extend',
    mode: 'read_aloud',
    inputMeta: { sampleRateHz: 16000, sampleCount: 16000 }
  });
  const { assessmentId } = await jobService.confirmQuote({
    uid: 'u-extend',
    quoteId: quote.quoteId
  });

  // Acquire initial lease
  const job = await db.runTransaction(async tx => {
    return worker.acquireLeaseInTx(tx, assessmentId, 'worker-heartbeat', 30000);
  });
  assert.ok(job);
  const initialExp = new Date(job.leaseExpiresAt).getTime();

  // Extend lease by 60s
  const extended = await worker.extendLease(assessmentId, 'worker-heartbeat', job.leaseVersion, 60000);
  assert.equal(extended, true);

  const updatedJobDoc = await db.collection('aiScoringJobs').doc(assessmentId).get();
  const newExp = new Date(updatedJobDoc.data().leaseExpiresAt).getTime();
  assert.ok(newExp > initialExp, 'Lease expiration should be extended into the future');

  // Stale version or wrong owner fails
  const staleExtended = await worker.extendLease(assessmentId, 'worker-imposter', job.leaseVersion, 60000);
  assert.equal(staleExtended, false, 'Imposter worker should not be able to extend lease');

  const staleVersionExtended = await worker.extendLease(assessmentId, 'worker-heartbeat', job.leaseVersion + 99, 60000);
  assert.equal(staleVersionExtended, false, 'Stale version should not be able to extend lease');
});
