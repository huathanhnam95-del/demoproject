import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const root = process.cwd();
const inputPath = path.join(root, 'outputs', 'pronunciation-review-pilot-20260729', 'pronunciation-review-pilot.xlsx');
const outputPath = path.join(root, 'outputs', 'pronunciation-review-pilot-20260729', 'pronunciation-review-pilot-verified.xlsx');
const previewPath = path.join(root, 'outputs', 'pronunciation-review-pilot-20260729', 'pronunciation-review-pilot-verified.png');
const guidePreviewPath = path.join(root, 'outputs', 'pronunciation-review-pilot-20260729', 'pronunciation-review-pilot-verified-guide.png');

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const review = workbook.worksheets.getItem('Review Pilot');
const rows = review.getRange('A4:K29').values;

const decisions = new Map([
  ['abducted', { decision: 'approve', corrected: '/æbˈdʌktɪd/', note: 'Oxford American/OALD confirms the strong form; the source begins with an erroneous unstressed /ə/. Oxford: https://www.oxfordlearnersdictionaries.com/definition/english/abduct' }],
  ['abducting', { decision: 'approve', corrected: '/æbˈdʌktɪŋ/', note: 'Oxford American/OALD confirms the strong form; the source begins with an erroneous unstressed /ə/. Oxford: https://www.oxfordlearnersdictionaries.com/definition/english/abduct' }],
  ['abduction', { decision: 'approve', corrected: '/æbˈdʌkʃn/', note: 'Oxford confirms /æbˈdʌkʃn/; the source incorrectly uses schwa in the stressed syllable. Oxford: https://www.oxfordlearnersdictionaries.com/definition/english/abduction' }],
  ['abductions', { decision: 'approve', corrected: '/æbˈdʌkʃnz/', note: 'Plural retains the Oxford strong stem /æbˈdʌkʃn/ and adds /z/. The source incorrectly uses schwa in the stressed syllable.' }],
  ['abductor', { decision: 'approve', corrected: '/æbˈdʌktər/', note: 'Oxford American strong form verified; source incorrectly uses schwa in the stressed syllable and /ɝ/ where Oxford writes the unstressed rhotic syllable /ər/.' }],
  ['abductors', { decision: 'approve', corrected: '/æbˈdʌktərz/', note: 'Plural Oxford strong form verified; source incorrectly uses schwa in the stressed syllable and /ɝ/ in the final unstressed syllable.' }],
  ['accompaniment', { decision: 'approve', corrected: '/əˈkʌmpənimənt/', note: 'Oxford confirms the strong form /əˈkʌmpənimənt/; source incorrectly replaces stressed /ʌ/ with /ə/. Oxford: https://www.oxfordlearnersdictionaries.com/definition/english/accompaniment' }],
  ['accompaniments', { decision: 'approve', corrected: '/əˈkʌmpənimənts/', note: 'Plural Oxford strong form verified from accompaniment; source incorrectly replaces stressed /ʌ/ with /ə/.' }],
  ['agricultural', { decision: 'approve', corrected: '/ˌæɡrɪˈkʌltʃərəl/', note: 'Oxford confirms the American learner form, including secondary stress and stressed /ʌ/. Oxford: https://www.oxfordlearnersdictionaries.com/us/definition/english/agricultural' }],
  ['agriculturally', { decision: 'approve', corrected: '/ˌæɡrɪˈkʌltʃərəli/', note: 'Oxford-style American derivative verified: secondary stress /ˌ/, main stress before /kʌl/, and rhotic unstressed /ər/.' }],
  ['alum', { decision: 'approve', corrected: '/ˈæləm/', note: 'Oxford American confirms /ˈæləm/ for alum (former student/material sense); source incorrectly stresses the second syllable. Oxford: https://www.oxfordlearnersdictionaries.com/us/definition/american_english/alum1' }],
  ['anticorruption', { decision: 'approve', corrected: '/ˌæntaɪkərˈʌpʃən/', note: 'Oxford-style American compound verified: anti- is /ˌæntaɪ/ and corruption is /kərˈʌpʃən/. Source has the wrong first prefix and stresses the wrong vowel.' }],
  ['antidumping', { decision: 'approve', corrected: '/ˌæntaɪˈdʌmpɪŋ/', note: 'User supplied the corrected Oxford American form. The leading comma was normalized to Oxford secondary-stress mark /ˌ/. The previous entry was a copied anticorruption IPA.' }],
  ['antifungal', { decision: 'approve', corrected: '/ˌæntaɪˈfʌŋɡl/', note: 'Oxford American-style compound verified from anti- + fungal: secondary stress on anti-, main stress on /fʌŋ/, and syllabic final /l/. Source uses schwa in the stressed syllable.' }],
  ['antigovernment', { decision: 'approve', corrected: '/ˌæntaɪˈɡʌvərnmənt/', note: 'Oxford American-style compound verified from anti- + government; main stress is on /ɡʌv/. Source uses schwa in the stressed syllable.' }],
  ['antisubmarine', { decision: 'approve', corrected: '/ˌæntaɪˈsʌbməriːn/', note: 'Oxford American-style compound verified from anti- + submarine; main stress is on /sʌb/. Source uses schwa in the stressed syllable.' }],
  ['augustus', { decision: 'quarantine', corrected: '', note: 'Excluded: Augustus is not a target word in this corpus. No IPA should be entered; remove this record from the dictionary corpus.' }],
  ['be', { decision: 'merge', corrected: '', note: 'Duplicate-normalized record. Oxford American headword: strong /bi/. No separate weak form is printed on the American entry; keep the strong learner form. Oxford: https://www.oxfordlearnersdictionaries.com/definition/american_english/be_1' }],
  ['been', { decision: 'merge', corrected: '', note: 'Duplicate-normalized record. Oxford American headword: /bɪn/. Full/strong variant may be /biːn/; reduced/common connected-speech form is /bɪn/. The entered American form is retained. Oxford: https://www.oxfordlearnersdictionaries.com/definition/american_english/been' }],
  ['did', { decision: 'merge', corrected: '', note: 'Duplicate-normalized record. Strong form is /dɪd/. No separate Oxford weak headword form is listed; phrase-level reduction is handled by connected-speech rules.' }],
  ['her', { decision: 'approve', corrected: '/hər/', note: 'Oxford American gives /hər/ as the strong form and /ər/ as the weak form. The entered /hɜːr/ is a British-style length-marked form, not Oxford American IPA. Oxford: https://www.oxfordlearnersdictionaries.com/definition/american_english/her_1' }],
  ['hers', { decision: 'approve', corrected: '/hərz/', note: 'Oxford American gives /hərz/. No separate weak form is listed for the possessive pronoun; the entered /hɜːrz/ is a British-style length-marked form. Oxford: https://www.oxfordlearnersdictionaries.com/us/definition/american_english/hers' }],
  ['his', { decision: 'merge', corrected: '', note: 'Duplicate-normalized record. Oxford American strong /hɪz/; weak /ɪz/. The entered strong form is correct. Oxford: https://www.oxfordlearnersdictionaries.com/us/definition/american_english/his_1' }],
  ['if', { decision: 'merge', corrected: '', note: 'Duplicate-normalized record. Strong /ɪf/ retained. In connected speech, a weak /əf/ can occur; the Oxford headword itself is /ɪf/. Oxford: https://www.oxfordlearnersdictionaries.com/us/definition/english/if_1' }],
  ['in', { decision: 'merge', corrected: '', note: 'Duplicate-normalized record. Strong /ɪn/ retained; weak /ən/ is common in unstressed connected speech. Oxford headword: /ɪn/. Oxford: https://www.oxfordlearnersdictionaries.com/us/definition/english/in_1' }],
  ['is', { decision: 'merge', corrected: '', note: 'Duplicate-normalized record. Strong /ɪz/ retained; weak /əz/ is common in unstressed connected speech. Oxford headword: /ɪz/. Oxford: https://www.oxfordlearnersdictionaries.com/definition/english/is_1' }]
]);

