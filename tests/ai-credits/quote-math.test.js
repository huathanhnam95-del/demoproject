'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { quoteSpeaking, quoteWriting } = require('../../functions/src/ai-credits/quote-math.js');

test('quoteSpeaking calculates standard rates and rounding accurately', () => {
  // 10s RA at 15 credits/min -> 10 * 15 / 60 = 2.5 -> ceil = 3 credits
  const ra10 = quoteSpeaking({ sampleCount: 160000, sampleRateHz: 16000, creditsPerMinute: 15 });
  assert.equal(ra10.quotedSeconds, 10);
  assert.equal(ra10.credits, 3);

  // 20s RA at 15 credits/min -> 20 * 15 / 60 = 5 credits
  const ra20 = quoteSpeaking({ sampleCount: 320000, sampleRateHz: 16000, creditsPerMinute: 15 });
  assert.equal(ra20.quotedSeconds, 20);
  assert.equal(ra20.credits, 5);

  // 23s RA at 15 credits/min -> 23 * 15 / 60 = 5.75 -> ceil = 6 credits
  const ra23 = quoteSpeaking({ sampleCount: 368000, sampleRateHz: 16000, creditsPerMinute: 15 });
  assert.equal(ra23.quotedSeconds, 23);
  assert.equal(ra23.credits, 6);

  // 40s RA at 15 credits/min -> 40 * 15 / 60 = 10 credits
  const ra40 = quoteSpeaking({ sampleCount: 640000, sampleRateHz: 16000, creditsPerMinute: 15 });
  assert.equal(ra40.quotedSeconds, 40);
  assert.equal(ra40.credits, 10);

  // 15s RS at 15 credits/min -> 15 * 15 / 60 = 3.75 -> ceil = 4 credits
  const rs15 = quoteSpeaking({ sampleCount: 240000, sampleRateHz: 16000, creditsPerMinute: 15 });
  assert.equal(rs15.quotedSeconds, 15);
  assert.equal(rs15.credits, 4);

  // 40s RL/RTS at 25 credits/min -> 40 * 25 / 60 = 16.666... -> ceil = 17 credits
  const rl40 = quoteSpeaking({ sampleCount: 640000, sampleRateHz: 16000, creditsPerMinute: 25 });
  assert.equal(rl40.quotedSeconds, 40);
  assert.equal(rl40.credits, 17);

  // 90s SGD at 25 credits/min -> 90 * 25 / 60 = 37.5 -> ceil = 38 credits
  const sgd90 = quoteSpeaking({ sampleCount: 1440000, sampleRateHz: 16000, creditsPerMinute: 25 });
  assert.equal(sgd90.quotedSeconds, 90);
  assert.equal(sgd90.credits, 38);

  // 120s SGD at 25 credits/min -> 120 * 25 / 60 = 50 credits (NOT 100!)
  const sgd120 = quoteSpeaking({ sampleCount: 1920000, sampleRateHz: 16000, creditsPerMinute: 25 });
  assert.equal(sgd120.quotedSeconds, 120);
  assert.equal(sgd120.credits, 50);
});

test('quoteSpeaking rounds partial seconds up to whole seconds', () => {
  // 10.001 seconds -> 11 seconds charged
  const partial = quoteSpeaking({ sampleCount: 160016, sampleRateHz: 16000, creditsPerMinute: 15 });
  assert.equal(partial.quotedSeconds, 11);
  // 11 * 15 / 60 = 2.75 -> ceil = 3 credits
  assert.equal(partial.credits, 3);
});

test('quoteSpeaking with fixed component credits', () => {
  // 20s RA at 15 c/m (5 credits) + 5 fixed content credits = 10 credits
  const bundled = quoteSpeaking({
    sampleCount: 320000,
    sampleRateHz: 16000,
    creditsPerMinute: 15,
    fixedComponentCredits: 5
  });
  assert.equal(bundled.quotedSeconds, 20);
  assert.equal(bundled.credits, 10);
});

test('quoteWriting returns exact fixed price', () => {
  assert.equal(quoteWriting({ fixedCredits: 10 }).credits, 10);
  assert.equal(quoteWriting({ fixedCredits: 25 }).credits, 25);
  assert.throws(() => quoteWriting({ fixedCredits: 0 }));
  assert.throws(() => quoteWriting({ fixedCredits: -5 }));
  assert.throws(() => quoteWriting({ fixedCredits: 'invalid' }));
});

test('quoteSpeaking validation handles errors safely', () => {
  assert.throws(() => quoteSpeaking({ sampleCount: 0, sampleRateHz: 16000, creditsPerMinute: 15 }));
  assert.throws(() => quoteSpeaking({ sampleCount: 16000, sampleRateHz: 0, creditsPerMinute: 15 }));
  assert.throws(() => quoteSpeaking({ sampleCount: 16000, sampleRateHz: 16000, creditsPerMinute: 0 }));
  assert.throws(() => quoteSpeaking({ sampleCount: 16000, sampleRateHz: 16000, creditsPerMinute: 15, fixedComponentCredits: -1 }));
});
