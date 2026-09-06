const express = require('express');
const multer = require('multer');
const Busboy = require('busboy');
const {
  extractWordsAndSyllablesFromAzure,
  getAzureSpeechCredentials,
  buildPronunciationAssessmentHeader
} = require('../services/pronunciation-assessment-service');
const { sendError, sendSuccess } = require('../utils/response-helper');

const router = express.Router();
const REPEAT_SENTENCE_MAX_DURATION_MS = 25000;
const REPEAT_SENTENCE_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: REPEAT_SENTENCE_UPLOAD_LIMIT_BYTES }
});

function safeJsonParse(value) {
  try { return JSON.parse(value); } catch (_) { return null; }
}

function isMultipartRequest(req) {
  return String(req.headers?.['content-type'] || '').toLowerCase().startsWith('multipart/form-data');
}

function appendMultipartField(body, fieldName, value) {
  if (Object.prototype.hasOwnProperty.call(body, fieldName)) {
    const existing = body[fieldName];
    body[fieldName] = Array.isArray(existing) ? existing.concat(value) : [existing, value];
    return;
  }
  body[fieldName] = value;
}

function parseRawMultipartRequest(req) {
  return new Promise((resolve, reject) => {
    const body = {};
    let audioFile = null;
    let audioFileTooLarge = false;
    let settled = false;

    function fail(error) {
      if (settled) return;
      settled = true;
      reject(error);
    }

    let busboy;
    try {
      busboy = Busboy({
        headers: req.headers,
        limits: {
          fileSize: REPEAT_SENTENCE_UPLOAD_LIMIT_BYTES,
          files: 1
        }
      });
    } catch (error) {
      fail(error);
      return;
    }

    busboy.on('field', (fieldName, value) => {
      appendMultipartField(body, fieldName, value);
    });

    busboy.on('file', (fieldName, stream, info = {}) => {
      if (fieldName !== 'audio' || audioFile) {
        stream.resume();
        return;
      }

      const chunks = [];
      let size = 0;
      stream.on('data', (chunk) => {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        chunks.push(buffer);
      });
      stream.on('limit', () => {
        audioFileTooLarge = true;
      });
      stream.on('error', fail);
      stream.on('end', () => {
        if (audioFileTooLarge) return;
        audioFile = {
          fieldname: fieldName,
          originalname: info.filename || '',
          encoding: info.encoding || '7bit',
          mimetype: info.mimeType || 'application/octet-stream',
          buffer: Buffer.concat(chunks),
          size
        };
      });
    });

    busboy.on('error', fail);
    busboy.on('finish', () => {
      if (settled) return;
      if (audioFileTooLarge) {
        const error = new Error('Uploaded file exceeds the allowed size.');
        error.code = 'LIMIT_FILE_SIZE';
        fail(error);
        return;
      }
      settled = true;
      resolve({ body, file: audioFile });
    });

    if (Buffer.isBuffer(req.rawBody)) {
      busboy.end(req.rawBody);
    } else if (typeof req.pipe === 'function') {
      req.pipe(busboy);
    } else {
      fail(new Error('Invalid request payload for multipart upload.'));
    }
  });
}

const parseRepeatSentenceUpload = async (req, res, next) => {
  if (req.rawBody && Buffer.isBuffer(req.rawBody)) {
    try {
      const parsed = await parseRawMultipartRequest(req);
      req.body = parsed.body;
      req.file = parsed.file;
      return next();
    } catch (error) {
      if (error?.code === 'LIMIT_FILE_SIZE') {
        return sendError(res, 413, 'LIMIT_FILE_SIZE', 'Uploaded file exceeds the allowed size.');
      }
      return sendError(res, 400, 'INVALID_UPLOAD', 'Unable to parse upload payload.');
    }
  }

  return upload.single('audio')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return sendError(res, 413, 'LIMIT_FILE_SIZE', 'Uploaded file exceeds the allowed size.');
      }
      return sendError(res, 400, 'INVALID_UPLOAD', err.message || 'File upload error.');
    }
    next();
  });
};

function readAscii(view, offset, length) {
  let text = '';
  for (let i = 0; i < length; i += 1) {
    text += String.fromCharCode(view.getUint8(offset + i));
  }
  return text;
}

