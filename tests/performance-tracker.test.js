/**
 * Test Suite for PerformanceTracker scoring
 * Run with: node tests/performance-tracker.test.js
 */

const assert = require('assert');

global.window = {};

require('../public/js/performance-tracker.js');

const PerformanceTracker = global.window.PerformanceTracker;
assert.ok(PerformanceTracker, 'PerformanceTracker should attach to window');

console.log('Starting PerformanceTracker Tests...');

function approxEqual(actual, expected, eps = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= eps, `Expected ~${expected}, got ${actual}`);
}

// 1) Uses word-level accuracy when provided (even if correct=false)
{
  const tracker = new PerformanceTracker('type');
  const score = tracker.calculateAttemptScore({
    correct: false,
    accuracy: 0.5,
    attempts: 1,
    timeTaken: 15,
    wordCount: 10
  });

  approxEqual(score, 0.6);
}

// 2) Falls back to binary correct/tries scaling if accuracy missing
{
  const tracker = new PerformanceTracker('type');
  const score = tracker.calculateAttemptScore({
    correct: true,
    attempts: 2,
    timeTaken: 15,
    wordCount: 10
  });

  approxEqual(score, 0.84);
}

// 3) Tries penalty applies to word-level accuracy too
{
  const tracker = new PerformanceTracker('type');
  const score = tracker.calculateAttemptScore({
    correct: false,
    accuracy: 1.0,
    attempts: 4,
    timeTaken: 15,
    wordCount: 10
  });

  approxEqual(score, 0.36);
}

// 4) Notes mode uses a 90/10 accuracy-speed split
{
  const tracker = new PerformanceTracker('notes');
  const score = tracker.calculateAttemptScore({
    correct: true,
    accuracy: 0.5,
    attempts: 1,
    timeTaken: 12,
    wordCount: 10
  });

  approxEqual(score, 0.55);
}

// 5) SRS ignores speed when scoring
{
  const tracker = new PerformanceTracker('srs');
  const score = tracker.calculateAttemptScore({
    correct: true,
    attempts: 1,
    timeTaken: 1,
    wordCount: 200
  });

  approxEqual(score, 1.0);
}

// 6) hintUsed marks the attempt as assisted exactly once
{
  let capturedMeta = null;
  global.window.DifficultyManager = {
    getCurrentSettings() {
      return { level: 1 };
    },
    adjustDifficulty(mode, score, meta) {
      capturedMeta = { mode, score, meta };
    }
  };

  const tracker = new PerformanceTracker('type');
  tracker.recordAttempt({
    correct: true,
    attempts: 1,
    hintUsed: true,
    assistCalibMult: 1,
    timeTaken: 10,
    wordCount: 10
  });

  assert.ok(capturedMeta, 'Expected DifficultyManager.adjustDifficulty to be called');
  assert.equal(capturedMeta.meta.assisted, true, 'hintUsed should classify the attempt as assisted');
  assert.equal(capturedMeta.mode, 'type');
}

console.log('PerformanceTracker tests passed');
