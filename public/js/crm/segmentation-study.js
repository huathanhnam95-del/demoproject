(function () {
  'use strict';

  const VERSION_REGISTRY = Object.freeze({
    v1: Object.freeze({ publicVersion: 'v1', internalVersion: 'study-v1', writable: false }),
    v2: Object.freeze({ publicVersion: 'v2', internalVersion: 'study-v2', studyId: 'segmentation-study-v2', writable: true })
  });
  const ACTIVE_STUDY = VERSION_REGISTRY.v2;
  const CAPTURE_CONSTRAINTS_REQUESTED = Object.freeze({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
  const REFERENCE_LABEL_PROVENANCE = 'explicit-reviewed-en-US-v1';
  const AUTOMATIC_JUDGMENT_SCHEMA_VERSION = 'segmentation-study-automatic-judgment-v1';
  const OPERATOR_KEY = 'bel.segmentation-study.operator-name';
  const SESSION_KEY = 'bel.segmentation-study.session-id';
  const CLAIM_HEARTBEAT_MS = 2 * 60 * 1000;
  const VISUALIZATION_READY_TIMEOUT_MS = 3000;
  const VISUALIZATION_POLL_MS = 25;

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
    studyVersion: ACTIVE_STUDY.internalVersion,
    studyId: ACTIVE_STUDY.studyId,
    manifestVersion: '',
    manifestSha256: '',
    dialect: 'en-US',
    task: null,
    audioBlob: null,
    audioUrl: null,
    comparison: null,
    manualBoundaries: [],
    manualSegments: [],
    selectedBoundaryIndex: -1,
    activeVersion: 'v2',
    exposureTaskId: '',
    recording: false,
    stream: null,
    audioContext: null,
    sourceNode: null,
    processor: null,
    rawChunks: [],
    captureSettings: null,
    captureConstraintsRequested: CAPTURE_CONSTRAINTS_REQUESTED,
    captureEligibility: false,
    playbackConfirmed: false,
    versionExposureLog: [],
    heartbeatId: null,
    waveSurfer: null,
    regions: null,
    spectrogram: null,
    timeline: null,
    manualReviewSaved: false,
    analysisFailed: false,
    visualizationReady: false,
    playTimer: null,
    currentTime: 0,
    pointA: null,
    pointB: null,
    abArm: null,
    loopAB: false,
    automaticJudgmentJudgedAt: null,
    lastWaveInteractionAt: 0,
    lastWaveInteractionTime: null,
    visualizationAttemptId: 0
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
      captureStatus: byId('segmentation-study-capture-status'),
      playbackConfirmed: byId('segmentation-study-playback-confirmed'),
      analyze: byId('segmentation-study-analyze'),
      analysisStatus: byId('segmentation-study-analysis-status'),
      tabs: Array.from(document.querySelectorAll('[data-study-version]')),
      waveform: byId('segmentation-study-waveform'),
      spectrogram: byId('segmentation-study-spectrogram'),
      timelineRuler: byId('segmentation-study-time-ruler'),
      timeline: byId('segmentation-study-timeline'),
      timelineEmpty: byId('segmentation-study-timeline-empty'),
      currentTime: byId('segmentation-study-current-time'),
      playPause: byId('segmentation-study-play-pause'),
      setA: byId('segmentation-study-set-a'),
      setB: byId('segmentation-study-set-b'),
      playAB: byId('segmentation-study-play-ab'),
      loopAB: byId('segmentation-study-loop-ab'),
      clearAB: byId('segmentation-study-clear-ab'),
      retryVisualization: byId('segmentation-study-retry-visualization'),
      markerCurrent: byId('segmentation-study-marker-current'),
      markerA: byId('segmentation-study-marker-a'),
      markerB: byId('segmentation-study-marker-b'),
      judgmentStatus: byId('segmentation-study-judgment-status'),
      automaticJudgment: () => Array.from(document.querySelectorAll('[data-automatic-judgment-version]:checked')),
      automaticJudgmentNone: byId('segmentation-study-automatic-judgment-none'),
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
    const base = `/api/admin/dev/segmentation-study/${ACTIVE_STUDY.publicVersion}`;
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

  function findRenderedCanvases(root, canvases = []) {
    if (!root) return canvases;
    const directCanvases = root.querySelectorAll?.('canvas') || [];
    directCanvases.forEach((canvas) => canvases.push(canvas));
    const descendants = root.querySelectorAll?.('*') || [];
    descendants.forEach((element) => {
      if (element.shadowRoot) findRenderedCanvases(element.shadowRoot, canvases);
    });
    if (root.shadowRoot) findRenderedCanvases(root.shadowRoot, canvases);
    return canvases;
  }

  function waveformUnavailableMessage() {
    return state.comparison
      ? 'Waveform unavailable; audio and analysis are retained. Retry waveform or re-record.'
      : 'Waveform unavailable; audio is saved. Retry waveform or re-record.';
  }

  function markVisualizationUnavailable(message = waveformUnavailableMessage()) {
    state.visualizationReady = false;
    if (elements.timelineEmpty) {
      elements.timelineEmpty.hidden = false;
      elements.timelineEmpty.textContent = message;
    }
    if (elements.retryVisualization) {
      elements.retryVisualization.hidden = !state.audioBlob;
      elements.retryVisualization.disabled = !state.audioBlob;
    }
    setStatus(message, 'warning');
    updateTimelineUi();
  }

  function renderedCanvasReady(container) {
    return findRenderedCanvases(container).some((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return Number(canvas.width) > 0 && Number(canvas.height) > 0 && rect.width > 0 && rect.height > 0;
    });
  }

  function visualizationSurfacesReady() {
    return Number(state.waveSurfer?.getDuration?.()) > 0
      && renderedCanvasReady(elements.waveform)
      && renderedCanvasReady(elements.spectrogram);
  }

  function waitForVisualizationSurfaces(timeoutMs = VISUALIZATION_READY_TIMEOUT_MS) {
    const startedAt = Date.now();
    return new Promise((resolve) => {
      const check = () => {
        if (visualizationSurfacesReady()) { resolve(true); return; }
        if (Date.now() - startedAt >= timeoutMs) { resolve(false); return; }
        setTimeout(check, VISUALIZATION_POLL_MS);
      };
      check();
    });
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
      automaticVersionOrder: Array.isArray(task.automaticVersionOrder) ? task.automaticVersionOrder.filter((version) => ['v2', 'v3', 'v4'].includes(version)) : [],
      mode: task.mode || state.mode
    };
  }

  function automaticVersionOrder(task = state.task) {
    const order = Array.isArray(task?.automaticVersionOrder)
      ? task.automaticVersionOrder.filter((version) => ['v2', 'v3', 'v4'].includes(version))
      : [];
    return order.length === 3 && new Set(order).size === 3 ? order : ['v2', 'v3', 'v4'];
  }

  function nextAutomaticExposureVersion() {
    const order = automaticVersionOrder();
    const viewed = new Set(state.versionExposureLog.map((entry) => entry.version));
    return order.find((version) => !viewed.has(version)) || null;
  }

  function versionExposureProofReady() {
    const order = Array.isArray(state.task?.automaticVersionOrder) ? state.task.automaticVersionOrder : [];
    const automaticOrder = String(state.task?.automaticOrder || '');
    const log = state.versionExposureLog;
    if (order.length !== 3 || new Set(order).size !== 3 || order.some((version) => !['v2', 'v3', 'v4'].includes(version))
      || !/^[a-f0-9]{64}$/.test(automaticOrder) || !Array.isArray(log) || log.length !== 3) return false;
    return log.every((entry, index) => entry?.version === order[index]
      && entry.automaticOrder === automaticOrder
      && Number.isFinite(Date.parse(String(entry.viewedAt || ''))));
  }

  function exposureRequirementMessage() {
    const nextVersion = nextAutomaticExposureVersion();
    return nextVersion
      ? `Next required automatic view: ${nextVersion.toUpperCase()}.`
      : 'Complete the ordered automatic exposure review before saving.';
  }

  const CAPTURE_SETTING_IDS = new Set(['deviceid', 'groupid', 'device_id', 'group_id']);

  function sanitizeCaptureSettings(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
    const clean = {};
    Object.entries(settings).forEach(([key, value]) => {
      const normalized = String(key).trim();
      if (!normalized || CAPTURE_SETTING_IDS.has(normalized.toLowerCase())) return;
      if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'string') clean[normalized] = value;
    });
    return clean;
  }

  function captureSettingsReady() {
    return state.captureEligibility === true
      && state.captureSettings?.echoCancellation === false
      && state.captureSettings?.noiseSuppression === false
      && state.captureSettings?.autoGainControl === false;
  }

  function spansForComparison(version) {
    const comparison = state.comparison;
    if (!comparison) return [];
    if (version === 'v2') return analysisSpans('v2');
    if (version === 'v3') {
      const partition = comparison.v3?.analysis?.partitionVariants?.v3;
      return Array.isArray(partition) ? partition : analysisSpans('v3');
    }
    const partition = comparison.v3?.analysis?.partitionVariants?.v4;
    if (Array.isArray(partition)) return partition;
    const direct = comparison.v4?.analysis?.observed_syllables || comparison.v4?.analysis?.observed?.syllables;
    return Array.isArray(direct) ? direct : [];
  }

  function collectEditOperations(value, operations = [], seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return operations;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => collectEditOperations(item, operations, seen));
      return operations;
    }
    Object.entries(value).forEach(([key, child]) => {
      if ((key === 'edit_operations' || key === 'editOperations') && Array.isArray(child)) operations.push(...child);
      collectEditOperations(child, operations, seen);
    });
    return operations;
  }

  function hasSubstitutionEvidence(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) return value.some((item) => hasSubstitutionEvidence(item, seen));
    return Object.entries(value).some(([key, child]) => {
      const normalizedKey = key.toLowerCase().replace(/[_-]/g, '');
      if ((normalizedKey === 'op' || normalizedKey === 'operation') && String(child || '').toLowerCase() === 'substitution') return true;
      if (normalizedKey === 'substitution' || normalizedKey === 'substitutionused') {
        if (child === true || String(child || '').toLowerCase() === 'substitution') return true;
      }
      return hasSubstitutionEvidence(child, seen);
    });
  }

  function authoritativeV4MatchesDirect() {
    const partitionVariants = state.comparison?.v3?.analysis?.partitionVariants;
    if (!partitionVariants || !Array.isArray(partitionVariants.v4)) return false;
    if (state.comparison?.v4 == null) return true;
    const directWrapper = state.comparison.v4;
    const direct = directWrapper?.analysis || directWrapper;
    const authoritativeSpans = partitionVariants.v4;
    const directSpans = direct?.observed_syllables || direct?.observed?.syllables || direct?.syllables;
    if (!Array.isArray(directSpans) || directSpans.length !== authoritativeSpans.length) return false;
    if (directSpans.some((span, index) => spanStart(span) !== spanStart(authoritativeSpans[index]) || spanEnd(span) !== spanEnd(authoritativeSpans[index]))) return false;
    const authoritativeVersion = partitionVariants.v4AnalysisVersion || partitionVariants.v4_analysis_version;
    const directVersions = [direct.analysisVersion, direct.analysis_version, directWrapper.analysisVersion, directWrapper.analysis_version].filter(Boolean);
    const directSources = [direct.source, direct.provenance?.source, directWrapper.source, directWrapper.provenance?.source].filter(Boolean);
    const directSchemas = [direct.schemaVersion, direct.schema_version, direct.partitionSchemaVersion, direct.partition_schema_version,
      direct.provenance?.schemaVersion, direct.provenance?.schema_version, directWrapper.schemaVersion, directWrapper.schema_version,
      directWrapper.partitionSchemaVersion, directWrapper.partition_schema_version, directWrapper.provenance?.schemaVersion, directWrapper.provenance?.schema_version].filter(Boolean);
    const directVariants = [direct.variant, direct.provenance?.variant, directWrapper.variant, directWrapper.provenance?.variant].filter(Boolean);
    const allMatch = (values, expected) => values.length > 0 && values.every((value) => value === expected);
    return allMatch(directVersions, authoritativeVersion)
      && allMatch(directSources, 'partitionVariants.v4')
      && allMatch(directSchemas, partitionVariants.schemaVersion)
      && allMatch(directVariants, 'v4');
  }

  function completeComparisonReady() {
    const expected = Number(state.task?.targetSyllableCount || 0);
    if (!state.comparison || state.comparison.status !== 'complete') return false;
    if (state.comparison.schemaVersion !== 'pronunciation-comparison-v2' || !state.comparison.comparisonId || expected <= 0) return false;
    if (state.comparison.v3?.analysis?.partitionVariants?.schemaVersion !== 'pronunciation-partition-variants-v2') return false;
    if (!authoritativeV4MatchesDirect()) return false;
    const editOperations = collectEditOperations(state.comparison);
    if (editOperations.some((item) => String(item?.op || item?.operation || '').toLowerCase() === 'substitution') || hasSubstitutionEvidence(state.comparison)) return false;
    const analysisVersions = [];
    return ['v2', 'v3', 'v4'].every((version) => {
      if (!state.comparison[version] || state.comparison[version].status !== 'complete') return false;
      const spans = spansForComparison(version);
      const analysis = analysisForVersion(version) || {};
      const contiguous = spans.every((span, index) => index === 0 || Math.abs(spanStart(span) - spanEnd(spans[index - 1])) <= 0.000001);
      const analysisVersion = analysis.analysisVersion || analysis.analysis_version;
      if (analysisVersion) analysisVersions.push(analysisVersion);
      return spans.length === expected && contiguous && Boolean(analysisVersion);
    }) && new Set(analysisVersions).size === 3;
  }

  function normalizePayload(payload) {
    const data = payload?.data || payload || {};
    state.studyVersion = String(data.studyVersion || ACTIVE_STUDY.internalVersion);
    state.studyId = String(data.studyId || ACTIVE_STUDY.studyId);
    state.manifestVersion = String(data.manifestVersion || state.manifestVersion || '');
    state.manifestSha256 = String(data.manifestSha256 || state.manifestSha256 || '');
    state.dialect = String(data.dialect || state.dialect || 'en-US');
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
      const currentTask = state.mode !== 'previous' && state.task?.taskId && state.task.taskId === item.taskId;
      const status = String(currentTask ? 'reserved' : (item.status || item.reviewStatus || 'available')).replaceAll('_', ' ');
      li.textContent = `${item.targetWord || 'Unnamed'} · ${item.targetSyllableCount || '?'} syllables · ${status}`;
      if (state.task?.taskId && state.task.taskId === item.taskId) li.classList.add('is-current');
      li.tabIndex = 0;
      li.addEventListener('click', () => {
        if (state.mode === 'previous') return openPreviousSample(item);
        if (!state.task?.taskId && state.operatorName && item.status === 'available' && item.split === 'holdout') {
          setStatus('Holdout locked until development configuration is frozen.');
          return;
        }
        if (!state.task?.taskId && state.operatorName && item.status === 'available' && !elements.claim?.disabled) return claimNext(item.taskId);
        if (!state.task?.taskId && !state.operatorName) {
          setStatus('Enter your name before claiming a word.', 'error');
          elements.operator?.focus();
          return;
        }
        if (item.status === 'completed') setStatus('Completed study tasks cannot be claimed.');
        else if (state.task?.taskId) setStatus('Release the current word before claiming another task.');
      });
      li.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); li.click(); } });
      elements.queue.appendChild(li);
    });
  }

  function clearAutomaticJudgmentInputs() {
    document.querySelectorAll('[data-automatic-judgment-version], [data-automatic-judgment-none]').forEach((input) => { input.checked = false; });
    if (elements?.judgmentStatus) elements.judgmentStatus.textContent = 'Review all automatic versions before choosing.';
  }

  function automaticJudgmentSelection() {
    const selectedVersions = elements?.automaticJudgment?.().map((input) => input.dataset.automaticJudgmentVersion).filter((version) => ['v2', 'v3', 'v4'].includes(version)) || [];
    const none = Boolean(elements?.automaticJudgmentNone?.checked);
    if (!selectedVersions.length && !none) return null;
    if (none) return { selectedVersions: [], none: true };
    return { selectedVersions: Array.from(new Set(selectedVersions)).sort(), none: false };
  }

  function automaticJudgmentReady() {
    const selection = automaticJudgmentSelection();
    return Boolean(versionExposureProofReady() && selection && (selection.none || selection.selectedVersions.length > 0));
  }

  function automaticJudgmentMetadata() {
    const selection = automaticJudgmentSelection();
    if (!versionExposureProofReady() || !selection) return null;
    if (!state.automaticJudgmentJudgedAt) state.automaticJudgmentJudgedAt = new Date().toISOString();
    return {
      schemaVersion: AUTOMATIC_JUDGMENT_SCHEMA_VERSION,
      selectedVersions: selection.selectedVersions,
      none: selection.none,
      judgedAfterExposureAt: state.automaticJudgmentJudgedAt
    };
  }

  function updateJudgmentUi() {
    const exposureReady = versionExposureProofReady();
    const selection = automaticJudgmentSelection();
    document.querySelectorAll('[data-automatic-judgment-version], [data-automatic-judgment-none]').forEach((input) => {
      input.disabled = !exposureReady || !state.comparison;
    });
    if (elements?.judgmentStatus) {
      elements.judgmentStatus.textContent = exposureReady
        ? (selection ? 'Automatic judgment recorded for this session.' : 'Choose the best automatic version(s), or None acceptable.')
        : 'Review all automatic versions before choosing.';
    }
  }

  function formatTimelineTime(value) {
    return `${Math.max(0, Number(value) || 0).toFixed(3)}s`;
  }

  function timelineDuration() {
    return Number(state.waveSurfer?.getDuration?.() || elements.audio?.duration || 0);
  }

  function updateMarker(marker, time, duration) {
    if (!marker) return;
    const valid = Number.isFinite(time) && duration > 0 && time >= 0 && time <= duration;
    marker.hidden = !valid;
    if (valid) marker.style.left = `${Math.max(0, Math.min(100, (time / duration) * 100))}%`;
  }

  function updateTimelineUi() {
    const duration = timelineDuration();
    const hasAudio = Boolean(state.audioBlob && state.visualizationReady && duration > 0);
    if (elements.currentTime) elements.currentTime.textContent = formatTimelineTime(state.currentTime);
    updateMarker(elements.markerCurrent, state.currentTime, duration);
    updateMarker(elements.markerA, state.pointA, duration);
    updateMarker(elements.markerB, state.pointB, duration);
    if (elements.playPause) {
      elements.playPause.disabled = !hasAudio;
      elements.playPause.textContent = elements.audio && !elements.audio.paused ? 'Pause' : 'Play';
    }
    if (elements.setA) elements.setA.disabled = !hasAudio;
    if (elements.setB) elements.setB.disabled = !hasAudio;
    if (elements.setA) elements.setA.setAttribute('aria-pressed', String(state.abArm === 'a'));
    if (elements.setB) elements.setB.setAttribute('aria-pressed', String(state.abArm === 'b'));
    const hasRange = hasAudio && Number.isFinite(state.pointA) && Number.isFinite(state.pointB) && state.pointB > state.pointA;
    if (elements.playAB) elements.playAB.disabled = !hasRange;
    if (elements.loopAB) {
      elements.loopAB.disabled = !hasRange;
      elements.loopAB.setAttribute('aria-pressed', String(state.loopAB));
    }
    if (elements.clearAB) elements.clearAB.disabled = !hasAudio || (!Number.isFinite(state.pointA) && !Number.isFinite(state.pointB));
    if (elements.retryVisualization) {
      elements.retryVisualization.hidden = state.visualizationReady || !state.audioBlob;
      elements.retryVisualization.disabled = !state.audioBlob;
    }
  }

  function observeNativeTime(time) {
    const duration = timelineDuration();
    const next = Math.max(0, Math.min(duration || Number(time) || 0, Number(time) || 0));
    state.currentTime = Number(next.toFixed(6));
    try { state.waveSurfer?.setTime?.(state.currentTime); } catch (_) { /* ignore */ }
    updateTimelineUi();
    return state.currentTime;
  }

  function seekTimelineTime(time) {
    const next = observeNativeTime(time);
    if (elements.audio && Number.isFinite(next)) {
      try { elements.audio.currentTime = next; } catch (_) { /* ignore */ }
    }
    return next;
  }

  function playNativeAudio() {
    const audio = elements.audio;
    if (!audio?.src) return;
    const playbackRate = Number(elements.playbackSpeed?.value || 1);
    audio.playbackRate = playbackRate;
    try { state.waveSurfer?.setPlaybackRate?.(playbackRate); } catch (_) { /* native audio remains authoritative */ }
    const nativePlay = audio.play?.();
    if (nativePlay?.catch) nativePlay.catch(() => setStatus('Playback is unavailable for this recording.', 'error'));
    updateTimelineUi();
  }

  function stopPlayback() {
    try { elements.audio?.pause?.(); } catch (_) { /* ignore */ }
    if (state.playTimer) { clearInterval(state.playTimer); state.playTimer = null; }
  }

  function pauseNativeAudio() {
    stopPlayback();
    updateTimelineUi();
  }

  function setTimelinePoint(point, time = state.currentTime) {
    const duration = timelineDuration();
    const value = Math.max(0, Math.min(duration || Number(time) || 0, Number(time) || 0));
    state[point] = Number(value.toFixed(6));
    state.abArm = null;
    updateTimelineUi();
    return state[point];
  }

  function armTimelinePoint(point) {
    if (!state.audioBlob || !timelineDuration()) return;
    setTimelinePoint(point === 'a' ? 'pointA' : 'pointB', state.currentTime);
    state.abArm = state.abArm === point ? null : point;
    setStatus(`Click the timeline to set ${point.toUpperCase()}.`);
    updateTimelineUi();
  }

  function handleTimelineInteraction(rawTime, source = 'waveform') {
    const duration = timelineDuration();
    const time = Math.max(0, Math.min(duration || Number(rawTime) || 0, Number(rawTime) || 0));
    if (state.abArm) {
      const arm = state.abArm;
      setTimelinePoint(arm === 'a' ? 'pointA' : 'pointB', time);
      setStatus(`${arm === 'a' ? 'A' : 'B'} marker set at ${formatTimelineTime(time)}.`);
      return;
    }
    if (state.activeVersion === 'manual') {
      addManualBoundary(time);
      return;
    }
    state.lastWaveInteractionTime = time;
    state.lastWaveInteractionAt = Date.now();
    seekTimelineTime(time);
    playNativeAudio();
    if (source === 'spectrogram') setStatus(`Playing from ${formatTimelineTime(time)}.`);
  }

  function timelinePointFromEvent(event, surface) {
    const rect = surface?.getBoundingClientRect?.();
    const duration = timelineDuration();
    if (!rect || !rect.width || !duration) return 0;
    return ((Number(event.clientX) - rect.left) / rect.width) * duration;
  }

  function playPause() {
    if (!state.audioBlob || !elements.audio?.src) return;
    if (elements.audio.paused) {
      if (state.currentTime >= timelineDuration() - 0.001) seekTimelineTime(0);
      playNativeAudio();
    } else pauseNativeAudio();
  }

  function playAB() {
    if (!Number.isFinite(state.pointA) || !Number.isFinite(state.pointB) || state.pointB <= state.pointA) return;
    if (state.playTimer) clearInterval(state.playTimer);
    seekTimelineTime(state.pointA);
    playNativeAudio();
    state.playTimer = setInterval(() => {
      const current = Number(elements.audio?.currentTime || state.currentTime || 0);
      observeNativeTime(current);
      if (current >= state.pointB - 0.005) {
        if (state.loopAB) seekTimelineTime(state.pointA);
        else pauseNativeAudio();
      }
    }, 25);
  }

  function clearAB() {
    if (state.playTimer) pauseNativeAudio();
    state.pointA = null;
    state.pointB = null;
    state.abArm = null;
    state.loopAB = false;
    updateTimelineUi();
  }

  function updateButtons() {
    const hasTask = Boolean(state.task?.taskId);
    const hasAudio = Boolean(state.audioBlob);
    const hasAnalysis = completeComparisonReady();
    const exposureReady = versionExposureProofReady();
    const judgmentReady = state.mode === 'previous' || automaticJudgmentReady();
    const completeManual = state.manualSegments.length === Number(state.task?.targetSyllableCount || 0);
    const certainty = elements?.certainty?.()?.value || '';
    const playbackConfirmed = Boolean(elements?.playbackConfirmed?.checked || state.playbackConfirmed);
    const canSave = hasTask && hasAudio && state.visualizationReady && hasAnalysis && exposureReady && judgmentReady && captureSettingsReady() && completeManual && playbackConfirmed && Boolean(certainty) && !state.manualReviewSaved;
    if (elements.claim) elements.claim.disabled = !state.operatorName || hasTask || state.mode === 'previous';
    if (elements.release) elements.release.disabled = !hasTask || state.mode === 'previous';
    if (elements.record) elements.record.disabled = !hasTask || state.mode === 'previous' || state.recording;
    if (elements.stop) elements.stop.disabled = !state.recording;
    if (elements.redo) elements.redo.disabled = !hasAudio || state.recording;
    if (elements.analyze) elements.analyze.disabled = !hasAudio || state.recording;
    if (elements.save) {
      elements.save.disabled = !canSave;
      const exposureMessage = hasTask && hasAudio && hasAnalysis && !exposureReady ? exposureRequirementMessage() : '';
      elements.save.title = exposureMessage;
      elements.save.setAttribute('aria-label', exposureMessage ? `Save sample (${exposureMessage})` : 'Save sample');
      if (hasTask && hasAudio && hasAnalysis && !state.visualizationReady) setStatus(waveformUnavailableMessage(), 'warning');
      else if (exposureMessage) setStatus(exposureMessage, 'warning');
      else if (hasTask && hasAudio && hasAnalysis && exposureReady && !judgmentReady) setStatus('All automatic versions viewed. Choose the best automatic version(s), or None acceptable, before saving.', 'warning');
      else if (hasTask && hasAudio && hasAnalysis && elements.status?.textContent?.startsWith('Next required automatic view:')) setStatus('All automatic versions viewed. Complete the manual review to save.', 'success');
    }
    if (elements.next) elements.next.disabled = !state.manualReviewSaved;
    if (elements.manualUndo) elements.manualUndo.disabled = !state.manualBoundaries.length;
    if (elements.manualClear) elements.manualClear.disabled = !state.manualBoundaries.length;
    updateJudgmentUi();
    updateTimelineUi();
  }

  function clearCertainty() {
    document.querySelectorAll('input[name="segmentation-study-certainty"]').forEach((input) => { input.checked = false; });
  }

  function resetTaskState() {
    stopPlayback();
    destroyVisualization();
    stopHeartbeat();
    cleanupRecording();
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.audioBlob = null;
    state.audioUrl = null;
    state.comparison = null;
    state.analysisFailed = false;
    state.captureSettings = null;
    state.versionExposureLog = [];
    state.exposureTaskId = '';
    state.playbackConfirmed = false;
    state.visualizationReady = false;
    state.manualBoundaries = [];
    state.manualSegments = [];
    state.selectedBoundaryIndex = -1;
    state.manualReviewSaved = false;
    state.currentTime = 0;
    state.pointA = null;
    state.pointB = null;
    state.abArm = null;
    state.loopAB = false;
    state.automaticJudgmentJudgedAt = null;
    state.lastWaveInteractionAt = 0;
    state.lastWaveInteractionTime = null;
    clearCertainty();
    if (elements.audio) { elements.audio.hidden = true; elements.audio.removeAttribute('src'); }
    if (elements.word) elements.word.textContent = 'No word claimed';
    if (elements.reference) elements.reference.textContent = 'The selected word and IPA will appear here.';
    if (elements.claimStatus) elements.claimStatus.textContent = 'Not reserved';
    if (elements.captureStatus) elements.captureStatus.textContent = 'Capture settings unavailable.';
    if (elements.playbackConfirmed) elements.playbackConfirmed.checked = false;
    if (elements.summary) elements.summary.textContent = '';
    if (elements.timelineEmpty) {
      elements.timelineEmpty.hidden = false;
      elements.timelineEmpty.textContent = 'Record or load a sample to see its waveform and spectrogram.';
    }
    clearRegions();
    clearAutomaticJudgmentInputs();
    updateTimelineUi();
    updateManualUi();
  }

  function renderTask() {
    const task = state.task;
    if (!task) { resetTaskState(); updateButtons(); return; }
    const order = automaticVersionOrder(task);
    if (state.exposureTaskId !== task.taskId) {
      state.exposureTaskId = task.taskId;
      state.versionExposureLog = [];
    }
    applyAutomaticVersionOrder(order);
    selectVersion(order[0], { recordExposure: false });
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

  async function claimNext(taskId = '') {
    if (!state.operatorName) { setStatus('Enter your name before claiming a word.', 'error'); elements.operator?.focus(); return; }
    try {
      elements.claim.disabled = true;
      const body = { operatorName: state.operatorName, sessionId: state.sessionId };
      const requestedTaskId = String(taskId || '').trim();
      if (requestedTaskId) body.taskId = requestedTaskId;
      const payload = await apiFetch(studyApiPath('claim-next'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
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
      stopPlayback();
      destroyVisualization();
      cleanupRecording();
      if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
      state.audioUrl = null;
      state.audioBlob = null;
      state.comparison = null;
      state.analysisFailed = false;
      state.captureSettings = null;
      state.captureEligibility = false;
      state.versionExposureLog = [];
      state.activeVersion = automaticVersionOrder(state.task)[0];
      state.visualizationReady = false;
      state.playbackConfirmed = false;
      state.manualBoundaries = [];
      state.manualSegments = [];
      state.manualReviewSaved = false;
      state.currentTime = 0;
      state.pointA = null;
      state.pointB = null;
      state.abArm = null;
      state.loopAB = false;
      state.automaticJudgmentJudgedAt = null;
      clearAutomaticJudgmentInputs();
      clearCertainty();
      if (elements.audio) { elements.audio.hidden = true; elements.audio.removeAttribute('src'); }
      if (elements.playbackConfirmed) elements.playbackConfirmed.checked = false;
      state.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const track = state.stream.getAudioTracks?.()[0] || state.stream.getTracks?.()[0];
      state.captureSettings = sanitizeCaptureSettings(track?.getSettings?.());
      state.captureEligibility = state.captureSettings?.echoCancellation === false
        && state.captureSettings?.noiseSuppression === false
        && state.captureSettings?.autoGainControl === false;
      if (elements.captureStatus) {
        elements.captureStatus.textContent = captureSettingsReady()
          ? 'Raw capture settings verified (AEC, noise suppression, and auto gain control off).'
          : 'Capture settings unavailable or enabled; Save is blocked.';
      }
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
    if (elements.timelineEmpty) {
      elements.timelineEmpty.hidden = false;
      elements.timelineEmpty.textContent = 'Record or load a sample to see its waveform and spectrogram.';
    }
    await loadWaveform(state.audioBlob);
    updateButtons();
  }

  async function redoRecording() {
    stopPlayback();
    destroyVisualization();
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.audioBlob = null; state.audioUrl = null; state.comparison = null; state.analysisFailed = false; state.captureSettings = null; state.captureEligibility = false; state.playbackConfirmed = false; state.versionExposureLog = []; state.activeVersion = automaticVersionOrder(state.task)[0]; state.manualBoundaries = []; state.manualSegments = []; state.selectedBoundaryIndex = -1; state.manualReviewSaved = false; state.visualizationReady = false; state.currentTime = 0; state.pointA = null; state.pointB = null; state.abArm = null; state.loopAB = false; state.automaticJudgmentJudgedAt = null;
    clearAutomaticJudgmentInputs();
    clearCertainty();
    if (elements.audio) { elements.audio.hidden = true; elements.audio.removeAttribute('src'); }
    clearRegions();
    setAnalysisStatus('Analysis is required before review.');
    if (elements.recordStatus) elements.recordStatus.textContent = 'No recording yet.';
    if (elements.captureStatus) elements.captureStatus.textContent = 'Capture settings unavailable.';
    if (elements.playbackConfirmed) elements.playbackConfirmed.checked = false;
    if (elements.timelineEmpty) { elements.timelineEmpty.hidden = false; elements.timelineEmpty.textContent = 'Record or load a sample to see its waveform and spectrogram.'; }
    updateManualUi(); updateTimelineUi(); updateButtons();
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
    if (version === 'v4') {
      const v3 = state.comparison?.v3?.analysis || null;
      const variant = v3?.partitionVariants?.v4;
      const v4AnalysisVersion = v3?.partitionVariants?.v4AnalysisVersion || v3?.partitionVariants?.v4_analysis_version;
      if (!v3 || !Array.isArray(variant) || !v4AnalysisVersion) return null;
      return {
        ...v3,
        analysisVersion: v4AnalysisVersion,
        observed_syllables: variant
      };
    }
    const direct = state.comparison?.[version]?.analysis;
    if (direct) return direct;
    return null;
  }

  function applyAutomaticVersionOrder(order) {
    const versions = automaticVersionOrder({ automaticVersionOrder: order });
    const tabContainer = elements.tabs[0]?.parentElement;
    if (!tabContainer) return;
    versions.concat('manual').forEach((version) => {
      const tab = elements.tabs.find((item) => item.dataset.studyVersion === version);
      if (tab) tabContainer.appendChild(tab);
    });
    elements.tabs = Array.from(tabContainer.querySelectorAll('[data-study-version]'));
  }

  function v4Provenance() {
    const partition = state.comparison?.v3?.analysis?.partitionVariants;
    const directWrapper = state.comparison?.v4;
    const direct = directWrapper?.analysis || directWrapper;
    if (!partition || !Array.isArray(partition.v4) || !direct) return null;
    const sourceValues = [direct.source, direct.provenance?.source, directWrapper.source, directWrapper.provenance?.source].filter(Boolean);
    const schemaValues = [direct.schemaVersion, direct.schema_version, direct.partitionSchemaVersion, direct.partition_schema_version,
      direct.provenance?.schemaVersion, direct.provenance?.schema_version, directWrapper.schemaVersion, directWrapper.schema_version,
      directWrapper.partitionSchemaVersion, directWrapper.partition_schema_version, directWrapper.provenance?.schemaVersion, directWrapper.provenance?.schema_version].filter(Boolean);
    const variantValues = [direct.variant, direct.provenance?.variant, directWrapper.variant, directWrapper.provenance?.variant].filter(Boolean);
    const allMatch = (values, expected) => values.length > 0 && values.every((value) => value === expected);
    const analysisVersion = partition.v4AnalysisVersion || partition.v4_analysis_version;
    if (partition.schemaVersion !== 'pronunciation-partition-variants-v2'
      || !analysisVersion
      || !allMatch(sourceValues, 'partitionVariants.v4')
      || !allMatch(schemaValues, partition.schemaVersion)
      || !allMatch(variantValues, 'v4')) return null;
    return { source: sourceValues[0], schemaVersion: partition.schemaVersion, variant: variantValues[0], analysisVersion };
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
    const provenance = version === 'v4' ? v4Provenance() : null;
    if (version === 'v4' && !provenance) {
      panel.textContent = 'V4 is unavailable: authoritative partition provenance is missing.';
      return;
    }
    const line = document.createElement('div');
    line.textContent = `${version.toUpperCase()} · ${spans.length} syllables · ${analysis.analysisVersion || analysis.analysis_version || 'analysis revision unavailable'}`;
    panel.appendChild(line);
    if (provenance) {
      const provenanceLine = document.createElement('div');
      provenanceLine.className = 'crm-muted segmentation-study-v4-provenance';
      provenanceLine.textContent = `V4 provenance · source ${provenance.source} · schema ${provenance.schemaVersion} · variant ${provenance.variant} · analysis ${provenance.analysisVersion}`;
      panel.appendChild(provenanceLine);
    }
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
    seekTimelineTime(Math.max(0, start));
    const stopAt = Math.max(start, end);
    state.playTimer = setInterval(() => {
      const current = Number(audio.currentTime || state.currentTime || 0);
      observeNativeTime(current);
      if (current >= stopAt - 0.01) {
        if (state.loopAB && Number.isFinite(state.pointA) && Number.isFinite(state.pointB) && Math.abs(start - state.pointA) < 0.001 && Math.abs(end - state.pointB) < 0.001) {
          seekTimelineTime(state.pointA);
        } else {
          pauseNativeAudio();
        }
      }
    }, 25);
    playNativeAudio();
  }

  function clearRegions() {
    try { state.regions?.clearRegions?.(); } catch (_) { /* ignore */ }
  }

  function destroyVisualization() {
    state.visualizationAttemptId += 1;
    const wave = state.waveSurfer;
    state.waveSurfer = null;
    state.regions = null;
    state.spectrogram = null;
    state.timeline = null;
    try { wave?.destroy?.(); } catch (_) { /* ignore stale WaveSurfer instances */ }
    elements.waveform?.replaceChildren();
    elements.spectrogram?.replaceChildren();
    elements.timelineRuler?.replaceChildren();
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

  function selectVersion(version, options = {}) {
    let exposureChanged = false;
    if (options.recordExposure !== false && ['v2', 'v3', 'v4'].includes(version) && state.task?.taskId) {
      const alreadyViewed = state.versionExposureLog.some((entry) => entry.version === version);
      if (!alreadyViewed) {
        const expectedVersion = nextAutomaticExposureVersion();
        if (version !== expectedVersion) {
          setStatus(`View ${expectedVersion?.toUpperCase() || 'the remaining automatic version'} before ${version.toUpperCase()} to preserve ordered exposure evidence.`, 'error');
          return false;
        }
        if (state.comparison) {
          state.versionExposureLog.push({
            version,
            automaticOrder: state.task.automaticOrder || null,
            viewedAt: new Date().toISOString()
          });
          exposureChanged = true;
        }
      }
    }
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
    if (exposureChanged) updateButtons();
  }

  async function loadWaveform(blob) {
    destroyVisualization();
    const attemptId = state.visualizationAttemptId;
    const isCurrentAttempt = () => state.visualizationAttemptId === attemptId;
    state.visualizationReady = false;
    if (elements.timelineEmpty) {
      elements.timelineEmpty.hidden = false;
      elements.timelineEmpty.textContent = 'Loading waveform…';
    }
    if (elements.retryVisualization) elements.retryVisualization.hidden = true;
    if (!elements.waveform || !window.WaveSurfer) {
      markVisualizationUnavailable();
      updateButtons();
      return false;
    }
    try {
      if (!(blob instanceof Blob)) throw new TypeError('Waveform visualization requires the original audio Blob.');
      elements.waveform.replaceChildren();
      elements.spectrogram?.replaceChildren();
      const plugins = [];
      state.waveSurfer = WaveSurfer.create({ container: elements.waveform, waveColor: '#64748b', progressColor: '#2563eb', height: 96, normalize: true, plugins });
      const waveSurfer = state.waveSurfer;
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
      let readySettled = false;
      let visualizationAttemptActive = true;
      let resolveReady;
      const readyPromise = new Promise((resolve) => { resolveReady = resolve; });
      const settleReady = (ready) => {
        if (readySettled) return;
        readySettled = true;
        resolveReady(Boolean(ready));
      };
      state.waveSurfer.on('ready', async () => {
        if (!visualizationAttemptActive || !isCurrentAttempt()) return;
        const ready = await waitForVisualizationSurfaces();
        if (!visualizationAttemptActive || !isCurrentAttempt()) return;
        if (!ready) {
          markVisualizationUnavailable();
          settleReady(false);
          updateButtons();
          return;
        }
        state.visualizationReady = true;
        if (elements.timelineEmpty) elements.timelineEmpty.hidden = true;
        if (elements.retryVisualization) elements.retryVisualization.hidden = true;
        selectVersion(state.activeVersion);
        updateTimelineUi();
        updateButtons();
        settleReady(true);
      });
      state.waveSurfer.on('interaction', (time) => {
        if (!isCurrentAttempt()) return;
        state.lastWaveInteractionTime = Number(time);
        state.lastWaveInteractionAt = Date.now();
        handleTimelineInteraction(Number(time), 'waveform');
      });
      state.waveSurfer.on('region-updated', (region) => { if (isCurrentAttempt()) syncManualFromRegion(region); });
      state.waveSurfer.on('region-update-end', (region) => { if (isCurrentAttempt()) syncManualFromRegion(region, true); });
      state.waveSurfer.on('error', () => {
        if (!isCurrentAttempt()) return;
        visualizationAttemptActive = false;
        markVisualizationUnavailable();
        settleReady(false);
        updateButtons();
      });
      const loadError = { value: null };
      const loadPromise = Promise.resolve().then(() => waveSurfer.loadBlob(blob)).catch((error) => { loadError.value = error; return null; });
      const loadTimeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), VISUALIZATION_READY_TIMEOUT_MS));
      const loadResult = await Promise.race([loadPromise.then(() => 'loaded'), loadTimeout]);
      if (!isCurrentAttempt()) return false;
      if (loadResult === 'timeout' || loadError.value) {
        visualizationAttemptActive = false;
        markVisualizationUnavailable();
        settleReady(false);
        updateButtons();
        return false;
      }
      const ready = await Promise.race([readyPromise, new Promise((resolve) => setTimeout(() => resolve(false), VISUALIZATION_READY_TIMEOUT_MS))]);
      if (!isCurrentAttempt()) return false;
      if (!ready) {
        visualizationAttemptActive = false;
        markVisualizationUnavailable();
      }
      return Boolean(ready && state.visualizationReady);
    } catch (error) {
      if (!isCurrentAttempt()) return false;
      markVisualizationUnavailable();
      updateButtons();
      return false;
    }
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
      if (!completeComparisonReady()) throw new Error('The analyzer did not return complete V2/V3/V4 data with the expected syllable counts and provenance.');
      setAnalysisStatus('V2, V3, and V4 data loaded. Automatic boundaries remain visible for comparison.', 'success');
      ['v2', 'v3', 'v4'].forEach(renderPanel);
      selectVersion(state.activeVersion);
      updateButtons();
      if (!state.visualizationReady) setStatus(waveformUnavailableMessage(), 'warning');
    } catch (error) {
      state.comparison = null;
      state.analysisFailed = true;
      setAnalysisStatus(`Analysis failed: ${error.message}. You can retry without re-recording.`, 'error');
      updateButtons();
    } finally { elements.analyze.disabled = !state.audioBlob; }
  }

  function manualMetadata() {
    const first = state.manualSegments[0];
    const last = state.manualSegments.at(-1);
    const variantProvenance = Object.fromEntries(['v2', 'v3', 'v4'].map((version) => {
      const analysis = analysisForVersion(version) || {};
      const schemaVersion = version === 'v2'
        ? state.comparison?.schemaVersion
        : state.comparison?.v3?.analysis?.partitionVariants?.schemaVersion;
      return [version, {
        schemaVersion,
        variant: version,
        analysisVersion: analysis.analysisVersion || analysis.analysis_version || '',
        source: version === 'v2' ? 'comparison.v2' : `partitionVariants.${version}`
      }];
    }));
    return {
      manualSegments: state.manualSegments,
      manualSegmentationConvention: 'ipa-phonological-contiguous-v1',
      certainty: elements.certainty?.()?.value || 'uncertain',
      automaticBoundariesVisible: true,
      annotationProtocol: 'automatic-visible-assisted-v1',
      playbackConfirmed: Boolean(elements.playbackConfirmed?.checked || state.playbackConfirmed),
      captureSettings: sanitizeCaptureSettings(state.captureSettings),
      getSettings: sanitizeCaptureSettings(state.captureSettings),
      captureConstraintsRequested: CAPTURE_CONSTRAINTS_REQUESTED,
      captureEligibility: captureSettingsReady(),
      wordBounds: first && last ? { startTime: first.startTime, endTime: last.endTime } : null,
      manifestVersion: state.manifestVersion,
      manifestSha256: state.manifestSha256,
      automaticOrder: state.task?.automaticOrder || null,
      automaticVersionOrder: state.task?.automaticVersionOrder || [],
      dialect: state.task?.dialect || state.dialect || 'en-US',
      referenceLabelProvenance: REFERENCE_LABEL_PROVENANCE,
      variantProvenance,
      exposureLog: Array.isArray(state.task?.exposureLog) ? state.task.exposureLog : [],
      versionExposureLog: state.versionExposureLog,
      automaticJudgment: automaticJudgmentMetadata(),
      reviewStatus: elements.certainty?.()?.value === 'uncertain' ? 'uncertain' : 'complete',
      reviewerName: state.operatorName,
      reviewerSessionId: state.sessionId
    };
  }

  async function save() {
    const judgmentReady = state.mode === 'previous' || automaticJudgmentReady();
    if (!state.task || !state.audioBlob || !state.manualSegments.length || !state.visualizationReady || !completeComparisonReady() || !versionExposureProofReady() || !judgmentReady || !captureSettingsReady() || !(elements.playbackConfirmed?.checked || state.playbackConfirmed)) {
      setStatus(!state.visualizationReady ? waveformUnavailableMessage() : (!versionExposureProofReady() ? exposureRequirementMessage() : (!judgmentReady ? 'Choose the best automatic version(s), or None acceptable, before saving.' : 'Save requires playback confirmation, verified raw capture settings, and complete V2/V3/V4 analysis.')), 'error');
      updateButtons();
      return;
    }
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
          studyVersion: state.studyVersion || ACTIVE_STUDY.internalVersion,
          studyId: state.studyId || ACTIVE_STUDY.studyId,
          taskId: state.task.taskId,
          sessionId: state.sessionId,
          operatorName: state.operatorName,
          targetWord: state.task.targetWord,
          referenceIpa: state.task.referenceIpa,
          referenceSyllableIpa: state.task.referenceSyllableIpa,
          targetSyllableCount: state.task.targetSyllableCount,
          expectedObservedCount: state.task.targetSyllableCount,
          category: 'clean',
          speakerCohort: state.task.speakerCohort || `${ACTIVE_STUDY.internalVersion}-clean`,
          analysisStatus: 'complete',
          comparison: state.comparison,
          analysisRevision: state.comparison?.v3?.analysis?.analysisVersion || state.comparison?.v2?.analysis?.analysisVersion || 'comparison-analysis-v2',
          rawCtcSpans: state.comparison?.v3?.analysis?.rawCtcSpans || state.comparison?.v3?.analysis?.observed_syllables || null,
          measurementSpans: state.comparison?.v3?.analysis?.measurementSpans || null,
          v2: state.comparison?.v2?.analysis || null,
          v3: state.comparison?.v3?.analysis?.partitionVariants?.v3 || null,
          v4: state.comparison?.v3?.analysis?.partitionVariants?.v4 || null,
          automaticBoundariesVisible: true,
          ...review,
          manualSegments: state.manualSegments,
          needsManualReview: review.certainty === 'uncertain'
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
      await loadWaveform(state.audioBlob);
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
    elements.claim.addEventListener('click', () => claimNext());
    elements.release.addEventListener('click', releaseTask);
    elements.refresh.addEventListener('click', refresh);
    elements.record.addEventListener('click', startRecording);
    elements.stop.addEventListener('click', stopRecording);
    elements.redo.addEventListener('click', redoRecording);
    elements.analyze.addEventListener('click', analyze);
    elements.save.addEventListener('click', save);
    elements.retryVisualization?.addEventListener('click', async () => {
      if (!state.audioBlob) return;
      setStatus('Retrying waveform and spectrogram visualization…');
      await loadWaveform(state.audioBlob);
      if (state.visualizationReady) setStatus('Waveform and spectrogram visualization restored.', 'success');
    });
    elements.playPause?.addEventListener('click', playPause);
    elements.setA?.addEventListener('click', () => armTimelinePoint('a'));
    elements.setB?.addEventListener('click', () => armTimelinePoint('b'));
    elements.playAB?.addEventListener('click', playAB);
    elements.loopAB?.addEventListener('click', () => { state.loopAB = !state.loopAB; updateTimelineUi(); });
    elements.clearAB?.addEventListener('click', clearAB);
    elements.playbackSpeed?.addEventListener('change', () => {
      const playbackRate = Number(elements.playbackSpeed.value || 1);
      if (elements.audio) elements.audio.playbackRate = playbackRate;
      try { state.waveSurfer?.setPlaybackRate?.(playbackRate); } catch (_) { /* native audio remains authoritative */ }
    });
    elements.waveform?.addEventListener('click', (event) => {
      const time = timelinePointFromEvent(event, elements.waveform);
      if (Date.now() - state.lastWaveInteractionAt < 50 && Math.abs(time - Number(state.lastWaveInteractionTime || 0)) < 0.02) return;
      handleTimelineInteraction(time, 'waveform');
    });
    elements.spectrogram?.addEventListener('click', (event) => handleTimelineInteraction(timelinePointFromEvent(event, elements.spectrogram), 'spectrogram'));
    elements.audio?.addEventListener('timeupdate', () => {
      observeNativeTime(Number(elements.audio.currentTime || 0));
      if (state.loopAB && Number.isFinite(state.pointA) && Number.isFinite(state.pointB) && Number(elements.audio.currentTime) >= state.pointB - 0.005) {
        seekTimelineTime(state.pointA);
        playNativeAudio();
      }
    });
    elements.audio?.addEventListener('play', updateTimelineUi);
    elements.audio?.addEventListener('pause', updateTimelineUi);
    elements.audio?.addEventListener('ended', () => {
      if (state.loopAB && Number.isFinite(state.pointA) && Number.isFinite(state.pointB)) playAB();
      else updateTimelineUi();
    });
    elements.next.addEventListener('click', async () => { state.task = null; resetTaskState(); state.mode = 'record'; await refresh(); });
    elements.tabs.forEach((tab) => {
      tab.addEventListener('click', () => selectVersion(tab.dataset.studyVersion || 'v2'));
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = elements.tabs.indexOf(tab);
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
    document.querySelectorAll('[data-automatic-judgment-version], [data-automatic-judgment-none]').forEach((input) => input.addEventListener('change', () => {
      if (input.dataset.automaticJudgmentNone === 'true' && input.checked) {
        document.querySelectorAll('[data-automatic-judgment-version]').forEach((item) => { item.checked = false; });
      } else if (input.dataset.automaticJudgmentVersion && input.checked && elements.automaticJudgmentNone) {
        elements.automaticJudgmentNone.checked = false;
      }
      if (!versionExposureProofReady()) input.checked = false;
      else state.automaticJudgmentJudgedAt = new Date().toISOString();
      updateButtons();
    }));
    elements.playbackConfirmed?.addEventListener('change', () => { state.playbackConfirmed = elements.playbackConfirmed.checked; updateButtons(); });
    window.addEventListener('pagehide', () => { stopPlayback(); destroyVisualization(); stopHeartbeat(); cleanupRecording(); });
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
