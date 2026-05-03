import { createInitialQueue, loadTestBank, selectAdaptiveItems, shouldRequestVowelHint, summarizeContrasts } from './test-bank.js';
import { PraatAPI } from '../pronunciation-analyzer/praat-api.js';

const FEEDBACK_TEXT = {
  target_clear: 'The target sound was clear in this recording.',
  target_present_inconsistent: 'The target sound was present, but the production was inconsistent.',
  closer_to_partner: 'This production sounded closer to the paired contrast than the target.',
  final_target_omitted: 'The final consonant was weak or missing in this production.',
  audio_retry_needed: 'The recording could not be scored reliably. Try again.'
};

const BAND_TEXT = {
  clear: 'Clear',
  close: 'Close',
  needs_review: 'Needs Review'
};

const CONTRAST_LABELS = {
  final_retention: 'Final consonants',
  theta_t: '/theta/ vs /t/',
  eth_d: '/eth/ vs /d/',
  sh_ch: '/sh/ vs /ch/',
  vowel_i_ih: '/i/ vs /ih/',
  vowel_e_ae: '/e/ vs /ae/'
};

class SegmentalScreeningApp {
  constructor(root) {
    this.root = root;
    this.bank = null;
    this.queue = [];
    this.currentIndex = 0;
    this.results = [];
    this.currentResult = null;
    this.currentHint = null;
    this.currentError = null;
    this.recordingState = 'ready';
    this.mediaStream = null;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.retryUsage = new Map();
    this.technicalIssueCounts = new Map();
    this.adaptiveSelection = null;
    this.currentSummary = [];
    this.praatAPI = new PraatAPI(`${window.location.origin}/api/pronunciation-test`);
    this.testHooks = window.__PRON_TEST_TEST_HOOKS__ || null;
    this.lastAssessmentToken = 0;

    // Entrance test integration
    const urlParams = new URLSearchParams(window.location.search || '');
    this.entranceToken = String(urlParams.get('entranceToken') || '').trim() || null;
    this._entranceSubmitAttempted = false;
    this._entranceSubmitStatus = null; // null | 'pending' | 'success' | 'error'
    this._entranceSubmitAlreadyUsed = false;
    this._entranceSubmitLastErrorStatus = null;
    this._entranceSubmitPromise = null;
  }

  async init() {
    this.bank = await loadTestBank();
    this.queue = createInitialQueue(this.bank);
    this.currentSummary = summarizeContrasts(this.results, this.bank.contrastPriority);
    this.render();
    this.bindEvents();
  }

