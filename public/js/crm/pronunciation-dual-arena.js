/**
 * Pronunciation Dual Comparison Arena
 * Option A (Azure Speech + Praat Prosody Fusion) vs. Option B (Repaired Self-Hosted V4 + Praat Native)
 */

(function (window, document) {
  'use strict';

  const PRESET_GROUPS = [
    {
      group: 'Noun/Verb Minimal Pairs (Stress Shift)',
      presets: [
        { word: 'record', ipa: 'ˈrɛk.ɚd', expectedStress: 0, syllables: 2, label: "'record (noun) [ˈrɛk.ɚd]" },
        { word: 'record', ipa: 'rɪˈkɔːrd', expectedStress: 1, syllables: 2, label: "re'cord (verb) [rɪˈkɔːrd]" },
        { word: 'present', ipa: 'ˈprɛz.ənt', expectedStress: 0, syllables: 2, label: "'present (noun) [ˈprɛz.ənt]" },
        { word: 'present', ipa: 'prɪˈzɛnt', expectedStress: 1, syllables: 2, label: "pre'sent (verb) [prɪˈzɛnt]" },
        { word: 'object', ipa: 'ˈɑːb.dʒɛkt', expectedStress: 0, syllables: 2, label: "'object (noun) [ˈɑːb.dʒɛkt]" },
        { word: 'object', ipa: 'əbˈdʒɛkt', expectedStress: 1, syllables: 2, label: "ob'ject (verb) [əbˈdʒɛkt]" },
        { word: 'conduct', ipa: 'ˈkɑːn.dʌkt', expectedStress: 0, syllables: 2, label: "'conduct (noun) [ˈkɑːn.dʌkt]" },
        { word: 'conduct', ipa: 'kənˈdʌkt', expectedStress: 1, syllables: 2, label: "con'duct (verb) [kənˈdʌkt]" },
        { word: 'desert', ipa: 'ˈdɛz.ɚt', expectedStress: 0, syllables: 2, label: "'desert (noun) [ˈdɛz.ɚt]" },
        { word: 'desert', ipa: 'dɪˈzɜːrt', expectedStress: 1, syllables: 2, label: "de'sert (verb) [dɪˈzɜːrt]" }
      ]
    },
    {
      group: 'Multisyllabic Shift Words',
      presets: [
        { word: 'photograph', ipa: 'ˈfoʊ.tə.ɡræf', expectedStress: 0, syllables: 3, label: "'photograph (3 syl) [ˈfoʊ.tə.ɡræf]" },
        { word: 'photography', ipa: 'fəˈtɑː.ɡrə.fi', expectedStress: 1, syllables: 4, label: "pho'tography (4 syl) [fəˈtɑː.ɡrə.fi]" },
        { word: 'photographic', ipa: 'ˌfoʊ.təˈɡræf.ɪk', expectedStress: 2, syllables: 4, label: "photo'graphic (4 syl) [ˌfoʊ.təˈɡræf.ɪk]" },
        { word: 'economy', ipa: 'ɪˈkɑː.nə.mi', expectedStress: 1, syllables: 4, label: "e'conomy (4 syl) [ɪˈkɑː.nə.mi]" },
        { word: 'economic', ipa: 'ˌiː.kəˈnɑː.mɪk', expectedStress: 2, syllables: 4, label: "eco'nomic (4 syl) [ˌiː.kəˈnɑː.mɪk]" },
        { word: 'university', ipa: 'ˌjuː.nɪˈvɜːr.sə.t̬i', expectedStress: 2, syllables: 5, label: "uni'versity (5 syl) [ˌjuː.nɪˈvɜːr.sə.t̬i]" }
      ]
    },
    {
      group: 'Weak Reduction Words (/ə/ Schwa)',
      presets: [
        { word: 'banana', ipa: 'bəˈnæn.ə', expectedStress: 1, syllables: 3, label: "ba'nana [bəˈnæn.ə] (syl 1 & 3 /ə/)" },
        { word: 'camera', ipa: 'ˈkæm.rə', expectedStress: 0, syllables: 2, label: "'camera [ˈkæm.rə] (weak reduction)" },
        { word: 'potato', ipa: 'pəˈteɪ.toʊ', expectedStress: 1, syllables: 3, label: "po'tato [pəˈteɪ.toʊ] (syl 1 /ə/)" },
        { word: 'chocolate', ipa: 'ˈtʃɑːk.lət', expectedStress: 0, syllables: 2, label: "'chocolate [ˈtʃɑːk.lət] (syl 2 reduction)" },
        { word: 'family', ipa: 'ˈfæm.ə.li', expectedStress: 0, syllables: 3, label: "'family [ˈfæm.ə.li] (weak /ə/)" }
      ]
    }
  ];

  const BENCHMARK_STORAGE_KEY = 'pronunciation_dual_arena_benchmarks_v1';

  class PronunciationDualArena {
    constructor(container, options = {}) {
      this.container = typeof container === 'string' ? document.querySelector(container) : container;
      const isHttps = typeof window !== 'undefined' && window.location && window.location.protocol === 'https:';
      const defaultLocalUrl = isHttps ? 'https://localhost:8081' : 'http://localhost:8081';

      this.options = Object.assign({
        defaultBackend: 'local',
        localBackendUrl: defaultLocalUrl,
        cloudBackendUrl: 'https://praat-api-1071929245506.us-central1.run.app'
      }, options);

      this.wavesurfer = null;
      this.isPlayingWaveform = false;
      this.audioCtx = null;
      this.decodedAudioBuffer = null;
      this.currentSliceSource = null;

      this.state = {
        backendType: this.options.defaultBackend,
        backendUrl: this.options.localBackendUrl,
        selectedWord: 'photograph',
        selectedIpa: 'ˈfoʊ.tə.ɡræf',
        expectedStress: 0,
        expectedSyllables: 3,
        audioBlob: null,
        audioUrl: null,
        isRecording: false,
        isAnalyzing: false,
        mediaRecorder: null,
        audioChunks: [],
        recordingTimer: null,
        recordingSeconds: 0,
        optionAResult: null,
        optionBResult: null,
        optionAError: null,
        optionBError: null,
        optionALatency: null,
        optionBLatency: null,
        userJudgment: null,
        judgmentNotes: '',
        benchmarks: this.loadBenchmarks()
      };

      this.elements = {};
      this.render();
      this.bindEvents();
    }

    loadBenchmarks() {
      try {
        const raw = localStorage.getItem(BENCHMARK_STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch (_) {
        return [];
      }
    }

    saveBenchmarks() {
      try {
        localStorage.setItem(BENCHMARK_STORAGE_KEY, JSON.stringify(this.state.benchmarks));
      } catch (_) {
        // Storage full or restricted
      }
    }

    render() {
      if (!this.container) return;

      this.container.innerHTML = `
        <div class="dual-arena-root">
          <!-- Arena Header -->
          <div class="dual-arena-header">
            <div class="dual-arena-title-row">
              <div class="dual-arena-badge">Dual Arena Assessment</div>
              <h2 class="dual-arena-title">Option A vs. Option B Comparison</h2>
              <p class="dual-arena-subtitle">
                Compare <strong>Option A</strong> (Azure Speech + Praat Prosody Fusion) with <strong>Option B</strong> (Repaired Self-Hosted V4 + Praat Native) side-by-side with identical audio.
              </p>
            </div>

            <!-- Top Controls Bar -->
            <div class="dual-arena-controls-bar">
              <!-- Backend Toggle -->
              <div class="dual-arena-control-group">
                <span class="dual-arena-label">Backend Engine:</span>
                <div class="dual-arena-toggle-pills" role="radiogroup" aria-label="Backend environment selector">
                  <button type="button" class="dual-arena-pill ${this.state.backendType === 'local' ? 'is-active' : ''}" data-backend="local" title="Run on local Python server (http://localhost:8081)">
                    <span class="pill-badge">LOCAL</span> Local Server (8081)
                  </button>
                  <button type="button" class="dual-arena-pill ${this.state.backendType === 'cloud' ? 'is-active' : ''}" data-backend="cloud" title="Run on Cloud Run backend">
                    <span class="pill-badge">CLOUD</span> Cloud Run
                  </button>
                </div>
              </div>

              <!-- Presets Selector -->
              <div class="dual-arena-control-group dual-arena-flex-grow">
                <span class="dual-arena-label">Test Preset:</span>
                <select id="dual-arena-preset-select" class="dual-arena-select" aria-label="Select word preset">
                  ${PRESET_GROUPS.map(g => `
                    <optgroup label="${g.group}">
                      ${g.presets.map(p => `
                        <option value="${p.word}" data-ipa="${p.ipa}" data-stress="${p.expectedStress}" data-syllables="${p.syllables || ''}" ${p.word === this.state.selectedWord && p.ipa === this.state.selectedIpa ? 'selected' : ''}>
                          ${p.label}
                        </option>
                      `).join('')}
                    </optgroup>
                  `).join('')}
                </select>
              </div>

              <!-- Custom Word / IPA Inputs -->
              <div class="dual-arena-control-group">
                <span class="dual-arena-label">Word:</span>
                <input type="text" id="dual-arena-word-input" class="dual-arena-input dual-arena-word-input" value="${this.state.selectedWord}" placeholder="e.g. photograph" />
              </div>
              <div class="dual-arena-control-group">
                <span class="dual-arena-label">IPA:</span>
                <input type="text" id="dual-arena-ipa-input" class="dual-arena-input dual-arena-ipa-input" value="${this.state.selectedIpa}" placeholder="/ˈfoʊ.tə.ɡræf/" />
              </div>
            </div>
          </div>

          <!-- Audio Input Console -->
          <div class="dual-arena-audio-console">
            <div class="dual-arena-audio-actions">
              <button type="button" id="dual-arena-btn-record" class="dual-arena-btn dual-arena-btn-record">
                <span class="record-dot"></span> <span id="dual-arena-record-text">Record Voice</span>
              </button>
              <button type="button" id="dual-arena-btn-stop" class="dual-arena-btn dual-arena-btn-stop" style="display: none;">
                <span class="stop-square"></span> Stop (<span id="dual-arena-timer">0s</span>)
              </button>

              <label class="dual-arena-btn dual-arena-btn-file" title="Upload audio file (.wav, .mp3)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
                Upload Audio
                <input type="file" id="dual-arena-file-input" accept="audio/wav, audio/mp3, audio/mpeg, audio/ogg, audio/webm" style="display: none;" />
              </label>

              <div id="dual-arena-audio-preview-wrap" class="dual-arena-audio-preview" style="display: none;">
                <audio id="dual-arena-audio-player" controls preload="auto"></audio>
                <span id="dual-arena-dsp-badge" class="dual-arena-badge-dsp" title="Enhanced via AudioDspPipeline (80Hz rumble removal, 16kHz resample, -3dBFS peak norm)">DSP ENHANCED</span>
              </div>

              <button type="button" id="dual-arena-btn-run" class="dual-arena-btn dual-arena-btn-run" disabled>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Dual Analysis
              </button>
            </div>

            <!-- Acoustic Waveform Visualization Display -->
            <div id="dual-arena-waveform-wrap" class="dual-arena-waveform-container" style="display: none;">
              <div class="waveform-header">
                <div class="waveform-title-wrap">
                  <span class="waveform-icon" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2"><path d="M2 10v4M6 6v12M10 3v18M14 8v8M18 5v14M22 10v4"/></svg></span>
                  <span class="waveform-title">Acoustic Audio Waveform</span>
                  <span id="dual-arena-audio-duration" class="waveform-duration-badge">0.00s</span>
                </div>
                <div class="waveform-controls">
                  <button type="button" id="dual-arena-waveform-play-btn" class="dual-arena-btn-mini" title="Play / Pause Audio">
                    <span id="dual-arena-play-icon" class="play-icon-svg"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></span> <span id="dual-arena-play-text">Play</span>
                  </button>
                </div>
              </div>
              <div id="dual-arena-waveform-view" class="dual-arena-waveform-view">
                <canvas id="dual-arena-waveform-canvas" class="dual-arena-waveform-canvas" height="80"></canvas>
              </div>
            </div>

            <!-- Status banner -->
            <div id="dual-arena-status-banner" class="dual-arena-status-banner" style="display: none;"></div>
          </div>

          <!-- Comparison Grid -->
          <div class="dual-arena-grid">
            <!-- Option A Card -->
            <div class="dual-arena-card dual-arena-card-a" id="dual-arena-card-a">
              <div class="dual-arena-card-header">
                <div class="card-title-wrap">
                  <span class="card-badge badge-option-a">Option A</span>
                  <h3 class="card-title">Azure Speech + Praat Prosody</h3>
                </div>
                <div class="card-status-wrap">
                  <span class="latency-tag" id="option-a-latency">-- ms</span>
                  <span class="status-indicator status-idle" id="option-a-status">Idle</span>
                </div>
              </div>
              <div class="dual-arena-card-body" id="option-a-body">
                <div class="dual-arena-placeholder">
                  <div class="placeholder-icon" aria-hidden="true">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="1.8"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>
                  </div>
                  <p>Option A combines Azure Speech phoneme alignment with targeted Praat F0 pitch and intensity extraction over vowel intervals, checking unstressed /ə/ reductions.</p>
                  <p class="placeholder-hint">Record audio or select a preset and click "Run Dual Analysis" to inspect.</p>
                </div>
              </div>
            </div>

            <!-- Option B Card -->
            <div class="dual-arena-card dual-arena-card-b" id="dual-arena-card-b">
              <div class="dual-arena-card-header">
                <div class="card-title-wrap">
                  <span class="card-badge badge-option-b">Option B</span>
                  <h3 class="card-title">Repaired V4 + Praat Native</h3>
                </div>
                <div class="card-status-wrap">
                  <span class="latency-tag" id="option-b-latency">-- ms</span>
                  <span class="status-indicator status-idle" id="option-b-status">Idle</span>
                </div>
              </div>
              <div class="dual-arena-card-body" id="option-b-body">
                <div class="dual-arena-placeholder">
                  <div class="placeholder-icon" aria-hidden="true">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="1.8"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
                  </div>
                  <p>Option B runs local/self-hosted Praat native syllable segmentation with repaired lexical stress normalization (using vowel duration instead of full syllable duration) and reference-guided V4 syllabification.</p>
                  <p class="placeholder-hint">Record audio or select a preset and click "Run Dual Analysis" to inspect.</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Manual Comparison & Benchmark Panel -->
          <div class="dual-arena-benchmark-panel" id="dual-arena-benchmark-panel" style="display: none;">
            <div class="benchmark-header">
              <div class="benchmark-title-wrap">
                <h3 class="benchmark-title">Human Comparison Judgment</h3>
                <p class="benchmark-subtitle">Rate which engine performed more accurately on this audio sample to contribute to the benchmark dataset.</p>
              </div>
              <div class="benchmark-count-wrap">
                <span class="benchmark-counter" id="benchmark-counter">${this.state.benchmarks.length} Comparisons Saved</span>
                <button type="button" id="dual-arena-btn-export" class="dual-arena-btn dual-arena-btn-export" ${this.state.benchmarks.length === 0 ? 'disabled' : ''}>
                  Export Benchmark (JSON)
                </button>
              </div>
            </div>

            <div class="benchmark-rating-actions">
              <span class="rating-prompt">Select Verdict:</span>
              <div class="rating-buttons">
                <button type="button" class="rating-btn" data-winner="option-a">
                  <span class="rating-badge rating-badge-a">A</span> Option A is Better
                </button>
                <button type="button" class="rating-btn" data-winner="option-b">
                  <span class="rating-badge rating-badge-b">B</span> Option B is Better
                </button>
                <button type="button" class="rating-btn" data-winner="tie">
                  <span class="rating-badge rating-badge-tie">=</span> Tie / Both Accurate
                </button>
                <button type="button" class="rating-btn" data-winner="neither">
                  <span class="rating-badge rating-badge-neither">X</span> Neither / Both Inaccurate
                </button>
              </div>
            </div>

            <div class="benchmark-notes-row">
              <input type="text" id="dual-arena-notes" class="dual-arena-input dual-arena-notes-input" placeholder="Notes (e.g. Option A correctly reduced schwa, Option B had tighter vowel timing...)" />
              <button type="button" id="dual-arena-btn-save-rating" class="dual-arena-btn dual-arena-btn-save-rating" disabled>
                Save Benchmark Rating
              </button>
            </div>
          </div>
        </div>
      `;

      this.cacheElements();
    }

    cacheElements() {
      const q = (id) => this.container.querySelector(id);
      this.elements = {
        presetSelect: q('#dual-arena-preset-select'),
        wordInput: q('#dual-arena-word-input'),
        ipaInput: q('#dual-arena-ipa-input'),
        btnRecord: q('#dual-arena-btn-record'),
        btnStop: q('#dual-arena-btn-stop'),
        recordText: q('#dual-arena-record-text'),
        timer: q('#dual-arena-timer'),
        fileInput: q('#dual-arena-file-input'),
        audioPlayer: q('#dual-arena-audio-player'),
        previewWrap: q('#dual-arena-audio-preview-wrap'),
        btnRun: q('#dual-arena-btn-run'),
        statusBanner: q('#dual-arena-status-banner'),
        waveformWrap: q('#dual-arena-waveform-wrap'),
        waveformView: q('#dual-arena-waveform-view'),
        waveformPlayBtn: q('#dual-arena-waveform-play-btn'),
        playIcon: q('#dual-arena-play-icon'),
        playText: q('#dual-arena-play-text'),
        audioDuration: q('#dual-arena-audio-duration'),
        cardABody: q('#option-a-body'),
        cardBBody: q('#option-b-body'),
        cardAStatus: q('#option-a-status'),
        cardBStatus: q('#option-b-status'),
        cardALatency: q('#option-a-latency'),
        cardBLatency: q('#option-b-latency'),
        benchmarkPanel: q('#dual-arena-benchmark-panel'),
        benchmarkCounter: q('#benchmark-counter'),
        notesInput: q('#dual-arena-notes'),
        btnSaveRating: q('#dual-arena-btn-save-rating'),
        btnExport: q('#dual-arena-btn-export')
      };
    }

    bindEvents() {
      // Backend Toggle Pills
      this.container.querySelectorAll('.dual-arena-pill').forEach((pill) => {
        pill.addEventListener('click', () => {
          this.container.querySelectorAll('.dual-arena-pill').forEach(p => p.classList.remove('is-active'));
          pill.classList.add('is-active');
          const type = pill.dataset.backend;
          this.state.backendType = type;
          this.state.backendUrl = type === 'local' ? this.options.localBackendUrl : this.options.cloudBackendUrl;
          this.showStatus(`Switched backend to ${type === 'local' ? 'Local Server (http://localhost:8081)' : 'Cloud Run (' + this.options.cloudBackendUrl + ')'}`, 'info');
        });
      });

      // Preset Selector
      if (this.elements.presetSelect) {
        this.elements.presetSelect.addEventListener('change', (e) => {
          const opt = e.target.selectedOptions[0];
          if (!opt) return;
          const word = opt.value;
          const ipa = opt.dataset.ipa || '';
          const stress = parseInt(opt.dataset.stress || '0', 10);
          const syllables = parseInt(opt.dataset.syllables || '0', 10);
          this.state.selectedWord = word;
          this.state.selectedIpa = ipa;
          this.state.expectedStress = stress;
          this.state.expectedSyllables = syllables || (ipa.includes('.') ? ipa.split('.').length : null);
          this.elements.wordInput.value = word;
          this.elements.ipaInput.value = ipa;
        });
      }

      // Input changes
      if (this.elements.wordInput) {
        this.elements.wordInput.addEventListener('input', (e) => {
          this.state.selectedWord = e.target.value.trim();
        });
      }
      if (this.elements.ipaInput) {
        this.elements.ipaInput.addEventListener('input', (e) => {
          const ipa = e.target.value.trim();
          this.state.selectedIpa = ipa;
          if (ipa.includes('.')) {
            this.state.expectedSyllables = ipa.split('.').length;
          }
        });
      }

      // Recording
      if (this.elements.btnRecord) {
        this.elements.btnRecord.addEventListener('click', () => this.startRecording());
      }
      if (this.elements.btnStop) {
        this.elements.btnStop.addEventListener('click', () => this.stopRecording());
      }

      // File upload
      if (this.elements.fileInput) {
        this.elements.fileInput.addEventListener('change', (e) => {
          const file = e.target.files && e.target.files[0];
          if (file) {
            this.handleAudioBlob(file);
          }
        });
      }

      // Waveform Play / Pause Button
      if (this.elements.waveformPlayBtn) {
        this.elements.waveformPlayBtn.addEventListener('click', () => this.toggleWaveformPlay());
      }

      // Audio player event listeners for synchronized play state & canvas waveform progress
      if (this.elements.audioPlayer) {
        this.elements.audioPlayer.addEventListener('play', () => this.setWaveformPlayState(true));
        this.elements.audioPlayer.addEventListener('pause', () => this.setWaveformPlayState(false));
        this.elements.audioPlayer.addEventListener('ended', () => {
          this.setWaveformPlayState(false);
          this.drawWaveformCanvas(0);
        });
        this.elements.audioPlayer.addEventListener('timeupdate', () => {
          if (this.lastAudioBuffer && this.elements.audioPlayer.duration) {
            const ratio = this.elements.audioPlayer.currentTime / this.elements.audioPlayer.duration;
            this.drawWaveformCanvas(ratio);
          }
        });
      }

      // Waveform click to seek
      if (this.elements.waveformView) {
        this.elements.waveformView.addEventListener('click', (e) => {
          if (!this.elements.audioPlayer || !this.elements.audioPlayer.duration) return;
          const rect = this.elements.waveformView.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const ratio = Math.max(0, Math.min(1, clickX / rect.width));
          this.elements.audioPlayer.currentTime = ratio * this.elements.audioPlayer.duration;
          this.drawWaveformCanvas(ratio);
        });
      }

      // Run button
      if (this.elements.btnRun) {
        this.elements.btnRun.addEventListener('click', () => this.runDualAnalysis());
      }

      // Rating buttons
      this.container.querySelectorAll('.rating-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.container.querySelectorAll('.rating-btn').forEach(b => b.classList.remove('is-selected'));
          btn.classList.add('is-selected');
          this.state.userJudgment = btn.dataset.winner;
          if (this.elements.btnSaveRating) {
            this.elements.btnSaveRating.disabled = false;
          }
        });
      });

      // Save Rating
      if (this.elements.btnSaveRating) {
        this.elements.btnSaveRating.addEventListener('click', () => this.saveCurrentBenchmark());
      }

      // Export Benchmark
      if (this.elements.btnExport) {
        this.elements.btnExport.addEventListener('click', () => this.exportBenchmarks());
      }
    }

    async startRecording() {
      if (this.state.isRecording) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        });

        this.state.audioChunks = [];
        const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        this.state.mediaRecorder = recorder;
        this.state.isRecording = true;

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            this.state.audioChunks.push(e.data);
          }
        };

        recorder.onstop = async () => {
          const rawBlob = new Blob(this.state.audioChunks, { type: 'audio/webm' });
          stream.getTracks().forEach(t => t.stop());
          await this.handleAudioBlob(rawBlob);
        };

        recorder.start(100);
        this.elements.btnRecord.style.display = 'none';
        this.elements.btnStop.style.display = 'inline-flex';
        this.state.recordingSeconds = 0;
        this.elements.timer.textContent = '0s';

        this.state.recordingTimer = setInterval(() => {
          this.state.recordingSeconds += 1;
          this.elements.timer.textContent = `${this.state.recordingSeconds}s`;
          if (this.state.recordingSeconds >= 10) {
            this.stopRecording();
          }
        }, 1000);

        this.showStatus('Recording... Speak clearly now.', 'info');
      } catch (err) {
        this.showStatus(`Microphone access error: ${err.message}`, 'error');
      }
    }

    stopRecording() {
      if (!this.state.isRecording) return;
      this.state.isRecording = false;
      if (this.state.recordingTimer) {
        clearInterval(this.state.recordingTimer);
      }
      if (this.state.mediaRecorder && this.state.mediaRecorder.state !== 'inactive') {
        this.state.mediaRecorder.stop();
      }
      this.elements.btnRecord.style.display = 'inline-flex';
      this.elements.btnStop.style.display = 'none';
    }

    async handleAudioBlob(blob) {
      let finalBlob = blob;

      // Route through window.AudioDspPipeline if available
      if (window.AudioDspPipeline && typeof window.AudioDspPipeline.enhance === 'function') {
        try {
          this.showStatus('Enhancing audio with standard DSP pipeline (80Hz rumble filter, 16kHz resample, -3dBFS peak norm)...', 'info');
          finalBlob = await window.AudioDspPipeline.enhance(blob);
        } catch (dspErr) {
          console.warn('AudioDspPipeline enhancement failed, using original audio:', dspErr);
        }
      }

      this.state.audioBlob = finalBlob;
      if (this.state.audioUrl) {
        URL.revokeObjectURL(this.state.audioUrl);
      }
      this.state.audioUrl = URL.createObjectURL(finalBlob);

      if (this.elements.audioPlayer) {
        this.elements.audioPlayer.src = this.state.audioUrl;
      }
      if (this.elements.previewWrap) {
        this.elements.previewWrap.style.display = 'inline-flex';
      }
      if (this.elements.btnRun) {
        this.elements.btnRun.disabled = false;
      }

      await this.renderWaveform(finalBlob);

      this.showStatus('Audio ready. Click "Run Dual Analysis" to test Option A and Option B concurrently.', 'success');
    }

    async renderWaveform(blob) {
      if (this.elements.waveformWrap) {
        this.elements.waveformWrap.style.display = 'block';
      }

      // 1. Try window.WaveSurfer if loaded
      if (window.WaveSurfer && typeof window.WaveSurfer.create === 'function') {
        try {
          if (this.wavesurfer) {
            try { this.wavesurfer.destroy(); } catch (_) {
              // Ignore wavesurfer destruction errors
            }
            this.wavesurfer = null;
          }
          const view = this.elements.waveformView;
          if (view) {
            view.innerHTML = '<div id="dual-arena-wavesurfer-target" style="width: 100%;"></div>';
            this.wavesurfer = window.WaveSurfer.create({
              container: '#dual-arena-wavesurfer-target',
              waveColor: '#64748b',
              progressColor: '#38bdf8',
              cursorColor: '#ffffff',
              cursorWidth: 2,
              height: 72,
              normalize: true,
              barWidth: 2,
              barGap: 1,
              barRadius: 2
            });

            this.wavesurfer.on('ready', () => {
              const dur = this.wavesurfer.getDuration();
              if (this.elements.audioDuration) {
                this.elements.audioDuration.textContent = `${dur.toFixed(2)}s`;
              }
            });

            this.wavesurfer.on('play', () => this.setWaveformPlayState(true));
            this.wavesurfer.on('pause', () => this.setWaveformPlayState(false));
            this.wavesurfer.on('finish', () => this.setWaveformPlayState(false));

            this.wavesurfer.load(this.state.audioUrl);
            return;
          }
        } catch (wsErr) {
          console.warn('WaveSurfer initialization failed, falling back to Canvas:', wsErr);
        }
      }

      // 2. Fallback Canvas Waveform using Web Audio API
      await this.renderCanvasWaveform(blob);
    }

    async renderCanvasWaveform(blob) {
      const view = this.elements.waveformView;
      if (!view) return;
      view.innerHTML = '<canvas id="dual-arena-waveform-canvas" class="dual-arena-waveform-canvas" height="80"></canvas>';
      const canvas = view.querySelector('#dual-arena-waveform-canvas');
      if (!canvas) return;

      try {
        const arrayBuffer = await blob.arrayBuffer();
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
        ctx.close();

        this.lastAudioBuffer = audioBuffer;
        const duration = audioBuffer.duration;
        if (this.elements.audioDuration) {
          this.elements.audioDuration.textContent = `${duration.toFixed(2)}s`;
        }

        this.drawWaveformCanvas(0);
      } catch (err) {
        console.warn('Canvas waveform render error:', err);
      }
    }

    drawWaveformCanvas(progressRatio = 0) {
      const canvas = this.elements.waveformView ? this.elements.waveformView.querySelector('#dual-arena-waveform-canvas') : null;
      if (!canvas || !this.lastAudioBuffer) return;

      const audioBuffer = this.lastAudioBuffer;
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.parentElement.clientWidth || 800;
      const height = 80;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const drawCtx = canvas.getContext('2d');
      drawCtx.scale(dpr, dpr);

      // Dark obsidian high-contrast background
      drawCtx.fillStyle = '#090d16';
      drawCtx.fillRect(0, 0, width, height);

      const amp = height / 2;

      // Subtle zero-crossing center line
      drawCtx.strokeStyle = 'rgba(51, 65, 85, 0.4)';
      drawCtx.lineWidth = 1;
      drawCtx.beginPath();
      drawCtx.moveTo(0, amp);
      drawCtx.lineTo(width, amp);
      drawCtx.stroke();

      const channelData = audioBuffer.getChannelData(0);
      const step = Math.ceil(channelData.length / width);
      const playedWidth = Math.min(width, Math.max(0, width * progressRatio));

      // Played gradient (vibrant sky blue to emerald)
      const gradPlayed = drawCtx.createLinearGradient(0, 0, 0, height);
      gradPlayed.addColorStop(0, '#38bdf8');
      gradPlayed.addColorStop(0.5, '#0284c7');
      gradPlayed.addColorStop(1, '#0369a1');

      // Unplayed gradient (crisp light slate)
      const gradUnplayed = drawCtx.createLinearGradient(0, 0, 0, height);
      gradUnplayed.addColorStop(0, '#94a3b8');
      gradUnplayed.addColorStop(0.5, '#64748b');
      gradUnplayed.addColorStop(1, '#475569');

      for (let i = 0; i < width; i++) {
        let min = 1.0;
        let max = -1.0;
        for (let j = 0; j < step; j++) {
          const datum = channelData[(i * step) + j];
          if (datum < min) min = datum;
          if (datum > max) max = datum;
        }
        const barH = Math.max(2, (max - min) * amp * 0.95);
        const barY = amp - barH / 2;
        drawCtx.fillStyle = i <= playedWidth ? gradPlayed : gradUnplayed;
        drawCtx.fillRect(i, barY, 1, barH);
      }

      // Playhead progress cursor
      if (progressRatio > 0 && progressRatio < 1) {
        drawCtx.fillStyle = '#ffffff';
        drawCtx.fillRect(Math.floor(playedWidth), 0, 2, height);
      }
    }

    toggleWaveformPlay() {
      if (this.wavesurfer) {
        this.wavesurfer.playPause();
      } else if (this.elements.audioPlayer) {
        if (this.elements.audioPlayer.paused) {
          this.elements.audioPlayer.play();
          this.setWaveformPlayState(true);
        } else {
          this.elements.audioPlayer.pause();
          this.setWaveformPlayState(false);
        }
      }
    }

    setWaveformPlayState(isPlaying) {
      this.isPlayingWaveform = isPlaying;
      if (this.elements.playIcon) {
        this.elements.playIcon.innerHTML = isPlaying
          ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
          : '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
      }
      if (this.elements.playText) {
        this.elements.playText.textContent = isPlaying ? 'Pause' : 'Play';
      }
    }

    showStatus(message, type = 'info') {
      if (!this.elements.statusBanner) return;
      this.elements.statusBanner.className = `dual-arena-status-banner banner-${type}`;
      this.elements.statusBanner.textContent = message;
      this.elements.statusBanner.style.display = 'block';
    }

    async runDualAnalysis() {
      if (!this.state.audioBlob || this.state.isAnalyzing) return;
      this.state.isAnalyzing = true;
      if (this.elements.btnRun) this.elements.btnRun.disabled = true;

      // Update Card Statuses to Loading
      this.setCardStatus('a', 'running', 'Analyzing...');
      this.setCardStatus('b', 'running', 'Analyzing...');
      this.elements.cardABody.innerHTML = '<div class="card-spinner"><div class="spinner"></div><p>Running Azure Speech assessment & Praat prosody fusion...</p></div>';
      this.elements.cardBBody.innerHTML = '<div class="card-spinner"><div class="spinner"></div><p>Running local Praat native segmentation & repaired V4 stress analysis...</p></div>';

      const word = this.state.selectedWord || 'photograph';
      const ipa = this.state.selectedIpa || '';
      const backendUrl = this.state.backendUrl;

      const [resA, resB] = await Promise.allSettled([
        this.fetchOptionA(word, ipa, backendUrl),
        this.fetchOptionB(word, ipa, backendUrl)
      ]);

      this.state.isAnalyzing = false;
      if (this.elements.btnRun) this.elements.btnRun.disabled = false;

      // Render Option A
      if (resA.status === 'fulfilled' && resA.value.success) {
        this.state.optionAResult = resA.value.data;
        this.state.optionALatency = resA.value.latency;
        this.state.optionAError = null;
        this.elements.cardALatency.textContent = `${resA.value.latency} ms`;
        this.setCardStatus('a', 'success', 'Complete');
        this.renderOptionACard(resA.value.data);
      } else {
        const err = resA.status === 'rejected' ? resA.reason : (resA.value.error || 'Option A failed');
        this.state.optionAError = err;
        this.state.optionAResult = null;
        this.setCardStatus('a', 'error', 'Failed');
        this.elements.cardABody.innerHTML = `<div class="card-error"><span class="error-badge">ERROR</span><p>Option A Error: ${err}</p></div>`;
      }

      // Render Option B
      if (resB.status === 'fulfilled' && resB.value.success) {
        this.state.optionBResult = resB.value.data;
        this.state.optionBLatency = resB.value.latency;
        this.state.optionBError = null;
        this.elements.cardBLatency.textContent = `${resB.value.latency} ms`;
        this.setCardStatus('b', 'success', 'Complete');
        this.renderOptionBCard(resB.value.data);
      } else {
        const err = resB.status === 'rejected' ? resB.reason : (resB.value.error || 'Option B failed');
        this.state.optionBError = err;
        this.state.optionBResult = null;
        this.setCardStatus('b', 'error', 'Failed');
        this.elements.cardBBody.innerHTML = `<div class="card-error"><span class="error-badge">ERROR</span><p>Option B Error: ${err}</p></div>`;
      }

      // Show Benchmark evaluation panel
      if (this.elements.benchmarkPanel) {
        this.elements.benchmarkPanel.style.display = 'block';
      }
    }

    setCardStatus(card, type, text) {
      const el = card === 'a' ? this.elements.cardAStatus : this.elements.cardBStatus;
      if (!el) return;
      el.className = `status-indicator status-${type}`;
      el.textContent = text;
    }

    async fetchOptionA(word, ipa, backendUrl) {
      const start = performance.now();
      const formData = new FormData();
      formData.append('audio', this.state.audioBlob, 'audio.wav');
      formData.append('word', word);
      formData.append('reference_ipa', ipa);
      formData.append('backendUrl', backendUrl);

      // Call Cloud Functions route /api/pronunciation-assessment/option-a
      const res = await fetch('/api/pronunciation-assessment/option-a', {
        method: 'POST',
        body: formData
      });
      const latency = Math.round(performance.now() - start);

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 150)}`);
      }
      const data = await res.json();
      return { success: data.success, data, latency };
    }

    async fetchOptionB(word, ipa, backendUrl) {
      const start = performance.now();
      const formData = new FormData();
      formData.append('audio', this.state.audioBlob, 'audio.wav');
      formData.append('word', word);
      formData.append('reference_ipa', ipa);
      if (this.state.expectedSyllables) {
        formData.append('expected_syllables', String(this.state.expectedSyllables));
      } else if (ipa && ipa.includes('.')) {
        formData.append('expected_syllables', String(ipa.split('.').length));
      }

      let res;
      // Try local direct first if local selected, fallback to Cloud Functions proxy
      if (this.state.backendType === 'local') {
        try {
          res = await fetch(`${backendUrl}/analyze/option-b`, {
            method: 'POST',
            body: formData,
            signal: AbortSignal.timeout(8000)
          });
        } catch (_) {
          // Fallback to proxy
          res = await fetch('/api/pronunciation-assessment/option-b', {
            method: 'POST',
            body: formData,
            headers: { 'x-python-backend-url': backendUrl }
          });
        }
      } else {
        res = await fetch('/api/pronunciation-assessment/option-b', {
          method: 'POST',
          body: formData,
          headers: { 'x-python-backend-url': backendUrl }
        });
      }

      const latency = Math.round(performance.now() - start);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 150)}`);
      }
      const data = await res.json();
      return { success: data.success, data, latency };
    }

    renderOptionACard(data) {
      const azure = data.azureScores || {};
      const syllables = data.syllables || [];
      const stressedSylNum = data.stressedSyllableNumber || 1;

      let syllablesHtml = syllables.map((s, idx) => {
        const isStressed = s.isStressed;
        const durMs = Math.round((s.vowelDuration || 0) * 1000);
        const pitchHz = s.maxPitch ? `${s.maxPitch} Hz` : (s.meanPitch ? `${s.meanPitch} Hz` : 'Unvoiced');
        const intDb = s.peakIntensity ? `${s.peakIntensity} dB` : 'N/A';
        const promPct = Math.round((s.prominence || 0) * 100);

        let reductionTag = '';
        if (s.reduction) {
          const verdictText = s.reduction.verdict || (s.reduction.isReduced ? 'Weak reduction to [ə] detected' : `Full vowel [${s.reduction.phoneme}] maintained`);
          reductionTag = s.reduction.isReduced
            ? `<span class="tag-reduced" title="${verdictText}">/ə/ Reduced <span class="reduction-verdict">(${verdictText})</span></span>`
            : `<span class="tag-full" title="${verdictText}">[${s.reduction.phoneme}] Full</span>`;
        }

        return `
          <div class="dual-syl-row ${isStressed ? 'is-stressed' : ''}">
            <div class="syl-col-main">
              <span class="syl-num">S${s.syllableNumber || idx + 1}</span>
              <span class="syl-vowel">/${s.nucleusPhoneme || '?'}/</span>
              ${reductionTag}
              ${isStressed ? '<span class="tag-stress-badge">PRIMARY STRESS</span>' : ''}
            </div>
            <div class="syl-col-metrics">
              <span class="metric-pill" title="Vowel Nucleus Duration"><span class="metric-label">DUR</span> ${durMs}ms</span>
              <span class="metric-pill" title="Pitch (F0)"><span class="metric-label">F0</span> ${pitchHz}</span>
              <span class="metric-pill" title="Intensity"><span class="metric-label">INT</span> ${intDb}</span>
            </div>
            <div class="syl-col-prominence">
              <div class="prominence-bar-wrap" title="Lexical prominence: ${promPct}%">
                <div class="prominence-bar-fill" style="width: ${promPct}%;"></div>
              </div>
              <span class="prominence-num">${promPct}%</span>
            </div>
          </div>
        `;
      }).join('');

      this.elements.cardABody.innerHTML = `
        <div class="card-inner-results">
          <!-- Overview Banner -->
          <div class="card-metric-banner">
            <div class="metric-stat">
              <span class="stat-value">${azure.accuracy ?? '--'}</span>
              <span class="stat-label">Accuracy</span>
            </div>
            <div class="metric-stat">
              <span class="stat-value">${azure.fluency ?? '--'}</span>
              <span class="stat-label">Fluency</span>
            </div>
            <div class="metric-stat highlight">
              <span class="stat-value">Syllable ${stressedSylNum}</span>
              <span class="stat-label">Detected Stress</span>
            </div>
          </div>

          <!-- Syllable Prominence Section -->
          <div class="card-section">
            <h4 class="card-section-title">Vowel Nuclei & Prosody Breakdown</h4>
            <div class="dual-syl-list">
              ${syllablesHtml || '<p class="crm-muted">No syllables extracted.</p>'}
            </div>
          </div>

          <!-- Extra details disclosure -->
          <details class="card-details-disclosure">
            <summary>Phoneme Alignments & Details (${data.phonemes?.length || 0} phones)</summary>
            <div class="phoneme-pills-wrap">
              ${(data.phonemes || []).map(p => `
                <span class="phone-pill ${p.isVowel ? 'phone-vowel' : ''}" title="Accuracy: ${p.accuracyScore}% (${p.startTime}s - ${p.endTime}s)">
                  ${p.phoneme} <small>${p.accuracyScore}</small>
                </span>
              `).join('')}
            </div>
          </details>
        </div>
      `;
    }

    renderOptionBCard(data) {
      const syllables = data.syllables || [];
      const stressedSylNum = data.summary?.stressedSyllableNumber || 1;
      const v4Info = data.v4Syllabification || {};

      let syllablesHtml = syllables.map((s, idx) => {
        const isStressed = s.isStressed;
        const durMs = Math.round((s.vowelDuration || s.duration || 0) * 1000);
        const pitchHz = s.maxPitch ? `${s.maxPitch} Hz` : (s.avgPitch ? `${s.avgPitch} Hz` : 'Unvoiced');
        const intDb = s.intensity ? `${s.intensity} dB` : 'N/A';
        const promPct = Math.round((s.prominence || 0) * 100);

        return `
          <div class="dual-syl-row ${isStressed ? 'is-stressed' : ''}">
            <div class="syl-col-main">
              <span class="syl-num">S${s.syllable || idx + 1}</span>
              <span class="syl-ipa">${s.startTime}s - ${s.endTime}s</span>
              ${isStressed ? '<span class="tag-stress-badge badge-b">PRIMARY STRESS</span>' : ''}
            </div>
            <div class="syl-col-metrics">
              <span class="metric-pill" title="Measured Vowel Duration"><span class="metric-label">DUR</span> ${durMs}ms</span>
              <span class="metric-pill" title="Pitch (F0)"><span class="metric-label">F0</span> ${pitchHz}</span>
              <span class="metric-pill" title="Intensity"><span class="metric-label">INT</span> ${intDb}</span>
            </div>
            <div class="syl-col-prominence">
              <div class="prominence-bar-wrap" title="Lexical prominence: ${promPct}%">
                <div class="prominence-bar-fill fill-b" style="width: ${promPct}%;"></div>
              </div>
              <span class="prominence-num">${promPct}%</span>
            </div>
          </div>
        `;
      }).join('');

      this.elements.cardBBody.innerHTML = `
        <div class="card-inner-results">
          <!-- Overview Banner -->
          <div class="card-metric-banner banner-b">
            <div class="metric-stat">
              <span class="stat-value">${syllables.length}</span>
              <span class="stat-label">Syllables</span>
            </div>
            <div class="metric-stat highlight-b">
              <span class="stat-value">Syllable ${stressedSylNum}</span>
              <span class="stat-label">Detected Stress</span>
            </div>
            <div class="metric-stat">
              <span class="stat-value">${v4Info.syllable_count || syllables.length}</span>
              <span class="stat-label">V4 Syllables</span>
            </div>
          </div>

          <!-- Syllable Prominence Section -->
          <div class="card-section">
            <h4 class="card-section-title">Praat Multi-Cue & Repaired Vowel Prominence</h4>
            <div class="dual-syl-list">
              ${syllablesHtml || '<p class="crm-muted">No syllables extracted.</p>'}
            </div>
          </div>

          <!-- V4 Structure disclosure -->
          <details class="card-details-disclosure">
            <summary>V4 Syllabification Structure (${v4Info.ruleVersion || 'A2 Rule'})</summary>
            <div class="v4-structure-content">
              <p><strong>Display:</strong> ${v4Info.displaySyllabification || 'N/A'}</p>
              <p><strong>Rule Policy:</strong> Stressed-lax reservation + maximal legal onset</p>
            </div>
          </details>
        </div>
      `;
    }

    saveCurrentBenchmark() {
      if (!this.state.userJudgment) return;

      const benchmarkItem = {
        id: `bench-${Date.now()}`,
        timestamp: new Date().toISOString(),
        word: this.state.selectedWord,
        ipa: this.state.selectedIpa,
        expectedStress: this.state.expectedStress,
        winner: this.state.userJudgment,
        notes: this.elements.notesInput ? this.elements.notesInput.value.trim() : '',
        optionA: {
          detectedStress: this.state.optionAResult?.detectedStressedIndex,
          stressedSyllableNumber: this.state.optionAResult?.stressedSyllableNumber,
          latency: this.state.optionALatency,
          scores: this.state.optionAResult?.azureScores
        },
        optionB: {
          detectedStress: this.state.optionBResult?.detectedStressedIndex,
          stressedSyllableNumber: this.state.optionBResult?.summary?.stressedSyllableNumber,
          latency: this.state.optionBLatency,
          syllableCount: this.state.optionBResult?.summary?.syllableCount
        }
      };

      this.state.benchmarks.push(benchmarkItem);
      this.saveBenchmarks();

      if (this.elements.benchmarkCounter) {
        this.elements.benchmarkCounter.textContent = `${this.state.benchmarks.length} Comparisons Saved`;
      }
      if (this.elements.btnExport) {
        this.elements.btnExport.disabled = false;
      }
      if (this.elements.notesInput) {
        this.elements.notesInput.value = '';
      }
      this.container.querySelectorAll('.rating-btn').forEach(b => b.classList.remove('is-selected'));
      this.state.userJudgment = null;
      if (this.elements.btnSaveRating) {
        this.elements.btnSaveRating.disabled = true;
      }

      this.showStatus(`Saved comparison verdict to benchmark suite (${this.state.benchmarks.length} total).`, 'success');
    }

    exportBenchmarks() {
      if (this.state.benchmarks.length === 0) return;
      const json = JSON.stringify(this.state.benchmarks, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pronunciation-dual-benchmark-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }

  window.PronunciationDualArena = PronunciationDualArena;
})(window, document);
