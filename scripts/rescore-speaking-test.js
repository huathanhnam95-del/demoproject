/**
 * rescore-speaking-test.js
 *
 * Re-transcribes and rescores speaking questions of an entrance test
 * using the Gemini ASR service and updates Firestore.
 *
 * Usage:
 *   node scripts/rescore-speaking-test.js [testId]
 */

const path = require('path');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

// Bootstrap Firebase
const { db, getStorageBucket, admin } = require(path.resolve(__dirname, '..', 'src', 'utils', 'firebase'));
const { computeWordAccuracyPercent, TEST_36PLUS } = require(path.resolve(__dirname, '..', 'functions', 'src', 'entrance-test', 'test36plus'));
const { transcribeAudio } = require(path.resolve(__dirname, '..', 'functions', 'src', 'entrance-test', 'asr-service'));

const DEFAULT_TEST_ID = '5726ca5178ece2a551cbd2709366e02dcfd73cad19bd3b81d3db4c44ef685740';

function getSpeakingQuestionExpectedText(questionId) {
    const speaking = TEST_36PLUS.sections.find((s) => s.id === 'speaking');
    const q = speaking?.questions?.find((x) => x.id === questionId) || null;
    return q?.expectedText || null;
}

async function rescoreSpeaking(testId = DEFAULT_TEST_ID) {
    console.log(`\n======================================================`);
    console.log(`[Rescore] Processing entrance test: ${testId}`);
    console.log(`======================================================\n`);

    const testRef = db.collection('entranceTests').doc(testId);
    const snap = await testRef.get();
    if (!snap.exists) {
        throw new Error(`Entrance test ${testId} not found in Firestore.`);
    }

    const testData = snap.data() || {};
    const speaking = testData.speaking && typeof testData.speaking === 'object' ? testData.speaking : {};
    const questionIds = Object.keys(speaking).sort();

    if (questionIds.length === 0) {
        console.log('No speaking questions found on this test.');
        return;
    }

    const bucket = await getStorageBucket();
    const updatePayload = {};

    for (const qId of questionIds) {
        const item = speaking[qId] || {};
        const storagePath = item.audio?.storagePath;
        const contentType = item.audio?.contentType || 'audio/webm';
        const expectedText = getSpeakingQuestionExpectedText(qId);

        console.log(`\n--- Question: ${qId} ---`);
        console.log(`OLD Transcript: ${JSON.stringify(item.transcript?.slice(0, 100))}...`);
        console.log(`OLD Accuracy: ${item.accuracyPercent}%`);
        console.log(`OLD Distance: ${item.distance}`);

        if (!storagePath) {
            console.warn(`[SKIP] No audio storagePath for ${qId}`);
            continue;
        }

        console.log(`Downloading audio from ${storagePath}...`);
        const [audioBuffer] = await bucket.file(storagePath).download();
        console.log(`Downloaded ${audioBuffer.length} bytes. Transcribing with Gemini...`);

        const newTranscript = await transcribeAudio(audioBuffer, contentType, { expectedText });
        const accuracy = expectedText ? computeWordAccuracyPercent(expectedText, newTranscript) : null;

        console.log(`NEW Transcript: "${newTranscript}"`);
        console.log(`NEW Accuracy: ${accuracy?.percent ?? 'N/A'}% (Expected: ${accuracy?.expectedCount}, Got: ${accuracy?.transcriptCount}, Distance: ${accuracy?.distance})`);

        updatePayload[`speaking.${qId}.transcript`] = newTranscript;
        updatePayload[`speaking.${qId}.accuracyPercent`] = accuracy?.percent ?? null;
        updatePayload[`speaking.${qId}.expectedCount`] = accuracy?.expectedCount ?? null;
        updatePayload[`speaking.${qId}.transcriptCount`] = accuracy?.transcriptCount ?? null;
        updatePayload[`speaking.${qId}.distance`] = accuracy?.distance ?? null;
        updatePayload[`speaking.${qId}.asrError`] = null;
        updatePayload[`speaking.${qId}.asrRetriedAt`] = admin.firestore.FieldValue.serverTimestamp();
    }

    updatePayload.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    console.log(`\nUpdating Firestore document for test ${testId}...`);
    await testRef.update(updatePayload);
    console.log(`[SUCCESS] Firestore document successfully updated!\n`);
}

const targetTestId = process.argv[2] || DEFAULT_TEST_ID;
rescoreSpeaking(targetTestId)
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('\n[FATAL ERROR]:', err);
        process.exit(1);
    });
