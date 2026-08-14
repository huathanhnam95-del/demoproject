const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const {
  normalizeTimingSegments,
  parseRawMultipartRequest,
  validateCorpusMetadata,
  validateManualReviewMetadata,
  buildManualReviewRecord,
  validateWavBuffer
} = require('./pronunciation-corpus');

const TASK_COLLECTION = 'pronunciationSegmentationStudyTasks';
const CORPUS_COLLECTION = 'pronunciationCorpusSamples';
const AUDIO_HASH_COLLECTION = 'pronunciationSegmentationStudyAudioHashes';
const STUDY_VERSION = 'study-v1';
const PUBLIC_STUDY_VERSION = 'v1';
const TASK_ID_RE = /^[a-z0-9][a-z0-9-]{0,120}$/;
const SESSION_ID_RE = /^[a-z0-9][a-z0-9_-]{11,79}$/i;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_METADATA_BYTES = 640 * 1024;
const MAX_TASKS = 200;
const CLAIM_MINUTES = 10;
const MAX_MANIFEST_ENTRIES = 1000;

function cleanString(value, maxLength = 200) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function timestampMillis(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function serializeTimestamp(value) {
  const millis = timestampMillis(value);
  return millis ? new Date(millis).toISOString() : (value || null);
}

function serializeData(value) {
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date || typeof value.toDate === 'function' || typeof value.toMillis === 'function') {
    return serializeTimestamp(value);
  }
  if (Array.isArray(value)) return value.map(serializeData);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeData(item)]));
}

function normalizeReferenceSyllables(value, count) {
  if (!Array.isArray(value)) return null;
  const syllables = value.map((item) => cleanString(item, 120)).filter(Boolean);
  return syllables.length === count ? syllables : null;
}

function normalizeTransitionClasses(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanString(item, 80)).filter(Boolean).slice(0, 32);
}

function normalizeManifestEntry(entry, index) {
  const value = entry && typeof entry === 'object' ? entry : {};
  const targetWord = cleanString(value.targetWord || value.word, 120).toLowerCase();
  const targetSyllableCount = Number(value.targetSyllableCount || value.syllableCount);
  if (!targetWord || !Number.isInteger(targetSyllableCount) || targetSyllableCount < 2 || targetSyllableCount > 5) {
    return null;
  }
  const order = Number.isInteger(value.order) && value.order >= 0 ? value.order : index;
  const taskId = cleanString(value.taskId || `study-v1-${String(order + 1).padStart(3, '0')}`, 128).toLowerCase();
  if (!TASK_ID_RE.test(taskId)) return null;
  const split = value.split === 'holdout' ? 'holdout' : (value.split === 'development' ? 'development' : (order < 70 ? 'development' : 'holdout'));
  return {
    taskId,
    order,
    split,
    targetWord,
    referenceIpa: cleanString(value.referenceIpa || value.ipa, 300),
    referenceSyllableIpa: normalizeReferenceSyllables(value.referenceSyllableIpa || value.referenceSyllables, targetSyllableCount),
    targetSyllableCount,
    expectedObservedCount: Number.isInteger(value.expectedObservedCount) ? value.expectedObservedCount : targetSyllableCount,
    transitionClasses: normalizeTransitionClasses(value.transitionClasses || value.transitionTypes || value.transitionFamilies || value.boundaryContexts),
    ipaSource: cleanString(value.ipaSource, 120) || null,
    category: cleanString(value.category, 40) || 'clean',
    speakerCohort: cleanString(value.speakerCohort, 80) || 'segmentation-study-v1',
    labelProvenance: cleanString(value.labelProvenance, 80) || 'deterministic-transform',
    source: cleanString(value.source || 'segmentation-study-manifest-v1', 160)
  };
}

function normalizeManifest(value) {
  const entries = Array.isArray(value) ? value : (Array.isArray(value?.entries) ? value.entries : []);
  const seen = new Set();
  return entries
    .map((entry, index) => normalizeManifestEntry(entry, index))
    .filter((entry) => {
      if (!entry || seen.has(entry.taskId) || seen.has(`word:${entry.targetWord}`)) return false;
      seen.add(entry.taskId);
      seen.add(`word:${entry.targetWord}`);
      return true;
    })
    .sort((left, right) => left.order - right.order || left.taskId.localeCompare(right.taskId))
    .slice(0, MAX_MANIFEST_ENTRIES)
    .map((entry, index) => ({ ...entry, order: index }));
}

function readManifestFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const manifest = normalizeManifest(parsed);
    return manifest.length ? manifest : null;
  } catch (_) {
    return null;
  }
}

function resolveStudyManifest(deps) {
  if (deps.studyManifest) {
    const supplied = typeof deps.studyManifest === 'function' ? deps.studyManifest() : deps.studyManifest;
    const manifest = normalizeManifest(supplied);
    if (manifest.length) return manifest;
  }

  const candidateFiles = [
    path.resolve(__dirname, '../../data/segmentation-study-v1.json'),
    path.resolve(process.cwd(), 'scripts/data/segmentation-study-v1.json'),
    path.resolve(process.cwd(), 'test-results/segmentation-study-v1.json'),
    path.resolve(__dirname, '../../../../scripts/data/segmentation-study-v1.json'),
    path.resolve(__dirname, '../../../../tests/fixtures/pronunciation-segmentation/manifest.json')
  ];
  for (const candidate of candidateFiles) {
    const manifest = readManifestFile(candidate);
    if (manifest?.length) {
      // The legacy corpus manifest can contain repeated recordings of the same
      // word. Keep the first deterministic entry for each word and cap the
      // study at the requested 100 entries when a study manifest is absent.
      return manifest.filter((entry) => entry.targetSyllableCount >= 2 && entry.targetSyllableCount <= 5).slice(0, 100);
    }
  }
  throw new Error('The fixed segmentation-study-v1 manifest is unavailable. Run scripts/segmentation-study/sync-manifest.js before starting or deploying Functions.');
}

function claimExpiry(now = Date.now()) {
  return new Date(now + CLAIM_MINUTES * 60 * 1000);
}

function claimIsActive(task, now = Date.now()) {
  return task?.status === 'reserved' && timestampMillis(task.claimExpiresAt) > now;
}

function ownerMatches(task, operatorName, sessionId) {
  return task?.claim?.operatorName === operatorName && task?.claim?.sessionId === sessionId;
}

function normalizeIdentity(body) {
  const operatorName = cleanString(body?.operatorName, 80);
  const sessionId = cleanString(body?.sessionId, 80);
  if (!operatorName) throw Object.assign(new Error('operatorName is required.'), { status: 400, code: 'VALIDATION_ERROR' });
  if (!SESSION_ID_RE.test(sessionId)) throw Object.assign(new Error('sessionId must contain 12-80 letters, numbers, hyphens, or underscores.'), { status: 400, code: 'VALIDATION_ERROR' });
  return { operatorName, sessionId };
}

function serializeTask(snapshotOrData, fallbackId = null) {
  const data = typeof snapshotOrData?.data === 'function' ? (snapshotOrData.data() || {}) : (snapshotOrData || {});
  const id = snapshotOrData?.id || data.taskId || fallbackId;
  return serializeData({
    ...data,
    id,
    taskId: data.taskId || id,
    claimExpiresAt: data.claimExpiresAt || null,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    completedAt: data.completedAt || null
  });
}

function safeJson(value, maxBytes = 450 * 1024) {
  if (value == null) return null;
  try {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > maxBytes) return null;
    return value;
  } catch (_) {
    return null;
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
}

function completionFingerprint(sourceHash, metadata) {
  return crypto.createHash('sha256')
    .update(sourceHash)
    .update('\n')
    .update(JSON.stringify(canonicalJson(metadata)))
    .digest('hex');
}

function firstTimingArray(...values) {
  for (const value of values) {
    if (!Array.isArray(value) || !value.length) continue;
    try {
      return normalizeTimingSegments(value, 'automaticSegments');
    } catch (_) {
      // A malformed candidate is not copied into the authoritative corpus
      // fields; the original comparison remains available under analysis.
    }
  }
  return [];
}

