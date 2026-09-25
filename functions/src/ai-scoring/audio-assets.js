'use strict';

const crypto = require('crypto');
const { createAudioManifest, parseCanonicalWav } = require('../services/azure-speech/audio-manifest');
const { getModeConstraints, normalizePracticeMode } = require('../practice-attempts/attempt-constraints');
const { resolvePackageForMode } = require('../ai-credits/rate-card');

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const STAGED_TTL_MS = 48 * 60 * 60 * 1000;

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fail(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}

function safeId(value) {
  const text = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(text)) fail('INVALID_ATTEMPT_OR_UPLOAD_KEY');
  return text;
}

class AudioAssetService {
  constructor({ db, getBucket }) {
    this.db = db;
    this.getBucket = getBucket;
  }

  getRef(audioId) {
    return this.db.collection('aiScoringAudio').doc(audioId);
  }

  async upload({ uid, mode, attemptId, uploadKey, buffer }) {
    if (!uid) fail('UNAUTHORIZED', 401);
    const canonicalMode = normalizePracticeMode(mode);
    const constraints = getModeConstraints(canonicalMode);
    if (!constraints || !resolvePackageForMode(canonicalMode)) fail('UNSUPPORTED_MODE');
    const attempt = safeId(attemptId);
    const key = safeId(uploadKey);
    const attemptRef = this.db.collection('speakingAttempts').doc(attempt);
    const attemptSnap = await attemptRef.get();
    if (attemptSnap.exists && (attemptSnap.data().ownerUid !== uid ||
        normalizePracticeMode(attemptSnap.data().canonicalMode || attemptSnap.data().practiceMode) !== canonicalMode)) {
      fail('ATTEMPT_OWNERSHIP_OR_MODE_MISMATCH', 403);
    }
    if (!Buffer.isBuffer(buffer) || buffer.length > MAX_UPLOAD_BYTES) fail('AUDIO_TOO_LARGE', 413);

    const parsed = parseCanonicalWav(buffer);
    if (parsed.sampleCount * 1000 > constraints.hardMaxMs * 16000) fail('AUDIO_TOO_LONG', 413);
    const canonicalFileHash = digest(buffer);
    const audioId = `aud-${digest(`${uid}:${canonicalMode}:${attempt}:${key}`).slice(0, 40)}`;
    const ref = this.getRef(audioId);
    const old = await ref.get();
    if (old.exists) {
      const data = old.data();
      if (data.uid !== uid || data.mode !== canonicalMode || data.attemptId !== attempt ||
          data.manifest?.canonicalFileHash !== canonicalFileHash) fail('UPLOAD_KEY_CONFLICT', 409);
      if (data.status !== 'staged' || Date.parse(data.expiresAt) <= Date.now()) fail('AUDIO_EXPIRED', 410);
      return { audioId, attemptId: attempt, manifest: data.manifest };
    }

    const bucket = await this.getBucket();
    const ownerPrefix = digest(uid).slice(0, 24);
    const storagePath = `ai-scoring-audio/${ownerPrefix}/${attempt}/${audioId}.wav`;
    const file = bucket.file(storagePath);
    try {
      await file.save(buffer, {
        resumable: false,
        contentType: 'audio/wav',
        preconditionOpts: { ifGenerationMatch: 0 }
      });
    } catch (error) {
      if (Number(error.code) !== 412) throw error;
      const [existingBytes] = await file.download();
      if (digest(existingBytes) !== canonicalFileHash) fail('UPLOAD_KEY_CONFLICT', 409);
    }
    const [metadata] = await file.getMetadata();
    if (!metadata?.generation) fail('STORAGE_GENERATION_MISSING', 503);
    const manifest = createAudioManifest(buffer, {
      assetId: audioId,
      storageGeneration: String(metadata.generation),
      timelineId: `tl-${audioId}`
    });
    const createdAt = new Date();
    const practiceMode = {
      read_aloud: 'read-aloud', repeat_sentence: 'speak', describe_image: 'describe-image',
      retell_lecture: 'notes', summarize_group_discussion: 'sgd', respond_to_situation: 'rts'
    }[canonicalMode];
    const result = await this.db.runTransaction(async tx => {
      const existing = await tx.get(ref);
      const currentAttempt = await tx.get(attemptRef);
      if (currentAttempt.exists && (currentAttempt.data().ownerUid !== uid ||
          normalizePracticeMode(currentAttempt.data().canonicalMode || currentAttempt.data().practiceMode) !== canonicalMode)) {
        fail('ATTEMPT_OWNERSHIP_OR_MODE_MISMATCH', 403);
      }
      if (existing.exists) {
        const data = existing.data();
        if (data.uid !== uid || data.mode !== canonicalMode || data.attemptId !== attempt ||
            data.manifest?.canonicalFileHash !== canonicalFileHash) fail('UPLOAD_KEY_CONFLICT', 409);
        if (data.status !== 'staged' || Date.parse(data.expiresAt) <= Date.now()) fail('AUDIO_EXPIRED', 410);
        return data.manifest;
      }
      tx.create(ref, {
        audioId,
        uid,
        mode: canonicalMode,
        attemptId: attempt,
        storagePath,
        manifest,
        status: 'staged',
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + STAGED_TTL_MS).toISOString()
      });
      const archivePatch = { v3AudioId: audioId, v3AudioManifest: manifest,
        v3AudioPath: storagePath, updatedAt: createdAt.toISOString() };
      if (currentAttempt.exists) {
        const previous = currentAttempt.data().v3AudioRevisionPaths || [];
        archivePatch.v3AudioRevisionPaths = [...new Set([...previous, currentAttempt.data().v3AudioPath, storagePath].filter(Boolean))];
        archivePatch.v3AudioRevisionIds = [...new Set([...(currentAttempt.data().v3AudioRevisionIds || []),
          currentAttempt.data().v3AudioId, audioId].filter(Boolean))];
        if (archivePatch.v3AudioRevisionPaths.length > 100) fail('TOO_MANY_AUDIO_REVISIONS', 409);
        tx.update(attemptRef, archivePatch);
      }
      else tx.create(attemptRef, { ...archivePatch, attemptId: attempt, ownerUid: uid,
        practiceScope: 'pte', practiceMode, canonicalMode, status: 'awaiting_upload',
        createdAt, media: [], mediaSlots: {}, v3AudioRevisionPaths: [storagePath], v3AudioRevisionIds: [audioId] });
      return manifest;
    });
    return { audioId, attemptId: attempt, manifest: result };
  }

  async getOwned(audioId, uid, mode = null) {
    const snap = await this.getRef(audioId).get();
    if (!snap.exists) fail('AUDIO_NOT_FOUND', 404);
    const asset = snap.data();
    if (asset.uid !== uid) fail('AUDIO_FORBIDDEN', 403);
    if (mode && asset.mode !== normalizePracticeMode(mode)) fail('AUDIO_MODE_MISMATCH', 409);
    if (asset.status === 'deleting' || (asset.status === 'staged' && Date.parse(asset.expiresAt) <= Date.now())) fail('AUDIO_EXPIRED', 410);
    return asset;
  }

  async download(asset) {
    const bucket = await this.getBucket();
    const file = bucket.file(asset.storagePath);
    const [[bytes], [metadata]] = await Promise.all([file.download(), file.getMetadata()]);
    const manifest = createAudioManifest(bytes, {
      assetId: asset.audioId,
      storageGeneration: String(metadata.generation),
      timelineId: asset.manifest.timelineId
    });
    if (manifest.canonicalFileHash !== asset.manifest.canonicalFileHash ||
        manifest.pcmPayloadHash !== asset.manifest.pcmPayloadHash ||
        manifest.sampleCount !== asset.manifest.sampleCount ||
        manifest.storageGeneration !== asset.manifest.storageGeneration) {
      fail('AUDIO_IDENTITY_MISMATCH', 409);
    }
    return bytes;
  }
}

module.exports = { AudioAssetService, MAX_UPLOAD_BYTES, STAGED_TTL_MS };
