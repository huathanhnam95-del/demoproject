const crypto = require('crypto');
const multer = require('multer');
const { COLLECTION } = require('../../pronunciation-reference-audio/service');

const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const KEY_RE = /^[a-f0-9]{40}$/;
const VARIANT_RE = /^[a-f0-9]{16}$/;

class ReferenceAudioGenerationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReferenceAudioGenerationError';
  }
}

function fail(message) {
  throw new ReferenceAudioGenerationError(message);
}

function validateGenerationMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Generation metadata must be an object.');
  const result = {
    schemaVersion: String(value.schemaVersion || '').trim(),
    referenceAudioKey: String(value.referenceAudioKey || '').trim(),
    variantId: String(value.variantId || '').trim(),
    voice: String(value.voice || '').trim(),
    modelRevision: String(value.modelRevision || '').trim().slice(0, 120),
    generatorRevision: String(value.generatorRevision || '').trim().slice(0, 120),
    controlledPhonemes: String(value.controlledPhonemes || '').trim().slice(0, 300),
    durationMs: Number(value.durationMs)
  };
  if (result.schemaVersion !== 'pronunciation-reference-audio-generation-v1') fail('Invalid generation schema version.');
  if (!KEY_RE.test(result.referenceAudioKey)) fail('Invalid referenceAudioKey.');
  if (!VARIANT_RE.test(result.variantId)) fail('Invalid variantId.');
  if (result.voice !== 'af_heart') fail('Generated reference audio must use af_heart.');
  if (!result.modelRevision || !result.generatorRevision || !result.controlledPhonemes) fail('Generation provenance is incomplete.');
  if (!Number.isFinite(result.durationMs) || result.durationMs < 200 || result.durationMs > 5000) fail('Generated duration must be between 200 and 5000 ms.');
  return result;
}

function isMp3(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4) return false;
  return bytes.subarray(0, 3).toString('ascii') === 'ID3'
    || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
}

function confirmUploadedAudio(expectedBytes, uploadedBytes) {
  const expected = crypto.createHash('sha256').update(expectedBytes).digest('hex');
  const actual = crypto.createHash('sha256').update(uploadedBytes).digest('hex');
  if (expected !== actual) fail('Uploaded generated audio hash confirmation failed.');
  return actual;
}

function buildGeneratedAudioPatch({ metadata, bytes, storagePath, verification, now = new Date() }) {
  const normalized = validateGenerationMetadata(metadata);
  if (!isMp3(bytes)) fail('Generated audio must be a valid MP3 stream.');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const expectedPath = `pronunciation-reference-audio/v1/${normalized.referenceAudioKey}/${sha256}.mp3`;
  if (storagePath !== expectedPath) fail('Generated audio storage path does not match its identity.');
  if (verification?.variantId !== normalized.variantId) fail('Verification variant does not match generated audio.');
  if (verification?.pitchProcessing?.version !== 'canonical-pitch-v1') fail('Generated audio used an obsolete pitch processor.');
  if (verification?.audioCompatibility?.version !== 'reference-audio-compatibility-v1') fail('Generated audio used an obsolete compatibility processor.');
  if (verification?.audioCompatibility?.status !== 'compatible') fail('Generated audio is not compatible with the requested pronunciation.');
  return {
    generationStatus: 'generated',
    verificationStatus: 'passed',
    generatedAudio: {
      storagePath,
      sha256,
      bytes: bytes.length,
      durationMs: normalized.durationMs,
      voice: normalized.voice,
      modelRevision: normalized.modelRevision,
      generatorRevision: normalized.generatorRevision,
      controlledPhonemes: normalized.controlledPhonemes,
      generatedAt: now
    },
    verification: {
      pitchProcessing: verification.pitchProcessing,
      audioCompatibility: verification.audioCompatibility,
      verifiedAt: now
    },
    referenceAnalysis: {
      ...verification,
      graphSource: {
        ...(verification.graphSource || {}),
        kind: 'measured-generated',
        label: 'Measured generated reference',
        measured: true,
        version: 'canonical-pitch-v1'
      }
    },
    lastError: null,
    updatedAt: now
  };
}

function buildGenerationFailurePatch(reason, now = new Date()) {
  return {
    generationStatus: 'waiting',
    verificationStatus: 'failed',
    lastError: String(reason || 'GENERATION_VERIFICATION_FAILED').slice(0, 240),
    updatedAt: now
  };
}

async function defaultVerifyGeneratedAudio({ bytes, record }) {
  const backendUrl = String(process.env.PRAAT_BACKEND_URL || 'https://praat-api-1071929245506.us-central1.run.app').replace(/\/+$/, '');
  const form = new FormData();
  form.append('audio', new Blob([bytes], { type: 'audio/mpeg' }), 'reference.mp3');
  form.append('variantId', record.variantId);
  form.append('expectedSyllableCount', String(record.syllableCount));
  form.append('referenceIpa', record.displayIpa);
  form.append('referencePrimaryStress', String(record.primaryStress));
  form.append('referenceSyllables', JSON.stringify(record.syllables || []));
  form.append('partOfSpeech', record.partOfSpeech || '');
  const response = await fetch(`${backendUrl}/analyze-reference/v2`, { method: 'POST', body: form });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) fail(payload?.error || 'Generated audio verification service unavailable.');
  return payload;
}

