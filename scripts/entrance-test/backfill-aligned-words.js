#!/usr/bin/env node
/**
 * Backfill accurate acoustic word timestamps for entrance test speaking questions
 * using Azure Speech Forced Acoustic Alignment.
 */
const path = require('path');
const fs = require('fs');
const { db, admin } = require('../../src/utils/firebase');
const { alignAudioWithAzure } = require('../../functions/src/entrance-test/asr-service');

const TARGET_TEST_ID = process.argv[2] || '5726ca5178ece2a551cbd2709366e02dcfd73cad19bd3b81d3db4c44ef685740';

async function backfillTest(testId) {
    console.log(`[Backfill] Aligning speaking word timestamps for entrance test: ${testId}`);
    const testRef = db.collection('entranceTests').doc(testId);
    const snap = await testRef.get();
    if (!snap.exists) {
        throw new Error(`Entrance test ${testId} not found in Firestore.`);
    }

    const data = snap.data();
    const speaking = data.speaking || {};
    const updates = {};

    for (const qId of ['speaking_q1', 'speaking_q2', 'speaking_q3']) {
        const qData = speaking[qId];
        if (!qData || !qData.audio || !qData.audio.storagePath) {
            console.log(`[Backfill] Skipping ${qId}: No audio stored.`);
            continue;
        }

        const transcript = String(qData.transcript || '').trim();
        if (!transcript) {
            console.log(`[Backfill] Skipping ${qId}: No transcript.`);
            continue;
        }

        console.log(`\n=== Processing ${qId} ===`);
        console.log(`Transcript: "${transcript.slice(0, 80)}..."`);
        console.log(`Previous words count: ${Array.isArray(qData.words) ? qData.words.length : 0}`);

        const bucket = admin.storage().bucket(qData.audio.bucketName);
        const [audioBuffer] = await bucket.file(qData.audio.storagePath).download();
        console.log(`Downloaded ${audioBuffer.length} bytes from storage.`);

        const alignedWords = await alignAudioWithAzure(audioBuffer, transcript, qData.audio.contentType);
        if (!alignedWords || alignedWords.length === 0) {
            console.warn(`[Backfill] Warning: No aligned words returned for ${qId}.`);
            continue;
        }

        console.log(`Successfully aligned ${alignedWords.length} words via Azure acoustic alignment.`);
        console.log(`First 3 words:`, alignedWords.slice(0, 3));
        console.log(`Last 3 words:`, alignedWords.slice(-3));

        updates[`speaking.${qId}.words`] = alignedWords;
        updates[`speaking.${qId}.wordsAlignedAt`] = admin.firestore.FieldValue.serverTimestamp();
    }

    if (Object.keys(updates).length > 0) {
        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await testRef.update(updates);
        console.log(`\n[Backfill] Successfully updated test ${testId} in Firestore!`);
    } else {
        console.log(`\n[Backfill] No updates needed for test ${testId}.`);
    }
}

backfillTest(TARGET_TEST_ID)
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('[Backfill Error]', err);
        process.exit(1);
    });
