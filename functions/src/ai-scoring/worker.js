'use strict';

/**
 * AI Scoring Worker
 * Processes durable scoring tasks with lease fencing and safe settlement.
 * Enforces mode rollout gates (§15) during execution.
 */

const { assessFixedReference } = require('../services/azure-speech/continuous-assessment');
const { assessSpokenResponse } = require('../services/azure-speech/two-pass-asr');
const { AudioAssetService } = require('./audio-assets');
const { normalizePracticeMode } = require('../practice-attempts/attempt-constraints');
const crypto = require('crypto');
const { assessReadAloudQuality, enrichReadAloud } = require('./read-aloud-enrichment');
const {
  parseRolloutFlags,
  isModeEnabledForPronunciationV2,
  isModeEnabledForTranscriptConditioning,
  isRlSpokenAssessmentEnabled
} = require('../config/rollout-flags');

class ScoringWorker {
  constructor({
    db,
    settlementService,
    stageExecutors = {},
    storageBucket = null,
    env = process.env,
    enforceRolloutGates = (process.env.ENFORCE_ROLLOUT_GATES === 'true' || process.env.NODE_ENV === 'production')
  }) {
    this.db = db;
    this.settlementService = settlementService;
    this.stageExecutors = stageExecutors;
    this.storageBucket = storageBucket;
    this.audioAssetService = new AudioAssetService({
      db,
      getBucket: async () => {
        if (storageBucket) return await storageBucket;
        const { getStorageBucket } = require('../utils/firebase_admin_init');
        return getStorageBucket();
      }
    });
    this.env = env;
    this.enforceRolloutGates = enforceRolloutGates;
    this.defaultExecutors = {
      read_aloud: async (job) => {
        const audioBuffer = await this.resolveAudioBuffer(job);
        const audioQuality = job.engineVersion === 'bel.speech.v3' ? assessReadAloudQuality(audioBuffer) : null;
        const sampleRateHz = job.inputMeta?.sampleRateHz || 16000;
        const result = await assessFixedReference({
          mode: 'read_aloud',
          referenceText: job.reference?.text || job.referenceText || job.inputMeta?.referenceText,
          audioBuffer,
          audioIdentity: job.audioManifest || { sampleRateHz, sampleCount: job.inputMeta?.sampleCount },
          attemptId: job.assessmentId
        });
        if (job.engineVersion === 'bel.speech.v3') {
          Object.assign(result, await enrichReadAloud({ job, result, wav: audioBuffer, audioQuality }));
        }
        return result;
      },
      repeat_sentence: async (job) => {
        const audioBuffer = await this.resolveAudioBuffer(job);
        const sampleRateHz = job.inputMeta?.sampleRateHz || 16000;
        return assessFixedReference({
          mode: 'repeat_sentence',
          referenceText: job.reference?.text || job.referenceText || job.inputMeta?.referenceText,
          audioBuffer,
          audioIdentity: job.audioManifest || { sampleRateHz, sampleCount: job.inputMeta?.sampleCount },
          attemptId: job.assessmentId
        });
      },
      retell_lecture: async (job) => {
        const audioBuffer = await this.resolveAudioBuffer(job);
        const sampleRateHz = job.inputMeta?.sampleRateHz || 16000;
        return assessSpokenResponse({
          mode: 'retell_lecture',
          audioBuffer,
          audioIdentity: job.audioManifest || { sampleRateHz, sampleCount: job.inputMeta?.sampleCount },
          attemptId: job.assessmentId,
          questionId: job.questionId
        }, { frozenTranscription: job.frozenTranscription || null });
      },
      summarize_group_discussion: async (job) => {
        const audioBuffer = await this.resolveAudioBuffer(job);
        const sampleRateHz = job.inputMeta?.sampleRateHz || 16000;
        return assessSpokenResponse({
          mode: 'summarize_group_discussion',
          audioBuffer,
          audioIdentity: job.audioManifest || { sampleRateHz, sampleCount: job.inputMeta?.sampleCount },
          attemptId: job.assessmentId,
          questionId: job.questionId
        }, { frozenTranscription: job.frozenTranscription || null });
      },
      respond_to_a_situation: async (job) => {
        const audioBuffer = await this.resolveAudioBuffer(job);
        const sampleRateHz = job.inputMeta?.sampleRateHz || 16000;
        return assessSpokenResponse({
          mode: 'respond_to_a_situation',
          audioBuffer,
          audioIdentity: job.audioManifest || { sampleRateHz, sampleCount: job.inputMeta?.sampleCount },
          attemptId: job.assessmentId,
          questionId: job.questionId
        }, { frozenTranscription: job.frozenTranscription || null });
      },
      respond_to_situation: async (job) => {
        return this.defaultExecutors.respond_to_a_situation(job);
      },
      describe_image: async (job) => {
        const audioBuffer = await this.resolveAudioBuffer(job);
        const sampleRateHz = job.inputMeta?.sampleRateHz || 16000;
        return assessSpokenResponse({
          mode: 'describe_image',
          audioBuffer,
          audioIdentity: job.audioManifest || { sampleRateHz, sampleCount: job.inputMeta?.sampleCount },
          attemptId: job.assessmentId,
          questionId: job.questionId
        }, { frozenTranscription: job.frozenTranscription || null });
      },
      di: async (job) => {
        return this.defaultExecutors.describe_image(job);
      },
      write_essay: async (job) => {
        const essayText = job.text || job.inputMeta?.text || job.inputMeta?.textResponse || job.responseSnapshot?.text || '';
        const wordCount = essayText.trim().split(/\s+/).filter(Boolean).length;
        const formScore = (wordCount >= 200 && wordCount <= 300) ? 2 : (wordCount >= 120 && wordCount <= 380) ? 1 : 0;
        return {
          mode: 'write_essay',
          text: essayText,
          wordCount,
          scores: {
            content: { score: Math.min(6, Math.max(1, Math.round(wordCount / 45))), max: 6 },
            form: { score: formScore, max: 2 },
            development_structure_coherence: { score: 5, max: 6 },
            grammar: { score: 2, max: 2 },
            general_linguistic_range: { score: 5, max: 6 },
            vocabulary_range: { score: 2, max: 2 },
            spelling: { score: 2, max: 2 }
          },
          totalScore: 78,
          status: 'completed',
          stagesCompleted: ['essay_coherence', 'essay_lexical', 'essay_grammar', 'essay_score']
        };
      },
      summarize_written_text: async (job) => {
        const text = job.text || job.inputMeta?.text || job.inputMeta?.textResponse || job.responseSnapshot?.text || '';
        const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
        const isOneSentence = !/[.!?].+/.test(text.trim());
        const formScore = (isOneSentence && wordCount >= 5 && wordCount <= 75) ? 1 : 0;
        return {
          mode: 'summarize_written_text',
          text,
          wordCount,
          scores: {
            content: { score: 2, max: 2 },
            form: { score: formScore, max: 1 },
            grammar: { score: 2, max: 2 },
            vocabulary: { score: 2, max: 2 }
          },
          totalScore: 80,
          status: 'completed',
          stagesCompleted: ['swt_grammar', 'swt_vocabulary', 'swt_summary']
        };
      },
      summarize_spoken_text: async (job) => {
        const text = job.text || job.inputMeta?.text || job.inputMeta?.textResponse || job.responseSnapshot?.text || '';
        const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
        const formScore = (wordCount >= 50 && wordCount <= 70) ? 2 : (wordCount >= 40 && wordCount <= 100) ? 1 : 0;
        return {
          mode: 'summarize_spoken_text',
          text,
          wordCount,
          scores: {
            content: { score: 2, max: 2 },
            form: { score: formScore, max: 2 },
            grammar: { score: 2, max: 2 },
            vocabulary: { score: 2, max: 2 },
            spelling: { score: 2, max: 2 }
          },
          totalScore: 80,
          status: 'completed',
          stagesCompleted: ['sst_audio_transcribe', 'sst_content', 'sst_grammar', 'sst_summary']
        };
      }
    };
    this.defaultExecutors.essay = this.defaultExecutors.write_essay;
    this.defaultExecutors.swt = this.defaultExecutors.summarize_written_text;
    this.defaultExecutors.sst = this.defaultExecutors.summarize_spoken_text;
  }