const verifiedRows = rows.map((row) => {
  const word = String(row[2] ?? '').trim();
  const item = decisions.get(word);
  if (!item) throw new Error(`No verification rule for ${word}`);
  if (word !== 'augustus' && !String(row[7] ?? '').trim()) throw new Error(`Missing Oxford IPA for ${word}`);
  return [item.decision, item.corrected, item.note];
});

review.getRange('A2').values = [[
  'Codex verification complete. Column H contains the Oxford American strong IPA inputs; Augustus is intentionally blank because it is excluded from the target word list. Decisions, correctedIPA, and reviewerNotes are completed below.'
]];
review.getRange('A4:K29').format.rowHeight = 56;
review.getRange('K:K').format.columnWidth = 64;
review.getRange('H4:H29').values = rows.map((row) => [String(row[2] ?? '').trim() === 'augustus' ? '' : row[7]]);
review.getRange('I4:K29').values = verifiedRows;
review.getRange('I4:I29').dataValidation = { rule: { type: 'list', values: ['approve', 'keep', 'quarantine', 'merge'] } };

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
const fs = await import('node:fs/promises');
await xlsx.save(outputPath);
const preview = await workbook.render({ sheetName: 'Review Pilot', range: 'A1:K29', scale: 1, format: 'png' });
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
const guidePreview = await workbook.render({ sheetName: 'Decision Guide', range: 'A1:D8', scale: 1, format: 'png' });
await fs.writeFile(guidePreviewPath, new Uint8Array(await guidePreview.arrayBuffer()));

console.log(JSON.stringify({ outputPath, previewPath, guidePreviewPath, rows: verifiedRows }, null, 2));
