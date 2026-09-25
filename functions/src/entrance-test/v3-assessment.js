'use strict';

const crypto = require('crypto');
const { createAudioManifest, parseCanonicalWav } = require('../services/azure-speech/audio-manifest');
const { assessFixedReference } = require('../services/azure-speech/continuous-assessment');

const MAX_SECONDS = 180;
const DEADLINE_MS = 15 * 60 * 1000;

function revisionRef(db, revisionId) { return db.collection('entranceSpeechOutbox').doc(revisionId); }
function testRef(db, testId) { return db.collection('entranceTests').doc(testId); }
function speakingEntry(test, questionId) { return test?.speaking?.[questionId] || null; }

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const ENVELOPE_TYPE = 'application/vnd.bel.speech-v3+json';

function safeAudioType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (!/^audio\/(?:webm|ogg|wav|x-wav|wave|mp4|mpeg|aac)(?:;\s*codecs=[a-z0-9.,_-]+)?$/.test(type))
    throw new Error('INVALID_ORIGINAL_AUDIO_TYPE');
  return type;
}

function decodeAudioBase64(value) {
  if (typeof value !== 'string' || !value.length || value.length > 4 * Math.ceil(MAX_AUDIO_BYTES / 3) ||
      value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new Error('INVALID_AUDIO_BASE64');
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > MAX_AUDIO_BYTES || bytes.toString('base64') !== value)
    throw new Error('INVALID_AUDIO_BASE64');
  return bytes;
}

function parseEntranceV3Upload(body, contentType) {
  if (String(contentType || '').split(';')[0].trim().toLowerCase() !== ENVELOPE_TYPE)
    return { audioBuffer: body, originalAudioBuffer: body, originalContentType: 'audio/wav' };
  if (!Buffer.isBuffer(body) || body.length > 24 * 1024 * 1024) throw new Error('INVALID_AUDIO_ENVELOPE');
  let payload;
  try { payload = JSON.parse(body.toString('utf8')); } catch (_) { throw new Error('INVALID_AUDIO_ENVELOPE'); }
  if (!payload || payload.version !== 1 || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('INVALID_AUDIO_ENVELOPE');
  const originalContentType = safeAudioType(payload.originalMimeType);
  const originalAudioBuffer = decodeAudioBase64(payload.originalBase64);
  const audioBuffer = decodeAudioBase64(payload.assessmentBase64);
  parseCanonicalWav(audioBuffer);
  return { audioBuffer, originalAudioBuffer, originalContentType };
}

async function uploadEntranceV3({ db, bucket, testId, questionId, question, data, audioBuffer,
  originalAudioBuffer = audioBuffer, originalContentType = 'audio/wav' }) {
  const parsed = parseCanonicalWav(audioBuffer);
  if (!Buffer.isBuffer(originalAudioBuffer) || !originalAudioBuffer.length ||
      originalAudioBuffer.length > MAX_AUDIO_BYTES || audioBuffer.length > MAX_AUDIO_BYTES)
    throw new Error('INVALID_ORIGINAL_AUDIO');
  const originalType = safeAudioType(originalContentType);
  if (parsed.sampleCount > MAX_SECONDS * 16000) throw new Error('AUDIO_TOO_LONG');
  const owner = String(data.studentId || data.leadId || '').trim();
  if (!owner) throw new Error('ENTRANCE_OWNER_REQUIRED');
  const revisionId = crypto.randomUUID();
  const scope = data.studentId ? 'crmStudents' : 'crmLeads';
  const path = `${scope}/${owner}/entranceTests/${testId}/speaking/${questionId}/v3/${revisionId}.wav`;
  const originalPath = path.replace(/\.wav$/, '.original');
  const originalFile = bucket.file(originalPath);
  await originalFile.save(originalAudioBuffer, { resumable: false, contentType: originalType,
    preconditionOpts: { ifGenerationMatch: 0 } });
  const [originalMetadata] = await originalFile.getMetadata();
  if (!originalMetadata?.generation) throw new Error('ORIGINAL_STORAGE_GENERATION_MISSING');
  const file = bucket.file(path);
  await file.save(audioBuffer, { resumable: false, contentType: 'audio/wav',
    preconditionOpts: { ifGenerationMatch: 0 } });
  const [metadata] = await file.getMetadata();
  if (!metadata?.generation) throw new Error('STORAGE_GENERATION_MISSING');
  const manifest = createAudioManifest(audioBuffer, { storageGeneration: String(metadata.generation), originalUploadBuffer: originalAudioBuffer });
  const now = new Date().toISOString();
  const entry = {
    audio: { bucketName: bucket.name || null, storagePath: originalPath, contentType: originalType,
      bytes: originalAudioBuffer.length, generation: String(originalMetadata.generation),
      sha256: manifest.originalUploadHash },
    v3: { audio: { bucketName: bucket.name || null, storagePath: path, contentType: 'audio/wav',
      bytes: audioBuffer.length, generation: manifest.storageGeneration }, revisionId, status: 'queued', manifest, referenceText: question.expectedText,
      referenceRevision: crypto.createHash('sha256').update(question.expectedText).digest('hex'),
      createdAt: now, deadlineAt: new Date(Date.now() + DEADLINE_MS).toISOString() },
    transcript: null, words: null, accuracyPercent: null, accuracyScore: null,
    wordMatchAccuracy: null, asrError: null, uploadedAt: now
  };
  await db.runTransaction(async tx => {
    const ref = testRef(db, testId);
    const snap = await tx.get(ref);
    if (!snap.exists || ['submitted', 'revoked'].includes(snap.data().status)) throw new Error('TEST_LINK_USED');
    tx.update(ref, { [`speaking.${questionId}`]: entry,
      status: snap.data().status === 'created' ? 'started' : (snap.data().status || 'started'),
      startedAt: snap.data().startedAt || now, updatedAt: now });
    tx.create(revisionRef(db, revisionId), { revisionId, testId, questionId, status: 'pending',
      attempts: 0, deadlineAt: entry.v3.deadlineAt, createdAt: now, updatedAt: now });
  });
  return { revisionId, manifest };
}

async function getEntranceV3Status({ db, bucket, testId, questionId }) {
  const snap = await testRef(db, testId).get();
  if (!snap.exists) throw new Error('TEST_NOT_FOUND');
  const entry = speakingEntry(snap.data(), questionId);
  if (!entry?.v3) return null;
  const result = entry.v3.status === 'ready' && entry.v3.resultRef
    ? await readResult(bucket, entry.v3.resultRef, entry.v3.revisionId) : null;
  return { revisionId: entry.v3.revisionId, status: entry.v3.status,
    error: entry.v3.error || null, result };
}

async function readResult(bucket, ref, revisionId) {
  const file = bucket.file(ref.path);
  const [metadata] = await file.getMetadata();
  if (String(metadata.generation) !== ref.generation) throw new Error('ENTRANCE_RESULT_GENERATION_CHANGED');
  const [bytes] = await file.download();
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== ref.sha256) throw new Error('ENTRANCE_RESULT_HASH_CHANGED');
  const result = JSON.parse(bytes.toString('utf8'));
  if (result.revisionId !== revisionId) throw new Error('ENTRANCE_RESULT_REVISION_CHANGED');
  return result;
}

