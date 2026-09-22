'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Test 1: TranscriptDisclosure UMD compatibility and rendering
test('TranscriptDisclosure: loads via UMD and renders tokens with disclosure banner', (t) => {
  const code = fs.readFileSync(path.join(__dirname, '../public/js/audio/transcript-disclosure.js'), 'utf8');
  // Should not have top-level export keyword which breaks classic browser scripts
  assert.doesNotMatch(code, /^\s*export\s+class/m, 'Must not contain raw top-level export keyword');

  // Load in mock browser environment
  const mockWindow = {};
  const evaluate = new Function('window', 'self', code);
  evaluate(mockWindow, mockWindow);

  const TranscriptDisclosure = mockWindow.TranscriptDisclosure;
  assert.ok(TranscriptDisclosure, 'TranscriptDisclosure should be attached to window');

  // Mock DOM container
  const container = {
    innerHTML: '',
    querySelector(sel) {
      return {
        addEventListener: () => {},
        setAttribute: () => {}
      };
    },
    querySelectorAll(sel) {
      return [];
    }
  };

  const disclosure = new TranscriptDisclosure({ containerEl: container });
  const mockResult = {
    transcription: { rawTranscript: 'Hello world test' },
    words: [
      { word: 'Hello', accuracyScore: 90, isTranscriptUncertain: false },
      { word: 'world', accuracyScore: 65, isTranscriptUncertain: true },
      { word: 'test', accuracyScore: 40, isTranscriptUncertain: false }
    ],
    transcriptDisclosure: {
      headline: 'Pronunciation of your response',
      subtitle: 'Based on unscripted ASR transcript'
    }
  };

  disclosure.render(mockResult);

  assert.match(container.innerHTML, /transcript-disclosure-wrapper/, 'Should render disclosure wrapper');
  assert.match(container.innerHTML, /token-pass/, 'Should include passing score class (90)');
  assert.match(container.innerHTML, /token-amber/, 'Should include amber score class (65)');
  assert.match(container.innerHTML, /token-uncertain/, 'Should include uncertain class for uncertain word');
  assert.match(container.innerHTML, /token-red/, 'Should include red score class (40)');
});

