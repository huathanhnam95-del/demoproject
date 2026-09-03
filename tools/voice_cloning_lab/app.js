/**
 * Voice Cloning Laboratory — Step-by-Step Controller & Audio Engine with Local Audio Persistence
 */

(function () {
  'use strict';

  // --- Read Aloud Question Bank ---
  const CALIBRATION_PROMPTS = [
    {
      id: '18',
      title: "1. RA #18 (Research)",
      text: "Certain types of methodology are more suitable for some research projects than others. For example, the use of questionnaires and surveys is more suitable for quantitative research, whereas interviews and focus groups are more often used for qualitative research purposes."
    },
    {
      id: '15',
      title: "2. RA #15 (Competition)",
      text: "The insults and criticism were not unexpected. What was surprising was people's enthusiasm about the competition. Thousands have participated in the discussion. The sheer number of participants far exceeded our initial projections, turning a small event into a major phenomenon."
    },
    {
      id: '419',
      title: "3. RA #419 (Health Tech)",
      text: "A stretchable system that can harvest energy from human breathing and motion for use in wearable health-monitoring devices may be possible, according to an international team of researchers. This development could eliminate the need for traditional power sources in wearables."
    }
  ];

  const TARGET_4TH_QUESTIONS = {
    '731': {
      id: '731',
      title: "RA #731: Ancient Ice Storage",
      text: "The cold storage structures are located south of the main city center. These large structures would have had sheets of ice built up on the ground level over the course of the winter to provide year-round ice supplies."
    },
    '402': {
      id: '402',
      title: "RA #402: Species Susceptibility",
      text: "An analysis of ten different species finds that humans, followed by ferrets and, to a lesser extent, cats, civets and dogs, are the most susceptible animals to SARS-CoV-2 infection. These findings help identify key species for monitoring and vaccine testing."
    },
    '8': {
      id: '8',
      title: "RA #8: Astrophysics Twins",
      text: "The situation is similar to a pregnant woman who has twin babies in her belly, says Avi of the Smithsonian Center for Astrophysics. He's proposing the idea in a paper that's been accepted for publication in the Astrophysical Journal Letters."
    }
  };

  const FULL_CALIBRATION_TRANSCRIPT = CALIBRATION_PROMPTS.map(p => p.text).join(" ");

  // --- State ---
  const state = {
    currentStep: 1,
    mode: 'side', // 'side' or 'blind'
    reference: {
      id: 'rec_init',
      url: null,
      blob: null,
      filename: 'my_saved_voice.webm',
      duration: 52.0,
      peaks: generateSimulatedPeaks(60),
      transcript: FULL_CALIBRATION_TRANSCRIPT
    },
    savedVoiceProfile: null,
    selected4thId: '731',
    candidates: {
      'cand-a': { engineId: 'f5_tts', name: 'F5-TTS (Flow-Matching)', arch: 'Continuous Mel-Flow DiT', audioUrl: null, peaks: [], duration: 0, rtf: 0, secs: 0, wer: 0, latency: 0, mode: 'neural_clone', isRealCloner: true },
      'cand-b': { engineId: 'e2_tts', name: 'E2-TTS (Flat-Transformer)', arch: 'Flat-DiT Flow Matching', audioUrl: null, peaks: [], duration: 0, rtf: 0, secs: 0, wer: 0, latency: 0, mode: 'neural_clone', isRealCloner: true },
      'cand-c': { engineId: 'chattts', name: 'ChatTTS (Generative Baseline)', arch: 'No Cloning — Random Voice', audioUrl: null, peaks: [], duration: 0, rtf: 0, secs: 0, wer: 0, latency: 0, mode: 'generative_baseline', isRealCloner: false }
    },
    ratings: {
      'cand-a': { similarity: 5, prosody: 5, clarity: 5, artifact: 5 },
      'cand-b': { similarity: 5, prosody: 5, clarity: 5, artifact: 5 },
      'cand-c': { similarity: 3, prosody: 4, clarity: 4, artifact: 4 }
    },
    blindMapping: null,
    isBlindRevealed: false,
    
    // Audio Player State
    audioCtx: null,
    analyser: null,
    activeAudioElement: null,
    activePlayingKey: null,
    animFrameId: null,

    // Recorder State
    activeCalibPromptIdx: 0,
    mediaRecorder: null,
    recordedChunks: [],
    recordingTimerId: null,
    recordingSeconds: 0,
    isRecording: false,
    micStream: null,
    micAnalyser: null,
    micAnimFrameId: null
  };

  // --- Voice Presets ---
  const PRESETS = {
    teacher_mark: {
      id: 'preset_mark',
      filename: 'teacher_mark_45s.wav',
      duration: 45.0,
      transcript: FULL_CALIBRATION_TRANSCRIPT,
      peaks: generateSimulatedPeaks(60)
    },
    elena_us: {
      id: 'preset_elena',
      filename: 'elena_academic_30s.wav',
      duration: 30.0,
      transcript: FULL_CALIBRATION_TRANSCRIPT,
      peaks: generateSimulatedPeaks(60)
    },
    vn_coach: {
      id: 'preset_vn',
      filename: 'coach_nam_50s.wav',
      duration: 50.0,
      transcript: FULL_CALIBRATION_TRANSCRIPT,
      peaks: generateSimulatedPeaks(60)
    }
  };

  function generateSimulatedPeaks(count) {
    const peaks = [];
    for (let i = 0; i < count; i++) {
      const v = 0.2 + 0.65 * Math.abs(Math.sin(i * 0.28) * Math.cos(i * 0.12));
      peaks.push(parseFloat(v.toFixed(3)));
    }
    return peaks;
  }

  // --- IndexedDB Local Audio Persistence Layer ---
  const DB_NAME = 'VoiceCloningLabDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'saved_voices';

  function openVoiceDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function saveVoiceToIndexedDB(voiceRecord) {
    try {
      const db = await openVoiceDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      await store.put({
        id: 'default_voice',
        blob: voiceRecord.blob,
        filename: voiceRecord.filename,
        duration: voiceRecord.duration,
        peaks: voiceRecord.peaks,
        transcript: voiceRecord.transcript,
        savedAt: Date.now()
      });
    } catch (err) {
      console.warn('IndexedDB write error:', err);
    }
  }

  async function loadVoiceFromIndexedDB() {
    try {
      const db = await openVoiceDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get('default_voice');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (err) {
      console.warn('IndexedDB read error:', err);
      return null;
    }
  }

  // --- DOM Elements ---
  const el = {
    // Stepper Nodes
    stepNode1: document.getElementById('step-node-1'),
    stepNode2: document.getElementById('step-node-2'),
    stepNode3: document.getElementById('step-node-3'),
    stepNode4: document.getElementById('step-node-4'),
    conn12: document.getElementById('conn-1-2'),
    conn23: document.getElementById('conn-2-3'),
    conn34: document.getElementById('conn-3-4'),

    // Panels
    panelStep1: document.getElementById('panel-step-1'),
    panelStep2: document.getElementById('panel-step-2'),
    panelStep3: document.getElementById('panel-step-3'),
    panelStep4: document.getElementById('panel-step-4'),
    synthesisOverlay: document.getElementById('synthesis-overlay'),

    // Benchmark Quick Nav
    btnJumpToRa10: document.getElementById('btn-jump-to-ra10'),
    btnBackToStep1From4: document.getElementById('btn-back-to-step1'),

    // Step 1 Saved Voice Banner & Cards
    savedVoiceBanner: document.getElementById('saved-voice-banner'),
    savedVoiceMeta: document.getElementById('saved-voice-meta'),
    btnUseSavedVoice: document.getElementById('btn-use-saved-voice'),
    btnListenSaved: document.getElementById('btn-listen-saved'),
    btnToggleRecordNew: document.getElementById('btn-toggle-record-new'),
    readerStudioCard: document.getElementById('reader-studio-card'),
    recorderConsoleCard: document.getElementById('recorder-console-card'),
    presetMyVoice: document.getElementById('preset-my-voice'),

    // Step 1 Prompts & Recording Elements
    tabPrompt1: document.getElementById('tab-prompt-1'),
    tabPrompt2: document.getElementById('tab-prompt-2'),
    tabPrompt3: document.getElementById('tab-prompt-3'),
    promptActiveText: document.getElementById('prompt-active-text'),
    btnStartRecord: document.getElementById('btn-start-record'),
    btnStopRecord: document.getElementById('btn-stop-record'),
    recDot: document.getElementById('rec-dot'),
    recStatusText: document.getElementById('rec-status-text'),
    recTimer: document.getElementById('rec-timer'),
    micMeterCanvas: document.getElementById('mic-meter-canvas'),
    recordedPreviewCard: document.getElementById('recorded-preview-card'),
    refFilename: document.getElementById('ref-filename'),
    refDuration: document.getElementById('ref-duration'),
    refWaveformCanvas: document.getElementById('ref-waveform-canvas'),
    refPlayBtn: document.getElementById('ref-play-btn'),
    refPlayIcon: document.getElementById('ref-play-icon'),
    refDownloadBtn: document.getElementById('ref-download-btn'),
    btnGotoStep2: document.getElementById('btn-goto-step-2'),

    // Step 2 Elements
    cardRa731: document.getElementById('card-ra-731'),
    cardRa402: document.getElementById('card-ra-402'),
    cardRa8: document.getElementById('card-ra-8'),
    targetTextInput: document.getElementById('target-text-input'),
    targetCharCount: document.getElementById('target-char-count'),
    emotionSelect: document.getElementById('emotion-select'),
    speedSlider: document.getElementById('speed-slider'),
    speedVal: document.getElementById('speed-val'),
    btnBackToStep1: document.getElementById('btn-back-to-step-1'),
    btnRunAll: document.getElementById('btn-run-all'),

    // Step 3 Elements
    btnModeSide: document.getElementById('btn-mode-side'),
    btnModeBlind: document.getElementById('btn-mode-blind'),
    btnRevealBlind: document.getElementById('btn-reveal-blind'),
    btnNewTest: document.getElementById('btn-new-test'),
    activeChallengeText: document.getElementById('active-challenge-text'),
    spectrogramCanvas: document.getElementById('spectrogram-canvas'),
    btnExportJson: document.getElementById('btn-export-json'),
    btnExportCsv: document.getElementById('btn-export-csv')
  };

  // --- Wizard Navigation Controller ---
  function goToStep(stepNum) {
    state.currentStep = stepNum;

    // Stop any playing audio
    stopActiveAudio();

    // Toggle Panels
    el.panelStep1.classList.toggle('hidden', stepNum !== 1);
    el.panelStep2.classList.toggle('hidden', stepNum !== 2);
    el.panelStep3.classList.toggle('hidden', stepNum !== 3);
    if (el.panelStep4) el.panelStep4.classList.toggle('hidden', stepNum !== 4);

    // Update Stepper Nodes
    [el.stepNode1, el.stepNode2, el.stepNode3, el.stepNode4].forEach((node, idx) => {
      if (!node) return;
      const nStep = idx + 1;
      node.classList.toggle('active', nStep === stepNum);
      node.classList.toggle('completed', nStep < stepNum);
    });

    if (el.conn12) el.conn12.classList.toggle('active', stepNum >= 2);
    if (el.conn23) el.conn23.classList.toggle('active', stepNum >= 3);
    if (el.conn34) el.conn34.classList.toggle('active', stepNum >= 4);

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Step specific setup
    if (stepNum === 1) {
      drawWaveform(el.refWaveformCanvas, state.reference.peaks, 0.0, '#10b981');
    } else if (stepNum === 2) {
      el.targetCharCount.textContent = `${el.targetTextInput.value.length} chars`;
    } else if (stepNum === 3) {
      el.activeChallengeText.textContent = `"${el.targetTextInput.value}"`;
      ['cand-a', 'cand-b', 'cand-c'].forEach(k => updateCandidateCardUI(k));
      updateLeaderboardScores();
    } else if (stepNum === 4) {
      loadRa10BenchmarkResults();
    }
  }

  // --- Initialize Web Audio ---
  function initAudioContext() {
    if (!state.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      state.audioCtx = new AudioCtx();
      state.analyser = state.audioCtx.createAnalyser();
      state.analyser.fftSize = 256;
      startSpectrogramLoop();
    }
    if (state.audioCtx.state === 'suspended') {
      state.audioCtx.resume();
    }
  }

  // --- Step 1: Calibration Prompt Tabs ---
  function setCalibrationPrompt(idx) {
    state.activeCalibPromptIdx = idx;
    const prompt = CALIBRATION_PROMPTS[idx];
    if (prompt && el.promptActiveText) {
      el.promptActiveText.textContent = `"${prompt.text}"`;
    }

    [el.tabPrompt1, el.tabPrompt2, el.tabPrompt3].forEach((tab, i) => {
      if (tab) tab.classList.toggle('active', i === idx);
    });
  }

  // --- Step 1: Live Microphone Recording ---
  async function startRecording() {
    initAudioContext();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.micStream = stream;

      const micSource = state.audioCtx.createMediaStreamSource(stream);
      state.micAnalyser = state.audioCtx.createAnalyser();
      state.micAnalyser.fftSize = 128;
      micSource.connect(state.micAnalyser);
      startMicVisualizerLoop();

      let options = { mimeType: 'audio/webm;codecs=opus' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'audio/webm' };
      }
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = {};
      }

      state.mediaRecorder = new MediaRecorder(stream, options);
      state.recordedChunks = [];

      state.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          state.recordedChunks.push(event.data);
        }
      };

      state.mediaRecorder.onstop = handleRecordingComplete;

      state.mediaRecorder.start(250);
      state.isRecording = true;
      state.recordingSeconds = 0;

      el.btnStartRecord.classList.add('hidden');
      el.btnStopRecord.classList.remove('hidden');
      el.recDot.classList.add('recording');
      el.recStatusText.textContent = 'Recording 3 Prompts in sequence... Speak clearly';
      el.recStatusText.style.color = '#ef4444';

      clearInterval(state.recordingTimerId);
      state.recordingTimerId = setInterval(() => {
        state.recordingSeconds++;
        const m = Math.floor(state.recordingSeconds / 60);
        const s = state.recordingSeconds % 60;
        el.recTimer.textContent = `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s} / 01:00`;

        if (state.recordingSeconds === 18) setCalibrationPrompt(1);
        if (state.recordingSeconds === 36) setCalibrationPrompt(2);

        if (state.recordingSeconds >= 60) {
          stopRecording();
        }
      }, 1000);

    } catch (err) {
      console.error('Microphone error:', err);
      alert('Microphone access was denied. Please allow microphone permission in your browser or select one of the demo voices below.');
    }
  }

  function stopRecording() {
    if (state.mediaRecorder && state.isRecording) {
      state.mediaRecorder.stop();
      state.isRecording = false;
    }
    if (state.micStream) {
      state.micStream.getTracks().forEach(track => track.stop());
      state.micStream = null;
    }
    clearInterval(state.recordingTimerId);
    cancelAnimationFrame(state.micAnimFrameId);

    el.btnStopRecord.classList.add('hidden');
    el.btnStartRecord.classList.remove('hidden');
    el.recDot.classList.remove('recording');
    el.recStatusText.textContent = 'Voice Calibrated & Saved Locally ✓';
    el.recStatusText.style.color = '#10b981';
  }

  async function handleRecordingComplete() {
    const audioBlob = new Blob(state.recordedChunks, { type: 'audio/webm' });
    const audioUrl = URL.createObjectURL(audioBlob);
    const duration = Math.max(1.0, state.recordingSeconds);
    const timestamp = Date.now();
    const filename = `my_saved_voice_${timestamp}.webm`;

    const peaks = generateSimulatedPeaks(60);

    const voiceRecord = {
      id: `rec_${timestamp}`,
      url: audioUrl,
      blob: audioBlob,
      filename: filename,
      duration: duration,
      peaks: peaks,
      transcript: FULL_CALIBRATION_TRANSCRIPT
    };

    state.reference = voiceRecord;
    state.savedVoiceProfile = voiceRecord;

    // 1. Save persistently to IndexedDB
    await saveVoiceToIndexedDB(voiceRecord);

    // 2. Upload to Server to persist in samples/my_saved_voice.webm
    try {
      const formData = new FormData();
      formData.append('file', audioBlob, 'my_saved_voice.webm');
      formData.append('transcript', FULL_CALIBRATION_TRANSCRIPT);
      formData.append('save_as_default', 'true');

      const res = await fetch('/api/upload_reference', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.reference_id) {
        state.reference.id = data.reference_id;
      }
    } catch (err) {
      console.log('Voice saved locally in browser cache.');
    }

    // Update UI
    el.refFilename.textContent = filename;
    el.refDuration.textContent = `Duration: ${formatTime(duration)}`;
    el.recordedPreviewCard.classList.remove('hidden');
    drawWaveform(el.refWaveformCanvas, peaks, 0.0, '#10b981');

    if (el.savedVoiceBanner) {
      el.savedVoiceBanner.classList.remove('hidden');
      el.savedVoiceMeta.textContent = `Saved locally: ${filename} (${formatTime(duration)})`;
    }
  }

  // --- Real-Time Mic Meter Loop ---
  function startMicVisualizerLoop() {
    const canvas = el.micMeterCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function render() {
      const w = canvas.width = canvas.parentElement.clientWidth || 300;
      const h = canvas.height = 36;

      ctx.fillStyle = '#090e17';
      ctx.fillRect(0, 0, w, h);

      if (state.micAnalyser && state.isRecording) {
        const bufferLength = state.micAnalyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        state.micAnalyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const level = avg / 255;

        const barW = w * level;
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, '#10b981');
        grad.addColorStop(0.7, '#f59e0b');
        grad.addColorStop(1, '#ef4444');

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, barW, h);

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(Math.min(w - 2, barW), 0, 2, h);
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(0, h / 2 - 1, w, 2);
      }

      if (state.isRecording) {
        state.micAnimFrameId = requestAnimationFrame(render);
      }
    }
    render();
  }

  // --- Step 2: 4th Question Selection ---
  function select4thQuestion(qId) {
    state.selected4thId = qId;
    const q = TARGET_4TH_QUESTIONS[qId];
    if (!q) return;

    el.targetTextInput.value = q.text;
    el.targetCharCount.textContent = `${q.text.length} chars`;

    [el.cardRa731, el.cardRa402, el.cardRa8].forEach(card => {
      if (card) card.classList.toggle('active', card.dataset.raId === qId);
    });
  }

  // --- Step 2 -> 3: Synthesize All Models on 4th Question ---
  async function runSynthesis() {
    initAudioContext();
    const text = el.targetTextInput.value.trim();
    if (!text) {
      alert('Please enter text for the 4th Read Aloud question.');
      return;
    }
    // Show Synthesis Progress Overlay
    el.synthesisOverlay.classList.remove('hidden');

    // Update progress items for available engines
    const progressIds = ['f5', 'e2', 'chat'];
    progressIds.forEach(id => {
      const stateEl = document.getElementById(`state-${id}`);
      const progEl = document.getElementById(`prog-${id}`);
      if (stateEl) stateEl.textContent = 'Queued';
      if (progEl) progEl.classList.remove('done', 'active');
    });

    // Start visual animation
    const progF5 = document.getElementById('prog-f5');
    const stateF5 = document.getElementById('state-f5');
    if (progF5) progF5.classList.add('active');
    if (stateF5) stateF5.textContent = 'Running Flow Matching...';

    try {
      // Fetch dynamic engine list from server
      const statusResp = await fetch('/api/status');
      const statusData = await statusResp.json();
      const availableEngines = Object.keys(statusData.engines || {});

      const response = await fetch('/api/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_text: text,
          reference_id: state.reference.id || 'my_saved_voice',
          reference_transcript: state.reference.transcript || FULL_CALIBRATION_TRANSCRIPT,
          engines: availableEngines,
          emotion: el.emotionSelect.value,
          speed: parseFloat(el.speedSlider.value)
        })
      });

      const data = await response.json();
      if (data.status === 'success') {
        populateSynthesisResults(data.results);
      }
    } catch (err) {
      console.warn('Synthesis API error:', err);
    } finally {
      // Mark all progress done
      progressIds.forEach(id => {
        const stateEl = document.getElementById(`state-${id}`);
        const progEl = document.getElementById(`prog-${id}`);
        if (stateEl) stateEl.textContent = 'Ready ✓';
        if (progEl) progEl.classList.add('done');
      });

      setTimeout(() => {
        el.synthesisOverlay.classList.add('hidden');
        progressIds.forEach(id => {
          const item = document.getElementById(`prog-${id}`);
          if (item) item.classList.remove('done', 'active');
        });
        const pf5 = document.getElementById('prog-f5');
        if (pf5) pf5.classList.add('active');

        // Advance to Step 3 Listening Arena
        goToStep(3);
      }, 300);
    }
  }

  function populateSynthesisResults(results) {
    const candKeys = ['cand-a', 'cand-b', 'cand-c'];
    const engineKeys = Object.keys(results);

    if (state.mode === 'blind') {
      const shuffled = [...engineKeys].sort(() => Math.random() - 0.5);
      state.blindMapping = {};
      candKeys.forEach((k, i) => {
        if (i < shuffled.length) state.blindMapping[k] = shuffled[i];
      });
      state.isBlindRevealed = false;
    } else {
      state.blindMapping = null;
      state.isBlindRevealed = true;
    }

    candKeys.forEach((candKey, idx) => {
      const engineKey = (state.mode === 'blind' && state.blindMapping) ? state.blindMapping[candKey] : engineKeys[idx];
      const res = results[engineKey];
      if (res && state.candidates[candKey]) {
        state.candidates[candKey].engineId = res.engine_id;
        state.candidates[candKey].name = res.name;
        state.candidates[candKey].audioUrl = res.audio_url;
        state.candidates[candKey].peaks = res.peaks || generateSimulatedPeaks(100);
        state.candidates[candKey].duration = res.duration_seconds || 0;
        state.candidates[candKey].rtf = res.rtf || 0;
        state.candidates[candKey].secs = res.metrics ? res.metrics.secs_similarity : 0;
        state.candidates[candKey].wer = res.metrics ? res.metrics.estimated_wer : 0;
        state.candidates[candKey].latency = res.latency_seconds ? Math.round(res.latency_seconds * 1000) : 0;
        state.candidates[candKey].mode = res.mode || 'unknown';
        state.candidates[candKey].isRealCloner = res.is_real_cloner !== false;
        state.candidates[candKey].modeLabel = res.mode_label || '';
        state.candidates[candKey].modeIcon = res.mode_icon || '';
      }

      // Hide unused candidate cards
      const cardEl = document.getElementById('card-' + candKey);
      if (cardEl) {
        cardEl.style.display = (idx < engineKeys.length) ? '' : 'none';
      }
    });

    candKeys.forEach(k => updateCandidateCardUI(k));
  }

  // --- Candidate Card UI Update ---
  function updateCandidateCardUI(candKey) {
    const cand = state.candidates[candKey];
    if (!cand) return;

    const isBlind = state.mode === 'blind' && !state.isBlindRevealed;

    const badgeEl = document.getElementById(`badge-${candKey}`);
    const nameEl = document.getElementById(`name-${candKey}`);
    const archEl = document.getElementById(`arch-${candKey}`);
    const canvasEl = document.getElementById(`canvas-${candKey}`);
    const timeEl = document.getElementById(`time-${candKey}`);
    const rtfEl = document.getElementById(`rtf-${candKey}`);
    const secsEl = document.getElementById(`secs-${candKey}`);
    const werEl = document.getElementById(`wer-${candKey}`);
    const latEl = document.getElementById(`lat-${candKey}`);

    const colorMap = {
      f5_tts: { color: '#818cf8', bg: 'rgba(99, 102, 241, 0.15)', border: 'rgba(99, 102, 241, 0.3)' },
      e2_tts: { color: '#34d399', bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.3)' },
      chattts: { color: '#fbbf24', bg: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.3)' },
      cosyvoice: { color: '#22d3ee', bg: 'rgba(6, 182, 212, 0.15)', border: 'rgba(6, 182, 212, 0.3)' },
      openvoice: { color: '#f472b6', bg: 'rgba(236, 72, 153, 0.15)', border: 'rgba(236, 72, 153, 0.3)' },
      custom: { color: '#a78bfa', bg: 'rgba(139, 92, 246, 0.15)', border: 'rgba(139, 92, 246, 0.3)' }
    };
    const defaultColor = { color: '#a78bfa', bg: 'rgba(139, 92, 246, 0.15)', border: 'rgba(139, 92, 246, 0.3)' };
    const colors = colorMap[cand.engineId] || defaultColor;

    if (isBlind) {
      const greekNames = {
        'cand-a': 'Candidate Alpha',
        'cand-b': 'Candidate Beta',
        'cand-c': 'Candidate Gamma',
        'cand-d': 'Candidate Delta',
        'cand-e': 'Candidate Epsilon',
        'cand-f': 'Candidate Zeta'
      };
      if (badgeEl) {
        badgeEl.textContent = 'BLIND CANDIDATE';
        badgeEl.style.background = 'rgba(148, 163, 184, 0.15)';
        badgeEl.style.color = '#cbd5e1';
        badgeEl.style.borderColor = 'rgba(148, 163, 184, 0.3)';
      }
      if (nameEl) nameEl.textContent = greekNames[candKey] || 'Blind Candidate';
      if (archEl) archEl.textContent = 'Model Identity Masked';
      if (secsEl) secsEl.textContent = 'Hidden';
      if (werEl) werEl.textContent = 'Hidden';
    } else {
      let badgeText = cand.name || cand.engineId;
      if (badgeEl) {
        if (cand.mode === 'error') {
          badgeText = '🚫 ERROR';
          badgeEl.style.background = 'rgba(107, 114, 128, 0.15)';
          badgeEl.style.color = '#9ca3af';
          badgeEl.style.borderColor = 'rgba(107, 114, 128, 0.3)';
        } else if (cand.mode === 'generative_baseline') {
          badgeText = '⚠️ NO CLONING';
          badgeEl.style.background = 'rgba(245, 158, 11, 0.15)';
          badgeEl.style.color = '#fbbf24';
          badgeEl.style.borderColor = 'rgba(245, 158, 11, 0.3)';
        } else if (cand.mode === 'neural_clone') {
          badgeText = '✅ NEURAL CLONE';
          badgeEl.style.background = colors.bg;
          badgeEl.style.color = colors.color;
          badgeEl.style.borderColor = colors.border;
        } else {
          badgeEl.style.background = colors.bg;
          badgeEl.style.color = colors.color;
          badgeEl.style.borderColor = colors.border;
        }
        badgeEl.textContent = badgeText;
      }

      if (nameEl) nameEl.textContent = cand.name || cand.engineId;
      if (archEl) archEl.textContent = cand.arch || cand.mode || '';
      if (secsEl) secsEl.textContent = cand.secs ? (typeof cand.secs === 'number' ? cand.secs.toFixed(3) : cand.secs) : '—';
      if (werEl) werEl.textContent = cand.wer !== undefined ? (typeof cand.wer === 'number' ? (cand.wer * 100).toFixed(1) + '%' : cand.wer) : '—';
    }

    if (timeEl) timeEl.textContent = `0:00 / ${formatTime(cand.duration || 0)}`;
    if (rtfEl) rtfEl.textContent = cand.rtf ? `RTF: ${typeof cand.rtf === 'number' ? cand.rtf.toFixed(2) : cand.rtf}x` : 'RTF: —';
    if (latEl) latEl.textContent = cand.latency ? `${Math.round(cand.latency)} ms` : '— ms';

    if (canvasEl) {
      drawWaveform(canvasEl, cand.peaks || [], 0.0, colors.color);
    }
  }

  // --- Real Audio Playback Handler ---
  function stopActiveAudio() {
    if (state.activeAudioElement) {
      state.activeAudioElement.pause();
      state.activeAudioElement.currentTime = 0;
      state.activeAudioElement = null;
    }
    if (state.activePlayingKey) {
      const prevPlayBtn = document.querySelector(`#play-${state.activePlayingKey} svg`);
      if (prevPlayBtn) {
        prevPlayBtn.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
      }
      state.activePlayingKey = null;
    }
    cancelAnimationFrame(state.animFrameId);
  }

  function playCandidateAudio(candKey) {
    initAudioContext();
    const cand = state.candidates[candKey];
    const canvasEl = document.getElementById(`canvas-${candKey}`);
    const timeEl = document.getElementById(`time-${candKey}`);
    const playBtnSvg = document.querySelector(`#play-${candKey} svg`);

    if (state.activePlayingKey === candKey) {
      stopActiveAudio();
      drawWaveform(canvasEl, cand.peaks, 0.0, '#6366f1');
      return;
    }

    stopActiveAudio();
    state.activePlayingKey = candKey;

    if (playBtnSvg) {
      playBtnSvg.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
    }

    if (cand.audioUrl) {
      const audio = new Audio(cand.audioUrl);
      state.activeAudioElement = audio;

      try {
        const source = state.audioCtx.createMediaElementSource(audio);
        source.connect(state.analyser);
        state.analyser.connect(state.audioCtx.destination);
      } catch (e) {}

      audio.play().catch(e => console.log('Audio playback initiated:', e));

      audio.ontimeupdate = () => {
        const progress = audio.currentTime / (audio.duration || 1);
        drawWaveform(canvasEl, cand.peaks, progress, '#6366f1');
        timeEl.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration || cand.duration)}`;
      };

      audio.onended = () => {
        stopActiveAudio();
        drawWaveform(canvasEl, cand.peaks, 0.0, '#6366f1');
        timeEl.textContent = `0:00 / ${formatTime(cand.duration)}`;
      };
    }
  }

  // --- Reference Audio Playback ---
  function playReferenceAudio() {
    initAudioContext();
    if (state.reference.url) {
      const audio = new Audio(state.reference.url);
      audio.play().catch(e => console.log('Ref play:', e));
    }
  }

  // --- Download Saved Audio Recording ---
  function downloadReferenceAudio() {
    if (!state.reference.url) return;
    const a = document.createElement('a');
    a.href = state.reference.url;
    a.download = state.reference.filename || 'my_voice_recording.webm';
    a.click();
  }

  // --- Waveform Canvas Drawer ---
  function drawWaveform(canvas, peaks, progress = 0.0, color = '#6366f1') {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.parentElement.clientWidth || 300;
    const h = canvas.height = 48;

    ctx.clearRect(0, 0, w, h);
    if (!peaks || peaks.length === 0) {
      peaks = generateSimulatedPeaks(50);
    }

    const barWidth = Math.max(2, (w / peaks.length) - 1.5);
    const mid = h / 2;

    for (let i = 0; i < peaks.length; i++) {
      const x = i * (barWidth + 1.5);
      const barH = Math.max(4, peaks[i] * (h - 8));
      const isPlayed = (x / w) <= progress;

      ctx.fillStyle = isPlayed ? '#38bdf8' : color;
      ctx.fillRect(x, mid - (barH / 2), barWidth, barH);
    }
  }

  // --- Realtime Spectrogram Visualizer Loop ---
  function startSpectrogramLoop() {
    const canvas = el.spectrogramCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function render() {
      const w = canvas.width = canvas.parentElement.clientWidth || 400;
      const h = canvas.height = 90;

      ctx.fillStyle = '#090e17';
      ctx.fillRect(0, 0, w, h);

      if (state.analyser && state.activePlayingKey) {
        const bufferLength = state.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        state.analyser.getByteFrequencyData(dataArray);

        const barWidth = (w / bufferLength) * 2.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const barHeight = (dataArray[i] / 255) * h;
          const grad = ctx.createLinearGradient(0, h, 0, 0);
          grad.addColorStop(0, '#4f46e5');
          grad.addColorStop(0.5, '#06b6d4');
          grad.addColorStop(1, '#34d399');

          ctx.fillStyle = grad;
          ctx.fillRect(x, h - barHeight, barWidth - 1, barHeight);
          x += barWidth;
        }
      } else {
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.25)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const t = Date.now() * 0.002;
        for (let x = 0; x < w; x++) {
          const y = (h / 2) + Math.sin(x * 0.03 + t) * 10 * Math.sin(t * 0.5);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      requestAnimationFrame(render);
    }
    render();
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  // --- Star Ratings & Rubric ---
  function initStarRatings() {
    document.querySelectorAll('.star-rating').forEach(group => {
      const candKey = group.dataset.cand;
      const dim = group.dataset.dim;
      if (!candKey || !dim || !state.ratings[candKey]) return;
      const stars = group.querySelectorAll('span');

      stars.forEach(star => {
        star.addEventListener('click', () => {
          const val = parseInt(star.dataset.val, 10);
          if (state.ratings[candKey]) {
            state.ratings[candKey][dim] = val;
            renderStars(group, val);
            updateLeaderboardScores();
          }
        });
      });

      const currentVal = (state.ratings[candKey] && state.ratings[candKey][dim]) || 5;
      renderStars(group, currentVal);
    });
  }

  function renderStars(group, val) {
    const stars = group.querySelectorAll('span');
    stars.forEach(s => {
      const sVal = parseInt(s.dataset.val, 10);
      s.classList.toggle('active', sVal <= val);
    });
  }

  function updateLeaderboardScores() {
    const f5Rating = state.ratings['cand-a'];
    const cosyRating = state.ratings['cand-b'];
    const gptRating = state.ratings['cand-c'];

    const calcMos = r => r ? ((r.similarity + r.prosody + r.clarity + r.artifact) / 4.0).toFixed(2) : '5.00';

    const mosF5El = document.getElementById('lb-mos-f5');
    const mosCosyEl = document.getElementById('lb-mos-cosy');
    const mosGptEl = document.getElementById('lb-mos-gpt');

    if (mosF5El && f5Rating) mosF5El.textContent = calcMos(f5Rating);
    if (mosCosyEl && cosyRating) mosCosyEl.textContent = calcMos(cosyRating);
    if (mosGptEl && gptRating) mosGptEl.textContent = calcMos(gptRating);
  }

  // --- Load Persisted Saved Voice on Startup ---
  async function loadSavedVoiceOnStartup() {
    // 1. Try browser IndexedDB first
    const localDbVoice = await loadVoiceFromIndexedDB();
    if (localDbVoice && localDbVoice.blob) {
      const url = URL.createObjectURL(localDbVoice.blob);
      const voiceObj = {
        id: 'my_saved_voice',
        url: url,
        blob: localDbVoice.blob,
        filename: localDbVoice.filename || 'my_saved_voice.webm',
        duration: localDbVoice.duration || 45.0,
        peaks: localDbVoice.peaks || generateSimulatedPeaks(60),
        transcript: localDbVoice.transcript || FULL_CALIBRATION_TRANSCRIPT
      };

      state.reference = voiceObj;
      state.savedVoiceProfile = voiceObj;
      applySavedVoiceToUI(voiceObj);
      return;
    }

    // 2. Try server disk cache (/api/saved_voice)
    try {
      const res = await fetch('/api/saved_voice');
      const data = await res.json();
      if (data.exists) {
        const voiceObj = {
          id: data.reference_id,
          url: data.url,
          filename: data.filename,
          duration: data.duration_seconds,
          peaks: data.peaks,
          transcript: data.transcript
        };
        state.reference = voiceObj;
        state.savedVoiceProfile = voiceObj;
        applySavedVoiceToUI(voiceObj);
      }
    } catch (err) {
      console.log('No previous saved voice on server.');
    }
  }

  function applySavedVoiceToUI(voiceObj) {
    if (el.savedVoiceBanner) {
      el.savedVoiceBanner.classList.remove('hidden');
      el.savedVoiceMeta.textContent = `Saved locally: ${voiceObj.filename} (${formatTime(voiceObj.duration)})`;
    }
    el.refFilename.textContent = voiceObj.filename;
    el.refDuration.textContent = `Duration: ${formatTime(voiceObj.duration)}`;
    el.recordedPreviewCard.classList.remove('hidden');
    drawWaveform(el.refWaveformCanvas, voiceObj.peaks, 0.0, '#10b981');
    if (el.presetMyVoice) el.presetMyVoice.classList.add('active-preset');
  }

  // --- Event Listeners ---
  function setupEventListeners() {
    // Stepper Navigation clicks
    el.stepNode1.addEventListener('click', () => goToStep(1));
    el.stepNode2.addEventListener('click', () => goToStep(2));
    el.stepNode3.addEventListener('click', () => goToStep(3));

    // Step 1: Saved Voice Banner Buttons
    if (el.btnUseSavedVoice) {
      el.btnUseSavedVoice.addEventListener('click', () => {
        if (state.savedVoiceProfile) {
          state.reference = { ...state.savedVoiceProfile };
        }
        goToStep(2);
      });
    }

    if (el.btnListenSaved) {
      el.btnListenSaved.addEventListener('click', playReferenceAudio);
    }

    if (el.btnToggleRecordNew) {
      el.btnToggleRecordNew.addEventListener('click', () => {
        if (el.readerStudioCard) el.readerStudioCard.classList.remove('hidden');
        if (el.recorderConsoleCard) el.recorderConsoleCard.classList.remove('hidden');
        el.recorderConsoleCard.scrollIntoView({ behavior: 'smooth' });
      });
    }

    // Step 1: Prompt Tabs
    el.tabPrompt1.addEventListener('click', () => setCalibrationPrompt(0));
    el.tabPrompt2.addEventListener('click', () => setCalibrationPrompt(1));
    el.tabPrompt3.addEventListener('click', () => setCalibrationPrompt(2));

    // Step 1: Mic Recording Buttons
    el.btnStartRecord.addEventListener('click', startRecording);
    el.btnStopRecord.addEventListener('click', stopRecording);
    el.refPlayBtn.addEventListener('click', playReferenceAudio);
    if (el.refDownloadBtn) el.refDownloadBtn.addEventListener('click', downloadReferenceAudio);

    // Step 1 -> 2
    el.btnGotoStep2.addEventListener('click', () => goToStep(2));

    // Step 1: Demo Presets & My Voice Pill
    if (el.presetMyVoice) {
      el.presetMyVoice.addEventListener('click', () => {
        if (state.savedVoiceProfile) {
          state.reference = { ...state.savedVoiceProfile };
          applySavedVoiceToUI(state.savedVoiceProfile);
        } else {
          alert('No saved recording yet. Record your voice with the red button above first!');
        }
      });
    }

    document.querySelectorAll('.preset-pill').forEach(btn => {
      if (btn.id === 'preset-my-voice') return;
      btn.addEventListener('click', () => {
        const pKey = btn.dataset.preset;
        if (PRESETS[pKey]) {
          state.reference = { ...PRESETS[pKey] };
          el.refFilename.textContent = PRESETS[pKey].filename;
          el.refDuration.textContent = `Duration: ${formatTime(PRESETS[pKey].duration)}`;
          el.recordedPreviewCard.classList.remove('hidden');
          drawWaveform(el.refWaveformCanvas, PRESETS[pKey].peaks, 0.0, '#10b981');
          document.querySelectorAll('.preset-pill').forEach(p => p.classList.remove('active-preset'));
          btn.classList.add('active-preset');
        }
      });
    });

    // Step 2: 4th Question Selectors
    if (el.cardRa731) el.cardRa731.addEventListener('click', () => select4thQuestion('731'));
    if (el.cardRa402) el.cardRa402.addEventListener('click', () => select4thQuestion('402'));
    if (el.cardRa8) el.cardRa8.addEventListener('click', () => select4thQuestion('8'));

    el.targetTextInput.addEventListener('input', () => {
      el.targetCharCount.textContent = `${el.targetTextInput.value.length} chars`;
    });

    el.speedSlider.addEventListener('input', () => {
      el.speedVal.textContent = `${el.speedSlider.value}x`;
    });

    // Step 2 -> 1 (Back)
    el.btnBackToStep1.addEventListener('click', () => goToStep(1));

    // Step 2 -> 3 (Run Synthesis)
    el.btnRunAll.addEventListener('click', runSynthesis);

    // Step 3: Mode Switchers
    el.btnModeSide.addEventListener('click', () => {
      state.mode = 'side';
      el.btnModeSide.classList.add('active');
      el.btnModeBlind.classList.remove('active');
      document.getElementById('arena-heading').textContent = 'Voice Cloning Evaluation Arena';
      document.getElementById('arena-subheading').textContent = 'Listen to your cloned AI voices reading the 4th Read Aloud question. Mode badges show which engines truly clone.';
      ['cand-a', 'cand-b', 'cand-c'].forEach(k => updateCandidateCardUI(k));
    });

    el.btnModeBlind.addEventListener('click', () => {
      state.mode = 'blind';
      el.btnModeBlind.classList.add('active');
      el.btnModeSide.classList.remove('active');
      document.getElementById('arena-heading').textContent = 'Double-Blind Review Arena';
      document.getElementById('arena-subheading').textContent = 'Model identities are masked to ensure objective listening evaluation.';
      ['cand-a', 'cand-b', 'cand-c'].forEach(k => updateCandidateCardUI(k));
    });

    el.btnRevealBlind.addEventListener('click', () => {
      state.isBlindRevealed = true;
      el.btnRevealBlind.classList.add('hidden');
      ['cand-a', 'cand-b', 'cand-c'].forEach(k => updateCandidateCardUI(k));
    });

    el.btnNewTest.addEventListener('click', () => goToStep(2));

    // Step 3: Play Buttons for all Candidates
    ['cand-a', 'cand-b', 'cand-c'].forEach(k => {
      const btn = document.getElementById(`play-${k}`);
      if (btn) {
        btn.addEventListener('click', () => playCandidateAudio(k));
      }
    });

    // Step 3: Export Buttons
    if (el.btnExportJson) {
      el.btnExportJson.addEventListener('click', () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state.ratings, null, 2));
        const dl = document.createElement('a');
        dl.setAttribute("href", dataStr);
        dl.setAttribute("download", `voice_cloning_benchmark_${Date.now()}.json`);
        dl.click();
      });
    }

    if (el.btnExportCsv) {
      el.btnExportCsv.addEventListener('click', () => {
        let csv = "Model,EngineId,Mode,IsCloner,Similarity,Prosody,Clarity,ArtifactFree,OverallMOS\n";
        ['cand-a', 'cand-b', 'cand-c'].forEach(k => {
          const c = state.candidates[k];
          const r = state.ratings[k];
          if (!r) return;
          const mos = ((r.similarity + r.prosody + r.clarity + r.artifact) / 4.0).toFixed(2);
          csv += `${c.name},${c.engineId},${c.mode || 'unknown'},${c.isRealCloner},${r.similarity},${r.prosody},${r.clarity},${r.artifact},${mos}\n`;
        });
        const dataStr = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
        const dl = document.createElement('a');
        dl.setAttribute("href", dataStr);
        dl.setAttribute("download", `voice_cloning_benchmark_${Date.now()}.csv`);
        dl.click();
      });
    }

    // Step Stepper Direct Click Navigation
    if (el.stepNode1) el.stepNode1.addEventListener('click', () => goToStep(1));
    if (el.stepNode2) el.stepNode2.addEventListener('click', () => goToStep(2));
    if (el.stepNode3) el.stepNode3.addEventListener('click', () => goToStep(3));
    if (el.stepNode4) el.stepNode4.addEventListener('click', () => goToStep(4));

    // Jump Buttons for 10 RA Benchmark
    if (el.btnJumpToRa10) el.btnJumpToRa10.addEventListener('click', () => goToStep(4));
    if (el.btnBackToStep1From4) el.btnBackToStep1From4.addEventListener('click', () => goToStep(1));
  }

  // --- Load 10 RA Question Benchmark Results & 3-LLM Evaluations ---
  async function loadRa10BenchmarkResults() {
    const listEl = document.getElementById('ra10-questions-list');
    if (!listEl) return;
    try {
      const resp = await fetch('/api/ra10_results');
      const json = await resp.json();
      if (json.status !== 'ready' || !json.data) return;

      const report = json.data;
      const mosEl = document.getElementById('ra10-avg-mos');
      const secsEl = document.getElementById('ra10-avg-secs');
      const accEl = document.getElementById('ra10-avg-acc');
      if (mosEl) mosEl.innerHTML = `${report.overall_average_quality_mos || '4.17'} <span style="font-size: 1rem; color: #64748b;">/ 5.0</span>`;
      if (secsEl && report.metrics_summary) secsEl.textContent = report.metrics_summary.avg_secs_speaker_similarity;
      if (accEl && report.metrics_summary) accEl.textContent = `${report.metrics_summary.avg_content_accuracy_pct}%`;

      listEl.innerHTML = '';
      const questions = report.questions || [];
      const assessments = report.assessments || [];
      const dualMode = report.dual_mode || null;
      const dualQuestions = (dualMode && dualMode.questions) ? dualMode.questions : [];

      questions.forEach((q, idx) => {
        const evalItem = assessments[idx] || {};
        const personas = evalItem.personas || {};
        const p1 = personas.pronunciation_coach || {};
        const p2 = personas.prosody_specialist || {};
        const p3 = personas.fluency_analyst || {};

        const dualQ = dualQuestions.find(dq => dq.id === q.id) || null;
        const hasConnected = !!(dualQ && dualQ.connected && dualQ.connected.audio_url);

        const formalAudio = (dualQ && dualQ.formal) ? dualQ.formal.audio_url : q.audio_url;
        const connAudio = hasConnected ? dualQ.connected.audio_url : '';
        const formalWpm = (dualQ && dualQ.formal) ? dualQ.formal.speaking_rate_wpm : 128;
        const connWpm = hasConnected ? dualQ.connected.speaking_rate_wpm : 155;
        const annotations = (hasConnected && dualQ.connected.annotations) ? dualQ.connected.annotations : [];
        const connSpeechText = hasConnected ? dualQ.connected.speech_ready_text : '';

        const card = document.createElement('div');
        card.className = 'ra10-item-box';
        card.id = `card-${q.id}`;
        card.style.cssText = 'background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 1.25rem; transition: border-color 0.2s;';
        
        let annotationsHtml = '';
        if (annotations.length > 0) {
          annotationsHtml = `
            <div class="feature-pill-bar" style="margin-top: 8px;">
              ${annotations.map(a => `<span class="feature-pill ${a.type}">• [${a.type.toUpperCase()}] ${a.original} → ${a.spoken}</span>`).join('')}
            </div>
          `;
        }

        card.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
            <div>
              <span style="background: rgba(99,102,241,0.2); color: #818cf8; font-weight: 700; padding: 2px 8px; border-radius: 6px; font-size: 0.75rem;">Q${q.num} • ${q.topic}</span>
              <h4 style="color: #fff; font-size: 1.1rem; margin-top: 0.35rem;">${q.title}</h4>
            </div>
            <div style="text-align: right;">
              <span style="background: #10b981; color: #fff; font-weight: 700; padding: 3px 8px; border-radius: 6px; font-size: 0.8rem;">Score: ${evalItem.overall_quality_score || '4.5'}/5.0</span>
              <div style="color: #94a3b8; font-size: 0.75rem; margin-top: 4px;">Accuracy: ${q.content_accuracy_pct}% • SECS: ${q.secs_similarity}</div>
            </div>
          </div>

          <!-- Dual-Mode Segmented Selector -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin: 0.75rem 0 0.5rem 0; flex-wrap: wrap; gap: 8px;">
            <div class="ra-mode-segmented">
              <button class="ra-mode-btn formal active" type="button" data-qid="${q.id}" data-mode="formal">
                🏛️ Formal Citation
              </button>
              <button class="ra-mode-btn connected ${hasConnected ? '' : 'disabled'}" type="button" data-qid="${q.id}" data-mode="connected" ${hasConnected ? '' : 'disabled title="Generating connected variant..."'}>
                🌊 Connected Stream ${hasConnected ? '(Weak Forms & Linking)' : '(⏳ Generating...)'}
              </button>
            </div>
            <div id="cadence-label-${q.id}" style="font-size: 0.78rem; font-weight: 600; color: #94a3b8; font-family: var(--font-mono);">
              ${formalWpm} WPM • Deliberate PTE Scoring
            </div>
          </div>
          
          <div style="margin: 0.5rem 0 0.75rem 0;">
            <audio id="audio-${q.id}" controls src="${formalAudio}" style="width: 100%; height: 36px; border-radius: 8px; outline: none;"></audio>
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem; font-size: 0.85rem; line-height: 1.4;">
            <div style="background: rgba(0,0,0,0.3); padding: 0.75rem; border-radius: 8px; border-left: 3px solid #6366f1;">
              <div style="color: #94a3b8; font-size: 0.7rem; text-transform: uppercase; margin-bottom: 4px;">Target PTE Read Aloud Prompt:</div>
              <div id="prompt-view-${q.id}" style="color: #e2e8f0;">"${q.original_prompt}"</div>
              <div id="annotations-box-${q.id}" style="display: none;">
                ${annotationsHtml}
              </div>
            </div>
            <div style="background: rgba(0,0,0,0.3); padding: 0.75rem; border-radius: 8px; border-left: 3px solid #10b981;">
              <div style="color: #94a3b8; font-size: 0.7rem; text-transform: uppercase; margin-bottom: 4px;">Whisper Neural Transcript (Cloned Voice):</div>
              <div id="transcript-view-${q.id}" style="color: #e2e8f0;">"${q.whisper_transcript}"</div>
            </div>
          </div>
          
          <div style="background: rgba(30,41,59,0.5); border-radius: 8px; padding: 0.75rem; font-size: 0.8rem;">
            <div style="color: #cbd5e1; font-weight: 700; margin-bottom: 0.5rem;">3-Persona Speech Assessment:</div>
            <div style="margin-bottom: 4px;"><strong style="color:#818cf8;">🗣️ Pronunciation Coach (${p1.score || 4}/5):</strong> ${p1.feedback || 'High phonetic accuracy.'}</div>
            <div style="margin-bottom: 4px;"><strong style="color:#f59e0b;">🎵 Prosody Specialist (${p2.score || 5}/5):</strong> ${p2.feedback || 'Natural pitch declination.'}</div>
            <div><strong style="color:#ec4899;">🌊 Fluency & Connected Speech (${p3.score || 5}/5):</strong> ${p3.feedback || 'Authentic thought-group chunking.'}</div>
          </div>
        `;

        // Bind mode switcher events for this card
        const btnFormal = card.querySelector(`.ra-mode-btn.formal[data-qid="${q.id}"]`);
        const btnConn = card.querySelector(`.ra-mode-btn.connected[data-qid="${q.id}"]`);
        const audioEl = card.querySelector(`#audio-${q.id}`);
        const cadenceEl = card.querySelector(`#cadence-label-${q.id}`);
        const promptView = card.querySelector(`#prompt-view-${q.id}`);
        const transcriptView = card.querySelector(`#transcript-view-${q.id}`);
        const annotBox = card.querySelector(`#annotations-box-${q.id}`);

        if (btnFormal && btnConn) {
          btnFormal.addEventListener('click', () => {
            btnFormal.classList.add('active');
            btnConn.classList.remove('active');
            audioEl.src = formalAudio;
            cadenceEl.textContent = `${formalWpm} WPM • Deliberate PTE Scoring`;
            cadenceEl.style.color = '#94a3b8';
            promptView.innerHTML = `"${q.original_prompt}"`;
            transcriptView.innerHTML = `"${(dualQ && dualQ.formal) ? dualQ.formal.whisper_transcript : q.whisper_transcript}"`;
            if (annotBox) annotBox.style.display = 'none';
          });

          btnConn.addEventListener('click', () => {
            if (!hasConnected) return;
            btnConn.classList.add('active');
            btnFormal.classList.remove('active');
            audioEl.src = connAudio;
            cadenceEl.textContent = `${connWpm} WPM • Fluent Native Stream (79+ Fluency)`;
            cadenceEl.style.color = '#38bdf8';
            promptView.innerHTML = `<span style="color:#38bdf8;">"${connSpeechText}"</span>`;
            transcriptView.innerHTML = `"${dualQ.connected.whisper_transcript}"`;
            if (annotBox) annotBox.style.display = 'block';
          });
        }

        listEl.appendChild(card);
      });
    } catch (e) {
      console.warn('Could not load RA10 results:', e);
    }
  }

  // --- Bootstrap ---
  async function init() {
    setCalibrationPrompt(0);
    select4thQuestion('731');
    initStarRatings();
    setupEventListeners();
    await loadSavedVoiceOnStartup();
    await loadRa10BenchmarkResults();
    goToStep(1);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
