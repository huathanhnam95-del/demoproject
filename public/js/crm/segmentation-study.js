(function () {
  'use strict';

  const STUDY_VERSION = 'study-v1';
  const STUDY_API_VERSION = 'v1';
  const OPERATOR_KEY = 'bel.segmentation-study.operator-name';
  const SESSION_KEY = 'bel.segmentation-study.session-id';
  const CLAIM_HEARTBEAT_MS = 2 * 60 * 1000;

  let initialized = false;
  let elements = null;
  let state = {
    mode: 'record',
    operatorName: '',
    sessionId: '',
    manifest: [],
    tasks: [],
    previousSamples: [],
    progress: {},
    task: null,
    audioBlob: null,
    audioUrl: null,
    comparison: null,
    manualBoundaries: [],
    manualSegments: [],
    selectedBoundaryIndex: -1,
    activeVersion: 'v2',
    recording: false,
    stream: null,
    audioContext: null,
    sourceNode: null,
    processor: null,
    rawChunks: [],
    heartbeatId: null,
    waveSurfer: null,
    regions: null,
    spectrogram: null,
    timeline: null,
    manualReviewSaved: false,
    analysisFailed: false,
    playTimer: null
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function getElements() {
    return {
      workspace: byId('segmentation-study-workspace'),
      operator: byId('segmentation-study-operator'),
      identityStatus: byId('segmentation-study-identity-status'),
      modes: Array.from(document.querySelectorAll('[data-study-mode]')),
      stats: {
        available: byId('segmentation-study-available'),
        reserved: byId('segmentation-study-reserved'),
        completed: byId('segmentation-study-completed'),
        uncertain: byId('segmentation-study-uncertain'),
        failed: byId('segmentation-study-failed')
      },
      claim: byId('segmentation-study-claim'),
      release: byId('segmentation-study-release'),
      refresh: byId('segmentation-study-refresh'),
      status: byId('segmentation-study-status'),
      queue: byId('segmentation-study-queue'),
      step: byId('segmentation-study-step'),
      word: byId('segmentation-study-word'),
      reference: byId('segmentation-study-reference'),
      claimStatus: byId('segmentation-study-claim-status'),
      record: byId('segmentation-study-record'),
      stop: byId('segmentation-study-stop'),
      redo: byId('segmentation-study-redo'),
      audio: byId('segmentation-study-audio'),
      playbackSpeed: byId('segmentation-study-playback-speed'),
      recordStatus: byId('segmentation-study-record-status'),
      analyze: byId('segmentation-study-analyze'),
      analysisStatus: byId('segmentation-study-analysis-status'),
      tabs: Array.from(document.querySelectorAll('[data-study-version]')),
      waveform: byId('segmentation-study-waveform'),
      spectrogram: byId('segmentation-study-spectrogram'),
      timelineRuler: byId('segmentation-study-time-ruler'),
      timeline: byId('segmentation-study-timeline'),
      timelineEmpty: byId('segmentation-study-timeline-empty'),
      panels: {
        v2: byId('segmentation-study-panel-v2'),
        v3: byId('segmentation-study-panel-v3'),
        v4: byId('segmentation-study-panel-v4'),
        manual: byId('segmentation-study-panel-manual')
      },
      manualInstructions: byId('segmentation-study-manual-instructions'),
      manualSummary: byId('segmentation-study-manual-summary'),
      manualUndo: byId('segmentation-study-manual-undo'),
      manualClear: byId('segmentation-study-manual-clear'),
      manualCount: byId('segmentation-study-manual-count'),
      certainty: () => document.querySelector('input[name="segmentation-study-certainty"]:checked'),
      summary: byId('segmentation-study-summary'),
      save: byId('segmentation-study-save'),
      next: byId('segmentation-study-next')
    };
  }

  function readSessionId() {
    let value = '';
    try { value = sessionStorage.getItem(SESSION_KEY) || ''; } catch (_) { /* local-only fallback */ }
    if (!/^[a-z0-9-]{12,80}$/i.test(value)) {
      value = `crm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      try { sessionStorage.setItem(SESSION_KEY, value); } catch (_) { /* ignore */ }
    }
    return value;
  }

  function readOperatorName() {
    try { return String(localStorage.getItem(OPERATOR_KEY) || '').trim().slice(0, 80); } catch (_) { return ''; }
  }

  function saveOperatorName(value) {
    const normalized = String(value || '').trim().slice(0, 80);
    state.operatorName = normalized;
    try { localStorage.setItem(OPERATOR_KEY, normalized); } catch (_) { /* ignore */ }
    if (elements.identityStatus) {
      elements.identityStatus.textContent = normalized ? `Working as ${normalized}` : 'Enter your name to join.';
    }
    updateButtons();
  }

  async function apiFetch(path, options = {}) {
    const user = window.firebase?.auth?.().currentUser;
    if (!user) throw new Error('Please log in as admin first.');
    const token = await user.getIdToken();
    const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
    const response = await fetch(path, { ...options, headers, cache: 'no-store' });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) {
      const error = new Error(payload?.message || `Request failed (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload?.data || payload || {};
  }

  function studyApiPath(suffix = '') {
    const normalizedSuffix = String(suffix || '').replace(/^\/+/, '');
    const base = `/api/admin/dev/segmentation-study/${STUDY_API_VERSION}`;
    return normalizedSuffix ? `${base}/${normalizedSuffix}` : base;
  }

  function setStatus(message, tone = '') {
    if (!elements.status) return;
    elements.status.textContent = message;
    elements.status.dataset.tone = tone;
  }

  function setAnalysisStatus(message, tone = '') {
    if (!elements.analysisStatus) return;
    elements.analysisStatus.textContent = message;
    elements.analysisStatus.dataset.tone = tone;
  }

  function normalizeTask(task) {
    if (!task || typeof task !== 'object') return null;
    return {
      ...task,
      taskId: String(task.taskId || task.id || '').trim(),
      targetWord: String(task.targetWord || task.word || '').trim(),
      referenceIpa: String(task.referenceIpa || task.ipa || '').trim(),
      referenceSyllableIpa: Array.isArray(task.referenceSyllableIpa) ? task.referenceSyllableIpa : [],
      targetSyllableCount: Number(task.targetSyllableCount || task.syllableCount || 0),
      mode: task.mode || state.mode
    };
  }

  function normalizePayload(payload) {
    const data = payload?.data || payload || {};
    state.manifest = Array.isArray(data.manifest) ? data.manifest : state.manifest;
    state.tasks = (Array.isArray(data.tasks) ? data.tasks : []).map(normalizeTask).filter(Boolean);
    state.previousSamples = (Array.isArray(data.previousSamples) ? data.previousSamples : []).map((sample) => ({
      ...sample,
      taskId: String(sample.taskId || sample.sampleId || sample.id || '').trim(),
      targetWord: String(sample.targetWord || '').trim(),
      referenceIpa: String(sample.referenceIpa || '').trim(),
      referenceSyllableIpa: Array.isArray(sample.referenceSyllableIpa) ? sample.referenceSyllableIpa : [],
      targetSyllableCount: Number(sample.targetSyllableCount || sample.expectedObservedCount || 0)
    }));
    state.progress = data.progress || {};
    state.task = normalizeTask(data.currentClaim || data.claim || state.task);
  }

  function renderStats() {
    const progress = state.progress || {};
    const values = {
      available: progress.available ?? state.tasks.filter((task) => task.status === 'available').length,
      reserved: progress.reserved ?? state.tasks.filter((task) => task.status === 'reserved').length,
      completed: progress.completed ?? state.tasks.filter((task) => task.status === 'completed').length,
      uncertain: progress.uncertain ?? 0,
      failed: progress.failed ?? state.tasks.filter((task) => task.status === 'analysis_failed').length
    };
    Object.entries(values).forEach(([key, value]) => {
      if (elements.stats[key]) elements.stats[key].textContent = String(value);
    });
  }

  function renderQueue() {
    if (!elements.queue) return;
    const items = state.mode === 'previous' ? state.previousSamples : state.tasks;
    elements.queue.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'crm-muted';
      empty.textContent = state.mode === 'previous' ? 'No previous samples are waiting for review.' : 'No study tasks loaded.';
      elements.queue.appendChild(empty);
      return;
    }
    items.forEach((item) => {
      const li = document.createElement('li');
      li.dataset.taskId = String(item.taskId || '');
      const status = String(item.status || item.reviewStatus || 'available').replaceAll('_', ' ');
      li.textContent = `${item.targetWord || 'Unnamed'} · ${item.targetSyllableCount || '?'} syllables · ${status}`;
      if (state.task?.taskId && state.task.taskId === item.taskId) li.classList.add('is-current');
      li.tabIndex = 0;
      li.addEventListener('click', () => state.mode === 'previous' ? openPreviousSample(item) : setStatus('Use Claim next word to reserve a study task.'));
      li.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); li.click(); } });
      elements.queue.appendChild(li);
    });
  }

  function updateButtons() {
    const hasTask = Boolean(state.task?.taskId);
    const hasAudio = Boolean(state.audioBlob);
    const hasAnalysis = Boolean(state.comparison);
    const completeManual = state.manualSegments.length === Number(state.task?.targetSyllableCount || 0);
    const certainty = elements?.certainty?.()?.value || '';
    const canSave = hasTask && hasAudio && (state.mode === 'previous' || hasAnalysis || state.analysisFailed) && completeManual && Boolean(certainty) && !state.manualReviewSaved;
    if (elements.claim) elements.claim.disabled = !state.operatorName || hasTask || state.mode === 'previous';
    if (elements.release) elements.release.disabled = !hasTask || state.mode === 'previous';
    if (elements.record) elements.record.disabled = !hasTask || state.mode === 'previous' || state.recording;
    if (elements.stop) elements.stop.disabled = !state.recording;
    if (elements.redo) elements.redo.disabled = !hasAudio || state.recording;
    if (elements.analyze) elements.analyze.disabled = !hasAudio || state.recording;
    if (elements.save) elements.save.disabled = !canSave;
    if (elements.next) elements.next.disabled = !state.manualReviewSaved;
    if (elements.manualUndo) elements.manualUndo.disabled = !state.manualBoundaries.length;
    if (elements.manualClear) elements.manualClear.disabled = !state.manualBoundaries.length;
  }

  function clearCertainty() {
    document.querySelectorAll('input[name="segmentation-study-certainty"]').forEach((input) => { input.checked = false; });
  }

  function resetTaskState() {
    stopHeartbeat();
    cleanupRecording();
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.audioBlob = null;
    state.audioUrl = null;
    state.comparison = null;
    state.analysisFailed = false;
    state.manualBoundaries = [];
    state.manualSegments = [];
    state.selectedBoundaryIndex = -1;
    state.manualReviewSaved = false;
    clearCertainty();
    if (elements.audio) { elements.audio.hidden = true; elements.audio.removeAttribute('src'); }
    if (elements.word) elements.word.textContent = 'No word claimed';
    if (elements.reference) elements.reference.textContent = 'The selected word and IPA will appear here.';
    if (elements.claimStatus) elements.claimStatus.textContent = 'Not reserved';
    if (elements.summary) elements.summary.textContent = '';
    if (elements.timelineEmpty) elements.timelineEmpty.hidden = false;
    clearRegions();
    updateManualUi();
  }

  function renderTask() {
    const task = state.task;
    if (!task) { resetTaskState(); updateButtons(); return; }
    if (elements.word) elements.word.textContent = task.targetWord || 'Unnamed word';
    if (elements.reference) elements.reference.textContent = `${task.referenceIpa || 'IPA unavailable'} · ${task.targetSyllableCount || '?'} syllables`;
    if (elements.claimStatus) elements.claimStatus.textContent = state.mode === 'previous' ? 'Previous sample' : (task.status || 'Reserved').replaceAll('_', ' ');
    if (elements.step) elements.step.textContent = state.mode === 'previous' ? 'Step 2 · Review previous sample' : 'Step 2 · Record and review';
    updateButtons();
  }

  async function refresh() {
    try {
      const params = new URLSearchParams({ operatorName: state.operatorName, sessionId: state.sessionId });
      const payload = await apiFetch(`${studyApiPath()}?${params.toString()}`);
      normalizePayload(payload);
      renderStats();
      renderQueue();
      renderTask();
      setStatus(state.task ? `Reserved ${state.task.targetWord}.` : 'Study queue refreshed.');
    } catch (error) {
      setStatus(`Study unavailable: ${error.message}`, 'error');
    }
  }

  async function claimNext() {
    if (!state.operatorName) { setStatus('Enter your name before claiming a word.', 'error'); elements.operator?.focus(); return; }
    try {
      elements.claim.disabled = true;
      const payload = await apiFetch(studyApiPath('claim-next'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operatorName: state.operatorName, sessionId: state.sessionId })
      });
      resetTaskState();
      state.task = normalizeTask(payload.task || payload.claim || payload);
      renderTask();
      renderQueue();
      startHeartbeat();
      setStatus(`Claimed ${state.task?.targetWord || 'the next word'}. Record it, then analyze and review.`);
    } catch (error) {
      setStatus(error.message, 'error');
      elements.claim.disabled = false;
    }
  }

  async function releaseTask() {
    if (!state.task?.taskId || state.mode === 'previous') return;
    try {
      await apiFetch(studyApiPath(`tasks/${encodeURIComponent(state.task.taskId)}/release`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: state.sessionId, operatorName: state.operatorName })
      });
      state.task = null;
      resetTaskState();
      await refresh();
    } catch (error) { setStatus(error.message, 'error'); }
  }

  function startHeartbeat() {
    stopHeartbeat();
    if (!state.task?.taskId || state.mode === 'previous') return;
    state.heartbeatId = setInterval(async () => {
      try {
        await apiFetch(studyApiPath(`tasks/${encodeURIComponent(state.task.taskId)}/heartbeat`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: state.sessionId, operatorName: state.operatorName })
        });
      } catch (error) { setStatus(`Reservation heartbeat failed: ${error.message}`, 'error'); }
    }, CLAIM_HEARTBEAT_MS);
  }

  function stopHeartbeat() {
    if (state.heartbeatId) clearInterval(state.heartbeatId);
    state.heartbeatId = null;
  }

  function cleanupRecording() {
    try { state.processor?.disconnect?.(); } catch (_) { /* ignore */ }
    try { state.sourceNode?.disconnect?.(); } catch (_) { /* ignore */ }
    try { state.stream?.getTracks?.().forEach((track) => track.stop()); } catch (_) { /* ignore */ }
    try { if (state.audioContext && state.audioContext.state !== 'closed') state.audioContext.close(); } catch (_) { /* ignore */ }
    state.processor = null;
    state.sourceNode = null;
    state.stream = null;
    state.audioContext = null;
    state.recording = false;
    state.rawChunks = [];
  }

  function encodeWav(chunks, sampleRate) {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const samples = new Float32Array(total);
    let offset = 0;
    chunks.forEach((chunk) => { samples.set(chunk, offset); offset += chunk.length; });
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const write = (at, text) => [...text].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
    write(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); write(8, 'WAVE');
    write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    write(36, 'data'); view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i += 1) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * (samples[i] < 0 ? 0x8000 : 0x7fff), true);
    return new Blob([view], { type: 'audio/wav' });
  }

  async function startRecording() {
    if (!state.task || state.mode === 'previous' || state.recording) return;
    try {
      cleanupRecording();
      state.audioBlob = null;
      state.comparison = null;
      state.analysisFailed = false;
      state.manualBoundaries = [];
      state.manualSegments = [];
      state.manualReviewSaved = false;
      state.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      state.sourceNode = state.audioContext.createMediaStreamSource(state.stream);
      state.processor = state.audioContext.createScriptProcessor(4096, 1, 1);
      state.rawChunks = [];
      state.processor.onaudioprocess = (event) => state.rawChunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      state.sourceNode.connect(state.processor);
      state.processor.connect(state.audioContext.destination);
      state.recording = true;
      if (elements.recordStatus) elements.recordStatus.textContent = 'Recording… click Stop when the word is complete.';
      updateButtons();
    } catch (error) {
      cleanupRecording();
      setStatus(`Microphone unavailable: ${error.message}`, 'error');
    }
  }

  async function stopRecording() {
    if (!state.recording) return;
    const sampleRate = state.audioContext?.sampleRate || 44100;
    const chunks = state.rawChunks.slice();
    cleanupRecording();
    state.audioBlob = encodeWav(chunks, sampleRate);
    state.audioUrl = URL.createObjectURL(state.audioBlob);
    if (elements.audio) { elements.audio.src = state.audioUrl; elements.audio.hidden = false; }
    if (elements.recordStatus) elements.recordStatus.textContent = `Recording ready (${(state.audioBlob.size / 1024).toFixed(0)} KB).`;
    if (elements.timelineEmpty) elements.timelineEmpty.hidden = false;
    await loadWaveform(state.audioUrl);
    updateButtons();
  }

  async function redoRecording() {
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.audioBlob = null; state.audioUrl = null; state.comparison = null; state.analysisFailed = false; state.manualBoundaries = []; state.manualSegments = []; state.selectedBoundaryIndex = -1; state.manualReviewSaved = false;
    clearCertainty();
    if (elements.audio) { elements.audio.hidden = true; elements.audio.removeAttribute('src'); }
    clearRegions();
    setAnalysisStatus('Analysis is required before review.');
    if (elements.recordStatus) elements.recordStatus.textContent = 'No recording yet.';
    updateManualUi(); updateButtons();
  }

  function spanStart(span) { return Number(span?.startTime ?? span?.start_time ?? span?.start); }
  function spanEnd(span) { return Number(span?.endTime ?? span?.end_time ?? span?.end); }

  function analysisSpans(version) {
    const analysis = analysisForVersion(version);
    if (!analysis) return [];
    if (version === 'v3' || version === 'v4') {
      const variant = analysis.partitionVariants?.[version];
      if (Array.isArray(variant) && variant.length) return variant;
    }
    const spans = analysis.observed_syllables || analysis.observed?.syllables || analysis.syllables || [];
    return Array.isArray(spans) ? spans : [];
  }

  function analysisForVersion(version) {
    const direct = state.comparison?.[version]?.analysis;
    if (direct) return direct;
    return version === 'v4' ? (state.comparison?.v3?.analysis || null) : null;
  }

  function renderPanel(version) {
    const panel = elements.panels[version];
    if (!panel) return;
    if (version === 'manual') {
      const count = state.manualSegments.length;
      if (elements.manualSummary) {
        elements.manualSummary.textContent = count
          ? `${count} contiguous syllable segments marked.`
          : 'Mark the start, shared internal boundaries, and end on the timeline.';
      }
      renderPlaybackButtons(panel, state.manualSegments, 'manual');
      updateManualUi();
      return;
    }
    panel.replaceChildren();
    const spans = analysisSpans(version);
    const analysis = analysisForVersion(version) || {};
    if (!spans.length) { panel.textContent = `${version.toUpperCase()} is unavailable for this recording.`; return; }
    const line = document.createElement('div');
    line.textContent = `${version.toUpperCase()} · ${spans.length} syllables · ${analysis.analysisVersion || analysis.analysis_version || 'analysis revision unavailable'}`;
    panel.appendChild(line);
    const labels = document.createElement('ol');
    labels.className = 'segmentation-study-ipa-labels';
    const syllables = Array.isArray(state.task?.referenceSyllableIpa) ? state.task.referenceSyllableIpa : [];
    spans.forEach((span, index) => {
      const label = document.createElement('li');
      label.textContent = `${syllables[index] || `Syllable ${index + 1}`} · ${spanStart(span).toFixed(3)}–${spanEnd(span).toFixed(3)}s`;
      labels.appendChild(label);
    });
    panel.appendChild(labels);
    const timing = document.createElement('div');
    timing.className = 'crm-muted';
    timing.textContent = spans.map((span, index) => `#${index + 1} ${spanStart(span).toFixed(3)}–${spanEnd(span).toFixed(3)}s`).join(' · ');
    panel.appendChild(timing);
    renderPlaybackButtons(panel, spans, version);
  }

  function renderPlaybackButtons(panel, spans, version) {
    panel.querySelector('.segmentation-study-playback')?.remove();
    const controls = document.createElement('div');
    controls.className = 'segmentation-study-playback';
    const whole = document.createElement('button');
    whole.type = 'button';
    whole.className = 'crm-btn crm-btn-secondary crm-btn-sm';
    whole.textContent = 'Play whole word';
    whole.addEventListener('click', () => playRange(0, Number(state.waveSurfer?.getDuration?.() || elements.audio?.duration || 0)));
    controls.appendChild(whole);
    spans.forEach((span, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'crm-btn crm-btn-secondary crm-btn-sm';
      const label = state.task?.referenceSyllableIpa?.[index] || `syllable ${index + 1}`;
      button.textContent = `Play ${version === 'manual' ? `syllable ${index + 1}` : label}`;
      button.addEventListener('click', () => playRange(spanStart(span), spanEnd(span)));
      controls.appendChild(button);
    });
    panel.appendChild(controls);
  }

  function playRange(start, end) {
    const audio = elements.audio;
    if (!audio?.src || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    if (state.playTimer) clearInterval(state.playTimer);
    audio.playbackRate = Number(elements.playbackSpeed?.value || 1);
    audio.currentTime = Math.max(0, start);
    const stopAt = Math.max(start, end);
    state.playTimer = setInterval(() => {
      if (audio.currentTime >= stopAt - 0.01) {
        audio.pause();
        clearInterval(state.playTimer);
        state.playTimer = null;
      }
    }, 25);
    audio.play().catch(() => setStatus('Playback is unavailable for this recording.', 'error'));
  }

  function clearRegions() {
    try { state.regions?.clearRegions?.(); } catch (_) { /* ignore */ }
  }

  function drawRegions(version) {
    clearRegions();
    if (!state.regions) return;
    const colors = ['rgba(37,99,235,.28)', 'rgba(16,185,129,.28)', 'rgba(139,92,246,.28)', 'rgba(234,88,12,.28)'];
    const spans = version === 'manual' ? state.manualSegments : analysisSpans(version);
    spans.forEach((span, index) => {
      const start = spanStart(span); const end = spanEnd(span);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
      try {
        state.regions.addRegion({
          id: `study-${version}-${index}`,
          start,
          end,
          color: colors[index % colors.length],
          content: `${version === 'manual' ? 'Manual' : version.toUpperCase()} ${index + 1}`,
          // A syllable span itself must not move: reviewers drag either resize
          // handle, which represents one shared boundary with its neighbour.
          drag: false,
          resize: version === 'manual'
        });
      } catch (_) { /* WaveSurfer can reject regions before ready */ }
    });
  }

  function syncManualFromRegion(region, finalize = false) {
    if (state.activeVersion !== 'manual' || !region) return;
    const match = String(region.id || '').match(/^study-manual-(\d+)$/);
    const segmentIndex = match ? Number(match[1]) : -1;
    const segment = state.manualSegments[segmentIndex];
    if (!segment) return;
    const nextStart = Number(region.start);
    const nextEnd = Number(region.end);
    const startDelta = Math.abs(nextStart - spanStart(segment));
    const endDelta = Math.abs(nextEnd - spanEnd(segment));
    const boundaryIndex = startDelta > endDelta ? segmentIndex : segmentIndex + 1;
    const candidate = startDelta > endDelta ? nextStart : nextEnd;
    if (!Number.isFinite(candidate) || boundaryIndex < 0 || boundaryIndex >= state.manualBoundaries.length) return;
    const duration = Number(state.waveSurfer?.getDuration?.() || 0);
    const lower = boundaryIndex > 0 ? state.manualBoundaries[boundaryIndex - 1] + 0.01 : 0;
    const upper = boundaryIndex < state.manualBoundaries.length - 1
      ? state.manualBoundaries[boundaryIndex + 1] - 0.01
      : (duration || candidate);
    state.manualBoundaries[boundaryIndex] = Number(Math.min(upper, Math.max(lower, candidate)).toFixed(6));
    clampSelectedBoundary();
    rebuildManualSegments();
    renderPanel('manual');
    updateManualUi();
    if (finalize) drawRegions('manual');
  }

  function selectVersion(version) {
    state.activeVersion = version;
    elements.tabs.forEach((tab) => {
      const active = tab.dataset.studyVersion === version;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    Object.entries(elements.panels).forEach(([key, panel]) => { if (panel) panel.hidden = key !== version; });
    renderPanel(version);
    drawRegions(version);
    if (elements.manualInstructions) elements.manualInstructions.hidden = version !== 'manual';
  }

  async function loadWaveform(url) {
    if (!elements.waveform || !window.WaveSurfer) {
      if (elements.timelineEmpty) elements.timelineEmpty.textContent = 'Waveform library unavailable; audio is still saved for review.';
      return;
    }
    try {
      if (state.waveSurfer) state.waveSurfer.destroy();
      elements.waveform.replaceChildren();
      elements.spectrogram?.replaceChildren();
      const plugins = [];
      state.waveSurfer = WaveSurfer.create({ container: elements.waveform, waveColor: '#64748b', progressColor: '#2563eb', height: 96, normalize: true, plugins });
      const RegionsPlugin = WaveSurfer.RegionsPlugin || WaveSurfer.Regions;
      const TimelinePlugin = WaveSurfer.TimelinePlugin || WaveSurfer.Timeline;
      const SpectrogramPlugin = WaveSurfer.SpectrogramPlugin || WaveSurfer.Spectrogram;
      state.regions = RegionsPlugin ? state.waveSurfer.registerPlugin(RegionsPlugin.create()) : null;
      if (TimelinePlugin && elements.timelineRuler) {
        elements.timelineRuler.replaceChildren();
        state.timeline = state.waveSurfer.registerPlugin(TimelinePlugin.create({ container: elements.timelineRuler, height: 20 }));
      }
      if (SpectrogramPlugin && elements.spectrogram) {
        state.spectrogram = state.waveSurfer.registerPlugin(SpectrogramPlugin.create({
          container: elements.spectrogram, labels: true, height: 128, fftSamples: 512, scale: 'mel', windowFunc: 'hann', frequencyMax: 8000
        }));
      }
      state.waveSurfer.on('ready', () => {
        if (elements.timelineEmpty) elements.timelineEmpty.hidden = true;
        selectVersion(state.activeVersion);
      });
      state.waveSurfer.on('interaction', (time) => {
        if (state.activeVersion === 'manual') addManualBoundary(Number(time));
      });
      state.waveSurfer.on('region-updated', (region) => syncManualFromRegion(region));
      state.waveSurfer.on('region-update-end', (region) => syncManualFromRegion(region, true));
      state.waveSurfer.on('error', (error) => setStatus(`Waveform failed: ${error?.message || error}`, 'error'));
      await state.waveSurfer.load(url);
    } catch (error) { setStatus(`Waveform failed: ${error.message}`, 'error'); }
  }

  function addManualBoundary(rawTime) {
    if (state.activeVersion !== 'manual' || !state.task) return;
    const duration = Number(state.waveSurfer?.getDuration?.() || 0);
    const time = Math.min(duration || rawTime, Math.max(0, rawTime));
    const expected = Number(state.task.targetSyllableCount || 0) + 1;
    if (!Number.isFinite(time) || !duration || state.manualBoundaries.length >= expected) return;
    const previous = state.manualBoundaries.at(-1);
    if (Number.isFinite(previous) && time <= previous + 0.01) return;
    state.manualBoundaries.push(Number(time.toFixed(6)));
    state.selectedBoundaryIndex = state.manualBoundaries.length - 1;
    clampSelectedBoundary();
    rebuildManualSegments();
    renderPanel('manual');
    drawRegions('manual');
    updateManualUi(); updateButtons();
  }

  function rebuildManualSegments() {
    state.manualSegments = state.manualBoundaries.slice(1).map((endTime, index) => ({ index, startTime: state.manualBoundaries[index], endTime, duration: Number((endTime - state.manualBoundaries[index]).toFixed(6)), source: 'manual-review' }));
  }

  function clampSelectedBoundary() {
    const lastMovableIndex = state.manualBoundaries.length - 2;
    if (lastMovableIndex < 1) {
      state.selectedBoundaryIndex = -1;
      return;
    }
    const current = state.selectedBoundaryIndex < 0 ? lastMovableIndex : state.selectedBoundaryIndex;
    state.selectedBoundaryIndex = Math.max(1, Math.min(current, lastMovableIndex));
  }

  function nudgeSelectedBoundary(direction, fine) {
    if (state.activeVersion !== 'manual' || !state.manualBoundaries.length) return;
    clampSelectedBoundary();
    const index = state.selectedBoundaryIndex;
    if (index <= 0 || index >= state.manualBoundaries.length - 1) return;
    const duration = Number(state.waveSurfer?.getDuration?.() || state.manualBoundaries.at(-1) || 0);
    const step = fine ? 0.001 : 0.005;
    const lower = state.manualBoundaries[index - 1] + 0.0005;
    const upper = Math.min(duration - 0.0005, state.manualBoundaries[index + 1] - 0.0005);
    const next = Math.max(lower, Math.min(upper, state.manualBoundaries[index] + direction * step));
    state.manualBoundaries[index] = Number(next.toFixed(6));
    rebuildManualSegments();
    drawRegions('manual');
    renderPanel('manual');
    updateManualUi();
    setStatus(`Boundary ${index} moved to ${next.toFixed(3)} seconds.`);
  }

  function updateManualUi() {
    const expected = Number(state.task?.targetSyllableCount || 0);
    if (elements.manualCount) elements.manualCount.textContent = `${state.manualSegments.length} of ${expected} segments · ${state.manualBoundaries.length} boundaries`;
    if (elements.manualInstructions) {
      if (!state.task) elements.manualInstructions.textContent = 'Claim or open a sample first.';
      else if (!state.manualBoundaries.length) elements.manualInstructions.textContent = 'Click the start of the word.';
      else if (state.manualSegments.length < expected) elements.manualInstructions.textContent = `Click shared boundary ${state.manualSegments.length} of ${Math.max(0, expected - 1)}.`;
      else if (state.manualBoundaries.length < expected + 1) elements.manualInstructions.textContent = 'Click the end of the word.';
      else elements.manualInstructions.textContent = 'All boundaries are marked. Choose certainty and save.';
    }
    updateButtons();
  }

  async function analyze() {
    if (!state.audioBlob || !state.task) return;
    try {
      elements.analyze.disabled = true;
      setAnalysisStatus('Running V2/V3 comparison…');
      const { PraatAPI } = await import(`/pronunciation-analyzer/praat-api.js?segmentation-study=${encodeURIComponent(state.task.taskId)}`);
      const api = new PraatAPI();
      state.comparison = await api.analyzeComparison(state.audioBlob, {
        expectedSyllables: state.task.targetSyllableCount,
        targetWord: state.task.targetWord,
        referenceIpa: state.task.referenceIpa,
        referenceSyllables: state.task.referenceSyllableIpa
      });
      setAnalysisStatus('V2, V3, and V4 data loaded. Automatic boundaries remain visible for comparison.', 'success');
      ['v2', 'v3', 'v4'].forEach(renderPanel);
      selectVersion(state.activeVersion);
      updateButtons();
    } catch (error) {
      state.comparison = null;
      state.analysisFailed = true;
      setAnalysisStatus(`Analysis failed: ${error.message}. You can retry without re-recording.`, 'error');
      updateButtons();
    } finally { elements.analyze.disabled = !state.audioBlob; }
  }

  function manualMetadata() {
    return {
      manualSegments: state.manualSegments,
      manualSegmentationConvention: 'ipa-phonological-contiguous-v1',
      certainty: elements.certainty?.()?.value || 'uncertain',
      automaticBoundariesVisible: true,
      reviewStatus: elements.certainty?.()?.value === 'uncertain' ? 'uncertain' : 'complete',
      reviewerName: state.operatorName,
      reviewerSessionId: state.sessionId
    };
  }

  async function save() {
    if (!state.task || !state.audioBlob || !state.manualSegments.length) return;
    const review = manualMetadata();
    try {
      elements.save.disabled = true;
      setStatus('Saving the recording and manual boundary review…');
      if (state.mode === 'previous') {
        await apiFetch(`/api/admin/dev/corpus-samples/${encodeURIComponent(state.task.taskId)}/manual-reviews`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(review)
        });
      } else {
        const formData = new FormData();
        formData.append('audio', state.audioBlob, `${state.task.taskId}.wav`);
        formData.append('metadata', JSON.stringify({
          studyVersion: STUDY_VERSION,
          taskId: state.task.taskId,
          sessionId: state.sessionId,
          operatorName: state.operatorName,
          targetWord: state.task.targetWord,
          referenceIpa: state.task.referenceIpa,
          referenceSyllableIpa: state.task.referenceSyllableIpa,
          targetSyllableCount: state.task.targetSyllableCount,
          expectedObservedCount: state.task.targetSyllableCount,
          category: 'clean',
          speakerCohort: 'segmentation-study-v1',
          analysisStatus: state.comparison ? 'complete' : 'analysis_failed',
          comparison: state.comparison,
          analysisRevision: state.comparison?.v3?.analysis?.analysisVersion || state.comparison?.v2?.analysis?.analysisVersion || 'segmentation-study-v1',
          rawCtcSpans: state.comparison?.v3?.analysis?.rawCtcSpans || state.comparison?.v3?.analysis?.observed_syllables || null,
          measurementSpans: state.comparison?.v3?.analysis?.measurementSpans || null,
          v2: state.comparison?.v2?.analysis || null,
          v3: state.comparison?.v3?.analysis?.partitionVariants?.v3 || null,
          v4: state.comparison?.v3?.analysis?.partitionVariants?.v4 || null,
          automaticBoundariesVisible: true,
          ...review,
          manualSegments: state.manualSegments,
          needsManualReview: false
        }));
        await apiFetch(studyApiPath(`tasks/${encodeURIComponent(state.task.taskId)}/complete`), { method: 'POST', body: formData });
      }
      state.manualReviewSaved = true;
      if (state.task) state.task = { ...state.task, status: 'completed' };
      updateButtons();
      await refresh();
      setStatus('Saved. The next word is ready.', 'success');
      updateButtons();
    } catch (error) {
      setStatus(`Save failed: ${error.message}`, 'error');
      elements.save.disabled = false;
    }
  }

  async function openPreviousSample(sample) {
    try {
      resetTaskState();
      state.mode = 'previous';
      state.task = normalizeTask(sample);
      renderTask();
      setStatus(`Loading ${state.task.targetWord} for manual review…`);
      const user = window.firebase?.auth?.().currentUser;
      const token = await user.getIdToken();
      const response = await fetch(`/api/admin/dev/corpus-samples/${encodeURIComponent(state.task.taskId)}/audio`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (!response.ok) throw new Error(`Audio request failed (${response.status})`);
      state.audioBlob = await response.blob();
      state.audioUrl = URL.createObjectURL(state.audioBlob);
      if (elements.audio) { elements.audio.src = state.audioUrl; elements.audio.hidden = false; }
      await loadWaveform(state.audioUrl);
      if (Array.isArray(sample.manualSegments) && sample.manualSegments.length) {
        state.manualSegments = sample.manualSegments.map((segment, index) => ({ ...segment, index }));
        state.manualBoundaries = [state.manualSegments[0].startTime, ...state.manualSegments.map((segment) => segment.endTime)];
      }
      selectVersion('manual');
      setAnalysisStatus('Previous sample loaded. Automatic versions are shown when available.');
      updateButtons();
      await analyze();
    } catch (error) { setStatus(`Previous sample unavailable: ${error.message}`, 'error'); }
  }

  function bind() {
    elements.operator.value = readOperatorName();
    saveOperatorName(elements.operator.value);
    elements.operator.addEventListener('input', () => saveOperatorName(elements.operator.value));
    elements.modes.forEach((button) => button.addEventListener('click', async () => {
      state.mode = button.dataset.studyMode || 'record';
      elements.modes.forEach((item) => item.classList.toggle('is-active', item === button));
      if (state.mode === 'previous') { state.task = null; resetTaskState(); }
      await refresh();
      if (state.mode === 'previous') setStatus('Choose a previous sample from the queue.');
    }));
    elements.claim.addEventListener('click', claimNext);
    elements.release.addEventListener('click', releaseTask);
    elements.refresh.addEventListener('click', refresh);
    elements.record.addEventListener('click', startRecording);
    elements.stop.addEventListener('click', stopRecording);
    elements.redo.addEventListener('click', redoRecording);
    elements.analyze.addEventListener('click', analyze);
    elements.save.addEventListener('click', save);
    elements.next.addEventListener('click', async () => { state.task = null; resetTaskState(); state.mode = 'record'; await refresh(); });
    elements.tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => selectVersion(tab.dataset.studyVersion || 'v2'));
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === 'Home' ? 0
          : (event.key === 'End' ? elements.tabs.length - 1
            : (index + (event.key === 'ArrowLeft' ? -1 : 1) + elements.tabs.length) % elements.tabs.length);
        const next = elements.tabs[nextIndex];
        next?.focus();
        if (next) selectVersion(next.dataset.studyVersion || 'v2');
      });
    });
    elements.manualUndo.addEventListener('click', () => { state.manualBoundaries.pop(); clampSelectedBoundary(); rebuildManualSegments(); drawRegions('manual'); renderPanel('manual'); updateManualUi(); });
    elements.manualClear.addEventListener('click', () => { state.manualBoundaries = []; state.manualSegments = []; state.selectedBoundaryIndex = -1; drawRegions('manual'); renderPanel('manual'); updateManualUi(); });
    elements.timeline?.addEventListener('keydown', (event) => {
      if (state.activeVersion !== 'manual') return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        nudgeSelectedBoundary(event.key === 'ArrowLeft' ? -1 : 1, event.shiftKey);
      }
    });
    document.querySelectorAll('input[name="segmentation-study-certainty"]').forEach((input) => input.addEventListener('change', updateButtons));
    window.addEventListener('pagehide', () => { stopHeartbeat(); cleanupRecording(); state.waveSurfer?.destroy?.(); });
  }

  async function init() {
    if (initialized) return;
    elements = getElements();
    if (!elements.workspace) return;
    initialized = true;
    state.sessionId = readSessionId();
    bind();
    await refresh();
  }

  window.CrmSegmentationStudy = { init };
}());
