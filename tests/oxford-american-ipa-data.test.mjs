import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const overlay = JSON.parse(fs.readFileSync(path.join(root, 'public', 'oxford-american-ipa.json'), 'utf8'));
const dictionary = JSON.parse(fs.readFileSync(path.join(root, 'public', 'ipa-dict.json'), 'utf8'));

test('Oxford-American IPA layer is structurally valid and authoritative', () => {
  assert.equal(overlay.schemaVersion, 1);
  assert.equal(overlay.dialect, 'en-US');
  assert.ok(overlay.entries && typeof overlay.entries === 'object');
  assert.ok(Array.isArray(overlay.quarantine));

  for (const [word, variants] of Object.entries(overlay.entries)) {
    assert.match(word, /^[a-z][a-z' -]*$/u, `invalid overlay key: ${word}`);
    assert.ok(Array.isArray(variants) && variants.length > 0, `${word} must have IPA variants`);
    assert.equal(new Set(variants).size, variants.length, `${word} has duplicate IPA variants`);
    variants.forEach((ipa) => assert.match(ipa, /^\/.+\/$/u, `${word} has invalid IPA: ${ipa}`));
    assert.deepEqual(dictionary[word], variants, `${word} must be applied to ipa-dict.json`);
  }

  for (const word of overlay.quarantine) {
    assert.equal(dictionary[word], undefined, `${word} must remain quarantined from the learner dictionary`);
  }

  assert.deepEqual(overlay.entries.antidumping, ['/ˌæntaɪˈdʌmpɪŋ/']);
  assert.deepEqual(overlay.entries.hurricane, ['/ˈhərəˌkeɪn/']);
  assert.equal(dictionary.augustus, undefined);
  assert.equal(dictionary["in's"], undefined);
});

test('every reviewed removal is also quarantined', () => {
  // Removing a word from ipa-dict.json is not enough on its own: the CMU
  // fallback will repopulate it unless the word is on the quarantine list.
  // deneuve was removed in the Oxford review pass and reappeared as /dɪˈnʌv/.
  const removals = ['augustus', 'awb', 'banderas', 'deneuve', "in's", 'stongue'];
  for (const word of removals) {
    assert.equal(dictionary[word], undefined, `${word} must be absent from ipa-dict.json`);
    assert.ok(overlay.quarantine.includes(word), `${word} must be on the quarantine list`);
  }
});