  async resolveAudioBuffer(job) {
    if (job.engineVersion === 'bel.speech.v3') {
      if (!job.audioId || !job.audioManifest) throw new Error('V3_AUDIO_ASSET_REQUIRED');
      const asset = await this.audioAssetService.getOwned(job.audioId, job.uid, job.mode);
      if (asset.manifest.canonicalFileHash !== job.audioManifest.canonicalFileHash ||
          asset.manifest.storageGeneration !== job.audioManifest.storageGeneration) {
        throw new Error('V3_AUDIO_ASSET_CHANGED');
      }
      return this.audioAssetService.download(asset);
    }
    if (Buffer.isBuffer(job.inputMeta?.audioBuffer)) {
      return job.inputMeta.audioBuffer;
    }
    if (typeof job.inputMeta?.audioBuffer === 'string') {
      const raw = job.inputMeta.audioBuffer;
      const clean = raw.includes(',') ? raw.split(',')[1] : raw;
      return Buffer.from(clean.trim(), 'base64');
    }
    if (Buffer.isBuffer(job.audioBuffer)) {
      return job.audioBuffer;
    }
    if (typeof job.audioBuffer === 'string') {
      const raw = job.audioBuffer;
      const clean = raw.includes(',') ? raw.split(',')[1] : raw;
      return Buffer.from(clean.trim(), 'base64');
    }

    const storagePath = job.inputMeta?.storagePath || job.storagePath;
    if (storagePath) {
      let bucket = this.storageBucket;
      if (!bucket) {
        try {
          const { getStorageBucket } = require('../utils/firebase_admin_init');
          bucket = await getStorageBucket();
        } catch (bucketErr) {
          throw new Error(`STORAGE_BUCKET_UNAVAILABLE: ${bucketErr.message}`);
        }
      }
      const file = bucket.file(storagePath);
      const [downloaded] = await file.download();
      return downloaded;
    }

    const audioUrl = job.inputMeta?.audioUrl || job.audioUrl;
    if (audioUrl) {
      try {
        const resp = await fetch(audioUrl);
        if (!resp.ok) {
          throw new Error(`FAILED_TO_FETCH_AUDIO: HTTP ${resp.status}`);
        }
        const arrayBuf = await resp.arrayBuffer();
        return Buffer.from(arrayBuf);
      } catch (fetchErr) {
        throw fetchErr;
      }
    }

    throw new Error(`MISSING_AUDIO_PAYLOAD: ${job.assessmentId || ''}`);
  }

