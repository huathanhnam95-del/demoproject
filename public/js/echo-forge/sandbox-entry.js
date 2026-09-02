import { config as pronunciationConfig } from '../../pronunciation-analyzer/config.js';
import { createAudioCapture } from './adapters/audio-capture-adapter.js';
import { createAnalysisClient } from './adapters/analysis-client.js';
import { createAudioPromptAdapter } from './adapters/audio-prompt-adapter.js';
import { createTimingTelemetry } from './adapters/timing-telemetry.js';
import { ATTACK_CARDS, createRunPreferences } from './core/policy.js';
import { createSeededRng } from './core/rng.js';
import { selectChallenge } from './core/challenge-selector.js';
import { LEVEL_DESCRIPTORS, SUPPORT_DESCRIPTORS, describeActionCard, formatAnalysisFeedback, humanizeEvent, summarizeRun } from './core/learner-feedback.js';
import { createInitialCombatState, reduceCombat, replayCombat } from './core/combat-reducer.js';
import { createVisualPresenter } from './visual/presenter.js';

const hooks = window.__ECHO_FORGE_TEST_HOOKS__ || {};
const ENEMY_BASE_DAMAGE = 20;
const PARRY_WINDOW_MS = 4000;
const telemetry = createTimingTelemetry();
const root = document.querySelector('#echo-forge-root');
const statusNode = document.querySelector('#system-status');
const setupNode = document.querySelector('#setup');
const battleNode = document.querySelector('#battle');
const attackControls = document.querySelector('#attack-controls');
const recordControls = document.querySelector('#record-controls');
const defendControls = document.querySelector('#defend-controls');
const blockOptions = document.querySelector('#block-options');
const optionRow = document.querySelector('#option-row');
const eventLog = document.querySelector('#event-log');
const summaryNode = document.querySelector('#summary');
const feedbackNode = document.querySelector('#feedback');
const feedbackText = document.querySelector('#feedback-text');
const parryCountdown = document.querySelector('#parry-countdown');
const visualPresenter = createVisualPresenter({ root });

let catalog = null;
let preferences = null;
let rng = null;
let combat = null;
let initialState = null;
let replayActions = [];
let pendingCard = null;
let pendingChallenge = null;
let blockChallenge = null;
let parryChallenge = null;
let capture = null;
let recordingPurpose = null;
let reactionStartedAt = null;
let prewarmDurationMs = 0;
let blockTimer = null;
let operationGeneration = 0;
let analysisAbortController = null;
let analysisPending = false;
let promptAdapter = null;
let blockPlaybackGeneration = 0;
let blockPlaybackReady = false;
let challengeHistory = new Set();
let runAttempts = [];
let parryCountdownTimer = null;
let parryWindowStartedAt = null;

const analysisClient = hooks.analysisClient || createAnalysisClient({
  v3BaseUrl: pronunciationConfig.backendUrl,
});

function setStatus(message, tone = 'neutral') {
  statusNode.textContent = message;
  statusNode.dataset.tone = tone;
}

function appendEvents(events) {
  for (const semanticEvent of events) {
    const row = document.createElement('li');
    row.textContent = humanizeEvent(semanticEvent.type);
    row.dataset.eventType = semanticEvent.type;
    eventLog.prepend(row);
    while (eventLog.children.length > 12) eventLog.lastElementChild.remove();
    root.dispatchEvent(new CustomEvent('echo-forge:event', { detail: semanticEvent }));
  }
}

function showFeedback(feedback) {
  feedbackNode.dataset.tone = feedback.tone;
  feedbackText.textContent = feedback.text;
}

function updateSetupDescriptions() {
  document.querySelector('#level-help').textContent = LEVEL_DESCRIPTORS[document.querySelector('#level-select').value];
  document.querySelector('#support-help').textContent = SUPPORT_DESCRIPTORS[document.querySelector('#support-select').value];
}

function focusElement(selector) {
  document.querySelector(selector)?.focus({ preventScroll: true });
}

function focusFirstEnabledAttack() {
  document.querySelector('[data-card]:not([disabled])')?.focus({ preventScroll: true });
}

function startParryCountdown() {
  clearTimeout(parryCountdownTimer);
  parryWindowStartedAt = performance.now();
  let lastText = '';
  const update = () => {
    const remaining = Math.max(0, PARRY_WINDOW_MS - (performance.now() - parryWindowStartedAt));
    const seconds = Math.ceil(remaining / 1000);
    const text = remaining > 0 ? `Parry window: ${seconds} seconds remaining.` : 'Parry window expired.';
    if (text !== lastText) { parryCountdown.textContent = text; lastText = text; }
    if (remaining > 0) parryCountdownTimer = setTimeout(update, 1000);
    else parryCountdownTimer = null;
  };
  update();
}

