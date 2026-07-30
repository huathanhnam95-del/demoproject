import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(
  path.join(root, 'test-results', 'pronunciation-stressed-schwa-review-manifest.json'),
  'utf8'
));

const reviewedWords = new Set([
  'abducted', 'abducting', 'abduction', 'abductions', 'abductor', 'abductors',
  'accompaniment', 'accompaniments', 'agricultural', 'agriculturally', 'alum',
  'anticorruption', 'antidumping', 'antifungal', 'antigovernment',
  'antisubmarine', 'augustus'
]);

function canonicalTokens(value) {
  return Array.from(String(value || '').replace(/\//g, '').replace(/[ˈˌː̯]/gu, ''))
    .flatMap((symbol) => {
      if (symbol === 'ɝ' || symbol === 'ɚ') return ['ə', 'r'];
      if (symbol === 'ɹ') return ['r'];
      if (symbol === 'ɡ') return ['g'];
      return [symbol];
    });
}

const remaining = manifest.entries.filter((entry) => (
  entry.type === 'UNVERIFIED_STRESSED_SCHWA'
  && !reviewedWords.has(entry.word)
));

const groups = {
  oneDifference: 0,
  twoDifferences: 0,
  moreDifferences: 0,
  differentLength: 0,
  noReference: 0
};
const substitutions = new Map();
const examples = new Map();

function addExample(key, entry, referenceIPA) {
  if (!examples.has(key)) examples.set(key, []);
  if (examples.get(key).length < 8) {
    examples.get(key).push([entry.word, entry.sourceIPA, referenceIPA]);
  }
}

for (const entry of remaining) {
  const referenceIPA = (entry.referenceVariants || [])[0];
  if (!referenceIPA) {
    groups.noReference += 1;
    addExample('noReference', entry, '');
    continue;
  }

  const source = canonicalTokens(entry.sourceIPA);
  const reference = canonicalTokens(referenceIPA);
  if (source.length !== reference.length) {
    groups.differentLength += 1;
    addExample('differentLength', entry, referenceIPA);
    continue;
  }

  const differences = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== reference[index]) {
      differences.push(`${source[index]}→${reference[index]}`);
    }
  }

  if (differences.length === 1) {
    groups.oneDifference += 1;
    substitutions.set(differences[0], (substitutions.get(differences[0]) || 0) + 1);
    addExample(differences[0], entry, referenceIPA);
  } else if (differences.length === 2) {
    groups.twoDifferences += 1;
    addExample('twoDifferences', entry, referenceIPA);
  } else {
    groups.moreDifferences += 1;
    addExample('moreDifferences', entry, referenceIPA);
  }
}

console.log(JSON.stringify({
  remaining: remaining.length,
  groups,
  topSingleSubstitutions: [...substitutions.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 20),
  examples: Object.fromEntries(examples)
}, null, 2));
