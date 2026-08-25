import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const LEVELS = Object.freeze(['A1', 'A2', 'B1', 'B2', 'C1']);
const CONTENT_KINDS = Object.freeze({
  azureWords: Object.freeze({ challengeKind: 'azure_word', slug: 'azure-word', unitType: 'word', evaluationMode: 'azure_word', count: 6 }),
  v3Words: Object.freeze({ challengeKind: 'v3_word', slug: 'v3-word', unitType: 'word', evaluationMode: 'v3_word', count: 4 }),
  azurePhrases: Object.freeze({ challengeKind: 'azure_phrase', slug: 'azure-phrase', unitType: 'phrase', evaluationMode: 'azure_phrase', count: 4 }),
  listening: Object.freeze({ challengeKind: 'listening', slug: 'listening', unitType: 'listening', evaluationMode: 'azure_word', count: 6 }),
});

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

export function hashChallengeContent(challenge) {
  const { contentHash: _ignored, ...content } = challenge;
  return sha256(content);
}

function assertString(value, pathLabel) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${pathLabel} must be a non-empty string`);
  }
}

function assertExactKeys(value, allowedKeys, pathLabel) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${pathLabel} has unknown field or bucket: ${key}`);
  }
}

function assertSourceRoot(source) {
  if (!isPlainObject(source)) throw new TypeError('challenge source must be an object');
  assertExactKeys(source, ['contentVersion', 'locale', 'audioPolicy', 'levels'], 'source');
  assertString(source.contentVersion, 'contentVersion');
  if (source.locale !== 'en-US') throw new RangeError('Echo Forge catalog locale must be en-US');
  if (!isPlainObject(source.audioPolicy)) throw new TypeError('audioPolicy is required');
  assertExactKeys(source.audioPolicy, ['provider', 'voiceId', 'version'], 'audioPolicy');
  for (const field of ['provider', 'voiceId', 'version']) assertString(source.audioPolicy[field], `audioPolicy.${field}`);
  if (!isPlainObject(source.levels)) throw new TypeError('levels is required');
  const actualLevels = Object.keys(source.levels);
  if (actualLevels.length !== LEVELS.length || actualLevels.some((level) => !LEVELS.includes(level))) {
    throw new RangeError('levels must be exactly A1, A2, B1, B2, C1; C2 is rejected');
  }
}

function assertBaseItem(item, itemPath) {
  if (!isPlainObject(item)) throw new TypeError(`${itemPath} must be an object`);
  for (const field of ['id', 'text', 'pos', 'ipa', 'variantId', 'focus', 'topic', 'definition', 'example']) {
    assertString(item[field], `${itemPath}.${field}`);
  }
  if (!/^\d{3}$/.test(item.id)) throw new TypeError(`${itemPath}.id must be a stable three-digit identity`);
}

function assertV3Item(item, itemPath) {
  if (item.unitType !== 'word') throw new RangeError(`${itemPath}: V3 challenges must be word-only`);
  if (!Number.isInteger(item.expectedSyllableCount) || item.expectedSyllableCount < 1) {
    throw new RangeError(`${itemPath}.expectedSyllableCount must be a positive integer`);
  }
  if (!Number.isInteger(item.primaryStressIndex)
    || item.primaryStressIndex < 0
    || item.primaryStressIndex >= item.expectedSyllableCount) {
    throw new RangeError(`${itemPath}.primaryStressIndex is invalid`);
  }
}

function assertPhraseItem(item, itemPath) {
  const wordCount = item.text.trim().split(/\s+/).length;
  if (wordCount < 2 || wordCount > 5) throw new RangeError(`${itemPath} must contain 2-5 words`);
}

function buildListening(item, itemPath) {
  if (!isPlainObject(item.answer)) throw new TypeError(`${itemPath}.answer is required`);
  assertString(item.answer.id, `${itemPath}.answer.id`);
  assertString(item.answer.text, `${itemPath}.answer.text`);
  assertExactKeys(item.answer, ['id', 'text'], `${itemPath}.answer`);
  if (item.answer.text !== item.text) throw new RangeError(`${itemPath}.answer text must match the target text`);
  if (!Array.isArray(item.decoys) || item.decoys.length !== 3) {
    throw new RangeError(`${itemPath}.decoys must contain exactly three options`);
  }
  const options = [item.answer, ...item.decoys].map((option, index) => {
    if (!isPlainObject(option)) throw new TypeError(`${itemPath}.options[${index}] must be an object`);
    assertString(option.id, `${itemPath}.options[${index}].id`);
    assertString(option.text, `${itemPath}.options[${index}].text`);
    assertExactKeys(option, ['id', 'text'], `${itemPath}.options[${index}]`);
    return Object.freeze({ optionId: option.id, text: option.text });
  });
  const optionIds = options.map((option) => option.optionId);
  if (new Set(optionIds).size !== optionIds.length) throw new RangeError(`${itemPath} has duplicate listening option identity`);
  const optionTexts = options.map((option) => option.text.trim().toLowerCase());
  if (new Set(optionTexts).size !== optionTexts.length) throw new RangeError(`${itemPath} has duplicate option text`);
  return Object.freeze({
    answerId: item.answer.id,
    decoyIds: Object.freeze(item.decoys.map((decoy) => decoy.id)),
    options: Object.freeze(options),
  });
}