function stopParryCountdown() {
  clearTimeout(parryCountdownTimer);
  parryCountdownTimer = null;
  parryWindowStartedAt = null;
  parryCountdown.textContent = '';
}

function renderSummary() {
  if (!combat || !['victory', 'defeat', 'abandoned'].includes(combat.status)) return;
  const summary = summarizeRun({ outcome: combat.status, rounds: combat.round, attempts: runAttempts });
  summaryNode.hidden = false;
  document.querySelector('#summary-outcome').textContent = summary.outcome === 'victory' ? 'Victory! Your pronunciation shattered the Warden\'s defenses.' : summary.outcome === 'defeat' ? 'Defeat — use the feedback below to sharpen your skills.' : 'You retreated from the arena.';
  document.querySelector('#summary-rounds').textContent = String(summary.rounds);
  document.querySelector('#summary-scored').textContent = String(summary.scoredAttempts);
  document.querySelector('#summary-scores').textContent = summary.averageScore === null ? 'No scored attempts' : `${summary.averageScore} average / ${summary.bestScore} best`;
  document.querySelector('#summary-actions').textContent = String(summary.successfulActions);
  document.querySelector('#summary-focus').textContent = summary.pronunciationFocusReview.length ? summary.pronunciationFocusReview.join('; ') : 'No focus evidence recorded';
  document.querySelector('#summary-heading').focus({ preventScroll: true });
}

function emitOwnedEvent(type, payload = {}) {
  appendEvents([{ type, payload }]);
}

function coreDispatch(action) {
  const result = reduceCombat(combat, action);
  combat = result.state;
  replayActions.push(structuredClone(action));
  appendEvents(result.events);
  render();
  return result;
}

function supportText(challenge) {
  if (!challenge) return '';
  if (preferences.supportPreset === 'challenge') return 'Support hidden by your Challenge preset.';
  const ipa = preferences.supportPreset === 'guided' ? `${challenge.pronunciation.ipa} · ` : '';
  const example = preferences.supportPreset === 'guided' ? ` Example: ${challenge.resource.example}` : '';
  return `${ipa}${challenge.resource.definition}.${example}`;
}

function showChallenge(challenge, { hideTarget = false, promptLabel = 'Listen, then choose' } = {}) {
  document.querySelector('#challenge-text').textContent = hideTarget ? promptLabel : challenge?.text || 'Choose an action';
  document.querySelector('#challenge-support').textContent = hideTarget ? '' : supportText(challenge);
}

function renderMeters() {
  if (!combat) return;
  const heroHp = document.querySelector('#hero-hp');
  const enemyHp = document.querySelector('#enemy-hp');
  heroHp.max = combat.hero.maxHp;
  heroHp.value = combat.hero.hp;
  enemyHp.max = combat.enemy.maxHp;
  enemyHp.value = combat.enemy.hp;
  document.querySelector('#hero-hp-text').textContent = `${combat.hero.hp}/${combat.hero.maxHp}`;
  document.querySelector('#enemy-hp-text').textContent = `${combat.enemy.hp}/${combat.enemy.maxHp}`;
  document.querySelector('#focus-value').textContent = combat.hero.focus;
  document.querySelector('#resonance-value').textContent = combat.hero.resonance;
  document.querySelector('#combo-value').textContent = combat.hero.combo;
  document.querySelector('#round-value').textContent = combat.round;
}

function render() {
  if (!combat) return;
  renderMeters();
  const terminal = ['victory', 'defeat', 'abandoned'].includes(combat.status);
  attackControls.hidden = terminal || combat.turn !== 'player' || Boolean(pendingChallenge);
  defendControls.hidden = terminal || combat.turn !== 'enemy' || !blockOptions.hidden || Boolean(pendingChallenge);
  for (const button of document.querySelectorAll('[data-card]')) {
    const card = ATTACK_CARDS[button.dataset.card];
    const detail = describeActionCard(card, { focus: combat.hero.focus, terminal });
    const disabledReason = terminal ? 'The run has ended.' : combat.turn !== 'player' ? 'Available on your attack turn.' : detail.disabledReason;
    button.disabled = Boolean(disabledReason);
    button.title = disabledReason || detail.description;
    button.setAttribute('aria-label', disabledReason ? `${card.label}. ${disabledReason}` : `${card.label}. ${detail.description}`);
  }
  const burst = document.querySelector('#burst-toggle');
  burst.disabled = combat.hero.resonance < 100;
  if (burst.disabled) burst.checked = false;
  if (terminal) {
    recordControls.hidden = true;
    blockOptions.hidden = true;
    document.querySelector('#abandon-btn').hidden = true;
  }
  const blockButton = document.querySelector('#block-btn');
  if (blockButton) blockButton.disabled = !promptIsReady();
  if (combat.status === 'victory') setStatus('Victory! The Echo Warden falls.', 'success');
  if (combat.status === 'defeat') setStatus('Defeated — but every attempt sharpens your pronunciation.', 'warning');
  if (combat.status === 'abandoned') setStatus('Retreated. No progress changed.', 'neutral');
  renderSummary();
}

