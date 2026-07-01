const express = require('express');
const multer = require('multer');
const { sendError, sendSuccess } = require('../utils/response-helper');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

const VALID_AUDIO_REASONS = new Set(['no_speech', 'too_short', 'too_long', 'clipped', 'decode_failed']);

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function normalizeLexicalText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function parseMockAzurePayload() {
  const raw = String(process.env.PRONUNCIATION_TEST_AZURE_MOCK_RESPONSE || '').trim();
  if (!raw) return null;
  return safeJsonParse(raw);
}

function readAscii(view, offset, length) {
  let text = '';
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(view.getUint8(offset + index));
  }
  return text;
}

function parseWavBuffer(buffer) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length < 44) {
      return { ok: false, reason: 'decode_failed' };
    }

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
      return { ok: false, reason: 'decode_failed' };
    }

    let offset = 12;
    let formatChunk = null;
    let dataChunk = null;

    while (offset + 8 <= view.byteLength) {
      const chunkId = readAscii(view, offset, 4);
      const chunkSize = view.getUint32(offset + 4, true);
      const chunkStart = offset + 8;
      const chunkEnd = chunkStart + chunkSize;

      if (chunkEnd > view.byteLength) {
        return { ok: false, reason: 'decode_failed' };
      }

      if (chunkId === 'fmt ') {
        if (chunkSize < 16) {
          return { ok: false, reason: 'decode_failed' };
        }
        formatChunk = {
          audioFormat: view.getUint16(chunkStart, true),
          channelCount: view.getUint16(chunkStart + 2, true),
          sampleRate: view.getUint32(chunkStart + 4, true),
          bitsPerSample: view.getUint16(chunkStart + 14, true)
        };
      }

      if (chunkId === 'data') {
        dataChunk = buffer.subarray(chunkStart, chunkEnd);
      }

      offset = chunkEnd + (chunkSize % 2);
    }

    if (!formatChunk || !dataChunk) {
      return { ok: false, reason: 'decode_failed' };
    }

    if (formatChunk.audioFormat !== 1 || formatChunk.channelCount !== 1 || formatChunk.bitsPerSample !== 16 || dataChunk.length < 2) {
      return { ok: false, reason: 'decode_failed' };
    }

    const sampleCount = Math.floor(dataChunk.length / 2);
    const samples = new Int16Array(sampleCount);
    for (let index = 0; index < sampleCount; index += 1) {
      samples[index] = dataChunk.readInt16LE(index * 2);
    }

    return {
      ok: true,
      sampleRate: formatChunk.sampleRate,
      channelCount: formatChunk.channelCount,
      bitsPerSample: formatChunk.bitsPerSample,
      samples
    };
  } catch (_error) {
    return { ok: false, reason: 'decode_failed' };
  }
}

