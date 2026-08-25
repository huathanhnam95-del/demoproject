import { config as pronunciationConfig } from '../../pronunciation-analyzer/config.js';
import { createAudioCapture } from './adapters/audio-capture-adapter.js';
import { createAnalysisClient } from './adapters/analysis-client.js';
import { createTimingTelemetry } from './adapters/timing-telemetry.js';
import { ATTACK_CARDS, createRunPreferences } from './core/policy.js';
import { createSeededRng } from './core/rng.js';
import { selectChallenge } from './core/challenge-selector.js';
import { createInitialCombatState, reduceCombat, replayCombat } from './core/combat-reducer.js';

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
    row.textContent = semanticEvent.type;
    eventLog.prepend(row);
    while (eventLog.children.length > 12) eventLog.lastElementChild.remove();
    root.dispatchEvent(new CustomEvent('echo-forge:event', { detail: semanticEvent }));
  }
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

function showChallenge(challenge, { hideTarget = false } = {}) {
  document.querySelector('#challenge-text').textContent = hideTarget ? 'Listen, then choose' : challenge?.text || 'Choose an action';
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
    button.disabled = terminal || combat.turn !== 'player' || combat.hero.focus < card.focusCost;
  }
  const burst = document.querySelector('#burst-toggle');
  burst.disabled = combat.hero.resonance < 100;
  if (burst.disabled) burst.checked = false;
  if (terminal) {
    recordControls.hidden = true;
    blockOptions.hidden = true;
    document.querySelector('#abandon-btn').hidden = true;
  }
  if (combat.status === 'victory') setStatus('Victory. Your pronunciation broke the Echo Warden’s guard.', 'success');
  if (combat.status === 'defeat') setStatus('Run ended. This result is practice feedback, not a learner judgment.', 'warning');
  if (combat.status === 'abandoned') setStatus('Run abandoned. No account progress was changed.', 'neutral');
}

function challengeForCard(card) {
  return selectChallenge(catalog.challenges, {
    level: preferences.level,
    evaluationMode: card.evaluationMode,
    unitType: card.unitType,
    rng,
  });
}

function chooseAttack(cardId) {
  pendingCard = ATTACK_CARDS[cardId];
  pendingChallenge = challengeForCard(pendingCard);
  emitOwnedEvent('player.action.selected', { cardId, challengeId: pendingChallenge.challengeId });
  showChallenge(pendingChallenge);
  attackControls.hidden = true;
  recordControls.hidden = false;
  document.querySelector('#record-label').textContent = 'Speak the target';
  setStatus('Read the target, then record when ready.');
}

function clearRecordingUi() {
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
    emitOwnedEvent('recording.started', {
      challengeId: pendingChallenge.challengeId,
    });
    if (recordingPurpose === 'parry') {
      emitOwnedEvent('player.parry.started', {
        challengeId: pendingChallenge.challengeId,
        windowMs: PARRY_WINDOW_MS,
      });
    }
    setStatus(recordingPurpose === 'parry' ? 'Parry window open—repeat the target now.' : 'Recording…');
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
  document.querySelector('#stop-btn').disabled = true;
  setStatus('Analysis pending. The reaction timer is stopped.', 'neutral');
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
}

