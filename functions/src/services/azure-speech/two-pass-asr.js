'use strict';

/**
 * Two-Pass ASR Assessment Engine for Spoken-Response Modes (RL, SGD, RTS)
 * Per BEL Spec §11:
 * Pass 1: Unscripted, faithful Speech-to-Text producing a transcript hypothesis without answer-key conditioning.
 * Freeze: Validates speech presence and reliability, freezing an immutable reference.
 * Pass 2: Forced-alignment pronunciation assessment of original audio against the frozen transcript.
 * Completeness: Marked null (not applicable for unscripted speech).
 */

const crypto = require('crypto');
const { assessFixedReference } = require('./continuous-assessment');
const { getAzureSpeechCredentials } = require('../pronunciation-assessment-service');

/**
 * Pass 1: Transcribes learner audio without conditioning on prompt or answer key.
 */
async function transcribeOriginalSpeech({ audioBuffer, audioIdentity = null, locale = 'en-US' }, deps = {}) {
  if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
    throw new TypeError('VALID_AUDIO_BUFFER_REQUIRED');
  }

  const audioHash = crypto.createHash('sha256').update(audioBuffer).digest('hex');
  const credentials = deps.credentials || getAzureSpeechCredentials();

  let rawSttResult = null;

  if (credentials?.key && !deps.useMock) {
    const endpoint = `https://${credentials.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(locale)}&format=detailed`;
    const fetchFn = deps.fetch || globalThis.fetch;
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': credentials.key,
        'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
        'Accept': 'application/json'
      },
      body: audioBuffer
    });

    if (!response.ok) {
      const err = new Error(`AZURE_STT_ERROR_${response.status}`);
      err.status = response.status;
      throw err;
    }
    rawSttResult = await response.json();
  } else {
    // Deterministic mock fallback for tests and development
    rawSttResult = deps.mockSttResult || {
      RecognitionStatus: 'Success',
      DisplayText: 'The lecture discussed renewable energy sources and their environmental impact.',
      NBest: [{
        Confidence: 0.92,
        Display: 'The lecture discussed renewable energy sources and their environmental impact.',
        Words: [
          { Word: 'The', Offset: 1000000, Duration: 2000000, Confidence: 0.95 },
          { Word: 'lecture', Offset: 3500000, Duration: 4500000, Confidence: 0.91 },
          { Word: 'discussed', Offset: 8500000, Duration: 5000000, Confidence: 0.89 },
          { Word: 'renewable', Offset: 14000000, Duration: 6000000, Confidence: 0.93 },
          { Word: 'energy', Offset: 20500000, Duration: 4000000, Confidence: 0.94 },
          { Word: 'sources', Offset: 25000000, Duration: 5000000, Confidence: 0.90 },
          { Word: 'and', Offset: 30500000, Duration: 2000000, Confidence: 0.95 },
          { Word: 'their', Offset: 33000000, Duration: 3000000, Confidence: 0.92 },
          { Word: 'environmental', Offset: 36500000, Duration: 7000000, Confidence: 0.88 },
          { Word: 'impact', Offset: 44000000, Duration: 5000000, Confidence: 0.91 }
        ]
      }]
    };
  }

  const nBest = rawSttResult?.NBest?.[0];
  const displayText = String(nBest?.Display || rawSttResult?.DisplayText || '').trim();
  const rawWords = Array.isArray(nBest?.Words) ? nBest.Words : [];

  const validRawWords = rawWords.filter(w => String(w?.Word || '').trim().length > 0);

  const tokens = validRawWords.map((w, idx) => {
    const wordText = String(w.Word || '').trim();
    const offsetTicks = Number(w.Offset) || 0;
    const durationTicks = Number(w.Duration) || 0;
    const confidence = typeof w.Confidence === 'number' ? w.Confidence : (nBest?.Confidence ?? 0.85);

    return {
      index: idx,
      word: wordText,
      startMs: Math.round(offsetTicks / 10000),
      endMs: Math.round((offsetTicks + durationTicks) / 10000),
      confidence,
      offsetTicks,
      durationTicks
    };
  });

  const overallConfidence = tokens.length > 0
    ? (tokens.reduce((acc, t) => acc + t.confidence, 0) / tokens.length)
    : (nBest?.Confidence ?? 0);

  const lastToken = tokens[tokens.length - 1];
  const detectedSpeechDurationMs = lastToken ? lastToken.endMs : 0;

  return {
    audioHash,
    rawTranscript: displayText,
    tokens,
    confidence: Math.round(overallConfidence * 100) / 100,
    detectedSpeechDurationMs,
    transcriptRevision: `asr-${crypto.randomBytes(8).toString('hex')}`
  };
}

/**
 * Validates the transcription and freezes the exact immutable scoring reference.
 * Rejects empty recordings and flags low-confidence speech.
 */
