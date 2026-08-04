const crypto = require('crypto');
const multer = require('multer');

const {
  normalizeTimingSegments,
  parseRawMultipartRequest,
  validateWavBuffer
} = require('./pronunciation-corpus');

const COLLECTION = 'pronunciation_analysis_comparisons';
const STORAGE_PREFIX = 'pronunciation-analysis-comparisons';
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_METADATA_BYTES = 640 * 1024;
const MAX_ANALYSIS_JSON_BYTES = 256 * 1024;
const COMPARISON_ID_RE = /^[0-9a-f]{32}$/;
const JUDGMENTS = new Set(['v2', 'v3', 'tie', 'neither']);
const STATUSES = new Set(['complete', 'partial_failure']);

class ComparisonValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ComparisonValidationError';
  }
}

function fail(message) {
  throw new ComparisonValidationError(message);
}

function requirePlainObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${fieldName} must be an object.`);
  return value;
}

function analysisJsonSize(value, fieldName) {
  let serialized;
  try {
    serialized = JSON.stringify(value ?? null);
  } catch (_) {
    fail(`${fieldName} must be JSON serializable.`);
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_ANALYSIS_JSON_BYTES) {
    fail(`${fieldName} analysis JSON exceeds the 256 KB limit.`);
  }
  return value ?? null;
}

function validateComparisonMetadata(metadata, audio = {}) {
  requirePlainObject(metadata, 'metadata');
  if (metadata.schemaVersion !== 'pronunciation-comparison-save-v1') {
    fail('schemaVersion must be pronunciation-comparison-save-v1.');
  }
  const comparisonId = String(metadata.comparisonId || '').trim();
  if (!COMPARISON_ID_RE.test(comparisonId)) fail('comparisonId must be a 32-character hexadecimal ID.');
  const status = String(metadata.status || '').trim();
  if (!STATUSES.has(status)) fail('status must be complete or partial_failure.');

  const context = requirePlainObject(metadata.context, 'context');
  const targetWord = String(context.targetWord || '').trim();
  const referenceIpa = String(context.referenceIpa || '').trim();
  const expectedSyllables = Number(context.expectedSyllables);
  if (!targetWord) fail('context.targetWord must be a non-empty string.');
  if (!referenceIpa) fail('context.referenceIpa must be a non-empty string.');
  if (!Number.isInteger(expectedSyllables) || expectedSyllables < 1 || expectedSyllables > 20) {
    fail('context.expectedSyllables must be an integer between 1 and 20.');
  }

  const revisions = requirePlainObject(metadata.revisions, 'revisions');
  const analyses = requirePlainObject(metadata.analyses, 'analyses');
  const normalizedAnalyses = {};
  for (const version of ['v2', 'v3']) {
    const envelope = requirePlainObject(analyses[version], `analyses.${version}`);
    const engineStatus = String(envelope.status || '').trim();
    if (!['available', 'unavailable'].includes(engineStatus)) {
      fail(`analyses.${version}.status must be available or unavailable.`);
    }
    normalizedAnalyses[version] = {
      status: engineStatus,
      reason: envelope.reason ? String(envelope.reason).slice(0, 120) : null,
      analysis: analysisJsonSize(envelope.analysis, `analyses.${version}`)
    };
  }

  const judgment = metadata.judgment === null || metadata.judgment === undefined
    ? null
    : String(metadata.judgment).trim();
  if (status === 'complete') {
    if (normalizedAnalyses.v2.status !== 'available' || normalizedAnalyses.v3.status !== 'available') {
      fail('complete comparisons require both analyses to be available.');
    }
    if (!JUDGMENTS.has(judgment)) fail('judgment must be one of: v2, v3, tie, neither.');
  } else if (judgment !== null) {
    fail('partial_failure comparisons cannot include a judgment.');
  }

  const manualSegments = normalizeTimingSegments(metadata.manualSegments, 'manualSegments') || [];
  const duration = Number(audio.duration);
  if (Number.isFinite(duration) && manualSegments.some((segment) => segment.endTime > duration + 0.02)) {
    fail('manualSegments must fall within the uploaded audio duration.');
  }

  return {
    ...metadata,
    comparisonId,
    status,
    context: {
      targetWord,
      referenceIpa,
      expectedSyllables,
      variantId: context.variantId ? String(context.variantId).slice(0, 200) : null,
      requestReferenceId: context.requestReferenceId ? String(context.requestReferenceId).slice(0, 200) : null
    },
    revisions: {
      comparisonSchema: String(revisions.comparisonSchema || '').slice(0, 120),
      v2: String(revisions.v2 || '').slice(0, 120),
      v3: String(revisions.v3 || '').slice(0, 120),
      v3Model: revisions.v3Model ? String(revisions.v3Model).slice(0, 200) : null
    },
    judgment,
    manualSegments,
    analyses: normalizedAnalyses
  };
}

function isMultipartRequest(req) {
  return String(req.headers?.['content-type'] || '').toLowerCase().startsWith('multipart/form-data');
}

function registerPronunciationComparisonRoutes(router, deps) {
  const sendSuccess = deps.sendSuccess;
  const sendError = deps.sendError;
  const requireAdminHandlers = deps.requireAdminHandlers || [];
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_AUDIO_BYTES, files: 1 }
  });

  const uploadAudio = (req, res, next) => {
    if (isMultipartRequest(req) && Buffer.isBuffer(req.rawBody)) {
      parseRawMultipartRequest(req).then(() => next()).catch((error) => sendError(
        res,
        400,
        'INVALID_AUDIO',
        error?.message || 'Invalid audio upload.'
      ));
      return;
    }
    upload.single('audio')(req, res, (error) => {
      if (error) return sendError(res, 400, 'INVALID_AUDIO', error.message || 'Invalid audio upload.');
      return next();
    });
  };

  router.post('/dev/save-analysis-comparison', ...requireAdminHandlers, uploadAudio, async (req, res) => {
    let storagePath = null;
    try {
      if (!req.file?.buffer) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing audio file.');
      const rawMetadata = String(req.body?.metadata || '');
      if (!rawMetadata) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing JSON metadata.');
      if (Buffer.byteLength(rawMetadata, 'utf8') > MAX_METADATA_BYTES) {
        return sendError(res, 400, 'COMPARISON_VALIDATION_ERROR', 'Metadata exceeds the 640 KB limit.');
      }

      let metadata;
      try {
        metadata = JSON.parse(rawMetadata);
      } catch (_) {
        return sendError(res, 400, 'COMPARISON_VALIDATION_ERROR', 'Invalid JSON metadata.');
      }

      const audio = validateWavBuffer(req.file.buffer);
      const normalized = validateComparisonMetadata(metadata, audio);
      const bucket = await deps.getStorageBucket();
      if (!bucket) return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Storage is not initialized.');

      const sourceHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
      storagePath = `${STORAGE_PREFIX}/${normalized.comparisonId}.wav`;
      await bucket.file(storagePath).save(req.file.buffer, {
        resumable: false,
        metadata: {
          contentType: 'audio/wav',
          metadata: { comparisonId: normalized.comparisonId, sourceHash }
        }
      });

      const createdAt = deps.serverTimestamp();
      const record = {
        comparisonId: normalized.comparisonId,
        schemaVersion: normalized.schemaVersion,
        status: normalized.status,
        context: normalized.context,
        revisions: normalized.revisions,
        judgment: normalized.judgment,
        manualSegments: normalized.manualSegments,
        analyses: normalized.analyses,
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
      try {
        await deps.db.collection(COLLECTION).doc(normalized.comparisonId).set(record, { merge: false });
      } catch (firestoreError) {
        try { await bucket.file(storagePath).delete(); } catch (_cleanupError) { /* best effort */ }
        throw firestoreError;
      }

      const audioUrl = await bucket.file(storagePath).getSignedUrl({
        action: 'read',
        expires: Date.now() + (15 * 60 * 1000)
      });
      return sendSuccess(res, {
        comparisonId: normalized.comparisonId,
        record: {
          ...record,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        audioUrl: Array.isArray(audioUrl) ? audioUrl[0] : audioUrl
      }, 'Pronunciation comparison saved.');
    } catch (error) {
      if (storagePath && error?.name === 'ComparisonValidationError') {
        try { await deps.getStorageBucket().then((bucket) => bucket?.file(storagePath).delete()); } catch (_cleanupError) { /* best effort */ }
      }
      const status = error?.name === 'ComparisonValidationError' || error?.name === 'CorpusValidationError' ? 400 : 500;
      return sendError(
        res,
        status,
        status === 400 ? 'COMPARISON_VALIDATION_ERROR' : 'COMPARISON_STORAGE_ERROR',
        error?.message || 'Failed to save pronunciation comparison.'
      );
    }
  });
}

module.exports = registerPronunciationComparisonRoutes;
module.exports.COLLECTION = COLLECTION;
module.exports.STORAGE_PREFIX = STORAGE_PREFIX;
module.exports.validateComparisonMetadata = validateComparisonMetadata;
module.exports.validateWavBuffer = validateWavBuffer;
module.exports.MAX_ANALYSIS_JSON_BYTES = MAX_ANALYSIS_JSON_BYTES;
