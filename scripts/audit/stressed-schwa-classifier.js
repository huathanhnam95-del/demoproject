const fs = require('fs');
const path = require('path');

const DEFAULT_EXCLUDED_WORDS = new Set(['awb', 'augustus', 'banderas', "in's"]);

function canonicalTokens(value, neutralizeStrut = false) {
  return Array.from(String(value || '').replace(/\//g, '').replace(/[ˈˌː̯]/gu, ''))
    .flatMap((symbol) => {
      if (symbol === 'ɝ' || symbol === 'ɚ') return ['ə', 'r'];
      if (symbol === 'ɹ') return ['r'];
      if (symbol === 'ɡ') return ['g'];
      if (neutralizeStrut && symbol === 'ʌ') return ['ə'];
      return [symbol];
    });
}

function stressedSchwaToStrut(sourceIPA, referenceIPA) {
  if (!sourceIPA || !referenceIPA) return false;
  if (!/ˈ[bcdfghjklmnpqrstvwxyzŋʃʒθðɡrw]*ə/u.test(sourceIPA)) return false;
  if (!/ʌ/u.test(referenceIPA)) return false;

  const source = canonicalTokens(sourceIPA, false);
  const reference = canonicalTokens(referenceIPA, false);
  const neutralSource = canonicalTokens(sourceIPA, true);
  const neutralReference = canonicalTokens(referenceIPA, true);
  if (neutralSource.join('') !== neutralReference.join('') || source.length !== reference.length) {
    return false;
  }

  let differences = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== reference[index]) {
      if (source[index] !== 'ə' || reference[index] !== 'ʌ') return false;
      differences += 1;
    }
  }
  return differences > 0;
}

function findingKey(entry) {
  if (entry.type === 'DUPLICATE_NORMALIZED_VARIANT') {
    return `${entry.word}|${entry.normalized || ''}`;
  }
  return `${entry.word}|${entry.sourceIPA || entry.normalized || ''}`;
}

function classifyGroup(entries, excludedWords, reviewedDecisions) {
  const first = entries[0];
  const word = String(first.word || '').trim();
  const findingTypes = [...new Set(entries.map((entry) => entry.type))];
  const referenceIPA = entries
    .flatMap((entry) => entry.referenceVariants || [])
    .find(Boolean) || entries.find((entry) => entry.referenceIPA)?.referenceIPA || '';
  const hasReviewedDecision = (key) => (
    reviewedDecisions !== null
    && typeof reviewedDecisions === 'object'
    && Object.prototype.hasOwnProperty.call(reviewedDecisions, key)
  );
  const reviewedDecision = hasReviewedDecision(word)
    ? reviewedDecisions[word]
    : (hasReviewedDecision(findingKey(first)) ? reviewedDecisions[findingKey(first)] : null);

  if (reviewedDecision) {
    return {
      key: findingKey(first),
      word,
      sourceIPA: first.sourceIPA || '',
      referenceIPA,
      findingTypes,
      findingCount: entries.length,
      decision: reviewedDecision.decision,
      correctedIPA: reviewedDecision.correctedIPA || '',
      reason: reviewedDecision.reason || 'Human-reviewed decision supplied by the pronunciation review workbook.'
    };
  }

  if (excludedWords.has(word)) {
    return {
      key: findingKey(first),
      word,
      sourceIPA: first.sourceIPA || '',
      referenceIPA,
      findingTypes,
      findingCount: entries.length,
      decision: 'exclude',
      correctedIPA: '',
      reason: 'Excluded by the pronunciation corpus word-policy list.'
    };
  }

  if (findingTypes.every((type) => type === 'DUPLICATE_NORMALIZED_VARIANT')) {
    return {
      key: findingKey(first),
      word,
      sourceIPA: first.sourceIPA || '',
      referenceIPA,
      findingTypes,
      findingCount: entries.length,
      decision: 'merge',
      correctedIPA: '',
      reason: 'Duplicate normalized learner-facing IPA; retain one preferred record.'
    };
  }

  const autoApproval = entries.find((entry) => (
    entry.type === 'UNVERIFIED_STRESSED_SCHWA'
    && stressedSchwaToStrut(entry.sourceIPA, (entry.referenceVariants || [])[0] || entry.referenceIPA)
  ));
  if (autoApproval) {
    const correctedIPA = (autoApproval.referenceVariants || [])[0] || autoApproval.referenceIPA;
    return {
      key: findingKey(first),
      word,
      sourceIPA: first.sourceIPA || '',
      referenceIPA,
      findingTypes,
      findingCount: entries.length,
      decision: 'approve',
      correctedIPA,
      reason: 'The only segment changes are stressed schwa /ə/ to reference-backed STRUT /ʌ/.'
    };
  }

  return {
    key: findingKey(first),
    word,
    sourceIPA: first.sourceIPA || '',
    referenceIPA,
    findingTypes,
    findingCount: entries.length,
    decision: 'review',
    correctedIPA: '',
    reason: 'Reference and source differ in more than a source-backed stressed-schwa-to-STRUT repair.'
  };
}

function classifyManifest({ entries, excludedWords = DEFAULT_EXCLUDED_WORDS, reviewedDecisions = {} }) {
  const groups = new Map();
  for (const entry of entries || []) {
    const key = findingKey(entry);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  const classified = [...groups.values()].map((group) => classifyGroup(group, excludedWords, reviewedDecisions));
  const summary = {
    inputFindings: (entries || []).length,
    uniqueCases: classified.length,
    autoApprove: classified.filter((entry) => entry.decision === 'approve').length,
    merge: classified.filter((entry) => entry.decision === 'merge').length,
    exclude: classified.filter((entry) => entry.decision === 'exclude').length,
    review: classified.filter((entry) => entry.decision === 'review').length
  };

  return { summary, entries: classified };
}

function loadManifest(manifestPath) {
  return JSON.parse(fs.readFileSync(path.resolve(manifestPath), 'utf8'));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const overridesIndex = args.indexOf('--overrides');
  const overridesPath = overridesIndex >= 0 ? args[overridesIndex + 1] : '';
  const positional = args.filter((argument, index) => (
    argument !== '--overrides' && index !== overridesIndex + 1
  ));
  const manifestPath = positional[0] || path.join(__dirname, '../../test-results/pronunciation-stressed-schwa-review-manifest.json');
  const outputPath = positional[1] || path.join(__dirname, '../../test-results/pronunciation-stressed-schwa-classification.json');
  const manifest = loadManifest(manifestPath);
  const reviewedDecisions = overridesPath ? loadManifest(overridesPath) : {};
  const result = classifyManifest({ entries: manifest.entries, reviewedDecisions });
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify({
    ...result,
    sourceManifest: path.resolve(manifestPath),
    overrides: overridesPath ? path.resolve(overridesPath) : null
  }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ outputPath: path.resolve(outputPath), ...result.summary }, null, 2));
}

module.exports = { classifyManifest, canonicalTokens, stressedSchwaToStrut };
