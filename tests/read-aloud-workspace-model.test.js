import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/js/read-aloud-workspace-model.js';

const { derive } = globalThis.ReadAloudWorkspaceModel;

function snapshot(overrides = {}) {
  return {
    state: 'PREP', currentPromptReady: true, recordingSupported: true,
    isSubmitInFlight: false, canSubmitPendingAttempt: false,
    assessmentOutcome: { kind: 'none' },
    promptLoadError: null, captureError: null, ...overrides
  };
}

test('rejects a missing snapshot', () => assert.throws(() => derive(), TypeError));
test('preparation reuses the existing record action and prep timer', () => {
  const v = derive(snapshot());
  assert.equal(v.phase, 'prepare');
  assert.equal(v.primary.id, 'ra-record-btn');
  assert.equal(v.timer, 'prep');
});
test('loading never exposes an enabled recording action', () => {
  const v = derive(snapshot({ currentPromptReady: false }));
  assert.equal(v.phase, 'loading'); assert.equal(v.primary, null);
});
test('a real loading error does not remain an infinite spinner', () => {
  const v = derive(snapshot({ currentPromptReady: false, promptLoadError: 'Question unavailable.' }));
  assert.equal(v.phase, 'load-error'); assert.equal(v.busy, false);
  assert.equal(v.questionChange, 'allow');
});
test('unsupported recording stays disabled', () => {
  const v = derive(snapshot({ recordingSupported: false }));
  assert.equal(v.phase, 'unsupported'); assert.equal(v.primary.disabled, true);
});
test('a microphone failure does not advertise a running prep timer', () => {
  const v = derive(snapshot({ captureError: 'Microphone access was blocked.' }));
  assert.equal(v.primary.label, 'Try microphone again'); assert.equal(v.timer, null);
});
test('waiting for permission is not recording', () => {
  const v = derive(snapshot({ state: 'REQUESTING_MIC' }));
  assert.equal(v.phase, 'requesting-mic'); assert.equal(v.timer, null);
  assert.equal(v.primary.disabled, true); assert.equal(v.questionChange, 'blocked');
});
test('recording exposes only the existing stop action', () => {
  const v = derive(snapshot({ state: 'RECORDING' }));
  assert.equal(v.primary.id, 'ra-stop-btn'); assert.equal(v.secondary, null);
  assert.equal(v.timer, 'record'); assert.equal(v.configurationLocked, true);
});
test('finishing never prematurely enables assessment', () => {
  const v = derive(snapshot({ state: 'STOPPING_RECORDING' }));
  assert.equal(v.primary, null); assert.equal(v.busy, true);
});
test('captured audio enters Review, not Record', () => {
  const v = derive(snapshot({ state: 'RECORDED', canSubmitPendingAttempt: true }));
  assert.equal(v.phase, 'recording-ready'); assert.equal(v.stepIndex, 2);
  assert.equal(v.primary.id, 'ra-check-btn'); assert.equal(v.secondary.id, 'ra-retry-btn');
  assert.equal(v.questionChange, 'confirm-discard');
});
test('missing pending audio cannot be submitted', () => {
  const v = derive(snapshot({ state: 'RECORDED' }));
  assert.equal(v.phase, 'capture-error'); assert.equal(v.primary.id, 'ra-retry-btn');
});
test('submission takes priority even before legacy state changes', () => {
  const v = derive(snapshot({ state: 'RECORDED', isSubmitInFlight: true, canSubmitPendingAttempt: true }));
  assert.equal(v.phase, 'analyzing'); assert.equal(v.stepIndex, 2);
  assert.equal(v.primary.disabled, true); assert.equal(v.questionChange, 'blocked');
});
test('confirmed success keeps the existing Next action wiring', () => {
  const v = derive(snapshot({ state: 'RESULTS', assessmentOutcome: { kind: 'success' } }));
  assert.equal(v.phase, 'feedback'); assert.equal(v.primary.id, 'ra-record-btn');
  assert.equal(v.primary.label, 'Next question');
});
test('RESULTS and hasAssessmentResult do not prove success', () => {
  const v = derive(snapshot({ state: 'RESULTS', hasAssessmentResult: true }));
  assert.equal(v.phase, 'result-unavailable');
  assert.notEqual(v.primary.label, 'Next question');
});
test('a retryable error with the current pending attempt offers Retry analysis', () => {
  const v = derive(snapshot({ state: 'RESULTS', canSubmitPendingAttempt: true,
    assessmentOutcome: { kind: 'error', retryable: true, message: 'Service unavailable.' } }));
  assert.equal(v.phase, 'assessment-error'); assert.equal(v.primary.id, 'ra-check-btn');
  assert.equal(v.primary.label, 'Retry analysis'); assert.equal(v.notice, 'Service unavailable.');
});
test('retryable error without audio requires recording again', () => {
  const v = derive(snapshot({ state: 'RESULTS',
    assessmentOutcome: { kind: 'error', retryable: true } }));
  assert.equal(v.primary.id, 'ra-retry-btn');
});
test('invalid audio does not encourage repeatedly submitting the same audio', () => {
  const v = derive(snapshot({ state: 'RESULTS', canSubmitPendingAttempt: true,
    assessmentOutcome: { kind: 'error', retryable: false, message: 'No speech detected.' } }));
  assert.equal(v.primary.id, 'ra-retry-btn'); assert.equal(v.secondary, null);
});
test('unsupported microphone does not erase an already valid result', () => {
  const v = derive(snapshot({ state: 'RESULTS', recordingSupported: false,
    assessmentOutcome: { kind: 'success' } }));
  assert.equal(v.phase, 'feedback');
});
test('unknown engine state fails closed', () => {
  const v = derive(snapshot({ state: 'UNEXPECTED' }));
  assert.equal(v.phase, 'unavailable'); assert.equal(v.primary, null);
});
test('projection does not mutate the snapshot or nested outcome', () => {
  const outcome = Object.freeze({ kind: 'error', retryable: true });
  const s = Object.freeze(snapshot({ state: 'RESULTS', assessmentOutcome: outcome }));
  derive(s); assert.equal(s.assessmentOutcome, outcome);
  assert.equal(s.state, 'RESULTS');
});
