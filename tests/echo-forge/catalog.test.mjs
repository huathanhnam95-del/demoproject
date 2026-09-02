import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildCatalog,
  buildAssessmentManifest,
  canonicalStringify,
  hashChallengeContent,
  validateBuiltCatalog,
} from '../../scripts/echo-forge/build-challenge-catalog.js';

const sourceUrl = new URL('../../data/echo-forge/challenges.source.json', import.meta.url);
const builtUrl = new URL('../../public/database/echo-forge/challenges.v1.json', import.meta.url);
const manifestUrl = new URL('../../data/echo-forge/assessment-manifest.v1.json', import.meta.url);
const functionsManifestUrl = new URL('../../functions/src/data/echo-forge/assessment-manifest.v1.json', import.meta.url);
const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];
const buckets = {
  azure_word: { unitType: 'word', minimum: 6 },
  v3_word: { unitType: 'word', minimum: 4 },
  azure_phrase: { unitType: 'phrase', minimum: 4 },
  listening: { unitType: 'listening', minimum: 6 },
};

const loadJson = async (url) => JSON.parse(await readFile(url, 'utf8'));

test('catalog build is deterministic and checked-in output matches the source', async () => {
  const source = await loadJson(sourceUrl);
  const checkedIn = await loadJson(builtUrl);
  const first = buildCatalog(source);
  const second = buildCatalog(structuredClone(source));

  assert.equal(canonicalStringify(first), canonicalStringify(second));
  assert.deepEqual(checkedIn, first);
  assert.equal(first.schemaVersion, 'echo-forge-challenge-catalog-v1');
  assert.equal(first.locale, 'en-US');
  assert.match(first.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(first.challenges.length, 100);
  assert.equal(validateBuiltCatalog(first), true);
});

test('server assessment manifests are deterministic, minimal, and catalog-bound', async () => {
  const catalog = buildCatalog(await loadJson(sourceUrl));
  const expected = buildAssessmentManifest(catalog);
  assert.deepEqual(await loadJson(manifestUrl), expected);
  assert.deepEqual(await loadJson(functionsManifestUrl), expected);
  assert.equal(expected.schemaVersion, 'echo-forge-assessment-manifest-v1');
  assert.equal(expected.challenges.length, 50);
  assert.deepEqual(Object.keys(expected.challenges[0]).sort(), ['challengeId', 'evaluationMode', 'referenceText']);
  assert.equal(expected.challenges.some((item) => item.evaluationMode === 'v3_word'), false);
});

test('catalog exposes manual A1-C1 autonomy and level-specific support resources', async () => {
  const catalog = buildCatalog(await loadJson(sourceUrl));
  assert.deepEqual(Object.keys(catalog.levelPolicies), levels);
  for (const level of levels) {
    assert.deepEqual(catalog.levelPolicies[level].allowedSupportPresets, [
      'guided', 'standard', 'challenge',
    ]);
    assert.equal(catalog.levelPolicies[level].defaultSupportPreset, 'standard');
    assert.equal(catalog.levelPolicies[level].manualSelectionOnly, true);
  }
  assert.equal('C2' in catalog.levelPolicies, false);

  for (const challenge of catalog.challenges) {
    assert.ok(levels.includes(challenge.level), challenge.challengeId);
    assert.equal(challenge.locale, 'en-US');
    assert.equal(challenge.contentVersion, catalog.contentVersion);
    assert.equal(typeof challenge.resource.definition, 'string');
    assert.ok(challenge.resource.definition.length > 0);
    assert.equal(typeof challenge.resource.example, 'string');
    assert.ok(challenge.resource.example.length > 0);
  }
});

test('every level meets the locked challenge mix and V3 stays single-word only', async () => {
  const catalog = buildCatalog(await loadJson(sourceUrl));
  for (const level of levels) {
    const levelItems = catalog.challenges.filter((item) => item.level === level);
    for (const [kind, policy] of Object.entries(buckets)) {
      const items = levelItems.filter((item) => item.challengeKind === kind);
      assert.equal(items.length, policy.minimum, `${level} ${kind}`);
      for (const item of items) assert.equal(item.unitType, policy.unitType, item.challengeId);
    }
  }

  for (const item of catalog.challenges.filter((entry) => entry.evaluationMode === 'v3_word')) {
    assert.equal(item.unitType, 'word');
    assert.ok(Number.isInteger(item.pronunciation.expectedSyllableCount));
    assert.ok(Number.isInteger(item.pronunciation.primaryStressIndex));
    assert.ok(item.pronunciation.primaryStressIndex < item.pronunciation.expectedSyllableCount);
  }
});

test('catalog identities, pronunciation provenance, audio identity, and listening decoys validate', async () => {
  const catalog = buildCatalog(await loadJson(sourceUrl));
  const challengeIds = new Set();
  const audioIds = new Set();
  for (const item of catalog.challenges) {
    assert.match(item.challengeId, /^ef-(a1|a2|b1|b2|c1)-(azure-word|v3-word|azure-phrase|listening)-\d{3}$/);
    assert.equal(challengeIds.has(item.challengeId), false, item.challengeId);
    challengeIds.add(item.challengeId);
    assert.match(item.contentHash, /^[a-f0-9]{64}$/);
    assert.equal(item.contentHash, hashChallengeContent(item));
    assert.ok(item.topic);
    assert.ok(item.pronunciation.focus);
    assert.ok(item.pronunciation.pos);
    assert.ok(item.pronunciation.ipa);
    assert.ok(item.pronunciation.variantId);
    assert.equal(item.provenance.sourceKind, 'project_authored');
    assert.ok(item.provenance.sourceId);
    assert.equal(item.provenance.license, 'project_internal');
    assert.equal(item.provenance.verificationStatus, 'automated_content_reviewed');

    assert.match(item.audio.identitySha256, /^[a-f0-9]{64}$/);
    assert.equal(item.audio.hashKind, 'identity_metadata_sha256');
    assert.equal(item.audio.artifactStatus, 'not_generated');
    assert.ok(item.audio.assetId);
    assert.ok(item.audio.version);
    assert.equal(audioIds.has(item.audio.assetId), false, item.audio.assetId);
    audioIds.add(item.audio.assetId);

    if (item.unitType === 'phrase') {
      const wordCount = item.text.trim().split(/\s+/).length;
      assert.ok(wordCount >= 2 && wordCount <= 5, item.challengeId);
      assert.equal(item.evaluationMode, 'azure_phrase');
    }
    if (item.unitType === 'listening') {
      assert.equal(item.listening.options.length, 4);
      const optionIds = item.listening.options.map((option) => option.optionId);
      assert.equal(new Set(optionIds).size, 4);
      assert.ok(optionIds.includes(item.listening.answerId));
      assert.equal(
        item.listening.options.find((option) => option.optionId === item.listening.answerId).text,
        item.text,
      );
      assert.equal(new Set(item.listening.options.map((option) => option.text.toLowerCase())).size, 4);
      assert.equal(item.listening.decoyIds.length, 3);
      assert.deepEqual(
        [...item.listening.decoyIds].sort(),
        optionIds.filter((id) => id !== item.listening.answerId).sort(),
      );
    }
  }
});

test('builder rejects C2, V3 phrases, unknown fields, invalid listening data, and duplicate identities', async () => {
  const source = await loadJson(sourceUrl);
  const c2 = structuredClone(source);
  c2.levels.C2 = structuredClone(c2.levels.C1);
  assert.throws(() => buildCatalog(c2), /C2|level/);

  const v3Phrase = structuredClone(source);
  v3Phrase.levels.A1.v3Words[0].unitType = 'phrase';
  assert.throws(() => buildCatalog(v3Phrase), /V3|word/);

  const duplicate = structuredClone(source);
  duplicate.levels.A1.azureWords[1].id = duplicate.levels.A1.azureWords[0].id;
  assert.throws(() => buildCatalog(duplicate), /duplicate|identity|challengeId/);

  const unknownBucket = structuredClone(source);
  unknownBucket.levels.A1.azureWord = unknownBucket.levels.A1.azureWords;
  assert.throws(() => buildCatalog(unknownBucket), /unknown|unexpected|bucket/);

  const answerMismatch = structuredClone(source);
  answerMismatch.levels.A1.listening[0].answer.text = 'not the target';
  assert.throws(() => buildCatalog(answerMismatch), /answer|target|text/);

  const duplicateText = structuredClone(source);
  duplicateText.levels.A1.listening[0].decoys[0].text = duplicateText.levels.A1.listening[0].text;
  assert.throws(() => buildCatalog(duplicateText), /duplicate|option text/);
});

test('built-catalog validation rejects tampering and source reordering preserves immutable IDs', async () => {
  const source = await loadJson(sourceUrl);
  const built = buildCatalog(source);
  const tampered = structuredClone(built);
  tampered.challenges[0].contentHash = '0'.repeat(64);
  assert.throws(() => validateBuiltCatalog(tampered), /contentHash|tamper|hash/);

  const reorderedSource = structuredClone(source);
  reorderedSource.levels.A1.azureWords.reverse();
  const reordered = buildCatalog(reorderedSource);
  const idsByText = (catalog) => Object.fromEntries(
    catalog.challenges.map((item) => [item.text, item.challengeId]),
  );
  assert.deepEqual(idsByText(reordered), idsByText(built));
});

test('reviewed learner examples avoid elliptical or ambiguous wording', async () => {
  const catalog = buildCatalog(await loadJson(sourceUrl));
  const byId = Object.fromEntries(catalog.challenges.map((item) => [item.challengeId, item]));
  assert.equal(byId['ef-a2-listening-002'].resource.example, 'The bus leaves at fifteen past the hour.');
  assert.equal(byId['ef-c1-listening-004'].resource.example, 'A pilot study should precede the trial.');
});

test('isolated listening choices avoid known en-US homophones and duplicate acoustic distractors', async () => {
  const catalog = buildCatalog(await loadJson(sourceUrl));
  const byId = Object.fromEntries(catalog.challenges.map((item) => [item.challengeId, item]));
  const prohibited = {
    'ef-b2-listening-001': ['principal'],
    'ef-b2-listening-002': ['compliment'],
    'ef-b2-listening-003': ['site', 'sight'],
    'ef-b2-listening-004': ['insure'],
    'ef-c1-listening-001': ['immanent'],
    'ef-c1-listening-002': ['illicit'],
    'ef-c1-listening-003': ['discreet'],
    'ef-c1-listening-006': ['elusion'],
  };

  for (const [challengeId, disallowedOptions] of Object.entries(prohibited)) {
    const options = byId[challengeId].listening.options.map((option) => option.text.toLowerCase());
    for (const disallowed of disallowedOptions) {
      assert.equal(options.includes(disallowed), false, `${challengeId} includes ${disallowed}`);
    }
  }
});
