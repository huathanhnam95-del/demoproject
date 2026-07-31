import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const workspace = 'C:\\Cursor AI';
const inputPath = process.argv[2] || path.join(workspace, 'outputs', 'pronunciation-manual-input-20260729', 'oxford-american-ipa-input-yes-no.xlsx');
const outputPath = process.argv[3] || path.join(workspace, 'test-results', 'pronunciation-input-verification-20260730.json');

const OXFORD = {
  because: 'https://www.oxfordlearnersdictionaries.com/us/definition/american_english/because',
  beloved: 'https://www.oxfordlearnersdictionaries.com/us/definition/american_english/beloved_1',
  constructor: 'https://www.oxfordlearnersdictionaries.com/us/definition/american_english/constructor',
  hurricane: 'https://www.oxfordlearnersdictionaries.com/us/definition/american_english/hurricane',
  luxembourg: 'https://www.oxfordlearnersdictionaries.com/us/definition/american_english/luxembourg_1',
  murray: 'https://www.oxfordlearnersdictionaries.com/us/definition/english/murray',
  semiconductor: 'https://www.oxfordlearnersdictionaries.com/us/definition/american_english/semiconductor',
  the: 'https://www.oxfordlearnersdictionaries.com/us/definition/american_english/the',
  unplugged: 'https://www.oxfordlearnersdictionaries.com/us/definition/american_english/unpluggedtm',
  unserviceable: 'https://www.oxfordlearnersdictionaries.com/us/definition/english/unserviceable',
  upturn: 'https://www.oxfordlearnersdictionaries.com/us/definition/english/upturn'
};

const quarantineNeedsReview = new Set([
  'discoverable',
  'governmentally',
  "guzzler's",
  'guzzlers',
  'guzzling',
  'indulgences',
  'injunctive',
  'justices',
  'twentysomething',
  'twentysomethings'
]);

// Final adjudications supplied by the user after the first verification pass.
// Keep these keyed by case ID so the decision remains traceable to the workbook row.
const manualAdjudications = new Map([
  ['review-046', {
    decision: 'quarantine',
    correctedIPA: '',
    alternateIPA: '',
    correctedWeakIPA: '',
    adjudicationSource: 'user',
    reason: 'User adjudicated deneuve as a nonword; quarantine.'
  }],
  ['review-048', {
    decision: 'approve',
    correctedIPA: '/dɪˈskʌvərəbl/',
    alternateIPA: '',
    correctedWeakIPA: '',
    adjudicationSource: 'user',
    reason: 'User confirmed discoverable is a real word and approved the submitted IPA.'
  }],
  ['review-084', {
    decision: 'approve',
    correctedIPA: '/ˌɡʌvənˈmentəli/',
    alternateIPA: '',
    correctedWeakIPA: '',
    adjudicationSource: 'user',
    reason: 'User supplied the final American IPA for governmentally.'
  }],
  ['review-096', {
    decision: 'quarantine',
    correctedIPA: '',
    alternateIPA: '',
    correctedWeakIPA: '',
    adjudicationSource: 'user',
    reason: "User adjudicated guzzler's as invalid for this dictionary; quarantine."
  }],
  ['review-097', {
    decision: 'quarantine',
    correctedIPA: '',
    alternateIPA: '',
    correctedWeakIPA: '',
    adjudicationSource: 'user',
    reason: 'User adjudicated guzzlers as invalid for this dictionary; quarantine.'
  }],
  ['review-098', {
    decision: 'quarantine',
    correctedIPA: '',
    alternateIPA: '',
    correctedWeakIPA: '',
    adjudicationSource: 'user',
    reason: 'User adjudicated guzzling as invalid for this dictionary; quarantine.'
  }],
  ['review-129', {
    decision: 'quarantine',
    correctedIPA: '',
    alternateIPA: '',
    correctedWeakIPA: '',
    adjudicationSource: 'user',
    reason: 'User adjudicated indulgences as invalid for this dictionary; quarantine.'
  }],
  ['review-133', {
    decision: 'quarantine',
    correctedIPA: '',
    alternateIPA: '',
    correctedWeakIPA: '',
    adjudicationSource: 'user',
    reason: 'User adjudicated injunctive as invalid for this dictionary; quarantine.'
  }],
  ['review-144', {
    decision: 'quarantine',
    correctedIPA: '',
    alternateIPA: '',
    correctedWeakIPA: '',
    adjudicationSource: 'user',
    reason: 'User adjudicated justices as invalid for this dictionary; quarantine.'
  }],
  ['review-316', {
    decision: 'quarantine',
    correctedIPA: '',
    alternateIPA: '',
    correctedWeakIPA: '',
    adjudicationSource: 'user',
    reason: 'User adjudicated twentysomething as invalid in this corpus; quarantine.'
  }],
  ['review-317', {
    decision: 'quarantine',
    correctedIPA: '',
    alternateIPA: '',
    correctedWeakIPA: '',
    adjudicationSource: 'user',
    reason: 'User adjudicated twentysomethings as invalid in this corpus; quarantine.'
  }]
]);

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function americanNormalize(value) {
  let ipa = String(value || '').trim().replace(/\s+/gu, '');
  if (!ipa) return '';
  if (!ipa.startsWith('/')) ipa = `/${ipa}`;
  if (!ipa.endsWith('/')) ipa = `${ipa}/`;
  return ipa
    .replace(/əʊ/gu, 'oʊ')
    .replace(/ɪə/gu, 'ɪr')
    .replace(/eə/gu, 'ɛr')
    .replace(/ʊə/gu, 'ʊr')
    .replace(/ː/gu, '')
    .replace(/ɝ/gu, 'ər')
    .replace(/ɚ/gu, 'ər');
}

