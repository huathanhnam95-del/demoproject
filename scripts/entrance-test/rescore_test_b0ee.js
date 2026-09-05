#!/usr/bin/env node
/**
 * Re-align and rescore entrance test b0ee5b86c13c42e4d2fd005552f28faf76ed7d4bfc32914d426181f5672ca267
 * in Firestore using Azure Speech Pronunciation Assessment against expectedText.
 */
const fs = require('fs');
const path = require('path');
const { db, admin } = require('../../src/utils/firebase');
const { alignAudioWithAzure } = require('../../functions/src/entrance-test/asr-service');
const { TEST_36PLUS } = require('../../functions/src/entrance-test/test36plus');

const TARGET_TEST_ID = 'b0ee5b86c13c42e4d2fd005552f28faf76ed7d4bfc32914d426181f5672ca267';

function getExpectedText(questionId) {
    const speaking = TEST_36PLUS.sections.find((s) => s.id === 'speaking');
    const q = speaking?.questions?.find((x) => x.id === questionId);
    return q?.expectedText ? String(q.expectedText).trim() : null;
}

async function rescoreTestB0ee() {
    console.log(`[Rescore] Fetching entrance test doc: ${TARGET_TEST_ID}`);
    const testRef = db.collection('entranceTests').doc(TARGET_TEST_ID);
    const snap = await testRef.get();
    if (!snap.exists) {
        throw new Error(`Entrance test ${TARGET_TEST_ID} not found in Firestore.`);
    }

    const data = snap.data();
    const speaking = data.speaking || {};
    const updates = {};
    const verificationResults = {};

    for (const qId of ['speaking_q1', 'speaking_q2', 'speaking_q3']) {
        const qData = speaking[qId];
        if (!qData) {
            console.warn(`[Rescore] No data for ${qId}`);
            continue;
        }

        const expectedText = getExpectedText(qId);
        if (!expectedText) {
            console.warn(`[Rescore] No expectedText for ${qId}`);
            continue;
        }

        console.log(`\n==================================================`);
        console.log(`Processing ${qId}...`);
        console.log(`Expected text: "${expectedText.slice(0, 80)}..."`);

        let audioBuffer = null;
        let contentType = qData.audio?.contentType || 'audio/wav';

        // 1. Try downloading from storage
        if (qData.audio?.storagePath) {
            try {
                const bucketName = qData.audio.bucketName;
                const bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket();
                const [downloaded] = await bucket.file(qData.audio.storagePath).download();
                audioBuffer = downloaded;
                console.log(`Downloaded ${audioBuffer.length} bytes from storage path: ${qData.audio.storagePath}`);
            } catch (storageErr) {
                console.warn(`Storage download failed: ${storageErr.message}. Checking local cache...`);
            }
        }

        // 2. Fallback to local audio cache if storage download failed
        if (!audioBuffer) {
            const localPath = path.resolve(__dirname, 'audio_analysis', 'audit', `b0ee5b86_${qId}.wav`);
            if (fs.existsSync(localPath)) {
                audioBuffer = fs.readFileSync(localPath);
                contentType = 'audio/wav';
                console.log(`Loaded ${audioBuffer.length} bytes from local path: ${localPath}`);
            }
        }

        if (!audioBuffer) {
            throw new Error(`Could not obtain audio buffer for ${qId}`);
        }

        console.log(`Aligning with Azure against expectedText...`);
        const alignedWords = await alignAudioWithAzure(audioBuffer, expectedText, contentType);
        if (!alignedWords || alignedWords.length === 0) {
            throw new Error(`Azure alignment returned no words for ${qId}`);
        }

        console.log(`Successfully aligned ${alignedWords.length} words.`);
        updates[`speaking.${qId}.words`] = alignedWords;
        updates[`speaking.${qId}.wordsAlignedAt`] = admin.firestore.FieldValue.serverTimestamp();

        verificationResults[qId] = alignedWords;
    }

    if (Object.keys(updates).length > 0) {
        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await testRef.update(updates);
        console.log(`\n[OK] Successfully updated Firestore document ${TARGET_TEST_ID}!`);
    }

    // Verify written data from Firestore
    console.log(`\n==================================================`);
    console.log(`Verifying updated document from Firestore...`);
    const updatedSnap = await testRef.get();
    const updatedData = updatedSnap.data();

    // Verify Q1 "get"
    const q1Words = updatedData.speaking?.speaking_q1?.words || [];
    const getWord = q1Words.find((w) => w.word.toLowerCase() === 'get');
    console.log(`\n[Q1 Check] "get" token:`, getWord);
    if (!getWord) {
        throw new Error(`FATAL: "get" was not found in Q1 words!`);
    }
    if (getWord.accuracyScore < 80) {
        throw new Error(`FATAL: "get" accuracyScore is too low: ${getWord.accuracyScore}`);
    }
    console.log(`[Q1 PASS] "get" is restored with accuracy ${getWord.accuracyScore}% (>= 80% -> green)!`);

    // Verify Q2 "accurately"
    const q2Words = updatedData.speaking?.speaking_q2?.words || [];
    const accWord = q2Words.find((w) => w.word.toLowerCase() === 'accurately');
    console.log(`\n[Q2 Check] "accurately" token:`, accWord);
    if (!accWord) {
        throw new Error(`FATAL: "accurately" was not found in Q2 words!`);
    }
    if (accWord.accuracyScore >= 60 && accWord.errorType !== 'Mispronunciation') {
        throw new Error(`FATAL: "accurately" was expected to be < 60 or Mispronunciation, got: ${accWord.accuracyScore}, ${accWord.errorType}`);
    }
    console.log(`[Q2 PASS] "accurately" has accuracy ${accWord.accuracyScore}% and errorType "${accWord.errorType}" (< 60 / Mispronunciation -> red)!`);

    // Verify Q2 syllables
    if (!Array.isArray(accWord.syllables) || accWord.syllables.length !== 4) {
        throw new Error(`FATAL: "accurately" must have 4 syllables, got: ${JSON.stringify(accWord.syllables)}`);
    }
    const [acSyl, cuSyl, rateSyl] = accWord.syllables;
    if (acSyl.diagnosis && acSyl.diagnosis.match(/\(\/ə\/ instead of \/æ\/\).*—.*\/ə\/ instead of \/æ\//)) {
        throw new Error(`FATAL: "ac" diagnosis duplicated substitution in observation: ${acSyl.diagnosis}`);
    }
    if ((cuSyl.diagnosis && cuSyl.diagnosis.includes('Vowel was pronounced as /k/')) ||
        (rateSyl.diagnosis && rateSyl.diagnosis.includes('Vowel was pronounced as /l/'))) {
        throw new Error(`FATAL: Inappropriate "Vowel was pronounced as [consonant]" detected in accurately: ${cuSyl.diagnosis} | ${rateSyl.diagnosis}`);
    }
    const indWord = q2Words.find((w) => w.word.toLowerCase() === 'indicators');
    if (!indWord || !Array.isArray(indWord.syllables) || indWord.syllables.length < 3) {
        throw new Error(`FATAL: "indicators" must have multi-syllables, got: ${JSON.stringify(indWord?.syllables)}`);
    }
    console.log(`[Q2 PASS] "accurately" (4 syllables) and "indicators" (${indWord.syllables.length} syllables) verified!`);

    // Verify Q1 "after" syllables and coaching tips
    const afterWord = q1Words.find((w) => w.word.toLowerCase() === 'after');
    console.log(`\n[Q1 Check] "after" token:`, afterWord);
    if (!afterWord || !Array.isArray(afterWord.syllables) || afterWord.syllables.length !== 2) {
        throw new Error(`FATAL: "after" must have 2 syllables in Q1!`);
    }
    const [afSyl, terSyl] = afterWord.syllables;
    console.log('[Q1 Check] "af" syllable:', afSyl);
    console.log('[Q1 Check] "ter" syllable:', terSyl);
    if (!afSyl.diagnosis || !afSyl.tip) {
        throw new Error(`FATAL: "af" must have both diagnosis and tip! Got: ${JSON.stringify(afSyl)}`);
    }
    if (!afSyl.tip.toLowerCase().includes('upper teeth') && !afSyl.tip.toLowerCase().includes('lip')) {
        throw new Error(`FATAL: "af" tip should have physical lip/teeth cue! Got: ${afSyl.tip}`);
    }
    if (terSyl.ipa.includes('ɚ') || terSyl.ipa.includes('ɹ')) {
        throw new Error(`FATAL: "ter" ipa must be normalized Oxford American IPA (/tər/), got: ${terSyl.ipa}`);
    }
    if (!terSyl.diagnosis || !terSyl.tip) {
        throw new Error(`FATAL: "ter" must have both diagnosis and tip! Got: ${JSON.stringify(terSyl)}`);
    }
    console.log(`[Q1 PASS] "after" syllables ("af", "ter") have natural coaching tips and Oxford American IPA!`);

    // Verify Q1 "data" syllables ("da", "ta") - key user requirement
    const dataWord = q1Words.find((w) => w.word.toLowerCase() === 'data');
    console.log(`\n[Q1 Check] "data" token:`, dataWord);
    if (!dataWord || !Array.isArray(dataWord.syllables) || dataWord.syllables.length !== 2) {
        throw new Error(`FATAL: "data" must have 2 syllables in Q1!`);
    }
    const [daSyl, taSyl] = dataWord.syllables;
    console.log('[Q1 Check] "da" syllable:', daSyl);
    console.log('[Q1 Check] "ta" syllable:', taSyl);
    if (!daSyl.diagnosis || !daSyl.tip) {
        throw new Error(`FATAL: "da" must have both diagnosis and tip! Got: ${JSON.stringify(daSyl)}`);
    }
    if (daSyl.diagnosis.includes('ɹ') || daSyl.diagnosis.includes('ɚ')) {
        throw new Error(`FATAL: "da" contains un-normalized IPA! Got: ${daSyl.diagnosis}`);
    }
    if (!taSyl.diagnosis || !taSyl.tip) {
        throw new Error(`FATAL: "ta" must have both diagnosis and tip! Got: ${JSON.stringify(taSyl)}`);
    }
    if (taSyl.heardIpa && (taSyl.heardIpa.includes('ɹ') || taSyl.heardIpa.includes('ɚ'))) {
        throw new Error(`FATAL: "ta" heardIpa contains un-normalized IPA: ${taSyl.heardIpa}`);
    }
    if (taSyl.diagnosis.includes('ɹ') || taSyl.diagnosis.includes('ɚ')) {
        throw new Error(`FATAL: "ta" diagnosis contains un-normalized IPA: ${taSyl.diagnosis}`);
    }
    if (!taSyl.diagnosis.includes('/tr/')) {
        throw new Error(`FATAL: "ta" diagnosis must contain Oxford American /tr/! Got: ${taSyl.diagnosis}`);
    }
    if (taSyl.diagnosis.includes('— Sounded like') || taSyl.diagnosis.match(/\(\/r\/ instead of \/ə\/\).*—.*\/r\/ instead of \/ə\//)) {
        throw new Error(`FATAL: "ta" diagnosis has redundant repetition: ${taSyl.diagnosis}`);
    }
    console.log(`[Q1 PASS] "data" syllables ("da", "ta") verified with Oxford American IPA and clean coaching tips!`);

    // Verify Q3
    const q3Words = updatedData.speaking?.speaking_q3?.words || [];
    console.log(`\n[Q3 Check] Q3 has ${q3Words.length} aligned words.`);
    const entersWord = q3Words.find((w) => w.word.toLowerCase() === 'enters');
    if (entersWord && entersWord.syllables) {
        const tersSyl = entersWord.syllables.find(s => s.text === 'ters');
        if (tersSyl && tersSyl.diagnosis && tersSyl.diagnosis.includes('/ər/ instead of /ər/')) {
            throw new Error(`FATAL: "enters" -> "ters" contains spurious "/ər/ instead of /ər/": ${tersSyl.diagnosis}`);
        }
        console.log(`[Q3 PASS] "enters" -> "ters" free of spurious "/ər/ instead of /ər/"!`);
    }

    console.log(`\nAll Firestore verification assertions PASSED successfully!`);
}

rescoreTestB0ee()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('[Rescore Fatal Error]', err);
        process.exit(1);
    });
