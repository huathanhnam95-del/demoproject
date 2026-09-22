'use strict';

/**
 * Continuous Assessment Service (Phase 4: Read Aloud & Repeat Sentence)
 * Handles forced-alignment pronunciation assessment against fixed server-resolved reference passages.
 * Integrates Azure normalizer (P1) and ending-safe word clip policy (P3).
 */

const { normalizeFinalResult } = require('./normalize');
const { resolveWordClipTiming } = require('./word-clip-policy');
const {
  getAzureSpeechCredentials,
  buildPronunciationAssessmentHeader
} = require('../pronunciation-assessment-service');

/**
 * Computes deterministic sequence comparison between reference tokens and recognized tokens.
 * Identifies matched, omitted, and inserted words preserving order per §9.3.
 */
function computeReferenceComparison(referenceText, words = []) {
  const cleanTokens = text => String(text || '')
    .toLowerCase()
    .replace(/[—–]/g, ' ')
    .replace(/[.,;:!?\u2019'"“”…()[\]{}]/g, '')
    .split(/\s+/)
    .filter(Boolean);

  const refTokens = cleanTokens(referenceText);

  const recognizedTokens = words
    .filter(w => w.errorType !== 'Omission')
    .flatMap(w => cleanTokens(w.word));

  let refIdx = 0;
  let recIdx = 0;
  let matchedCount = 0;
  const matchedWords = [];
  const omittedWords = [];
  const insertedWords = [];

  while (refIdx < refTokens.length && recIdx < recognizedTokens.length) {
    if (refTokens[refIdx] === recognizedTokens[recIdx]) {
      matchedWords.push(refTokens[refIdx]);
      matchedCount++;
      refIdx++;
      recIdx++;
    } else {
      // Look ahead to find if current reference token appears later
      const lookaheadRec = recognizedTokens.indexOf(refTokens[refIdx], recIdx);
      const lookaheadRef = refTokens.indexOf(recognizedTokens[recIdx], refIdx);

      if (lookaheadRec !== -1 && (lookaheadRef === -1 || lookaheadRec - recIdx <= lookaheadRef - refIdx)) {
        // Words were inserted before next match
        while (recIdx < lookaheadRec) {
          insertedWords.push(recognizedTokens[recIdx++]);
        }
      } else {
        // Current reference word was omitted
        omittedWords.push(refTokens[refIdx++]);
      }
    }
  }

  while (refIdx < refTokens.length) {
    omittedWords.push(refTokens[refIdx++]);
  }
  while (recIdx < recognizedTokens.length) {
    insertedWords.push(recognizedTokens[recIdx++]);
  }

  const completenessRatio = refTokens.length > 0 ? (matchedCount / refTokens.length) : 1.0;
  const completenessScore = Math.round(completenessRatio * 100);

  return {
    source: 'bel_reference_comparison',
    totalReferenceTokens: refTokens.length,
    matchedCount,
    omittedCount: omittedWords.length,
    insertedCount: insertedWords.length,
    matchedWords,
    omittedWords,
    insertedWords,
    completenessRatio,
    completenessScore
  };
}

/**
 * Assesses a fixed-reference speaking attempt (Read Aloud or Repeat Sentence).
 * 
 * @param {Object} params
 * @param {'read_aloud'|'repeat_sentence'} params.mode
 * @param {string} params.referenceText
 * @param {Buffer} params.audioBuffer
 * @param {Object} [params.audioIdentity] - { sampleRateHz, sampleCount }
 * @param {string} [params.attemptId]
 * @param {Object} [deps] - Optional test injection dependencies
 */
async function assessFixedReference({ mode, referenceText, audioBuffer, audioIdentity = null, attemptId = null }, deps = {}) {
  if (!referenceText || typeof referenceText !== 'string') {
    throw new TypeError('REFERENCE_TEXT_REQUIRED');
  }
  if (!audioBuffer || !Buffer.isBuffer(audioBuffer)) {
    throw new TypeError('VALID_AUDIO_BUFFER_REQUIRED');
  }

  const credentials = deps.credentials || getAzureSpeechCredentials();
  const pronHeader = buildPronunciationAssessmentHeader(referenceText);

  let rawAzureResult = null;

  if (credentials?.key && !deps.useMock) {
    const endpoint = `https://${credentials.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US`;
    const fetchFn = deps.fetch || globalThis.fetch;
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': credentials.key,
        'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
        'Pronunciation-Assessment': pronHeader,
        'Accept': 'application/json'
      },
      body: audioBuffer
    });

    if (!response.ok) {
      const err = new Error(`AZURE_SPEECH_ERROR_${response.status}`);
      err.status = response.status;
      throw err;
    }
    rawAzureResult = await response.json();
  } else {
    // Deterministic mock fallback for tests and development without live Azure credentials
    const wordsList = referenceText.trim().split(/\s+/).filter(Boolean);
    const audioMs = (audioIdentity?.sampleCount && audioIdentity?.sampleRateHz)
      ? (audioIdentity.sampleCount / audioIdentity.sampleRateHz) * 1000
      : (audioBuffer ? (audioBuffer.length / (2 * (audioIdentity?.sampleRateHz || 16000))) * 1000 : 3000);
    const stepMs = Math.max(50, Math.floor((audioMs - 50) / Math.max(1, wordsList.length)));
    const durationMs = Math.max(40, Math.floor(stepMs * 0.8));
    const stepTicks = stepMs * 10000;
    const durationTicks = durationMs * 10000;

    rawAzureResult = deps.mockResult || {
      RecognitionStatus: 'Success',
      DisplayText: referenceText,
      NBest: [{
        Confidence: 0.95,
        AccuracyScore: 88,
        FluencyScore: 85,
        CompletenessScore: 90,
        PronScore: 87,
        Words: wordsList.map((w, i) => ({
          Word: w,
          Offset: i * stepTicks,
          Duration: durationTicks,
          Confidence: 0.95,
          AccuracyScore: 88,
          Syllables: [{
            Syllable: w,
            Offset: i * stepTicks,
            Duration: durationTicks,
            AccuracyScore: 88,
            Phonemes: [{
              Phoneme: w.slice(0, 1) || 'p',
              Offset: i * stepTicks,
              Duration: Math.floor(durationTicks / 2),
              AccuracyScore: 88
            }]
          }]
        }))
      }]
    };
  }

  // 1. Normalize whole Azure response via canonical normalizer
  const normalized = normalizeFinalResult({
    rawResult: rawAzureResult,
    audio: audioIdentity,
    mode,
    assessmentId: attemptId,
    reference: referenceText
  });

  // 2. Attach ending-safe word clip timing to every word
  const words = normalized.words || [];
  for (let i = 0; i < words.length; i++) {
    let nextSpokenWord = null;
    for (let j = i + 1; j < words.length; j++) {
      if (words[j].errorType !== 'Omission' && (words[j].startMs !== null || words[j].rawStartMs !== null)) {
        nextSpokenWord = words[j];
        break;
      }
    }
    words[i].clipTiming = resolveWordClipTiming(words[i], nextSpokenWord, audioIdentity);
  }

  // 3. Compute deterministic sequence comparison against reference
  const refComparison = computeReferenceComparison(referenceText, words);

  const nbest = rawAzureResult?.NBest?.[0];
  const overallScores = {
    accuracyScore: normalized.accuracyScore ?? (Number(nbest?.AccuracyScore) || 0),
    fluencyScore: normalized.fluencyScore ?? (Number(nbest?.FluencyScore) || 0),
    completenessScore: refComparison.completenessScore,
    pronunciationScore: normalized.pronScore ?? (Number(nbest?.PronScore) || 0)
  };

  return {
    mode,
    attemptId,
    status: 'completed',
    referenceText,
    recognizedText: normalized.recognizedText || rawAzureResult?.DisplayText || referenceText,
    overallScores,
    words,
    referenceComparison: refComparison,
    timingSource: 'azure_continuous_normalized_v1'
  };
}

module.exports = {
  assessFixedReference,
  computeReferenceComparison
};
