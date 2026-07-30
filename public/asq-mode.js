class AsqMode {
  constructor() {
    this.isActive = false;
    this.isInitialized = false;
    this.isRecording = false;
    this.database = [];
    this.databaseById = new Map();
    this.audioManifest = null;
    this.currentId = null;
    this.audioStream = null;
    this.mediaRecorder = null;
    this.speechRecognition = null;
    this.pendingTranscriptPromise = null;
    this.recordedBlobUrl = null;
    this.hasAudioSrc = false;
    this.activeAttemptId = 0;
    /** @type {Record<string, HTMLElement|null>} Cached DOM refs, populated in init() */
    this.els = {};
  }

  // ---------------------------------------------------------------------------
  // Recording support detection
  // ---------------------------------------------------------------------------

  getRecordingSupportState() {
    const hasGetUserMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const hasMediaRecorder = typeof window.MediaRecorder === 'function';
    const hasAudioContext = typeof window.AudioContext === 'function' || typeof window.webkitAudioContext === 'function';
    const hasOfflineAudioContext = typeof window.OfflineAudioContext === 'function';
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const hasSpeechRecognition = typeof SpeechRecognition === 'function';
    return {
      supported: hasGetUserMedia && hasMediaRecorder && hasAudioContext && hasOfflineAudioContext && hasSpeechRecognition
    };
  }

  // ---------------------------------------------------------------------------
  // Speech Recognition helpers
  // ---------------------------------------------------------------------------

  createSpeechRecognitionSession() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (typeof SpeechRecognition !== 'function') return null;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;
    return recognition;
  }

  startSpeechRecognition() {
    if (this.speechRecognition) {
      try { this.speechRecognition.stop(); } catch (_) { /* intentional */ }
      this.speechRecognition = null;
    }

    const recognition = this.createSpeechRecognitionSession();
    if (!recognition) {
      const err = new Error('Speech recognition not available.');
      err.code = 'STT_UNAVAILABLE';
      throw err;
    }

    this.pendingTranscriptPromise = new Promise((resolve, reject) => {
      let resolved = false;

      recognition.onresult = (event) => {
        if (resolved) return;
        const text = String(event?.results?.[0]?.[0]?.transcript || '').trim();
        resolved = true;
        resolve(text);
      };
      recognition.onerror = (event) => {
        if (resolved) return;
        const error = new Error(`Speech recognition error: ${event?.error || 'unknown'}`);
        error.code = 'STT_FAILED';
        error.details = { error: event?.error || null };
        resolved = true;
        reject(error);
      };
      recognition.onend = () => {
        if (resolved) return;
        resolved = true;
        resolve('');
      };
    });

    this.speechRecognition = recognition;
    try {
      recognition.start();
    } catch (error) {
      this.speechRecognition = null;
      this.pendingTranscriptPromise = null;
      throw error;
    }
  }

  stopSpeechRecognition() {
    if (!this.speechRecognition) return;
    try { this.speechRecognition.stop(); } catch (_) { /* intentional */ }
  }

  async waitForTranscript({ timeoutMs = 2500 } = {}) {
    const promise = this.pendingTranscriptPromise;
    if (!promise) return '';

    const timeout = new Promise((resolve) => {
      setTimeout(() => resolve(''), timeoutMs);
    });

    let didTimeout = false;
    try {
      const result = await Promise.race([
        promise,
        timeout.then(() => {
          didTimeout = true;
          return '';
        })
      ]);
      return String(result || '').trim();
    } finally {
      if (didTimeout) {
        try { this.stopSpeechRecognition(); } catch (_) { /* intentional */ }
      }
      this.pendingTranscriptPromise = null;
      this.speechRecognition = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Data parsing
  // ---------------------------------------------------------------------------

  normalizeAnswerCell(answerCell) {
    const normalized = String(answerCell || '').trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!normalized) return null;
    let parts = normalized.split(/\n\s*---\s*\n/);
    if (parts.length < 2) parts = normalized.split(/\s*---\s*/);
    if (parts.length < 2) return null;
    const promptText = String(parts[0] || '').trim();
    const answersRaw = String(parts.slice(1).join('\n---\n') || '').trim();
    if (!promptText || !answersRaw) return null;
    const acceptedAnswers = answersRaw
      .split('/')
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    if (acceptedAnswers.length === 0) return null;
    return { promptText, answersRaw, acceptedAnswers };
  }

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  async loadWorkbookIfNeeded() {
    if (this.database.length > 0) return;
    if (!window.XLSX) {
      throw new Error('XLSX library not loaded.');
    }

    const res = await fetch(`/database/quiz/ASQ/ASQ.xlsx?v=${Date.now()}`);
    if (!res.ok) {
      throw new Error('ASQ workbook not found.');
    }
    const arrayBuffer = await res.arrayBuffer();
    const workbook = window.XLSX.read(arrayBuffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = window.XLSX.utils.sheet_to_json(sheet);

    this.database = rows
      .map((row, index) => {
        const id = row?.ID ?? row?.id ?? (index + 1);
        const answerCell = row?.ANSWER ?? row?.Answer ?? row?.answer ?? '';
        const parsed = this.normalizeAnswerCell(answerCell);
        if (!parsed) return null;
        return {
          id: String(id),
          promptText: parsed.promptText,
          answerDisplay: parsed.answersRaw,
          acceptedAnswers: parsed.acceptedAnswers
        };
      })
      .filter(Boolean);

    // Build O(1) lookup map
    this.databaseById = new Map(this.database.map((item) => [item.id, item]));
  }

  normalizeManifestPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;
    if (payload.files && typeof payload.files === 'object') return payload.files;
    if (payload.byId && typeof payload.byId === 'object') return payload.byId;
    return payload;
  }

  async loadAudioManifestIfNeeded() {
    if (this.audioManifest) return;
    const res = await fetch(`/database/quiz/ASQ/audio/manifest.json?v=${Date.now()}`);
    if (!res.ok) {
      this.audioManifest = null;
      return;
    }
    const payload = await res.json().catch(() => null);
    this.audioManifest = this.normalizeManifestPayload(payload);
  }

  // ---------------------------------------------------------------------------
  // Audio source resolution
  // ---------------------------------------------------------------------------

  getAudioSrcForId(id) {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) return null;

    const entry = this.audioManifest && Object.prototype.hasOwnProperty.call(this.audioManifest, normalizedId)
      ? this.audioManifest[normalizedId]
      : null;

    const file = String(entry || `${normalizedId}.mp3`).trim();
    if (!file) return null;
    if (file.startsWith('http://') || file.startsWith('https://') || file.startsWith('/')) return file;
    return `/database/quiz/ASQ/audio/${file}`;
  }

  // ---------------------------------------------------------------------------
  // Question selection UI
  // ---------------------------------------------------------------------------

  populateQuestionSelect() {
    const select = this.els.select;
    if (!select) return;

    const existing = new Set(Array.from(select.options).map((opt) => opt.value));
    this.database.forEach((item) => {
      if (!item?.id) return;
      if (existing.has(item.id)) return;
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = `Question ${item.id}`;
      select.appendChild(opt);
    });
  }

  pickRandomQuestionId() {
    const candidates = this.database
      .map((item) => item?.id)
      .filter(Boolean)
      .filter((id) => !!this.getAudioSrcForId(id));
    if (candidates.length === 0) return this.database[0]?.id || null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  // ---------------------------------------------------------------------------
  // Current question helpers
  // ---------------------------------------------------------------------------

  getCurrentItem() {
    if (!this.currentId) return null;
    return this.databaseById.get(this.currentId) || null;
  }

  // ---------------------------------------------------------------------------
  // Status messaging
  // ---------------------------------------------------------------------------

  setStatus(message, tone = 'muted') {
    const el = this.els.statusMessage;
    if (!el) return;
    el.textContent = String(message || '');
    if (tone === 'error') el.style.color = '#b91c1c';
    else if (tone === 'success') el.style.color = '#166534';
    else el.style.color = 'var(--text-muted)';
  }

  invalidateActiveAttempt() {
    this.activeAttemptId += 1;
    return this.activeAttemptId;
  }

  isAttemptCurrent(attemptId) {
    return attemptId === this.activeAttemptId && this.isActive;
  }

  pausePromptAudio() {
    const { promptAudio, playBtn } = this.els;
    if (promptAudio) {
      try { promptAudio.pause(); } catch (_) { /* intentional */ }
    }
    if (playBtn) playBtn.textContent = 'Play';
  }

  resetRecordingControls({ showRecordButton = true, showRedoButton = false } = {}) {
    const { recordBtn, stopBtn, redoBtn } = this.els;
    this.isRecording = false;
    if (recordBtn) {
      recordBtn.disabled = false;
      recordBtn.style.display = showRecordButton ? '' : 'none';
    }
    if (stopBtn) {
      stopBtn.disabled = false;
      stopBtn.style.display = 'none';
    }
    if (redoBtn) {
      redoBtn.style.display = showRedoButton ? '' : 'none';
    }
  }

  // ---------------------------------------------------------------------------
  // Prompt audio + question text
  // ---------------------------------------------------------------------------

  setPromptAudioForCurrent() {
    const audioEl = this.els.promptAudio;
    const textEl = this.els.questionText;
    const recordBtn = this.els.recordBtn;
    const redoBtn = this.els.redoBtn;
    if (!audioEl) return;

    this.pausePromptAudio();
    const src = this.getAudioSrcForId(this.currentId);
    audioEl.src = src || '';
    audioEl.load();
    this.hasAudioSrc = !!src;

    // Show record button and hide redo button when loading a new question
    if (recordBtn) recordBtn.style.display = '';
    if (redoBtn) redoBtn.style.display = 'none';

    // Hide question text until user submits
    if (textEl) {
      const item = this.getCurrentItem();
      textEl.textContent = item ? item.promptText : '';
      textEl.style.display = 'none';
    }

    // Reset previous result state
    this.resetResultUI();
  }

  /** Clear stale result/recording UI from the previous question */
  resetResultUI() {
    const { resultBox, userAudioBox } = this.els;
    if (resultBox) resultBox.style.display = 'none';
    this.clearRecordedAudio();
    if (userAudioBox) userAudioBox.style.display = 'none';
  }

  /** Reset UI to re-attempt the current question */
  redoQuestion() {
    this.invalidateActiveAttempt();
    this.resetResultUI();
    this.resetRecordingControls({ showRecordButton: true, showRedoButton: false });
    this.setStatus('Play the prompt audio, then record your answer.', 'muted');

    // Hide question text again
    if (this.els.questionText) {
      this.els.questionText.style.display = 'none';
    }
  }

  // ---------------------------------------------------------------------------
  // Prompt playback
  // ---------------------------------------------------------------------------

  playPrompt() {
    const audioEl = this.els.promptAudio;
    const playBtn = this.els.playBtn;
    if (!audioEl) return;
    if (!this.hasAudioSrc) {
      this.setStatus('Prompt audio is not available yet for this question.', 'error');
      return;
    }

    if (audioEl.paused) {
      audioEl.play().catch(() => { /* intentional */ });
      if (playBtn) playBtn.textContent = 'Pause';
      return;
    }

    audioEl.pause();
    if (playBtn) playBtn.textContent = 'Play';
  }

  // ---------------------------------------------------------------------------
  // Media stream helpers
  // ---------------------------------------------------------------------------

  stopTracks(stream) {
    try {
      (stream?.getTracks?.() || []).forEach((track) => track.stop());
    } catch (_) { /* intentional */ }
  }

  stopMediaStream() {
    if (this.audioStream) {
      this.stopTracks(this.audioStream);
      this.audioStream = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Recorded audio management
  // ---------------------------------------------------------------------------

  clearRecordedAudio() {
    const audioEl = this.els.userRecordingAudio;
    if (audioEl) {
      audioEl.pause();
      audioEl.removeAttribute('src');
      audioEl.load();
    }
    if (this.recordedBlobUrl) {
      try { URL.revokeObjectURL(this.recordedBlobUrl); } catch (_) { /* intentional */ }
      this.recordedBlobUrl = null;
    }
  }

  showRecordedAudio(blob) {
    const box = this.els.userAudioBox;
    const audioEl = this.els.userRecordingAudio;
    if (!box || !audioEl) return;
    this.clearRecordedAudio();
    const url = URL.createObjectURL(blob);
    this.recordedBlobUrl = url;
    audioEl.src = url;
    box.style.display = 'block';
  }

  // ---------------------------------------------------------------------------
  // Result display
  // ---------------------------------------------------------------------------

  showResult({ isCorrect, transcript, answerDisplay, xpEarned }) {
    const { resultBox, resultStatus, transcriptFeedback, correctAnswers, questionText, recordBtn, redoBtn } = this.els;
    if (!resultBox || !resultStatus || !transcriptFeedback || !correctAnswers) return;

    resultBox.style.display = 'block';
    resultStatus.textContent = isCorrect ? 'Correct' : 'Incorrect';
    resultStatus.style.color = isCorrect ? '#166534' : '#b91c1c';

    // Hide record button and show redo button after showing result
    if (recordBtn) recordBtn.style.display = 'none';
    if (redoBtn) redoBtn.style.display = '';

    // Reveal question text after submission
    if (questionText) {
      questionText.style.display = '';
    }

    const xpText = Number.isFinite(Number(xpEarned)) ? ` (+${Number(xpEarned)} XP)` : '';
    if (xpText) {
      resultStatus.textContent = `${resultStatus.textContent}${xpText}`;
    }

    // Safe DOM construction — no innerHTML with user data
    const said = String(transcript || '').trim() || 'Nothing detected';
    transcriptFeedback.textContent = '';
    transcriptFeedback.append('You said: ');
    const em = document.createElement('em');
    em.textContent = `"${said}"`;
    transcriptFeedback.appendChild(em);

    correctAnswers.textContent = answerDisplay ? `Accepted answers: ${answerDisplay}` : '';
  }

  // ---------------------------------------------------------------------------
  // Answer matching
  // ---------------------------------------------------------------------------

  tokenizeForAsqMatch(str) {
    return (str || '')
      .toLowerCase()
      .replace(/[^\w\s']/g, '')
      .split(/\s+/)
      .filter(Boolean);
  }

  containsPhraseTokens(haystackTokens, needleTokens) {
    if (!Array.isArray(haystackTokens) || !Array.isArray(needleTokens)) return false;
    if (needleTokens.length === 0) return false;
    if (needleTokens.length === 1) return haystackTokens.includes(needleTokens[0]);
    if (haystackTokens.length < needleTokens.length) return false;

    for (let i = 0; i <= haystackTokens.length - needleTokens.length; i++) {
      let ok = true;
      for (let j = 0; j < needleTokens.length; j++) {
        if (haystackTokens[i + j] !== needleTokens[j]) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  }

  isTranscriptCorrect(transcript, acceptedAnswers) {
    const haystack = this.tokenizeForAsqMatch(String(transcript || ''));
    const aliases = Array.isArray(acceptedAnswers) ? acceptedAnswers : [];
    for (const alias of aliases) {
      const needle = this.tokenizeForAsqMatch(String(alias || ''));
      if (this.containsPhraseTokens(haystack, needle)) {
        return { ok: true, matchedAlias: String(alias || '') };
      }
    }
    return { ok: false, matchedAlias: null };
  }

  // ---------------------------------------------------------------------------
  // Recording flow
  // ---------------------------------------------------------------------------

  async startRecording() {
    // Guard against re-entrant recording
    if (this.isRecording) return;

    const { recordBtn, stopBtn } = this.els;
    const attemptId = this.invalidateActiveAttempt();

    const support = this.getRecordingSupportState();
    if (!support.supported) {
      console.warn('[ASQ] Recording setup not supported');
      this.setStatus('Recording or speech recognition is not supported in this browser.', 'error');
      return;
    }

    this.isRecording = true;
    this.setStatus('Recording...', 'muted');
    if (recordBtn) recordBtn.disabled = true;
    if (stopBtn) {
      stopBtn.style.display = 'inline-flex';
      stopBtn.disabled = false;
    }

    try {
      this.startSpeechRecognition();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recordedChunks = [];
      const recorder = new window.MediaRecorder(stream);

      recorder.ondataavailable = (event) => {
        if (event.data?.size) recordedChunks.push(event.data);
      };

      recorder.onstop = async () => {
        this.stopMediaStream();
        if (this.mediaRecorder === recorder) {
          this.mediaRecorder = null;
        }
        this.resetRecordingControls({ showRecordButton: true, showRedoButton: false });

        if (!this.isAttemptCurrent(attemptId)) {
          return;
        }

        if (recordedChunks.length === 0) {
          this.setStatus('We could not capture that recording. Please try again.', 'error');
          return;
        }

        const rawBlob = new Blob(recordedChunks, { type: recorder.mimeType || 'audio/webm' });
        this.showRecordedAudio(rawBlob);

        try {
          this.setStatus('Transcribing...', 'muted');
          const transcript = await this.waitForTranscript({ timeoutMs: 5000 });
          if (!this.isAttemptCurrent(attemptId)) {
            return;
          }
          const item = this.getCurrentItem();
          const localCheck = this.isTranscriptCorrect(transcript, item?.acceptedAnswers || []);

          let xpEarned = null;
          const scoringResult = await window.handleDualTrackScoring?.('asq', item?.id, transcript);
          if (!this.isAttemptCurrent(attemptId)) {
            return;
          }
          if (scoringResult && scoringResult.success) {
            xpEarned = scoringResult.xpEarned;
          }

          const canonicalIsCorrect = scoringResult && scoringResult.success
            ? Number(scoringResult.accuracy) >= 0.999
            : null;
          const isCorrect = canonicalIsCorrect === null ? localCheck.ok : canonicalIsCorrect;

          this.showResult({
            isCorrect,
            transcript,
            answerDisplay: item?.answerDisplay || '',
            xpEarned
          });

          window.PTEAttemptArchive?.saveAttempt?.({
            practiceMode: 'asq',
            promptSnapshot: {
              promptId: item?.id || null,
              text: item?.question || item?.prompt || '',
              data: item || null
            },
            responseSnapshot: { transcript },
            answerSnapshot: {
              acceptedAnswers: item?.acceptedAnswers || [],
              answerDisplay: item?.answerDisplay || ''
            },
            resultSnapshot: {
              correct: isCorrect,
              localCheck,
              xpEarned,
              scoringResult
            },
            scoringSource: scoringResult?.success ? 'dual-track' : 'client',
            media: [{
              slot: 'student',
              label: 'Student answer',
              blob: rawBlob,
              contentType: rawBlob.type || 'audio/webm'
            }]
          }).catch((archiveError) => console.warn('[PTE Archive] ASQ save failed:', archiveError));

          if (!transcript) {
            this.setStatus('No speech detected. Try again and keep your answer short.', 'error');
            return;
          }

          this.setStatus(isCorrect ? 'Nice. Keep it short and clear.' : 'Try again and say one of the accepted answers.', isCorrect ? 'success' : 'error');
        } catch (error) {
          if (!this.isAttemptCurrent(attemptId)) {
            return;
          }
          console.error('[ASQ] Transcription/scoring failed:', error);
          this.setStatus('Transcription failed. Please try again.', 'error');
        }
      };

      this.audioStream = stream;
      this.mediaRecorder = recorder;
      recorder.start();
    } catch (error) {
      console.error('[ASQ] Microphone error:', error);
      this.resetRecordingControls({ showRecordButton: true, showRedoButton: false });
      this.setStatus('Microphone access failed. Please allow mic permission and try again.', 'error');
      this.stopMediaStream();
      this.mediaRecorder = null;
      this.stopSpeechRecognition();
    }
  }

  stopRecording() {
    this.stopSpeechRecognition();
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      try { this.mediaRecorder.stop(); } catch (_) { /* intentional */ }
    }
  }

  // ---------------------------------------------------------------------------
  // Question navigation
  // ---------------------------------------------------------------------------

  async setQuestionById(id) {
    this.invalidateActiveAttempt();
    this.stopRecording();
    this.stopMediaStream();
    this.currentId = String(id || '').trim() || null;
    if (!this.currentId) return;
    // `random` is a selection command, not a persistent question identity.
    // Keep the native source select and the shared picker anchored to the
    // actual question selected from the database.
    if (this.els.select) {
      const option = Array.from(this.els.select.options).find((entry) => String(entry.value) === this.currentId);
      if (option) this.els.select.value = this.currentId;
    }
    this.setPromptAudioForCurrent();
    window.SpeakingPracticeController?.sync?.('asq');

    // Update URL with current question ID (replaceState — no history entry per question)
    if (window.PracticeRouter && this.currentId) {
      window.PracticeRouter.replaceRoute('asq', this.currentId);
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async onEnter() {
    this.isActive = true;
    if (!this.isInitialized) {
      await this.init();
    }
    this.setStatus('Play the prompt audio, then record your answer.', 'muted');
  }

  onExit() {
    this.invalidateActiveAttempt();
    this.isActive = false;
    this.pausePromptAudio();
    this.stopRecording();
    this.stopMediaStream();
    this.resetRecordingControls({ showRecordButton: true, showRedoButton: false });
    this.resetResultUI();
    this.clearRecordedAudio();
    if (this.els.questionText) {
      this.els.questionText.style.display = 'none';
    }
  }

  async init() {
    this.isInitialized = true;

    // Cache all DOM refs once
    this.els = {
      playBtn: document.getElementById('asq-play-prompt-btn'),
      select: document.getElementById('asq-question-select'),
      recordBtn: document.getElementById('asq-record-btn'),
      stopBtn: document.getElementById('asq-stop-btn'),
      redoBtn: document.getElementById('asq-redo-btn'),
      promptAudio: document.getElementById('asq-prompt-audio'),
      questionText: document.getElementById('asq-question-text'),
      statusMessage: document.getElementById('asq-status-message'),
      userAudioBox: document.getElementById('asq-user-audio-box'),
      userRecordingAudio: document.getElementById('asq-user-recording-audio'),
      resultBox: document.getElementById('asq-result-box'),
      resultStatus: document.getElementById('asq-result-status'),
      transcriptFeedback: document.getElementById('asq-transcript-feedback'),
      correctAnswers: document.getElementById('asq-correct-answers')
    };

    const { playBtn, select, recordBtn, stopBtn, redoBtn, promptAudio } = this.els;

    if (playBtn) playBtn.addEventListener('click', () => this.playPrompt());
    if (recordBtn) recordBtn.addEventListener('click', () => this.startRecording());
    if (stopBtn) stopBtn.addEventListener('click', () => this.stopRecording());
    if (redoBtn) redoBtn.addEventListener('click', () => this.redoQuestion());

    // Fix: assign onended once to avoid listener accumulation
    if (promptAudio) {
      promptAudio.addEventListener('ended', () => {
        if (playBtn) playBtn.textContent = 'Play';
      });
    }

    if (select) {
      select.addEventListener('change', async () => {
        const value = String(select.value || '').trim();
        if (value === 'random') {
          await this.setQuestionById(this.pickRandomQuestionId());
          return;
        }
        await this.setQuestionById(value);
      });
    }

    try {
      await this.loadWorkbookIfNeeded();
      await this.loadAudioManifestIfNeeded();
      this.populateQuestionSelect();
      await this.setQuestionById(this.pickRandomQuestionId());
      if (!this.getAudioSrcForId(this.currentId)) {
        this.setStatus('ASQ audio is not ready yet. This mode will unlock once audio is added.', 'error');
      }
    } catch (error) {
      console.error('[ASQ] init failed:', error);
      this.setStatus('ASQ could not load yet. This mode will unlock once audio is added.', 'error');
      if (recordBtn) recordBtn.disabled = true;
      if (playBtn) playBtn.disabled = true;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.ASQMode = new AsqMode();

  // Deep-link support: listen for PracticeRouter question navigation events
  window.addEventListener('practice-route-question', (event) => {
    const { mode, questionId } = event.detail || {};
    if (mode !== 'asq' || !questionId || !window.ASQMode) return;
    const asq = window.ASQMode;
    if (!asq.isActive || asq.database.length === 0) return;
    asq.setQuestionById(questionId);
    // Sync the dropdown
    if (asq.els.select) asq.els.select.value = questionId;
  });
});