function buildScoringReference(transcription, policy = {}) {
  const minConfidence = policy.minConfidenceThreshold ?? 0.50;
  const uncertainTokenThreshold = policy.uncertainTokenThreshold ?? 0.60;

  if (!transcription || !transcription.rawTranscript || transcription.tokens.length === 0) {
    return {
      status: 'unrateable',
      reason: 'NO_SPEECH_DETECTED',
      scoringText: null,
      audioHash: transcription?.audioHash || null,
      transcriptRevision: transcription?.transcriptRevision || null,
      uncertainWordIndices: [],
      uncertainWords: []
    };
  }

  if (transcription.confidence < minConfidence) {
    return {
      status: 'transcript_uncertain',
      reason: 'LOW_ASR_CONFIDENCE',
      scoringText: transcription.rawTranscript,
      audioHash: transcription.audioHash,
      transcriptRevision: transcription.transcriptRevision,
      uncertainWordIndices: transcription.tokens.map(t => t.index),
      uncertainWords: transcription.tokens.map(t => t.word)
    };
  }

  // Identify individual words with low confidence
  const uncertainTokens = transcription.tokens.filter(t => t.confidence < uncertainTokenThreshold);
  const uncertainWordIndices = uncertainTokens.map(t => t.index);
  const uncertainWords = uncertainTokens.map(t => t.word);

  return {
    status: 'accepted',
    reason: null,
    scoringText: transcription.rawTranscript,
    audioHash: transcription.audioHash,
    transcriptRevision: transcription.transcriptRevision,
    uncertainWordIndices,
    uncertainWords
  };
}

/**
 * Assesses an unscripted spoken response (Retell Lecture, SGD, RTS).
 * Executes Pass 1 STT -> Freeze Reference -> Pass 2 Forced Alignment.
 */
async function assessSpokenResponse({ mode, audioBuffer, audioIdentity = null, attemptId = null, questionId = null }, deps = {}) {
  if (!['retell_lecture', 'summarize_group_discussion', 'respond_to_a_situation'].includes(mode)) {
    throw new Error(`INVALID_SPOKEN_RESPONSE_MODE: ${mode}`);
  }

  // Pass 1: Verbatim speech-to-text without answer-key priming
  const transcription = await transcribeOriginalSpeech({
    audioBuffer,
    audioIdentity,
    locale: deps.locale || 'en-US'
  }, deps);

  // Freeze: Validate speech presence and freeze reference text
  const reference = buildScoringReference(transcription, deps.policy);

  if (reference.status !== 'accepted') {
    return {
      mode,
      attemptId,
      status: reference.status,
      reason: reference.reason,
      transcription,
      reference,
      overallScores: {
        accuracyScore: null,
        fluencyScore: null,
        completenessScore: null, // Always null for unscripted per §9.4
        pronunciationScore: null
      },
      words: [],
      timingSource: 'two_pass_asr_uncertain'
    };
  }

  // Pass 2: Forced alignment of real learner audio against frozen transcript hypothesis
  const assessment = await assessFixedReference({
    mode,
    referenceText: reference.scoringText,
    audioBuffer,
    audioIdentity,
    attemptId
  }, deps);

  // Mark uncertain tokens in assessment words based on Pass 1 STT confidence
  // Aligns assessment words to Pass 1 tokens accounting for insertions, omissions, and punctuation differences
  const cleanWord = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const uncertainSet = new Set(reference.uncertainWordIndices);
  const sttTokens = transcription.tokens || [];
  let tokenPointer = 0;

  const enrichedWords = assessment.words.map((w, idx) => {
    let matchedToken = null;
    const isInsertion = w.errorType === 'Insertion';

    if (!isInsertion) {
      const wClean = cleanWord(w.word);
      for (let t = tokenPointer; t < sttTokens.length; t++) {
        if (cleanWord(sttTokens[t].word) === wClean) {
          matchedToken = sttTokens[t];
          tokenPointer = t + 1;
          break;
        }
      }
      if (!matchedToken && sttTokens[idx] && cleanWord(sttTokens[idx].word) === wClean) {
        matchedToken = sttTokens[idx];
      }
    }

    const tokenUncertain = matchedToken ? uncertainSet.has(matchedToken.index) : (isInsertion || uncertainSet.has(idx));
    const isUncertain = tokenUncertain || w.clipTiming?.isolationStatus === 'uncertain';
    const confidence = matchedToken ? matchedToken.confidence : (isInsertion ? 0.0 : (sttTokens[idx]?.confidence ?? 1.0));

    return {
      ...w,
      isTranscriptUncertain: isUncertain,
      transcriptConfidence: confidence,
      uncertainReason: isUncertain ? (isInsertion ? 'INSERTED_WORD' : 'WORD_RECOGNITION_UNCERTAIN') : null
    };
  });

  return {
    mode,
    attemptId,
    status: 'completed',
    transcription,
    reference,
    overallScores: {
      accuracyScore: assessment.overallScores.accuracyScore,
      fluencyScore: assessment.overallScores.fluencyScore,
      completenessScore: null, // Public completeness is null/not_applicable for RL/SGD/RTS per §9.4
      pronunciationScore: assessment.overallScores.pronunciationScore
    },
    words: enrichedWords,
    transcriptDisclosure: {
      headline: 'Pronunciation of your response',
      subtitle: 'Based on the words recognized in your recording. View transcript',
      uncertainWordNotice: 'Word recognition uncertain. Listen to this section and check the transcript.'
    },
    timingSource: 'azure_two_pass_asr_v1'
  };
}

module.exports = {
  transcribeOriginalSpeech,
  buildScoringReference,
  assessSpokenResponse
};
