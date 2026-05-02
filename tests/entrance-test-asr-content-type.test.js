/* eslint-disable no-console */
const assert = require('assert');

const { normalizeAsrContentType } = require('../src/entrance-test/test36plus');

function verifyNormalizeAsrContentType() {
  assert.strictEqual(normalizeAsrContentType('audio/mp4'), 'audio/m4a');
  assert.strictEqual(normalizeAsrContentType('audio/mp4; codecs=mp4a.40.2'), 'audio/m4a');
  assert.strictEqual(normalizeAsrContentType('video/mp4'), 'audio/m4a');
  assert.strictEqual(normalizeAsrContentType('audio/x-m4a'), 'audio/m4a');
  assert.strictEqual(normalizeAsrContentType('audio/mp3'), 'audio/mpeg');
  assert.strictEqual(normalizeAsrContentType('audio/mpeg'), 'audio/mpeg');
}

verifyNormalizeAsrContentType();
console.log('ok - entrance test ASR content type normalization');

