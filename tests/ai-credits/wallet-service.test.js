'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WalletService, getCurrentPeriodInfo } = require('../../functions/src/ai-credits/wallet-service.js');
const { SettlementService } = require('../../functions/src/ai-credits/settlement-service.js');

// Minimal in-memory Mock Firestore
class MockDocRef {
  constructor(path, storage) {
    this.path = path;
    this.storage = storage;
  }
}

class MockCollectionRef {
  constructor(basePath, storage) {
    this.basePath = basePath;
    this.storage = storage;
  }
  doc(id) {
    const docPath = `${this.basePath}/${id}`;
    return {
      path: docPath,
      collection: (subCol) => new MockCollectionRef(`${docPath}/${subCol}`, this.storage)
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
      }
    };
    return updateFunction(tx);
  }
}

test('WalletService: creates initial 5000 grant and is idempotent', async () => {
  const db = new MockDb();
  const walletService = new WalletService({ db });

  // First call: grants 5000
  const wallet1 = await walletService.getWallet('user-1');
  assert.equal(wallet1.grantCredits, 5000);
  assert.equal(wallet1.availableCredits, 5000);
  assert.equal(wallet1.isLifetime, true);
  assert.equal(wallet1.isNew, true);

  // Second call: does not add another 5000
  const wallet2 = await walletService.getWallet('user-1');
  assert.equal(wallet2.grantCredits, 5000);
  assert.equal(wallet2.availableCredits, 5000);
  assert.equal(wallet2.isNew, false);
});

test('WalletService: adds purchased credits to lifetime wallet', async () => {
  const db = new MockDb();
  const walletService = new WalletService({ db, defaultInitialGrant: 5000 });

  const initialWallet = await walletService.getWallet('buyer-1');
  assert.equal(initialWallet.availableCredits, 5000);

  // Buy 2000 credits
  const updatedWallet = await db.runTransaction(async tx => {
    return walletService.addPurchasedCreditsInTx(tx, {
      uid: 'buyer-1',
      amount: 2000,
      purchaseId: 'order-999'
    });
  });

  assert.equal(updatedWallet.purchasedCredits, 2000);
  assert.equal(updatedWallet.grantCredits, 7000);
  assert.equal(updatedWallet.availableCredits, 7000);
  assert.equal(updatedWallet.isLifetime, true);
});

test('SettlementService: reserve -> capture lifecycle', async () => {
  const db = new MockDb();
  const walletService = new WalletService({ db });
  const settlementService = new SettlementService({ db, walletService });

  const quote = {
    quoteId: 'quote-123',
    credits: 17,
    packageId: 'speaking.acoustic.transcript.v1'
  };

  // 1. Reserve 17 credits
  const reserveResult = await db.runTransaction(async tx => {
    return settlementService.reserveCreditsInTx(tx, {
      uid: 'user-1',
      assessmentId: 'asmt-001',
      quote
    });
  });
  assert.equal(reserveResult.status, 'reserved');
  assert.equal(reserveResult.reservedCredits, 17);
  assert.equal(reserveResult.remainingAvailable, 4983);

  // Check wallet balance
  const walletAfterReserve = await walletService.getWallet('user-1');
  assert.equal(walletAfterReserve.reservedCredits, 17);
  assert.equal(walletAfterReserve.spentCredits, 0);
  assert.equal(walletAfterReserve.availableCredits, 4983);

  // 2. Capture 17 credits upon completion
  const captureResult = await db.runTransaction(async tx => {
    return settlementService.captureCreditsInTx(tx, { assessmentId: 'asmt-001' });
  });
  assert.equal(captureResult.status, 'captured');

  // Check wallet balance
  const walletAfterCapture = await walletService.getWallet('user-1');
  assert.equal(walletAfterCapture.reservedCredits, 0);
  assert.equal(walletAfterCapture.spentCredits, 17);
  assert.equal(walletAfterCapture.availableCredits, 4983);
});

test('SettlementService: reserve -> release lifecycle on failure', async () => {
  const db = new MockDb();
  const walletService = new WalletService({ db });
  const settlementService = new SettlementService({ db, walletService });

  const quote = { quoteId: 'quote-456', credits: 25, packageId: 'speaking.acoustic.transcript.v1' };

  await db.runTransaction(async tx => {
    return settlementService.reserveCreditsInTx(tx, {
      uid: 'user-2',
      assessmentId: 'asmt-002',
      quote
    });
  });

  const walletMid = await walletService.getWallet('user-2');
  assert.equal(walletMid.availableCredits, 4975);

  // Release
  await db.runTransaction(async tx => {
    return settlementService.releaseCreditsInTx(tx, {
      assessmentId: 'asmt-002',
      reason: 'UNRELIABLE_ASR'
    });
  });

  const walletAfterRelease = await walletService.getWallet('user-2');
  assert.equal(walletAfterRelease.reservedCredits, 0);
  assert.equal(walletAfterRelease.spentCredits, 0);
  assert.equal(walletAfterRelease.availableCredits, 5000); // Fully refunded!
});

test('SettlementService: throws INSUFFICIENT_CREDITS when balance inadequate', async () => {
  const db = new MockDb();
  const walletService = new WalletService({ db, defaultInitialGrant: 10 });
  const settlementService = new SettlementService({ db, walletService });

  const quote = { quoteId: 'quote-big', credits: 15 };

  await assert.rejects(
    async () => {
      await db.runTransaction(async tx => {
        return settlementService.reserveCreditsInTx(tx, {
          uid: 'poor-user',
          assessmentId: 'asmt-003',
          quote
        });
      });
    },
    (err) => {
      assert.equal(err.code, 'INSUFFICIENT_CREDITS');
      assert.equal(err.requiredCredits, 15);
      assert.equal(err.availableCredits, 10);
      assert.equal(err.isLifetime, true);
      assert.equal(err.purchasable, true);
      return true;
    }
  );
});