function challengeForCard(card) {
  return selectChallenge(catalog.challenges, {
    level: preferences.level,
    evaluationMode: card.evaluationMode,
    unitType: card.unitType,
    rng,
    recentChallengeIds: challengeHistory,
  });
}

let autoRecordTimer = null;
let silenceMonitorInterval = null;
let silenceAudioContext = null;

function clearAutoRecord() {
  if (autoRecordTimer) {
    clearInterval(autoRecordTimer);
    autoRecordTimer = null;
  }
  const recordBtn = document.querySelector('#record-btn');
  if (recordBtn && !recordBtn.disabled) {
    recordBtn.textContent = 'Start recording';
  }
}

function startAutoRecordCountdown(seconds = 2) {
  clearAutoRecord();
  let remaining = seconds;
  const recordBtn = document.querySelector('#record-btn');
  const updateLabel = () => {
    if (recordBtn && !recordBtn.disabled) {
      recordBtn.textContent = `Auto-recording in ${remaining}s... (click to start)`;
    }
  };
  updateLabel();
  autoRecordTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearAutoRecord();
      if (combat?.status === 'active' && !recordControls.hidden && recordBtn && !recordBtn.disabled) {
        void startRecording();
      }
    } else {
      updateLabel();
    }
  }, 1000);
}

function stopSilenceDetection() {
  if (silenceMonitorInterval) {
    clearInterval(silenceMonitorInterval);
    silenceMonitorInterval = null;
  }
  if (silenceAudioContext) {
    try {
      silenceAudioContext.close();
    } catch {
      // ignore
    }
    silenceAudioContext = null;
  }
}

function startSilenceDetection() {
  stopSilenceDetection();
  const stream = capture?.stream;
  if (!stream || typeof window === 'undefined') return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;

  try {
    silenceAudioContext = new AudioCtx();
    const source = silenceAudioContext.createMediaStreamSource(stream);
    const analyser = silenceAudioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const buffer = new Uint8Array(analyser.frequencyBinCount);
    let speechDetected = false;
    let lastSpeechTime = performance.now();
    const startTime = performance.now();

    silenceMonitorInterval = setInterval(() => {
      if (!capture || capture.state !== 'recording' || combat?.status !== 'active') {
        stopSilenceDetection();
        return;
      }
      analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        const norm = (buffer[i] - 128) / 128;
        sum += norm * norm;
      }
      const rms = Math.sqrt(sum / buffer.length);
      const now = performance.now();

      if (rms > 0.02) {
        speechDetected = true;
        lastSpeechTime = now;
      }

      // If user has spoken and then pauses for 1000ms (1.0s silence)
      if (speechDetected && (now - lastSpeechTime >= 1000)) {
        stopSilenceDetection();
        void stopAndAnalyze();
        return;
      }

      // Safety limit: max 8 seconds per recording
      if (now - startTime >= 8000) {
        stopSilenceDetection();
        void stopAndAnalyze();
      }
    }, 80);
  } catch {
    // AudioContext VAD best effort
  }
}

function chooseAttack(cardId) {
  clearAutoRecord();
  stopSilenceDetection();
  pendingCard = ATTACK_CARDS[cardId];
  pendingChallenge = challengeForCard(pendingCard);
  emitOwnedEvent('player.action.selected', { cardId, challengeId: pendingChallenge.challengeId });
  showChallenge(pendingChallenge);
  attackControls.hidden = true;
  recordControls.hidden = false;
  document.querySelector('#record-label').textContent = 'Speak the target';
  document.querySelector('#record-btn').disabled = false;
  focusElement('#record-btn');
  setStatus('Target ready. Auto-recording in 2s, or click Start recording now.');
  startAutoRecordCountdown(2);
}

function clearRecordingUi() {
  clearAutoRecord();
  stopSilenceDetection();
  stopParryCountdown();
  recordControls.hidden = true;
  document.querySelector('#record-btn').disabled = false;
  document.querySelector('#stop-btn').disabled = true;
  pendingChallenge = null;
  pendingCard = null;
  recordingPurpose = null;
  capture = null;
}