  bindEvents() {
    this.root.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (!action) return;

      if (action === 'record-toggle') {
        await this.handleRecordToggle();
      }

      if (action === 'retry') {
        this.handleRetry();
      }

      if (action === 'advance') {
        this.handleAdvance();
      }
    });
  }

  get currentItem() {
    return this.queue[this.currentIndex] || null;
  }

  get isFinished() {
    return !this.currentItem;
  }

  getTechnicalIssueCount(itemId) {
    return Number(this.technicalIssueCounts.get(itemId) || 0);
  }

  recordTechnicalIssue(itemId) {
    this.technicalIssueCounts.set(itemId, this.getTechnicalIssueCount(itemId) + 1);
  }

  clearItemAttemptState(itemId) {
    this.technicalIssueCounts.delete(itemId);
  }

  setTechnicalError(message, item = this.currentItem) {
    this.currentError = message;
    if (item && !item.isPractice) {
      this.recordTechnicalIssue(item.id);
    }
    this.recordingState = 'ready';
    this.render();
  }

  render() {
    if (this.isFinished) {
      this.renderSummary();
      return;
    }

    const item = this.currentItem;
    const isPractice = Boolean(item?.isPractice);
    const hasTechnicalRetry = Boolean(this.currentError || (this.currentResult && !this.currentResult.usable));
    const technicalIssueCount = this.getTechnicalIssueCount(item.id);
    const canRetry = isPractice || hasTechnicalRetry || (!this.retryUsage.get(item.id) && !!this.currentResult?.usable);
    const canSkip = !isPractice && hasTechnicalRetry && technicalIssueCount >= 2;
    const canAdvance = Boolean(this.currentResult?.usable) || canSkip;
    const canRecord = this.recordingState === 'recording'
      || (this.recordingState === 'ready' && !this.currentResult && !this.currentError);
    const statusLabel = this.recordingState === 'ready'
      ? 'Ready'
      : this.recordingState === 'recording'
        ? 'Recording'
        : this.recordingState === 'uploading'
          ? 'Uploading'
          : 'Scoring';

    const progress = this.buildProgressText(item);
    const resultMarkup = this.currentResult ? this.renderResultCard(this.currentResult) : '';
    const hintMarkup = this.currentHint ? this.renderHintCard(this.currentHint) : '';
    const errorMarkup = this.currentError ? `<div class="pst-inline-error" role="alert">${this.currentError}</div>` : '';

    this.root.innerHTML = `
      <section class="pst-shell">
        <div class="pst-topbar">
          <div>
            <p class="pst-kicker">Segmental Screening</p>
            <h1 class="pst-title">Single-word screening for segmental contrasts</h1>
          </div>
          <a class="pst-exit" href="/">Back to practice</a>
        </div>

        <div class="pst-layout">
          <aside class="pst-sidecard">
            <p class="pst-side-label">Current stage</p>
            <h2>${progress.title}</h2>
            <p>${progress.detail}</p>
            <div class="pst-status-row">
              <span class="pst-status-pill">${statusLabel}</span>
              <span class="pst-status-note">${isPractice ? 'Practice item' : 'Scored item'}</span>
            </div>
            <ul class="pst-rules">
              <li>One scored-item retry before you move on.</li>
              <li>No overall composite score is shown.</li>
              <li>Vowel charts are exploratory and never affect scoring.</li>
            </ul>
          </aside>

          <main class="pst-card">
            <div class="pst-prompt-meta">
              <span class="pst-stage-chip">${item.stage}</span>
              <span class="pst-stage-chip">${item.contrastId}</span>
            </div>
            <h2 class="pst-word">${item.word}</h2>
            <p class="pst-ipa">/${item.displayIpa}/</p>
            <p class="pst-prompt-copy">Read the word aloud once at your normal pace. The target sound is <strong>${item.targetPhoneme}</strong>.</p>

            <div class="pst-controls">
              <button class="pst-record-btn" data-action="record-toggle" ${canRecord ? '' : 'disabled'}>
                ${this.recordingState === 'recording' ? 'Stop Recording' : 'Start Recording'}
              </button>
              <button class="pst-secondary-btn" data-action="retry" ${canRetry ? '' : 'disabled'}>
                ${isPractice ? 'Record Again' : 'Retry Once'}
              </button>
              <button class="pst-secondary-btn" data-action="advance" ${canAdvance ? '' : 'disabled'}>${canSkip ? 'Skip Item' : 'Next Item'}</button>
            </div>

            ${errorMarkup}
            ${resultMarkup}
            ${hintMarkup}
          </main>
        </div>
      </section>
    `;
  }

  renderResultCard(result) {
    const bandText = result.usable ? BAND_TEXT[result.provisionalBand] || result.provisionalBand : 'Try Again';
    const rawScore = typeof result.targetPhonemeAccuracyScore === 'number' ? result.targetPhonemeAccuracyScore : '--';
    const candidateList = Array.isArray(result.spokenPhonemeCandidates) && result.spokenPhonemeCandidates.length
      ? result.spokenPhonemeCandidates.map((candidate) => `<li><span>${candidate.phoneme}</span><strong>${candidate.score}</strong></li>`).join('')
      : '<li><span>No spoken-phoneme candidates</span><strong>--</strong></li>';

    return `
      <section class="pst-result-card" aria-live="polite">
        <div class="pst-result-head">
          <div>
            <p class="pst-result-label">Item result</p>
            <h3>${bandText}</h3>
          </div>
          <div class="pst-score-chip">${rawScore}</div>
        </div>
        <p class="pst-result-copy">${FEEDBACK_TEXT[result.feedbackCode] || FEEDBACK_TEXT.audio_retry_needed}</p>
        <dl class="pst-result-grid">
          <div>
            <dt>Target</dt>
            <dd>${result.targetPhoneme}</dd>
          </div>
          <div>
            <dt>Most likely spoken phoneme</dt>
            <dd>${result.mostLikelySpokenPhoneme || 'None detected'}</dd>
          </div>
          <div>
            <dt>Assessment status</dt>
            <dd>${result.assessmentStatus}</dd>
          </div>
          <div>
            <dt>Speech duration</dt>
            <dd>${result.audioQuality?.speechDurationMs || 0} ms</dd>
          </div>
        </dl>
        <div class="pst-candidates">
          <p class="pst-result-label">Spoken-phoneme candidates</p>
          <ul>${candidateList}</ul>
        </div>
      </section>
    `;
  }

  renderHintCard(hint) {
    if (!hint?.usable) {
      return '';
    }

    const rows = (hint.samples || []).map((sample) => `
      <div class="pst-hint-row">
        <span>${sample.pct}%</span>
        <span>F1 ${Math.round(sample.f1)}</span>
        <span>F2 ${Math.round(sample.f2)}</span>
      </div>
    `).join('');

    return `
      <section class="pst-hint-card">
        <p class="pst-result-label">Exploratory vowel hint</p>
        <p class="pst-hint-copy">Exploratory acoustic hint only. This chart does not affect your score.</p>
        <div class="pst-hint-grid">${rows}</div>
      </section>
    `;
  }

  startEntranceSubmission(summaries) {
    if (!this.entranceToken) return;
    if (this._entranceSubmitAttempted) return;
    if (this._entranceSubmitPromise) return;

    this._entranceSubmitAttempted = true;
    this._entranceSubmitStatus = 'pending';
    this._entranceSubmitAlreadyUsed = false;
    this._entranceSubmitLastErrorStatus = null;

    const payload = {
      token: this.entranceToken,
      results: this.results,
      contrastSummaries: summaries
    };

    this._entranceSubmitPromise = fetch('/api/entrance-tests/submit-segmental', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(async (res) => {
        let json = null;
        try {
          json = await res.json();
        } catch (e) {
          // ignore
        }

        if (!res.ok) {
          const err = new Error(json?.message || `HTTP ${res.status}`);
          err.status = res.status;
          throw err;
        }

        return json;
      })
      .then(() => {
        this._entranceSubmitStatus = 'success';
      })
      .catch((e) => {
        const status = Number(e?.status || 0) || null;
        if (status === 410) {
          this._entranceSubmitStatus = 'success';
          this._entranceSubmitAlreadyUsed = true;
          return;
        }

        this._entranceSubmitStatus = 'error';
        this._entranceSubmitLastErrorStatus = status;
        console.error('[SegmentalScreening] Failed to submit entrance test results:', e);
      })
      .finally(() => {
        this._entranceSubmitPromise = null;
        this.renderSummary();
      });
  }

  retryEntranceSubmission() {
    if (!this.entranceToken) return;
    if (this._entranceSubmitPromise) return;
    this._entranceSubmitAttempted = false;
    this._entranceSubmitStatus = null;
    this._entranceSubmitAlreadyUsed = false;
    this._entranceSubmitLastErrorStatus = null;
    this.renderSummary();
  }

  renderSummary() {
    const summaries = this.adaptiveSelection?.summaries || summarizeContrasts(this.results, this.bank?.contrastPriority || []);

    this.startEntranceSubmission(summaries);

    const cards = summaries.map((summary) => {
      const scoreLabel = summary.score === null ? 'No valid score' : `${summary.score}`;
      return `
        <article class="pst-summary-card">
          <p class="pst-result-label">${CONTRAST_LABELS[summary.contrastId] || summary.contrastId}</p>
          <h3>${scoreLabel}</h3>
          <p>${summary.lowConfidence ? 'Low confidence: one or fewer valid Stage 1 tokens.' : 'Core screen confidence is acceptable for this contrast.'}</p>
        </article>
      `;
    }).join('');

    const selectedText = this.adaptiveSelection?.selectedContrasts?.length
      ? this.adaptiveSelection.selectedContrasts.map((contrastId) => CONTRAST_LABELS[contrastId] || contrastId).join(', ')
      : 'None';

    const exitHref = '/';
    const exitText = this.entranceToken ? 'Done' : 'Back to practice';

    let entranceSubmitNote = '';
    if (this.entranceToken) {
      if (this._entranceSubmitStatus === 'pending' || !this._entranceSubmitAttempted) {
        entranceSubmitNote = '<p style="margin-top:12px; color: var(--pst-accent, #6b7280);">Submitting results to entrance test system…</p>';
      } else if (this._entranceSubmitStatus === 'success') {
        entranceSubmitNote = this._entranceSubmitAlreadyUsed
          ? '<p style="margin-top:12px; color: var(--pst-accent, #10b981);">This screening link was already submitted.</p>'
          : '<p style="margin-top:12px; color: var(--pst-accent, #10b981);">Results submitted to entrance test system.</p>';
      } else if (this._entranceSubmitStatus === 'error') {
        const statusText = this._entranceSubmitLastErrorStatus ? ` (HTTP ${this._entranceSubmitLastErrorStatus})` : '';
        entranceSubmitNote = `
          <p style="margin-top:12px; color: #ef4444;">
            Could not submit results${statusText}. Please retry.
            <button id="pst-entrance-retry" type="button" style="margin-left:8px; padding: 6px 10px; border: 1px solid #9ca3af; border-radius: 999px; background: transparent; cursor: pointer;">Retry</button>
          </p>
        `;
      }
    }

    this.root.innerHTML = `
      <section class="pst-shell">
        <div class="pst-topbar">
          <div>
            <p class="pst-kicker">Segmental Screening</p>
            <h1 class="pst-title">Screen complete</h1>
          </div>
          <a class="pst-exit" href="${exitHref}">${exitText}</a>
        </div>
        <section class="pst-summary-hero">
          <p>The screen stays provisional in v1. No pass/fail or composite score is shown.</p>
          <p>Adaptive follow-up contrasts for the weakest or least-certain core results: <strong>${selectedText}</strong></p>
          ${entranceSubmitNote}
        </section>
        <section class="pst-summary-grid">
          ${cards}
        </section>
      </section>
    `;

    if (this.entranceToken && this._entranceSubmitStatus === 'error') {
      const retryBtn = this.root.querySelector('#pst-entrance-retry');
      if (retryBtn && !retryBtn.__entranceRetryBound) {
        retryBtn.__entranceRetryBound = true;
        retryBtn.addEventListener('click', () => this.retryEntranceSubmission());
      }
    }
  }

  buildProgressText(item) {
    if (item.stage === 'practice') {
      return {
        title: 'Practice 1 of 1',
        detail: 'Warm up with one unscored control item.'
      };
    }

    const coreItems = this.queue.filter((entry) => entry.stage === 'core');
    const followupItems = this.queue.filter((entry) => entry.stage === 'followup');

    if (item.stage === 'core') {
      const currentCoreIndex = coreItems.findIndex((entry) => entry.id === item.id) + 1;
      return {
        title: `Core ${currentCoreIndex} of ${coreItems.length}`,
        detail: 'Stage 1 screens the fixed contrast set.'
      };
    }

    const currentFollowupIndex = followupItems.findIndex((entry) => entry.id === item.id) + 1;
    return {
      title: `Follow-up ${currentFollowupIndex} of ${followupItems.length}`,
      detail: 'Stage 2 checks the weakest or least-certain contrasts from the core screen.'
    };
  }

  async handleRecordToggle() {
    if (this.recordingState === 'recording') {
      await this.stopRecording();
      return;
    }

    await this.startRecording();
  }

  async startRecording() {
    if (this.currentResult || this.currentError) {
      return;
    }

    this.currentError = null;
    this.currentHint = null;

    if (this.testHooks?.getMockAudioBlob) {
      this.recordingState = 'recording';
      this.render();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder !== 'function') {
      this.setTechnicalError('This browser does not support microphone recording for this screen.', this.currentItem);
      return;
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.recordedChunks = [];
      this.mediaRecorder = new window.MediaRecorder(this.mediaStream);
      this.mediaRecorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) {
          this.recordedChunks.push(event.data);
        }
      });
      this.mediaRecorder.addEventListener('stop', async () => {
        const blob = new Blob(this.recordedChunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' });
        await this.processRecording(blob);
      }, { once: true });
      this.mediaRecorder.start();
      this.recordingState = 'recording';
      this.render();
    } catch (error) {
      this.setTechnicalError(error?.message || 'Microphone access failed.', this.currentItem);
    }
  }

  async stopRecording() {
    if (this.testHooks?.getMockAudioBlob) {
      this.recordingState = 'uploading';
      this.render();
      const blob = await this.testHooks.getMockAudioBlob();
      await this.processRecording(blob);
      return;
    }

    if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') {
      return;
    }

    this.recordingState = 'uploading';
    this.render();
    this.mediaRecorder.stop();
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }

  async processRecording(rawBlob) {
    try {
      const wavBlob = await this.prepareAssessmentBlob(rawBlob);
      await this.submitAssessment(this.currentItem, wavBlob);
    } catch (error) {
      this.setTechnicalError(error?.message || 'Recording processing failed.', this.currentItem);
    }
  }

  async prepareAssessmentBlob(blob) {
    if (this.testHooks?.overrideWavBlob) {
      return this.testHooks.overrideWavBlob(blob);
    }

    if (blob.type === 'audio/wav' || blob.type === 'audio/wave') {
      return blob;
    }

    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    if (typeof audioContext.close === 'function') {
      await audioContext.close().catch(() => { });
    }
    return this.audioBufferToWav(rendered);
  }

  audioBufferToWav(buffer) {
    const channelData = buffer.getChannelData(0);
    const dataLength = channelData.length;
    const wavBuffer = new ArrayBuffer(44 + dataLength * 2);
    const view = new DataView(wavBuffer);

    const writeString = (offset, value) => {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength * 2, true);

    let offset = 44;
    for (let index = 0; index < dataLength; index += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[index]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }

    return new Blob([wavBuffer], { type: 'audio/wav' });
  }

  async submitAssessment(item, wavBlob) {
    const assessmentToken = this.lastAssessmentToken + 1;
    this.lastAssessmentToken = assessmentToken;
    this.recordingState = 'scoring';
    this.render();

    const formData = new FormData();
    formData.append('audio', wavBlob, `${item.id}.wav`);
    formData.append('itemId', item.id);
    formData.append('word', item.word);
    formData.append('referenceText', item.referenceText);
    formData.append('referencePhonemes', JSON.stringify(item.referencePhonemes));
    formData.append('referencePhonemeIndex', String(item.referencePhonemeIndex));
    formData.append('targetPhoneme', item.targetPhoneme);
    formData.append('contrastPartnerPhoneme', item.contrastPartnerPhoneme || '');
    formData.append('targetPosition', item.targetPosition);
    formData.append('contrastId', item.contrastId);
    formData.append('category', item.category);
    formData.append('isPractice', String(Boolean(item.isPractice)));

    let response;
    let payload;
    try {
      response = await fetch('/api/pronunciation-test/assess', {
        method: 'POST',
        body: formData
      });
      payload = await response.json().catch(() => null);
    } catch (error) {
      this.setTechnicalError(error?.message || 'The scoring request failed.', item);
      return;
    }

    this.recordingState = 'ready';

    if (!response.ok || !payload?.success) {
      const errorMessage = payload?.message || 'The scoring request failed.';
      this.currentError = payload?.error === 'INVALID_AUDIO'
        ? `${errorMessage} ${payload?.details?.reason ? `Reason: ${payload.details.reason}.` : ''}`.trim()
        : errorMessage;
      this.recordTechnicalIssue(item.id);
      this.currentResult = null;
      this.currentHint = null;
      this.render();
      return;
    }

    this.currentError = null;
    if (payload.usable) {
      this.clearItemAttemptState(item.id);
    } else {
      this.recordTechnicalIssue(item.id);
    }
    this.currentResult = {
      ...payload,
      itemId: item.id,
      contrastId: item.contrastId,
      stage: item.stage,
      assessmentToken
    };
    this.currentHint = null;
    this.render();

    if (payload.usable && shouldRequestVowelHint(item)) {
      void this.fetchVowelHint(item, wavBlob, assessmentToken);
    }
  }

  async fetchVowelHint(item, wavBlob, assessmentToken) {
    try {
      const payload = await this.praatAPI.analyzeVowel(wavBlob, {
        itemId: item.id,
        targetPhoneme: item.targetPhoneme,
        category: item.category,
        endpoint: '/vowel-hint'
      });
      if (!payload?.success || payload?.usable !== true) {
        return;
      }
      if (this.currentItem?.id !== item.id) {
        return;
      }
      if (this.currentResult?.assessmentToken !== assessmentToken) {
        return;
      }
      this.currentHint = payload;
      this.render();
    } catch (_error) {
      // Vowel hints must never block the primary result path.
    }
  }

  handleRetry() {
    const item = this.currentItem;
    if (!item) return;
    const hasTechnicalRetry = Boolean(this.currentError || (this.currentResult && !this.currentResult.usable));

    if (!item.isPractice && this.retryUsage.get(item.id) && !hasTechnicalRetry) {
      return;
    }

    if (!item.isPractice && this.currentResult?.usable) {
      this.retryUsage.set(item.id, true);
    }

    this.currentResult = null;
    this.currentHint = null;
    this.currentError = null;
    this.recordingState = 'ready';
    this.render();
  }

  handleAdvance() {
    const item = this.currentItem;
    const canSkip = !item?.isPractice
      && Boolean(this.currentError || (this.currentResult && !this.currentResult.usable))
      && this.getTechnicalIssueCount(item.id) >= 2;
    if (!item || (!this.currentResult?.usable && !canSkip)) return;

    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (!item.isPractice && this.currentResult?.usable) {
      this.results.push({
        ...this.currentResult,
        itemId: item.id,
        contrastId: item.contrastId,
        stage: item.stage
      });
    } else if (!item.isPractice && canSkip) {
      this.results.push({
        itemId: item.id,
        contrastId: item.contrastId,
        stage: item.stage,
        usable: false,
        assessmentStatus: 'skipped_after_retry_limit',
        targetPhonemeAccuracyScore: null,
        provisionalBand: null,
        feedbackCode: 'audio_retry_needed'
      });
    }

    const justFinishedCore = item.stage === 'core'
      && this.queue.filter((entry) => entry.stage === 'core').every((entry) => this.results.some((result) => result.itemId === entry.id));

    if (justFinishedCore && !this.adaptiveSelection) {
      this.adaptiveSelection = selectAdaptiveItems(this.bank, this.results);
      this.currentSummary = this.adaptiveSelection.summaries;
      this.queue.push(...this.adaptiveSelection.adaptiveItems);
    }

    this.currentIndex += 1;
    this.clearItemAttemptState(item.id);
    this.currentResult = null;
    this.currentHint = null;
    this.currentError = null;
    this.recordingState = 'ready';
    this.render();
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('segmental-screening-root');
  if (!root) return;

  const app = new SegmentalScreeningApp(root);
  try {
    await app.init();
  } catch (error) {
    root.innerHTML = `<div class="pst-fatal" role="alert">Failed to load the screening flow: ${error?.message || 'Unknown error.'}</div>`;
  }
});
