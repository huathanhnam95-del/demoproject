'use strict';

/**
 * Two-Pass ASR Assessment Engine for Spoken-Response Modes (RL, SGD, RTS, Describe Image)
 * Per BEL Spec §11 & Plan V3:
 * Pass 1: Unscripted, faithful Speech-to-Text producing a transcript hypothesis without answer-key conditioning.
 *         Uses Groq-hosted Whisper (whisper-large-v3) as primary interchangeable provider.
 * Uncertainty: Discloses known material minimal pairs without rewriting the recognized transcript.
 * Freeze: Validates speech presence and reliability, freezing an immutable reference.
 * Pass 2: Forced-alignment pronunciation assessment of original audio against the frozen transcript.
 * Completeness: Marked null (not applicable for unscripted speech).
 */

const crypto = require('crypto');
const { assessFixedReference } = require('./continuous-assessment');
const { getAzureSpeechCredentials } = require('../pronunciation-assessment-service');
const { getReconstructionProvider } = require('../practice-pronunciation/reference-reconstruction');
const { detectMaterialAmbiguities } = require('../practice-pronunciation/ambiguity-detector');

/**
 * Pass 1: Transcribes learner audio without conditioning on prompt or answer key.
 * Defaults to Groq-hosted Whisper (whisper-large-v3).
 * Strictly avoids silent fallback to paid Azure STT on quota exhaustion.
 */
async function transcribeOriginalSpeech({ audioBuffer, audioIdentity = null, locale = 'en-US' }, deps = {}) {
  if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
    throw new TypeError('VALID_AUDIO_BUFFER_REQUIRED');
  }

  // Handle mock STT result directly (e.g. from existing unit tests using Azure STT format)
  if (deps.mockSttResult) {
    return _normalizeAzureSttResult(deps.mockSttResult, audioBuffer);
  }

  // Explicit legacy Azure STT opt-in ONLY (never as automatic fallback)
  if (deps.useLegacyAzureStt) {
    const credentials = deps.credentials || getAzureSpeechCredentials();
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
      const rawSttResult = await response.json();
      return _normalizeAzureSttResult(rawSttResult, audioBuffer);
    }
  }

  // Primary: Groq-hosted Whisper unconditioned transcription
  const provider = deps.provider || getReconstructionProvider(deps.providerName || 'default');
  return provider.transcribe({
    audioBuffer,
    audioIdentity,
    locale,
    options: deps
  });
}

function _normalizeAzureSttResult(rawSttResult, audioBuffer) {
  const audioHash = crypto.createHash('sha256').update(audioBuffer).digest('hex');
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
    transcriptRevision: `azure-stt-${crypto.randomBytes(8).toString('hex')}`
  };
}

/**
 * Validates the transcription and freezes the exact immutable scoring reference.
 * Rejects empty recordings and flags low-confidence speech.
 */
function buildScoringReference(transcription, policy = {}) {
  const uncertainTokenThreshold = policy.uncertainTokenThreshold ?? 0.60;

  if (!transcription || !transcription.rawTranscript || (transcription.tokens.length === 0 && !transcription.segments?.length)) {
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

  // Low confidence is evidence to disclose, not a learner confirmation gate.
  const uncertainTokens = transcription.tokens.filter(t => t.confidence === null || t.confidence < uncertainTokenThreshold);
  const uncertainWordIndices = uncertainTokens.map(t => t.index);
  const uncertainWords = uncertainTokens.map(t => t.word);

  return {
    status: 'accepted',
    reason: null,
    scoringText: transcription.rawTranscript,
    text: transcription.rawTranscript,
    displayText: transcription.rawTranscript,
    hash: crypto.createHash('sha256').update(transcription.rawTranscript).digest('hex'),
    kind: 'attempted_words',
    source: transcription.provider || 'groq-whisper',
    audioHash: transcription.audioHash,
    transcriptRevision: transcription.transcriptRevision,
    uncertainWordIndices,
    uncertainWords
  };
}

/**
 * Assesses an unscripted spoken response (Retell Lecture, SGD, RTS, Describe Image).
 * Executes Pass 1 STT -> Ambiguity Check -> Freeze Reference -> Pass 2 Forced Alignment.
 */
async function assessSpokenResponse({ mode, audioBuffer, audioIdentity = null, attemptId = null, questionId = null }, deps = {}) {
  const SPOKEN_MODES = ['retell_lecture', 'summarize_group_discussion', 'respond_to_situation', 'respond_to_a_situation', 'describe_image'];
  if (!SPOKEN_MODES.includes(mode)) {
    throw new Error(`INVALID_SPOKEN_RESPONSE_MODE: ${mode}`);
  }

  // Pass 1: Verbatim speech-to-text without answer-key priming
  const transcription = deps.frozenTranscription || await transcribeOriginalSpeech({
    audioBuffer,
    audioIdentity,
    locale: deps.locale || 'en-US'
  }, deps);

  const ambiguityCheck = detectMaterialAmbiguities(transcription.tokens, deps.ambiguityOptions);

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
    const boundaryUncertain = w.clipTiming?.isolationStatus === 'uncertain';
    const confidence = matchedToken ? matchedToken.confidence : null;

    return {
      ...w,
      isTranscriptUncertain: tokenUncertain,
      isBoundaryUncertain: boundaryUncertain,
      transcriptConfidence: confidence,
      uncertainReason: tokenUncertain ? (isInsertion ? 'INSERTED_WORD' : 'WORD_RECOGNITION_UNCERTAIN') : null
    };
  });

  return {
    ...assessment,
    mode,
    attemptId,
    status: 'completed',
    transcription,
    transcriptUncertainty: { ambiguousCandidates: ambiguityCheck.ambiguities || [],
      uncertainWordIndices: reference.uncertainWordIndices },
    reference,
    wordResults: assessment.wordResults.map(word => {
      const enriched = enrichedWords.find(candidate => candidate.occurrenceId === word.occurrenceId);
      return enriched ? { ...word, isTranscriptUncertain: enriched.isTranscriptUncertain,
        isBoundaryUncertain: enriched.isBoundaryUncertain,
        transcriptConfidence: enriched.transcriptConfidence } : word;
    }),
    utterances: assessment.utterances,
    coverage: { ...assessment.coverage, completeness: null },
    provenance: { ...assessment.provenance, transcriptionProvider: transcription.provider,
      transcriptionModel: transcription.model, transcriptRevision: reference.transcriptRevision },
    overallScores: {
      accuracyScore: assessment.overallScores.accuracyScore,
      fluencyScore: assessment.overallScores.fluencyScore,
      completenessScore: null, // Public completeness is null/not_applicable for RL/SGD/RTS/DI per §9.4
      pronunciationScore: assessment.overallScores.pronunciationScore
    },
    words: enrichedWords,
    transcriptDisclosure: {
      headline: 'Pronunciation of your response',
      subtitle: 'Based on the words recognized in your recording. View transcript',
      uncertainWordNotice: 'Word recognition uncertain. Listen to this section and check the transcript.'
    },
    timingSource: 'two_pass_asr_v2'
  };
}

module.exports = {
  transcribeOriginalSpeech,
  buildScoringReference,
  assessSpokenResponse
};
