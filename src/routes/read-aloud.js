const express = require('express');
const multer = require('multer');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const { sendError, sendSuccess } = require('../utils/response-helper');
const {
  VERSION: CONNECTED_SPEECH_VERSION,
  buildConnectedSpeechAnalysis,
  buildConnectedSpeechEventSpecs,
  hasConnectedSpeechEvents,
  buildEventFamilyCounts
} = require('../read-aloud/connected-speech-service');
const { analyzeAudioQuality } = require('../read-aloud/audio-quality');
const { loadAudioQualityThresholds } = require('../read-aloud/audio-quality-thresholds');
const {
  buildConnectedSpeechAttemptRecord,
  uploadConnectedSpeechAudio,
  persistConnectedSpeechAttempt
} = require('../read-aloud/connected-speech-storage');

const router = express.Router();
const CONNECTED_SPEECH_INDEX_PATH = path.join(process.cwd(), 'public', 'database', 'RA', 'connected-speech-index.json');
let connectedSpeechIndexCache = null;
let connectedSpeechIndexPromise = null;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB limit for longer audio
});
const ALIGNMENT_MODES = new Set(['heuristic', 'shadow_mfa', 'mfa_primary']);

function safeJsonParse(value) {
  try { return JSON.parse(value); } catch (_) { return null; }
}

