'use strict';

/**
 * AI Scoring Gate Client Helper
 * Coordinates preflight quotes, student consent confirmation, and atomic job confirmation.
 * Works seamlessly across Read Aloud, Repeat Sentence, Retell Lecture, SGD, RTS, and Writing modes.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AiScoringGate = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  let confirmationModalInstance = null;
  const preparedRecordings = new WeakMap();
  const canonicalBuffers = new WeakMap();
  let capabilityPromise = null;

  function canonicalMode(mode) {
    const normalized = String(mode || '').toLowerCase().replace(/[\s-]+/g, '_');
    return ({ speak: 'repeat_sentence', notes: 'retell_lecture', sgd: 'summarize_group_discussion',
      rts: 'respond_to_situation', respond_to_a_situation: 'respond_to_situation',
      di: 'describe_image' })[normalized] || normalized;
  }

  async function speechV3Enabled(mode) {
    if (!capabilityPromise) {
      capabilityPromise = fetch('/api/config', { cache: 'no-store' })
        .then(async response => {
          if (!response.ok) throw new Error('SPEECH_CAPABILITIES_UNAVAILABLE');
          const data = await response.json();
          return data?.features?.speechV3Modes || data?.featureFlags?.speechV3Modes || data?.capabilities?.speechV3Modes || [];
        }).catch(error => { capabilityPromise = null; throw error; });
    }
    const modes = await capabilityPromise;
    return modes.includes(canonicalMode(mode));
  }

  async function getAuthHeaders(customHeaders = {}) {
    const headers = { 'Content-Type': 'application/json', ...customHeaders };
    try {
      const user = (typeof window !== 'undefined' ?
        (window.__FIREBASE_INTERNAL__?.auth?.currentUser || window.auth?.currentUser) : null)
        || (typeof firebase !== 'undefined' && firebase.auth ? firebase.auth().currentUser : null);
      if (user) {
        const token = await user.getIdToken();
        if (token) {
          headers['Authorization'] = 'Bearer ' + token;
        }
      }
    } catch (_) {}
    return headers;
  }

  function getConfirmationModal() {
    if (!confirmationModalInstance && window.AiCreditConfirmation?.AiCreditConfirmationModal) {
      confirmationModalInstance = new window.AiCreditConfirmation.AiCreditConfirmationModal();
    }
    return confirmationModalInstance;
  }

  /**
   * Requests a server quote, prompts for student confirmation, and confirms the quote.
   *
   * @param {Object} options
   * @param {string} options.mode - Practice mode ('read_aloud', 'sgd', 'rts', 'retell_lecture', etc.)
   * @param {Object} options.inputMeta - Input metadata (e.g. { sampleCount, sampleRateHz, referenceText, textResponse })
   * @param {string} [options.questionId] - ID of the question/prompt
   * @param {string} [options.preferredPackageId] - Optional requested package ID
   * @returns {Promise<{ allowed: boolean, quote?: Object, assessmentId?: string, cancelled?: boolean, unmetered?: boolean, error?: string }>}
   */
  async function requestConsentAndConfirm({ mode, inputMeta = {}, questionId = null, preferredPackageId = null }) {
    try {
      // 1. Fetch preflight quote from server
      const quoteHeaders = await getAuthHeaders();
      const quoteRes = await fetch('/api/ai-scoring/quotes', {
        method: 'POST',
        headers: quoteHeaders,
        body: JSON.stringify({
          mode,
          inputMeta,
          questionId,
          preferredPackageId
        })
      });

      if (!quoteRes.ok) {
        const errPayload = await quoteRes.json().catch(() => null);
        console.warn(`[AiScoringGate] Quote request rejected (${quoteRes.status}):`, errPayload);
        return {
          allowed: false,
          error: errPayload?.message || "AI scoring isn't available right now. Please try again later."
        };
      }

      const quote = await quoteRes.json();

      // If already completed or zero-credit preview in shadow mode
      if (quote.state === 'already_completed') {
        return { allowed: true, assessmentId: quote.assessmentId, quote };
      }

      if (quote.shadow) return { allowed: false, error: 'AI scoring is not available yet.', code: 'SHADOW_ONLY' };

      // 2. Open confirmation modal
      const modal = getConfirmationModal();
      if (!modal) {
        console.warn('[AiScoringGate] AiCreditConfirmationModal not found.');
        return { allowed: false, error: 'Credit confirmation is unavailable.', code: 'CONSENT_UI_UNAVAILABLE' };
      }

      const { confirmed } = await modal.requestConfirmation(quote);
      if (!confirmed) {
        return { allowed: false, cancelled: true };
      }

      // 3. Confirm quote on server
      const confirmHeaders = await getAuthHeaders();
      const confirmRes = await fetch(`/api/ai-scoring/quotes/${quote.quoteId}/confirm`, {
        method: 'POST',
        headers: confirmHeaders,
        body: JSON.stringify({
          inputRevision: inputMeta.inputHash || quote.inputHash || 'v1'
        })
      });

      if (!confirmRes.ok) {
        const confirmErr = await confirmRes.json().catch(() => null);
        return {
          allowed: false,
          error: confirmErr?.message || confirmErr?.error || 'Failed to confirm credit reservation',
          code: confirmErr?.error || 'CONFIRM_FAILED'
        };
      }

      const confirmData = await confirmRes.json();
      return {
        allowed: true,
        quote,
        assessmentId: confirmData.assessmentId,
        quoteId: quote.quoteId
      };
    } catch (err) {
      console.error('[AiScoringGate] Error in scoring gate flow:', err);
      return {
        allowed: false,
        error: err.message || 'Scoring consent error'
      };
    }
  }

  /**
   * Helper to convert an Audio Blob to Base64 string for audioBuffer transport.
   * @param {Blob} blob
   * @returns {Promise<string|null>}
   */
  async function blobToBase64(blob) {
    if (!blob) return null;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        if (typeof result === 'string') {
          const base64 = result.includes(',') ? result.split(',')[1] : result;
          resolve(base64);
        } else {
          resolve(null);
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function canonicalRecording(originalBlob) {
    if (!(originalBlob instanceof Blob)) throw new TypeError('RECORDING_REQUIRED');
    if (preparedRecordings.has(originalBlob)) return preparedRecordings.get(originalBlob);
    if (!window.AudioDspPipeline?.prepareForAssessment) throw new Error('AUDIO_FORMAT_CONVERSION_UNAVAILABLE');
    // Always derive scoring bytes from the captured recording. Caller-provided derivatives
    // have no trustworthy processing provenance and may contain gain, trimming or filtering.
    const operation = window.AudioDspPipeline.prepareForAssessment(originalBlob).then(result => {
      if (!(result?.outputBlob instanceof Blob)) throw new Error('AUDIO_FORMAT_CONVERSION_FAILED');
      return result.outputBlob;
    }).catch(error => { preparedRecordings.delete(originalBlob); throw error; });
    preparedRecordings.set(originalBlob, operation);
    return operation;
  }

  async function loadCanonicalBuffer(wavBlob, manifest) {
    if (!(wavBlob instanceof Blob) || !manifest || manifest.sampleRateHz !== 16000
      || manifest.channels !== 1 || manifest.format !== 'pcm_s16le'
      || !Number.isSafeInteger(manifest.sampleCount) || manifest.sampleCount <= 0
      || !/^[a-f0-9]{64}$/.test(manifest.canonicalFileHash || '')
      || !manifest.timelineId) throw new Error('CANONICAL_AUDIO_IDENTITY_MISMATCH');
    const cached = canonicalBuffers.get(wavBlob);
    if (cached?.hash === manifest.canonicalFileHash && cached.buffer.length === manifest.sampleCount) return cached.buffer;
    const bytes = await wavBlob.arrayBuffer();
    const view = new DataView(bytes);
    const fourcc = offset => String.fromCharCode(...new Uint8Array(bytes, offset, 4));
    if (bytes.byteLength < 44 || fourcc(0) !== 'RIFF' || fourcc(8) !== 'WAVE' ||
        view.getUint32(4, true) !== bytes.byteLength - 8) {
      throw new Error('CANONICAL_AUDIO_IDENTITY_MISMATCH');
    }
    let pcmOffset = -1, pcmBytes = -1, validFormat = false;
    for (let offset = 12; offset + 8 <= bytes.byteLength;) {
      const size = view.getUint32(offset + 4, true);
      const end = offset + 8 + size;
      if (end > bytes.byteLength) throw new Error('CANONICAL_AUDIO_IDENTITY_MISMATCH');
      if (fourcc(offset) === 'fmt ') validFormat = size >= 16 &&
        view.getUint16(offset + 8, true) === 1 && view.getUint16(offset + 10, true) === 1 &&
        view.getUint32(offset + 12, true) === 16000 && view.getUint16(offset + 22, true) === 16;
      if (fourcc(offset) === 'data') { pcmOffset = offset + 8; pcmBytes = size; }
      offset = end + (size & 1);
    }
    if (!validFormat || pcmOffset < 0 || pcmBytes !== manifest.sampleCount * 2) {
      throw new Error('CANONICAL_AUDIO_IDENTITY_MISMATCH');
    }
    if (typeof crypto === 'undefined' || !crypto.subtle) throw new Error('AUDIO_HASH_UNAVAILABLE');
    {
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const actual = Array.from(hash, value => value.toString(16).padStart(2, '0')).join('');
      if (actual !== manifest.canonicalFileHash) throw new Error('CANONICAL_AUDIO_HASH_MISMATCH');
    }
    const coordinator = window.SegmentPlaybackCoordinator?.defaultCoordinator;
    const context = coordinator?.getAudioContext();
    if (!context) throw new Error('AUDIO_PLAYBACK_UNAVAILABLE');
    const audio = context.createBuffer(1, manifest.sampleCount, 16000);
    const samples = audio.getChannelData(0);
    for (let index = 0; index < samples.length; index++) samples[index] = view.getInt16(pcmOffset + index * 2, true) / 32768;
    canonicalBuffers.set(wavBlob, { hash: manifest.canonicalFileHash, buffer: audio });
    return audio;
  }

  async function playV3Span({ canonicalBlob, manifest, span, onEnded = null }) {
    const coordinator = window.SegmentPlaybackCoordinator?.defaultCoordinator;
    if (!coordinator?.playSampleSpan) return false;
    coordinator.unlockUserGesture?.();
    coordinator.stopAll();
    const ticket = coordinator.activeToken;
    try {
      const buffer = await loadCanonicalBuffer(canonicalBlob, manifest);
      if (coordinator.activeToken !== ticket) return false;
      return coordinator.playSampleSpan({ buffer, manifest, span, onEnded });
    } catch (_) {
      return false;
    }
  }

  async function assessV3Recording({ mode, originalBlob, enhancedBlob = null, attemptId = null,
    questionId = null, referenceText = null, promptSnapshot = null, responseSnapshot = null,
    onConfirmed = null, signal = null }) {
    if (!await speechV3Enabled(mode)) throw new Error('SPEECH_V3_DISABLED');
    const canonical = canonicalMode(mode);
    const id = attemptId || `v3_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
    const practiceMode = ({ read_aloud: 'read-aloud', repeat_sentence: 'speak',
      describe_image: 'describe-image', retell_lecture: 'notes',
      summarize_group_discussion: 'sgd', respond_to_situation: 'rts' })[canonical];
    if (!practiceMode || !window.PTEAttemptArchive?.saveAttempt) throw new Error('ATTEMPT_ARCHIVE_UNAVAILABLE');
    const wavBlob = await canonicalRecording(originalBlob);
    let saved = null;
    if (attemptId && window.PTEAttemptArchive.getAttempt) {
      let existing;
      try {
        existing = await window.PTEAttemptArchive.getAttempt(id);
      } catch (error) {
        if (error.status !== 404) throw error;
      }
      // Recording capture may still be uploading when the learner requests
      // scoring. Wait for that immutable archive instead of uploading the
      // same attempt path twice and hitting Storage's no-overwrite rule.
      for (let retry = 0; existing?.attempt?.status === 'awaiting_upload' && retry < 20; retry++) {
        if (signal?.aborted) throw new DOMException('Assessment cancelled', 'AbortError');
        await new Promise(resolve => setTimeout(resolve, 500));
        existing = await window.PTEAttemptArchive.getAttempt(id);
      }
      const archive = existing?.attempt;
      if (archive?.status === 'awaiting_upload') throw new Error('ATTEMPT_ARCHIVE_BUSY');
      if (archive?.status === 'submitted') {
        const hasStudentMedia = Array.isArray(archive.media)
          && archive.media.some(slot => slot.slot === 'student' && slot.storagePath && slot.status === 'uploaded');
        if (archive.practiceMode !== practiceMode || !hasStudentMedia
          || (questionId && archive.promptSnapshot?.promptId
            && String(archive.promptSnapshot.promptId) !== String(questionId))) {
          throw new Error('ATTEMPT_ARCHIVE_MISMATCH');
        }
        saved = { attemptId: id };
      }
    }
    if (!saved) saved = await window.PTEAttemptArchive.saveAttempt({
      practiceMode, attemptId: id, promptSnapshot: promptSnapshot || { promptId: questionId },
      responseSnapshot: responseSnapshot || {},
      media: [{ slot: 'student', label: 'Original recording', blob: originalBlob,
        contentType: originalBlob.type || 'audio/webm' }]
    });
    if (saved?.skipped || !saved?.attemptId) throw new Error('ATTEMPT_ARCHIVE_UNAVAILABLE');
    const ownedId = saved.attemptId;
    const wavBytes = await wavBlob.arrayBuffer();
    if (typeof crypto === 'undefined' || !crypto.subtle) throw new Error('AUDIO_HASH_UNAVAILABLE');
    const shaBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', wavBytes));
    const sha = Array.from(shaBytes, value => value.toString(16).padStart(2, '0')).join('');
    const headers = await getAuthHeaders({ 'Content-Type': 'audio/wav',
      'x-speech-mode': canonical, 'x-attempt-id': ownedId,
      'x-upload-idempotency-key': `upload_${sha.slice(0, 40)}` });
    const upload = await fetch('/api/ai-scoring/audio', {
      method: 'POST', headers, body: wavBlob, signal
    });
    const asset = await upload.json().catch(() => ({}));
    if (!upload.ok || !asset.audioId) throw new Error(asset.error || 'AUDIO_UPLOAD_FAILED');
    if (asset.manifest?.canonicalFileHash !== sha) throw new Error('AUDIO_UPLOAD_IDENTITY_MISMATCH');
    const inputMeta = { audioId: asset.audioId };
    if (referenceText != null && ['read_aloud', 'repeat_sentence'].includes(canonical)) inputMeta.referenceText = referenceText;
    const consent = await requestConsentAndConfirm({ mode: canonical, inputMeta, questionId });
    if (!consent.allowed) return { ...consent, attemptId: ownedId, audioId: asset.audioId };
    if (!consent.assessmentId) throw new Error('ASSESSMENT_ID_MISSING');
    if (typeof onConfirmed === 'function') await onConfirmed({ assessmentId: consent.assessmentId, attemptId: ownedId, manifest: asset.manifest });
    const result = await pollAssessmentResult(consent.assessmentId, { timeoutMs: 15 * 60 * 1000, signal });
    if (result?.schemaVersion === 'bel.speech.v3' && ['completed', 'ready'].includes(result.status)) {
      const identity = result.audio;
      if (!identity || !asset.manifest || ['canonicalFileHash', 'timelineId', 'sampleCount', 'sampleRateHz', 'channels']
        .some(key => identity[key] !== asset.manifest[key])) throw new Error('ASSESSMENT_AUDIO_IDENTITY_MISMATCH');
    }
    return { ...consent, result, attemptId: ownedId, audioId: asset.audioId,
      manifest: asset.manifest, canonicalBlob: wavBlob };
  }

  /**
   * Polls the scoring job until completion or error.
   * @param {string} assessmentId
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async function pollAssessmentResult(assessmentId, { timeoutMs = 60000, intervalMs = 1500, signal } = {}) {
    if (!assessmentId) throw new Error('assessmentId is required for polling');
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (signal?.aborted) {
        throw new Error('Assessment polling aborted');
      }
      const pollHeaders = await getAuthHeaders({ 'Accept': 'application/json' });
      const res = await fetch(`/api/ai-scoring/assessments/${encodeURIComponent(assessmentId)}`, {
        method: 'GET',
        headers: pollHeaders,
        signal
      });
      if (res.status === 401 || res.status === 403) {
        const authErr = new Error('Authentication required for scoring status');
        authErr.code = 'UNAUTHORIZED';
        throw authErr;
      }
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'ready' || data.status === 'completed' || data.stage === 'completed') {
          return data.result || data;
        }
        if (data.status === 'awaiting_reference_confirmation' || data.status === 'reference_unresolved') {
          return data;
        }
        if (data.status === 'failed' || data.status === 'unrateable' || data.status === 'canceled') {
          const err = new Error(data.error || 'AI scoring failed');
          err.code = data.status === 'unrateable' ? 'UNRATEABLE_ASSESSMENT' :
            data.status === 'canceled' ? 'ASSESSMENT_CANCELED' : 'SCORING_JOB_FAILED';
          throw err;
        }
      }
      await new Promise(r => setTimeout(r, intervalMs));
    }
    const timeoutErr = new Error('AI scoring timed out. Results will be saved to your history.');
    timeoutErr.code = 'SCORING_TIMEOUT';
    throw timeoutErr;
  }

  /**
   * Submits student reference confirmation or cancellation for ambiguous pronunciation targets.
   */
  async function confirmReference({ assessmentId, action = null, confirmations = null }) {
    if (!assessmentId) throw new Error('assessmentId is required for confirming reference');
    const headers = await getAuthHeaders();
    const payload = {};
    if (action) payload.action = action;
    if (confirmations) payload.confirmations = confirmations;

    const res = await fetch(`/api/ai-scoring/assessments/${encodeURIComponent(assessmentId)}/confirm-reference`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errPayload = await res.json().catch(() => null);
      const err = new Error(errPayload?.message || `Confirm reference failed (${res.status})`);
      err.status = res.status;
      err.code = errPayload?.error || 'CONFIRM_FAILED';
      throw err;
    }
    return res.json();
  }

  return {
    requestConsentAndConfirm,
    getConfirmationModal,
    blobToBase64,
    pollAssessmentResult,
    confirmReference,
    getAuthHeaders,
    speechV3Enabled,
    assessV3Recording,
    loadCanonicalBuffer,
    playV3Span
  };
});