// Test 2: AiScoringGate quote requesting, cancellation, and polling
test('AiScoringGate: handles preflight quote, user cancellation, and unmetered 503 fallback', async (t) => {
  const code = fs.readFileSync(path.join(__dirname, '../public/js/audio/ai-scoring-gate.js'), 'utf8');
  const originalFetch = globalThis.fetch;

  const mockWindow = {
    AiCreditConfirmation: {
      AiCreditConfirmationModal: class {
        async requestConfirmation(quote) {
          if (quote.simulateCancel) return { confirmed: false };
          return { confirmed: true };
        }
      }
    }
  };

  const evaluate = new Function('window', 'self', code);
  evaluate(mockWindow, mockWindow);

  const AiScoringGate = mockWindow.AiScoringGate;
  assert.ok(AiScoringGate, 'AiScoringGate should be attached');

  try {
    // Case A: User cancels in confirmation modal
    globalThis.fetch = async (url) => {
      if (url === '/api/ai-scoring/quotes') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ quoteId: 'q-1', credits: 15, simulateCancel: true })
        };
      }
      throw new Error(`Unexpected url: ${url}`);
    };

    const cancelResult = await AiScoringGate.requestConsentAndConfirm({
      mode: 'summarize_group_discussion',
      inputMeta: { sampleCount: 32000 }
    });

    assert.strictEqual(cancelResult.allowed, false);
    assert.strictEqual(cancelResult.cancelled, true);

    // Case B: User confirms
    let confirmCalled = false;
    globalThis.fetch = async (url, opts) => {
      if (url === '/api/ai-scoring/quotes') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ quoteId: 'q-2', credits: 15, simulateCancel: false })
        };
      }
      if (url === '/api/ai-scoring/quotes/q-2/confirm') {
        confirmCalled = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({ assessmentId: 'asmt-123', state: 'queued' })
        };
      }
      throw new Error(`Unexpected url: ${url}`);
    };

    const confirmResult = await AiScoringGate.requestConsentAndConfirm({
      mode: 'summarize_group_discussion',
      inputMeta: { sampleCount: 32000 }
    });

    assert.strictEqual(confirmResult.allowed, true);
    assert.strictEqual(confirmResult.assessmentId, 'asmt-123');
    assert.strictEqual(confirmCalled, true);

    // Case C: Feature disabled (503) allows unmetered fallback
    globalThis.fetch = async (url) => {
      if (url === '/api/ai-scoring/quotes') {
        return { ok: false, status: 503 };
      }
      throw new Error(`Unexpected url: ${url}`);
    };

    const unmeteredResult = await AiScoringGate.requestConsentAndConfirm({
      mode: 'respond_to_situation',
      inputMeta: { sampleCount: 32000 }
    });

    assert.strictEqual(unmeteredResult.allowed, true);
    assert.strictEqual(unmeteredResult.unmetered, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Test 3: RLSpokenResponseController additive architecture
test('RLSpokenResponseController: respects feature flag and mounts additive UI', (t) => {
  const code = fs.readFileSync(path.join(__dirname, '../public/rl-spoken-response.js'), 'utf8');
  const mockWindow = {
    PteShellConfig: { rlSpokenAssessment: false }
  };

  const evaluate = new Function('window', 'self', code);
  evaluate(mockWindow, mockWindow);

  const controller = mockWindow.RLSpokenResponseController;
  assert.ok(controller, 'RLSpokenResponseController should be attached');

  const container = {
    style: {},
    innerHTML: '',
    querySelector: () => ({
      addEventListener: () => {}
    })
  };

  // When disabled:
  assert.strictEqual(controller.isEnabled(), false);
  controller.mount(container, { entry: { id: 'q1' } });
  assert.strictEqual(container.style.display, 'none');

  // When enabled:
  mockWindow.PteShellConfig.rlSpokenAssessment = true;
  assert.strictEqual(controller.isEnabled(), true);
  controller.mount(container, { entry: { id: 'q1', transcript: 'Sample lecture' }, userNotes: 'key point 1' });
  assert.strictEqual(container.style.display, 'block');
  assert.match(container.innerHTML, /Practice Spoken Retelling/, 'Should render additive spoken retelling header');
  assert.match(container.innerHTML, /rl-spoken-record-btn/, 'Should render record button');
  assert.match(container.innerHTML, /key point 1/, 'Should show user notes for reference');
});

// Test 4: SGD Mode Audio Separation and Transcript Provenance
test('SGD mode: preserves originalRecordingBlob and separates speech transcript from userNotes', (t) => {
  const sgdCode = fs.readFileSync(path.join(__dirname, '../public/sgd-mode.js'), 'utf8');

  // Verify separate state variables
  assert.match(sgdCode, /let originalRecordingBlob = null;/, 'Must define originalRecordingBlob');
  assert.match(sgdCode, /let enhancedPlaybackBlob = null;/, 'Must define enhancedPlaybackBlob');

  // Verify that joined notes are never treated as authoritative speech transcript
  assert.match(sgdCode, /legacyNotesProxy:/, 'Must label note-derived transcripts as legacyNotesProxy');
  assert.match(sgdCode, /transcriptSource:\s*acceptedTranscription\s*\?\s*'server_asr'\s*:\s*null/, 'Must store actual transcriptSource');

  // Verify AiScoringGate consent call
  assert.match(sgdCode, /requestConsentAndConfirm/, 'Must gate AI scoring with requestConsentAndConfirm');
  assert.match(sgdCode, /mode:\s*'summarize_group_discussion'/, 'Must request SGD mode quote');
});

// Test 5: RTS Mode Quote Confirmation Gate & Disclosure
test('RTS mode: gates submitToAiScoring with AiScoringGate and renders disclosure', (t) => {
  const rtsCode = fs.readFileSync(path.join(__dirname, '../public/rts-mode.js'), 'utf8');

  // Verify AiScoringGate is called before scoring
  assert.match(rtsCode, /AiScoringGate\.requestConsentAndConfirm/, 'Must gate submission with requestConsentAndConfirm');
  assert.match(rtsCode, /mode:\s*'respond_to_situation'/, 'Must specify respond_to_situation mode');

  // Verify disclosure container is rendered
  assert.match(rtsCode, /rts-v3-transcript-disclosure/, 'Must provide transcript disclosure container in v3');
  assert.match(rtsCode, /rts-transcript-disclosure/, 'Must provide transcript disclosure container in non-v3');
});