function parseMockAzurePayload() {
  const raw = String(process.env.READ_ALOUD_AZURE_MOCK_RESPONSE || '').trim();
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

function normalizePromptIndexRecord(prompt) {
  if (!prompt || typeof prompt !== 'object') return null;
  return {
    rowKey: prompt.rowKey || null,
    questionId: prompt.questionId == null ? null : String(prompt.questionId),
    title: String(prompt.title || ''),
    hasSampleAudio: Boolean(prompt.hasSampleAudio),
    hasAnyConnectedSpeech: Boolean(prompt.hasAnyConnectedSpeech),
    hasLinking: Boolean(prompt.hasLinking),
    linkingCount: Number(prompt.linkingCount || 0),
    hasReducedWords: Boolean(prompt.hasReducedWords),
    reducedWordCount: Number(prompt.reducedWordCount || 0),
    hasSoundChanges: Boolean(prompt.hasSoundChanges),
    soundChangeCount: Number(prompt.soundChangeCount || 0),
    soundChangeSubtypes: Array.isArray(prompt.soundChangeSubtypes) ? prompt.soundChangeSubtypes.slice() : [],
    representativeExamples: Array.isArray(prompt.representativeExamples) ? prompt.representativeExamples.slice() : []
  };
}

async function loadConnectedSpeechIndex() {
  if (connectedSpeechIndexCache) {
    return connectedSpeechIndexCache;
  }
  if (connectedSpeechIndexPromise) {
    return connectedSpeechIndexPromise;
  }

  connectedSpeechIndexPromise = (async () => {
    const raw = await fs.promises.readFile(CONNECTED_SPEECH_INDEX_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const prompts = Array.isArray(parsed.prompts) ? parsed.prompts : [];
    const byQuestionId = new Map();
    const byRowKey = new Map();
    prompts.forEach((prompt) => {
      const normalized = normalizePromptIndexRecord(prompt);
      if (!normalized) return;
      if (normalized.questionId) {
        byQuestionId.set(normalized.questionId, normalized);
        byRowKey.set(`id:${normalized.questionId}`, normalized);
      }
      if (normalized.rowKey) {
        byRowKey.set(String(normalized.rowKey), normalized);
      }
    });
    connectedSpeechIndexCache = {
      ...parsed,
      prompts,
      byQuestionId,
      byRowKey
    };
    return connectedSpeechIndexCache;
  })().finally(() => {
    connectedSpeechIndexPromise = null;
  });

  return connectedSpeechIndexPromise;
}

function buildClientContext(body = {}) {
  return {
    guideLevel: String(body.clientGuideLevel || '').trim() || null,
    sampleAudioFilter: String(body.clientSampleAudioFilter || '').trim() || null,
    promptFamilyFilter: String(body.clientPromptFamilyFilter || '').trim() || null,
    promptIndexVersion: String(body.clientPromptIndexVersion || '').trim() || null
  };
}

function getConnectedSpeechAlignmentMode() {
  const mode = String(process.env.CONNECTED_SPEECH_ALIGNMENT_MODE || 'heuristic').trim().toLowerCase();
  return ALIGNMENT_MODES.has(mode) ? mode : 'heuristic';
}

function buildAlignmentMetadata(requestedMode, connectedSpeech) {
  if (requestedMode === 'shadow_mfa') {
    const shadow = normalizeConnectedSpeechStatus({
      status: 'shadow_placeholder',
      version: `${CONNECTED_SPEECH_VERSION}-mfa-shadow`,
      summary: connectedSpeech.summary,
      events: connectedSpeech.events
    });
    return {
      requestedAlignmentMode: 'shadow_mfa',
      scoringMode: 'heuristic',
      connectedSpeechPrimarySource: 'heuristic',
      alignmentFallbackReason: 'mfa_unavailable',
      connectedSpeechShadow: {
        ...shadow,
        shadowKind: 'placeholder',
        engine: 'none',
        mode: 'shadow_mfa',
        primarySource: 'heuristic',
        note: 'MFA rollout scaffold; heuristic result mirrored until the MFA worker is wired in.'
      }
    };
  }

  if (requestedMode === 'mfa_primary') {
    return {
      requestedAlignmentMode: 'mfa_primary',
      scoringMode: 'heuristic',
      connectedSpeechPrimarySource: 'heuristic',
      alignmentFallbackReason: 'mfa_unavailable',
      connectedSpeechShadow: null
    };
  }

  return {
    requestedAlignmentMode: 'heuristic',
    scoringMode: 'heuristic',
    connectedSpeechPrimarySource: 'heuristic',
    alignmentFallbackReason: null,
    connectedSpeechShadow: null
  };
}

function validateWavUpload(buffer) {
  const thresholds = loadAudioQualityThresholds();
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
    let dataChunkLength = 0;

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
        dataChunkLength = chunkSize;
      }

      offset = chunkEnd + (chunkSize % 2);
    }

    if (!formatChunk || !dataChunkLength) {
      return { ok: false, reason: 'decode_failed' };
    }
    if (formatChunk.audioFormat !== 1 || formatChunk.channelCount !== 1 || formatChunk.bitsPerSample !== 16) {
      return { ok: false, reason: 'decode_failed' };
    }
    if (!Number.isFinite(formatChunk.sampleRate) || formatChunk.sampleRate <= 0) {
      return { ok: false, reason: 'decode_failed' };
    }

    const minimumBytes = Math.ceil(formatChunk.sampleRate * (thresholds.minimumContainerDurationMs / 1000)) * 2;
    if (dataChunkLength < minimumBytes) {
      return { ok: false, reason: 'too_short' };
    }

    return {
      ok: true,
      sampleRate: formatChunk.sampleRate
    };
  } catch (_) {
    return { ok: false, reason: 'decode_failed' };
  }
}

function buildPronunciationAssessmentHeader(referenceText) {
  const config = {
    ReferenceText: referenceText,
    GradingSystem: 'HundredMark',
    Granularity: 'Phoneme',
    PhonemeAlphabet: 'IPA',
    EnableMiscue: true
  };
  return Buffer.from(JSON.stringify(config)).toString('base64');
}

function normalizeConnectedSpeechStatus(result) {
  if (!result || typeof result !== 'object') {
    return {
      status: 'unavailable',
      version: CONNECTED_SPEECH_VERSION,
      summary: { detectedCount: 0, notDetectedCount: 0, uncertainCount: 0 },
      events: []
    };
  }
  return {
    status: String(result.status || 'unavailable'),
    version: String(result.version || CONNECTED_SPEECH_VERSION),
    summary: {
      detectedCount: Number(result.summary?.detectedCount || 0),
      notDetectedCount: Number(result.summary?.notDetectedCount || 0),
      uncertainCount: Number(result.summary?.uncertainCount || 0)
    },
    events: Array.isArray(result.events) ? result.events : []
  };
}