function makeCapture() {
  return hooks.createAudioCapture ? hooks.createAudioCapture() : createAudioCapture();
}

function invalidateActiveOperation() {
  clearAutoRecord();
  stopSilenceDetection();
  operationGeneration += 1;
  analysisAbortController?.abort();
  analysisAbortController = null;
  capture?.cancel?.();
}

function makeNoopAnalysis(challenge, status, reasonCode) {
  return {
    schemaVersion: 'echo-forge-analysis-v1',
    status,
    score: null,
    evaluationMode: challenge.evaluationMode,
    dimensions: {},
    verdict: 'technical_noop',
    engineRevision: 'echo-forge-client-v1',
    challengeId: challenge.challengeId,
    variantId: challenge.pronunciation.variantId,
    reasonCode,
  };
}

async function startRecording() {
  clearAutoRecord();
  const generation = operationGeneration;
  try {
    const nextCapture = makeCapture();
    capture = nextCapture;
    await nextCapture.start();
    if (generation !== operationGeneration || combat?.status !== 'active') {
      nextCapture.cancel?.();
      return;
    }
    reactionStartedAt = performance.now();
    recordingPurpose = combat.turn === 'enemy' ? 'parry' : 'attack';
    document.querySelector('#record-btn').disabled = true;
    document.querySelector('#stop-btn').disabled = false;
    focusElement('#stop-btn');
    emitOwnedEvent('recording.started', {
      challengeId: pendingChallenge.challengeId,
    });
    if (recordingPurpose === 'parry') {
      emitOwnedEvent('player.parry.started', {
        challengeId: pendingChallenge.challengeId,
        windowMs: PARRY_WINDOW_MS,
      });
      startParryCountdown();
    }
    setStatus(recordingPurpose === 'parry' ? 'Parry window open—repeat what you heard now.' : 'Recording… (auto-stops after 1s silence)');
    startSilenceDetection();
  } catch (error) {
    if (generation !== operationGeneration || combat?.status !== 'active') return;
    setStatus(`Microphone unavailable: ${error.message}. No combat state changed.`, 'warning');
  }
}

function timingRecord({ challenge, audio, analysisResult, reducerDurationMs }) {
  telemetry.record({
    challengeId: challenge.challengeId,
    evaluationMode: challenge.evaluationMode,
    selectedLevel: preferences.level,
    supportPreset: preferences.supportPreset,
    audioDurationMs: audio.durationMs,
    audioByteCount: audio.byteCount,
    prewarmDurationMs,
    requestDurationMs: analysisResult.timing.requestDurationMs,
    responseDurationMs: analysisResult.timing.responseDurationMs,
    normalizationDurationMs: analysisResult.timing.normalizationDurationMs,
    reducerResolutionDurationMs: reducerDurationMs,
    outcome: analysisResult.analysis.status,
    httpCode: analysisResult.timing.httpCode,
    errorCode: analysisResult.timing.errorCode,
    retryOrdinal: 0,
  });
  prewarmDurationMs = 0;
}

