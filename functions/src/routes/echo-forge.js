const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { sendError, sendSuccess } = require('../utils/response-helper');

const MAX_AUDIO_BYTES = 1024 * 1024;
const MAX_REFERENCE_LENGTH = 120;
const MAX_AUDIO_DURATION_MS = 15000;
const ENGINE_REVISION = 'azure-echo-forge-stateless-v1';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 3 },
});

function buildPronunciationHeader(referenceText) {
  return Buffer.from(JSON.stringify({
    ReferenceText: referenceText,
    GradingSystem: 'HundredMark',
    Dimension: 'Comprehensive',
    Granularity: 'Word',
    EnableMiscue: true,
  })).toString('base64');
}

function loadAssessmentManifest() {
  const candidates = [
    path.join(__dirname, '..', '..', 'data', 'echo-forge', 'assessment-manifest.v1.json'),
    path.join(__dirname, '..', 'data', 'echo-forge', 'assessment-manifest.v1.json'),
  ];
  const manifestPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!manifestPath) throw new Error('Echo Forge assessment manifest is missing');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest?.schemaVersion !== 'echo-forge-assessment-manifest-v1' || !Array.isArray(manifest.challenges)) {
    throw new Error('Echo Forge assessment manifest is invalid');
  }
  return manifest;
}

function validateWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;
  if (buffer.readUInt32LE(4) + 8 !== buffer.length) return null;
  let format = null;
  let dataSize = null;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > buffer.length) return null;
    if (chunkId === 'fmt ') {
      if (chunkSize < 16) return null;
      format = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        byteRate: buffer.readUInt32LE(chunkStart + 8),
        blockAlign: buffer.readUInt16LE(chunkStart + 12),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      };
    } else if (chunkId === 'data') {
      dataSize = chunkSize;
    }
    offset = chunkEnd + (chunkSize % 2);
  }
  if (!format || !Number.isInteger(dataSize) || dataSize <= 0) return null;
  if (format.audioFormat !== 1 || format.channels !== 1 || format.bitsPerSample !== 16) return null;
  if (format.sampleRate < 8000 || format.sampleRate > 48000) return null;
  if (format.blockAlign !== 2 || format.byteRate !== format.sampleRate * 2 || dataSize % format.blockAlign !== 0) return null;
  const durationMs = dataSize / format.byteRate * 1000;
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_AUDIO_DURATION_MS) return null;
  return { sampleRate: format.sampleRate, durationMs };
}

function validateRequest(req) {
  const audio = validateWav(req.file?.buffer);
  if (!audio) return { invalidField: 'audio', audio: null };

  const challengeId = String(req.body?.challengeId || '').trim();
  const evaluationMode = String(req.body?.evaluationMode || '').trim();
  const referenceText = String(req.body?.referenceText || '').trim();
  if (!/^ef-[a-z0-9-]{8,80}$/.test(challengeId)) return { invalidField: 'challengeId', audio };
  if (!['azure_word', 'azure_phrase'].includes(evaluationMode)) return { invalidField: 'evaluationMode', audio };
  if (!referenceText || referenceText.length > MAX_REFERENCE_LENGTH || !/^[A-Za-z][A-Za-z' -]*[A-Za-z]$|^[A-Za-z]$/.test(referenceText)) return { invalidField: 'referenceText', audio };
  const wordCount = referenceText.split(/\s+/).length;
  if (evaluationMode === 'azure_word' && wordCount !== 1) return { invalidField: 'referenceText', audio };
  if (evaluationMode === 'azure_phrase' && (wordCount < 2 || wordCount > 5)) return { invalidField: 'referenceText', audio };
  return { invalidField: null, audio };
}

function aggregateScore(node, field) {
  const value = node?.PronunciationAssessment?.[field] ?? node?.[field];
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}

function createEchoForgeRouter({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20000,
  assessmentManifest = loadAssessmentManifest(),
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  const router = express.Router();
  const approvedChallenges = new Map(assessmentManifest.challenges.map((challenge) => [challenge.challengeId, challenge]));

  router.post(
    '/echo-forge/assess',
    (req, res, next) => {
      if (environment.ECHO_FORGE_SANDBOX_ENABLED !== 'true') {
        return sendError(res, 404, 'ECHO_FORGE_DISABLED', 'Echo Forge sandbox is disabled.');
      }
      return next();
    },
    upload.single('audio'),
    async (req, res) => {
      const { invalidField, audio } = validateRequest(req);
      if (invalidField) {
        return sendError(res, 400, invalidField === 'audio' ? 'INVALID_AUDIO' : 'INVALID_INPUT', 'Invalid Echo Forge assessment input.', { field: invalidField });
      }
      const approved = approvedChallenges.get(String(req.body.challengeId));
      if (!approved
        || approved.evaluationMode !== String(req.body.evaluationMode)
        || approved.referenceText !== String(req.body.referenceText)) {
        return sendError(res, 400, 'CHALLENGE_MISMATCH', 'Assessment challenge does not match the approved catalog.');
      }

      const key = String(environment.AZURE_SPEECH_KEY || '').trim();
      const region = String(environment.AZURE_SPEECH_REGION || '').trim();
      if (!key || !region) {
        return sendError(res, 503, 'AZURE_UNAVAILABLE', 'Pronunciation assessment is unavailable.');
      }

      const referenceText = approved.referenceText;
      const sampleRate = audio.sampleRate;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;
        const response = await fetchImpl(url, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            'Content-Type': `audio/wav; codecs=audio/pcm; samplerate=${sampleRate}`,
            'Ocp-Apim-Subscription-Key': key,
            'Pronunciation-Assessment': buildPronunciationHeader(referenceText),
          },
          body: req.file.buffer,
        });
        const text = await response.text();
        let payload = null;
        try { payload = JSON.parse(text); } catch { /* fail closed below */ }
        const best = payload?.NBest?.[0];
        if (!response.ok || !best) {
          return sendError(res, 502, 'AZURE_ASSESSMENT_FAILED', 'Pronunciation assessment failed.');
        }

        const accuracyScore = aggregateScore(best, 'AccuracyScore');
        const fluencyScore = aggregateScore(best, 'FluencyScore');
        const completenessScore = aggregateScore(best, 'CompletenessScore');
        if (accuracyScore === null
          || (approved.evaluationMode === 'azure_phrase' && (fluencyScore === null || completenessScore === null))) {
          return sendError(res, 422, 'AZURE_REQUIRED_SCORE_MISSING', 'Required pronunciation scores were unavailable.');
        }

        return sendSuccess(res, {
          accuracyScore,
          ...(approved.evaluationMode === 'azure_phrase' ? { fluencyScore, completenessScore } : {}),
          engineRevision: ENGINE_REVISION,
        });
      } catch (error) {
        const code = error?.name === 'AbortError' ? 'AZURE_TIMEOUT' : 'AZURE_ASSESSMENT_FAILED';
        return sendError(res, 502, code, 'Pronunciation assessment failed.');
      } finally {
        clearTimeout(timer);
      }
    },
  );

  router.use((error, _req, res, next) => {
    if (error instanceof multer.MulterError) {
      return sendError(res, 400, 'INVALID_AUDIO', 'Invalid Echo Forge audio upload.');
    }
    return next(error);
  });

  return router;
}

module.exports = { createEchoForgeRouter };