function buildChallenge({ source, level, sourceKey, item, ordinal }) {
  const kind = CONTENT_KINDS[sourceKey];
  const itemPath = `levels.${level}.${sourceKey}[${ordinal - 1}]`;
  assertBaseItem(item, itemPath);
  const allowedItemKeys = [
    'id', 'text', 'pos', 'ipa', 'variantId', 'focus', 'topic', 'definition', 'example',
    ...(sourceKey === 'v3Words' ? ['unitType', 'expectedSyllableCount', 'primaryStressIndex'] : []),
    ...(sourceKey === 'listening' ? ['answer', 'decoys'] : []),
  ];
  assertExactKeys(item, allowedItemKeys, itemPath);
  if (sourceKey === 'v3Words') assertV3Item(item, itemPath);
  if (sourceKey === 'azurePhrases') assertPhraseItem(item, itemPath);
  const stableItemId = item.id;
  const levelSlug = level.toLowerCase();
  const challengeId = `ef-${levelSlug}-${kind.slug}-${stableItemId}`;
  const audioAssetId = `ef-audio-${levelSlug}-${kind.slug}-${stableItemId}`;
  const audioIdentity = {
    assetId: audioAssetId,
    locale: source.locale,
    provider: source.audioPolicy.provider,
    text: item.text,
    variantId: item.variantId,
    version: source.audioPolicy.version,
    voiceId: source.audioPolicy.voiceId,
  };
  const challenge = {
    challengeId,
    challengeKind: kind.challengeKind,
    contentVersion: source.contentVersion,
    level,
    locale: source.locale,
    topic: item.topic,
    unitType: kind.unitType,
    evaluationMode: kind.evaluationMode,
    text: item.text,
    pronunciation: {
      pos: item.pos,
      ipa: item.ipa,
      variantId: item.variantId,
      focus: item.focus,
      ...(sourceKey === 'v3Words' ? {
        expectedSyllableCount: item.expectedSyllableCount,
        primaryStressIndex: item.primaryStressIndex,
      } : {}),
    },
    resource: { definition: item.definition, example: item.example },
    audio: {
      assetId: audioAssetId,
      version: source.audioPolicy.version,
      provider: source.audioPolicy.provider,
      voiceId: source.audioPolicy.voiceId,
      identitySha256: sha256(audioIdentity),
      hashKind: 'identity_metadata_sha256',
      artifactStatus: 'not_generated',
    },
    provenance: {
      sourceKind: 'curated',
      sourceId: `echo-forge-seed:${source.contentVersion}:${level}:${sourceKey}:${item.id}`,
      license: 'pending-review',
      verificationStatus: 'pending_human_review',
    },
    ...(sourceKey === 'listening' ? { listening: buildListening(item, itemPath) } : {}),
  };
  return Object.freeze({ ...challenge, contentHash: hashChallengeContent(challenge) });
}

function buildLevelPolicies() {
  return Object.fromEntries(LEVELS.map((level) => [level, {
    allowedSupportPresets: ['guided', 'standard', 'challenge'],
    defaultSupportPreset: 'standard',
    manualSelectionOnly: true,
  }]));
}