function special(word, submittedStrong, submittedWeak) {
  const suffix = word.endsWith("'s") ? 'z' : word.endsWith('s') && word !== 'the' ? 'z' : '';
  if (word === 'because') {
    return {
      correctedIPA: '/bɪˈkʌz/',
      alternateIPA: '/bɪˈkɔz/',
      correctedWeakIPA: '',
      reason: 'Oxford American lists /bɪˈkʌz/ and /bɪˈkɔz/. The submitted /ɔː/ is not the American entry notation, and /bɪˈkəz/ is not a weak form because it retains main stress.',
      sourceUrl: OXFORD.because
    };
  }
  if (word === 'beloved') {
    return {
      correctedIPA: '/bɪˈlʌvd/',
      alternateIPA: '/bɪˈlʌvəd/',
      correctedWeakIPA: '',
      reason: 'Oxford American gives /bɪˈlʌvd/ and the before-noun variant /bɪˈlʌvəd/. The submitted /ɪd/ form is not the American entry.',
      sourceUrl: OXFORD.beloved
    };
  }
  if (word.startsWith('semiconductor')) {
    const ending = word === 'semiconductor' ? '' : 'z';
    return {
      correctedIPA: `/ˈsɛmikənˌdʌktər${ending}/`,
      alternateIPA: `/ˈsɛmaɪkənˌdʌktər${ending}/`,
      correctedWeakIPA: '',
      reason: 'Oxford American lists two lexical pronunciation variants. The second submitted column is an alternative pronunciation, not a weak form; Oxford stress marks and American symbols were restored.',
      sourceUrl: OXFORD.semiconductor
    };
  }
  if (word === 'the') {
    return {
      correctedIPA: '/ði/',
      alternateIPA: '',
      correctedWeakIPA: '/ðə/',
      reason: 'Oxford American lists /ðə/ and /ði/. The stressed form is /ði/ in Oxford broad notation; /ðə/ is the weak form.',
      sourceUrl: OXFORD.the
    };
  }
  const exact = {
    constructor: '/kənˈstrʌktər/',
    hurricane: '/ˈhərəˌkeɪn/',
    luxembourg: '/ˈlʌksəmˌbərɡ/',
    murray: '/ˈmʌri/',
    unserviceable: '/ʌnˈsərvɪsəbl/',
    unplugged: '/ʌnˈplʌɡd/',
    upturn: '/ˈʌptərn/'
  };
  if (exact[word]) {
    return {
      correctedIPA: exact[word],
      alternateIPA: '',
      correctedWeakIPA: '',
      reason: 'The submitted form used British/length-marked notation or a non-American stress shape; normalized to the Oxford American form.',
      sourceUrl: OXFORD[word]
    };
  }
  return null;
}

const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);
const values = workbook.worksheets.getItem('IPA Input').getRange('A5:H367').values;
const rows = values.map((row) => ({
  caseId: row[0],
  word: String(row[1] || '').trim(),
  sourceIPA: row[2] || '',
  referenceIPA: row[3] || '',
  submittedStrongIPA: row[4] || '',
  submittedWeakIPA: row[5] || '',
  quarantine: String(row[6] || '').trim().toLowerCase(),
  whyFlagged: row[7] || ''
}));

