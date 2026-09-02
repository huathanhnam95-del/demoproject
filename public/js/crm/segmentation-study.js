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
  // One colour per version, reused by the lane strip, the ghost boundary ticks
  // and the delta table so a reviewer only has to learn the mapping once.
  const VERSION_COLORS = Object.freeze({ v2: '#2563eb', v3: '#10b981', v4: '#8b5cf6', manual: '#f59e0b' });
  const COMPARISON_VERSIONS = Object.freeze(['v2', 'v3', 'v4', 'manual']);
  // Anything shorter than this is a mis-click rather than a deliberate drag.
  const AB_MIN_DURATION = 0.02;
  const AB_DRAG_THRESHOLD_PX = 8;

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
    // Playback: a monotonic token invalidates any in-flight loop pass so a new
    // play request never races with the previous one's scheduled restart.
    playbackToken: 0,
    playbackRafId: null,
    loopTimer: null,
    activePlayRange: null,
    liveManualRaf: null,
    loopEnabled: false,
    // Transient A–B listening selection. Never persisted with the review.
    abRegion: null,
    abStart: null,
    abEnd: null,
    showGhosts: true,
    automaticJudgmentJudgedAt: null
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
      queueDetails: byId('segmentation-study-queue-details'),
      queueCount: byId('segmentation-study-queue-count'),
      steps: byId('segmentation-study-steps'),
      step: byId('segmentation-study-step'),
      word: byId('segmentation-study-word'),
      reference: byId('segmentation-study-reference'),
      claimStatus: byId('segmentation-study-claim-status'),
      record: byId('segmentation-study-record'),
      stop: byId('segmentation-study-stop'),
      redo: byId('segmentation-study-redo'),
      audio: byId('segmentation-study-audio'),
      playbackSpeed: byId('segmentation-study-playback-speed'),
      loopGap: byId('segmentation-study-loop-gap'),
      play: byId('segmentation-study-play'),
      loop: byId('segmentation-study-loop'),
      abReadout: byId('segmentation-study-ab-readout'),
      abClear: byId('segmentation-study-ab-clear'),
      recordStatus: byId('segmentation-study-record-status'),
      captureStatus: byId('segmentation-study-capture-status'),
      playbackConfirmed: byId('segmentation-study-playback-confirmed'),
      analyze: byId('segmentation-study-analyze'),
      analysisStatus: byId('segmentation-study-analysis-status'),
      tabs: Array.from(document.querySelectorAll('[data-study-version]')),
      compareTab: byId('segmentation-study-tab-compare'),
      waveform: byId('segmentation-study-waveform'),
      ghosts: byId('segmentation-study-ghosts'),
      ghostToggle: byId('segmentation-study-ghost-toggle'),
      judgmentStatus: byId('segmentation-study-judgment-status'),
      automaticJudgment: () => Array.from(document.querySelectorAll('[data-automatic-judgment-version]:checked')),
      automaticJudgmentNone: byId('segmentation-study-automatic-judgment-none'),
      lanes: byId('segmentation-study-lanes'),
      deltas: byId('segmentation-study-deltas'),
      checklist: byId('segmentation-study-checklist'),
      spectrogram: byId('segmentation-study-spectrogram'),
      timelineRuler: byId('segmentation-study-time-ruler'),
      timeline: byId('segmentation-study-timeline'),
      timelineEmpty: byId('segmentation-study-timeline-empty'),
      panels: {
        v2: byId('segmentation-study-panel-v2'),
        v3: byId('segmentation-study-panel-v3'),
        v4: byId('segmentation-study-panel-v4'),
        manual: byId('segmentation-study-panel-manual'),
        compare: byId('segmentation-study-panel-compare')
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
    setStatus(message, 'warning');
  }

  function renderedCanvasReady(container) {
    const canvas = container?.querySelector('canvas');
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    return Number(canvas.width) > 0 && Number(canvas.height) > 0 && rect.width > 0 && rect.height > 0;
  }

  function visualizationSurfacesReady() {
    return Number(state.waveSurfer?.getDuration?.()) > 0
      && renderedCanvasReady(elements.waveform)
      && renderedCanvasReady(elements.spectrogram);
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

  function allAutomaticVersionsViewed() {
    return ['v2', 'v3', 'v4'].every((version) => state.versionExposureLog.some((entry) => entry.version === version));
  }

  // A study task carries a server-issued automaticOrder to prove the reviewer
  // saw the versions in the assigned order. A stored sample reopened for review
  // has no such token, so there the proof is simply having viewed all three —
  // selectVersion() enforces the order either way.
  function exposureViewingComplete() {
    return state.mode === 'previous' ? allAutomaticVersionsViewed() : versionExposureProofReady();
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

  // `computeCompleteComparisonReady` deep-walks the whole comparison payload
  // (pitch and intensity contours, phoneme lists) twice. It is called several
  // times per updateButtons(), and updateButtons() runs on every boundary
  // nudge, so the result is cached against the comparison object identity —
  // the payload is only ever replaced wholesale by analyze() or cleared.
  let comparisonReadyCache = { comparison: undefined, expected: -1, value: false };

  function completeComparisonReady() {
    const expected = Number(state.task?.targetSyllableCount || 0);
    if (comparisonReadyCache.comparison === state.comparison && comparisonReadyCache.expected === expected) {
      return comparisonReadyCache.value;
    }
    const value = computeCompleteComparisonReady();
    comparisonReadyCache = { comparison: state.comparison, expected, value };
    return value;
  }

  function computeCompleteComparisonReady() {
    const expected = Number(state.task?.targetSyllableCount || 0);
    if (!state.comparison || state.comparison.status !== 'complete') return false;
    if (state.comparison.schemaVersion !== 'pronunciation-comparison-v2' || !state.comparison.comparisonId || expected <= 0) return false;
    if (state.comparison.v3?.analysis?.partitionVariants?.schemaVersion !== 'pronunciation-partition-variants-v2') return false;
    if (!authoritativeV4MatchesDirect()) return false;
    if (!v4Provenance()) return false;
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
    if (elements.queueCount) {
      elements.queueCount.textContent = state.mode === 'previous'
        ? `(${items.length} previous ${items.length === 1 ? 'sample' : 'samples'})`
        : `(${state.progress?.available ?? items.filter((item) => item.status === 'available').length} available)`;
    }
    // The queue is the only way to pick a previous sample, and it is the only
    // thing to do before a word is claimed — otherwise it stays out of the way.
    if (elements.queueDetails) elements.queueDetails.open = state.mode === 'previous' || !state.task?.taskId;
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

  function clearAutomaticJudgmentInputs() {
    document.querySelectorAll('[data-automatic-judgment-version], [data-automatic-judgment-none]').forEach((input) => { input.checked = false; });
    state.automaticJudgmentJudgedAt = null;
    if (elements?.judgmentStatus) elements.judgmentStatus.textContent = 'Review all automatic versions before choosing.';
  }

  function automaticJudgmentSelection() {
    const selectedVersions = elements?.automaticJudgment?.()
      .map((input) => input.dataset.automaticJudgmentVersion)
      .filter((version) => ['v2', 'v3', 'v4'].includes(version)) || [];
    const none = Boolean(elements?.automaticJudgmentNone?.checked);
    if (!selectedVersions.length && !none) return null;
    if (none) return { selectedVersions: [], none: true };
    return { selectedVersions: Array.from(new Set(selectedVersions)).sort(), none: false };
  }

  function automaticJudgmentReady() {
    const selection = automaticJudgmentSelection();
    return state.mode === 'previous' || Boolean(versionExposureProofReady() && selection && (selection.none || selection.selectedVersions.length > 0));
  }

  function automaticJudgmentMetadata() {
    if (state.mode === 'previous') return null;
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
      input.disabled = state.mode === 'previous' || !exposureReady || !state.comparison;
    });
    if (elements?.judgmentStatus) {
      elements.judgmentStatus.textContent = state.mode === 'previous'
        ? 'Automatic judgment is not required for a stored sample.'
        : (exposureReady
          ? (selection ? 'Automatic judgment recorded for this session.' : 'Choose the best automatic version(s), or None acceptable.')
          : 'Review all automatic versions before choosing.');
    }
  }

  function updateButtons() {
    const hasTask = Boolean(state.task?.taskId);
    const hasAudio = Boolean(state.audioBlob);
    const hasAnalysis = completeComparisonReady();
    const exposureReady = exposureViewingComplete();
    const requirements = saveRequirements();
    const canSave = !outstandingRequirement(requirements) && !state.manualReviewSaved;
    renderSaveChecklist(requirements);
    renderStepRail();
    updateCompareTabAvailability();
    updateTransport();
    updateJudgmentUi();
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
      else if (hasTask && hasAudio && hasAnalysis && elements.status?.textContent?.startsWith('Next required automatic view:')) setStatus('All automatic versions viewed. Complete the manual review to save.', 'success');
    }
    if (elements.next) elements.next.disabled = !state.manualReviewSaved;
    if (elements.manualUndo) elements.manualUndo.disabled = !state.manualBoundaries.length;
    if (elements.manualClear) elements.manualClear.disabled = !state.manualBoundaries.length;
  }

  function clearCertainty() {
    document.querySelectorAll('input[name="segmentation-study-certainty"]').forEach((input) => { input.checked = false; });
  }

  // A recording, its analysis and every artefact derived from them are one
  // unit: starting a new take, redoing one, and claiming a new word all discard
  // exactly the same things. This lives in one place because three hand-rolled
  // copies had already drifted apart.
  function resetRecordingState() {
    stopPlayback();
    cancelLiveManualRender();
    clearAbSelection();
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.audioBlob = null;
    state.audioUrl = null;
    state.comparison = null;
    state.analysisFailed = false;
    state.captureSettings = null;
    state.captureEligibility = false;
    state.versionExposureLog = [];
    state.playbackConfirmed = false;
    state.visualizationReady = false;
    state.manualBoundaries = [];
    state.manualSegments = [];
    state.selectedBoundaryIndex = -1;
    state.manualReviewSaved = false;
    clearCertainty();
    clearAutomaticJudgmentInputs();
    clearRegions();
    setAnalysisStatus('Analysis is required before review.');
    if (elements.audio) { elements.audio.hidden = true; elements.audio.removeAttribute('src'); }
    if (elements.playbackConfirmed) elements.playbackConfirmed.checked = false;
    if (elements.captureStatus) elements.captureStatus.textContent = 'Capture settings unavailable.';
    if (elements.timelineEmpty) {
      elements.timelineEmpty.hidden = false;
      elements.timelineEmpty.textContent = 'Record or load a sample to see its waveform and spectrogram.';
    }
  }

  function renderDerivedViews() {
    renderGhostBoundaries();
    renderLaneStrip();
    renderDeltaTable();
  }

  function resetTaskState() {
    stopHeartbeat();
    cleanupRecording();
    resetRecordingState();
    state.exposureTaskId = '';
    if (elements.word) elements.word.textContent = 'No word claimed';
    if (elements.reference) elements.reference.textContent = 'The selected word and IPA will appear here.';
    if (elements.claimStatus) elements.claimStatus.textContent = 'Not reserved';
    if (elements.recordStatus) elements.recordStatus.textContent = 'No recording yet.';
    if (elements.summary) elements.summary.textContent = '';
    renderDerivedViews();
    updateTransport();
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
      resetRecordingState();
      state.activeVersion = automaticVersionOrder(state.task)[0];
      renderDerivedViews();
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
    resetRecordingState();
    state.activeVersion = automaticVersionOrder(state.task)[0];
    if (elements.recordStatus) elements.recordStatus.textContent = 'No recording yet.';
    renderDerivedViews();
    updateManualUi();
    updateButtons();
  }

  function spanStart(span) { return Number(span?.startTime ?? span?.start_time ?? span?.start); }
  function spanEnd(span) { return Number(span?.endTime ?? span?.end_time ?? span?.end); }
  function syllableId(span, version, index) {
    const supplied = span?.syllableId || span?.syllable_id || span?.syllableID || span?.id;
    return String(supplied || `${version}-syllable-${index + 1}`);
  }

  function syllableLabel(span, version, index) {
    if (version === 'v4') {
      // V4's exact phonological syllabification is intentionally independent
      // of the frozen study reference labels.
      return String(span?.ipa || span?.syllableIpa || `Syllable ${index + 1}`);
    }
    return String(state.task?.referenceSyllableIpa?.[index] || `Syllable ${index + 1}`);
  }

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
      if (Array.isArray(variant) && variant.length) {
        return {
          ...v3,
          analysisVersion: v4AnalysisVersion || 'pronunciation-analysis-v4',
          observed_syllables: variant
        };
      }
      // Historical samples may have persisted only a direct timing-only V4
      // analysis. Keep it displayable, but never upgrade it to V4.1 evidence.
      const direct = state.comparison?.v4?.analysis || state.comparison?.v4 || null;
      const directSpans = direct?.observed_syllables || direct?.observed?.syllables || direct?.syllables;
      if (Array.isArray(directSpans) && directSpans.length) {
        return {
          ...direct,
          analysisVersion: direct.analysisVersion || direct.analysis_version || 'pronunciation-analysis-v4',
          observed_syllables: directSpans
        };
      }
      return null;
    }
    const direct = state.comparison?.[version]?.analysis;
    if (direct) return direct;
    return null;
  }

  function applyAutomaticVersionOrder(order) {
    const versions = automaticVersionOrder({ automaticVersionOrder: order });
    const tabContainer = elements.tabs[0]?.parentElement;
    if (!tabContainer) return;
    versions.concat('manual', 'compare').forEach((version) => {
      const tab = elements.tabs.find((item) => item.dataset.studyVersion === version);
      if (tab) tabContainer.appendChild(tab);
    });
    elements.tabs = Array.from(tabContainer.querySelectorAll('[data-study-version]'));
  }

  function v4Provenance() {
    const partition = state.comparison?.v3?.analysis?.partitionVariants;
    const directWrapper = state.comparison?.v4;
    const direct = directWrapper?.analysis || directWrapper;
    const alignment = partition?.v4Alignment || partition?.v4_alignment;
    const envelope = alignment?.provenance || alignment?.v4Provenance || null;
    if (!partition || !Array.isArray(partition.v4) || !direct || !alignment || !envelope) return null;
    const sourceValues = [direct.source, direct.provenance?.source, directWrapper.source, directWrapper.provenance?.source].filter(Boolean);
    const schemaValues = [direct.schemaVersion, direct.schema_version, direct.partitionSchemaVersion, direct.partition_schema_version,
      direct.provenance?.schemaVersion, direct.provenance?.schema_version, directWrapper.schemaVersion, directWrapper.schema_version,
      directWrapper.partitionSchemaVersion, directWrapper.partition_schema_version, directWrapper.provenance?.schemaVersion, directWrapper.provenance?.schema_version].filter(Boolean);
    const variantValues = [direct.variant, direct.provenance?.variant, directWrapper.variant, directWrapper.provenance?.variant].filter(Boolean);
    const allMatch = (values, expected) => values.length > 0 && values.every((value) => value === expected);
    const analysisVersion = partition.v4AnalysisVersion || partition.v4_analysis_version;
    const syllabificationVersion = partition.v4SyllabificationVersion || partition.v4_syllabification_version;
    if (partition.schemaVersion !== 'pronunciation-partition-variants-v2'
      || !analysisVersion
      || syllabificationVersion !== 'pronunciation-syllabification-v1/en-US-weight-first-max-onset-v1'
      || !allMatch(sourceValues, 'partitionVariants.v4')
      || !allMatch(schemaValues, partition.schemaVersion)
      || !allMatch(variantValues, 'v4')
      || alignment.aligned !== true
      || envelope.schemaVersion !== 'pronunciation-syllabification-v1'
      || envelope.analysisVersion !== 'pronunciation-analysis-v4.1'
      || envelope.ruleVersion !== 'pronunciation-syllabification-v1/en-US-weight-first-max-onset-v1'
      || envelope.dialect !== 'en-US'
      || !envelope.originalIpa || !envelope.normalizedIpa || !envelope.displayIpa
      || !envelope.contentHash) return null;
    return { source: sourceValues[0], schemaVersion: partition.schemaVersion, variant: variantValues[0], analysisVersion, alignment, envelope };
  }

  function renderPanel(version) {
    const panel = elements.panels[version];
    if (!panel) return;
    panel.dataset.version = version;
    if (version === 'compare') { renderComparePanel(panel); return; }
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
    // One span accessor for the panel, the waveform overlay and the lane strip,
    // so the three can never disagree about where a boundary is.
    const spans = versionSpans(version);
    const analysis = analysisForVersion(version) || {};
    if (!spans.length) { panel.textContent = `${version.toUpperCase()} is unavailable for this recording.`; return; }
    const provenance = version === 'v4' ? v4Provenance() : null;
    const legacyV4 = version === 'v4' && !provenance;
    if (legacyV4) {
      panel.textContent = 'V4 is unavailable: authoritative partition provenance is missing.';
      const legacyLine = document.createElement('div');
      legacyLine.className = 'crm-muted segmentation-study-v4-provenance';
      legacyLine.textContent = 'Exact V4 syllabification unavailable for this legacy analysis.';
      panel.appendChild(legacyLine);
    }
    const line = document.createElement('div');
    line.textContent = `${version.toUpperCase()} · ${spans.length} syllables · ${analysis.analysisVersion || analysis.analysis_version || 'analysis revision unavailable'}`;
    panel.appendChild(line);
    if (provenance) {
      const provenanceLine = document.createElement('div');
      provenanceLine.className = 'crm-muted segmentation-study-v4-provenance';
      const envelope = provenance.envelope;
      provenanceLine.textContent = `V4 provenance · source ${provenance.source} · schema ${provenance.schemaVersion} · variant ${provenance.variant} · analysis ${provenance.analysisVersion} · rule ${envelope.ruleVersion || 'unavailable'} · onsets ${envelope.onsetInventoryVersion || 'unavailable'} · hash ${envelope.contentHash || 'unavailable'}`;
      panel.appendChild(provenanceLine);
    }
    if (version === 'v4' && provenance) {
      const inputLine = document.createElement('div');
      inputLine.className = 'segmentation-study-v4-input crm-muted';
      inputLine.textContent = `V4 input IPA · ${provenance.envelope.originalIpa || state.task?.referenceIpa || 'unavailable'}`;
      panel.appendChild(inputLine);

      const exactLine = document.createElement('div');
      exactLine.className = 'segmentation-study-v4-exact';
      const exactDisplay = provenance.envelope.displaySyllabification
        || provenance.envelope.exactSyllabification
        || `/${spans.map((span, index) => syllableLabel(span, version, index)).join('.')}/`;
      exactLine.textContent = `Exact V4 syllabification · ${exactDisplay}`;
      panel.appendChild(exactLine);

      const frozenLine = document.createElement('div');
      frozenLine.className = 'segmentation-study-v4-frozen-reference crm-muted';
      frozenLine.textContent = `Frozen study reference · ${(Array.isArray(state.task?.referenceSyllableIpa) ? state.task.referenceSyllableIpa : []).join(' · ') || 'unavailable'}`;
      panel.appendChild(frozenLine);

      const exactLabels = spans.map((span, index) => syllableLabel(span, version, index));
      const frozenLabels = Array.isArray(state.task?.referenceSyllableIpa) ? state.task.referenceSyllableIpa.map(String) : [];
      if (frozenLabels.length && exactLabels.join('|') !== frozenLabels.join('|')) {
        const mismatchLine = document.createElement('div');
        mismatchLine.className = 'segmentation-study-v4-mismatch';
        mismatchLine.textContent = 'V4 syllabification differs from the frozen study reference; review the exact V4 evidence below.';
        panel.appendChild(mismatchLine);
      }

      const evidenceLine = document.createElement('div');
      evidenceLine.className = 'segmentation-study-v4-evidence crm-muted';
      evidenceLine.textContent = spans.map((span, index) => {
        const ownership = span?.phoneIndexes || span?.phone_indexes || [];
        const range = span?.alignmentTokenRange || span?.alignment_token_range || {};
        return `${syllableId(span, version, index)} · phones [${ownership.join(', ')}] · token ${range.start ?? '?'}–${range.endExclusive ?? range.end ?? '?'} · ${span?.rule || 'rule unavailable'}`;
      }).join(' | ');
      panel.appendChild(evidenceLine);
    }
    if (version === 'v4' && !legacyV4 && !spans.every((span) => span?.ipa || span?.syllableIpa)) {
      const legacyLine = document.createElement('div');
      legacyLine.className = 'crm-muted segmentation-study-v4-provenance';
      legacyLine.textContent = 'Exact V4 syllabification unavailable for this legacy analysis.';
      panel.appendChild(legacyLine);
    }
    const labels = document.createElement('ol');
    labels.className = 'segmentation-study-ipa-labels';
    const syllables = Array.isArray(state.task?.referenceSyllableIpa) ? state.task.referenceSyllableIpa : [];
    spans.forEach((span, index) => {
      const label = document.createElement('li');
      label.dataset.syllableId = syllableId(span, version, index);
      const labelText = version === 'v4' ? syllableLabel(span, version, index) : (syllables[index] || `Syllable ${index + 1}`);
      const structureText = version === 'v4'
        ? ` · onset [${(span?.onset || []).join(', ')}] · nucleus ${span?.nucleus || 'unavailable'} · coda [${(span?.coda || []).join(', ')}]`
        : '';
      label.textContent = `${labelText} · ${spanStart(span).toFixed(3)}–${spanEnd(span).toFixed(3)}s${structureText}`;
      labels.appendChild(label);
    });
    panel.appendChild(labels);
    const timing = document.createElement('div');
    timing.className = 'crm-muted';
    timing.textContent = spans.map((span, index) => `#${index + 1} ${spanStart(span).toFixed(3)}–${spanEnd(span).toFixed(3)}s`).join(' · ');
    panel.appendChild(timing);
    // V4 is a boundary refinement of V3, so the only way to review it is to see
    // which boundaries it moved, by how much, and on what evidence.
    if (version === 'v4') renderV4Diagnostics(panel);
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
    whole.addEventListener('click', () => playRange(0, audioDuration()));
    controls.appendChild(whole);
    spans.forEach((span, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'crm-btn crm-btn-secondary crm-btn-sm';
      const id = syllableId(span, version, index);
      button.dataset.syllableId = id;
      const label = syllableLabel(span, version, index);
      const playbackLabel = version === 'v4'
        ? `Play V4 syllable ${index + 1} /${label}/`
        : `Play ${version === 'manual' ? `syllable ${index + 1}` : label}`;
      button.textContent = playbackLabel;
      button.setAttribute('aria-label', playbackLabel);
      button.addEventListener('click', () => playRange(spanStart(span), spanEnd(span)));
      controls.appendChild(button);
    });
    panel.appendChild(controls);
  }

  // Reads a length token off the workspace so the stylesheet stays the single
  // source of truth for the timeline's geometry.
  function cssPx(name, fallback) {
    if (!elements?.workspace || typeof getComputedStyle !== 'function') return fallback;
    const value = Number.parseFloat(getComputedStyle(elements.workspace).getPropertyValue(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function audioDuration() {
    return Number(state.waveSurfer?.getDuration?.() || elements?.audio?.duration || 0);
  }

  function loopGapMs() {
    const value = Number(elements?.loopGap?.value);
    return Number.isFinite(value) && value >= 0 ? value : 300;
  }

  function isPlaying() {
    // A loop counts as playing during its inter-repeat silence, otherwise the
    // transport button would flicker back to "Play" between passes.
    if (state.loopTimer) return true;
    return Boolean(state.activePlayRange) && Boolean(elements?.audio) && !elements.audio.paused;
  }

  function stopPlayback() {
    // Bumping the token orphans any pass that is mid-flight, including a loop
    // restart already queued on the timer.
    state.playbackToken += 1;
    if (state.loopTimer) { clearTimeout(state.loopTimer); state.loopTimer = null; }
    if (state.playTimer) { clearInterval(state.playTimer); state.playTimer = null; }
    if (state.playbackRafId) {
      try { cancelAnimationFrame(state.playbackRafId); } catch (_) { /* ignore */ }
      state.playbackRafId = null;
    }
    const audio = elements?.audio;
    if (audio && !audio.paused) { try { audio.pause(); } catch (_) { /* ignore */ } }
    state.activePlayRange = null;
    updateTransport();
  }

  function playRange(start, end, options = {}) {
    if (!elements?.audio?.src || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    stopPlayback();
    const loop = options.loop === undefined ? Boolean(state.loopEnabled) : Boolean(options.loop);
    state.activePlayRange = { start, end, loop };
    startPlaybackPass(start, end, loop, state.playbackToken);
  }

  function startPlaybackPass(start, end, loop, token) {
    const audio = elements?.audio;
    if (!audio || token !== state.playbackToken) return;
    audio.playbackRate = Number(elements.playbackSpeed?.value || 1);
    // True (non pitch-corrected) slowdown keeps consonant transients where they
    // actually are, which is what a boundary judgement depends on.
    try { audio.preservesPitch = false; } catch (_) { /* ignore */ }
    try { audio.mozPreservesPitch = false; } catch (_) { /* ignore */ }
    try { audio.webkitPreservesPitch = false; } catch (_) { /* ignore */ }
    try { audio.currentTime = Math.max(0, start); } catch (_) { /* ignore */ }
    const stopAt = Math.max(start, end);
    const finish = () => {
      if (token !== state.playbackToken) return;
      state.playbackRafId = null;
      try { audio.pause(); } catch (_) { /* ignore */ }
      if (!loop) { state.activePlayRange = null; updateTransport(); return; }
      state.loopTimer = setTimeout(() => {
        state.loopTimer = null;
        startPlaybackPass(start, end, loop, token);
      }, loopGapMs());
    };
    // requestAnimationFrame polls far finer than `timeupdate` (~250 ms), which
    // is far too coarse to stop cleanly on a 150 ms syllable.
    const tick = () => {
      if (token !== state.playbackToken) return;
      if (audio.ended || audio.currentTime >= stopAt - 0.005) { finish(); return; }
      state.playbackRafId = requestAnimationFrame(tick);
    };
    const startTicking = () => {
      if (token !== state.playbackToken) return;
      if (typeof requestAnimationFrame === 'function') state.playbackRafId = requestAnimationFrame(tick);
      else state.playTimer = setInterval(() => { if (audio.currentTime >= stopAt - 0.005) { clearInterval(state.playTimer); state.playTimer = null; finish(); } }, 15);
      updateTransport();
    };
    const played = audio.play();
    if (played && typeof played.then === 'function') {
      played.then(startTicking).catch(() => {
        state.activePlayRange = null;
        setStatus('Playback is unavailable for this recording.', 'error');
        updateTransport();
      });
    } else {
      startTicking();
    }
  }

  function togglePlayback() {
    if (isPlaying()) { stopPlayback(); return; }
    const duration = audioDuration();
    if (Number.isFinite(state.abStart) && Number.isFinite(state.abEnd) && state.abEnd > state.abStart) {
      playRange(state.abStart, state.abEnd);
      return;
    }
    if (duration > 0) playRange(0, duration);
  }

  function setAbSelection(start, end) {
    const duration = audioDuration();
    const from = Math.max(0, Math.min(Number(start), Number(end)));
    const to = Math.min(duration || Math.max(Number(start), Number(end)), Math.max(Number(start), Number(end)));
    if (!Number.isFinite(from) || !Number.isFinite(to) || to - from < AB_MIN_DURATION) return false;
    state.abStart = Number(from.toFixed(6));
    state.abEnd = Number(to.toFixed(6));
    updateTransport();
    return true;
  }

  function clearAbSelection() {
    if (state.abRegion) {
      try { state.abRegion.remove?.(); } catch (_) { /* ignore */ }
    }
    state.abRegion = null;
    state.abStart = null;
    state.abEnd = null;
    if (state.activePlayRange) stopPlayback();
    else updateTransport();
  }

  function isAbRegion(region) {
    return Boolean(region) && !String(region.id || '').startsWith('study-');
  }

  function handleRegionCreated(region) {
    if (!isAbRegion(region)) return;
    const start = Number(region.start);
    const end = Number(region.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < AB_MIN_DURATION) {
      // A stray micro-drag while clicking should not become a selection.
      try { region.remove?.(); } catch (_) { /* ignore */ }
      return;
    }
    if (state.abRegion && state.abRegion !== region) {
      try { state.abRegion.remove?.(); } catch (_) { /* ignore */ }
    }
    state.abRegion = region;
    try { region.setOptions?.({ color: 'rgba(15,23,42,.14)', drag: true, resize: true }); } catch (_) { /* ignore */ }
    setAbSelection(start, end);
  }

  function handleRegionUpdated(region, finalize) {
    if (isAbRegion(region)) {
      state.abRegion = region;
      if (setAbSelection(region.start, region.end) || !finalize) return;
      // Resized below the minimum: drop it, rather than leaving the readout
      // describing a slice that is no longer on the waveform. Only enforced on
      // finalize so a drag may pass through a tiny state on its way somewhere.
      clearAbSelection();
      return;
    }
    syncManualFromRegion(region, finalize);
  }

  function studyRegions() {
    const list = typeof state.regions?.getRegions === 'function' ? state.regions.getRegions() : null;
    return Array.isArray(list) ? list : [];
  }

  function clearRegions() {
    const plugin = state.regions;
    if (!plugin) return;
    const list = studyRegions();
    // Remove only the version overlay so the A–B listening selection survives a
    // tab switch; fall back to a full clear when the plugin has no per-region
    // remove (older builds and the browser-check stub).
    if (list.length && list.every((region) => typeof region?.remove === 'function')) {
      list.slice().forEach((region) => {
        if (!String(region?.id || '').startsWith('study-')) return;
        try { region.remove(); } catch (_) { /* ignore */ }
      });
      return;
    }
    try { plugin.clearRegions?.(); } catch (_) { /* ignore */ }
    state.abRegion = null;
  }

  function ensureAbRegion() {
    if (!state.regions || !Number.isFinite(state.abStart) || !Number.isFinite(state.abEnd)) return;
    const existing = studyRegions().some((region) => region === state.abRegion);
    if (existing) return;
    try {
      state.abRegion = state.regions.addRegion({
        id: 'ab-selection',
        start: state.abStart,
        end: state.abEnd,
        color: 'rgba(15,23,42,.14)',
        content: 'A–B',
        drag: true,
        resize: true
      });
    } catch (_) { /* WaveSurfer can reject regions before ready */ }
  }

  function drawRegions(version) {
    if (!state.regions) { renderDerivedViews(); return; }
    // "Compare all" is read through the lane strip and the ghost ticks, so no
    // filled region is drawn there — four translucent overlays are less legible,
    // not more.
    const spans = version === 'compare' ? [] : versionSpans(version);
    const existing = studyRegions().filter((region) => String(region?.id || '').startsWith(`study-${version}-`));
    const regionId = (span, index) => version === 'manual'
      ? `study-manual-${index}`
      : `study-${version}-${syllableId(span, version, index)}`;
    // Invariant: after any call, only this version's study regions exist, so a
    // same-version redraw can move the ones already on screen. Rebuilding them
    // instead re-runs the plugin's deferred label layout, which makes a held
    // arrow key jitter and leaks a subscription set per region per keypress.
    const reusable = spans.length > 0
      && existing.length === spans.length
      && existing.every((region) => typeof region.setOptions === 'function');
    if (reusable) {
      spans.forEach((span, index) => {
        const region = existing.find((item) => item.id === regionId(span, index));
        const start = spanStart(span);
        const end = spanEnd(span);
        if (!region || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
        if (region.start === start && region.end === end) return;
        try { region.setOptions({ start, end }); } catch (_) { /* ignore */ }
      });
    } else {
      clearRegions();
      const color = VERSION_COLORS[version] || VERSION_COLORS.v2;
      spans.forEach((span, index) => {
        const start = spanStart(span);
        const end = spanEnd(span);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
        try {
          state.regions.addRegion({
            id: regionId(span, index),
            start,
            end,
            color: index % 2 === 0 ? `${color}33` : `${color}1f`,
            content: version === 'v4'
              ? `V4 S${index + 1} /${syllableLabel(span, version, index)}/`
              : `${version === 'manual' ? 'Manual' : version.toUpperCase()} ${index + 1}`,
            // A syllable span itself must not move: reviewers drag either resize
            // handle, which represents one shared boundary with its neighbour.
            drag: false,
            resize: version === 'manual'
          });
        } catch (_) { /* WaveSurfer can reject regions before ready */ }
      });
    }
    ensureAbRegion();
    renderDerivedViews();
  }

  function labelFor(version) {
    if (version === 'manual') return 'Manual';
    if (version === 'compare') return 'Compare';
    return version.toUpperCase();
  }

  function versionSpans(version) {
    return version === 'manual' ? state.manualSegments : spansForComparison(version);
  }

  function boundariesFor(version) {
    const spans = versionSpans(version);
    if (!Array.isArray(spans) || !spans.length) return [];
    return [spanStart(spans[0]), ...spans.map(spanEnd)].filter((value) => Number.isFinite(value));
  }

  // The blind protocol only permits a version to be drawn once the reviewer has
  // reached it in the server-assigned order; after all three are logged the
  // ordering evidence is complete and everything may be shown together.
  function versionUnlocked(version) {
    if (version === 'manual') return true;
    if (!state.comparison) return false;
    if (exposureViewingComplete()) return true;
    return state.versionExposureLog.some((entry) => entry.version === version);
  }

  function v4Diagnostics() {
    const partition = state.comparison?.v3?.analysis?.partitionVariants;
    const diagnostics = partition?.v4Diagnostics || partition?.v4_diagnostics;
    return Array.isArray(diagnostics) ? diagnostics : [];
  }

  function diagnosticShiftMs(entry) {
    const signed = Number(entry?.signed_shift_ms ?? entry?.signedShiftMs);
    if (Number.isFinite(signed)) return signed;
    const magnitude = Number(entry?.shift_ms ?? entry?.shiftMs);
    return Number.isFinite(magnitude) ? magnitude : 0;
  }

  function diagnosticType(entry) {
    return String(entry?.correction_type || entry?.correctionType || 'none').toLowerCase();
  }

  function diagnosticMoved(entry) {
    return diagnosticType(entry) !== 'none' && Math.abs(diagnosticShiftMs(entry)) >= 0.5;
  }

  function formatSignedMs(value) {
    const rounded = Math.round(Number(value) || 0);
    return `${rounded > 0 ? '+' : ''}${rounded} ms`;
  }

  function updateTransport() {
    if (!elements) return;
    const hasAudio = Boolean(elements.audio?.src) && audioDuration() > 0;
    const hasAb = Number.isFinite(state.abStart) && Number.isFinite(state.abEnd) && state.abEnd > state.abStart;
    if (elements.play) {
      elements.play.disabled = !hasAudio;
      elements.play.textContent = isPlaying() ? '■ Stop' : (hasAb ? '▶ Play A–B' : '▶ Play word');
    }
    if (elements.loop) {
      elements.loop.disabled = !hasAudio;
      elements.loop.classList.toggle('is-active', Boolean(state.loopEnabled));
      elements.loop.setAttribute('aria-pressed', String(Boolean(state.loopEnabled)));
    }
    if (elements.abClear) elements.abClear.disabled = !hasAb;
    if (elements.abReadout) {
      elements.abReadout.textContent = hasAb
        ? `A–B · ${state.abStart.toFixed(3)} → ${state.abEnd.toFixed(3)} s (${Math.round((state.abEnd - state.abStart) * 1000)} ms)`
        : 'A–B · drag across the waveform to select a slice';
      elements.abReadout.classList.toggle('is-set', hasAb);
    }
  }

  function renderGhostBoundaries() {
    const host = elements?.ghosts;
    if (!host) return;
    host.replaceChildren();
    const duration = audioDuration();
    if (!duration || !state.visualizationReady || !state.showGhosts) return;
    COMPARISON_VERSIONS.forEach((version) => {
      // The active version is already drawn as a filled region.
      if (version === state.activeVersion || !versionUnlocked(version)) return;
      boundariesFor(version).forEach((time, index) => {
        const tick = document.createElement('span');
        tick.className = 'segmentation-study-ghost';
        tick.dataset.version = version;
        tick.style.left = `${Math.max(0, Math.min(100, (time / duration) * 100))}%`;
        tick.style.setProperty('--ghost-color', VERSION_COLORS[version]);
        tick.title = `${labelFor(version)} boundary ${index} · ${time.toFixed(3)} s`;
        host.appendChild(tick);
      });
    });
  }

  function laneNote(version) {
    if (!versionUnlocked(version)) return '';
    if (version === 'manual') {
      const expected = Number(state.task?.targetSyllableCount || 0);
      return expected ? `${state.manualSegments.length}/${expected} marked` : '';
    }
    if (version === 'v4') {
      const diagnostics = v4Diagnostics();
      if (diagnostics.length) {
        const moved = diagnostics.filter(diagnosticMoved);
        if (!moved.length) return 'no boundary moved vs V3';
        const largest = moved.reduce((best, item) => (Math.abs(diagnosticShiftMs(item)) > Math.abs(diagnosticShiftMs(best)) ? item : best), moved[0]);
        return `${moved.length} moved vs V3 · max ${formatSignedMs(diagnosticShiftMs(largest))}`;
      }
    }
    const spans = versionSpans(version);
    return spans.length ? `${spans.length} syllables` : '';
  }

  function renderLaneStrip() {
    const host = elements?.lanes;
    if (!host) return;
    host.replaceChildren();
    const duration = audioDuration();
    if (!duration || !state.visualizationReady) {
      const empty = document.createElement('p');
      empty.className = 'crm-muted';
      empty.textContent = 'Boundary lanes appear once a recording is loaded and analysed.';
      host.appendChild(empty);
      return;
    }
    const ipa = Array.isArray(state.task?.referenceSyllableIpa) ? state.task.referenceSyllableIpa : [];
    COMPARISON_VERSIONS.forEach((version) => {
      const row = document.createElement('div');
      row.className = 'segmentation-study-lane';
      row.dataset.version = version;
      if (version === state.activeVersion) row.classList.add('is-active');
      row.style.setProperty('--lane-color', VERSION_COLORS[version]);

      const label = document.createElement('span');
      label.className = 'segmentation-study-lane-label';
      label.textContent = labelFor(version);
      row.appendChild(label);

      const track = document.createElement('div');
      track.className = 'segmentation-study-lane-track';
      const spans = versionSpans(version);
      if (!versionUnlocked(version)) {
        track.classList.add('is-locked');
        track.textContent = 'Not yet viewed';
      } else if (!spans.length) {
        track.classList.add('is-empty');
        track.textContent = version === 'manual' ? 'No boundaries marked yet' : 'Unavailable';
      } else {
        spans.forEach((span, index) => {
          const start = spanStart(span);
          const end = spanEnd(span);
          if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
          const block = document.createElement('button');
          block.type = 'button';
          block.className = 'segmentation-study-lane-block';
          block.style.left = `${Math.max(0, (start / duration) * 100)}%`;
          block.style.width = `${Math.max(0.4, ((end - start) / duration) * 100)}%`;
          block.textContent = ipa[index] || String(index + 1);
          block.title = `${labelFor(version)} syllable ${index + 1} · ${start.toFixed(3)}–${end.toFixed(3)} s (${Math.round((end - start) * 1000)} ms) · click to play`;
          block.addEventListener('click', () => playRange(start, end));
          track.appendChild(block);
        });
      }
      row.appendChild(track);

      const note = document.createElement('span');
      note.className = 'segmentation-study-lane-note';
      note.textContent = laneNote(version);
      row.appendChild(note);
      host.appendChild(row);
    });
  }

  function renderV4Diagnostics(panel) {
    const diagnostics = v4Diagnostics();
    if (!diagnostics.length) return;
    const moved = diagnostics.filter(diagnosticMoved);
    const headline = document.createElement('p');
    headline.className = 'segmentation-study-diagnostics-headline';
    if (!moved.length) {
      headline.textContent = `V4 kept all ${diagnostics.length} V3 boundaries unchanged.`;
    } else {
      const largest = moved.reduce((best, item) => (Math.abs(diagnosticShiftMs(item)) > Math.abs(diagnosticShiftMs(best)) ? item : best), moved[0]);
      headline.textContent = `V4 moved ${moved.length} of ${diagnostics.length} boundaries · largest ${formatSignedMs(diagnosticShiftMs(largest))} (${diagnosticType(largest)}, syllable ${Number(largest.index ?? 0) + 1}).`;
    }
    panel.appendChild(headline);

    const table = document.createElement('table');
    table.className = 'segmentation-study-diagnostics';
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['Boundary', 'Correction', 'Shift', 'Confidence', 'Blend', 'Reason'].forEach((text) => {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = text;
      headRow.appendChild(cell);
    });
    head.appendChild(headRow);
    table.appendChild(head);

    const body = document.createElement('tbody');
    diagnostics.forEach((entry, index) => {
      const row = document.createElement('tr');
      const shift = diagnosticShiftMs(entry);
      if (!diagnosticMoved(entry)) row.classList.add('is-unchanged');
      const confidence = Number(entry?.confidence);
      const blend = Number(entry?.blend_weight ?? entry?.blendWeight);
      const cells = [
        `Syllable ${Number(entry?.index ?? index) + 1}${entry?.boundary ? ` · ${String(entry.boundary).replace(/_/g, ' ')}` : ''}`,
        diagnosticType(entry).replace(/_/g, ' '),
        diagnosticMoved(entry) ? formatSignedMs(shift) : '—',
        Number.isFinite(confidence) ? confidence.toFixed(2) : '—',
        Number.isFinite(blend) ? blend.toFixed(2) : '—',
        String(entry?.reason || '—')
      ];
      cells.forEach((text, cellIndex) => {
        const cell = document.createElement('td');
        cell.textContent = text;
        if (cellIndex === 2 && diagnosticMoved(entry)) cell.classList.add(shift >= 0 ? 'is-later' : 'is-earlier');
        row.appendChild(cell);
      });
      body.appendChild(row);
    });
    table.appendChild(body);

    const wrapper = document.createElement('div');
    wrapper.className = 'segmentation-study-tablewrap';
    wrapper.appendChild(table);
    panel.appendChild(wrapper);
  }

  function renderComparePanel(panel) {
    panel.replaceChildren();
    if (!exposureViewingComplete()) {
      panel.textContent = 'Compare all unlocks after every automatic version has been viewed in the required order.';
      return;
    }
    const legend = document.createElement('div');
    legend.className = 'segmentation-study-legend';
    COMPARISON_VERSIONS.forEach((version) => {
      const item = document.createElement('span');
      item.className = 'segmentation-study-legend-item';
      item.style.setProperty('--lane-color', VERSION_COLORS[version]);
      item.textContent = `${labelFor(version)} · ${laneNote(version) || 'unavailable'}`;
      legend.appendChild(item);
    });
    panel.appendChild(legend);

    const hint = document.createElement('p');
    hint.className = 'crm-muted';
    hint.textContent = 'Every version is drawn on the shared time axis above. Click any lane block to play that syllable, or drag across the waveform to loop an A–B slice.';
    panel.appendChild(hint);

    renderV4Diagnostics(panel);
    const spans = state.manualSegments.length ? state.manualSegments : spansForComparison('v4');
    renderPlaybackButtons(panel, spans, state.manualSegments.length ? 'manual' : 'v4');
  }

  function renderDeltaTable() {
    const host = elements?.deltas;
    if (!host) return;
    host.replaceChildren();
    const expected = Number(state.task?.targetSyllableCount || 0);
    const manual = boundariesFor('manual');
    if (!expected || state.manualSegments.length !== expected || !state.comparison) return;
    const versions = ['v2', 'v3', 'v4'].filter((version) => versionUnlocked(version) && boundariesFor(version).length === manual.length);
    if (!versions.length) return;

    const title = document.createElement('p');
    title.className = 'segmentation-study-deltas-title';
    title.textContent = 'Automatic boundaries vs your manual boundaries (positive = the automatic boundary is later)';
    host.appendChild(title);

    const table = document.createElement('table');
    table.className = 'segmentation-study-delta-table';
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    const corner = document.createElement('th');
    corner.scope = 'col';
    corner.textContent = 'Boundary';
    headRow.appendChild(corner);
    versions.forEach((version) => {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = labelFor(version);
      cell.style.setProperty('--lane-color', VERSION_COLORS[version]);
      headRow.appendChild(cell);
    });
    head.appendChild(headRow);
    table.appendChild(head);

    const body = document.createElement('tbody');
    const errors = new Map(versions.map((version) => [version, []]));
    manual.forEach((time, index) => {
      const row = document.createElement('tr');
      const header = document.createElement('th');
      header.scope = 'row';
      header.textContent = index === 0 ? 'Word start' : (index === manual.length - 1 ? 'Word end' : `Boundary ${index}`);
      row.appendChild(header);
      versions.forEach((version) => {
        const value = boundariesFor(version)[index];
        const cell = document.createElement('td');
        if (Number.isFinite(value)) {
          const delta = (value - time) * 1000;
          errors.get(version).push(Math.abs(delta));
          cell.textContent = formatSignedMs(delta);
          if (Math.abs(delta) >= 30) cell.classList.add('is-wide');
        } else {
          cell.textContent = '—';
        }
        row.appendChild(cell);
      });
      body.appendChild(row);
    });
    table.appendChild(body);

    const foot = document.createElement('tfoot');
    const footRow = document.createElement('tr');
    const footHeader = document.createElement('th');
    footHeader.scope = 'row';
    footHeader.textContent = 'Mean absolute error';
    footRow.appendChild(footHeader);
    versions.forEach((version) => {
      const values = errors.get(version);
      const cell = document.createElement('td');
      cell.textContent = values.length ? `${Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)} ms` : '—';
      footRow.appendChild(cell);
    });
    foot.appendChild(footRow);
    table.appendChild(foot);

    const wrapper = document.createElement('div');
    wrapper.className = 'segmentation-study-tablewrap';
    wrapper.appendChild(table);
    host.appendChild(wrapper);
  }

  // The single definition of what Save needs. `canSave`, the visible checklist
  // and save()'s own guard all derive from this, so they cannot drift apart.
  //
  // A stored sample was captured in an earlier session, so its raw capture
  // settings and the study's server-issued exposure order belong to that
  // session, not to this review. The two save paths validate accordingly:
  // /tasks/:id/complete (study) requires both; /corpus-samples/:id/manual-reviews
  // (previous sample) requires neither.
  function saveRequirements() {
    const expected = Number(state.task?.targetSyllableCount || 0);
    const previous = state.mode === 'previous';
    const requirements = [
      { label: previous ? 'Sample opened' : 'Word claimed', ok: Boolean(state.task?.taskId) },
      { label: previous ? 'Recording loaded' : 'Recording captured', ok: Boolean(state.audioBlob) }
    ];
    if (!previous) requirements.push({ label: 'Raw capture verified (AEC/NS/AGC off)', ok: captureSettingsReady() });
    requirements.push(
      { label: 'Waveform and spectrogram rendered', ok: Boolean(state.visualizationReady) },
      { label: 'V2/V3/V4 analysis complete', ok: completeComparisonReady() },
      { label: 'All three automatic versions viewed in order', ok: exposureViewingComplete() },
      ...(!previous ? [{ label: 'Automatic judgment recorded', ok: automaticJudgmentReady() }] : []),
      { label: 'Playback confirmed', ok: Boolean(elements?.playbackConfirmed?.checked || state.playbackConfirmed) },
      { label: `Manual boundaries marked (${state.manualSegments.length}/${expected || '?'})`, ok: expected > 0 && state.manualSegments.length === expected },
      { label: 'Certainty chosen', ok: Boolean(elements?.certainty?.()?.value) }
    );
    return requirements;
  }

  function outstandingRequirement(requirements = saveRequirements()) {
    return requirements.find((requirement) => !requirement.ok) || null;
  }

  function renderSaveChecklist(requirements) {
    const host = elements?.checklist;
    if (!host) return;
    host.replaceChildren();
    requirements.forEach((requirement) => {
      const item = document.createElement('li');
      item.className = `segmentation-study-check${requirement.ok ? ' is-done' : ''}`;
      const mark = document.createElement('span');
      mark.className = 'segmentation-study-check-mark';
      mark.textContent = requirement.ok ? '✓' : '○';
      mark.setAttribute('aria-hidden', 'true');
      item.appendChild(mark);
      const label = document.createElement('span');
      label.textContent = requirement.label;
      item.appendChild(label);
      item.setAttribute('aria-label', `${requirement.label}: ${requirement.ok ? 'done' : 'outstanding'}`);
      host.appendChild(item);
    });
  }

  const STEP_HINTS = Object.freeze([
    'Step 1 · Claim a word from the shared queue.',
    'Step 2 · Record one clear pronunciation of the word.',
    'Step 3 · Run the V2/V3/V4 analysis.',
    'Step 4 · View each automatic version in the required order.',
    'Step 5 · Mark the shared boundaries, choose certainty, and save.'
  ]);

  function renderStepRail() {
    const hasTask = Boolean(state.task?.taskId);
    const hasAudio = Boolean(state.audioBlob);
    const hasAnalysis = completeComparisonReady();
    const expected = Number(state.task?.targetSyllableCount || 0);
    const viewed = new Set(state.versionExposureLog.map((entry) => entry.version)).size;
    const stages = [
      { key: 'claim', done: hasTask, note: hasTask ? String(state.task.targetWord || '') : '' },
      { key: 'record', done: hasAudio, note: hasAudio && audioDuration() ? `${audioDuration().toFixed(2)} s` : '' },
      { key: 'analyze', done: hasAnalysis, note: hasAnalysis ? 'V2/V3/V4 ready' : '' },
      { key: 'compare', done: exposureViewingComplete(), note: hasAnalysis ? `${viewed}/3 viewed` : '' },
      { key: 'mark', done: state.manualReviewSaved, note: expected ? `${state.manualSegments.length}/${expected} segments` : '' }
    ];
    const pending = stages.findIndex((stage) => !stage.done);
    const currentIndex = pending === -1 ? stages.length - 1 : pending;
    if (elements?.steps) {
      stages.forEach((stage, index) => {
        const item = elements.steps.querySelector(`[data-step="${stage.key}"]`);
        if (!item) return;
        item.classList.toggle('is-done', stage.done);
        item.classList.toggle('is-current', !stage.done && index === currentIndex);
        const note = item.querySelector('.segmentation-study-step-note');
        if (note) note.textContent = stage.note;
      });
    }
    if (elements?.step) {
      elements.step.textContent = state.mode === 'previous' && currentIndex < 4
        ? 'Previous sample · review the stored recording and mark boundaries.'
        : STEP_HINTS[currentIndex];
    }
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
    if (!finalize) {
      // `region-update` fires on every pointermove, so the live pass only
      // refreshes the lane strip and the count, coalesced to one animation
      // frame. The full re-render (and the re-snap of the neighbouring region
      // to the clamped boundary) happens once, on `region-updated`.
      scheduleLiveManualRender();
      return;
    }
    renderPanel('manual');
    updateManualUi();
    drawRegions('manual');
  }

  function cancelLiveManualRender() {
    if (!state.liveManualRaf) return;
    try { cancelAnimationFrame(state.liveManualRaf); } catch (_) { /* ignore */ }
    state.liveManualRaf = null;
  }

  function scheduleLiveManualRender() {
    if (state.liveManualRaf || typeof requestAnimationFrame !== 'function') return;
    state.liveManualRaf = requestAnimationFrame(() => {
      state.liveManualRaf = null;
      renderLaneStrip();
      if (elements?.manualCount) {
        const expected = Number(state.task?.targetSyllableCount || 0);
        elements.manualCount.textContent = `${state.manualSegments.length} of ${expected} segments · ${state.manualBoundaries.length} boundaries`;
      }
    });
  }

  function updateCompareTabAvailability() {
    const ready = exposureViewingComplete();
    if (elements?.compareTab) elements.compareTab.hidden = !ready;
    if (!ready && state.activeVersion === 'compare') selectVersion('manual', { recordExposure: false });
  }

  function selectVersion(version, options = {}) {
    let exposureChanged = false;
    if (version === 'compare' && !exposureViewingComplete()) {
      setStatus('Compare all unlocks after every automatic version has been viewed in the required order.', 'warning');
      return false;
    }
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
    // Switching views must not leave a loop from the previous view running.
    stopPlayback();
    renderPanel(version);
    drawRegions(version);
    updateCompareTabAvailability();
    renderStepRail();
    if (elements.manualInstructions) elements.manualInstructions.hidden = version !== 'manual';
    if (exposureChanged) updateButtons();
    return true;
  }

  async function loadWaveform(blob) {
    state.visualizationReady = false;
    if (elements.timelineEmpty) {
      elements.timelineEmpty.hidden = false;
      elements.timelineEmpty.textContent = 'Loading waveform…';
    }
    if (!elements.waveform || !window.WaveSurfer) {
      markVisualizationUnavailable();
      updateButtons();
      return false;
    }
    try {
      if (!(blob instanceof Blob)) throw new TypeError('Waveform visualization requires the original audio Blob.');
      if (state.waveSurfer) state.waveSurfer.destroy();
      elements.waveform.replaceChildren();
      elements.spectrogram?.replaceChildren();
      const plugins = [];
      // Heights come from the stylesheet so the rendered canvases always fill
      // their containers; a shorter canvas would leave the ghost boundary ticks
      // extending past the end of the signal they annotate.
      state.waveSurfer = WaveSurfer.create({ container: elements.waveform, waveColor: '#64748b', progressColor: '#2563eb', height: cssPx('--waveform-height', 140), normalize: true, plugins });
      const RegionsPlugin = WaveSurfer.RegionsPlugin || WaveSurfer.Regions;
      const TimelinePlugin = WaveSurfer.TimelinePlugin || WaveSurfer.Timeline;
      const SpectrogramPlugin = WaveSurfer.SpectrogramPlugin || WaveSurfer.Spectrogram;
      state.regions = RegionsPlugin ? state.waveSurfer.registerPlugin(RegionsPlugin.create()) : null;
      state.abRegion = null;
      if (state.regions) {
        // Dragging across the waveform picks an arbitrary A–B slice to loop.
        // The threshold is raised from the plugin default of 3px: the same
        // gesture area is used to click a manual boundary into place, and a
        // drag past the threshold suppresses the click entirely.
        try { state.regions.enableDragSelection?.({ color: 'rgba(15,23,42,.14)', drag: true, resize: true }, AB_DRAG_THRESHOLD_PX); } catch (_) { /* ignore */ }
        // WaveSurfer 7 emits region events from the plugin, not the instance,
        // and names them `region-update` (live, during the drag) and
        // `region-updated` (once, on drag end). There is no `region-update-end`.
        try {
          state.regions.on?.('region-created', (region) => handleRegionCreated(region));
          state.regions.on?.('region-update', (region) => handleRegionUpdated(region, false));
          state.regions.on?.('region-updated', (region) => handleRegionUpdated(region, true));
        } catch (_) { /* ignore */ }
      }
      if (TimelinePlugin && elements.timelineRuler) {
        elements.timelineRuler.replaceChildren();
        state.timeline = state.waveSurfer.registerPlugin(TimelinePlugin.create({ container: elements.timelineRuler, height: 20 }));
      }
      if (SpectrogramPlugin && elements.spectrogram) {
        state.spectrogram = state.waveSurfer.registerPlugin(SpectrogramPlugin.create({
          container: elements.spectrogram, labels: true, height: cssPx('--spectrogram-height', 180), fftSamples: 512, scale: 'mel', windowFunc: 'hann', frequencyMax: 8000
        }));
      }
      state.waveSurfer.on('ready', () => {
        if (!visualizationSurfacesReady()) {
          markVisualizationUnavailable();
          updateButtons();
          return;
        }
        state.visualizationReady = true;
        if (elements.timelineEmpty) elements.timelineEmpty.hidden = true;
        selectVersion(state.activeVersion);
        updateTransport();
        updateButtons();
      });
      state.waveSurfer.on('interaction', (time) => {
        if (state.activeVersion === 'manual') addManualBoundary(Number(time));
      });
      state.waveSurfer.on('error', () => {
        markVisualizationUnavailable();
        updateButtons();
      });
      await state.waveSurfer.loadBlob(blob);
      return state.visualizationReady;
    } catch (error) {
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
    // The lane strip, ghost ticks and delta table are refreshed by
    // drawRegions(), which every caller of this function also runs.
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
    const outstanding = outstandingRequirement();
    if (outstanding || state.manualReviewSaved) {
      // Name the first thing that is actually missing rather than restating the
      // whole contract; the visible checklist shows the rest.
      const reason = state.manualReviewSaved ? 'this review has already been saved'
        : (!state.visualizationReady ? waveformUnavailableMessage()
          : (!exposureViewingComplete() ? exposureRequirementMessage() : `${outstanding.label} is still outstanding`));
      setStatus(`Save is blocked: ${reason}`, 'error');
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
          analysisRevision: 'pronunciation-analysis-v4.1',
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
      // Previous samples already carry the comparison that was reviewed and
      // persisted. Restore it as-is; a fresh request is only made by the
      // explicit Analyze button.
      const persistedComparison = sample.comparison || sample.analysis || null;
      if (persistedComparison && typeof persistedComparison === 'object') {
        state.comparison = persistedComparison;
        state.analysisFailed = false;
        ['v2', 'v3', 'v4'].forEach(renderPanel);
        setAnalysisStatus('Previous sample loaded. Persisted comparison restored; click Analyze for fresh re-analysis.', 'success');
      } else {
        setAnalysisStatus('Previous sample loaded. Click Analyze to run a fresh comparison.');
      }
      if (Array.isArray(sample.manualSegments) && sample.manualSegments.length) {
        state.manualSegments = sample.manualSegments.map((segment, index) => ({ ...segment, index }));
        state.manualBoundaries = [state.manualSegments[0].startTime, ...state.manualSegments.map((segment) => segment.endTime)];
      }
      selectVersion('manual');
      updateButtons();
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
    elements.play?.addEventListener('click', togglePlayback);
    elements.loop?.addEventListener('click', () => {
      state.loopEnabled = !state.loopEnabled;
      // Apply the change to whatever is already playing rather than waiting for
      // the next press.
      const active = state.activePlayRange;
      if (active) playRange(active.start, active.end, { loop: state.loopEnabled });
      else updateTransport();
    });
    elements.abClear?.addEventListener('click', clearAbSelection);
    elements.playbackSpeed?.addEventListener('change', () => {
      if (elements.audio) elements.audio.playbackRate = Number(elements.playbackSpeed.value || 1);
    });
    elements.ghostToggle?.addEventListener('change', () => {
      state.showGhosts = Boolean(elements.ghostToggle.checked);
      renderGhostBoundaries();
    });
    elements.audio?.addEventListener('pause', updateTransport);
    elements.audio?.addEventListener('ended', () => { state.activePlayRange = null; updateTransport(); });
    elements.save.addEventListener('click', save);
    elements.next.addEventListener('click', async () => { state.task = null; resetTaskState(); state.mode = 'record'; await refresh(); });
    elements.tabs.forEach((tab) => {
      tab.addEventListener('click', () => selectVersion(tab.dataset.studyVersion || 'v2'));
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        // A locked "Compare all" tab is hidden and must stay out of the roving
        // tab order.
        const reachable = elements.tabs.filter((item) => !item.hidden);
        const index = Math.max(0, reachable.indexOf(tab));
        const nextIndex = event.key === 'Home' ? 0
          : (event.key === 'End' ? reachable.length - 1
            : (index + (event.key === 'ArrowLeft' ? -1 : 1) + reachable.length) % reachable.length);
        const next = reachable[nextIndex];
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
    window.addEventListener('pagehide', () => { stopHeartbeat(); cleanupRecording(); stopPlayback(); cancelLiveManualRender(); state.waveSurfer?.destroy?.(); });
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
