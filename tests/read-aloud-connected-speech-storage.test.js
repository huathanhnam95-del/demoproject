/* eslint-disable no-console */
const assert = require('assert');
const path = require('path');

(async () => {
  const firebasePath = path.join(process.cwd(), 'src/utils/firebase.js');
  const storagePath = path.join(process.cwd(), 'src/read-aloud/connected-speech-storage.js');
  const originalFirebase = require.cache[firebasePath];
  const originalStorage = require.cache[storagePath];

  let collectionName = '';
  let docId = '';
  let writtenPayload = null;

  require.cache[firebasePath] = {
    id: firebasePath,
    filename: firebasePath,
    loaded: true,
    exports: {
      admin: {
        firestore: {
          FieldValue: {
            serverTimestamp: () => new Date('2026-03-26T00:00:00.000Z')
          }
        }
      },
      db: {
        collection(name) {
          collectionName = name;
          return {
            doc(id) {
              docId = id || 'generated-id';
              return {
                async set(payload) {
                  writtenPayload = payload;
                }
              };
            }
          };
        }
      },
      getStorageBucket: async () => null
    }
  };

  delete require.cache[storagePath];
  const storage = require(storagePath);

  try {
    const result = await storage.persistConnectedSpeechAttempt({
      attemptId: 'attempt-1',
      questionId: '42',
      referenceText: 'Did you see it?',
      recognizedText: 'Did you see it?',
      clientContext: {
        guideLevel: 'v3_sound_changes'
      },
      requestedAlignmentMode: 'shadow_mfa',
      scoringMode: 'heuristic',
      connectedSpeechPrimarySource: 'heuristic',
      alignmentFallbackReason: 'mfa_unavailable'
    });

    assert.strictEqual(result.status, 'complete', 'persistConnectedSpeechAttempt should use the default Firebase db');
    assert.strictEqual(collectionName, 'readAloudConnectedSpeechAttempts', 'storage should write to the connected speech attempts collection');
    assert.strictEqual(docId, 'attempt-1', 'storage should preserve the supplied attempt id');
    assert.strictEqual(writtenPayload.questionId, '42', 'storage should persist the question id');
    assert.deepStrictEqual(writtenPayload.clientContext, { guideLevel: 'v3_sound_changes' }, 'storage should persist client context');
    assert.strictEqual(writtenPayload.requestedAlignmentMode, 'shadow_mfa', 'storage should persist requested alignment mode');
    assert.strictEqual(writtenPayload.scoringMode, 'heuristic', 'storage should persist scoring mode');
    assert.strictEqual(writtenPayload.connectedSpeechPrimarySource, 'heuristic', 'storage should persist the primary source');
    assert.strictEqual(writtenPayload.alignmentFallbackReason, 'mfa_unavailable', 'storage should persist the fallback reason');
  } finally {
    if (originalFirebase) {
      require.cache[firebasePath] = originalFirebase;
    } else {
      delete require.cache[firebasePath];
    }
    if (originalStorage) {
      require.cache[storagePath] = originalStorage;
    } else {
      delete require.cache[storagePath];
    }
  }

  console.log('read-aloud connected speech storage tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
