const crypto = require('crypto');
const Busboy = require('busboy');
const multer = require('multer');

const COLLECTION = 'pronunciationCorpusSamples';
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 15;
const ALLOWED_CATEGORIES = new Set(['clean', 'omission', 'insertion', 'accented', 'unrateable']);
const SAMPLE_ID_RE = /^[a-z0-9-]+$/;

class CorpusValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CorpusValidationError';
  }
}

function fail(message) {
  throw new CorpusValidationError(message);
}

function validateCorpusMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') fail('metadata requires an object.');
  const sampleId = String(metadata.sampleId || '').trim();
  const targetWord = String(metadata.targetWord || '').trim();
  const referenceIpa = String(metadata.referenceIpa || '').trim();
  const speakerCohort = String(metadata.speakerCohort || '').trim().toLowerCase();

  if (!SAMPLE_ID_RE.test(sampleId)) fail('sampleId must match ^[a-z0-9-]+$.');
  if (!targetWord) fail('targetWord must be a non-empty string.');
  if (!referenceIpa) fail('referenceIpa must be a non-empty string.');
  if (!Number.isInteger(metadata.expectedObservedCount) || metadata.expectedObservedCount < 0) {
    fail('expectedObservedCount must be a non-negative integer.');
  }
  if (!Number.isInteger(metadata.targetSyllableCount) || metadata.targetSyllableCount <= 0) {
    fail('targetSyllableCount must be a positive integer.');
  }
  if (!ALLOWED_CATEGORIES.has(metadata.category)) {
    fail(`category must be one of: ${Array.from(ALLOWED_CATEGORIES).join(', ')}`);
  }
  if (!/^[a-z0-9-]+$/.test(speakerCohort)) fail('speakerCohort must match ^[a-z0-9-]+$.');

  return {
    sampleId,
    targetWord,
    referenceIpa,
    expectedObservedCount: metadata.expectedObservedCount,
    targetSyllableCount: metadata.targetSyllableCount,
    category: metadata.category,
    speakerCohort
  };
}

function validateWavBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) fail('WAV file is too short.');
  if (buffer.length > MAX_AUDIO_BYTES) fail('Audio file size exceeds the maximum allowed limit of 5 MB.');
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    fail('Invalid file format. Only WAV format is allowed.');
  }

  let offset = 12;
  let fmt = null;
  let dataSize = null;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkEnd = offset + 8 + chunkSize;
    if (chunkEnd > buffer.length) fail('WAV file has malformed chunk boundaries.');

    if (chunkId === 'fmt ' && chunkSize >= 16 && !fmt) {
      fmt = {
        audioFormat: buffer.readUInt16LE(offset + 8),
        channels: buffer.readUInt16LE(offset + 10),
        sampleRate: buffer.readUInt32LE(offset + 12),
        blockAlign: buffer.readUInt16LE(offset + 20),
        bitsPerSample: buffer.readUInt16LE(offset + 22)
      };
    }
    if (chunkId === 'data') {
      dataSize = chunkSize;
      break;
    }
    offset = chunkEnd + (chunkSize % 2);
  }

  if (!fmt) fail('WAV file is missing a valid fmt chunk.');
  if (dataSize === null) fail('WAV file is missing the data chunk.');
  if (fmt.audioFormat !== 1) fail('Only PCM WAV format (audioFormat=1) is accepted.');
  if (fmt.channels < 1 || fmt.channels > 2) fail('WAV channel count must be 1 (mono) or 2 (stereo).');
  if (fmt.sampleRate < 1 || fmt.sampleRate > 192000) fail('WAV sample rate must be between 1 and 192000 Hz.');
  if (![8, 16, 24, 32].includes(fmt.bitsPerSample)) fail('WAV bits per sample must be 8, 16, 24, or 32.');

  const bytesPerFrame = (fmt.bitsPerSample / 8) * fmt.channels;
  if (fmt.blockAlign !== bytesPerFrame) fail('WAV block alignment does not match the sample format.');
  if (dataSize <= 0 || dataSize % bytesPerFrame !== 0) {
    fail('WAV data chunk size is not aligned to the sample frame size.');
  }

  const duration = (dataSize / bytesPerFrame) / fmt.sampleRate;
  if (!Number.isFinite(duration) || duration <= 0) fail('WAV file has zero or invalid duration.');
  if (duration > MAX_AUDIO_SECONDS) fail(`Audio duration (${duration.toFixed(2)}s) exceeds the maximum allowed limit of 15 seconds.`);

  return {
    duration,
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    bitsPerSample: fmt.bitsPerSample
  };
}

