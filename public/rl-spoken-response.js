/**
 * RL Spoken Response Controller
 * Implements additive "Practice spoken retelling" for Retell Lecture per BEL Spec §12.3.
 * Notes-only flow remains valid; spoken retelling is an additive step behind RL_SPOKEN_ASSESSMENT.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RLSpokenResponseController = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function isEnabled() {
    return Boolean(window.PteShellConfig?.rlSpokenAssessment);
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, m => {
      switch (m) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        case "'": return '&#039;';
        default: return m;
      }
    });
  }

  class RLSpokenResponseController {
    constructor() {
      this.isRecording = false;
      this.mediaRecorder = null;
      this.stream = null;
      this.chunks = [];
      this.rawRecordingBlob = null;
      this.processedRecordingBlob = null;
      this.recordingBlob = null;
      this.recordingBlobUrl = null;
      this.recordingDurationSec = 0;
      this.recordingGeneration = 0;
      this.recordingProcessingStatus = null;
      this.recordingSampleRateHz = null;
      this.recordingSampleCount = null;
      this.recordingFormat = null;
      this.recordingPlaybackTimeline = null;
      this.timerInterval = null;
    }

    isEnabled() {
      return isEnabled();
    }

    mount(containerEl, { entry, userNotes = '', onComplete = null } = {}) {
      if (!containerEl) return;
      if (this.containerEl === containerEl && this.currentEntry?.id === entry?.id && (this.isRecording || this.recordingBlob)) {
        return;
      }
      this.cleanup();
      this.containerEl = containerEl;
      this.currentEntry = entry;
      if (!this.isEnabled()) {
        containerEl.style.display = 'none';
        containerEl.innerHTML = '';
        return;
      }

      containerEl.style.display = 'block';
      containerEl.innerHTML = `
        <div class="rl-spoken-card" style="margin-top: 20px; padding: 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px;">
          <header class="rl-spoken-header" style="margin-bottom: 14px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <h4 style="margin: 0; font-size: 16px; font-weight: 700; color: #1e293b;">
                🎙️ Practice Spoken Retelling <span style="font-size: 12px; font-weight: 500; background: #e0f2fe; color: #0284c7; padding: 2px 8px; border-radius: 999px; margin-left: 6px;">AI Speaking</span>
              </h4>
              <span style="font-size: 12px; color: #64748b;">Max 40 seconds</span>
            </div>
            <p style="margin: 4px 0 0 0; font-size: 13px; color: #64748b;">
              Speak your retelling of the lecture out loud to receive pronunciation and fluency scoring.
            </p>
          </header>

          ${userNotes ? `
            <details style="margin-bottom: 14px; font-size: 13px; background: #fff; padding: 8px 12px; border-radius: 6px; border: 1px solid #e2e8f0;">
              <summary style="cursor: pointer; font-weight: 600; color: #475569;">Show your notes for reference while speaking</summary>
              <p style="margin: 6px 0 0 0; color: #334155; white-space: pre-wrap;">${escapeHtml(userNotes)}</p>
            </details>
          ` : ''}

          <div class="rl-spoken-controls" style="display: flex; flex-direction: column; gap: 12px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <button type="button" id="rl-spoken-record-btn" class="pte-btn pte-btn--primary" style="padding: 8px 16px; font-size: 14px; font-weight: 600; border-radius: 8px;">
                🔴 Start Retelling
              </button>
              <button type="button" id="rl-spoken-stop-btn" class="pte-btn pte-btn--secondary" style="display: none; padding: 8px 16px; font-size: 14px; font-weight: 600; border-radius: 8px;">
                ⏹️ Stop Recording
              </button>
              <span id="rl-spoken-timer" style="font-size: 14px; font-weight: 600; color: #475569; display: none;">00:00 / 00:40</span>
            </div>

            <div id="rl-spoken-playback-wrap" style="display: none; margin-top: 6px;">
              <audio id="rl-spoken-audio-el" controls style="width: 100%; height: 36px;"></audio>
            </div>

            <div id="rl-spoken-assessment-actions" style="display: none; margin-top: 10px;">
              <button type="button" id="rl-spoken-assess-btn" class="pte-btn pte-btn--primary" style="width: 100%; padding: 10px 16px; font-weight: 600; border-radius: 8px;">
                ⚡ Assess Spoken Retelling with AI
              </button>
              <div id="rl-spoken-status-msg" style="font-size: 13px; color: #64748b; margin-top: 6px; text-align: center;"></div>
            </div>

            <div id="rl-spoken-disclosure-container" style="margin-top: 14px;"></div>
          </div>
        </div>
      `;

      this.bindControls(containerEl, { entry, userNotes, onComplete });
    }

    async playAssessmentWordSegment(word, statusMsg) {
      const timeline = this.recordingPlaybackTimeline;
      const rawBlob = this.rawRecordingBlob;
      const startMs = Number(word?.startMs);
      const endMs = Number(word?.endMs);
      if (!timeline || timeline.rawBlob !== rawBlob || timeline.offsetKnown !== true
        || !Number.isFinite(timeline.removedLeadingMs) || timeline.removedLeadingMs < 0
        || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        if (statusMsg) statusMsg.textContent = 'Word replay is unavailable because this recording has no verified timing map. The full original recording is still available.';
        return false;
      }

      const start = startMs + timeline.removedLeadingMs;
      const end = endMs + timeline.removedLeadingMs;
      const url = this.recordingBlobUrl || (rawBlob ? (this.recordingBlobUrl = URL.createObjectURL(rawBlob)) : null);
      const coordinator = window.SegmentPlaybackCoordinator?.defaultCoordinator;
      if (!url || !coordinator) return false;
      const audioBuffer = await coordinator.getDecodedBuffer(url);
      const durationMs = Number(audioBuffer?.duration) * 1000;
      if (!Number.isFinite(durationMs) || end > durationMs + 20) {
        if (statusMsg) statusMsg.textContent = 'This word segment falls outside the original recording, so replay is unavailable.';
        return false;
      }
      return coordinator.playSegment({ audioUrl: url, startMs: start, endMs: end });
    }

    bindControls(containerEl, { entry, userNotes, onComplete }) {
      const recordBtn = containerEl.querySelector('#rl-spoken-record-btn');
      const stopBtn = containerEl.querySelector('#rl-spoken-stop-btn');
      const timerEl = containerEl.querySelector('#rl-spoken-timer');
      const playbackWrap = containerEl.querySelector('#rl-spoken-playback-wrap');
      const audioEl = containerEl.querySelector('#rl-spoken-audio-el');
      const actionsWrap = containerEl.querySelector('#rl-spoken-assessment-actions');
      const assessBtn = containerEl.querySelector('#rl-spoken-assess-btn');
      const statusMsg = containerEl.querySelector('#rl-spoken-status-msg');
      const disclosureEl = containerEl.querySelector('#rl-spoken-disclosure-container');

      recordBtn?.addEventListener('click', async () => {
        const captureGeneration = ++this.recordingGeneration;
        try {
          const captureChunks = [];
          this.chunks = captureChunks;
          this.rawRecordingBlob = null;
          this.processedRecordingBlob = null;
          this.recordingBlob = null;
          this.recordingDurationSec = 0;
          this.recordingProcessingStatus = 'processing';
          this.recordingSampleRateHz = null;
          this.recordingSampleCount = null;
          this.recordingFormat = null;
          this.recordingPlaybackTimeline = null;
          if (this.recordingBlobUrl) {
            URL.revokeObjectURL(this.recordingBlobUrl);
            this.recordingBlobUrl = null;
          }
          if (audioEl) audioEl.removeAttribute('src');
          if (playbackWrap) playbackWrap.style.display = 'none';
          if (actionsWrap) actionsWrap.style.display = 'none';
          if (disclosureEl) disclosureEl.innerHTML = '';
          if (statusMsg) statusMsg.textContent = '';

          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (captureGeneration !== this.recordingGeneration) {
            stream.getTracks().forEach(track => track.stop());
            return;
          }
          this.stream = stream;
          const mimeType = (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
            ? 'audio/webm;codecs=opus' : 'audio/webm';
          const recorder = new MediaRecorder(stream, { mimeType });
          this.mediaRecorder = recorder;

          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) captureChunks.push(e.data);
          };

          recorder.onstop = async () => {
            if (stream) {
              stream.getTracks().forEach(t => t.stop());
            }
            if (this.stream === stream) {
              this.stream = null;
            }
            if (captureChunks.length > 0) {
              const rawBlob = new Blob(captureChunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
              let prepared = null;
              try {
                const pipeline = window.AudioDspPipeline;
                if (!pipeline || typeof pipeline.prepareForAssessment !== 'function') throw new Error('Audio format conversion is unavailable.');
                prepared = await pipeline.prepareForAssessment(rawBlob);
              } catch (err) {
                console.warn('[RL Spoken] Audio format conversion failed; keeping the original recording playable:', err);
              }

              if (captureGeneration !== this.recordingGeneration) return;
              const outputBlob = prepared?.outputBlob || null;
              const isProcessedWav = typeof window.AudioDspPipeline?.isValidMono16kWav === 'function'
                && await window.AudioDspPipeline.isValidMono16kWav(prepared);
              if (captureGeneration !== this.recordingGeneration) return;
              this.rawRecordingBlob = rawBlob;
              this.processedRecordingBlob = isProcessedWav ? outputBlob : null;
              this.recordingBlob = rawBlob;
              this.recordingProcessingStatus = isProcessedWav
                ? (prepared.processingStatus || 'format-only')
                : 'format-conversion-failed';
              this.recordingSampleRateHz = isProcessedWav ? (prepared.audioBuffer?.sampleRate || 16000) : null;
              this.recordingSampleCount = isProcessedWav ? (prepared.sampleCount || prepared.audioBuffer?.length || null) : null;
              this.recordingFormat = isProcessedWav ? 'wav' : 'unavailable';
              const removedLeadingMs = prepared?.stats?.removedLeadingMs;
              this.recordingPlaybackTimeline = {
                rawBlob,
                offsetKnown: Number.isFinite(removedLeadingMs) && removedLeadingMs >= 0,
                removedLeadingMs: Number.isFinite(removedLeadingMs) && removedLeadingMs >= 0 ? removedLeadingMs : null
              };
              this.recordingBlobUrl = URL.createObjectURL(rawBlob);
              if (audioEl) audioEl.src = this.recordingBlobUrl;
              if (playbackWrap) playbackWrap.style.display = 'block';
              if (actionsWrap) actionsWrap.style.display = 'block';
              if (statusMsg && !isProcessedWav) {
                statusMsg.textContent = 'Your original recording is available for playback, but format conversion failed. Record again before assessment.';
              }
            }
          };

          recorder.start(250);
          this.isRecording = true;

          recordBtn.style.display = 'none';
          stopBtn.style.display = 'inline-block';
          timerEl.style.display = 'inline-block';

          const startTime = performance.now();
          this.timerInterval = setInterval(() => {
            const elapsed = Math.floor((performance.now() - startTime) / 1000);
            this.recordingDurationSec = elapsed;
            const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
            const secs = String(elapsed % 60).padStart(2, '0');
            timerEl.textContent = `${mins}:${secs} / 00:40`;
            if (elapsed >= 40) {
              this.stopRecording(recordBtn, stopBtn, timerEl);
            }
          }, 500);

        } catch (err) {
          console.error('[RL Spoken] Mic error:', err);
          alert('Microphone access denied or unavailable.');
        }
      });

      stopBtn?.addEventListener('click', () => {
        this.stopRecording(recordBtn, stopBtn, timerEl);
      });

      assessBtn?.addEventListener('click', async () => {
        if (!this.recordingBlob) return;
        if (this.recordingProcessingStatus === 'processing') {
          if (statusMsg) statusMsg.textContent = 'Preparing your recording…';
          return;
        }
        if (this.recordingFormat !== 'wav'
          || this.recordingSampleRateHz !== 16000
          || !Number.isInteger(this.recordingSampleCount)
          || this.recordingSampleCount <= 0) {
          if (statusMsg) statusMsg.textContent = 'Audio preparation failed. Record again before assessment.';
          return;
        }
        if (assessBtn) assessBtn.disabled = true;
        if (statusMsg) statusMsg.textContent = 'Calculating credit quote...';

        const assessmentGeneration = this.recordingGeneration;
        const originalBlob = this.recordingBlob;
        const isCurrent = () => assessmentGeneration === this.recordingGeneration && originalBlob === this.recordingBlob;
        try {
          const speechV3 = await window.AiScoringGate?.speechV3Enabled?.('retell_lecture');
          if (!isCurrent()) return;
          let flow = null;
          let gateResult = null;
          let assessmentResult = null;
          if (speechV3) {
            flow = await window.AiScoringGate.assessV3Recording({
              mode: 'retell_lecture', originalBlob: this.recordingBlob,
              questionId: entry?.id || null,
              promptSnapshot: { promptId: entry?.id || null, title: entry?.title || '',
                text: entry?.transcript || '' },
              responseSnapshot: { notes: userNotes, responseKind: 'spoken_retelling' }
            });
            gateResult = flow;
            assessmentResult = flow.result || null;
          } else {
          const sampleRate = this.recordingSampleRateHz;
          const sampleCount = this.recordingSampleCount;
          let base64Audio = null;
          if (window.AiScoringGate?.blobToBase64) {
                    base64Audio = await window.AiScoringGate.blobToBase64(this.processedRecordingBlob);
          }

          gateResult = await window.AiScoringGate.requestConsentAndConfirm({
            mode: 'retell_lecture',
            inputMeta: {
              sampleCount,
              sampleRateHz: sampleRate,
              audioBuffer: base64Audio
            },
            questionId: entry?.id || null
          });

          }
          if (!isCurrent()) return;
          if (!gateResult.allowed) {
            if (gateResult.cancelled) {
              if (statusMsg) statusMsg.textContent = 'AI assessment cancelled. No credits charged.';
              if (assessBtn) assessBtn.disabled = false;
              return;
            }
            throw new Error(gateResult.error || 'Scoring not authorized');
          }

          if (statusMsg) statusMsg.textContent = 'Analyzing retelling with Azure Speech AI...';

          if (!speechV3 && gateResult.assessmentId) {
            assessmentResult = await window.AiScoringGate.pollAssessmentResult(gateResult.assessmentId);
          } else if (!speechV3 && gateResult.unmetered) {
            assessmentResult = gateResult.result || null;
          }

          if (!isCurrent()) return;
          if (assessmentResult) {
            if (disclosureEl && window.TranscriptDisclosure) {
              const disclosure = new window.TranscriptDisclosure({
                containerEl: disclosureEl,
                onWordClick: (w) => {
                  if (speechV3 && flow?.canonicalBlob) {
                    const span = w.clip || w.clipTiming?.clipSpan;
                    if (span) window.AiScoringGate.playV3Span({ canonicalBlob: flow.canonicalBlob,
                      manifest: flow.manifest, span });
                    return;
                  }
                this.playAssessmentWordSegment(w, statusMsg).catch(() => {
                  if (statusMsg) statusMsg.textContent = 'The original recording is available, but this word could not be replayed.';
                });
              }
              });
              disclosure.render(assessmentResult);
            }

            if (statusMsg) statusMsg.textContent = 'Pronunciation assessment complete.';
            if (assessBtn) assessBtn.style.display = 'none';

            // Archive attempt with responseKind: 'spoken_retelling'
            const archiveInput = {
              practiceMode: 'notes',
              attemptId: flow?.attemptId || undefined,
              promptSnapshot: {
                promptId: entry?.id || null,
                title: entry?.title || '',
                text: entry?.transcript || '',
                sourceAssetPaths: [entry?.audioPath || entry?.audio || entry?.videoUrl].filter(Boolean),
                data: entry
              },
              responseSnapshot: {
                notes: userNotes,
                responseKind: 'spoken_retelling',
                spokenTranscript: assessmentResult.transcription?.rawTranscript || null,
                transcriptSource: 'server_asr',
                pronunciationAssessmentId: gateResult.assessmentId || null
              },
              answerSnapshot: {
                lectureTranscript: entry?.transcript || ''
              },
              resultSnapshot: {
                spokenAssessment: speechV3 ? { schemaVersion: 'bel.speech.v3',
                  assessmentId: gateResult.assessmentId,
                  overallScores: assessmentResult.overallScores } : assessmentResult
              },
              scoringSource: speechV3 ? 'bel.speech.v3' : 'ai',
              media: this.recordingBlob ? [{
                slot: 'student_retelling',
                label: 'Student spoken retelling',
                blob: this.recordingBlob,
                contentType: this.recordingBlob.type || 'audio/webm'
              }] : []
            };
            const save = speechV3
              ? window.PTEAttemptArchive?.patchAttempt?.(flow.attemptId, {
                responseSnapshot: archiveInput.responseSnapshot, answerSnapshot: archiveInput.answerSnapshot,
                resultSnapshot: archiveInput.resultSnapshot,
                scoringSnapshot: { source: 'bel.speech.v3', success: true, status: 'completed',
                  pronunciationAssessmentId: flow.assessmentId }
              })
              : window.PTEAttemptArchive?.saveAttempt?.(archiveInput);
            Promise.resolve(save).catch(err => console.warn('[PTE Archive] RL spoken attempt save failed:', err));

            if (typeof onComplete === 'function') {
              onComplete(assessmentResult);
            }
          } else {
            // Unmetered with no result (scoring switched off): say so instead of leaving
            // "Analyzing…" on screen with the button disabled.
            if (statusMsg) statusMsg.textContent = "AI scoring isn't available right now. Please try again later.";
            if (assessBtn) assessBtn.disabled = false;
          }
        } catch (err) {
          if (!isCurrent()) return;
          console.error('[RL Spoken Assess] Error:', err);
          if (statusMsg) statusMsg.textContent = err.message || 'Scoring failed. Please try again.';
          if (assessBtn) assessBtn.disabled = false;
        }
      });
    }

    stopRecording(recordBtn, stopBtn, timerEl) {
      if (!this.isRecording) return;
      this.isRecording = false;
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }
      if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        this.mediaRecorder.stop();
      }
      if (recordBtn) recordBtn.style.display = 'inline-block';
      if (stopBtn) stopBtn.style.display = 'none';
      if (timerEl) timerEl.style.display = 'none';
    }

    cleanup() {
      this.recordingGeneration += 1;
      if (this.isRecording) {
        this.stopRecording();
      }
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }
      if (this.stream) {
        try {
          this.stream.getTracks().forEach(t => t.stop());
        } catch (_) {}
        this.stream = null;
      }
      if (this.recordingBlobUrl) {
        try {
          URL.revokeObjectURL(this.recordingBlobUrl);
        } catch (_) {}
        this.recordingBlobUrl = null;
      }
      this.chunks = [];
      this.rawRecordingBlob = null;
      this.processedRecordingBlob = null;
      this.recordingBlob = null;
      this.recordingDurationSec = 0;
      this.recordingProcessingStatus = null;
      this.recordingSampleRateHz = null;
      this.recordingSampleCount = null;
      this.recordingFormat = null;
      this.recordingPlaybackTimeline = null;
    }
  }

  const instance = new RLSpokenResponseController();
  return instance;
});
