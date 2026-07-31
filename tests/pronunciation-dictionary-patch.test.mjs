import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPatch } from '../scripts/audit/build-pronunciation-dictionary-patch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const report = JSON.parse(fs.readFileSync(path.join(root, 'test-results', 'pronunciation-input-verification-20260731.json'), 'utf8'));
// Keep the contract fixture immutable after the production dictionary is patched.
// Every accepted/quarantined report row contributes its original source IPA.
const dictionary = Object.create(null);
for (const entry of report.entries) {
  if (!entry.word || !entry.sourceIPA) continue;
  dictionary[entry.word] = [...new Set([...(dictionary[entry.word] || []), entry.sourceIPA])];
}

function updateFor(patch, word) {
  return patch.updates.find((entry) => entry.word === word);
}

test('buildPatch validates the completed verification decision counts', () => {
  const patch = buildPatch(report, dictionary);

  assert.deepEqual(patch.summary, {
    inputRows: 363,
    approvedRecords: 258,
    mergeRecords: 22,
    quarantineRecords: 83,
    reviewRecords: 0
  });
});

test('buildPatch preserves the approved Oxford-American forms and weak-form metadata', () => {
  const patch = buildPatch(report, dictionary);

  assert.deepEqual(updateFor(patch, 'discoverable').proposedIPA, ['/dɪˈskʌvərəbl/']);
  assert.deepEqual(updateFor(patch, 'governmentally').proposedIPA, ['/ˌɡʌvənˈmentəli/']);
  assert.deepEqual(updateFor(patch, 'because').proposedIPA, ['/bɪˈkʌz/', '/bɪˈkɔz/']);
  assert.deepEqual(updateFor(patch, 'semiconductor').proposedIPA, [
    '/ˈsɛmikənˌdʌktər/',
    '/ˈsɛmaɪkənˌdʌktər/'
  ]);

  const the = updateFor(patch, 'the');
  assert.deepEqual(the.proposedIPA, ['/ði/']);
  assert.equal(the.weakIPA, '/ðə/');
});

test('buildPatch makes approved forms authoritative and primary', () => {
  const dictionaryWithLegacyVariants = {
    ...dictionary,
    because: [...dictionary.because, '/legacy-because/'],
    discoverable: [...dictionary.discoverable, '/legacy-discoverable/'],
    conduct: [...dictionary.conduct, '/legacy-conduct/'],
    governmentally: [...dictionary.governmentally, '/legacy-governmentally/'],
    semiconductor: [...dictionary.semiconductor, '/legacy-semiconductor/']
  };
  const patch = buildPatch(report, dictionaryWithLegacyVariants);

  for (const word of ['because', 'discoverable', 'conduct', 'governmentally', 'semiconductor']) {
    const update = updateFor(patch, word);
    assert.ok(update, `${word} should have an update`);
    assert.deepEqual(
      update.resultingIPA,
      update.proposedIPA,
      `${word} must not retain unreviewed legacy variants`
    );
    assert.equal(update.resultingIPA[0], update.proposedIPA[0], `${word} approved form must be primary`);
  }
});

test('buildPatch keeps quarantined words out of updates', () => {
  const patch = buildPatch(report, dictionary);
  const quarantineWords = new Set(patch.quarantine.map((entry) => entry.word));
  const updateWords = new Set(patch.updates.map((entry) => entry.word));

  for (const word of [
    'deneuve',
    "guzzler's",
    'guzzlers',
    'guzzling',
    'indulgences',
    'injunctive',
    'justices',
    'twentysomething',
    'twentysomethings'
  ]) {
    assert.equal(quarantineWords.has(word), true, `${word} should be quarantined`);
    assert.equal(updateWords.has(word), false, `${word} must not be updated`);
  }
});

test('buildPatch reports duplicate final forms as traceable merges', () => {
  const patch = buildPatch(report, dictionary);
  const semiconductorMerges = patch.merges.filter((entry) => entry.word === 'semiconductor');

  assert.equal(semiconductorMerges.length, 1);
  assert.deepEqual(semiconductorMerges[0].finalIPA, [
    '/ˈsɛmikənˌdʌktər/',
    '/ˈsɛmaɪkənˌdʌktər/'
  ]);
  assert.deepEqual(semiconductorMerges[0].caseIds, ['review-266']);
});

test('buildPatch rejects an unresolved report', () => {
  const invalidReport = {
    ...report,
    summary: { ...report.summary, review: 1 }
  };

  assert.throws(() => buildPatch(invalidReport, dictionary), /summary review|review records/i);
});
