import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(new URL('../public/js/pte-recorder-widget.js', import.meta.url), 'utf8'), context);
const { formatClock, countdownMessage, barsOn, describeMicError } = context.module.exports;
test('clock formatting clamps invalid and negative input and supports long answers', () => {
  assert.equal(formatClock(0), '00:00'); assert.equal(formatClock(12.9), '00:12');
  assert.equal(formatClock(120), '02:00'); assert.equal(formatClock(-8), '00:00'); assert.equal(formatClock(NaN), '00:00');
});
test('countdown singular, plural and fractional seconds', () => {
  assert.equal(countdownMessage(1), 'The recording will begin in 1 second');
  assert.equal(countdownMessage(34), 'The recording will begin in 34 seconds');
  assert.equal(countdownMessage(.5), 'The recording will begin in 1 second');
});
test('wave positions clamp at recording boundaries without division by zero', () => {
  assert.equal(barsOn(0, 40), 0); assert.equal(barsOn(20, 40), 32); assert.equal(barsOn(40, 40), 64);
  assert.equal(barsOn(90, 40), 64); assert.equal(barsOn(-1, 40), 0); assert.equal(barsOn(0, 0), 0);
});
test('microphone failures map to a kind and plain-language copy the learner can act on', () => {
  const blocked = describeMicError({ name: 'NotAllowedError' });
  assert.equal(blocked.kind, 'blocked'); assert.equal(blocked.title, 'Microphone blocked');
  assert.match(blocked.detail, /address bar/); assert.equal(blocked.message, `${blocked.title}. ${blocked.detail}`);
  assert.equal(describeMicError({ name: 'SecurityError' }).kind, 'blocked');
  assert.equal(describeMicError({ name: 'NotFoundError' }).kind, 'missing');
  assert.equal(describeMicError({ name: 'OverconstrainedError' }).kind, 'missing');
  assert.equal(describeMicError({ name: 'NotReadableError' }).kind, 'busy');
  assert.equal(describeMicError({ name: 'NotSupportedError' }).kind, 'unsupported');
});
test('unknown or missing errors still produce a usable message', () => {
  for (const error of [new Error('Microphone recording could not start.'), null, undefined, {}, 'oops']) {
    const info = describeMicError(error);
    assert.equal(info.kind, 'unknown'); assert.equal(info.title, "Recording couldn't start");
    assert.match(info.detail, /Start recording again/);
  }
});
