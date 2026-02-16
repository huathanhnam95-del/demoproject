/**
 * Test Suite for PerformanceTracker scoring
 * Run with: node tests/performance-tracker.test.js
 */

const assert = require('assert');

global.window = {};

require('../public/js/performance-tracker.js');

const PerformanceTracker = global.window.PerformanceTracker;
assert.ok(PerformanceTracker, 'PerformanceTracker should attach to window');

console.log('🧪 Starting PerformanceTracker Tests...');

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

  // speedScore = 1, accuracyScore = 0.5 -> 0.8*0.5 + 0.2*1 = 0.6
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

  // triesMult = 0.8, speedScore = 1 -> 0.8*0.8 + 0.2*1 = 0.84
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

  // triesMult = 0.2, speedScore = 1 -> 0.8*(1*0.2) + 0.2*1 = 0.36
  approxEqual(score, 0.36);
}

console.log('✅ PerformanceTracker tests passed');