async function processEntranceV3({ db, bucket, revisionId, assess = assessFixedReference }) {
  const leaseId = crypto.randomUUID();
  const acquired = await db.runTransaction(async tx => {
    const outRef = revisionRef(db, revisionId);
    const outSnap = await tx.get(outRef);
    if (!outSnap.exists) return null;
    const out = outSnap.data();
    const ref = testRef(db, out.testId);
    const testSnap = await tx.get(ref);
    const entry = speakingEntry(testSnap.data(), out.questionId);
    if (!entry || entry.v3?.revisionId !== revisionId || entry.v3.status === 'ready') {
      tx.delete(outRef); return null;
    }
    const now = Date.now();
    if (out.status === 'processing' && Date.parse(out.leaseExpiresAt) > now) return null;
    if (out.attempts >= 3 || Date.parse(out.deadlineAt) <= now) return { expired: true, out };
    tx.update(outRef, { status: 'processing', leaseId, attempts: Number(out.attempts || 0) + 1,
      leaseExpiresAt: new Date(now + 10 * 60 * 1000).toISOString(), updatedAt: new Date(now).toISOString() });
    return { out, entry, testId: out.testId, questionId: out.questionId };
  });
  if (!acquired) return { skipped: true };
  if (acquired.expired) return failEntranceV3({ db, revisionId, reason: 'DEADLINE_OR_ATTEMPTS_EXHAUSTED', leaseId: null });
  const { out, entry, testId, questionId } = acquired;
  try {
    const scoringAudio = entry.v3.audio || entry.audio;
    const file = bucket.file(scoringAudio.storagePath);
    const [metadata] = await file.getMetadata();
    if (String(metadata.generation) !== entry.v3.manifest.storageGeneration) throw new Error('ENTRANCE_AUDIO_GENERATION_CHANGED');
    const [audioBuffer] = await file.download();
    const manifest = { ...createAudioManifest(audioBuffer, { storageGeneration: String(metadata.generation) }),
      originalUploadHash: entry.v3.manifest.originalUploadHash || null };
    if (manifest.canonicalFileHash !== entry.v3.manifest.canonicalFileHash) throw new Error('ENTRANCE_AUDIO_HASH_CHANGED');
    const path = `entrance-speech-results/${testId}/${revisionId}.json`;
    const resultFile = bucket.file(path);
    const [stored] = await resultFile.exists();
    if (!stored) {
      const result = await assess({ mode: 'entrance_test', referenceText: entry.v3.referenceText,
        audioBuffer, audioIdentity: manifest, attemptId: revisionId });
      if (result.status !== 'completed' || !result.coverage?.scoredWordCount) throw new Error('ENTRANCE_UNRATEABLE');
      result.revisionId = revisionId;
      result.audio = manifest;
      result.reference = { kind: 'entrance_question', questionId,
        text: entry.v3.referenceText, revision: entry.v3.referenceRevision };
      try { await resultFile.save(Buffer.from(JSON.stringify(result)), { resumable: false,
        contentType: 'application/json', preconditionOpts: { ifGenerationMatch: 0 } }); }
      catch (error) { if (Number(error.code) !== 412) throw error; }
    }
    const [saved] = await resultFile.download();
    const savedResult = JSON.parse(saved.toString('utf8'));
    if (savedResult.revisionId !== revisionId || savedResult.audio?.canonicalFileHash !== manifest.canonicalFileHash ||
        savedResult.reference?.revision !== entry.v3.referenceRevision ||
        savedResult.status !== 'completed' || !savedResult.coverage?.scoredWordCount)
      throw new Error('ENTRANCE_STORED_RESULT_CHANGED');
    const [resultMetadata] = await resultFile.getMetadata();
    const resultRef = { path, generation: String(resultMetadata.generation),
      sha256: crypto.createHash('sha256').update(saved).digest('hex') };
    const outcome = await db.runTransaction(async tx => {
      const outRef = revisionRef(db, revisionId);
      const current = await tx.get(outRef);
      const ref = testRef(db, testId);
      const test = await tx.get(ref);
      const latest = speakingEntry(test.data(), questionId);
      if (!current.exists || current.data().leaseId !== leaseId || latest?.v3?.revisionId !== revisionId) return 'stale';
      if (Date.parse(current.data().deadlineAt) <= Date.now()) throw new Error('ENTRANCE_DEADLINE_EXPIRED');
      tx.update(ref, { [`speaking.${questionId}.v3.status`]: 'ready',
        [`speaking.${questionId}.v3.resultRef`]: resultRef,
        [`speaking.${questionId}.v3.completedAt`]: new Date().toISOString(),
        [`speaking.${questionId}.transcript`]: savedResult.recognizedText,
        [`speaking.${questionId}.accuracyScore`]: savedResult.overallScores?.accuracyScore ?? null,
        [`speaking.${questionId}.accuracyPercent`]: savedResult.overallScores?.accuracyScore ?? null,
        updatedAt: new Date().toISOString() });
      tx.delete(outRef);
      return 'ready';
    });
    return { status: outcome };
  } catch (error) {
    await failEntranceV3({ db, revisionId, reason: error.message || 'ASSESSMENT_FAILED', leaseId });
    return { status: 'failed', error: error.message };
  }
}