function analyzeAudioQuality(buffer) {
  const parsed = parseWavBuffer(buffer);
  if (!parsed.ok) {
    return {
      passed: false,
      reason: parsed.reason,
      speechDurationMs: 0,
      clipped: false
    };
  }

  const { sampleRate, samples } = parsed;
  const totalSamples = samples.length;
  if (!totalSamples || !sampleRate) {
    return {
      passed: false,
      reason: 'decode_failed',
      speechDurationMs: 0,
      clipped: false,
      sampleRate: sampleRate || null
    };
  }

  let clippedSamples = 0;
  let maxAbs = 0;
  const normalized = new Float32Array(totalSamples);

  for (let index = 0; index < totalSamples; index += 1) {
    const sample = samples[index];
    const absValue = Math.abs(sample);
    if (absValue >= 32760) clippedSamples += 1;
    if (absValue > maxAbs) maxAbs = absValue;
    normalized[index] = sample / 32768;
  }

  if (maxAbs < 320) {
    return {
      passed: false,
      reason: 'no_speech',
      speechDurationMs: 0,
      clipped: false,
      sampleRate
    };
  }

  const frameSize = Math.max(1, Math.round(sampleRate * 0.01));
  const frameDurationMs = (frameSize / sampleRate) * 1000;
  const frameRms = [];

  for (let offset = 0; offset < totalSamples; offset += frameSize) {
    const end = Math.min(totalSamples, offset + frameSize);
    let energy = 0;
    for (let index = offset; index < end; index += 1) {
      const sample = normalized[index];
      energy += sample * sample;
    }
    const rms = Math.sqrt(energy / Math.max(1, end - offset));
    frameRms.push(rms);
  }

  const maxRms = frameRms.reduce((highest, value) => Math.max(highest, value), 0);
  if (maxRms < 0.01) {
    return {
      passed: false,
      reason: 'no_speech',
      speechDurationMs: 0,
      clipped: false,
      sampleRate
    };
  }

  const threshold = Math.max(0.008, maxRms * 0.18);
  let firstSpeechFrame = -1;
  let lastSpeechFrame = -1;

  for (let index = 0; index < frameRms.length; index += 1) {
    if (frameRms[index] >= threshold) {
      if (firstSpeechFrame === -1) firstSpeechFrame = index;
      lastSpeechFrame = index;
    }
  }

  if (firstSpeechFrame === -1 || lastSpeechFrame === -1) {
    return {
      passed: false,
      reason: 'no_speech',
      speechDurationMs: 0,
      clipped: false,
      sampleRate
    };
  }

  const speechDurationMs = Math.round((lastSpeechFrame - firstSpeechFrame + 1) * frameDurationMs);
  const clippedRatio = clippedSamples / totalSamples;
  const clipped = clippedRatio >= 0.005;

  if (speechDurationMs < 250) {
    return {
      passed: false,
      reason: 'too_short',
      speechDurationMs,
      clipped,
      sampleRate
    };
  }

  if (speechDurationMs > 1800) {
    return {
      passed: false,
      reason: 'too_long',
      speechDurationMs,
      clipped,
      sampleRate
    };
  }

  if (clipped) {
    return {
      passed: false,
      reason: 'clipped',
      speechDurationMs,
      clipped: true,
      sampleRate
    };
  }

  return {
    passed: true,
    reason: null,
    speechDurationMs,
    clipped: false,
    sampleRate
  };
}

function validateAssessPayload(body, file) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length < 44) {
    return 'audio';
  }

  const requiredFields = [
    'itemId',
    'word',
    'referenceText',
    'referencePhonemes',
    'referencePhonemeIndex',
    'targetPhoneme',
    'targetPosition',
    'contrastId',
    'category'
  ];

  for (const field of requiredFields) {
    if (!String(body?.[field] || '').trim()) {
      return field;
    }
  }

  return null;
}

function buildPronunciationAssessmentHeader(referenceText) {
  const config = {
    ReferenceText: referenceText,
    GradingSystem: 'HundredMark',
    Granularity: 'Phoneme',
    PhonemeAlphabet: 'IPA',
    EnableMiscue: true,
    NBestPhonemeCount: 5
  };

  return Buffer.from(JSON.stringify(config)).toString('base64');
}

async function callAzurePronunciationAssessment(buffer, referenceText, sampleRate) {
  const mockPayload = parseMockAzurePayload();
  if (mockPayload) {
    return mockPayload;
  }

  const key = String(process.env.AZURE_SPEECH_KEY || '').trim();
  const region = String(process.env.AZURE_SPEECH_REGION || '').trim();

  if (!key || !region) {
    const error = new Error('Missing Azure Speech credentials.');
    error.code = 'CONFIG_ERROR';
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const endpoint = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': `audio/wav; codecs=audio/pcm; samplerate=${sampleRate || 16000}`,
        'Ocp-Apim-Subscription-Key': key,
        'Pronunciation-Assessment': buildPronunciationAssessmentHeader(referenceText)
      },
      body: buffer
    });

    const text = await response.text();
    const payload = safeJsonParse(text);

    if (!response.ok || !payload) {
      const error = new Error('Pronunciation assessment failed.');
      error.code = 'AZURE_ASSESSMENT_FAILED';
      error.details = {
        status: response.status,
        body: text.slice(0, 400)
      };
      throw error;
    }

    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('Pronunciation assessment timed out.');
      timeoutError.code = 'AZURE_ASSESSMENT_FAILED';
      timeoutError.details = { reason: 'timeout' };
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function getSelectedWord(bestHypothesis, referenceText) {
  const words = Array.isArray(bestHypothesis?.Words) ? bestHypothesis.Words : [];
  if (!words.length) return null;
  if (words.length === 1) return words[0];

  const normalizedReference = normalizeLexicalText(referenceText);
  return words.find((word) => {
    const lexical = word?.Word || word?.Lexical || word?.Display || '';
    return normalizeLexicalText(lexical) === normalizedReference;
  }) || null;
}

