#!/usr/bin/env node
/**
 * Backward scan and rescore for all entrance tests in Firestore since August 1, 2026.
 * Uses Azure Speech Pronunciation Assessment with Oxford American IPA and
 * natural physical articulatory coaching tips.
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

function resolveDate(val) {
    if (!val) return null;
    if (typeof val.toDate === 'function') return val.toDate();
    const dt = new Date(val);
    return isNaN(dt.getTime()) ? null : dt;
}

async function runBackwardScanSinceAugust() {
    console.log(`=============================================================`);
    console.log(`[Backward Scan] Starting rescore of entrance tests since August 1, 2026`);
    console.log(`=============================================================\n`);

    const cutoffDate = new Date('2026-08-01T00:00:00.000Z');
    const snap = await db.collection('entranceTests').get();
    console.log(`[Scan] Loaded ${snap.size} total entrance tests from Firestore.`);

    const targetTests = [];
    snap.forEach((doc) => {
        const d = doc.data();
        const cDate = resolveDate(d.createdAt);
        const sDate = resolveDate(d.submittedAt);
        const stDate = resolveDate(d.startedAt);
        const effectiveDate = sDate || cDate || stDate;

        if (effectiveDate && effectiveDate >= cutoffDate) {
            const sp = d.speaking || {};
            const questionsWithAudio = [];
            for (const [qKey, qVal] of Object.entries(sp)) {
                if (qVal && qVal.audio && qVal.audio.storagePath) {
                    questionsWithAudio.push(qKey);
                }
            }
            if (questionsWithAudio.length > 0) {
                targetTests.push({
                    id: doc.id,
                    date: effectiveDate,
                    speaking: sp,
                    questionsWithAudio
                });
            }
        }
    });

    // Sort newest to oldest (backward scan)
    targetTests.sort((a, b) => b.date - a.date);

    console.log(`[Scan] Found ${targetTests.length} tests with speaking audio to rescore.\n`);

    let totalTestsProcessed = 0;
    let totalQuestionsProcessed = 0;
    let totalQuestionsSuccess = 0;
    let totalQuestionsFailed = 0;
    const failedDetails = [];

    const defaultBucket = admin.storage().bucket();

    for (let i = 0; i < targetTests.length; i++) {
        const test = targetTests[i];
        totalTestsProcessed++;
        console.log(`-------------------------------------------------------------`);
        console.log(`[${i + 1}/${targetTests.length}] Test: ${test.id} (${test.date.toISOString().slice(0, 10)})`);
        console.log(`Questions with audio: ${test.questionsWithAudio.join(', ')}`);

        const testRef = db.collection('entranceTests').doc(test.id);
        const updates = {};

        for (const qId of test.questionsWithAudio) {
            totalQuestionsProcessed++;
            const qData = test.speaking[qId];
            const storagePath = qData.audio.storagePath;
            const contentType = qData.audio.contentType || 'audio/wav';
            const expectedText = getExpectedText(qId, qData);
            const transcript = String(qData.transcript || '').trim();
            const alignTarget = expectedText || transcript;

            if (!alignTarget) {
                console.warn(`  - ${qId}: No expectedText or transcript found. Skipping.`);
                totalQuestionsFailed++;
                failedDetails.push({ testId: test.id, qId, reason: 'missing_target' });
                continue;
            }

            try {
                const bucket = qData.audio.bucketName
                    ? admin.storage().bucket(qData.audio.bucketName)
                    : defaultBucket;

                const [audioBuffer] = await bucket.file(storagePath).download();
                if (!audioBuffer || audioBuffer.length === 0) {
                    throw new Error('Downloaded audio buffer is empty');
                }

                process.stdout.write(`  - ${qId}: Aligning ${audioBuffer.length} bytes against "${alignTarget.slice(0, 40)}..." `);
                const alignedWords = await alignAudioWithAzure(audioBuffer, alignTarget, contentType);

                if (Array.isArray(alignedWords) && alignedWords.length > 0) {
                    updates[`speaking.${qId}.words`] = alignedWords;
                    updates[`speaking.${qId}.wordsAlignedAt`] = admin.firestore.FieldValue.serverTimestamp();
                    totalQuestionsSuccess++;
                    console.log(`-> OK (${alignedWords.length} words aligned)`);
                } else {
                    console.log(`-> NO WORDS ALIGNED`);
                    totalQuestionsFailed++;
                    failedDetails.push({ testId: test.id, qId, reason: 'no_words_aligned' });
                }
            } catch (err) {
                console.log(`-> ERROR: ${err.message}`);
                totalQuestionsFailed++;
                failedDetails.push({ testId: test.id, qId, reason: err.message });
            }
        }

        if (Object.keys(updates).length > 0) {
            updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
            await testRef.update(updates);
            console.log(`  [UPDATED] Firestore document ${test.id} updated.`);
        } else {
            console.log(`  [NO-OP] No updates for ${test.id}.`);
        }
    }

    console.log(`\n=============================================================`);
    console.log(`[Backward Scan Summary]`);
    console.log(`Total tests scanned: ${targetTests.length}`);
    console.log(`Total speaking questions processed: ${totalQuestionsProcessed}`);
    console.log(`Successful question alignments: ${totalQuestionsSuccess}`);
    console.log(`Failed/skipped question alignments: ${totalQuestionsFailed}`);
    if (failedDetails.length > 0) {
        console.log(`Failures:`, JSON.stringify(failedDetails, null, 2));
    }
    console.log(`=============================================================\n`);
}

runBackwardScanSinceAugust()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('[Fatal Error in Backward Scan]', err);
        process.exit(1);
    });