async function stopAndAnalyze() {
  const purpose = recordingPurpose;
  const challenge = pendingChallenge;
  const card = pendingCard;
  const activeCapture = capture;
  const operation = ++operationGeneration;
  analysisPending = true;
  const reactionDurationMs = performance.now() - reactionStartedAt;
  stopParryCountdown();
  document.querySelector('#stop-btn').disabled = true;
  setStatus('Analyzing your pronunciation...', 'neutral');
  emitOwnedEvent('recording.stopped', { challengeId: challenge.challengeId });
  emitOwnedEvent('analysis.pending', { challengeId: challenge.challengeId });
  try {
    const audio = await activeCapture.stop();
    if (operation !== operationGeneration || combat.status !== 'active') return;
    analysisAbortController = new AbortController();
    const analysisResult = hooks.analyze
      ? await hooks.analyze({ blob: audio.blob, challenge, signal: analysisAbortController.signal })
      : await analysisClient.analyze({ blob: audio.blob, challenge, signal: analysisAbortController.signal });
    if (operation !== operationGeneration || combat.status !== 'active') return;
    const reducerStarted = performance.now();
    let result;
    if (purpose === 'parry') {
      result = coreDispatch({
        type: 'RESOLVE_PARRY',
        timing: reactionDurationMs <= PARRY_WINDOW_MS ? 'timely' : 'late',
        enemyBaseDamage: ENEMY_BASE_DAMAGE,
        analysis: analysisResult.analysis,
      });
    } else {
      result = coreDispatch({
        type: 'RESOLVE_PLAYER_ATTACK',
        cardId: card.id,
        useBurst: document.querySelector('#burst-toggle').checked,
        analysis: analysisResult.analysis,
      });
    }
    timingRecord({ challenge, audio, analysisResult, reducerDurationMs: performance.now() - reducerStarted });
    const noOp = result.events.some((event) => event.type === 'analysis.noop');
    const damage = result.events
      .filter((event) => event.type === 'combat.damage.applied' && event.payload.target === 'enemy')
      .reduce((sum, event) => sum + (Number(event.payload.damage) || 0), 0);
    const feedback = formatAnalysisFeedback({
      analysis: analysisResult.analysis,
      challenge,
      card: card || { label: 'Parry', evaluationMode: challenge.evaluationMode },
      damage,
      supportPreset: preferences.supportPreset,
    });
    showFeedback(feedback);
  runAttempts.push({ status: analysisResult.analysis.status, score: analysisResult.analysis.score, damage, success: analysisResult.analysis.status === 'scored', focus: challenge.pronunciation.focus });
    if (result.events.some((event) => event.type === 'analysis.noop')) {
      if (purpose === 'parry') {
        clearRecordingUi();
        if (hooks.playPrompt) {
          presentBlock();
          setStatus('Parry analysis was unavailable. Block is available; no damage or resource was applied.', 'warning');
        } else {
          presentEnemyIntent();
          setStatus('Parry analysis was unavailable. No damage or resource was applied; choose another defence.', 'warning');
        }
        return;
      }
      setStatus('Analysis could not rate this recording. Try again; no turn or resource changed.', 'warning');
      document.querySelector('#record-btn').disabled = false;
      document.querySelector('#stop-btn').disabled = true;
      focusElement('#record-btn');
      return;
    }
    clearRecordingUi();
    render();
    if (!noOp && combat.turn === 'enemy') presentEnemyIntent();
    else if (!noOp && combat.turn === 'player') {
      showChallenge(null);
      if (purpose === 'parry') setStatus('Parry resolved. Your turn.', 'success');
    }
  } catch (error) {
    if (operation !== operationGeneration || combat?.status !== 'active') return;
    const technicalAnalysis = makeNoopAnalysis(
      challenge,
      error?.name === 'AbortError' ? 'cancelled' : 'unavailable',
      error?.name === 'AbortError' ? 'CANCELLED' : 'CLIENT_ANALYSIS_ERROR',
    );
    showFeedback(formatAnalysisFeedback({ analysis: technicalAnalysis, challenge, card: card || { label: 'Parry', evaluationMode: challenge.evaluationMode }, damage: 0, supportPreset: preferences.supportPreset }));
    runAttempts.push({ status: technicalAnalysis.status, score: null, damage: 0, success: false, focus: challenge.pronunciation.focus });
    if (purpose === 'parry') {
      coreDispatch({ type: 'RESOLVE_PARRY', timing: 'timely', enemyBaseDamage: ENEMY_BASE_DAMAGE, analysis: technicalAnalysis });
      clearRecordingUi();
      if (hooks.playPrompt) presentBlock();
      else presentEnemyIntent();
    } else {
      coreDispatch({ type: 'RESOLVE_PLAYER_ATTACK', cardId: card.id, useBurst: false, analysis: technicalAnalysis });
    }
    setStatus(`Technical analysis error: ${error.message}. No learner failure was recorded.`, 'warning');
    document.querySelector('#record-btn').disabled = false;
    focusElement('#record-btn');
  } finally {
    if (operation === operationGeneration) {
      analysisAbortController = null;
      analysisPending = false;
    }
  }
}

function cancelRecording() {
  const wasPending = analysisPending;
  const purpose = recordingPurpose;
  const challenge = pendingChallenge;
  const card = pendingCard;
  invalidateActiveOperation();
  if (wasPending && challenge && combat?.status === 'active') {
    const cancelled = makeNoopAnalysis(challenge, 'cancelled', 'CANCELLED');
    if (purpose === 'parry') {
      coreDispatch({ type: 'RESOLVE_PARRY', timing: 'timely', enemyBaseDamage: ENEMY_BASE_DAMAGE, analysis: cancelled });
    } else {
      coreDispatch({ type: 'RESOLVE_PLAYER_ATTACK', cardId: card.id, useBurst: false, analysis: cancelled });
    }
  }
  analysisPending = false;
  clearRecordingUi();
  showChallenge(null);
  render();
  setStatus('Recording cancelled. Combat state is unchanged.');
  if (combat.turn === 'player') focusFirstEnabledAttack();
  else focusElement(promptIsReady() ? '#block-btn' : '#parry-btn');
}

