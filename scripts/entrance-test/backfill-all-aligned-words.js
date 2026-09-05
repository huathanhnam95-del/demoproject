#!/usr/bin/env node
/**
 * Batch backfill accurate acoustic word timestamps for ALL entrance test speaking questions
 * in Firestore using Azure Speech Forced Acoustic Alignment.
 */
const { db, admin } = require('../../src/utils/firebase');
const { alignAudioWithAzure } = require('../../functions/src/entrance-test/asr-service');
const { TEST_36PLUS } = require('../../functions/src/entrance-test/test36plus');

function getExpectedText(questionId, entry = null) {
    if (entry?.expectedText && String(entry.expectedText).trim()) {
        return String(entry.expectedText).trim();
    }
    const speaking = TEST_36PLUS.sections.find((s) => s.id === 'speaking');
    const cleanId = String(questionId || '').trim();
    const promptNum = cleanId.replace(/^speaking_q?|^q/, '');
    const q = speaking?.questions?.find((x) => (
        x.id === cleanId
        || x.id === `speaking_${cleanId}`
        || (promptNum && String(x.promptNumber) === promptNum)
    ));
    return q?.expectedText ? String(q.expectedText).trim() : null;
}

async function backfillAllTests({ limit = 50 } = {}) {
    const force = process.argv.includes('--force') || process.argv.includes('-f');
    console.log(`[Batch Backfill] Querying entrance tests needing word timestamp alignment (force=${force})...`);
    const snap = await db.collection('entranceTests').get();
    console.log(`Found ${snap.size} total entrance tests in Firestore.`);

    const testsToProcess = [];
    snap.forEach((doc) => {
        const d = doc.data();
        const sp = d.speaking || {};
        const hasAudio = Object.values(sp).some((q) => q.audio && q.audio.storagePath);
        const hasWordsWithScores = Object.values(sp).some((q) => Array.isArray(q.words) && q.words.length > 0 && q.words.some(w => w.accuracyScore != null));
        if (hasAudio && (!hasWordsWithScores || force)) {
            testsToProcess.push({ id: doc.id, speaking: sp });
        }
    });

    console.log(`[Batch Backfill] Found ${testsToProcess.length} tests with audio missing word timings.`);
    const batch = testsToProcess.slice(0, limit);
    console.log(`[Batch Backfill] Processing ${batch.length} tests in this run...`);

    let processedCount = 0;
    let successCount = 0;
    let failCount = 0;

    for (const item of batch) {
        processedCount++;
        console.log(`\n--------------------------------------------------`);
        console.log(`[${processedCount}/${batch.length}] Processing test: ${item.id}`);
        const testRef = db.collection('entranceTests').doc(item.id);
        const updates = {};

        for (const qId of ['speaking_q1', 'speaking_q2', 'speaking_q3']) {
            const qData = item.speaking[qId];
            if (!qData || !qData.audio || !qData.audio.storagePath) continue;

            const expectedText = getExpectedText(qId, qData);
            const transcript = String(qData.transcript || '').trim();
            const alignTarget = expectedText || transcript;
            if (!alignTarget) continue;

            try {
                const bucket = admin.storage().bucket(qData.audio.bucketName);
                const [audioBuffer] = await bucket.file(qData.audio.storagePath).download();
                const alignedWords = await alignAudioWithAzure(audioBuffer, alignTarget, qData.audio.contentType);

                if (Array.isArray(alignedWords) && alignedWords.length > 0) {
                    updates[`speaking.${qId}.words`] = alignedWords;
                    updates[`speaking.${qId}.wordsAlignedAt`] = admin.firestore.FieldValue.serverTimestamp();
                    console.log(`  -> ${qId}: Aligned ${alignedWords.length} words`);
                } else {
                    console.warn(`  -> ${qId}: No words aligned`);
                }
            } catch (err) {
                console.error(`  -> ${qId} Error:`, err.message);
            }
        }

        if (Object.keys(updates).length > 0) {
            updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
            await testRef.update(updates);
            successCount++;
            console.log(`  [OK] Updated Firestore for ${item.id}`);
        } else {
            failCount++;
            console.log(`  [SKIP] No updates made for ${item.id}`);
        }
    }

    console.log(`\n==================================================`);
    console.log(`Batch backfill completed!`);
    console.log(`Processed: ${processedCount}, Success: ${successCount}, Skipped/Failed: ${failCount}`);
    console.log(`==================================================\n`);
}

const limitArg = parseInt(process.argv[2], 10) || 50;
backfillAllTests({ limit: limitArg })
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('[Batch Backfill Fatal Error]', err);
        process.exit(1);
    });
