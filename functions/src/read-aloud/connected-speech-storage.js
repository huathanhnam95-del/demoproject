const { randomUUID } = require('crypto');
const path = require('path');
const { admin, db, getStorageBucket } = require('../utils/firebase_admin_init');

function formatDateParts(date = new Date()) {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return { year, month, day };
}

function buildAudioPath(attemptId, date = new Date()) {
  const { year, month, day } = formatDateParts(date);
  return `read-aloud-connected-speech/raw/${year}/${month}/${day}/${attemptId}.wav`;
}

function buildConnectedSpeechAttemptRecord(record = {}) {
  const connectedSpeechEvents = Array.isArray(record.connectedSpeechEvents) ? record.connectedSpeechEvents : [];
  return {
    attemptId: String(record.attemptId || randomUUID()),
    questionId: record.questionId == null ? null : String(record.questionId),
    referenceText: String(record.referenceText || ''),
    recognizedText: String(record.recognizedText || ''),
    clientContext: record.clientContext || null,
    azureSummary: record.azureSummary || null,
    connectedSpeechSummary: record.connectedSpeechSummary || null,
    connectedSpeechEvents,
    requestedAlignmentMode: record.requestedAlignmentMode == null ? null : String(record.requestedAlignmentMode),
    connectedSpeechVersion: String(record.connectedSpeechVersion || ''),
    eventFamilyCounts: record.eventFamilyCounts || {},
    promptIndexVersion: String(record.promptIndexVersion || ''),
    promptFeatureSnapshot: record.promptFeatureSnapshot || null,
    scoringMode: String(record.scoringMode || 'heuristic'),
    connectedSpeechPrimarySource: String(record.connectedSpeechPrimarySource || 'heuristic'),
    alignmentFallbackReason: record.alignmentFallbackReason == null ? null : String(record.alignmentFallbackReason),
    connectedSpeechShadow: record.connectedSpeechShadow || null,
    workerStatus: String(record.workerStatus || 'unknown'),
    audioStatus: String(record.audioStatus || 'unknown'),
    audioQuality: record.audioQuality || null,
    audioQualityReason: record.audioQuality?.reason || null,
    audioQualityPassed: record.audioQuality ? Boolean(record.audioQuality.passed) : null,
    storageStatus: String(record.storageStatus || 'unknown'),
    audioPath: record.audioPath || null,
    audioSampleRate: Number.isFinite(Number(record.audioSampleRate)) ? Number(record.audioSampleRate) : null,
    referenceWordCount: Number.isFinite(Number(record.referenceWordCount)) ? Number(record.referenceWordCount) : null,
    recognizedWordCount: Number.isFinite(Number(record.recognizedWordCount)) ? Number(record.recognizedWordCount) : null
  };
}

async function uploadConnectedSpeechAudio({ attemptId = randomUUID(), buffer, contentType = 'audio/wav', date = new Date() }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { status: 'failed', attemptId, audioPath: null, error: 'missing_buffer' };
  }

  const bucket = await getStorageBucket();
  if (!bucket) {
    return { status: 'unavailable', attemptId, audioPath: null };
  }

  const audioPath = buildAudioPath(attemptId, date);
  try {
    const file = bucket.file(audioPath);
    await file.save(buffer, {
      resumable: false,
      contentType,
      metadata: {
        contentType,
        cacheControl: 'private, max-age=0, no-transform'
      }
    });
    return { status: 'complete', attemptId, audioPath };
  } catch (error) {
    return { status: 'failed', attemptId, audioPath, error: error?.message || 'upload_failed' };
  }
}

async function persistConnectedSpeechAttempt(record, options = {}) {
  const dbClient = options.dbClient || db;
  if (!dbClient || typeof dbClient.collection !== 'function') {
    return { status: 'unavailable' };
  }
  const attemptId = String(record?.attemptId || randomUUID());
  try {
    await dbClient.collection('readAloudConnectedSpeechAttempts').doc(attemptId).set({
      ...buildConnectedSpeechAttemptRecord(record),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return { status: 'complete', attemptId };
  } catch (error) {
    return { status: 'failed', attemptId, error: error?.message || 'firestore_write_failed' };
  }
}

module.exports = {
  buildAudioPath,
  buildConnectedSpeechAttemptRecord,
  uploadConnectedSpeechAudio,
  persistConnectedSpeechAttempt
};