function serialize(doc) {
  const data = typeof doc.data === 'function' ? doc.data() : doc;
  return { id: doc.id || data.referenceAudioKey, ...data };
}

function registerPronunciationReferenceAudioRoutes(router, deps) {
  const handlers = deps.requireAdminHandlers || [];
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AUDIO_BYTES, files: 1 } });
  const verifyGeneratedAudio = deps.verifyGeneratedAudio || defaultVerifyGeneratedAudio;

  router.get('/dev/reference-audio-queue', ...handlers, async (req, res) => {
    try {
      const snapshot = await deps.db.collection(COLLECTION).orderBy('updatedAt', 'desc').limit(200).get();
      let items = snapshot.docs.map(serialize);
      const status = String(req.query.status || '').trim();
      if (status) items = items.filter((item) => item.generationStatus === status);
      return deps.sendSuccess(res, { items });
    } catch (error) {
      return deps.sendError(res, 500, 'REFERENCE_AUDIO_QUEUE_LIST_ERROR', error?.message || 'Failed to list reference audio queue.');
    }
  });

  router.get('/dev/reference-audio-queue/manifest', ...handlers, async (_req, res) => {
    try {
      const snapshot = await deps.db.collection(COLLECTION).orderBy('updatedAt', 'desc').limit(500).get();
      const items = snapshot.docs.map(serialize).filter((item) => item.generationStatus === 'waiting');
      return deps.sendSuccess(res, { schemaVersion: 'pronunciation-reference-audio-manifest-v1', items });
    } catch (error) {
      return deps.sendError(res, 500, 'REFERENCE_AUDIO_MANIFEST_ERROR', error?.message || 'Failed to build reference audio manifest.');
    }
  });

  router.post('/dev/reference-audio-queue/:referenceAudioKey/generated-audio', ...handlers, upload.single('audio'), async (req, res) => {
    const key = String(req.params.referenceAudioKey || '').trim();
    if (!KEY_RE.test(key)) return deps.sendError(res, 400, 'VALIDATION_ERROR', 'Invalid referenceAudioKey.');
    if (!req.file?.buffer) return deps.sendError(res, 400, 'VALIDATION_ERROR', 'Missing generated MP3.');
    const ref = deps.db.collection(COLLECTION).doc(key);
    const snapshot = await ref.get();
    if (!snapshot.exists) return deps.sendError(res, 404, 'NOT_FOUND', 'Reference audio queue item not found.');
    let metadata;
    try {
      metadata = validateGenerationMetadata(JSON.parse(String(req.body?.metadata || '')));
      if (metadata.referenceAudioKey !== key || metadata.variantId !== snapshot.data().variantId) fail('Generation metadata does not match queue item.');
      const verification = await verifyGeneratedAudio({ bytes: req.file.buffer, record: snapshot.data(), metadata });
      const sha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
      const storagePath = `pronunciation-reference-audio/v1/${key}/${sha256}.mp3`;
      const patch = buildGeneratedAudioPatch({ metadata, bytes: req.file.buffer, storagePath, verification });
      const bucket = await deps.getStorageBucket();
      const storageFile = bucket.file(storagePath);
      await storageFile.save(req.file.buffer, { resumable: false, metadata: { contentType: 'audio/mpeg', metadata: { referenceAudioKey: key, sha256 } } });
      const [confirmedBytes] = await storageFile.download();
      confirmUploadedAudio(req.file.buffer, confirmedBytes);
      await ref.set(patch, { merge: true });
      return deps.sendSuccess(res, { referenceAudioKey: key, ...patch }, 'Generated pronunciation audio verified and published.');
    } catch (error) {
      await ref.set(buildGenerationFailurePatch(error?.message), { merge: true });
      const status = error?.name === 'ReferenceAudioGenerationError' ? 422 : 500;
      return deps.sendError(res, status, 'REFERENCE_AUDIO_GENERATION_FAILED', error?.message || 'Generated pronunciation audio failed verification.');
    }
  });

  router.get('/dev/reference-audio-queue/:referenceAudioKey/audio', ...handlers, async (req, res) => {
    const key = String(req.params.referenceAudioKey || '').trim();
    if (!KEY_RE.test(key)) return deps.sendError(res, 400, 'VALIDATION_ERROR', 'Invalid referenceAudioKey.');
    const snapshot = await deps.db.collection(COLLECTION).doc(key).get();
    const path = snapshot.exists ? snapshot.data()?.generatedAudio?.storagePath : null;
    if (!path) return deps.sendError(res, 404, 'AUDIO_NOT_FOUND', 'Generated pronunciation audio not found.');
    const bucket = await deps.getStorageBucket();
    const [bytes] = await bucket.file(path).download();
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'private, max-age=300');
    return res.status(200).send(bytes);
  });
}

module.exports = registerPronunciationReferenceAudioRoutes;
module.exports.ReferenceAudioGenerationError = ReferenceAudioGenerationError;
module.exports.buildGeneratedAudioPatch = buildGeneratedAudioPatch;
module.exports.buildGenerationFailurePatch = buildGenerationFailurePatch;
module.exports.confirmUploadedAudio = confirmUploadedAudio;
module.exports.validateGenerationMetadata = validateGenerationMetadata;