function chooseListeningChallenge() {
  return selectChallenge(catalog.challenges, {
    level: preferences.level, unitType: 'listening', rng, recentChallengeIds: challengeHistory,
  });
}

function shuffledOptions(options) {
  const values = [...options];
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng.nextFloat() * (index + 1));
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  return values;
}

function playPrompt(challenge) {
  if (hooks.playPrompt) {
    try {
      return Promise.resolve(hooks.playPrompt(challenge)).then((result) => result !== false).catch((error) => {
        setStatus(`Listening Block playback failed. Choose Parry; no combat state changed. (${error.message})`, 'neutral');
        return false;
      });
    } catch (error) {
      setStatus(`Listening Block playback failed. Choose Parry; no combat state changed. (${error.message})`, 'neutral');
      return Promise.resolve(false);
    }
  }
  if (!promptAdapter?.isReady?.()) {
    setStatus('Listening Block is unavailable until its versioned audio artifact is verified. Choose Parry.', 'neutral');
    return Promise.resolve(false);
  }
  return promptAdapter.play(challenge).then(() => true).catch((error) => {
    setStatus(`Listening Block playback failed. Choose Parry; no combat state changed. (${error.message})`, 'neutral');
    return false;
  });
}

function promptIsReady() {
  return Boolean(hooks.playPrompt || promptAdapter?.isReady?.());
}

function resolveBlockOutcome(outcome) {
  if (!blockPlaybackReady) return;
  clearTimeout(blockTimer);
  blockTimer = null;
  blockPlaybackGeneration += 1;
  blockPlaybackReady = false;
  promptAdapter?.cancel?.();
  blockOptions.setAttribute('aria-busy', 'false');
  blockOptions.hidden = true;
  coreDispatch({ type: 'RESOLVE_BLOCK', outcome, enemyBaseDamage: ENEMY_BASE_DAMAGE });
  showChallenge(null);
  setStatus(outcome === 'correct' ? 'Correct Block: half damage and one Focus restored.' : `${outcome === 'timeout' ? 'Block timed out' : 'Incorrect Block'}: defence reduced.`, outcome === 'correct' ? 'success' : 'warning');
  focusFirstEnabledAttack();
}

function presentBlock() {
  if (!promptIsReady()) {
    setStatus('Listening Block is unavailable until its versioned audio artifact is verified. Choose Parry.', 'warning');
    return;
  }
  const playbackGeneration = ++blockPlaybackGeneration;
  blockPlaybackReady = false;
  pendingChallenge = null;
  defendControls.hidden = true;
  blockOptions.hidden = false;
  showChallenge(blockChallenge, { hideTarget: true });
  optionRow.replaceChildren();
  const hear = document.createElement('button');
  hear.type = 'button';
  hear.textContent = 'Hear word';
  hear.addEventListener('click', () => {
    clearTimeout(blockTimer);
    blockTimer = null;
    blockPlaybackReady = false;
    setBlockPlaybackPending(true);
    promptAdapter?.cancel?.();
    blockPlaybackGeneration += 1;
    void beginBlockPlayback(blockChallenge, blockPlaybackGeneration);
  });
  optionRow.append(hear);
  for (const option of shuffledOptions(blockChallenge.listening.options)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = option.text;
    button.dataset.optionId = option.optionId;
    button.addEventListener('click', () => resolveBlockOutcome(
      option.optionId === blockChallenge.listening.answerId ? 'correct' : 'incorrect',
    ));
    optionRow.append(button);
  }
  setBlockPlaybackPending(true);
  focusElement('#block-options');
  void beginBlockPlayback(blockChallenge, playbackGeneration);
}

function setBlockPlaybackPending(pending) {
  blockOptions.setAttribute('aria-busy', pending ? 'true' : 'false');
  for (const button of optionRow.querySelectorAll('button')) button.disabled = pending;
}

function cancelBlockPrompt() {
  if (blockOptions.hidden) return false;
  clearTimeout(blockTimer);
  blockTimer = null;
  blockPlaybackGeneration += 1;
  blockPlaybackReady = false;
  promptAdapter?.cancel?.();
  setBlockPlaybackPending(false);
  blockOptions.hidden = true;
  optionRow.replaceChildren();
  defendControls.hidden = false;
  focusElement('#block-btn');
  setStatus('Listening Block cancelled. Combat state is unchanged.');
  return true;
}