async function failEntranceV3({ db, revisionId, reason, leaseId }) {
  return db.runTransaction(async tx => {
    const ref = revisionRef(db, revisionId);
    const snap = await tx.get(ref);
    if (!snap.exists || (leaseId && snap.data().leaseId !== leaseId)) return { skipped: true };
    const out = snap.data();
    const testDoc = testRef(db, out.testId);
    const test = await tx.get(testDoc);
    const current = speakingEntry(test.data(), out.questionId);
    const terminal = !leaseId || out.attempts >= 3 || Date.parse(out.deadlineAt) <= Date.now() || reason === 'ENTRANCE_UNRATEABLE';
    if (current?.v3?.revisionId === revisionId) {
      tx.update(testDoc, { [`speaking.${out.questionId}.v3.status`]: terminal ? 'failed' : 'queued',
        [`speaking.${out.questionId}.v3.error`]: reason, updatedAt: new Date().toISOString() });
    }
    if (terminal) tx.delete(ref);
    else tx.update(ref, { status: 'pending', leaseId: null, leaseExpiresAt: null,
      retryAfterAt: new Date(Date.now() + 10000).toISOString(), lastError: reason });
    return { status: terminal ? 'failed' : 'queued' };
  });
}

async function reconcileEntranceV3({ db, dispatch, limit = 100 }) {
  const docs = await db.collection('entranceSpeechOutbox').limit(limit).get();
  const summary = { examined: 0, dispatched: 0, failed: 0 };
  for (const doc of docs.docs) {
    summary.examined++;
    const out = doc.data();
    if (out.status === 'processing' && Date.parse(out.leaseExpiresAt) > Date.now()) continue;
    if (Date.parse(out.retryAfterAt) > Date.now() || Date.parse(out.dispatchedAt) > Date.now() - 60000) continue;
    if (out.attempts >= 3 || Date.parse(out.deadlineAt) <= Date.now()) {
      await failEntranceV3({ db, revisionId: doc.id, reason: 'DEADLINE_OR_ATTEMPTS_EXHAUSTED', leaseId: null });
      continue;
    }
    try {
      await dispatch(doc.id);
      await doc.ref.update({ status: 'pending', dispatchedAt: new Date().toISOString() });
      summary.dispatched++;
    } catch (error) {
      await doc.ref.update({ lastDispatchError: String(error.message || error), updatedAt: new Date().toISOString() });
      summary.failed++;
    }
  }
  return summary;
}

module.exports = { parseEntranceV3Upload, uploadEntranceV3, getEntranceV3Status, processEntranceV3, reconcileEntranceV3 };
