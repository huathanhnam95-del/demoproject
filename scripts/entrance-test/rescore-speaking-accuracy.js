#!/usr/bin/env node
/**
 * Rescore entrance test speaking accuracy in Firestore using Azure Speech
 * Pronunciation Assessment data (or word-level acoustic scores).
 *
 * Usage:
 *   node scripts/entrance-test/rescore-speaking-accuracy.js [optionalTestId]
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

function computeWordAcousticAverage(words) {
    if (!Array.isArray(words) || words.length === 0) return null;
    const validScores = words
        .map((w) => (typeof w === 'object' && w != null && Number.isFinite(Number(w.accuracyScore))) ? Number(w.accuracyScore) : null)
        .filter((n) => n !== null);
    if (validScores.length === 0) return null;
    return Math.round((validScores.reduce((a, b) => a + b, 0) / validScores.length) * 10) / 10;
}

async function runRescore(specificTestId = null) {
    console.log('=============================================================');
    console.log('[Rescore] Starting speaking pronunciation accuracy update');
    if (specificTestId) {
        console.log(`[Rescore] Targeting single test: ${specificTestId}`);
    } else {
        console.log('[Rescore] Scanning entrance tests since August 1, 2026');
    }
    console.log('=============================================================\n');

    let targetDocs = [];
    if (specificTestId) {
        const docSnap = await db.collection('entranceTests').doc(specificTestId).get();
        if (!docSnap.exists) {
            throw new Error(`Test ${specificTestId} not found.`);
        }
        targetDocs.push({ id: docSnap.id, data: docSnap.data() });
    } else {
        const cutoffDate = new Date('2026-08-01T00:00:00.000Z');
        const snap = await db.collection('entranceTests').get();
        console.log(`[Scan] Found ${snap.size} total entrance tests in Firestore.`);

        snap.forEach((doc) => {
            const d = doc.data();
            const cDate = resolveDate(d.createdAt);
            const sDate = resolveDate(d.submittedAt);
            const stDate = resolveDate(d.startedAt);
            const effectiveDate = sDate || cDate || stDate;

            if (effectiveDate && effectiveDate >= cutoffDate && d.speaking && typeof d.speaking === 'object') {
                targetDocs.push({ id: doc.id, data: d, date: effectiveDate });
            }
        });
        targetDocs.sort((a, b) => (b.date || 0) - (a.date || 0));
    }

    console.log(`[Scan] Processing ${targetDocs.length} tests.\n`);

    const defaultBucket = admin.storage().bucket();
    let totalUpdated = 0;

    for (let i = 0; i < targetDocs.length; i++) {
        const item = targetDocs[i];
        const testId = item.id;
        const testData = item.data;
        const speaking = testData.speaking || {};
        const qKeys = Object.keys(speaking).sort();

        console.log(`[${i + 1}/${targetDocs.length}] Test ${testId}`);
        const updates = {};
        let changedAny = false;

        for (const qId of qKeys) {
            const qData = speaking[qId];
            if (!qData) continue;

            const oldAcc = qData.accuracyPercent;
            let newAcc = null;
            let words = qData.words;

            // 1. If words already exist with accuracy scores, compute from words
            if (Array.isArray(words) && words.length > 0) {
                newAcc = computeWordAcousticAverage(words);
            }

            // 2. If words are missing but audio exists, align with Azure
            if (newAcc == null && qData.audio?.storagePath) {
                const expectedText = getExpectedText(qId, qData);
                const transcript = String(qData.transcript || '').trim();
                const alignTarget = expectedText || transcript;

                if (alignTarget) {
                    try {
                        const bucket = qData.audio.bucketName
                            ? admin.storage().bucket(qData.audio.bucketName)
                            : defaultBucket;
                        const [audioBuffer] = await bucket.file(qData.audio.storagePath).download();
                        const contentType = qData.audio.contentType || 'audio/wav';
                        words = await alignAudioWithAzure(audioBuffer, alignTarget, contentType);
                        if (Array.isArray(words) && words.length > 0) {
                            newAcc = words.accuracyScore != null ? words.accuracyScore : computeWordAcousticAverage(words);
                            updates[`speaking.${qId}.words`] = words;
                            updates[`speaking.${qId}.wordsAlignedAt`] = admin.firestore.FieldValue.serverTimestamp();
                            if (!qData.transcript) {
                                updates[`speaking.${qId}.transcript`] = words.recognizedText || alignTarget;
                            }
                            if (qData.asrError) {
                                updates[`speaking.${qId}.asrError`] = null;
                            }
                        }
                    } catch (alignErr) {
                        console.warn(`  - ${qId} Azure alignment failed:`, alignErr.message);
                    }
                }
            }

            if (newAcc != null && newAcc !== oldAcc) {
                updates[`speaking.${qId}.accuracyPercent`] = newAcc;
                updates[`speaking.${qId}.accuracyScore`] = newAcc;
                if (qData.wordMatchAccuracy === undefined && oldAcc != null) {
                    updates[`speaking.${qId}.wordMatchAccuracy`] = oldAcc;
                }
                changedAny = true;
                console.log(`  - ${qId}: Accuracy updated from ${oldAcc}% -> ${newAcc}% (acoustic pronunciation score)`);
            } else {
                console.log(`  - ${qId}: Current accuracy ${oldAcc}% (new: ${newAcc ?? 'N/A'}%)`);
            }
        }

        if (changedAny && Object.keys(updates).length > 0) {
            updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
            await db.collection('entranceTests').doc(testId).update(updates);
            totalUpdated++;
            console.log(`  -> Firestore document ${testId} UPDATED.\n`);
        } else {
            console.log(`  -> No changes needed.\n`);
        }
    }

    console.log('=============================================================');
    console.log(`[Summary] Tests processed: ${targetDocs.length}, Tests updated: ${totalUpdated}`);
    console.log('=============================================================\n');
}

const argId = process.argv[2] ? String(process.argv[2]).trim() : null;
runRescore(argId)
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('[Fatal Error]', err);
        process.exit(1);
    });
