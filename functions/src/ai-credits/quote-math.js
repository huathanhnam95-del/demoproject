'use strict';

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(name);
  return BigInt(value);
}

function nonnegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(name);
  return BigInt(value);
}

function ceilDiv(n, d) {
  return (n + d - 1n) / d;
}

function safeNumber(value) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('QUOTE_OVERFLOW');
  return Number(value);
}

/**
 * Calculates binding credit cost for a speaking recording.
 * Billed by the second (rounded up to nearest second), then per-minute rate:
 * quotedSeconds = ceil(sampleCount / sampleRateHz)
 * credits = ceil((quotedSeconds * creditsPerMinute + fixedComponentCredits * 60) / 60)
 */
function quoteSpeaking({ sampleCount, sampleRateHz, creditsPerMinute, fixedComponentCredits = 0 }) {
  const count = positiveInteger(sampleCount, 'INVALID_SAMPLE_COUNT');
  const rate = positiveInteger(sampleRateHz, 'INVALID_SAMPLE_RATE');
  const price = positiveInteger(creditsPerMinute, 'INVALID_CREDIT_RATE');
  const extra = nonnegativeInteger(fixedComponentCredits, 'INVALID_FIXED_CREDITS');

  const seconds = ceilDiv(count, rate);
  const credits = ceilDiv(seconds * price + extra * 60n, 60n);

  return {
    quotedSeconds: safeNumber(seconds),
    credits: safeNumber(credits)
  };
}

/**
 * Calculates binding credit cost for a bounded writing package.
 */
function quoteWriting({ fixedCredits }) {
  return {
    credits: safeNumber(positiveInteger(fixedCredits, 'INVALID_WRITING_PRICE'))
  };
}

module.exports = {
  quoteSpeaking,
  quoteWriting,
  ceilDiv
};
