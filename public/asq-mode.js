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

    // PTE Speaking Shell v3 state
    this.v3Active = false;
    this.v3Phase = 'loading';
    this.questionGen = 0;
    this.attemptGen = 0;
    this.v3Timer = null;
    this.v3RecordRAF = null;
    this.pteAudioBox = null;
    this.pteRecorderWidget = null;
    this.v3RecordedDurationSec = 0;
    this.v3LastResult = null;
    this.v3SelectedListenSource = 'question';
    this.v3AudioElement = null;
    this.v3RecordingBlob = null;
    this.v3DspPromise = null;
    this.v3TranscriptText = '';
    this.v3PrepStartTime = 0;
    this.v3RecordStartTime = 0;
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
    // The manifest is optional — every clip is named `<id>.mp3` and getAudioSrcForId
    // falls back to that convention. The old guard was `if (this.audioManifest) return`,
    // which never short-circuits when the fetch failed (null is falsy), so a missing
    // manifest was re-requested — and re-404'd — on every question.
    if (this.audioManifestLoaded) return;
    this.audioManifestLoaded = true;
    try {
      const res = await fetch(`/database/quiz/ASQ/audio/manifest.json?v=${Date.now()}`);
      if (!res.ok) {
        this.audioManifest = null;
        return;
      }
      const payload = await res.json().catch(() => null);
      this.audioManifest = this.normalizeManifestPayload(payload);
    } catch (_error) {
      this.audioManifest = null;
    }
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
    const { promptAudio } = this.els;
    if (promptAudio) {
      try { promptAudio.pause(); } catch (_) { /* intentional */ }
    }
    // The audio element's own `pause` event repaints the button, but a stubbed
    // element (tests) or a pause before any src is set never fires it.
    this.setPlayButtonLabel('Play');
  }

  /** Repaint the shared audio-player button. Falls back to textContent when the
   *  icon/label spans are missing, so a bare button still reads correctly. */
  setPlayButtonLabel(label) {
    const { playBtn, playIcon, playLabel } = this.els;
    if (playLabel && playLabel.isConnected) {
      playLabel.textContent = label;
    } else if (playBtn) {
      playBtn.textContent = label;
    }
    if (playIcon && playIcon.isConnected) {
      playIcon.textContent = label === 'Pause' ? 'pause' : 'play_arrow';
    }
  }

  resetRecordingControls({ showRecordButton = true, showRedoButton = false } = {}) {
    const { recordBtn, stopBtn, redoBtn } = this.els;
    this.isRecording = false;
    if (recordBtn) {
      recordBtn.disabled = false;
      recordBtn.hidden = !showRecordButton;
      recordBtn.style.display = showRecordButton ? '' : 'none';
    }
    if (stopBtn) {
      stopBtn.disabled = false;
      stopBtn.hidden = true;
      stopBtn.style.display = 'none';
    }
    if (redoBtn) {
      redoBtn.hidden = !showRedoButton;
      redoBtn.style.display = showRedoButton ? '' : 'none';
    }
    window.SpeakingPracticeController?.sync?.('asq');
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
    if (src && window.MediaUrlResolver && typeof window.MediaUrlResolver.loadAudio === 'function') {
      window.MediaUrlResolver.loadAudio(audioEl, src, { mode: 'quiz' });
    } else {
      audioEl.src = src || '';
      audioEl.load();
    }
    this.hasAudioSrc = !!src;
    this.audioPlayer?.reset();
    this.audioPlayer?.setEnabled(this.hasAudioSrc);

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
    // The shared step indicator reads the result box, so resync once it is hidden.
    window.SpeakingPracticeController?.sync?.('asq');
  }

  /** Reset UI to re-attempt the current question */
  redoQuestion() {
    if (this.isV3()) {
      return this.retryRecording();
    }
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
    if (!audioEl) return;
    if (!this.hasAudioSrc) {
      this.setStatus('Prompt audio is not available yet for this question.', 'error');
      return;
    }

    if (audioEl.paused) {
      if (this.els.volume) audioEl.volume = Number(this.els.volume.value);
      audioEl.play().catch(() => { /* intentional */ });
      this.setPlayButtonLabel('Pause');
      return;
    }

    audioEl.pause();
    this.setPlayButtonLabel('Play');
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
    if (recordBtn) {
      recordBtn.hidden = true;
      recordBtn.style.display = 'none';
    }
    if (redoBtn) {
      redoBtn.hidden = false;
      redoBtn.style.display = '';
    }

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
    window.SpeakingPracticeController?.sync?.('asq');
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
    if (this.isV3()) {
      return this.startV3Recording();
    }
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
      stopBtn.hidden = false;
      stopBtn.style.display = 'inline-flex';
      stopBtn.disabled = false;
    }
    window.SpeakingPracticeController?.sync?.('asq');

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

        const dspPromise = (window.AudioDspPipeline && typeof window.AudioDspPipeline.enhance === 'function')
          ? window.AudioDspPipeline.enhance(rawBlob).then((result) => {
              if (this.isAttemptCurrent(attemptId) && result?.wavBlob) {
                this.showRecordedAudio(result.wavBlob);
              }
              return result?.wavBlob || rawBlob;
            }).catch((err) => {
              console.warn('[ASQ] AudioDspPipeline enhancement failed, keeping raw audio:', err);
              return rawBlob;
            })
          : Promise.resolve(rawBlob);

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

          const finalBlob = await dspPromise.catch(() => rawBlob);

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
              blob: finalBlob,
              contentType: finalBlob.type || 'audio/wav'
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
    if (this.isV3()) {
      return this.stopV3Recording();
    }
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

    if (this.isV3() && this.v3Active) {
      this.startV3QuestionFlow();
    }

    // Update URL with current question ID (replaceState — no history entry per question)
    if (window.PracticeRouter && this.currentId) {
      window.PracticeRouter.replaceRoute('asq', this.currentId);
    }
  }

  // ---------------------------------------------------------------------------
  // PTE Speaking Shell v3 integration
  // ---------------------------------------------------------------------------

  isV3() {
    return !!(this.v3Active || window.PteShellConfig?.isModeEnabled?.('asq', 'pte'));
  }

  getPtePhase() {
    return this.v3Phase;
  }

  stopAllV3Timers() {
    if (this.v3Timer) {
      cancelAnimationFrame(this.v3Timer);
      clearTimeout(this.v3Timer);
      clearInterval(this.v3Timer);
      this.v3Timer = null;
    }
    if (this.v3RecordRAF) {
      cancelAnimationFrame(this.v3RecordRAF);
      this.v3RecordRAF = null;
    }
  }

  ensureV3Elements() {
    const area = document.getElementById('asq-practice-area');
    if (!area) return;

    if (!document.getElementById('asq-pte-instruction')) {
      const instr = document.createElement('div');
      instr.id = 'asq-pte-instruction';
      instr.className = 'asq-pte-instruction pte-instr';
      instr.textContent = 'You will hear a question. Please give a simple and short answer. Often just one or a few words is enough.';
      area.insertBefore(instr, area.firstChild);
    }

    let stage = document.getElementById('asq-pte-stage');
    if (!stage) {
      stage = document.createElement('div');
      stage.id = 'asq-pte-stage';
      stage.className = 'asq-pte-stage';

      const audioHost = document.createElement('div');
      audioHost.id = 'asq-pte-audio-host';

      const recHost = document.createElement('div');
      recHost.id = 'asq-pte-rec-host';

      stage.append(audioHost, recHost);
      area.appendChild(stage);
    }

    let feedback = document.getElementById('asq-pte-feedback');
    if (!feedback) {
      feedback = document.createElement('div');
      feedback.id = 'asq-pte-feedback';
      feedback.className = 'asq-pte-feedback';
      feedback.hidden = true;
      area.appendChild(feedback);
    }

    const audioHost = document.getElementById('asq-pte-audio-host');
    if (audioHost && !this.pteAudioBox && this.els.promptAudio && window.PteAudioBox) {
      this.pteAudioBox = window.PteAudioBox.create(audioHost, { audio: this.els.promptAudio });
    }

    const recHost = document.getElementById('asq-pte-rec-host');
    if (recHost && !this.pteRecorderWidget && window.PteRecorderWidget) {
      this.pteRecorderWidget = window.PteRecorderWidget.create(recHost, { totalSeconds: 10 });
    }

    ['asq-record-btn', 'asq-cancel-btn', 'asq-stop-btn', 'asq-retry-btn', 'asq-play-btn', 'asq-submit-btn', 'asq-redo-btn'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.style.display = '';
    });
  }

  mountPteShell() {
    this.v3Active = true;
    const modePanel = document.getElementById('mode-asq');
    if (modePanel) modePanel.classList.add('asq-pte-v3');
    this.ensureV3Elements();
    if (this.currentId) {
      queueMicrotask(() => {
        if (this.v3Active && this.currentId) {
          this.startV3QuestionFlow();
        }
      });
    }
    this.syncPteV3UI();
  }

  unmountPteShell() {
    this.v3Active = false;
    const modePanel = document.getElementById('mode-asq');
    if (modePanel) modePanel.classList.remove('asq-pte-v3');
    this.stopAllV3Timers();
    if (this.pteAudioBox) {
      this.pteAudioBox.destroy();
      this.pteAudioBox = null;
    }
    if (this.pteRecorderWidget) {
      this.pteRecorderWidget.destroy();
      this.pteRecorderWidget = null;
    }
    document.getElementById('asq-pte-instruction')?.remove();
    document.getElementById('asq-pte-stage')?.remove();
    document.getElementById('asq-pte-feedback')?.remove();
    this.resetV3State();
  }

  syncPteShell() {
    if (!this.v3Active) return;
    window.SpeakingPracticeController?.setPhase?.('asq', this.v3Phase);
    this.syncPteV3UI();
  }

  syncPteV3UI() {
    if (!this.isV3()) return;
    const stage = document.getElementById('asq-pte-stage');
    const feedback = document.getElementById('asq-pte-feedback');
    const practiceArea = document.getElementById('asq-practice-area');
    if (practiceArea) practiceArea.style.display = 'block';

    if (this.v3Phase === 'feedback') {
      if (stage) { stage.hidden = true; stage.style.display = 'none'; }
      if (feedback) { feedback.hidden = false; feedback.style.display = 'flex'; }
      this.renderV3Feedback();
    } else {
      if (stage) { stage.hidden = false; stage.style.display = 'flex'; }
      if (feedback) { feedback.hidden = true; feedback.style.display = 'none'; }
    }
  }

  async startV3QuestionFlow() {
    if (!this.v3Active || !this.currentId) return;
    this.stopAllV3Timers();
    this.stopSpeechRecognition();
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      try { this.mediaRecorder.stop(); } catch (_) {}
    }
    this.mediaRecorder = null;
    this.stopMediaStream();
    this.isRecording = false;

    if (this.v3AudioElement) {
      try { this.v3AudioElement.pause(); } catch (_) {}
    }

    const qGen = ++this.questionGen;
    const aGen = ++this.attemptGen;
    this.v3Phase = 'listen';
    this.syncPteShell();

    const recHost = document.getElementById('asq-pte-rec-host');
    if (recHost) recHost.style.display = 'none';
    this.pteRecorderWidget?.reset?.();

    this.ensureV3Elements();
    this.pteAudioBox?.reset?.();

    const scale = Number(window.__PTE_TEST_TIME_SCALE) || 1;
    const cdSec = scale < 1 ? 1 : 3;

    try {
      if (this.pteAudioBox) {
        await this.pteAudioBox.countdown(cdSec);
      }
    } catch (err) {
      if (err?.name === 'AbortError' || qGen !== this.questionGen || aGen !== this.attemptGen) return;
    }
    if (qGen !== this.questionGen || aGen !== this.attemptGen || !this.v3Active) {
      return;
    }

    try {
      if (this.pteAudioBox) {
        await this.pteAudioBox.play();
      }
    } catch (err) {
      if (err?.name === 'AbortError' || qGen !== this.questionGen || aGen !== this.attemptGen) return;
      console.warn('[ASQ v3] Prompt audio play blocked or error:', err);
    }
    if (qGen !== this.questionGen || aGen !== this.attemptGen || !this.v3Active) {
      return;
    }

    this.startV3Prep();
  }

  startV3Prep() {
    if (!this.v3Active || !this.currentId) return;
    this.stopAllV3Timers();
    if (this.v3AudioElement) {
      try { this.v3AudioElement.pause(); } catch (_) {}
    }
    const qGen = this.questionGen;
    const aGen = ++this.attemptGen;
    this.v3Phase = 'prep';
    this.syncPteShell();

    const recHost = document.getElementById('asq-pte-rec-host');
    if (recHost) recHost.style.display = '';

    const scale = Number(window.__PTE_TEST_TIME_SCALE) || 1;
    const effectiveScale = scale < 1 ? 1 : scale;
    this.v3PrepStartTime = performance.now();
    this.pteRecorderWidget?.showCountdown(1);

    const tickPrep = () => {
      if (qGen !== this.questionGen || aGen !== this.attemptGen || this.v3Phase !== 'prep' || !this.v3Active) return;
      const elapsed = ((performance.now() - this.v3PrepStartTime) / 1000) / effectiveScale;
      const remaining = Math.max(0, 1 - elapsed);
      this.pteRecorderWidget?.tick(remaining);
      if (elapsed >= 1) {
        this.startV3Recording();
        return;
      }
      this.v3Timer = requestAnimationFrame(tickPrep);
    };
    this.v3Timer = requestAnimationFrame(tickPrep);
  }

  replayQuestion() {
    if (!this.v3Active || !this.pteAudioBox) return;
    if (this.v3AudioElement) {
      try { this.v3AudioElement.pause(); } catch (_) {}
    }
    this.pausePromptAudio();
    this.pteAudioBox.replay().catch(() => {});
  }

  async startV3Recording() {
    if (this.isRecording) return;
    this.stopAllV3Timers();
    if (this.v3AudioElement) {
      try { this.v3AudioElement.pause(); } catch (_) {}
    }
    this.pausePromptAudio();

    const qGen = this.questionGen;
    const aGen = ++this.attemptGen;
    this.v3Phase = 'recording';
    this.syncPteShell();

    const recHost = document.getElementById('asq-pte-rec-host');
    if (recHost) recHost.style.display = '';

    const support = this.getRecordingSupportState();
    if (!support.supported) {
      console.warn('[ASQ v3] Recording not supported');
      return;
    }

    this.isRecording = true;
    this.v3RecordedDurationSec = 0;
    this.v3RecordingBlob = null;
    this.v3DspPromise = null;
    this.v3TranscriptText = '';

    try {
      this.startSpeechRecognition();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (qGen !== this.questionGen || aGen !== this.attemptGen || this.v3Phase !== 'recording' || !this.v3Active) {
        this.stopTracks(stream);
        return;
      }
      this.audioStream = stream;
      this.pteRecorderWidget?.showRecording(10);
      this.pteRecorderWidget?.attachStream(stream);

      const chunks = [];
      const recorder = new window.MediaRecorder(stream);
      this.mediaRecorder = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunks.push(event.data);
      };
      recorder.onstop = async () => {
        this.stopTracks(stream);
        if (this.mediaRecorder === recorder) this.mediaRecorder = null;
        if (qGen !== this.questionGen || aGen !== this.attemptGen) return;
        if (chunks.length > 0) {
          const rawBlob = new Blob(chunks, { type: recorder.mimeType || 'audio/wav' });
          this.v3RecordingBlob = rawBlob;
          this.v3DspPromise = (window.AudioDspPipeline && typeof window.AudioDspPipeline.enhance === 'function')
            ? window.AudioDspPipeline.enhance(rawBlob).then(res => res?.wavBlob || rawBlob).catch(() => rawBlob)
            : Promise.resolve(rawBlob);
        }
      };
      recorder.start();

      this.v3RecordStartTime = performance.now();
      const scale = Number(window.__PTE_TEST_TIME_SCALE) || 1;
      const effectiveRecScale = scale < 1 ? 0.3 : scale;
      const tickRec = () => {
        if (qGen !== this.questionGen || aGen !== this.attemptGen || this.v3Phase !== 'recording' || !this.v3Active) return;
        const elapsed = ((performance.now() - this.v3RecordStartTime) / 1000) / effectiveRecScale;
        this.v3RecordedDurationSec = elapsed;
        this.pteRecorderWidget?.setElapsed(elapsed);
        if (elapsed >= 10) {
          this.stopV3Recording();
          return;
        }
        this.v3RecordRAF = requestAnimationFrame(tickRec);
      };
      this.v3RecordRAF = requestAnimationFrame(tickRec);
    } catch (err) {
      console.error('[ASQ v3] Microphone error:', err);
      this.stopMediaStream();
      this.mediaRecorder = null;
      this.stopSpeechRecognition();
      this.isRecording = false;
    }
  }

  stopV3Recording() {
    if (!this.isRecording && this.v3Phase !== 'recording') return;
    this.isRecording = false;
    this.stopAllV3Timers();
    this.stopSpeechRecognition();
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      try { this.mediaRecorder.stop(); } catch (_) {}
    }
    this.v3Phase = 'complete';
    this.syncPteShell();
    this.pteRecorderWidget?.showComplete();
  }

  cancelRecording() {
    if (this.v3Phase !== 'recording') return;
    this.isRecording = false;
    this.stopAllV3Timers();
    this.stopSpeechRecognition();
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      try { this.mediaRecorder.stop(); } catch (_) {}
    }
    this.stopMediaStream();
    this.mediaRecorder = null;
    this.v3RecordingBlob = null;
    this.v3DspPromise = null;
    this.startV3Prep();
  }

  retryRecording() {
    this.startV3Prep();
  }

  toggleUserAudioPlayback() {
    if (!this.v3RecordingBlob && !this.recordedBlobUrl) return;
    this.pausePromptAudio();
    if (!this.v3AudioElement) {
      this.v3AudioElement = new Audio();
      this.v3AudioElement.addEventListener('ended', () => {
        const playBtn = document.getElementById('asq-play-btn');
        if (playBtn) playBtn.textContent = 'Play';
      });
    }
    const url = this.recordedBlobUrl || (this.v3RecordingBlob ? URL.createObjectURL(this.v3RecordingBlob) : null);
    if (!url) return;
    if (this.v3AudioElement.src !== url) {
      this.v3AudioElement.src = url;
    }
    const playBtn = document.getElementById('asq-play-btn');
    if (this.v3AudioElement.paused) {
      this.v3AudioElement.play().then(() => {
        if (playBtn) playBtn.textContent = 'Pause';
      }).catch(() => {});
    } else {
      this.v3AudioElement.pause();
      if (playBtn) playBtn.textContent = 'Play';
    }
  }

  async submitForFeedback() {
    if (this.v3Phase !== 'complete') return;
    const qGen = this.questionGen;
    const aGen = this.attemptGen;

    this.v3Phase = 'feedback';
    this.syncPteShell();

    let transcript = '';
    try {
      transcript = await this.waitForTranscript({ timeoutMs: 5000 });
    } catch (_) {}
    if (qGen !== this.questionGen || aGen !== this.attemptGen || !this.v3Active) return;
    this.v3TranscriptText = transcript;

    const item = this.getCurrentItem();
    const localCheck = this.isTranscriptCorrect(transcript, item?.acceptedAnswers || []);

    let xpEarned = null;
    let scoringResult = null;
    try {
      scoringResult = await window.handleDualTrackScoring?.('asq', item?.id, transcript);
    } catch (_) {}
    if (qGen !== this.questionGen || aGen !== this.attemptGen || !this.v3Active) return;
    if (scoringResult && scoringResult.success) {
      xpEarned = scoringResult.xpEarned;
    }

    const canonicalIsCorrect = scoringResult && scoringResult.success
      ? Number(scoringResult.accuracy) >= 0.999
      : null;
    const isCorrect = canonicalIsCorrect === null ? localCheck.ok : canonicalIsCorrect;

    const finalBlob = this.v3DspPromise ? await this.v3DspPromise.catch(() => this.v3RecordingBlob) : this.v3RecordingBlob;
    if (qGen !== this.questionGen || aGen !== this.attemptGen || !this.v3Active) return;

    this.v3LastResult = {
      isCorrect,
      transcript,
      acceptedAnswers: item?.acceptedAnswers || [],
      answerDisplay: item?.answerDisplay || (item?.acceptedAnswers || []).join(', '),
      xpEarned: xpEarned != null ? xpEarned : (isCorrect ? 5 : 0),
      questionText: item?.promptText || item?.question || item?.prompt || ''
    };

    try {
      await window.PTEAttemptArchive?.saveAttempt?.({
        practiceMode: 'asq',
        promptSnapshot: {
          promptId: item?.id || null,
          text: item?.promptText || item?.question || item?.prompt || '',
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
          xpEarned: this.v3LastResult.xpEarned,
          scoringResult
        },
        scoringSource: scoringResult?.success ? 'dual-track' : 'client',
        media: finalBlob ? [{
          slot: 'student',
          label: 'Student answer',
          blob: finalBlob,
          contentType: finalBlob.type || 'audio/wav'
        }] : []
      });
    } catch (archiveError) {
      console.warn('[PTE Archive] ASQ save failed:', archiveError);
    }

    this.renderV3Feedback();
  }

  renderV3Feedback() {
    const feedbackEl = document.getElementById('asq-pte-feedback');
    if (!feedbackEl) return;
    const item = this.getCurrentItem();
    const result = this.v3LastResult || {
      isCorrect: false,
      transcript: '',
      acceptedAnswers: item?.acceptedAnswers || [],
      answerDisplay: item?.answerDisplay || (item?.acceptedAnswers || []).join(', '),
      xpEarned: 0,
      questionText: item?.promptText || item?.question || item?.prompt || ''
    };

    const questionAudioSrc = this.getAudioSrcForId(this.currentId) || '';
    const userAudioUrl = this.recordedBlobUrl || (this.v3RecordingBlob ? URL.createObjectURL(this.v3RecordingBlob) : '');

    feedbackEl.innerHTML = `
      <div class="pte-tabs" role="tablist" aria-label="Feedback">
        <button type="button" class="pte-tab is-active" role="tab" aria-selected="true">Your answer</button>
      </div>
      <div class="pte-fb asq-fb-grid">
        <div class="pte-fb__left asq-fb-left">
          <h4 class="asq-fb-heading">The question</h4>
          <p class="asq-fb-question-text"><b>${result.questionText || ''}</b></p>
          <div class="pte-listen">
            <div role="group" aria-label="Listen back">
              <button type="button" id="asq-listen-question" class="pte-btn ${this.v3SelectedListenSource === 'question' ? 'pte-btn--primary' : ''}" aria-pressed="${this.v3SelectedListenSource === 'question'}">Question</button>
              <button type="button" id="asq-listen-yours" class="pte-btn ${this.v3SelectedListenSource === 'yours' ? 'pte-btn--primary' : ''}" aria-pressed="${this.v3SelectedListenSource === 'yours'}">Your recording</button>
            </div>
            <audio id="asq-fb-playback" controls aria-label="Listen back" src="${this.v3SelectedListenSource === 'question' ? questionAudioSrc : userAudioUrl}"></audio>
          </div>
        </div>
        <div class="pte-fb__right asq-fb-right">
          <div class="asq-fb-verdict ${result.isCorrect ? 'correct' : 'incorrect'}">
            <b>${result.isCorrect ? 'Correct' : 'Incorrect'}</b>
            ${result.isCorrect && result.xpEarned ? `<span class="asq-xp">+${result.xpEarned} XP</span>` : ''}
          </div>
          <p class="asq-fb-you-said">You said: <em>“${result.transcript || 'Nothing detected'}”</em></p>
          <p class="asq-fb-accepted">Accepted answers: <b>${result.answerDisplay || (result.acceptedAnswers || []).join(', ')}</b></p>
        </div>
      </div>
    `;

    const playback = feedbackEl.querySelector('#asq-fb-playback');
    const questionBtn = feedbackEl.querySelector('#asq-listen-question');
    const yoursBtn = feedbackEl.querySelector('#asq-listen-yours');

    if (questionBtn && playback) {
      questionBtn.addEventListener('click', () => {
        this.v3SelectedListenSource = 'question';
        questionBtn.classList.add('pte-btn--primary');
        questionBtn.setAttribute('aria-pressed', 'true');
        yoursBtn?.classList.remove('pte-btn--primary');
        yoursBtn?.setAttribute('aria-pressed', 'false');
        playback.pause();
        playback.src = questionAudioSrc;
        playback.load();
      });
    }

    if (yoursBtn && playback) {
      yoursBtn.addEventListener('click', () => {
        this.v3SelectedListenSource = 'yours';
        yoursBtn.classList.add('pte-btn--primary');
        yoursBtn.setAttribute('aria-pressed', 'true');
        questionBtn?.classList.remove('pte-btn--primary');
        questionBtn?.setAttribute('aria-pressed', 'false');
        playback.pause();
        playback.src = userAudioUrl;
        playback.load();
      });
    }
  }

  async finishRecordingForNext() {
    this.stopAllV3Timers();
    const qGen = this.questionGen;
    const aGen = ++this.attemptGen;
    this.isRecording = false;
    this.stopSpeechRecognition();
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      try { this.mediaRecorder.stop(); } catch (_) {}
    }
    this.mediaRecorder = null;
    const finalBlob = this.v3DspPromise ? await this.v3DspPromise.catch(() => this.v3RecordingBlob) : this.v3RecordingBlob;
    if (qGen !== this.questionGen || aGen !== this.attemptGen) return;
    const item = this.getCurrentItem();
    if (item) {
      try {
        await window.PTEAttemptArchive?.saveAttempt?.({
          practiceMode: 'asq',
          promptSnapshot: {
            promptId: item?.id || null,
            text: item?.promptText || item?.question || item?.prompt || '',
            data: item || null
          },
          responseSnapshot: { transcript: this.v3TranscriptText || '' },
          answerSnapshot: {
            acceptedAnswers: item?.acceptedAnswers || [],
            answerDisplay: item?.answerDisplay || ''
          },
          resultSnapshot: { submitted: true, score: null },
          scoringSource: 'client',
          media: finalBlob ? [{
            slot: 'student',
            label: 'Student answer',
            blob: finalBlob,
            contentType: finalBlob.type || 'audio/wav'
          }] : []
        });
      } catch (_) {}
    }
    this.advanceQuestion();
  }

  advanceQuestion() {
    if (!this.database || this.database.length === 0) return;
    const currentIndex = this.database.findIndex(i => String(i.id) === String(this.currentId));
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % this.database.length : 0;
    const nextItem = this.database[nextIndex];
    if (nextItem) {
      this.setQuestionById(nextItem.id);
    }
  }

  resetV3State() {
    this.stopAllV3Timers();
    this.isRecording = false;
    this.v3Phase = 'loading';
    this.v3LastResult = null;
    this.v3RecordingBlob = null;
    this.v3DspPromise = null;
    this.v3TranscriptText = '';
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async onEnter() {
    this.isActive = true;
    if (!this.isInitialized) {
      await this.init();
    }
    if (this.isV3()) {
      if (this.currentId && this.v3Active) {
        this.startV3QuestionFlow();
      }
    } else {
      this.setStatus('Play the prompt audio, then record your answer.', 'muted');
    }
    if (window.PracticeRouter && this.currentId) {
      window.PracticeRouter.replaceRoute('asq', this.currentId);
    }
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
    if (this.isV3()) {
      this.stopAllV3Timers();
      if (this.v3AudioElement) {
        try { this.v3AudioElement.pause(); } catch (_) {}
      }
    }
  }

  async init() {
    this.isInitialized = true;

    // Cache all DOM refs once
    this.els = {
      playBtn: document.getElementById('asq-play-prompt-btn'),
      select: document.getElementById('asq-question-select'),
      recordBtn: document.getElementById('asq-record-btn'),
      cancelBtn: document.getElementById('asq-cancel-btn'),
      stopBtn: document.getElementById('asq-stop-btn'),
      retryBtn: document.getElementById('asq-retry-btn'),
      playUserBtn: document.getElementById('asq-play-btn'),
      submitBtn: document.getElementById('asq-submit-btn'),
      redoBtn: document.getElementById('asq-redo-btn'),
      promptAudio: document.getElementById('asq-prompt-audio'),
      playIcon: document.getElementById('asq-play-icon'),
      playLabel: document.getElementById('asq-play-label'),
      seek: document.getElementById('asq-seek'),
      volume: document.getElementById('asq-volume'),
      questionText: document.getElementById('asq-question-text'),
      statusMessage: document.getElementById('asq-status-message'),
      userAudioBox: document.getElementById('asq-user-audio-box'),
      userRecordingAudio: document.getElementById('asq-user-recording-audio'),
      resultBox: document.getElementById('asq-result-box'),
      resultStatus: document.getElementById('asq-result-status'),
      transcriptFeedback: document.getElementById('asq-transcript-feedback'),
      correctAnswers: document.getElementById('asq-correct-answers')
    };

    const { playBtn, select, recordBtn, cancelBtn, stopBtn, retryBtn, playUserBtn, submitBtn, redoBtn, promptAudio } = this.els;

    if (playBtn) playBtn.addEventListener('click', () => this.playPrompt());
    if (recordBtn) recordBtn.addEventListener('click', () => {
      if (this.isV3()) this.startV3Recording();
      else this.startRecording();
    });
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.cancelRecording());
    if (stopBtn) stopBtn.addEventListener('click', () => {
      if (this.isV3()) this.stopV3Recording();
      else this.stopRecording();
    });
    if (retryBtn) retryBtn.addEventListener('click', () => this.retryRecording());
    if (playUserBtn) playUserBtn.addEventListener('click', () => this.toggleUserAudioPlayback());
    if (submitBtn) submitBtn.addEventListener('click', () => this.submitForFeedback());
    if (redoBtn) redoBtn.addEventListener('click', () => {
      if (this.isV3()) this.retryRecording();
      else this.redoQuestion();
    });

    // Progress track, timestamp and volume come from the shared component. The mode
    // keeps ownership of the Play click so it can report a missing clip, so the
    // component is attached with bindPlayButton disabled.
    this.audioPlayer = window.PracticeAudioPlayer?.attach({
      prefix: 'asq',
      audio: promptAudio,
      playButtonId: 'asq-play-prompt-btn',
      bindPlayButton: false
    }) || null;

    // Fix: assign onended once to avoid listener accumulation
    if (promptAudio) {
      promptAudio.addEventListener('ended', () => {
        this.setPlayButtonLabel('Play');
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
