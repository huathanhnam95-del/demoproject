const express = require('express');
const multer = require('multer');
const { sendError, sendSuccess } = require('../utils/response-helper');

const router = express.Router();
const ASQ_TRANSCRIBE_TIMEOUT_MS = 20000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

function safeJsonParse(value) {
  try { return JSON.parse(value); } catch (_) { return null; }
}

function readAscii(view, offset, length) {
  let text = '';
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(view.getUint8(offset + index));
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

    while (offset + 8 <= view.byteLength) {
      const chunkId = readAscii(view, offset, 4);
      const chunkSize = view.getUint32(offset + 4, true);
      const chunkStart = offset + 8;
      const chunkEnd = chunkStart + chunkSize;
      if (chunkEnd > view.byteLength) {
        return { ok: false, reason: 'decode_failed' };
      }

      if (chunkId === 'fmt ') {
        if (chunkSize < 16) return { ok: false, reason: 'decode_failed' };
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

    // PCM, mono, 16-bit only (matches Read Aloud expectations)
    if (formatChunk.audioFormat !== 1 || formatChunk.channelCount !== 1 || formatChunk.bitsPerSample !== 16) {
      return { ok: false, reason: 'decode_failed' };
    }

    return {
      ok: true,
      sampleRate: formatChunk.sampleRate || 16000
    };
  } catch (_) {
    return { ok: false, reason: 'decode_failed' };
  }
}

async function callAzureSpeechToText(buffer, sampleRate) {
  const key = String(process.env.AZURE_SPEECH_KEY || '').trim();
  const region = String(process.env.AZURE_SPEECH_REGION || '').trim();

  if (!key || !region) {
    const error = new Error('Missing Azure Speech credentials.');
    error.code = 'CONFIG_ERROR';
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ASQ_TRANSCRIBE_TIMEOUT_MS);
  const endpoint = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': `audio/wav; codecs=audio/pcm; samplerate=${sampleRate || 16000}`,
        'Ocp-Apim-Subscription-Key': key
      },
      body: buffer
    });

    const text = await response.text();
    const payload = safeJsonParse(text);
    if (!response.ok || !payload) {
      const error = new Error('Speech-to-text failed.');
      error.code = 'AZURE_STT_FAILED';
      error.details = { status: response.status, body: text.slice(0, 400) };
      throw error;
    }

    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('Speech-to-text timed out.');
      timeoutError.code = 'AZURE_STT_FAILED';
      timeoutError.details = { reason: 'timeout' };
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function extractTranscript(payload) {
  const best = payload?.NBest?.[0];
  const transcript = String(best?.Display || payload?.DisplayText || payload?.Text || '').trim();
  return transcript || null;
}

router.post('/asq/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file || !Buffer.isBuffer(req.file.buffer)) {
      return sendError(res, 400, 'INVALID_INPUT', 'Missing audio file.');
    }

    const audioValidation = validateWavUpload(req.file.buffer);
    if (!audioValidation.ok) {
      return sendError(res, 422, 'INVALID_AUDIO', 'Audio file could not be processed.', {
        reason: audioValidation.reason
      });
    }

    const azurePayload = await callAzureSpeechToText(req.file.buffer, audioValidation.sampleRate);
    const transcript = extractTranscript(azurePayload);
    if (!transcript) {
      return sendError(res, 502, 'AZURE_STT_FAILED', 'No transcript returned from Azure.');
    }

    return sendSuccess(res, {
      transcript
    });
  } catch (error) {
    const code = String(error?.code || '');
    if (code === 'CONFIG_ERROR') {
      return sendError(res, 500, 'CONFIG_ERROR', 'Speech-to-text is not configured.');
    }
    if (code === 'AZURE_STT_FAILED') {
      return sendError(res, 502, 'AZURE_STT_FAILED', error.message || 'Speech-to-text failed.', error.details || null);
    }
    return sendError(res, 500, 'INTERNAL_ERROR', error.message || 'Unexpected error.');
  }
});

module.exports = router;