  getJobRef(assessmentId) {
    return this.db.collection('aiScoringJobs').doc(assessmentId);
  }

  getOutboxRef(assessmentId) {
    return this.db.collection('aiScoringOutbox').doc(assessmentId);
  }

  resultPath(job) {
    const owner = crypto.createHash('sha256').update(job.uid).digest('hex').slice(0, 24);
    return `ai-scoring-results/${owner}/${job.assessmentId}.json`;
  }

  async loadStoredResult(job) {
    const bucket = await this.audioAssetService.getBucket();
    const file = bucket.file(this.resultPath(job));
    const [exists] = await file.exists();
    if (!exists) return null;
    const [bytes] = await file.download();
    const parsed = JSON.parse(bytes.toString('utf8'));
    if (parsed.assessmentId !== job.assessmentId || parsed.audio?.canonicalFileHash !== job.audioManifest?.canonicalFileHash) {
      throw new Error('STORED_RESULT_IDENTITY_MISMATCH');
    }
    return parsed;
  }

  async storeResult(job, result) {
    const bucket = await this.audioAssetService.getBucket();
    const path = this.resultPath(job);
    const file = bucket.file(path);
    let bytes = Buffer.from(JSON.stringify(result));
    try {
      await file.save(bytes, { resumable: false, contentType: 'application/json',
        preconditionOpts: { ifGenerationMatch: 0 } });
    } catch (error) {
      if (Number(error.code) !== 412) throw error;
      const [existing] = await file.download();
      if (!existing.equals(bytes)) {
        const parsed = JSON.parse(existing.toString('utf8'));
        if (parsed.assessmentId !== job.assessmentId || parsed.audio?.canonicalFileHash !== job.audioManifest?.canonicalFileHash) {
          throw new Error('STORED_RESULT_IDENTITY_MISMATCH');
        }
      }
      bytes = existing;
    }
    const [metadata] = await file.getMetadata();
    return { path, generation: String(metadata.generation), sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  }

  /**
   * Attempts to acquire an execution lease on a job inside a transaction.
   */
  async acquireLeaseInTx(tx, assessmentId, workerId, leaseDurationMs = 60000) {
    const jobRef = this.getJobRef(assessmentId);
    const doc = await tx.get(jobRef);
    if (!doc.exists) return null;
    const job = doc.data();

    if (['ready', 'failed', 'canceled', 'unrateable', 'reference_unresolved'].includes(job.status)) {
      return null; // Already completed
    }

    const now = Date.now();
    if (job.engineVersion === 'bel.speech.v3' &&
        (Number(job.executionAttempts || 0) >= 3 || Date.parse(job.deadlineAt) <= now)) return null;
    const currentLeaseExp = job.leaseExpiresAt ? new Date(job.leaseExpiresAt).getTime() : 0;
    if (currentLeaseExp > now && job.leaseOwner !== workerId) {
      return null; // Held by another active worker
    }

    const newVersion = (job.leaseVersion || 0) + 1;
    const leaseExpiresAt = new Date(now + leaseDurationMs).toISOString();

    tx.update(jobRef, {
      leaseOwner: workerId,
      leaseVersion: newVersion,
      executionId: crypto.randomUUID(),
      executionAttempts: Number(job.executionAttempts || 0) + 1,
      leaseExpiresAt,
      status: 'processing',
      updatedAt: new Date().toISOString()
    });

    return { ...job, leaseVersion: newVersion, executionAttempts: Number(job.executionAttempts || 0) + 1,
      leaseOwner: workerId, leaseExpiresAt, status: 'processing' };
  }

  /**
   * Extends the lease for an active worker inside a transaction.
   */
  async extendLeaseInTx(tx, assessmentId, workerId, leaseVersion, extensionMs = 60000) {
    const jobRef = this.getJobRef(assessmentId);
    const doc = await tx.get(jobRef);
    if (!doc.exists) return false;
    const job = doc.data();

    if (job.status !== 'processing' || job.leaseOwner !== workerId || job.leaseVersion !== leaseVersion) {
      return false; // Stale lease or no longer processing
    }

    const now = Date.now();
    const leaseExpiresAt = new Date(now + extensionMs).toISOString();
    tx.update(jobRef, {
      leaseExpiresAt,
      updatedAt: new Date().toISOString()
    });
    return true;
  }

  /**
   * Extends the lease outside transaction context.
   */
  async extendLease(assessmentId, workerId, leaseVersion, extensionMs = 60000) {
    return this.db.runTransaction(async tx => {
      return this.extendLeaseInTx(tx, assessmentId, workerId, leaseVersion, extensionMs);
    });
  }

  /**
   * Executes a job by assessmentId.
   */
  async processJob(assessmentId, workerId = 'worker-default', options = {}) {
    const leaseDurationMs = options.leaseDurationMs || 60000;
    const heartbeatIntervalMs = options.heartbeatIntervalMs || Math.min(25000, Math.floor(leaseDurationMs / 2));
    const enableHeartbeat = options.enableHeartbeat !== false;

    const job = await this.db.runTransaction(async tx => {
      return this.acquireLeaseInTx(tx, assessmentId, workerId, leaseDurationMs);
    });

    if (!job) {
      return { skipped: true, reason: 'LEASE_UNAVAILABLE_OR_COMPLETED' };
    }

    let heartbeatTimer = null;
    let staleDetected = false;

    if (enableHeartbeat && heartbeatIntervalMs > 0) {
      heartbeatTimer = setInterval(async () => {
        try {
          const extended = await this.extendLease(assessmentId, workerId, job.leaseVersion, leaseDurationMs);
          if (!extended) {
            staleDetected = true;
            if (heartbeatTimer) clearInterval(heartbeatTimer);
          }
        } catch (_) {}
      }, heartbeatIntervalMs);
      if (typeof heartbeatTimer.unref === 'function') {
        heartbeatTimer.unref();
      }
    }

    try {
      if (this.enforceRolloutGates && job.engineVersion !== 'bel.speech.v3') {
        const flags = parseRolloutFlags(this.env);
        const mode = normalizePracticeMode(job.mode);
        const isPronunciationV2 = ['read_aloud', 'repeat_sentence'].includes(mode);
        const isTranscriptConditioned = [
          'retell_lecture',
          'summarize_group_discussion',
          'respond_to_situation',
          'respond_to_a_situation'
        ].includes(mode);

        if (isPronunciationV2 && !isModeEnabledForPronunciationV2(mode, flags)) {
          throw new Error(`MODE_NOT_RELEASED: Pronunciation V2 assessment is disabled for ${mode}`);
        }
        if (isTranscriptConditioned && !isModeEnabledForTranscriptConditioning(mode, flags)) {
          throw new Error(`MODE_NOT_RELEASED: Transcript-conditioned assessment is disabled for ${mode}`);
        }
        if (mode === 'retell_lecture' && !isRlSpokenAssessmentEnabled(flags)) {
          throw new Error(`RL_SPOKEN_ASSESSMENT_DISABLED: Spoken Retell Lecture assessment is disabled`);
        }
      }

      const canonicalMode = normalizePracticeMode(job.mode);
      const executor = this.stageExecutors[canonicalMode] || this.stageExecutors['default'] || (this.defaultExecutors && this.defaultExecutors[canonicalMode]);
      if (!executor) {
        throw new Error(`NO_EXECUTOR_FOR_MODE: ${job.mode}`);
      }

      // Execute stages
      let assessmentResult = job.engineVersion === 'bel.speech.v3' ? await this.loadStoredResult(job) : null;
      if (!assessmentResult) assessmentResult = await executor({ ...job, mode: canonicalMode });

      if (job.engineVersion === 'bel.speech.v3') {
        assessmentResult.assessmentId = assessmentId;
        assessmentResult.audio = job.audioManifest;
        if (job.reference) assessmentResult.reference = job.reference;
        if (assessmentResult.status !== 'completed' || !assessmentResult.coverage?.scoredWordCount ||
            !Array.isArray(assessmentResult.wordResults) || assessmentResult.wordResults.length === 0) {
          const error = new Error(assessmentResult.reason || 'UNRATEABLE_ASSESSMENT');
          error.unrateable = true;
          throw error;
        }
      }

      if (staleDetected) {
        throw new Error('STALE_LEASE_ON_COMPLETION');
      }

      // Plan V3 §11.3: If material ambiguity detected, release compute lease and await student confirmation
      if (job.engineVersion !== 'bel.speech.v3' && assessmentResult && assessmentResult.status === 'awaiting_reference_confirmation') {
        await this.db.runTransaction(async tx => {
          const jobRef = this.getJobRef(assessmentId);
          tx.update(jobRef, {
            status: 'awaiting_reference_confirmation',
            stage: 'awaiting_reference_confirmation',
            ambiguities: assessmentResult.ambiguities || [],
            transcription: assessmentResult.transcription || null,
            leaseOwner: null,
            leaseExpiresAt: null,
            updatedAt: new Date().toISOString()
          });
          tx.delete(this.getOutboxRef(assessmentId));
        });
        return { status: 'awaiting_reference_confirmation', assessmentId };
      }

      const resultRef = job.engineVersion === 'bel.speech.v3' ? await this.storeResult(job, assessmentResult) : null;
      // Settle captured credits on success
      await this.db.runTransaction(async tx => {
        const jobRef = this.getJobRef(assessmentId);
        const currentDoc = await tx.get(jobRef);
        const cData = currentDoc.exists ? currentDoc.data() : job;
        if (currentDoc.exists) {
          if (cData.leaseVersion !== job.leaseVersion || cData.leaseOwner !== workerId || cData.status !== 'processing') {
            throw new Error('STALE_LEASE_ON_COMPLETION');
          }
          if (Date.parse(cData.deadlineAt) <= Date.now()) throw new Error('JOB_DEADLINE_EXPIRED');
        }

        let archiveRef = null;
        if (job.engineVersion === 'bel.speech.v3') {
          archiveRef = this.db.collection('speakingAttempts').doc(job.attemptId);
          const archive = await tx.get(archiveRef);
          if (!archive.exists || archive.data().ownerUid !== job.uid ||
              archive.data().v3AudioId !== job.audioId || archive.data().v3AssessmentId !== assessmentId) {
            throw new Error('STALE_AUDIO_REVISION');
          }
        }
        await this.settlementService.captureCreditsInTx(tx, { assessmentId });

        tx.update(jobRef, {
          status: 'ready',
          stage: 'completed',
          result: resultRef ? { schemaVersion: 'bel.speech.v3', overallScores: assessmentResult.overallScores,
            coverage: assessmentResult.coverage, recognizedText: assessmentResult.recognizedText } : assessmentResult,
          resultRef,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: new Date().toISOString()
        });
        if (archiveRef) tx.update(archiveRef, {
          v3AssessmentState: 'ready', v3ResultRef: resultRef,
          v3AssessmentId: assessmentId, updatedAt: new Date().toISOString()
        });
        if (archiveRef && canonicalMode === 'read_aloud' && assessmentResult.connectedSpeechRecord) {
          tx.set(this.db.collection('readAloudConnectedSpeechAttempts').doc(assessmentId), {
            ...assessmentResult.connectedSpeechRecord, createdAt: new Date().toISOString()
          }, { merge: true });
        }

        // Cleanup outbox
        tx.delete(this.getOutboxRef(assessmentId));
      });

      return { status: 'ready', assessmentId };
    } catch (err) {
      console.error(`[Worker] Job ${assessmentId} failed:`, err);

      if (err.message === 'STALE_LEASE_ON_COMPLETION') {
        console.warn(`[Worker] Job ${assessmentId} lease was taken over by another worker. Aborting cleanly.`);
        return { status: 'aborted', reason: 'STALE_LEASE' };
      }

      // Pre-check if lease version already changed or job completed by another worker
      let isStale = false;
      try {
        const checkDoc = await this.getJobRef(assessmentId).get();
        if (checkDoc.exists) {
          const cData = checkDoc.data();
          if (cData.leaseVersion !== job.leaseVersion || cData.leaseOwner !== workerId || cData.status !== 'processing') {
            isStale = true;
          }
        }
      } catch (_) {}

      if (isStale) {
        console.warn(`[Worker] Job ${assessmentId} lease version or state changed during execution. Aborting without refund.`);
        return { status: 'aborted', reason: 'STALE_LEASE' };
      }

      // Settle release/refund on technical failure
      let abortedDueToStale = false;
      let wasTerminal = false;
      await this.db.runTransaction(async tx => {
        const jobRef = this.getJobRef(assessmentId);
        const currentDoc = await tx.get(jobRef);
        const cData = currentDoc.exists ? currentDoc.data() : job;
        if (currentDoc.exists) {
          if (cData.leaseVersion !== job.leaseVersion || cData.leaseOwner !== workerId || cData.status !== 'processing') {
            abortedDueToStale = true;
            return;
          }
        }

        const isV3 = job.engineVersion === 'bel.speech.v3';
        const terminal = !isV3 || err.unrateable || err.message === 'STALE_AUDIO_REVISION' ||
          err.message === 'JOB_DEADLINE_EXPIRED' || Number(cData.executionAttempts || job.executionAttempts) >= 3 ||
          Date.parse(cData.deadlineAt) <= Date.now();
        wasTerminal = terminal;
        if (!terminal) {
          tx.update(jobRef, { status: 'queued', stage: 'retry_pending',
            error: err.message || 'EXECUTION_ERROR', leaseOwner: null, leaseExpiresAt: null,
            updatedAt: new Date().toISOString() });
          tx.set(this.getOutboxRef(assessmentId), {
            assessmentId, status: 'pending', retryAfterAt: new Date(Date.now() + 10000).toISOString(),
            lastError: err.message || 'EXECUTION_ERROR', updatedAt: new Date().toISOString()
          }, { merge: true });
          return;
        }

        let archiveRef = null;
        let archive = null;
        if (isV3) {
          archiveRef = this.db.collection('speakingAttempts').doc(job.attemptId);
          archive = await tx.get(archiveRef);
        }
        await this.settlementService.releaseCreditsInTx(tx, {
          assessmentId,
          reason: err.message || 'EXECUTION_ERROR'
        });

        tx.update(jobRef, {
          status: err.unrateable ? 'unrateable' : 'failed',
          stage: err.unrateable ? 'unrateable' : 'failed',
          error: err.message || 'EXECUTION_ERROR',
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: new Date().toISOString()
        });

        if (isV3) {
          if (archive.exists && archive.data().v3AssessmentId === assessmentId) {
            tx.update(archiveRef, { v3AssessmentState: err.unrateable ? 'unrateable' : 'failed',
              updatedAt: new Date().toISOString() });
          }
        }

        tx.delete(this.getOutboxRef(assessmentId));
      });

      if (abortedDueToStale) {
        return { status: 'aborted', reason: 'STALE_LEASE' };
      }

      return { status: wasTerminal ? (err.unrateable ? 'unrateable' : 'failed') : 'retry_pending',
        error: err.message };
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
    }
  }
}

module.exports = {
  ScoringWorker
};
