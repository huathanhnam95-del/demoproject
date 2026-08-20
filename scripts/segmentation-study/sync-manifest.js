/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '../..');
const STUDIES = Object.freeze({
  v1: Object.freeze({
    studyId: 'segmentation-study-v1',
    manifestVersion: '1.0.0',
    sourcePath: path.join(root, 'scripts/data/segmentation-study-v1.json'),
    destinationPath: path.join(root, 'functions/src/data/segmentation-study-v1.json'),
    expectedEntries: 100
  }),
  v2: Object.freeze({
    studyId: 'segmentation-study-v2',
    manifestVersion: '2.0.0',
    sourcePath: path.join(root, 'scripts/data/segmentation-study-v2.json'),
    destinationPath: path.join(root, 'functions/src/data/segmentation-study-v2.json'),
    expectedEntries: 100
  })
});

function studyConfig(studyVersion = 'v2') {
  const key = String(studyVersion).replace(/^study-/, '').toLowerCase();
  if (!STUDIES[key]) throw new Error(`Unknown segmentation study version: ${studyVersion}`);
  return STUDIES[key];
}

function manifestSha256(manifest) {
  const content = { ...manifest };
  delete content.manifestSha256;
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical(content))).digest('hex');
}

function validateManifest(manifest, studyVersion = 'v2') {
  const config = studyConfig(studyVersion);
  if (!manifest || typeof manifest !== 'object' || manifest.studyId !== config.studyId || manifest.version !== config.manifestVersion) {
    throw new Error(`Refusing to bundle an invalid ${config.studyId} manifest identity.`);
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length !== config.expectedEntries) {
    throw new Error(`Refusing to bundle ${config.studyId}: expected ${config.expectedEntries} entries.`);
  }
  if (!manifest.manifestSha256 || manifest.manifestSha256 !== manifestSha256(manifest)) {
    throw new Error(`Refusing to bundle ${config.studyId}: manifestSha256 does not match content.`);
  }
  const taskPrefix = `${config.studyId}-`;
  const taskIds = new Set();
  const words = new Set();
  const countTotals = new Map();
  const splitTotals = new Map();
  const cleanIpa = (value) => {
    let text = String(value || '').trim();
    if ((text.startsWith('/') && text.endsWith('/')) || (text.startsWith('[') && text.endsWith(']'))) text = text.slice(1, -1);
    return text.replace(/\s+/g, '').replace(/\|/g, '');
  };
  const stress = (value) => [...cleanIpa(value)].filter((symbol) => symbol === 'ˈ' || symbol === 'ˌ').join('');
  for (const entry of manifest.entries) {
    if (!entry || typeof entry !== 'object' || !String(entry.taskId || '').startsWith(taskPrefix)) {
      throw new Error(`Refusing to bundle ${config.studyId}: invalid task ID.`);
    }
    if (taskIds.has(entry.taskId) || words.has(entry.targetWord)) throw new Error(`Refusing to bundle ${config.studyId}: duplicate task or word.`);
    taskIds.add(entry.taskId);
    words.add(entry.targetWord);
    if (!Number.isInteger(entry.targetSyllableCount) || entry.referenceSyllableIpa?.length !== entry.targetSyllableCount) {
      throw new Error(`Refusing to bundle ${config.studyId}: invalid frozen syllable labels.`);
    }
    const count = entry.targetSyllableCount;
    countTotals.set(count, (countTotals.get(count) || 0) + 1);
    const splitKey = `${entry.split}:${count}`;
    splitTotals.set(splitKey, (splitTotals.get(splitKey) || 0) + 1);
    if (config.studyId === 'segmentation-study-v2') {
      const provenance = String(entry.labelProvenance || '').toLowerCase();
      const labels = entry.referenceSyllableIpa.map(cleanIpa).join('');
      const source = cleanIpa(entry.referenceIpa);
      const hasInternalStress = entry.referenceSyllableIpa.some((label) => /.[ˈˌ]/u.test(cleanIpa(label)));
      const affricateSplit = ['tʃ', 'dʒ'].some((affricate) => entry.referenceSyllableIpa.some((label, index) => cleanIpa(label).endsWith(affricate[0]) && index < entry.referenceSyllableIpa.length - 1 && cleanIpa(entry.referenceSyllableIpa[index + 1]).startsWith(affricate[1])));
      if (entry.referenceDialect !== 'en-US' || entry.dialect !== 'en-US' || !entry.referenceProvenance || entry.referenceProvenance.dialect !== 'en-US' || entry.referenceProvenance.method !== 'explicit-reviewed-en-US-v1' || entry.referenceLabelProvenance !== 'explicit-reviewed-en-US-v1' || entry.labelProvenance !== 'explicit-reviewed-en-US-v1' || !entry.exceptionRationale || provenance.includes('heuristic') || provenance === 'deterministic-transform' || !source || source !== labels || stress(source) !== entry.referenceSyllableIpa.map(stress).join('') || hasInternalStress || affricateSplit) {
        throw new Error(`Refusing to bundle ${config.studyId}: primary labels must be explicit frozen en-US references.`);
      }
    }
  }
  if (config.studyId === 'segmentation-study-v2') {
    if (![2, 3, 4, 5].every((count) => countTotals.get(count) === 25)) throw new Error(`Refusing to bundle ${config.studyId}: expected 25 entries per syllable count.`);
    const expectedSplits = { 'development:2': 18, 'development:3': 18, 'development:4': 17, 'development:5': 17, 'holdout:2': 7, 'holdout:3': 7, 'holdout:4': 8, 'holdout:5': 8 };
    if (Object.entries(expectedSplits).some(([key, value]) => splitTotals.get(key) !== value)) throw new Error(`Refusing to bundle ${config.studyId}: split allocation is not the frozen 70/30 cohort.`);
  }
  return { ...config, manifestSha256: manifest.manifestSha256 };
}

function syncManifest(options = {}) {
  const config = studyConfig(options.studyVersion || 'v2');
  const sourcePath = path.resolve(options.sourcePath || config.sourcePath);
  const destinationPath = path.resolve(options.destinationPath || config.destinationPath);
  const manifest = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const validated = validateManifest(manifest, options.studyVersion || 'v2');
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
  return { sourcePath, destinationPath, studyId: validated.studyId, manifestSha256: validated.manifestSha256 };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    args[key] = value && !value.startsWith('--') ? value : true;
    if (args[key] !== true) index += 1;
  }
  return args;
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = syncManifest({ studyVersion: args['study-version'] || 'v2', sourcePath: args.source, destinationPath: args.destination });
    console.log(`Bundled ${result.studyId} manifest ${result.manifestSha256}.`);
  } catch (error) {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { STUDIES, manifestSha256, parseArgs, studyConfig, syncManifest, validateManifest };