function extractAnalysisVariant(metadata, version) {
  const comparison = metadata.comparison || metadata.analysis || null;
  const v3 = comparison?.v3?.analysis || comparison?.analysis?.v3 || comparison?.v3 || null;
  const variants = v3?.partitionVariants || comparison?.partitionVariants || {};
  const direct = metadata[version];
  return direct || variants?.[version] || (version === 'v2' ? comparison?.v2?.analysis || comparison?.v2 : null) || null;
}

function sampleIdForTask(taskId, sourceHash) {
  return `${taskId}-${String(sourceHash || '').slice(0, 16)}`.toLowerCase();
}

function uploadMiddleware(deps) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_AUDIO_BYTES, files: 1 }
  });
  return (req, res, next) => {
    const contentType = String(req.headers?.['content-type'] || '').toLowerCase();
    if (contentType.startsWith('multipart/form-data') && Buffer.isBuffer(req.rawBody)) {
      parseRawMultipartRequest(req).then(() => next()).catch((error) => deps.sendError(
        res,
        400,
        'INVALID_AUDIO',
        error?.message || 'Invalid audio upload.'
      ));
      return;
    }
    upload.single('audio')(req, res, (error) => {
      if (error) return deps.sendError(res, 400, 'INVALID_AUDIO', error.message || 'Invalid audio upload.');
      return next();
    });
  };
}

  async function listPreviousSamples(db, deps) {
  const supplied = typeof deps.previousSamples === 'function' ? await deps.previousSamples() : deps.previousSamples;
  const result = [];
  if (Array.isArray(supplied)) result.push(...supplied);

  try {
    const snapshot = await db.collection(CORPUS_COLLECTION).limit(500).get();
    snapshot.docs.forEach((doc) => {
      const data = doc.data() || {};
      if (data.studyPreviousSample === true || data.previousSample === true || data.studySource === 'previous-sample' || data.sourceKind === 'pronounce-local-sample') {
        result.push({ id: doc.id, ...data });
      }
    });
  } catch (_) {
    // A missing optional corpus collection should not make the study queue
    // unavailable; the explicit dependency can still provide prior samples.
  }

  const seen = new Set();
  return result.map((item) => ({
    ...serializeData(item),
    id: item.id || item.sampleId,
    taskId: item.taskId || item.sampleId || item.id,
    status: item.status || item.reviewStatus || (item.manualSegments?.length ? 'complete' : 'available')
  })).filter((item) => {
    const id = String(item.taskId || '').trim();
    const sourceHash = String(item.sourceHash || item.audioSha256 || '').trim().toLowerCase();
    if (!id) return false;
    const key = sourceHash ? `sha256:${sourceHash}` : `id:${id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 200);
}

function registerSegmentationStudyRoutes(router, deps) {
  const { db, sendSuccess, sendError, requireAdminHandlers = [], serverTimestamp } = deps;
  const uploadAudio = uploadMiddleware(deps);
  let manifestCache = null;

  async function getManifest() {
    if (!manifestCache) manifestCache = await resolveStudyManifest(deps);
    return manifestCache;
  }

  function validateVersion(version) {
    const normalized = cleanString(version, 40);
    if (![PUBLIC_STUDY_VERSION, STUDY_VERSION].includes(normalized)) {
      const error = new Error('Unknown segmentation study version.');
      error.status = 404;
      error.code = 'STUDY_NOT_FOUND';
      throw error;
    }
    return normalized;
  }

  async function readTasks() {
    const snapshot = await db.collection(TASK_COLLECTION)
      .where('studyVersion', '==', STUDY_VERSION)
      .limit(MAX_TASKS)
      .get();
    return snapshot.docs
      .map((doc) => serializeTask(doc))
      .sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
  }

  function buildProgress(tasks) {
    const progress = { available: 0, reserved: 0, completed: 0, uncertain: 0, failed: 0 };
    tasks.forEach((task) => {
      const status = claimIsActive(task) ? 'reserved' : (task.status === 'reserved' ? 'available' : task.status);
      if (Object.prototype.hasOwnProperty.call(progress, status)) progress[status] += 1;
      if (task.certainty === 'uncertain' || task.reviewStatus === 'uncertain') progress.uncertain += 1;
      if (task.analysisStatus === 'analysis_failed' || task.status === 'analysis_failed') progress.failed += 1;
    });
    return progress;
  }

  router.get('/dev/segmentation-study/:studyVersion', ...requireAdminHandlers, async (req, res) => {
    try {
      validateVersion(req.params.studyVersion);
      const manifest = await getManifest();
      const tasks = await readTasks();
      const identity = req.query?.sessionId ? {
        operatorName: cleanString(req.query.operatorName, 80),
        sessionId: cleanString(req.query.sessionId, 80)
      } : null;
      const currentClaim = identity?.sessionId
        ? tasks.find((task) => claimIsActive(task) && ownerMatches(task, identity.operatorName, identity.sessionId)) || null
        : null;
      return sendSuccess(res, {
        studyVersion: STUDY_VERSION,
        manifest: manifest.map((entry) => serializeData(entry)),
        tasks,
        previousSamples: await listPreviousSamples(db, deps),
        progress: buildProgress(tasks),
        currentClaim
      });
    } catch (error) {
      const status = error?.status || 500;
      return sendError(res, status, error?.code || 'SEGMENTATION_STUDY_LIST_ERROR', error?.message || 'Failed to load segmentation study.');
    }
  });

  router.post('/dev/segmentation-study/:studyVersion/claim-next', ...requireAdminHandlers, async (req, res) => {
    try {
      validateVersion(req.params.studyVersion);
      const identity = normalizeIdentity(req.body || {});
      const existingTasks = await readTasks();
      const existing = existingTasks.find((task) => claimIsActive(task) && ownerMatches(task, identity.operatorName, identity.sessionId));
      if (existing) return sendSuccess(res, { task: existing, claim: existing }, 'Existing segmentation study claim resumed.');

      const candidateSnapshots = await db.collection(TASK_COLLECTION)
        .where('studyVersion', '==', STUDY_VERSION)
        .where('status', 'in', ['available', 'reserved'])
        .orderBy('order', 'asc')
        .limit(MAX_TASKS)
        .get();
      const candidates = candidateSnapshots.docs
        .map((doc) => ({ doc, task: doc.data() || {} }))
        .sort((left, right) => Number(left.task.order || 0) - Number(right.task.order || 0));

      for (const candidate of candidates) {
        const ref = candidate.doc.ref || db.collection(TASK_COLLECTION).doc(candidate.doc.id);
        let claimed = null;
        await db.runTransaction(async (tx) => {
          const snapshot = await tx.get(ref);
          if (!snapshot.exists) return;
          const task = snapshot.data() || {};
          if (task.status === 'completed') return;
          if (claimIsActive(task) && !ownerMatches(task, identity.operatorName, identity.sessionId)) return;
          const now = Date.now();
          const next = {
            status: 'reserved',
            claim: { operatorName: identity.operatorName, sessionId: identity.sessionId, claimedAt: new Date(now) },
            claimExpiresAt: claimExpiry(now),
            updatedAt: serverTimestamp()
          };
          tx.set(ref, next, { merge: true });
          claimed = serializeTask({ id: snapshot.id, data: () => ({ ...task, ...next }) });
        });
        if (claimed) return sendSuccess(res, { task: claimed, claim: claimed }, 'Segmentation study task reserved.');
      }
      return sendError(res, 409, 'NO_TASK_AVAILABLE', 'No segmentation study word is currently available.');
    } catch (error) {
      const status = error?.status || (error?.message?.includes('required') ? 400 : 500);
      return sendError(res, status, error?.code || 'SEGMENTATION_STUDY_CLAIM_ERROR', error?.message || 'Failed to reserve a segmentation study task.');
    }
  });

  router.post('/dev/segmentation-study/:studyVersion/tasks/:taskId/heartbeat', ...requireAdminHandlers, async (req, res) => {
    try {
      validateVersion(req.params.studyVersion);
      const identity = normalizeIdentity(req.body || {});
      const taskId = cleanString(req.params.taskId, 128);
      if (!TASK_ID_RE.test(taskId)) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid taskId.');
      const ref = db.collection(TASK_COLLECTION).doc(taskId);
      let result = null;
      await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) throw Object.assign(new Error('Segmentation study task not found.'), { status: 404, code: 'TASK_NOT_FOUND' });
        const task = snapshot.data() || {};
        if (!claimIsActive(task) || !ownerMatches(task, identity.operatorName, identity.sessionId)) {
          throw Object.assign(new Error('This task reservation has expired or belongs to another operator.'), { status: 409, code: 'CLAIM_EXPIRED' });
        }
        const next = { claimExpiresAt: claimExpiry(), updatedAt: serverTimestamp() };
        tx.set(ref, next, { merge: true });
        result = serializeTask({ id: snapshot.id, data: () => ({ ...task, ...next }) });
      });
      return sendSuccess(res, { task: result, claim: result }, 'Segmentation study reservation extended.');
    } catch (error) {
      return sendError(res, error?.status || 500, error?.code || 'SEGMENTATION_STUDY_HEARTBEAT_ERROR', error?.message || 'Failed to extend the segmentation study reservation.');
    }
  });

  router.post('/dev/segmentation-study/:studyVersion/tasks/:taskId/release', ...requireAdminHandlers, async (req, res) => {
    try {
      validateVersion(req.params.studyVersion);
      const identity = normalizeIdentity(req.body || {});
      const taskId = cleanString(req.params.taskId, 128);
      if (!TASK_ID_RE.test(taskId)) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid taskId.');
      const ref = db.collection(TASK_COLLECTION).doc(taskId);
      let released = null;
      await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) throw Object.assign(new Error('Segmentation study task not found.'), { status: 404, code: 'TASK_NOT_FOUND' });
        const task = snapshot.data() || {};
        if (task.status === 'completed') throw Object.assign(new Error('Completed tasks cannot be released.'), { status: 409, code: 'TASK_COMPLETED' });
        if (!ownerMatches(task, identity.operatorName, identity.sessionId)) {
          throw Object.assign(new Error('This task reservation belongs to another operator.'), { status: 409, code: 'CLAIM_CONFLICT' });
        }
        const next = {
          status: 'available',
          claim: null,
          claimExpiresAt: null,
          updatedAt: serverTimestamp()
        };
        tx.set(ref, next, { merge: true });
        released = serializeTask({ id: snapshot.id, data: () => ({ ...task, ...next }) });
      });
      return sendSuccess(res, { task: released }, 'Segmentation study task released.');
    } catch (error) {
      return sendError(res, error?.status || 500, error?.code || 'SEGMENTATION_STUDY_RELEASE_ERROR', error?.message || 'Failed to release the segmentation study task.');
    }
  });

  router.post('/dev/segmentation-study/:studyVersion/tasks/:taskId/complete', ...requireAdminHandlers, uploadAudio, async (req, res) => {
    let storagePath = null;
    let transactionCommitted = false;
    try {
      validateVersion(req.params.studyVersion);
      const taskId = cleanString(req.params.taskId, 128);
      if (!TASK_ID_RE.test(taskId)) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid taskId.');
      if (!req.file?.buffer) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing audio file.');
      const rawMetadata = String(req.body?.metadata || '');
      if (!rawMetadata) return sendError(res, 400, 'VALIDATION_ERROR', 'Missing JSON metadata.');
      if (Buffer.byteLength(rawMetadata, 'utf8') > MAX_METADATA_BYTES) return sendError(res, 400, 'VALIDATION_ERROR', 'Metadata exceeds the 640 KB limit.');
      let metadata;
      try { metadata = JSON.parse(rawMetadata); } catch (_) { return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid JSON metadata.'); }
      const identity = normalizeIdentity({
        operatorName: req.body?.operatorName || metadata.operatorName,
        sessionId: req.body?.sessionId || metadata.sessionId
      });
      if (metadata.studyVersion !== STUDY_VERSION || cleanString(metadata.taskId, 128) !== taskId) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Metadata studyVersion and taskId must match the request.');
      }
      if (metadata.automaticBoundariesVisible !== true) return sendError(res, 400, 'VALIDATION_ERROR', 'automaticBoundariesVisible must be true for study samples.');
      const certainty = cleanString(metadata.certainty || 'uncertain', 20).toLowerCase();
      if (!['certain', 'uncertain'].includes(certainty)) return sendError(res, 400, 'VALIDATION_ERROR', 'certainty must be certain or uncertain.');

      const audio = validateWavBuffer(req.file.buffer);
      const sourceHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
      const requestFingerprint = completionFingerprint(sourceHash, metadata);
      const taskRef = db.collection(TASK_COLLECTION).doc(taskId);
      const taskSnapshot = await taskRef.get();
      if (!taskSnapshot.exists) return sendError(res, 404, 'TASK_NOT_FOUND', 'Segmentation study task not found.');
      const task = taskSnapshot.data() || {};
      if (task.status === 'completed') {
        if (task.sourceHash === sourceHash && task.completionFingerprint === requestFingerprint && task.completedSampleId) {
          const sampleSnapshot = await db.collection(CORPUS_COLLECTION).doc(task.completedSampleId).get();
          return sendSuccess(res, { task: serializeTask(taskSnapshot), sample: sampleSnapshot.exists ? serializeData({ id: sampleSnapshot.id, ...sampleSnapshot.data() }) : null, idempotent: true }, 'Segmentation study task was already completed.');
        }
        return sendError(res, 409, 'TASK_COMPLETED', 'This segmentation study task has already been completed.');
      }
      if (!claimIsActive(task) || !ownerMatches(task, identity.operatorName, identity.sessionId)) return sendError(res, 409, 'CLAIM_EXPIRED', 'This task reservation has expired or belongs to another operator.');
      if (cleanString(metadata.targetWord, 120).toLowerCase() !== cleanString(task.targetWord, 120).toLowerCase()) return sendError(res, 400, 'VALIDATION_ERROR', 'targetWord does not match the claimed task.');
      const targetSyllableCount = Number(task.targetSyllableCount);
      if (Number(metadata.targetSyllableCount) !== targetSyllableCount || Number(metadata.expectedObservedCount) !== targetSyllableCount) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'Metadata syllable counts do not match the claimed task.');
      }
      if (metadata.referenceSyllableIpa != null && (!Array.isArray(metadata.referenceSyllableIpa) || metadata.referenceSyllableIpa.length !== targetSyllableCount)) {
        return sendError(res, 400, 'VALIDATION_ERROR', 'referenceSyllableIpa must match the claimed task syllable count.');
      }
      const manualSegments = normalizeTimingSegments(metadata.manualSegments, 'manualSegments');
      if (!manualSegments?.length || manualSegments.length !== targetSyllableCount) return sendError(res, 400, 'VALIDATION_ERROR', 'manualSegments must contain one contiguous segment per target syllable.');
      if (manualSegments.some((segment) => segment.endTime > audio.duration + 0.02)) return sendError(res, 400, 'VALIDATION_ERROR', 'manualSegments must fall within the uploaded audio duration.');

      const corpusMetadata = {
        sampleId: sampleIdForTask(taskId, sourceHash),
        targetWord: task.targetWord,
        referenceIpa: task.referenceIpa || metadata.referenceIpa || `/${task.targetWord}/`,
        expectedObservedCount: targetSyllableCount,
        targetSyllableCount,
        category: 'clean',
        speakerCohort: 'segmentation-study-v1',
        needsManualReview: certainty === 'uncertain',
        reviewReason: certainty === 'uncertain' ? 'operator_uncertain' : null,
        segmentationConvention: metadata.manualSegmentationConvention || 'ipa-phonological-contiguous-v1',
        referenceSyllableIpa: task.referenceSyllableIpa || metadata.referenceSyllableIpa || null,
        automaticSegmentationConvention: 'segmentation-study-v1-automatic',
        analysisRevision: cleanString(metadata.analysisRevision || metadata.comparison?.revisions?.v3 || 'segmentation-study-v1', 200),
        sourceComparisonId: cleanString(metadata.sourceComparisonId || metadata.comparison?.comparisonId, 200) || null,
        manualSegments,
        automaticSegments: firstTimingArray(metadata.automaticSegments, metadata.v4, metadata.v3, extractAnalysisVariant(metadata, 'v4'), extractAnalysisVariant(metadata, 'v3'))
      };
      const normalized = validateCorpusMetadata(corpusMetadata);
      const bucket = await deps.getStorageBucket();
      if (!bucket) return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Storage is not initialized.');
      const sampleId = normalized.sampleId;
      storagePath = `pronunciation-segmentation-corpus/${sampleId}.wav`;
      await bucket.file(storagePath).save(req.file.buffer, {
        resumable: false,
        metadata: { contentType: 'audio/wav', metadata: { sampleId, sourceHash, studyVersion: STUDY_VERSION, taskId } }
      });

      const now = serverTimestamp();
      const reviewMetadata = validateManualReviewMetadata({
        manualSegments: normalized.manualSegments,
        manualSegmentationConvention: normalized.segmentationConvention,
        certainty,
        automaticBoundariesVisible: true,
        reviewerName: identity.operatorName,
        reviewerSessionId: identity.sessionId,
        analysisRevision: normalized.analysisRevision
      }, {
        expectedObservedCount: targetSyllableCount,
        durationSeconds: audio.duration
      });
      const reviewRecord = buildManualReviewRecord({
        sampleId,
        normalized: reviewMetadata,
        createdAt: now,
        createdByUid: req.user?.uid || null,
        createdByEmail: req.user?.email || null,
        extra: {
          studyVersion: STUDY_VERSION,
          taskId,
          sourceHash
        }
      });
      const sampleRecord = {
        ...normalized,
        studyVersion: STUDY_VERSION,
        taskId,
        studyTaskOrder: Number.isInteger(task.order) ? task.order : null,
        split: task.split || null,
        transitionClasses: Array.isArray(task.transitionClasses) ? task.transitionClasses : [],
        operatorName: identity.operatorName,
        operatorSessionId: identity.sessionId,
        certainty,
        reviewStatus: certainty === 'uncertain' ? 'uncertain' : 'complete',
        needsManualReview: certainty === 'uncertain',
        reviewReason: certainty === 'uncertain' ? 'operator_uncertain' : null,
        automaticBoundariesVisible: true,
        analysisStatus: cleanString(metadata.analysisStatus || 'complete', 40) === 'analysis_failed' ? 'analysis_failed' : 'complete',
        analysisError: cleanString(metadata.analysisError, 300) || null,
        analysis: safeJson(metadata.comparison || metadata.analysis),
        partitionVariants: safeJson({
          v2: extractAnalysisVariant(metadata, 'v2'),
          v3: extractAnalysisVariant(metadata, 'v3'),
          v4: extractAnalysisVariant(metadata, 'v4')
        }),
        rawCtcSpans: safeJson(metadata.rawCtcSpans || metadata.ctcSpans || metadata.comparison?.v3?.analysis?.observed_syllables || null),
        measurementSpans: safeJson(metadata.measurementSpans || metadata.comparison?.v3?.analysis?.measurementSpans || null),
        sourceHash,
        completionFingerprint: requestFingerprint,
        storagePath,
        contentType: 'audio/wav',
        bytes: req.file.buffer.length,
        durationSeconds: audio.duration,
        sampleRate: audio.sampleRate,
        channels: audio.channels,
        bitsPerSample: audio.bitsPerSample,
        activeManualReviewId: reviewRecord.reviewId,
        manualReviewCount: 1,
        createdByUid: req.user?.uid || null,
        createdByEmail: req.user?.email || null,
        createdAt: now,
        updatedAt: now
      };
      const sampleRef = db.collection(CORPUS_COLLECTION).doc(sampleId);
      const reviewRef = sampleRef.collection('manualReviews').doc(reviewRecord.reviewId);
      const audioHashRef = db.collection(AUDIO_HASH_COLLECTION).doc(sourceHash);
      let resultTask = null;
      await db.runTransaction(async (tx) => {
        const [currentSnapshot, existingReviewSnapshot, existingAudioHashSnapshot] = await Promise.all([
          tx.get(taskRef),
          tx.get(reviewRef),
          tx.get(audioHashRef)
        ]);
        if (!currentSnapshot.exists) throw Object.assign(new Error('Segmentation study task not found.'), { status: 404, code: 'TASK_NOT_FOUND' });
        const currentTask = currentSnapshot.data() || {};
        if (currentTask.status === 'completed') {
          if (currentTask.sourceHash === sourceHash && currentTask.completionFingerprint === requestFingerprint && currentTask.completedSampleId === sampleId) return;
          throw Object.assign(new Error('This segmentation study task has already been completed.'), { status: 409, code: 'TASK_COMPLETED' });
        }
        if (!claimIsActive(currentTask) || !ownerMatches(currentTask, identity.operatorName, identity.sessionId)) {
          throw Object.assign(new Error('This task reservation has expired or belongs to another operator.'), { status: 409, code: 'CLAIM_EXPIRED' });
        }
        if (existingReviewSnapshot.exists) {
          throw Object.assign(new Error('This manual review already exists for the claimed sample.'), { status: 409, code: 'REVIEW_CONFLICT' });
        }
        if (existingAudioHashSnapshot.exists && existingAudioHashSnapshot.data()?.sampleId !== sampleId) {
          throw Object.assign(new Error('This WAV is already assigned to another segmentation study sample.'), { status: 409, code: 'DUPLICATE_AUDIO' });
        }
        tx.set(audioHashRef, {
          sourceHash,
          sampleId,
          studyVersion: STUDY_VERSION,
          taskId,
          createdAt: now
        }, { merge: false });
        tx.set(reviewRef, reviewRecord, { merge: false });
        tx.set(sampleRef, sampleRecord, { merge: false });
        const taskPatch = {
          status: 'completed',
          claim: null,
          claimExpiresAt: null,
          completedSampleId: sampleId,
          sourceHash,
          completionFingerprint: requestFingerprint,
          certainty,
          reviewStatus: certainty === 'uncertain' ? 'uncertain' : 'complete',
          analysisStatus: sampleRecord.analysisStatus,
          completedAt: now,
          updatedAt: now
        };
        tx.set(taskRef, taskPatch, { merge: true });
        resultTask = serializeTask({ id: currentSnapshot.id, data: () => ({ ...currentTask, ...taskPatch }) });
      });
      transactionCommitted = true;
      const [audioUrl] = await bucket.file(storagePath).getSignedUrl({ action: 'read', expires: Date.now() + (15 * 60 * 1000) });
      const responseSample = {
        ...sampleRecord,
        id: sampleId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      return sendSuccess(res, { task: resultTask, sample: serializeData(responseSample), sampleId, audioUrl }, 'Segmentation study sample saved.');
    } catch (error) {
      if (storagePath && !transactionCommitted) {
        try { const bucket = await deps.getStorageBucket(); await bucket?.file(storagePath).delete(); } catch (_) { /* best effort cleanup */ }
      }
      const status = error?.status || (error?.name === 'CorpusValidationError' ? 400 : 500);
      return sendError(res, status, error?.code || (status === 400 ? 'SEGMENTATION_STUDY_VALIDATION_ERROR' : 'SEGMENTATION_STUDY_COMPLETE_ERROR'), error?.message || 'Failed to complete the segmentation study task.');
    }
  });
}

module.exports = registerSegmentationStudyRoutes;
module.exports.TASK_COLLECTION = TASK_COLLECTION;
module.exports.CORPUS_COLLECTION = CORPUS_COLLECTION;
module.exports.AUDIO_HASH_COLLECTION = AUDIO_HASH_COLLECTION;
module.exports.STUDY_VERSION = STUDY_VERSION;
module.exports.PUBLIC_STUDY_VERSION = PUBLIC_STUDY_VERSION;
module.exports.normalizeManifest = normalizeManifest;
module.exports.resolveStudyManifest = resolveStudyManifest;
module.exports.claimIsActive = claimIsActive;
