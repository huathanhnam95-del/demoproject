class AsqMode {
  constructor() {
    this.isActive = false;
    this.isInitialized = false;
    this.database = [];
    this.audioManifest = null;
    this.currentId = null;
    this.audioStream = null;
    this.mediaRecorder = null;
    this.recordedBlobUrl = null;
  }

  getRecordingSupportState() {
    const hasGetUserMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const hasMediaRecorder = typeof window.MediaRecorder === 'function';
    const hasAudioContext = typeof window.AudioContext === 'function' || typeof window.webkitAudioContext === 'function';
    const hasOfflineAudioContext = typeof window.OfflineAudioContext === 'function';
    return {
      supported: hasGetUserMedia && hasMediaRecorder && hasAudioContext && hasOfflineAudioContext
    };
  }

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

  populateQuestionSelect() {
    const select = document.getElementById('asq-question-select');
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

  getCurrentItem() {
    return this.database.find((item) => item.id === this.currentId) || null;
  }

  setStatus(message, tone = 'muted') {
    const el = document.getElementById('asq-status-message');
    if (!el) return;
    el.textContent = String(message || '');
    if (tone === 'error') el.style.color = '#b91c1c';
    else if (tone === 'success') el.style.color = '#166534';
    else el.style.color = 'var(--text-muted)';
  }

  setPromptAudioForCurrent() {
    const audioEl = document.getElementById('asq-prompt-audio');
    if (!audioEl) return;
    const src = this.getAudioSrcForId(this.currentId);
    audioEl.src = src || '';
    audioEl.load();
  }

  playPrompt() {
    const audioEl = document.getElementById('asq-prompt-audio');
    const playBtn = document.getElementById('asq-play-prompt-btn');
    if (!audioEl) return;
    if (!audioEl.src) {
      this.setStatus('Prompt audio is not available yet for this question.', 'error');
      return;
    }

    if (audioEl.paused) {
      audioEl.play().catch(() => { });
      if (playBtn) playBtn.textContent = 'Pause';
      audioEl.onended = () => {
        if (playBtn) playBtn.textContent = 'Play';
      };
      return;
    }

    audioEl.pause();
    if (playBtn) playBtn.textContent = 'Play';
  }

  stopTracks(stream) {
    try {
      (stream?.getTracks?.() || []).forEach((track) => track.stop());
    } catch (_) { }
  }

  stopMediaStream() {
    if (this.audioStream) {
      this.stopTracks(this.audioStream);
      this.audioStream = null;
    }
  }

  clearRecordedAudio() {
    const box = document.getElementById('asq-user-audio-box');
    const audioEl = document.getElementById('asq-user-recording-audio');
    if (audioEl) {
      audioEl.pause();
      audioEl.removeAttribute('src');
      audioEl.load();
    }
    if (box) box.style.display = 'none';
    if (this.recordedBlobUrl) {
      try { URL.revokeObjectURL(this.recordedBlobUrl); } catch (_) { }
      this.recordedBlobUrl = null;
    }
  }

  showRecordedAudio(blob) {
    const box = document.getElementById('asq-user-audio-box');
    const audioEl = document.getElementById('asq-user-recording-audio');
    if (!box || !audioEl) return;
    this.clearRecordedAudio();
    const url = URL.createObjectURL(blob);
    this.recordedBlobUrl = url;
    audioEl.src = url;
    box.style.display = 'block';
  }

  showResult({ isCorrect, transcript, answerDisplay, xpEarned }) {
    const box = document.getElementById('asq-result-box');
    const statusEl = document.getElementById('asq-result-status');
    const transcriptEl = document.getElementById('asq-transcript-feedback');
    const answersEl = document.getElementById('asq-correct-answers');
    if (!box || !statusEl || !transcriptEl || !answersEl) return;

    box.style.display = 'block';
    statusEl.textContent = isCorrect ? 'Correct' : 'Incorrect';
    statusEl.style.color = isCorrect ? '#166534' : '#b91c1c';

    const xpText = Number.isFinite(Number(xpEarned)) ? ` (+${Number(xpEarned)} XP)` : '';
    if (xpText) {
      statusEl.textContent = `${statusEl.textContent}${xpText}`;
    }

    transcriptEl.innerHTML = `You said: <i>"${String(transcript || '').trim() || 'Nothing detected'}"</i>`;
    answersEl.textContent = answerDisplay ? `Accepted answers: ${answerDisplay}` : '';
  }

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

  async prepareWavBlob(blob) {
    if (blob.type === 'audio/wav' || blob.type === 'audio/wave') return blob;
    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    if (typeof audioContext.close === 'function') await audioContext.close().catch(() => { });
    return this.audioBufferToWav(rendered);
  }

  audioBufferToWav(buffer) {
    const channelData = buffer.getChannelData(0);
    const dataLength = channelData.length;
    const wavBuffer = new ArrayBuffer(44 + dataLength * 2);
    const view = new DataView(wavBuffer);
    const writeString = (offset, value) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
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
    for (let i = 0; i < dataLength; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
    return new Blob([wavBuffer], { type: 'audio/wav' });
  }

  async transcribeRecording(rawBlob) {
    const wavBlob = await this.prepareWavBlob(rawBlob);
    const formData = new FormData();
    formData.append('audio', wavBlob, 'recording.wav');
    const response = await fetch('/api/asq/transcribe', { method: 'POST', body: formData });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      const error = new Error(payload?.message || 'Transcription failed.');
      error.code = payload?.error || null;
      throw error;
    }
    return String(payload?.data?.transcript || payload?.transcript || '').trim();
  }

  async startRecording() {
    const recordBtn = document.getElementById('asq-record-btn');
    const stopBtn = document.getElementById('asq-stop-btn');
    const resultBox = document.getElementById('asq-result-box');
    if (resultBox) resultBox.style.display = 'none';
    this.clearRecordedAudio();

    const support = this.getRecordingSupportState();
    if (!support.supported) {
      this.setStatus('Recording is not supported in this browser.', 'error');
      return;
    }

    this.setStatus('Recording...', 'muted');
    if (recordBtn) recordBtn.disabled = true;
    if (stopBtn) {
      stopBtn.style.display = '';
      stopBtn.disabled = false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recordedChunks = [];
      const recorder = new window.MediaRecorder(stream);
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) recordedChunks.push(event.data);
      });
      recorder.addEventListener('stop', async () => {
        this.stopMediaStream();
        this.mediaRecorder = null;

        if (recordBtn) recordBtn.disabled = false;
        if (stopBtn) stopBtn.style.display = 'none';

        if (recordedChunks.length === 0) {
          this.setStatus('We could not capture that recording. Please try again.', 'error');
          return;
        }

        const rawBlob = new Blob(recordedChunks, { type: recorder.mimeType || 'audio/webm' });
        this.showRecordedAudio(rawBlob);

        try {
          this.setStatus('Transcribing...', 'muted');
          const transcript = await this.transcribeRecording(rawBlob);
          const item = this.getCurrentItem();
          const localCheck = this.isTranscriptCorrect(transcript, item?.acceptedAnswers || []);

          let xpEarned = null;
          const scoringResult = await window.handleDualTrackScoring?.('asq', item?.id, transcript);
          if (scoringResult && scoringResult.success) {
            xpEarned = scoringResult.xpEarned;
          }

          this.showResult({
            isCorrect: localCheck.ok,
            transcript,
            answerDisplay: item?.answerDisplay || '',
            xpEarned
          });

          this.setStatus(localCheck.ok ? 'Nice. Keep it short and clear.' : 'Try again and say one of the accepted answers.', localCheck.ok ? 'success' : 'error');
        } catch (error) {
          console.error('[ASQ] Transcription/scoring failed:', error);
          this.setStatus('Transcription failed. Please try again.', 'error');
        }
      });

      this.audioStream = stream;
      this.mediaRecorder = recorder;
      recorder.start();
    } catch (error) {
      console.error('[ASQ] Microphone error:', error);
      if (recordBtn) recordBtn.disabled = false;
      if (stopBtn) stopBtn.style.display = 'none';
      this.setStatus('Microphone access failed. Please allow mic permission and try again.', 'error');
      this.stopMediaStream();
      this.mediaRecorder = null;
    }
  }

  stopRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      try { this.mediaRecorder.stop(); } catch (_) { }
    }
  }

  async setQuestionById(id) {
    this.currentId = String(id || '').trim() || null;
    if (!this.currentId) return;
    this.setPromptAudioForCurrent();
  }

  async onEnter() {
    this.isActive = true;
    if (!this.isInitialized) {
      await this.init();
    }
    this.setStatus('Play the prompt audio, then record your answer.', 'muted');
  }

  async init() {
    this.isInitialized = true;

    const playBtn = document.getElementById('asq-play-prompt-btn');
    const select = document.getElementById('asq-question-select');
    const recordBtn = document.getElementById('asq-record-btn');
    const stopBtn = document.getElementById('asq-stop-btn');

    if (playBtn) playBtn.addEventListener('click', () => this.playPrompt());
    if (recordBtn) recordBtn.addEventListener('click', () => this.startRecording());
    if (stopBtn) stopBtn.addEventListener('click', () => this.stopRecording());
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
});

