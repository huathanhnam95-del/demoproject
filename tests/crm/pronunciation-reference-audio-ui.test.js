const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'public', 'crm-admin.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public', 'crm-admin.js'), 'utf8');

for (const id of [
  'reference-audio-queue',
  'reference-audio-waiting-count',
  'reference-audio-generated-count',
  'reference-audio-search',
  'reference-audio-pos-filter',
  'reference-audio-reason-filter',
  'reference-audio-queue-items',
  'btn-reference-audio-refresh',
  'btn-reference-audio-export'
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`));
}

assert.match(js, /\/api\/admin\/dev\/reference-audio-queue/);
assert.match(js, /\/api\/admin\/dev\/reference-audio-queue\/manifest/);
assert.match(js, /verificationStatus/);
assert.match(js, /textContent/);
assert.doesNotMatch(js, /referenceAudioQueue[^\n]*innerHTML/);

console.log('pronunciation reference audio CRM UI tests passed');
