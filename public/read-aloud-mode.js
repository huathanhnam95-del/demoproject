class ReadAloudMode {
  constructor() {
    this.isActive = false;
    this.currentText = '';
    this.prepSeconds = 0;
    this.recordSeconds = 0;
    this.state = 'IDLE'; // IDLE, PREP, RECORDING, RESULTS
    this.timerInterval = null;
    this.database = [];
    this.currentTranscript = '';
    this.hasLoadedDatabase = false;
    this.supportMessage = 'Speech recognition is not supported in this browser. Read Aloud works best in a recent Chrome-based browser.';

    // ElevenLabs audio state
    this.audioManifest = null;
    this.currentQuestionId = null;
    this.selectedGender = 'male';  // 'male' or 'female'
    this.selectedSpeed = '100';    // '100' or '80'
    this.hasLoadedManifest = false;
    
    // Check for STT support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.speechRecognition = SpeechRecognition ? new SpeechRecognition() : null;
    if (this.speechRecognition) {
      this.speechRecognition.continuous = true;
      this.speechRecognition.interimResults = true;
      this.speechRecognition.lang = 'en-US';
      
      this.speechRecognition.onresult = (event) => {
        let finalTranscript = '';
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        this.currentTranscript += finalTranscript;
        
        // Show real-time feedback
        const statusMsg = document.getElementById('ra-status-message');
        if (statusMsg && (finalTranscript || interimTranscript)) {
          statusMsg.textContent = 'Hearing: ' + (finalTranscript || interimTranscript);
        }
      };

      this.speechRecognition.onerror = (event) => {
        // Handle STT errors
        const statusMsg = document.getElementById('ra-status-message');
        if (statusMsg) statusMsg.textContent = 'Microphone Error. Please try again.';
      };
    }

    this.bindEvents();
  }

  async loadDatabase() {
    try {
      const response = await fetch('database/RA/RA.xlsx');
      if (!response.ok) throw new Error('Failed to fetch RA.xlsx');
      const arrayBuffer = await response.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]]; // Or the active sheet
      const rawData = XLSX.utils.sheet_to_json(worksheet);
      
      // Filter valid entries
      this.database = rawData.filter(row => row['ANSWER'] || row['ANSWER FOR COMPARE OR TRANSCRIPT']);
      this.hasLoadedDatabase = true;
    } catch (e) {
      const uiNode = document.getElementById('ra-text-prompt');
      if (uiNode) uiNode.textContent = 'Error loading prompts.';
      this.hasLoadedDatabase = false;
    }
  }

  bindEvents() {
    // Buttons will be wired up here
    document.getElementById('ra-next-btn')?.addEventListener('click', () => this.loadNextPrompt());
    document.getElementById('ra-record-btn')?.addEventListener('click', () => this.handleRecordClick());

    // Audio player controls
    document.getElementById('ra-voice-male')?.addEventListener('click', () => this.setGender('male'));
    document.getElementById('ra-voice-female')?.addEventListener('click', () => this.setGender('female'));
    document.getElementById('ra-speed-100')?.addEventListener('click', () => this.setSpeed('100'));
    document.getElementById('ra-speed-80')?.addEventListener('click', () => this.setSpeed('80'));
    document.getElementById('ra-play-audio-btn')?.addEventListener('click', () => this.playAudio());
    
    // Add event listener to know when the mode is activated
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          const panel = document.getElementById('mode-read-aloud');
          if (panel && panel.classList.contains('active')) {
            if (!this.isActive) this.onEnter();
          } else {
            if (this.isActive) this.onExit();
          }
        }
      });
    });
    
    const panel = document.getElementById('mode-read-aloud');
    if (panel) observer.observe(panel, { attributes: true });
  }

  async onEnter() {
    this.isActive = true;
    await this.loadManifest();
    this.loadNextPrompt();
  }

  onExit() {
    this.isActive = false;
    this.cleanup();
  }

  cleanup() {
    this.stopTimer();
    if (this.state === 'RECORDING' && this.speechRecognition) {
      this.speechRecognition.stop();
    }
    this.state = 'IDLE';
  }

  isSupported() {
    return !!this.speechRecognition;
  }

  applyUnsupportedState() {
    const statusMsg = document.getElementById('ra-status-message');
    const recordBtn = document.getElementById('ra-record-btn');
    const prepTimerBox = document.getElementById('ra-prep-timer-box');
    const recordTimerBox = document.getElementById('ra-record-timer-box');

    if (statusMsg) statusMsg.textContent = this.supportMessage;
    if (recordBtn) {
      recordBtn.textContent = 'Unsupported Browser';
      recordBtn.disabled = true;
    }
    if (prepTimerBox) prepTimerBox.style.opacity = '0.4';
    if (recordTimerBox) recordTimerBox.style.opacity = '0.4';
  }

  async loadNextPrompt() {
    this.cleanup();
    this.state = 'PREP';
    this.currentTranscript = '';
    const textNode = document.getElementById('ra-text-prompt');
    const resultBox = document.getElementById('ra-result-box');
    if (resultBox) resultBox.style.display = 'none';

    if (textNode) textNode.textContent = 'Loading...';

    if (!this.hasLoadedDatabase) {
      await this.loadDatabase();
    }
    
    if (!this.database || this.database.length === 0) {
      if (textNode) textNode.textContent = 'Database empty or failed to load.';
      return;
    }

    // Select random prompt - Prioritize audio items
    let randomRow;
    if (this.audioManifest && Object.keys(this.audioManifest).length > 0 && (!this.firstLoadDone || Math.random() < 0.2)) {
      const audioIds = Object.keys(this.audioManifest);
      const randomId = audioIds[Math.floor(Math.random() * audioIds.length)];
      randomRow = this.database.find(r => String(r['ID']) === randomId) || this.database[Math.floor(Math.random() * this.database.length)];
      this.firstLoadDone = true;
    } else {
      randomRow = this.database[Math.floor(Math.random() * this.database.length)];
      this.firstLoadDone = true;
    }
    const prompt = randomRow['ANSWER FOR COMPARE OR TRANSCRIPT'] || randomRow['ANSWER'] || 'No text available';
    this.currentQuestionId = randomRow['ID'] != null ? String(randomRow['ID']) : null;
    
    // Parse length logic
    const inputWordCount = parseInt(randomRow['Word count']);
    const actualWordCount = isNaN(inputWordCount) ? prompt.split(/\s+/).length : inputWordCount;
    
    this.prepSeconds = actualWordCount >= 60 ? 40 : Math.max(30, Math.min(35, Math.round(actualWordCount / 1.5)));
    this.recordSeconds = this.prepSeconds;
    
    if (textNode) textNode.textContent = prompt;
    this.currentText = prompt;
    
    // Show audio player if manifest has this question
    this.updateAudioPlayerVisibility();
    
    this.updateUIForState();
    if (this.isSupported()) {
      this.startPrepTimer();
    } else {
      this.applyUnsupportedState();
    }
  }

  updateUIForState() {
    const prepTimerBox = document.getElementById('ra-prep-timer-box');
    const recordTimerBox = document.getElementById('ra-record-timer-box');
    const recordBtn = document.getElementById('ra-record-btn');
    const statusMsg = document.getElementById('ra-status-message');
    const resultBox = document.getElementById('ra-result-box');

    if (this.state === 'PREP') {
      prepTimerBox.style.opacity = '1';
      recordTimerBox.style.opacity = '0.4';
      recordBtn.textContent = 'Skip Prep';
      recordBtn.disabled = false;
      statusMsg.textContent = 'Read the text silently to prepare.';
      resultBox.style.display = 'none';
      this.updateTimerDisplay('ra-prep-time', this.prepSeconds);
      this.updateTimerDisplay('ra-record-time', this.recordSeconds);
    } else if (this.state === 'RECORDING') {
      prepTimerBox.style.opacity = '0.4';
      recordTimerBox.style.opacity = '1';
      recordBtn.textContent = 'Finish Recording';
      recordBtn.disabled = false;
      statusMsg.textContent = 'Recording... Please read aloud.';
    } else if (this.state === 'RESULTS') {
      prepTimerBox.style.opacity = '0.4';
      recordTimerBox.style.opacity = '0.4';
      recordBtn.textContent = 'Next Prompt';
      recordBtn.disabled = false;
      statusMsg.textContent = 'Processing...';
      resultBox.style.display = 'block';
    }
  }

  startPrepTimer() {
    this.stopTimer();
    let timeLeft = this.prepSeconds;
    this.updateTimerDisplay('ra-prep-time', timeLeft);
    
    this.timerInterval = setInterval(() => {
      timeLeft--;
      if (timeLeft < 0) {
        this.stopTimer();
        this.startRecording();
      } else {
        this.updateTimerDisplay('ra-prep-time', timeLeft);
      }
    }, 1000);
  }

  startRecording() {
    this.cleanup();
    this.state = 'RECORDING';
    this.currentTranscript = '';
    this.updateUIForState();
    
    let timeLeft = this.recordSeconds;
    this.updateTimerDisplay('ra-record-time', timeLeft);
    
    this.timerInterval = setInterval(() => {
      timeLeft--;
      if (timeLeft < 0) {
        this.stopTimer();
        this.handleRecordClick(); // finish recording
      } else {
        this.updateTimerDisplay('ra-record-time', timeLeft);
      }
    }, 1000);

    // Call STT here
    if (this.speechRecognition) {
      try {
        this.speechRecognition.start();
      } catch (e) {
        // Handle STT start error
      }
    }
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  updateTimerDisplay(elementId, seconds) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    el.textContent = `${m}:${s}`;
  }

  handleRecordClick() {
    if (this.state === 'PREP') {
      if (!this.isSupported()) {
        this.applyUnsupportedState();
        return;
      }
      // Skip prep manually
      this.startRecording();
    } else if (this.state === 'RECORDING') {
      // Finish recording early
      this.cleanup();
      this.state = 'RESULTS';
      this.updateUIForState();
      this.processResults();
    } else if (this.state === 'RESULTS') {
      this.loadNextPrompt();
    }
  }

  processResults() {
    const statusMsg = document.getElementById('ra-status-message');
    statusMsg.textContent = 'Analysis complete.';
    
    const accuracyElement = document.getElementById('ra-accuracy-value');
    const feedbackElement = document.getElementById('ra-transcript-feedback');
    
    let accuracy = 0;
    if (this.currentTranscript && this.currentTranscript.trim().length > 0) {
        accuracy = this.calculateWER(this.currentText, this.currentTranscript);
    } else {
        accuracy = 0;
    }
    
    if (accuracyElement) accuracyElement.textContent = accuracy.toString();
    if (feedbackElement) feedbackElement.innerHTML = `You said: <i>"${this.currentTranscript || 'Nothing detected'}"</i>`;
  }

  calculateWER(reference, hypothesis) {
    const refWords = reference.toLowerCase().replace(/[^\w\s']/g, '').split(/\s+/).filter(Boolean);
    const hypWords = hypothesis.toLowerCase().replace(/[^\w\s']/g, '').split(/\s+/).filter(Boolean);
    
    if (refWords.length === 0) return 100;
    if (hypWords.length === 0) return 0;

    const d = Array(refWords.length + 1).fill(null).map(() => Array(hypWords.length + 1).fill(null));
    for (let i = 0; i <= refWords.length; i += 1) d[i][0] = i;
    for (let j = 0; j <= hypWords.length; j += 1) d[0][j] = j;

    for (let i = 1; i <= refWords.length; i += 1) {
      for (let j = 1; j <= hypWords.length; j += 1) {
        const cost = refWords[i - 1] === hypWords[j - 1] ? 0 : 1;
        d[i][j] = Math.min(
          d[i - 1][j] + 1,     // deletion
          d[i][j - 1] + 1,     // insertion
          d[i - 1][j - 1] + cost // substitution
        );
      }
    }
    const distance = d[refWords.length][hypWords.length];
    const wer = distance / refWords.length;
    return Math.max(0, Math.min(100, Math.round((1 - wer) * 100)));
  }

  // ── ElevenLabs Audio Player ──────────────────────────────
  async loadManifest() {
    if (this.hasLoadedManifest) return;
    try {
      const res = await fetch('audio/ra/manifest.json');
      if (res.ok) {
        this.audioManifest = await res.json();
      }
    } catch (e) {
      console.warn('RA audio manifest not available:', e.message);
    }
    this.hasLoadedManifest = true;
  }

  updateAudioPlayerVisibility() {
    const player = document.getElementById('ra-audio-player');
    const playBtn = document.getElementById('ra-play-audio-btn');
    if (!player) return;
    
    // Always display block to show the feature exists
    player.style.display = 'block';
    
    if (this.audioManifest && this.currentQuestionId && this.audioManifest[this.currentQuestionId]) {
      if (playBtn) {
        playBtn.disabled = false;
        playBtn.innerHTML = '▶ Play';
        playBtn.style.opacity = '1';
        playBtn.title = 'Listen to reference audio';
      }
      this.updateAudioSrc();
    } else {
      if (playBtn) {
        playBtn.disabled = true;
        playBtn.innerHTML = 'Unavailable';
        playBtn.style.opacity = '0.5';
        playBtn.title = 'Audio not yet generated for this text';
      }
    }
  }

  updateAudioSrc() {
    const audioEl = document.getElementById('ra-elevenlabs-audio');
    if (!audioEl || !this.audioManifest || !this.currentQuestionId) return;
    const entry = this.audioManifest[this.currentQuestionId];
    if (!entry) return;
    const genderEntry = entry[this.selectedGender];
    if (!genderEntry || !genderEntry.files) return;
    const filename = genderEntry.files[this.selectedSpeed];
    if (filename) {
      audioEl.src = 'audio/ra/' + filename;
      audioEl.load();
    }
  }

  setGender(gender) {
    this.selectedGender = gender;
    // Update toggle UI
    const maleBtn = document.getElementById('ra-voice-male');
    const femaleBtn = document.getElementById('ra-voice-female');
    if (gender === 'male') {
      maleBtn.style.background = 'var(--brand-primary)';
      maleBtn.style.color = '#fff';
      maleBtn.style.fontWeight = '600';
      femaleBtn.style.background = 'var(--bg-tertiary, #f0f0f0)';
      femaleBtn.style.color = 'var(--text-primary)';
      femaleBtn.style.fontWeight = '500';
    } else {
      femaleBtn.style.background = 'var(--brand-primary)';
      femaleBtn.style.color = '#fff';
      femaleBtn.style.fontWeight = '600';
      maleBtn.style.background = 'var(--bg-tertiary, #f0f0f0)';
      maleBtn.style.color = 'var(--text-primary)';
      maleBtn.style.fontWeight = '500';
    }
    this.updateAudioSrc();
  }

  setSpeed(speed) {
    this.selectedSpeed = speed;
    // Update toggle UI
    const normalBtn = document.getElementById('ra-speed-100');
    const slowBtn = document.getElementById('ra-speed-80');
    if (speed === '100') {
      normalBtn.style.background = 'var(--brand-primary)';
      normalBtn.style.color = '#fff';
      normalBtn.style.fontWeight = '600';
      slowBtn.style.background = 'var(--bg-tertiary, #f0f0f0)';
      slowBtn.style.color = 'var(--text-primary)';
      slowBtn.style.fontWeight = '500';
    } else {
      slowBtn.style.background = 'var(--brand-primary)';
      slowBtn.style.color = '#fff';
      slowBtn.style.fontWeight = '600';
      normalBtn.style.background = 'var(--bg-tertiary, #f0f0f0)';
      normalBtn.style.color = 'var(--text-primary)';
      normalBtn.style.fontWeight = '500';
    }
    this.updateAudioSrc();
  }

  playAudio() {
    const audioEl = document.getElementById('ra-elevenlabs-audio');
    const playBtn = document.getElementById('ra-play-audio-btn');
    if (!audioEl) return;
    if (audioEl.paused) {
      audioEl.play();
      if (playBtn) playBtn.textContent = '⏸ Pause';
      audioEl.onended = () => {
        if (playBtn) playBtn.textContent = '▶ Play';
      };
    } else {
      audioEl.pause();
      if (playBtn) playBtn.textContent = '▶ Play';
    }
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.ReadAloudMode = new ReadAloudMode();
});