export function buildCatalog(source) {
  assertSourceRoot(source);
  const challenges = [];
  const localIds = new Set();
  const challengeIds = new Set();
  const audioAssetIds = new Set();
  for (const level of LEVELS) {
    const levelSource = source.levels[level];
    if (!isPlainObject(levelSource)) throw new TypeError(`levels.${level} must be an object`);
    assertExactKeys(levelSource, Object.keys(CONTENT_KINDS), `levels.${level}`);
    for (const [sourceKey, kind] of Object.entries(CONTENT_KINDS)) {
      const items = levelSource[sourceKey];
      if (!Array.isArray(items) || items.length !== kind.count) {
        throw new RangeError(`levels.${level}.${sourceKey} must contain exactly ${kind.count} items`);
      }
      items.forEach((item, index) => {
        const localIdentity = `${level}:${sourceKey}:${item?.id}`;
        if (localIds.has(localIdentity)) throw new RangeError(`duplicate source identity: ${localIdentity}`);
        localIds.add(localIdentity);
        const challenge = buildChallenge({ source, level, sourceKey, item, ordinal: index + 1 });
        if (challengeIds.has(challenge.challengeId)) throw new RangeError(`duplicate challengeId: ${challenge.challengeId}`);
        if (audioAssetIds.has(challenge.audio.assetId)) throw new RangeError(`duplicate audio identity: ${challenge.audio.assetId}`);
        challengeIds.add(challenge.challengeId);
        audioAssetIds.add(challenge.audio.assetId);
        challenges.push(challenge);
      });
    }
  }
  return {
    schemaVersion: 'echo-forge-challenge-catalog-v1',
    contentVersion: source.contentVersion,
    locale: source.locale,
    sourceSha256: sha256(source),
    levelPolicies: buildLevelPolicies(),
    challenges,
  };
}

export function validateBuiltCatalog(catalog) {
  if (!isPlainObject(catalog)) throw new TypeError('built catalog must be an object');
  assertExactKeys(
    catalog,
    ['schemaVersion', 'contentVersion', 'locale', 'sourceSha256', 'levelPolicies', 'challenges'],
    'built catalog',
  );
  if (catalog.schemaVersion !== 'echo-forge-challenge-catalog-v1') {
    throw new TypeError('built catalog schemaVersion is invalid');
  }
  if (catalog.locale !== 'en-US') throw new TypeError('built catalog locale is invalid');
  if (!/^[a-f0-9]{64}$/.test(catalog.sourceSha256)) throw new TypeError('sourceSha256 is invalid');
  if (!Array.isArray(catalog.challenges)) throw new TypeError('built catalog challenges must be an array');
  const challengeIds = new Set();
  const audioIds = new Set();
  for (const challenge of catalog.challenges) {
    if (!/^[a-f0-9]{64}$/.test(challenge.contentHash)
      || challenge.contentHash !== hashChallengeContent(challenge)) {
      throw new Error(`contentHash mismatch or tamper detected: ${challenge.challengeId}`);
    }
    if (challengeIds.has(challenge.challengeId)) throw new Error(`duplicate challengeId: ${challenge.challengeId}`);
    if (audioIds.has(challenge.audio?.assetId)) throw new Error(`duplicate audio identity: ${challenge.audio?.assetId}`);
    challengeIds.add(challenge.challengeId);
    audioIds.add(challenge.audio?.assetId);
  }
  return true;
}

export function buildAssessmentManifest(catalog) {
  validateBuiltCatalog(catalog);
  const challenges = catalog.challenges
    .filter((challenge) => (
      challenge.unitType === 'word' && challenge.evaluationMode === 'azure_word'
      || challenge.unitType === 'phrase' && challenge.evaluationMode === 'azure_phrase'
    ))
    .map((challenge) => ({
      challengeId: challenge.challengeId,
      evaluationMode: challenge.evaluationMode,
      referenceText: challenge.text,
    }));
  return {
    schemaVersion: 'echo-forge-assessment-manifest-v1',
    contentVersion: catalog.contentVersion,
    locale: catalog.locale,
    catalogSourceSha256: catalog.sourceSha256,
    challenges,
  };
}

async function runCli() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = path.resolve(scriptDirectory, '..', '..');
  const sourcePath = path.join(workspaceRoot, 'data', 'echo-forge', 'challenges.source.json');
  const outputPath = path.join(workspaceRoot, 'public', 'database', 'echo-forge', 'challenges.v1.json');
  const manifestPaths = [
    path.join(workspaceRoot, 'data', 'echo-forge', 'assessment-manifest.v1.json'),
    path.join(workspaceRoot, 'functions', 'src', 'data', 'echo-forge', 'assessment-manifest.v1.json'),
  ];
  const source = JSON.parse(await readFile(sourcePath, 'utf8'));
  const catalog = buildCatalog(source);
  validateBuiltCatalog(catalog);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  const manifest = buildAssessmentManifest(catalog);
  for (const manifestPath of manifestPaths) {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`Built ${catalog.challenges.length} Echo Forge challenges at ${outputPath}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runCli().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
