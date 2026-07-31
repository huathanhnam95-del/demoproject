/**
 * Source-backed U.S. IPA audit for the student-facing ipa-dict corpus.
 *
 * The audit never treats a residual stressed schwa as automatically correct
 * and never treats a symbol-only rewrite as proof. A stressed schwa can be
 * promoted only when CMU supplies a matching U.S. reference shape.
 *
 * Usage:
 *   node scripts/audit/stressed-schwa-audit.js --summary
 *   node scripts/audit/stressed-schwa-audit.js --strict
 *   node scripts/audit/stressed-schwa-audit.js --review-manifest <path>
 */

const fs = require('fs');
const path = require('path');

global.window = {};
global.arpabetToIPA = require('../../public/arpabet-ipa-map.js').arpabetToIPA;
require('../../public/phonetics.js');

const baseDictionary = JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/ipa-dict.json'), 'utf8'));
const oxfordOverlay = JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/oxford-american-ipa.json'), 'utf8'));
const dictionary = { ...baseDictionary };
const oxfordVerifiedWords = new Set(Object.keys(oxfordOverlay.entries || {}));
for (const [word, variants] of Object.entries(oxfordOverlay.entries || {})) {
  dictionary[word] = variants;
}
for (const word of oxfordOverlay.quarantine || []) {
  delete dictionary[word];
}
const cmu = JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/cmudict.json'), 'utf8'));
const { normalizeIPA } = global.window.Phonetics;
const stressedSchwa = /ˈ[bcdfghjklmnpqrstvwxyzŋʃʒθðɡrw]*ə/u;

function hasResidualLexicalSchwa(value) {
  return stressedSchwa.test(String(value || '').replace(/ər/g, 'R'));
}

function cmuIPAs(word) {
  const entry = cmu[word];
  const variants = Array.isArray(entry) ? entry : entry ? [entry] : [];
  return variants.map((arpabet) => global.arpabetToIPA(arpabet)).filter(Boolean);
}

function canonicalTokens(value, neutralizeStrut = false) {
  const tokens = [];
  for (const symbol of Array.from(String(value || '').replace(/\//g, ''))) {
    if (/[ˈˌː̯]/.test(symbol)) continue;
    if (symbol === 'ɝ' || symbol === 'ɚ') {
      tokens.push('ə', 'r');
    } else if (symbol === 'ɹ') {
      tokens.push('r');
    } else if (symbol === 'ɡ') {
      tokens.push('g');
    } else if (neutralizeStrut && symbol === 'ʌ') {
      tokens.push('ə');
    } else {
      tokens.push(symbol);
    }
  }
  return tokens;
}

function comparableShape(value) {
  return canonicalTokens(value, true).join('');
}

function matchingReference(sourceIPA, references) {
  return references.find((referenceIPA) => (
    /ʌ/.test(referenceIPA)
    && comparableShape(sourceIPA) === comparableShape(referenceIPA)
  )) || '';
}

const report = {
  dictionaryWords: Object.keys(dictionary).length,
  variants: 0,
  affectedWords: 0,
  affectedVariants: 0,
  sourceAlignedVariants: 0,
  normalizedWithoutResidualVariants: 0,
  quarantinedVariants: 0,
  residualVariants: 0,
  duplicateNormalizedVariants: 0,
  findings: []
};

for (const [word, rawVariants] of Object.entries(dictionary)) {
  const variants = Array.isArray(rawVariants) ? rawVariants : [rawVariants];
  const normalizedVariants = new Set();
  let wordAffected = false;

  for (const rawIPA of variants) {
    report.variants += 1;
    const sourceIPA = String(rawIPA || '');
    const hasStressedSchwa = stressedSchwa.test(sourceIPA);
    const referenceIPAs = hasStressedSchwa ? cmuIPAs(word) : [];
    const referenceIPA = matchingReference(sourceIPA, referenceIPAs);
    const sourceMatchesReference = Boolean(referenceIPA) || oxfordVerifiedWords.has(word);
    const verifiedByOxford = oxfordVerifiedWords.has(word);
    const normalized = normalizeIPA(sourceIPA, word, { referenceIPA });

    if (hasStressedSchwa) {
      report.affectedVariants += 1;
      wordAffected = true;
      if (sourceMatchesReference) {
        report.sourceAlignedVariants += 1;
      } else {
        report.quarantinedVariants += 1;
        report.findings.push({
          type: 'UNVERIFIED_STRESSED_SCHWA',
          word,
          sourceIPA,
          referenceIPA: referenceIPAs[0] || null,
          referenceVariants: referenceIPAs
        });
      }
    }

    if (hasResidualLexicalSchwa(normalized) && !verifiedByOxford) {
      report.residualVariants += 1;
      report.findings.push({ type: 'RESIDUAL_STRESSED_SCHWA', word, sourceIPA, normalized });
    } else if (hasStressedSchwa) {
      report.normalizedWithoutResidualVariants += 1;
    }

    if (normalizedVariants.has(normalized)) {
      report.duplicateNormalizedVariants += 1;
      report.findings.push({ type: 'DUPLICATE_NORMALIZED_VARIANT', word, normalized });
    }
    normalizedVariants.add(normalized);
  }

  if (wordAffected) report.affectedWords += 1;
}

const strict = process.argv.includes('--strict');
const summaryOnly = process.argv.includes('--summary');
const reviewManifestIndex = process.argv.indexOf('--review-manifest');
const reviewManifestPath = reviewManifestIndex >= 0
  ? process.argv[reviewManifestIndex + 1]
  : '';

if (reviewManifestPath) {
  const reviewFindings = report.findings
    .filter((finding) => [
      'UNVERIFIED_STRESSED_SCHWA',
      'RESIDUAL_STRESSED_SCHWA',
      'DUPLICATE_NORMALIZED_VARIANT'
    ].includes(finding.type))
    .map((finding, index) => ({
      reviewId: `stressed-schwa-${String(index + 1).padStart(4, '0')}`,
      reviewStatus: 'pending',
      decision: null,
      correctedIPA: null,
      reviewerNotes: '',
      ...finding
    }));
  const reviewManifest = {
    manifestVersion: 1,
    dialect: 'en-US',
    source: 'ipa-dict + CMU cross-check',
    policy: 'No learner-facing correction is approved without a matching U.S. reference shape or explicit human review.',
    counts: { ...report, findings: undefined },
    entries: reviewFindings
  };
  fs.mkdirSync(path.dirname(path.resolve(reviewManifestPath)), { recursive: true });
  fs.writeFileSync(reviewManifestPath, `${JSON.stringify(reviewManifest, null, 2)}\n`, 'utf8');
  console.error(`Wrote pronunciation review manifest: ${reviewManifestPath} (${reviewFindings.length} entries)`);
}

console.log(JSON.stringify(summaryOnly ? { ...report, findings: undefined } : report, null, 2));

if (strict && (report.residualVariants > 0 || report.duplicateNormalizedVariants > 0 || report.quarantinedVariants > 0)) {
  process.exitCode = 1;
}