function mapCandidatePhonemes(phonemeNode, fallbackPhoneme, fallbackScore) {
  const rawCandidates = phonemeNode?.PronunciationAssessment?.NBestPhonemes || phonemeNode?.NBestPhonemes || [];
  const mapped = rawCandidates
    .map((candidate) => {
      const phoneme = String(candidate?.Phoneme || candidate?.phoneme || '').trim();
      const numericScore = Number(candidate?.Score ?? candidate?.AccuracyScore ?? candidate?.score);
      if (!phoneme || !Number.isFinite(numericScore)) return null;
      return {
        phoneme,
        score: Math.round(numericScore)
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);

  if (mapped.length) return mapped;

  if (!fallbackPhoneme) return [];
  return [{
    phoneme: fallbackPhoneme,
    score: Math.round(Number.isFinite(fallbackScore) ? fallbackScore : 0)
  }];
}

function simplifyPhonemeNode(phonemeNode) {
  if (!phonemeNode) return null;
  return {
    phoneme: String(phonemeNode?.Phoneme || '').trim() || null,
    accuracyScore: Math.round(Number(phonemeNode?.PronunciationAssessment?.AccuracyScore || 0)),
    offset: Number(phonemeNode?.Offset || 0),
    duration: Number(phonemeNode?.Duration || 0)
  };
}

function buildOmittedFinalResult(context) {
  const { body, quality, selectedWord, phonemes } = context;
  return {
    provisional: true,
    itemId: body.itemId,
    contrastId: body.contrastId,
    usable: true,
    assessmentStatus: 'target_omitted',
    unusableReason: null,
    word: body.word,
    targetPhoneme: body.targetPhoneme,
    contrastPartnerPhoneme: body.contrastPartnerPhoneme || null,
    targetPosition: body.targetPosition,
    referencePhonemeIndex: Number(body.referencePhonemeIndex),
    wordAccuracyScore: Math.round(Number(selectedWord?.PronunciationAssessment?.AccuracyScore || 0)),
    targetPhonemeAccuracyScore: 0,
    provisionalBand: 'needs_review',
    mostLikelySpokenPhoneme: null,
    pairedContrastDetected: false,
    spokenPhonemeCandidates: [],
    wordErrorType: selectedWord?.PronunciationAssessment?.ErrorType || 'Mispronunciation',
    extractionMode: 'final_target_missing',
    feedbackCode: 'final_target_omitted',
    audioQuality: {
      passed: true,
      speechDurationMs: quality.speechDurationMs,
      clipped: false
    },
    azureRecognizedText: selectedWord?.Word || body.referenceText,
    rawPhonemes: phonemes.map(simplifyPhonemeNode).filter(Boolean)
  };
}

function buildUnusableAssessment(context) {
  const { body, quality, selectedWord, phonemes, reason } = context;
  return {
    provisional: true,
    itemId: body.itemId,
    contrastId: body.contrastId,
    usable: false,
    assessmentStatus: 'unusable',
    unusableReason: reason,
    word: body.word,
    targetPhoneme: body.targetPhoneme,
    contrastPartnerPhoneme: body.contrastPartnerPhoneme || null,
    targetPosition: body.targetPosition,
    referencePhonemeIndex: Number(body.referencePhonemeIndex),
    wordAccuracyScore: Math.round(Number(selectedWord?.PronunciationAssessment?.AccuracyScore || 0)),
    targetPhonemeAccuracyScore: null,
    provisionalBand: null,
    mostLikelySpokenPhoneme: null,
    pairedContrastDetected: false,
    spokenPhonemeCandidates: [],
    wordErrorType: selectedWord?.PronunciationAssessment?.ErrorType || null,
    extractionMode: 'unusable',
    feedbackCode: 'audio_retry_needed',
    audioQuality: {
      passed: true,
      speechDurationMs: quality.speechDurationMs,
      clipped: false
    },
    azureRecognizedText: selectedWord?.Word || body.referenceText,
    rawPhonemes: phonemes.map(simplifyPhonemeNode).filter(Boolean)
  };
}

function buildSuccessfulAssessment(context) {
  const {
    body,
    quality,
    selectedWord,
    phonemes,
    extractedNode,
    extractionMode,
    assessmentStatus = 'ok'
  } = context;

  const targetPhoneme = String(body.targetPhoneme || '').trim();
  const targetPhonemeAccuracyScore = Math.round(Number(extractedNode?.PronunciationAssessment?.AccuracyScore || 0));
  const candidates = mapCandidatePhonemes(extractedNode, targetPhoneme, targetPhonemeAccuracyScore);
  const mostLikelySpokenPhoneme = candidates[0]?.phoneme || targetPhoneme;
  const pairedContrastDetected = body.category === 'final-consonant'
    ? false
    : (Boolean(body.contrastPartnerPhoneme) && mostLikelySpokenPhoneme === body.contrastPartnerPhoneme);
  const provisionalBand = determineProvisionalBand({
    usable: true,
    targetPhonemeAccuracyScore,
    mostLikelySpokenPhoneme,
    targetPhoneme,
    pairedContrastDetected,
    assessmentStatus
  });

  return {
    provisional: true,
    itemId: body.itemId,
    contrastId: body.contrastId,
    usable: true,
    assessmentStatus,
    unusableReason: null,
    word: body.word,
    targetPhoneme,
    contrastPartnerPhoneme: body.contrastPartnerPhoneme || null,
    targetPosition: body.targetPosition,
    referencePhonemeIndex: Number(body.referencePhonemeIndex),
    wordAccuracyScore: Math.round(Number(selectedWord?.PronunciationAssessment?.AccuracyScore || 0)),
    targetPhonemeAccuracyScore,
    provisionalBand,
    mostLikelySpokenPhoneme,
    pairedContrastDetected,
    spokenPhonemeCandidates: candidates,
    wordErrorType: selectedWord?.PronunciationAssessment?.ErrorType || 'Mispronunciation',
    extractionMode,
    feedbackCode: determineFeedbackCode({
      usable: true,
      assessmentStatus,
      provisionalBand,
      pairedContrastDetected
    }),
    audioQuality: {
      passed: true,
      speechDurationMs: quality.speechDurationMs,
      clipped: false
    },
    azureRecognizedText: selectedWord?.Word || body.referenceText,
    rawPhonemes: phonemes.map(simplifyPhonemeNode).filter(Boolean)
  };
}

function determineProvisionalBand({ usable, targetPhonemeAccuracyScore, mostLikelySpokenPhoneme, targetPhoneme, pairedContrastDetected, assessmentStatus }) {
  if (!usable) return null;

  if (targetPhonemeAccuracyScore >= 80 && mostLikelySpokenPhoneme === targetPhoneme) {
    return 'clear';
  }

  if (targetPhonemeAccuracyScore < 60 || pairedContrastDetected || assessmentStatus === 'target_omitted') {
    return 'needs_review';
  }

  return 'close';
}

function determineFeedbackCode({ usable, assessmentStatus, provisionalBand, pairedContrastDetected }) {
  if (!usable) return 'audio_retry_needed';
  if (assessmentStatus === 'target_omitted') return 'final_target_omitted';
  if (pairedContrastDetected) return 'closer_to_partner';
  if (provisionalBand === 'clear') return 'target_clear';
  return 'target_present_inconsistent';
}

function buildAssessmentFromAzure(body, quality, azurePayload) {
  const bestHypothesis = azurePayload?.NBest?.[0];
  const selectedWord = getSelectedWord(bestHypothesis, body.referenceText);

  if (!selectedWord) {
    return buildUnusableAssessment({
      body,
      quality,
      selectedWord: null,
      phonemes: [],
      reason: 'word_missing_or_split'
    });
  }

  const phonemes = Array.isArray(selectedWord?.Phonemes) ? selectedWord.Phonemes : [];
  const targetIndex = Number(body.referencePhonemeIndex);
  const targetPhoneme = String(body.targetPhoneme || '').trim();
  const category = String(body.category || '').trim();

  if (category === 'final-consonant') {
    const expectedNode = phonemes[targetIndex];
    const lastNode = phonemes[phonemes.length - 1];

    if (expectedNode && String(expectedNode?.Phoneme || '').trim() === targetPhoneme) {
      return buildSuccessfulAssessment({
        body,
        quality,
        selectedWord,
        phonemes,
        extractedNode: expectedNode,
        extractionMode: 'reference_index'
      });
    }

    if (lastNode && String(lastNode?.Phoneme || '').trim() === targetPhoneme) {
      return buildSuccessfulAssessment({
        body,
        quality,
        selectedWord,
        phonemes,
        extractedNode: lastNode,
        extractionMode: 'fallback_final_match'
      });
    }

    return buildOmittedFinalResult({ body, quality, selectedWord, phonemes });
  }

  let extractedNode = phonemes[targetIndex];
  let extractionMode = 'reference_index';

  if (!extractedNode || String(extractedNode?.Phoneme || '').trim() !== targetPhoneme) {
    const exactMatches = phonemes.filter((phonemeNode) => String(phonemeNode?.Phoneme || '').trim() === targetPhoneme);
    if (exactMatches.length === 1) {
      [extractedNode] = exactMatches;
      extractionMode = 'fallback_phoneme_match';
    } else {
      return buildUnusableAssessment({
        body,
        quality,
        selectedWord,
        phonemes,
        reason: 'phoneme_alignment_ambiguous'
      });
    }
  }

  return buildSuccessfulAssessment({
    body,
    quality,
    selectedWord,
    phonemes,
    extractedNode,
    extractionMode
  });
}

async function forwardVowelHintRequest(file, fields) {
  const backendUrl = String(process.env.PRAAT_BACKEND_URL || '').trim();
  if (!backendUrl) {
    return {
      exploratory: true,
      usable: false,
      reason: 'praat_unavailable'
    };
  }

  const formData = new FormData();
  formData.append('audio', new Blob([file.buffer], { type: file.mimetype || 'audio/wav' }), file.originalname || 'recording.wav');
  formData.append('itemId', String(fields.itemId || ''));
  formData.append('targetPhoneme', String(fields.targetPhoneme || ''));
  formData.append('category', String(fields.category || ''));

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let response;
    try {
      response = await fetch(`${backendUrl.replace(/\/+$/, '')}/analyze-vowel`, {
        method: 'POST',
        signal: controller.signal,
        body: formData
      });
    } finally {
      clearTimeout(timeout);
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      return {
        exploratory: true,
        usable: false,
        reason: 'praat_unavailable'
      };
    }
    return payload;
  } catch (_error) {
    return {
      exploratory: true,
      usable: false,
      reason: 'praat_unavailable'
    };
  }
}

router.post('/pronunciation-test/assess', upload.single('audio'), async (req, res) => {
  try {
    const invalidField = validateAssessPayload(req.body, req.file);
    if (invalidField) {
      return sendError(res, 400, 'INVALID_INPUT', 'Missing or invalid pronunciation assessment input.', { field: invalidField });
    }

    const referencePhonemes = safeJsonParse(req.body.referencePhonemes);
    if (!Array.isArray(referencePhonemes) || !referencePhonemes.every((item) => typeof item === 'string')) {
      return sendError(res, 400, 'INVALID_INPUT', 'referencePhonemes must be a JSON array of phoneme strings.', { field: 'referencePhonemes' });
    }

    const referencePhonemeIndex = Number(req.body.referencePhonemeIndex);
    if (!Number.isInteger(referencePhonemeIndex) || referencePhonemeIndex < 0) {
      return sendError(res, 400, 'INVALID_INPUT', 'referencePhonemeIndex must be a non-negative integer.', { field: 'referencePhonemeIndex' });
    }
    if (referencePhonemeIndex >= referencePhonemes.length) {
      return sendError(res, 400, 'INVALID_INPUT', 'referencePhonemeIndex is outside the referencePhonemes array.', { field: 'referencePhonemeIndex' });
    }
    if (referencePhonemes[referencePhonemeIndex] !== String(req.body.targetPhoneme || '').trim()) {
      return sendError(res, 400, 'INVALID_INPUT', 'targetPhoneme must match referencePhonemes[referencePhonemeIndex].', {
        field: 'targetPhoneme'
      });
    }

    const quality = analyzeAudioQuality(req.file.buffer);
    if (!quality.passed) {
      return sendError(res, 400, 'INVALID_AUDIO', 'Audio did not pass quality checks.', {
        reason: VALID_AUDIO_REASONS.has(quality.reason) ? quality.reason : 'decode_failed',
        speechDurationMs: quality.speechDurationMs,
        clipped: Boolean(quality.clipped)
      });
    }

    const body = {
      ...req.body,
      referencePhonemes,
      referencePhonemeIndex,
      contrastPartnerPhoneme: String(req.body.contrastPartnerPhoneme || '').trim() || null,
      isPractice: parseBoolean(req.body.isPractice)
    };

    const azurePayload = await callAzurePronunciationAssessment(req.file.buffer, body.referenceText, quality.sampleRate);
    const assessment = buildAssessmentFromAzure(body, quality, azurePayload);
    return sendSuccess(res, assessment);
  } catch (error) {
    if (error?.code === 'CONFIG_ERROR') {
      return sendError(res, 500, 'CONFIG_ERROR', 'Azure Speech credentials are not configured.');
    }

    const details = error?.details || null;
    console.error('[PronunciationTest] /assess failed:', error);
    return sendError(res, 502, 'AZURE_ASSESSMENT_FAILED', 'Pronunciation assessment failed.', details);
  }
});

router.post('/pronunciation-test/vowel-hint', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file || !Buffer.isBuffer(req.file.buffer) || req.file.buffer.length < 44) {
      return sendError(res, 400, 'INVALID_INPUT', 'Missing audio file.', { field: 'audio' });
    }

    const itemId = String(req.body?.itemId || '').trim();
    const targetPhoneme = String(req.body?.targetPhoneme || '').trim();
    const category = String(req.body?.category || '').trim();

    if (!itemId || !targetPhoneme || !category) {
      return sendError(res, 400, 'INVALID_INPUT', 'Missing vowel hint metadata.');
    }

    if (category !== 'vowel') {
      return sendSuccess(res, {
        exploratory: true,
        usable: false,
        reason: 'non_vowel_item'
      });
    }

    const hintPayload = await forwardVowelHintRequest(req.file, { itemId, targetPhoneme, category });
    return sendSuccess(res, hintPayload);
  } catch (error) {
    console.error('[PronunciationTest] /vowel-hint failed:', error);
    return sendSuccess(res, {
      exploratory: true,
      usable: false,
      reason: 'praat_unavailable'
    });
  }
});

module.exports = router;
