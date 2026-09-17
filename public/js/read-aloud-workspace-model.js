/*
 * Read Aloud Workspace V2 Presentation Model
 * Destination: public/js/read-aloud-workspace-model.js
 * Browser: window.ReadAloudWorkspaceModel.derive(snapshot)
 * Node:    require('./read-aloud-workspace-model.js').derive(snapshot)
 *
 * Standalone, read-only presentation policy. Maps existing recording states
 * plus explicitly supplied outcome metadata to UI phases and button IDs.
 * Never changes recording state, starts timers, requests microphones,
 * posts assessments, or saves attempts.
 */
(function expose(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ReadAloudWorkspaceModel = api;
  if (typeof globalThis !== 'undefined') globalThis.ReadAloudWorkspaceModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createModel() {
  'use strict';

  /**
   * @typedef {Object} AssessmentOutcome
   * @property {'none'|'success'|'error'} kind
   * @property {boolean} [retryable] True only for a classified recoverable error.
   * @property {string} [message] Learner-facing, non-sensitive explanation.
   *
   * @typedef {Object} Snapshot
   * @property {string} state Existing ReadAloudMode.state, unchanged.
   * @property {boolean} currentPromptReady
   * @property {boolean} recordingSupported Existing support check result.
   * @property {boolean} isSubmitInFlight Existing submission owner flag.
   * @property {boolean} canSubmitPendingAttempt Derived by the mode from a blob,
   *   session, and current prompt/request identity. Do not infer from a blob alone.
   * @property {AssessmentOutcome} assessmentOutcome Mode-owned outcome data.
   * @property {string|null} [promptLoadError] Metadata written by the real load failure path.
   * @property {string|null} [captureError] Metadata written by the real mic/capture failure path.
   */

  function action(id, label, disabled = false) {
    return Object.freeze({ id, label, disabled });
  }

  function view(phase, stepIndex, options = {}) {
    return Object.freeze({
      phase,
      stepIndex,
      primary: null,
      secondary: null,
      timer: null,
      busy: false,
      // 'blocked' concerns changing questions. A separately confirmed exit must
      // still be possible, including while browser permission is pending.
      questionChange: 'allow',
      configurationLocked: false,
      notice: '',
      ...options
    });
  }

  /** @param {Snapshot} s */
  function derive(s) {
    if (!s || typeof s !== 'object') {
      throw new TypeError('A Read Aloud workspace snapshot is required.');
    }

    if (s.isSubmitInFlight) {
      return view('analyzing', 2, {
        primary: action('ra-check-btn', 'Analyzing…', true),
        busy: true,
        questionChange: 'blocked',
        configurationLocked: true,
        notice: 'Analyzing your recording.'
      });
    }

    if (s.promptLoadError) {
      return view('load-error', 0, {
        notice: String(s.promptLoadError)
        // Keep the existing question browser available. A dedicated retry-load
        // action must call a verified loading entry point; none is invented here.
      });
    }

    if (!s.currentPromptReady) {
      return view('loading', 0, {
        busy: true,
        questionChange: 'blocked',
        configurationLocked: true,
        notice: 'Loading question…'
      });
    }

    switch (s.state) {
      case 'PREP': {
        if (!s.recordingSupported) {
          return view('unsupported', 0, {
            primary: action('ra-record-btn', 'Recording unavailable', true),
            notice: 'Recording is unavailable in this environment.'
          });
        }
        return view('prepare', 0, {
          primary: action('ra-record-btn', s.captureError ? 'Try microphone again' : 'Start recording now'),
          timer: s.captureError ? null : 'prep',
          notice: s.captureError ? String(s.captureError) : ''
        });
      }
      case 'REQUESTING_MIC':
        return view('requesting-mic', 1, {
          primary: action('ra-record-btn', 'Waiting for microphone…', true),
          busy: true,
          questionChange: 'blocked',
          configurationLocked: true,
          notice: 'Allow microphone access in your browser. Recording has not started.'
        });
      case 'RECORDING':
        return view('recording', 1, {
          primary: action('ra-stop-btn', 'Finish recording'),
          timer: 'record',
          questionChange: 'blocked',
          configurationLocked: true,
          notice: 'Recording. Read the passage aloud.'
        });
      case 'STOPPING_RECORDING':
        return view('finishing', 1, {
          busy: true,
          questionChange: 'blocked',
          configurationLocked: true,
          notice: 'Finishing your recording…'
        });
      case 'RECORDED':
        if (!s.canSubmitPendingAttempt) {
          return view('capture-error', 2, {
            primary: action('ra-retry-btn', 'Record again'),
            questionChange: 'confirm-discard',
            notice: s.captureError || 'This recording is not available for assessment. Please record again.'
          });
        }
        return view('recording-ready', 2, {
          primary: action('ra-check-btn', 'Get feedback'),
          secondary: action('ra-retry-btn', 'Record again'),
          questionChange: 'confirm-discard',
          notice: 'Your recording is ready. Listen back or get feedback.'
        });
      case 'RESULTS': {
        const outcome = s.assessmentOutcome || { kind: 'none' };
        if (outcome.kind === 'success' || outcome.kind === 'none') {
          return view('feedback', 2, {
            // Existing handleRecordClick() advances to the next prompt in RESULTS.
            primary: action('ra-record-btn', 'Next question'),
            secondary: action('ra-retry-btn', 'Try again'),
            notice: outcome.kind === 'success' ? 'Feedback is ready.' : 'Feedback ready.'
          });
        }
        if (outcome.kind === 'error') {
          const canRetry = outcome.retryable === true && s.canSubmitPendingAttempt === true;
          return view('assessment-error', 2, {
            primary: canRetry
              ? action('ra-check-btn', 'Retry analysis')
              : action('ra-retry-btn', 'Record again'),
            secondary: canRetry ? action('ra-retry-btn', 'Record again') : action('ra-record-btn', 'Next question'),
            questionChange: s.canSubmitPendingAttempt ? 'confirm-discard' : 'allow',
            notice: outcome.message || 'We could not assess this recording.'
          });
        }
        return view('result-unavailable', 2, {
          primary: action('ra-record-btn', 'Next question'),
          secondary: action('ra-retry-btn', 'Record again'),
          questionChange: s.canSubmitPendingAttempt ? 'confirm-discard' : 'allow',
          notice: 'A confirmed assessment result is unavailable.'
        });
      }
      default:
        // Fail closed. Do not expose a record/submit action for an unrecognized
        // combination.
        return view('unavailable', 0, {
          notice: 'This question is not ready for an attempt.'
        });
    }
  }

  return Object.freeze({ derive });
});