function chooseListeningChallenge() {
  return selectChallenge(catalog.challenges, {
    level: preferences.level, unitType: 'listening', rng,
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
  if (hooks.playPrompt) return hooks.playPrompt(challenge);
  setStatus('Listening Block is unavailable until its versioned audio artifact is verified. Choose Parry.', 'warning');
  return false;
}

function resolveBlockOutcome(outcome) {
  clearTimeout(blockTimer);
  blockOptions.hidden = true;
  coreDispatch({ type: 'RESOLVE_BLOCK', outcome, enemyBaseDamage: ENEMY_BASE_DAMAGE });
  showChallenge(null);
  setStatus(outcome === 'correct' ? 'Correct Block: half damage and one Focus restored.' : `${outcome === 'timeout' ? 'Block timed out' : 'Incorrect Block'}: defence reduced.`, outcome === 'correct' ? 'success' : 'warning');
}

function presentBlock() {
  if (!hooks.playPrompt) {
    setStatus('Listening Block is unavailable until its versioned audio artifact is verified. Choose Parry.', 'warning');
    return;
  }
  pendingChallenge = null;
  defendControls.hidden = true;
  blockOptions.hidden = false;
  showChallenge(blockChallenge, { hideTarget: true });
  optionRow.replaceChildren();
  const hear = document.createElement('button');
  hear.type = 'button';
  hear.textContent = 'Hear word';
  hear.addEventListener('click', () => playPrompt(blockChallenge));
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
  playPrompt(blockChallenge);
  blockTimer = setTimeout(() => resolveBlockOutcome('timeout'), 8000);
}

function presentParry() {
  pendingCard = null;
  pendingChallenge = parryChallenge;
  defendControls.hidden = true;
  recordControls.hidden = false;
  document.querySelector('#record-label').textContent = 'Repeat within four seconds to Parry';
  showChallenge(parryChallenge);
  setStatus('Start recording when ready. Analysis time will not count against the Parry window.');
}

function presentEnemyIntent() {
  if (combat.status !== 'active' || combat.turn !== 'enemy') return;
  blockChallenge = chooseListeningChallenge();
  parryChallenge = selectChallenge(catalog.challenges, {
    level: preferences.level, evaluationMode: 'azure_word', unitType: 'word', rng,
  });
  pendingChallenge = null;
  showChallenge(null);
  defendControls.hidden = false;
  const blockButton = document.querySelector('#block-btn');
  blockButton.disabled = !hooks.playPrompt;
  setStatus(hooks.playPrompt
    ? 'Enemy intent: choose a safe listening Block or a timed pronunciation Parry.'
    : 'Enemy intent: versioned Block audio is pending verification; pronunciation Parry remains available.');
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
  setupNode.hidden = true;
  battleNode.hidden = false;
  document.querySelector('#abandon-btn').hidden = false;
  coreDispatch({ type: 'START_COMBAT' });
  showChallenge(null);
  setStatus('Your turn. Choose an attack; your level and support choices remain under your control.');
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
    root.dataset.state = 'ready';
    document.querySelector('#start-btn').disabled = false;
    emitOwnedEvent('sandbox.setup.completed');
    setStatus('Sandbox ready. Choose a level and support preset.');
  } catch (error) {
    root.dataset.state = 'error';
    setStatus(`Sandbox unavailable: ${error.message}`, 'error');
  }
}

for (const button of document.querySelectorAll('[data-card]')) button.addEventListener('click', () => chooseAttack(button.dataset.card));
document.querySelector('#start-btn').addEventListener('click', startRun);
document.querySelector('#record-btn').addEventListener('click', startRecording);
document.querySelector('#stop-btn').addEventListener('click', stopAndAnalyze);
document.querySelector('#cancel-btn').addEventListener('click', cancelRecording);
document.querySelector('#block-btn').addEventListener('click', presentBlock);
document.querySelector('#parry-btn').addEventListener('click', presentParry);
document.querySelector('#abandon-btn').addEventListener('click', () => {
  if (!combat || combat.status !== 'active') return;
  invalidateActiveOperation();
  analysisPending = false;
  clearTimeout(blockTimer);
  blockOptions.hidden = true;
  optionRow.replaceChildren();
  clearRecordingUi();
  coreDispatch({ type: 'ABANDON_COMBAT' });
});
document.querySelector('#replay-btn').addEventListener('click', replayState);
document.querySelector('#export-json-btn').addEventListener('click', () => download('echo-forge-timing.json', 'application/json', telemetry.exportJson()));
document.querySelector('#export-csv-btn').addEventListener('click', () => download('echo-forge-timing.csv', 'text/csv', telemetry.exportCsv()));

window.echoForgeSandbox = Object.freeze({
  getState: () => combat,
  getReplay: () => Object.freeze(structuredClone(replayActions)),
  getTelemetry: () => telemetry.snapshot(),
  replay: replayState,
});

init();