function validateWavUpload(buffer) {
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

    while (offset + 8 <= buffer.length) {
      const chunkId = readAscii(view, offset, 4);
      const chunkSize = view.getUint32(offset + 4, true);
      const chunkDataOffset = offset + 8;

      if (chunkId === 'fmt ') {
        formatChunk = {
          audioFormat: view.getUint16(chunkDataOffset, true),
          channels: view.getUint16(chunkDataOffset + 2, true),
          sampleRate: view.getUint32(chunkDataOffset + 4, true),
          byteRate: view.getUint32(chunkDataOffset + 8, true),
          blockAlign: view.getUint16(chunkDataOffset + 12, true),
          bitsPerSample: view.getUint16(chunkDataOffset + 14, true)
        };
      } else if (chunkId === 'data') {
        dataChunkLength = chunkSize;
      }

      offset = chunkDataOffset + chunkSize + (chunkSize % 2);
    }

    if (!formatChunk) {
      return { ok: false, reason: 'missing_fmt' };
    }

    const bytesPerSec = formatChunk.byteRate || (formatChunk.sampleRate * formatChunk.channels * (formatChunk.bitsPerSample / 8));
    const durationMs = bytesPerSec > 0 ? (dataChunkLength / bytesPerSec) * 1000 : 0;

    if (durationMs > REPEAT_SENTENCE_MAX_DURATION_MS) {
      return { ok: false, reason: 'too_long', durationMs, maxDurationMs: REPEAT_SENTENCE_MAX_DURATION_MS };
    }

    return {
      ok: true,
      sampleRate: formatChunk.sampleRate,
      durationMs
    };
  } catch (err) {
    return { ok: false, reason: 'decode_failed', error: err.message };
  }
}

function parseMockAzurePayload() {
  const raw = String(process.env.REPEAT_SENTENCE_AZURE_MOCK_RESPONSE || process.env.READ_ALOUD_AZURE_MOCK_RESPONSE || '').trim();
  if (!raw) return null;
  return safeJsonParse(raw);
}

async function callAzurePronunciationAssessment(buffer, referenceText, sampleRate = 16000) {
  const mockPayload = parseMockAzurePayload();
  if (mockPayload) {
    return mockPayload;
  }

  const { key, region } = getAzureSpeechCredentials();
  if (!key || !region) {
    const error = new Error('Missing Azure Speech credentials.');
    error.code = 'CONFIG_ERROR';
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  const endpoint = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      body: buffer,
      headers: {
        Accept: 'application/json',
        'Content-Type': `audio/wav; codecs=audio/pcm; samplerate=${sampleRate || 16000}`,
        'Ocp-Apim-Subscription-Key': key,
        'Pronunciation-Assessment': buildPronunciationAssessmentHeader(referenceText)
      }
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

function getAzureScoreValue(node, fieldName) {
  if (!node || typeof node !== 'object' || !fieldName) return null;
  const rawValue = node?.PronunciationAssessment?.[fieldName] ?? node?.[fieldName];
  const num = Number(rawValue);
  return Number.isFinite(num) ? num : null;
}

function normalizeRoundedAzureScore(node, fieldName) {
  const score = getAzureScoreValue(node, fieldName);
  return Number.isFinite(score) ? Math.round(score) : null;
}

router.post('/repeat-sentence/assess', parseRepeatSentenceUpload, async (req, res) => {
  try {
    if (!req.file || !Buffer.isBuffer(req.file.buffer)) {
      return sendError(res, 400, 'INVALID_INPUT', 'Missing audio file.');
    }
    const referenceText = String(req.body?.referenceText || '').trim();
    if (!referenceText) {
      return sendError(res, 400, 'INVALID_INPUT', 'Missing referenceText.');
    }

    const audioValidation = validateWavUpload(req.file.buffer);
    if (!audioValidation.ok) {
      return sendError(res, 422, 'INVALID_AUDIO', 'Audio file could not be processed.', {
        reason: audioValidation.reason,
        durationMs: Number.isFinite(Number(audioValidation.durationMs)) ? Number(audioValidation.durationMs) : null,
        maxDurationMs: REPEAT_SENTENCE_MAX_DURATION_MS
      });
    }

    const azurePayload = await callAzurePronunciationAssessment(
      req.file.buffer,
      referenceText,
      audioValidation.sampleRate
    );

    const nbest = azurePayload?.NBest?.[0];
    if (!nbest) {
      return sendError(res, 502, 'AZURE_ASSESSMENT_FAILED', 'No results returned from Azure.');
    }

    const accuracyScore = normalizeRoundedAzureScore(nbest, 'AccuracyScore');
    const fluencyScore = normalizeRoundedAzureScore(nbest, 'FluencyScore');
    const completenessScore = normalizeRoundedAzureScore(nbest, 'CompletenessScore');
    const pronScore = normalizeRoundedAzureScore(nbest, 'PronScore');

    const words = extractWordsAndSyllablesFromAzure(nbest.Words || []);

    return sendSuccess(res, {
      recognizedText: String(nbest.Display || nbest.Lexical || '').trim(),
      accuracyScore: accuracyScore ?? 0,
      fluencyScore: fluencyScore ?? 0,
      completenessScore: completenessScore ?? 0,
      pronScore: pronScore ?? 0,
      words
    });
  } catch (error) {
    if (error.code === 'CONFIG_ERROR') {
      return sendError(res, 500, 'SERVER_CONFIG_ERROR', error.message);
    }
    if (error.code === 'AZURE_ASSESSMENT_FAILED') {
      return sendError(res, 502, 'AZURE_ASSESSMENT_FAILED', error.message, error.details);
    }
    return sendError(res, 500, 'SERVER_ERROR', error.message || 'Assessment failed.');
  }
});

module.exports = router;
