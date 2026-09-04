/**
 * backfill-entrance-test-word-timestamps.js
 *
 * Extracts word-level audio timestamps using Whisper for speaking questions
 * in entrance tests and persists `speaking.<qId>.words` to Firestore.
 *
 * Usage:
 *   node scripts/crm/backfill-entrance-test-word-timestamps.js [testId]
 */

const path = require('path');
const https = require('https');
const axios = require(path.resolve(__dirname, '..', '..', 'functions', 'node_modules', 'axios'));
const { db, admin } = require(path.resolve(__dirname, '..', '..', 'src', 'utils', 'firebase'));
const { getHuggingFaceApiKey, extractWordsFromChunks } = require(path.resolve(__dirname, '..', '..', 'functions', 'src', 'entrance-test', 'asr-service'));

const DEFAULT_TEST_ID = '5726ca5178ece2a551cbd2709366e02dcfd73cad19bd3b81d3db4c44ef685740';

async function backfillTest(testId) {
    console.log(`[Backfill] Starting word timestamps backfill for test: ${testId}`);
    const hfKey = getHuggingFaceApiKey();
    if (!hfKey) {
        throw new Error('HUGGINGFACE_API_KEY is not configured in .env or environment.');
    }

    const testRef = db.collection('entranceTests').doc(testId);
    const snap = await testRef.get();
    if (!snap.exists) {
        throw new Error(`Entrance test document ${testId} does not exist in entranceTests collection.`);
    }

    const testData = snap.data() || {};
    const speaking = testData.speaking || {};
    const questionIds = Object.keys(speaking);

    if (questionIds.length === 0) {
        console.log('[Backfill] No speaking answers found in test.');
        return;
    }

    const model = process.env.HUGGINGFACE_ASR_MODEL || 'openai/whisper-large-v3';
    const url = `https://router.huggingface.co/hf-inference/models/${model}`;
    const updates = {};

    for (const qId of questionIds) {
        const entry = speaking[qId];
        const storagePath = entry?.audio?.storagePath;
        const bucketName = entry?.audio?.bucketName;
        if (!storagePath) {
            console.warn(`[Backfill] Skipping ${qId}: missing audio storagePath`);
            continue;
        }

        console.log(`[Backfill] Processing ${qId}...`);
        const bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket();
        const [audioBuffer] = await bucket.file(storagePath).download();
        console.log(`[Backfill] Downloaded audio for ${qId} (${audioBuffer.length} bytes)`);

        const res = await axios({
            method: 'POST',
            url,
            headers: {
                Authorization: `Bearer ${hfKey}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'User-Agent': 'Mozilla/5.0'
            },
            httpsAgent: new https.Agent({ family: 4 }),
            data: {
                inputs: audioBuffer.toString('base64'),
                parameters: {
                    return_timestamps: 'word',
                    generate_kwargs: { language: 'english' }
                }
            },
            timeout: 60000,
            validateStatus: () => true
        });

        if (res.status !== 200 || !res.data) {
            console.warn(`[Backfill] Whisper request failed for ${qId} with status ${res.status}:`, res.data?.error || res.data);
            continue;
        }

        const chunks = Array.isArray(res.data.chunks) ? res.data.chunks : [];
        const words = extractWordsFromChunks(chunks);
        console.log(`[Backfill] Extracted ${words.length} words with timestamps for ${qId}`);

        if (words.length > 0) {
            updates[`speaking.${qId}.words`] = words;
        }
    }

    if (Object.keys(updates).length > 0) {
        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await testRef.update(updates);
        console.log(`[Backfill] Successfully updated Firestore with words for:`, Object.keys(updates));
    } else {
        console.log('[Backfill] No updates written.');
    }
}

const targetTestId = process.argv[2] || DEFAULT_TEST_ID;
backfillTest(targetTestId)
    .then(() => {
        console.log('[Backfill] Completed successfully.');
        process.exit(0);
    })
    .catch((err) => {
        console.error('[Backfill Error]', err);
        process.exit(1);
    });