function buildAzureSummary(nbest) {
  const words = Array.isArray(nbest?.Words) ? nbest.Words : [];
  return {
    recognizedText: String(nbest?.Display || ''),
    wordCount: words.length,
    accuracyScore: Math.round(Number(nbest?.PronunciationAssessment?.AccuracyScore || 0)),
    fluencyScore: Math.round(Number(nbest?.PronunciationAssessment?.FluencyScore || 0)),
    completenessScore: Math.round(Number(nbest?.PronunciationAssessment?.CompletenessScore || 0)),
    pronScore: Math.round(Number(nbest?.PronunciationAssessment?.PronScore || 0))
  };
}

async function callConnectedSpeechAnalysis({ attemptId, questionId, referenceText, azurePayload, audioBuffer, audioQuality }) {
  if (String(process.env.READ_ALOUD_CONNECTED_SPEECH_ENABLED || '').trim().toLowerCase() === 'false') {
    return {
      workerStatus: 'not_applicable',
      familyCounts: {},
      connectedSpeech: normalizeConnectedSpeechStatus({
        status: 'not_applicable',
        version: CONNECTED_SPEECH_VERSION,
        summary: { detectedCount: 0, notDetectedCount: 0, uncertainCount: 0 },
        events: []
      })
    };
  }

  const hasEvents = hasConnectedSpeechEvents(referenceText, questionId);
  if (!hasEvents) {
    return {
      workerStatus: 'not_applicable',
      familyCounts: {},
      connectedSpeech: normalizeConnectedSpeechStatus({
        status: 'not_applicable',
        version: CONNECTED_SPEECH_VERSION,
        summary: { detectedCount: 0, notDetectedCount: 0, uncertainCount: 0 },
        events: []
      })
    };
  }

  if (audioQuality && audioQuality.passed === false) {
    return {
      workerStatus: 'not_rateable',
      familyCounts: {},
      connectedSpeech: normalizeConnectedSpeechStatus({
        status: 'not_rateable',
        version: CONNECTED_SPEECH_VERSION,
        summary: { detectedCount: 0, notDetectedCount: 0, uncertainCount: 0 },
        events: []
      })
    };
  }

  const workerUrl = String(process.env.CONNECTED_SPEECH_API_URL || '').trim();
  const localAnalysis = buildConnectedSpeechAnalysis({
    questionId,
    referenceText,
    azurePayload,
    audioQuality
  });
  const localResult = normalizeConnectedSpeechStatus(localAnalysis);
  const familyCounts = buildEventFamilyCounts(localResult.events);

  if (!workerUrl) {
    return {
      workerStatus: 'local',
      familyCounts,
      connectedSpeech: localResult
    };
  }

  const analysisSpec = {
    attemptId,
    questionId,
    referenceText,
    version: CONNECTED_SPEECH_VERSION,
    azurePayload,
    audioQuality,
    events: undefined
  };
  analysisSpec.events = buildConnectedSpeechEventSpecs(referenceText, questionId);

  let timeout;
  try {
    const controller = new AbortController();
    const timeoutMs = Number(process.env.CONNECTED_SPEECH_TIMEOUT_MS || 12000);
    timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 12000);
    const formData = new FormData();
    formData.append('audio', new Blob([audioBuffer], { type: 'audio/wav' }), 'recording.wav');
    formData.append('analysisSpec', JSON.stringify(analysisSpec));

    const response = await fetch(workerUrl, {
      method: 'POST',
      signal: controller.signal,
      body: formData,
      headers: process.env.CONNECTED_SPEECH_API_AUDIENCE
        ? { 'X-Connected-Speech-Audience': String(process.env.CONNECTED_SPEECH_API_AUDIENCE) }
        : undefined
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      throw new Error('Connected speech worker failed.');
    }
    return {
      workerStatus: 'complete',
      familyCounts: buildEventFamilyCounts(Array.isArray(payload.events) ? payload.events : []),
      connectedSpeech: normalizeConnectedSpeechStatus(payload)
    };
  } catch (error) {
    try {
      return {
        workerStatus: 'fallback',
        familyCounts,
        connectedSpeech: localResult
      };
    } catch (_) {
      return {
        workerStatus: 'unavailable',
        familyCounts: {},
        connectedSpeech: normalizeConnectedSpeechStatus({
          status: 'unavailable',
          version: CONNECTED_SPEECH_VERSION,
          summary: { detectedCount: 0, notDetectedCount: 0, uncertainCount: 0 },
          events: []
        })
      };
    }
  } finally {
    clearTimeout(timeout);
  }
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
  // Allow up to 45 seconds timeout for longer reads
  const timeout = setTimeout(() => controller.abort(), 45000);
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
      error.details = { status: response.status, body: text.slice(0, 400) };
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

router.post('/read-aloud/assess', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file || !Buffer.isBuffer(req.file.buffer)) {
      return sendError(res, 400, 'INVALID_INPUT', 'Missing audio file.');
    }
    const referenceText = String(req.body?.referenceText || '').trim();
    if (!referenceText) {
      return sendError(res, 400, 'INVALID_INPUT', 'Missing referenceText.');
    }
    const questionId = String(req.body?.questionId || '').trim() || null;
    const clientContext = buildClientContext(req.body || {});
    const attemptId = randomUUID();
    const alignmentMode = getConnectedSpeechAlignmentMode();
    const promptIndex = await loadConnectedSpeechIndex().catch((error) => {
      console.warn('[ReadAloud] connected speech index unavailable:', error?.message || error);
      return null;
    });
    const promptFeatureSnapshot = questionId && promptIndex
      ? (promptIndex.byQuestionId.get(questionId) || promptIndex.byRowKey.get(`id:${questionId}`) || null)
      : null;
    const promptIndexVersion = String(promptIndex?.indexVersion || '');

    const audioValidation = validateWavUpload(req.file.buffer);
    if (!audioValidation.ok) {
      return sendError(res, 422, 'INVALID_AUDIO', 'Audio file could not be processed.', {
        reason: audioValidation.reason
      });
    }
    const audioQuality = analyzeAudioQuality(req.file.buffer);

    const azurePayload = await callAzurePronunciationAssessment(req.file.buffer, referenceText, audioValidation.sampleRate);

    const nbest = azurePayload?.NBest?.[0];
    if (!nbest) {
      return sendError(res, 502, 'AZURE_ASSESSMENT_FAILED', 'No results returned from Azure.');
    }

    const { AccuracyScore, FluencyScore, CompletenessScore, PronScore } = nbest.PronunciationAssessment || {};

    // Process words to return to frontend
    const words = (nbest.Words || []).map(word => ({
      word: word.Word,
      accuracyScore: word.PronunciationAssessment?.AccuracyScore || 0,
      errorType: word.PronunciationAssessment?.ErrorType || 'None'
    }));

    const connectedSpeechPromise = questionId
      ? callConnectedSpeechAnalysis({
          attemptId,
          questionId,
          referenceText,
          azurePayload,
          audioBuffer: req.file.buffer,
          audioQuality
        })
      : Promise.resolve({
          workerStatus: 'not_applicable',
          familyCounts: {},
          connectedSpeech: normalizeConnectedSpeechStatus({
            status: 'not_applicable',
            version: CONNECTED_SPEECH_VERSION,
            summary: { detectedCount: 0, notDetectedCount: 0, uncertainCount: 0 },
            events: []
          })
        });
    const storagePromise = uploadConnectedSpeechAudio({
      attemptId,
      buffer: req.file.buffer,
      contentType: 'audio/wav'
    });

    const [connectedSpeechSettled, storageSettled] = await Promise.allSettled([
      connectedSpeechPromise,
      storagePromise
    ]);

    const connectedSpeech = connectedSpeechSettled.status === 'fulfilled'
      ? normalizeConnectedSpeechStatus(connectedSpeechSettled.value.connectedSpeech)
      : normalizeConnectedSpeechStatus({
        status: 'unavailable',
        version: CONNECTED_SPEECH_VERSION,
        summary: { detectedCount: 0, notDetectedCount: 0, uncertainCount: 0 },
        events: []
      });
    const publicConnectedSpeech = connectedSpeech.status === 'not_rateable'
      ? normalizeConnectedSpeechStatus({
        status: 'unavailable',
        version: CONNECTED_SPEECH_VERSION,
        summary: { detectedCount: 0, notDetectedCount: 0, uncertainCount: 0 },
        events: []
      })
      : connectedSpeech;
    const alignmentMetadata = buildAlignmentMetadata(alignmentMode, publicConnectedSpeech);
    const workerStatus = connectedSpeechSettled.status === 'fulfilled'
      ? String(connectedSpeechSettled.value.workerStatus || 'unknown')
      : 'unavailable';
    const eventFamilyCounts = connectedSpeechSettled.status === 'fulfilled'
      ? (connectedSpeechSettled.value.familyCounts || {})
      : {};
    const storageResult = storageSettled.status === 'fulfilled'
      ? storageSettled.value
      : { status: 'failed', attemptId, audioPath: null, error: storageSettled.reason?.message || 'upload_failed' };

    const connectedSpeechRecord = buildConnectedSpeechAttemptRecord({
      attemptId,
      questionId,
      referenceText,
      recognizedText: String(nbest.Display || ''),
      clientContext,
      azureSummary: buildAzureSummary(nbest),
      requestedAlignmentMode: alignmentMetadata.requestedAlignmentMode,
      connectedSpeechVersion: connectedSpeech.version,
      connectedSpeechSummary: publicConnectedSpeech.summary,
      connectedSpeechEvents: publicConnectedSpeech.events,
      eventFamilyCounts,
      promptIndexVersion,
      promptFeatureSnapshot,
      scoringMode: alignmentMetadata.scoringMode,
      connectedSpeechPrimarySource: alignmentMetadata.connectedSpeechPrimarySource,
      alignmentFallbackReason: alignmentMetadata.alignmentFallbackReason,
      connectedSpeechShadow: alignmentMetadata.connectedSpeechShadow,
      workerStatus,
      audioStatus: storageResult.status,
      storageStatus: storageResult.status,
      audioPath: storageResult.audioPath || null,
      audioQuality,
      audioSampleRate: audioValidation.sampleRate,
      referenceWordCount: referenceText.split(/\s+/).filter(Boolean).length,
      recognizedWordCount: (nbest.Words || []).length
    });

    persistConnectedSpeechAttempt(connectedSpeechRecord).catch((error) => {
      console.warn('[ReadAloud] connected speech persistence failed:', error?.message || error);
    });

    return sendSuccess(res, {
      accuracyScore: Math.round(AccuracyScore || 0),
      fluencyScore: Math.round(FluencyScore || 0),
      completenessScore: Math.round(CompletenessScore || 0),
      pronScore: Math.round(PronScore || 0),
      words,
      recognizedText: nbest.Display || '',
      connectedSpeech: publicConnectedSpeech
    });

  } catch (error) {
    if (error?.code === 'INVALID_AUDIO') {
      return sendError(res, 422, 'INVALID_AUDIO', 'Audio file could not be processed.', error?.details || null);
    }
    if (error?.code === 'CONFIG_ERROR') {
      return sendError(res, 500, 'CONFIG_ERROR', 'Azure Speech credentials are not configured.');
    }
    console.error('[ReadAloud] /assess failed:', error);
    return sendError(res, 502, 'AZURE_ASSESSMENT_FAILED', 'Pronunciation assessment failed.', error?.details || null);
  }
});

module.exports = router;