async function beginBlockPlayback(challenge, playbackGeneration) {
  const hadReadyPlayback = blockPlaybackReady;
  const played = await playPrompt(challenge);
  if (playbackGeneration !== blockPlaybackGeneration || challenge !== blockChallenge || combat?.status !== 'active') return;
  if (!played) {
    blockPlaybackReady = hadReadyPlayback;
    setBlockPlaybackPending(false);
    if (!hadReadyPlayback) {
      blockOptions.hidden = true;
      optionRow.replaceChildren();
      defendControls.hidden = false;
      focusElement('#parry-btn');
    }
    setStatus('Listening Block playback failed. Choose Parry; no combat state changed.', 'neutral');
    return;
  }
  blockPlaybackReady = true;
  setBlockPlaybackPending(false);
  optionRow.querySelector('button[data-option-id]:not([disabled])')?.focus({ preventScroll: true });
  clearTimeout(blockTimer);
  blockTimer = setTimeout(() => resolveBlockOutcome('timeout'), 8000);
}

async function playParryAttackAudio(challenge) {
  if (!challenge) return false;
  if (hooks.playPrompt) {
    try {
      const res = await Promise.resolve(hooks.playPrompt(challenge));
      return res !== false;
    } catch {
      return false;
    }
  }
  if (promptAdapter?.isReady?.()) {
    try {
      await promptAdapter.play(challenge);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

async function presentParry() {
  clearAutoRecord();
  stopSilenceDetection();
  pendingCard = null;
  pendingChallenge = parryChallenge;
  defendControls.hidden = true;
  recordControls.hidden = false;
  document.querySelector('#record-label').textContent = 'Parry: Listen & repeat';
  document.querySelector('#record-btn').disabled = false;
  showChallenge(parryChallenge, { hideTarget: true, promptLabel: '🎧 Listen & Repeat' });
  focusElement('#record-btn');
  setStatus('The Warden strikes with a spoken word! Listening...', 'neutral');

  await playParryAttackAudio(parryChallenge);

  if (combat?.status !== 'active' || recordControls.hidden) return;
  setStatus('Parry window open! Repeat the word now (auto-recording in 1s)...');
  startAutoRecordCountdown(1);
}

function presentEnemyIntent() {
  if (combat.status !== 'active' || combat.turn !== 'enemy') return;
  blockChallenge = chooseListeningChallenge();
  parryChallenge = selectChallenge(catalog.challenges, {
    level: preferences.level, unitType: 'listening', rng, recentChallengeIds: challengeHistory,
  }) || selectChallenge(catalog.challenges, {
    level: preferences.level, evaluationMode: 'azure_word', unitType: 'word', rng, recentChallengeIds: challengeHistory,
  });
  pendingChallenge = null;
  showChallenge(null);
  defendControls.hidden = false;
  const blockButton = document.querySelector('#block-btn');
  blockButton.disabled = !promptIsReady();
  focusElement(promptIsReady() ? '#block-btn' : '#parry-btn');
  setStatus(promptIsReady()
    ? 'The Warden attacks! Block or Parry to defend.'
    : 'The Warden attacks! Parry is available.');
}

async function startRun() {
  preferences = createRunPreferences({
    level: document.querySelector('#level-select').value,
    supportPreset: document.querySelector('#support-select').value,
  });
  rng = createSeededRng(0x4543484f);
  initialState = createInitialCombatState({ level: preferences.level });
  combat = initialState;
  replayActions = [];
  challengeHistory = new Set();
  runAttempts = [];
  summaryNode.hidden = true;
  eventLog.replaceChildren();
  showFeedback({ tone: 'neutral', text: 'Choose an action to begin.' });
  setupNode.hidden = true;
  battleNode.hidden = false;
  document.querySelector('#abandon-btn').hidden = false;
  coreDispatch({ type: 'START_COMBAT' });
  showChallenge(null);
  setStatus('Your turn — choose an attack!');
  const prewarm = await analysisClient.prewarmV3?.();
  prewarmDurationMs = prewarm?.durationMs || 0;
}

function download(name, type, contents) {
  emitOwnedEvent('telemetry.exported', { format: name.endsWith('.csv') ? 'csv' : 'json' });
  setStatus(`Timing ${name.endsWith('.csv') ? 'CSV' : 'JSON'} exported.`, 'success');
  if (hooks.captureExport) return hooks.captureExport({ name, type, contents });
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function replayState() {
  if (!initialState || replayActions.length === 0) return;
  const replayed = replayCombat(initialState, replayActions);
  combat = replayed.state;
  render();
  setStatus('Deterministic replay reproduced the current combat state.', 'success');
}

async function init() {
  try {
    const configPayload = hooks.featureConfig || await fetch('/api/config').then((response) => response.json());
    if (configPayload?.features?.echoForgeSandbox !== true) {
      root.dataset.state = 'disabled';
      setStatus('Echo Forge sandbox is disabled by configuration. No microphone or game system was started.');
      return;
    }
    catalog = hooks.catalog || await fetch('/database/echo-forge/challenges.v1.json').then((response) => {
      if (!response.ok) throw new Error(`catalog request failed (${response.status})`);
      return response.json();
    });
    if (catalog.schemaVersion !== 'echo-forge-challenge-catalog-v1'
      || catalog.challenges.some((challenge) => challenge.level === 'C2')) {
      throw new Error('catalog contract is invalid');
    }
    if (hooks.audioPromptAdapter) {
      promptAdapter = hooks.audioPromptAdapter;
      if (typeof promptAdapter.load === 'function' && !promptAdapter.isReady?.()) await promptAdapter.load(catalog);
    } else if (!hooks.playPrompt) {
      try {
        promptAdapter = createAudioPromptAdapter();
        await promptAdapter.load(catalog);
      } catch (error) {
        promptAdapter = null;
        setStatus(`Sandbox ready; Listening Block is unavailable until audio verification completes. (${error.message})`, 'neutral');
      }
    }
    root.dataset.state = 'ready';
    document.querySelector('#start-btn').disabled = false;
    updateSetupDescriptions();
    void visualPresenter.load();
    emitOwnedEvent('sandbox.setup.completed');
    if (promptIsReady()) setStatus('Arena ready. Choose your settings and begin.');
  } catch (error) {
    root.dataset.state = 'error';
    setStatus(`Sandbox unavailable: ${error.message}`, 'error');
  }
}

for (const button of document.querySelectorAll('[data-card]')) button.addEventListener('click', () => chooseAttack(button.dataset.card));
document.querySelector('#start-btn').addEventListener('click', startRun);
document.querySelector('#level-select').addEventListener('change', updateSetupDescriptions);
document.querySelector('#support-select').addEventListener('change', updateSetupDescriptions);
document.querySelector('#record-btn').addEventListener('click', startRecording);
document.querySelector('#stop-btn').addEventListener('click', stopAndAnalyze);
document.querySelector('#cancel-btn').addEventListener('click', cancelRecording);
document.querySelector('#block-btn').addEventListener('click', presentBlock);
document.querySelector('#parry-btn').addEventListener('click', presentParry);
document.querySelector('#abandon-btn').addEventListener('click', () => {
  if (!combat || combat.status !== 'active') return;
  invalidateActiveOperation();
  promptAdapter?.cancel?.();
  analysisPending = false;
  clearTimeout(blockTimer);
  blockTimer = null;
  setBlockPlaybackPending(false);
  blockOptions.hidden = true;
  optionRow.replaceChildren();
  clearRecordingUi();
  coreDispatch({ type: 'ABANDON_COMBAT' });
});
document.querySelector('#play-again-btn').addEventListener('click', () => { void startRun(); });
document.querySelector('#change-settings-btn').addEventListener('click', () => {
  invalidateActiveOperation();
  stopParryCountdown();
  summaryNode.hidden = true;
  battleNode.hidden = true;
  setupNode.hidden = false;
  document.querySelector('#abandon-btn').hidden = true;
  updateSetupDescriptions();
  document.querySelector('#setup-heading').focus({ preventScroll: true });
});
document.querySelector('#replay-btn').addEventListener('click', replayState);
document.querySelector('#export-json-btn').addEventListener('click', () => download('echo-forge-timing.json', 'application/json', telemetry.exportJson()));
document.querySelector('#export-csv-btn').addEventListener('click', () => download('echo-forge-timing.csv', 'text/csv', telemetry.exportCsv()));
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !combat || combat.status !== 'active') return;
  if (!recordControls.hidden) {
    event.preventDefault();
    cancelRecording();
    return;
  }
  if (!blockOptions.hidden && cancelBlockPrompt()) event.preventDefault();
});

window.echoForgeSandbox = Object.freeze({
  getState: () => combat,
  getReplay: () => Object.freeze(structuredClone(replayActions)),
  getTelemetry: () => telemetry.snapshot(),
  replay: replayState,
});

window.addEventListener('pagehide', () => {
  invalidateActiveOperation();
  clearTimeout(blockTimer);
  blockTimer = null;
  setBlockPlaybackPending(false);
  promptAdapter?.dispose?.();
  promptAdapter = null;
  blockPlaybackGeneration += 1;
  blockPlaybackReady = false;
  stopParryCountdown();
  visualPresenter.dispose();
});

init();
