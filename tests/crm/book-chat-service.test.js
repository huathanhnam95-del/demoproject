/* eslint-disable no-console */
const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const chatPath = require.resolve(path.join(ROOT, 'functions/src/crm/book-chat-service.js'));
const retrievalPath = require.resolve(path.join(ROOT, 'functions/src/crm/book-retrieval.js'));
const modelsPath = require.resolve(path.join(ROOT, 'functions/src/geminiVertexModels.js'));
const helpersPath = require.resolve(path.join(ROOT, 'functions/src/assessWriting.helpers.js'));

const originalModules = new Map([
    [chatPath, require.cache[chatPath]],
    [retrievalPath, require.cache[retrievalPath]],
    [modelsPath, require.cache[modelsPath]],
    [helpersPath, require.cache[helpersPath]]
]);

let commitStarted = false;
let commitResolved = false;
let resolveCommit;
let notifyCommitStarted;
const commitStartedPromise = new Promise((resolve) => {
    notifyCommitStarted = resolve;
});
const commitPromise = new Promise((resolve) => {
    resolveCommit = () => {
        commitResolved = true;
        resolve();
    };
});

function fakeModule(filename, exports) {
    require.cache[filename] = {
        id: filename,
        filename,
        loaded: true,
        exports
    };
}

function createRef(id, data) {
    return {
        id,
        get: async () => ({ exists: true, data: () => data }),
        collection(name) {
            assert.strictEqual(name, 'messages');
            return {
                orderBy() {
                    return {
                        limit: () => ({ get: async () => ({ docs: [] }) })
                    };
                },
                doc() {
                    return { id: `message-${Math.random().toString(16).slice(2)}` };
                }
            };
        }
    };
}

function createFakeDb() {
    const bookRef = createRef('book-1', { status: 'ready', title: 'Test Book' });
    const threadRef = createRef('thread-1', { messageCount: 0 });
    bookRef.collection = (name) => {
        assert.strictEqual(name, 'threads');
        return {
            doc: (id) => {
                assert.strictEqual(id, 'thread-1');
                return threadRef;
            }
        };
    };

    const userRef = {
        get: async () => ({
            exists: true,
            data: () => ({
                crmBooksChatStats: {
                    lastDate: new Date().toISOString().split('T')[0],
                    count: 0
                }
            })
        }),
        set: async () => undefined
    };

    return {
        collection(name) {
            if (name === 'crmBooks') return { doc: () => bookRef };
            if (name === 'users') return { doc: () => userRef };
            throw new Error(`Unexpected collection: ${name}`);
        },
        batch() {
            return {
                set() {},
                update() {},
                commit() {
                    commitStarted = true;
                    notifyCommitStarted();
                    return commitPromise;
                }
            };
        }
    };
}

async function run() {
    fakeModule(retrievalPath, {
        retrieveTopChunks: async () => [{
            chunkId: 'chunk-1',
            pageStart: 1,
            pageEnd: 1,
            text: 'A useful excerpt.',
            distance: 0.1,
            strategy: 'bruteforce'
        }]
    });
    fakeModule(modelsPath, {
        getGeminiModel: () => ({ generateContent: async () => ({}) }),
        normalizeScalar: (value) => String(value ?? '').trim(),
        shouldUseGeminiFallback: () => false
    });
    fakeModule(helpersPath, {
        extractGeneratedText: async () => '{"answer":"An answer.","citations":[],"answered":true}',
        extractJsonObject: (value) => JSON.parse(value),
        truncateForLog: (value) => String(value)
    });

    delete require.cache[chatPath];
    const { handleChatMessage } = require(chatPath);
    const responsePromise = handleChatMessage(createFakeDb(), {
        bookId: 'book-1',
        threadId: 'thread-1',
        question: 'What is useful?',
        uid: 'admin-1'
    });

    await commitStartedPromise;
    let settled = false;
    responsePromise.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(commitStarted, true, 'Chat should start the Firestore batch commit.');
    assert.strictEqual(commitResolved, false, 'The controlled commit should still be pending.');
    assert.strictEqual(settled, false, 'Chat must not resolve before the Firestore batch commit.');

    resolveCommit();
    const result = await responsePromise;
    assert.strictEqual(commitResolved, true, 'The Firestore batch commit should resolve before the response.');
    assert.strictEqual(result.assistantMessage.text, 'An answer.');
    console.log('book chat commit durability contract passed');
}

run()
    .catch((error) => {
        console.error(error.stack || error);
        process.exitCode = 1;
    })
    .finally(() => {
        for (const [filename, original] of originalModules) {
            if (original) require.cache[filename] = original;
            else delete require.cache[filename];
        }
        if (!commitResolved) resolveCommit();
    });