function signedUrlExpiry() {
  return Date.now() + (15 * 60 * 1000);
}

async function signAudioUrl(bucket, storagePath) {
  const [audioUrl] = await bucket.file(storagePath).getSignedUrl({
    action: 'read',
    expires: signedUrlExpiry()
  });
  return audioUrl;
}

function serializeSample(snapshot) {
  const data = snapshot.data() || {};
  const timestamp = data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : (data.createdAt || null);
  return { id: snapshot.id, ...data, createdAt: timestamp };
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
        limits: { fileSize: MAX_AUDIO_BYTES, files: 1 }
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
        const error = new Error('Audio file size exceeds the maximum allowed limit of 5 MB.');
        error.code = 'LIMIT_FILE_SIZE';
        fail(error);
        return;
      }
      settled = true;
      req.body = body;
      if (audioFile) req.file = audioFile;
      resolve();
    });

    try {
      busboy.end(req.rawBody);
    } catch (error) {
      fail(error);
    }
  });
}

function registerPronunciationCorpusRoutes(router, deps) {
  const sendSuccess = deps.sendSuccess;
  const sendError = deps.sendError;
  const requireAdminHandlers = deps.requireAdminHandlers || [];
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_AUDIO_BYTES, files: 1 }
  });
  const handleUploadError = (res, error) => {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Audio file size exceeds the maximum allowed limit of 5 MB.'
      : `Invalid audio upload${error.message ? `: ${error.message}` : '.'}`;
    return sendError(res, 400, 'INVALID_AUDIO', message);
  };
  const uploadAudio = (req, res, next) => {
    if (isMultipartRequest(req) && Buffer.isBuffer(req.rawBody)) {
      parseRawMultipartRequest(req)
        .then(() => next())
        .catch((error) => handleUploadError(res, error));
      return;
    }

    upload.single('audio')(req, res, (error) => {
      if (error) return handleUploadError(res, error);
      return next();
    });
  };

  router.post('/dev/save-corpus-sample', ...requireAdminHandlers, uploadAudio, async (req, res) => {
    try {
      if (!req.file?.buffer) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing audio file.');
      let metadata;
      try {
        metadata = JSON.parse(String(req.body?.metadata || ''));
      } catch (_) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid JSON metadata.');
      }

      const normalized = validateCorpusMetadata(metadata);
      const audio = validateWavBuffer(req.file.buffer);
      const bucket = await deps.getStorageBucket();
      if (!bucket) return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Storage is not initialized.');

      const sourceHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
      const storagePath = `pronunciation-segmentation-corpus/${normalized.sampleId}.wav`;
      await bucket.file(storagePath).save(req.file.buffer, {
        resumable: false,
        metadata: {
          contentType: 'audio/wav',
          metadata: { sampleId: normalized.sampleId, sourceHash }
        }
      });

      const createdAt = deps.serverTimestamp();
      const record = {
        ...normalized,
        sourceHash,
        storagePath,
        contentType: 'audio/wav',
        bytes: req.file.buffer.length,
        durationSeconds: audio.duration,
        sampleRate: audio.sampleRate,
        channels: audio.channels,
        bitsPerSample: audio.bitsPerSample,
        createdByUid: req.user.uid,
        createdByEmail: req.user.email || null,
        createdAt,
        updatedAt: createdAt
      };
      await deps.db.collection(COLLECTION).doc(normalized.sampleId).set(record, { merge: true });
      const audioUrl = await signAudioUrl(bucket, storagePath);
      return sendSuccess(res, {
        sample: { ...record, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        audioUrl,
        sampleId: normalized.sampleId
      }, 'Corpus sample uploaded to cloud storage.');
    } catch (error) {
      const status = error instanceof CorpusValidationError ? 400 : 500;
      return sendError(res, status, status === 400 ? 'CORPUS_SAMPLE_ERROR' : 'CORPUS_STORAGE_ERROR', error?.message || 'Failed to save corpus sample.');
    }
  });

  router.get('/dev/corpus-samples', ...requireAdminHandlers, async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 200);
      const snap = await deps.db.collection(COLLECTION).orderBy('createdAt', 'desc').limit(limit).get();
      const word = String(req.query.word || '').trim().toLowerCase();
      const category = String(req.query.category || '').trim();
      const bucket = await deps.getStorageBucket();
      const samples = await Promise.all(snap.docs
        .map(serializeSample)
        .filter((sample) => (!word || String(sample.targetWord || '').toLowerCase() === word) && (!category || sample.category === category))
        .map(async (sample) => ({ ...sample, audioUrl: bucket ? await signAudioUrl(bucket, sample.storagePath) : null })));
      return sendSuccess(res, { samples });
    } catch (error) {
      return sendError(res, 500, 'CORPUS_SAMPLE_LIST_ERROR', 'Failed to list corpus samples.');
    }
  });

  router.get('/dev/corpus-samples/:sampleId/audio', ...requireAdminHandlers, async (req, res) => {
    try {
      const sampleId = String(req.params.sampleId || '').trim();
      if (!SAMPLE_ID_RE.test(sampleId)) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid sampleId.');
      const snapshot = await deps.db.collection(COLLECTION).doc(sampleId).get();
      if (!snapshot.exists) return sendError(res, 404, 'NOT_FOUND', 'Corpus sample not found.');

      const sample = serializeSample(snapshot);
      const expectedStoragePath = `pronunciation-segmentation-corpus/${sampleId}.wav`;
      if (sample.storagePath !== expectedStoragePath) {
        return sendError(res, 404, 'AUDIO_NOT_FOUND', 'Corpus sample audio not found.');
      }

      const bucket = await deps.getStorageBucket();
      if (!bucket) return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Storage is not initialized.');
      const [audioBuffer] = await bucket.file(expectedStoragePath).download();
      res.set('Content-Type', sample.contentType || 'audio/wav');
      res.set('Cache-Control', 'no-store');
      return res.status(200).send(audioBuffer);
    } catch (error) {
      return sendError(res, 500, 'CORPUS_AUDIO_ERROR', 'Failed to retrieve corpus sample audio.');
    }
  });

  router.get('/dev/corpus-samples/:sampleId', ...requireAdminHandlers, async (req, res) => {
    try {
      const sampleId = String(req.params.sampleId || '').trim();
      if (!SAMPLE_ID_RE.test(sampleId)) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid sampleId.');
      const snapshot = await deps.db.collection(COLLECTION).doc(sampleId).get();
      if (!snapshot.exists) return sendError(res, 404, 'NOT_FOUND', 'Corpus sample not found.');
      const bucket = await deps.getStorageBucket();
      const sample = serializeSample(snapshot);
      return sendSuccess(res, { sample, audioUrl: bucket ? await signAudioUrl(bucket, sample.storagePath) : null });
    } catch (error) {
      return sendError(res, 500, 'CORPUS_SAMPLE_GET_ERROR', 'Failed to retrieve corpus sample.');
    }
  });

  router.delete('/dev/corpus-samples/:sampleId', ...requireAdminHandlers, async (req, res) => {
    try {
      const sampleId = String(req.params.sampleId || '').trim();
      if (!SAMPLE_ID_RE.test(sampleId)) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid sampleId.');
      const snapshot = await deps.db.collection(COLLECTION).doc(sampleId).get();
      if (!snapshot.exists) return sendError(res, 404, 'NOT_FOUND', 'Corpus sample not found.');

      const sample = serializeSample(snapshot);
      const bucket = await deps.getStorageBucket();
      if (bucket && sample.storagePath) {
        try {
          await bucket.file(sample.storagePath).delete();
        } catch (_storageErr) {
          // Best effort storage file cleanup
        }
      }

      await snapshot.ref.delete();
      return sendSuccess(res, { deleted: true, sampleId });
    } catch (error) {
      return sendError(res, 500, 'CORPUS_SAMPLE_DELETE_ERROR', 'Failed to delete corpus sample.');
    }
  });
}

module.exports = registerPronunciationCorpusRoutes;
module.exports.validateCorpusMetadata = validateCorpusMetadata;
module.exports.validateWavBuffer = validateWavBuffer;
