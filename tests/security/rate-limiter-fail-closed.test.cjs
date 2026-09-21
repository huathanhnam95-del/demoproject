const test = require('node:test');
const assert = require('node:assert/strict');
const { FirestoreRateLimitStore } = require('../../functions/src/middleware/practice-attempts-rate-limiter');

test('REL-03: Rate limiter fail-closed rejects paid requests on database failure', async () => {
    // Verify failClosed: true throws 503 RATE_LIMITER_UNAVAILABLE when database is unavailable
    const closedStore = new FirestoreRateLimitStore({ getDb: () => null, prefix: 'azure_speech', failClosed: true });
    closedStore.init({ windowMs: 1000 });
    await assert.rejects(
        async () => { await closedStore.increment('paid-user-123'); },
        (err) => err.code === 'RATE_LIMITER_UNAVAILABLE' && err.status === 503,
        'failClosed limiter must reject requests when database is offline'
    );
});

test('REL-04: Rate limiter distributed decrement and reset execution', async () => {
    const store = new FirestoreRateLimitStore({ getDb: () => null, prefix: 'azure_speech', failClosed: false });
    store.init({ windowMs: 1000 });
    await store.increment('user-456');
    await store.decrement('user-456');
    await store.resetKey('user-456');
    const result = await store.increment('user-456');
    assert.strictEqual(result.totalHits, 1, 'Counter should reset to 1 after resetKey');
});

test('REL-05: Multiple limiter instances share the authoritative counter', async () => {
    const documents = new Map();
    let queue = Promise.resolve();
    const db = {
        collection() {
            return { doc: (id) => ({ id }) };
        },
        runTransaction(work) {
            const run = queue.then(async () => {
                const tx = {
                    async get(ref) {
                        return {
                            exists: documents.has(ref.id),
                            data: () => documents.get(ref.id)
                        };
                    },
                    set(ref, value) { documents.set(ref.id, { ...value }); },
                    update(ref, patch) { documents.set(ref.id, { ...documents.get(ref.id), ...patch }); }
                };
                return work(tx);
            });
            queue = run.catch(() => {});
            return run;
        }
    };
    const first = new FirestoreRateLimitStore({ getDb: () => db, prefix: 'shared', failClosed: true });
    const second = new FirestoreRateLimitStore({ getDb: () => db, prefix: 'shared', failClosed: true });
    first.init({ windowMs: 60_000 });
    second.init({ windowMs: 60_000 });

    const results = await Promise.all([first.increment('uid:student'), second.increment('uid:student')]);
    assert.deepStrictEqual(results.map((result) => result.totalHits).sort(), [1, 2]);
});

test('REL-06: Distributed decrement and reset failures emit diagnostics', async () => {
    const messages = [];
    const originalError = console.error;
    console.error = (...args) => messages.push(args.join(' '));
    try {
        const db = {
            collection() {
                return {
                    doc() {
                        return { delete: async () => { throw new Error('delete unavailable'); } };
                    }
                };
            },
            runTransaction: async () => { throw new Error('transaction unavailable'); }
        };
        const store = new FirestoreRateLimitStore({ getDb: () => db, prefix: 'diagnostic', failClosed: false });
        store.init({ windowMs: 1000 });
        await store.decrement('uid:student');
        await store.resetKey('uid:student');
    } finally {
        console.error = originalError;
    }
    assert.equal(messages.some((message) => message.includes('decrement')), true);
    assert.equal(messages.some((message) => message.includes('reset')), true);
});