const decisions = rows.map((row) => {
  const hasStrong = hasValue(row.submittedStrongIPA);
  const hasWeak = hasValue(row.submittedWeakIPA);
  const manual = manualAdjudications.get(row.caseId);
  if (manual) {
    return { ...row, ...manual };
  }
  if (row.quarantine === 'yes' && (hasStrong || hasWeak)) {
    return {
      ...row,
      decision: 'review',
      correctedIPA: '',
      alternateIPA: '',
      correctedWeakIPA: '',
      reason: quarantineNeedsReview.has(row.word)
        ? 'Contradictory input: this appears to be a valid lexical form, but Quarantine is Yes and IPA was also supplied.'
        : 'Contradictory input: quarantine is Yes but IPA was also supplied.',
      sourceUrl: ''
    };
  }
  if (row.quarantine === 'yes' && quarantineNeedsReview.has(row.word)) {
    return {
      ...row,
      decision: 'review',
      correctedIPA: '',
      alternateIPA: '',
      correctedWeakIPA: '',
      reason: 'User marked quarantine, but Oxford or a clearly supported inflection indicates this may be a valid lexical form. No IPA was supplied, so this cannot be finalized automatically.',
      sourceUrl: ''
    };
  }
  if (row.quarantine === 'yes') {
    return {
      ...row,
      decision: 'quarantine',
      correctedIPA: '',
      alternateIPA: '',
      correctedWeakIPA: '',
      reason: 'User marked quarantine and supplied no IPA.',
      sourceUrl: ''
    };
  }
  if (!hasStrong) {
    return {
      ...row,
      decision: 'review',
      correctedIPA: '',
      alternateIPA: '',
      correctedWeakIPA: '',
      reason: 'Missing strong IPA and no quarantine selection.',
      sourceUrl: ''
    };
  }
  const override = special(row.word, row.submittedStrongIPA, row.submittedWeakIPA);
  if (override) {
    return { ...row, decision: 'approve', ...override };
  }
  return {
    ...row,
    decision: 'approve',
    correctedIPA: americanNormalize(row.submittedStrongIPA),
    alternateIPA: '',
    correctedWeakIPA: hasWeak ? americanNormalize(row.submittedWeakIPA) : '',
    reason: hasWeak
      ? 'Submitted strong and weak forms accepted after American broad-IPA normalization.'
      : 'Submitted strong IPA accepted after American broad-IPA normalization.',
    sourceUrl: ''
  };
});

const finalDecisions = [];
const seenFinalForms = new Set();
for (const decision of decisions) {
  if (decision.decision === 'approve') {
    const finalKey = [decision.word, decision.correctedIPA, decision.alternateIPA, decision.correctedWeakIPA].join('|');
    if (seenFinalForms.has(finalKey)) {
      finalDecisions.push({
        ...decision,
        decision: 'merge',
        reason: 'This row resolves to the same final IPA form as an earlier row for the same word; retain one preferred record.'
      });
      continue;
    }
    seenFinalForms.add(finalKey);
  }
  finalDecisions.push(decision);
}

const summary = {
  inputRows: rows.length,
  approve: finalDecisions.filter((row) => row.decision === 'approve').length,
  merge: finalDecisions.filter((row) => row.decision === 'merge').length,
  quarantine: finalDecisions.filter((row) => row.decision === 'quarantine').length,
  review: finalDecisions.filter((row) => row.decision === 'review').length,
  reviewCases: finalDecisions.filter((row) => row.decision === 'review').map((row) => ({ caseId: row.caseId, word: row.word, reason: row.reason })),
  manualAdjudications: finalDecisions.filter((row) => row.adjudicationSource === 'user').map((row) => ({ caseId: row.caseId, word: row.word, decision: row.decision, correctedIPA: row.correctedIPA, reason: row.reason })),
  specialCorrections: finalDecisions.filter((row) => row.decision === 'approve' && row.sourceUrl).map((row) => ({ caseId: row.caseId, word: row.word, correctedIPA: row.correctedIPA, alternateIPA: row.alternateIPA, correctedWeakIPA: row.correctedWeakIPA }))
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify({ inputPath: path.resolve(inputPath), summary, entries: finalDecisions }, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ outputPath: path.resolve(outputPath), ...summary, reviewCount: summary.reviewCases.length, specialCorrectionCount: summary.specialCorrections.length }, null, 2));
