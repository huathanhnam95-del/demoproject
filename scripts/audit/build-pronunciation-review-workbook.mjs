import fs from 'node:fs/promises';
import path from 'node:path';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const root = process.cwd();
const manifestPath = path.join(root, 'test-results', 'pronunciation-stressed-schwa-review-manifest.json');
const outputDir = path.join(root, 'outputs', 'pronunciation-review-pilot-20260729');
const outputPath = path.join(outputDir, 'pronunciation-review-pilot.xlsx');
const previewPath = path.join(outputDir, 'pronunciation-review-pilot.png');
const guidePreviewPath = path.join(outputDir, 'pronunciation-review-pilot-guide.png');

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const excludedWords = new Set(['awb', 'banderas', "in's"]);
const entries = [
  ...manifest.entries
    .filter((entry) => entry.type === 'UNVERIFIED_STRESSED_SCHWA')
    .slice(0, 20)
    .filter((entry) => !excludedWords.has(entry.word)),
  ...manifest.entries
    .filter((entry) => entry.type === 'DUPLICATE_NORMALIZED_VARIANT')
    .slice(0, 10)
    .filter((entry) => !excludedWords.has(entry.word))
];

const decisions = [
  'approve',
  'keep',
  'quarantine',
  'merge'
];

const workbook = Workbook.create();
const review = workbook.worksheets.add('Review Pilot');
const guide = workbook.worksheets.add('Decision Guide');

review.showGridLines = false;
guide.showGridLines = false;

review.mergeCells('A1:K1');
review.getRange('A1').values = [['Oxford Strong IPA Review Pilot']];
review.mergeCells('A2:K2');
review.getRange('A2').values = [[
  'Paste Oxford American strong IPA into column H only. Weak forms will be checked separately by Codex. Leave the decision, correctedIPA, and reviewerNotes columns blank.'
]];

const headers = [
  'reviewId', 'type', 'word', 'sourceIPA', 'normalized', 'referenceIPA',
  'referenceVariants', 'oxfordStrongIPA', 'decision', 'correctedIPA', 'reviewerNotes'
];
review.getRange('A3:K3').values = [headers];

const rows = entries.map((entry) => [
  entry.reviewId,
  entry.type,
  entry.word,
  entry.sourceIPA || '',
  entry.normalized || '',
  entry.referenceIPA || '',
  Array.isArray(entry.referenceVariants) ? entry.referenceVariants.join('; ') : '',
  '',
  '',
  '',
  ''
]);
review.getRange(`A4:K${rows.length + 3}`).values = rows;
review.getRange(`I4:I${rows.length + 3}`).dataValidation = {
  rule: { type: 'list', values: decisions }
};

review.getRange('A1:K1').format = {
  fill: '#1F4E78',
  font: { bold: true, color: '#FFFFFF', size: 16 },
  horizontalAlignment: 'center',
  verticalAlignment: 'center'
};
review.getRange('A2:K2').format = {
  fill: '#D9EAF7',
  font: { italic: true, color: '#1F2937', size: 10 },
  wrapText: true,
  verticalAlignment: 'center'
};
review.getRange('A3:K3').format = {
  fill: '#5B9BD5',
  font: { bold: true, color: '#FFFFFF' },
  horizontalAlignment: 'center',
  verticalAlignment: 'center',
  wrapText: true,
  borders: { preset: 'all', style: 'thin', color: '#D9E2F3' }
};
review.getRange(`A4:K${rows.length + 3}`).format = {
  font: { name: 'Arial', size: 10, color: '#1F2937' },
  verticalAlignment: 'top',
  wrapText: true,
  borders: { insideHorizontal: { style: 'thin', color: '#E5E7EB' } }
};
review.getRange(`D4:H${rows.length + 3}`).format.font = { name: 'Segoe UI Symbol', size: 10 };
review.getRange(`H4:H${rows.length + 3}`).format = {
  fill: '#FFF2CC',
  font: { bold: true, color: '#7F6000', name: 'Segoe UI Symbol' },
  verticalAlignment: 'top'
};
review.getRange(`I4:I${rows.length + 3}`).format = {
  fill: '#E2F0D9',
  font: { bold: true, color: '#375623' },
  horizontalAlignment: 'center',
  verticalAlignment: 'top'
};
review.getRange(`J4:K${rows.length + 3}`).format.fill = '#F8FAFC';
review.getRange(`A1:K${rows.length + 3}`).format.rowHeight = 28;
review.getRange('A1:K1').format.rowHeight = 32;
review.getRange('A2:K2').format.rowHeight = 32;
review.getRange('A3:K3').format.rowHeight = 36;

const widths = {
  A: 22, B: 28, C: 18, D: 24, E: 24, F: 24, G: 32, H: 24, I: 16, J: 24, K: 42
};
for (const [column, width] of Object.entries(widths)) {
  review.getRange(`${column}:${column}`).format.columnWidth = width;
}
review.freezePanes.freezeRows(3);
review.tables.add(`A3:K${rows.length + 3}`, true, 'PronunciationReviewPilot');

guide.mergeCells('A1:D1');
guide.getRange('A1').values = [['Pronunciation Review Decision Guide']];
guide.mergeCells('A2:D2');
guide.getRange('A2').values = [[
  'Your only task: paste Oxford American strong IPA into column H on the Review Pilot sheet. Codex will verify the strong form, check weak forms separately, and complete the decisions.'
]];
guide.getRange('A4:D4').values = [['Decision', 'When to choose it', 'What to enter', 'Example interpretation']];
guide.getRange('A5:D8').values = [
  [
    'approve',
    'Oxford American confirms the source IPA is wrong and provides a clear corrected pronunciation.',
    'Enter the complete corrected IPA in correctedIPA. Add the Oxford page or reasoning in reviewerNotes.',
    'Source /əbˈd.../ is confirmed by Oxford as /æbˈd.../ with the complete word shape verified.'
  ],
  [
    'keep',
    'The source IPA is valid, or the CMU mismatch reflects an accepted U.S. pronunciation variant.',
    'Leave correctedIPA empty and explain why the source should remain.',
    'Oxford supports the source form even though CMU uses a different regional or lexical variant.'
  ],
  [
    'quarantine',
    'Evidence conflicts, Oxford does not clearly support a correction, or the entire pronunciation differs.',
    'Leave correctedIPA empty. Explain what needs manual review; do not apply a one-symbol repair.',
    'A source and reference differ in multiple segments, so changing only /ə/ to /ʌ/ would be unsafe.'
  ],
  [
    'merge',
    'Two source variants normalize to the same learner-facing IPA and one record should be retained as preferred.',
    'Leave correctedIPA empty and identify which duplicate should be preferred.',
    'Two raw spellings or stress-mark variants produce the same normalized IPA.'
  ]
];
guide.getRange('A1:D1').format = {
  fill: '#1F4E78',
  font: { bold: true, color: '#FFFFFF', size: 16 },
  horizontalAlignment: 'center',
  verticalAlignment: 'center'
};
guide.getRange('A2:D2').format = {
  fill: '#D9EAF7',
  font: { italic: true, color: '#1F2937', size: 10 },
  wrapText: true,
  verticalAlignment: 'center'
};
guide.getRange('A4:D4').format = {
  fill: '#5B9BD5',
  font: { bold: true, color: '#FFFFFF' },
  horizontalAlignment: 'center',
  verticalAlignment: 'center',
  wrapText: true,
  borders: { preset: 'all', style: 'thin', color: '#D9E2F3' }
};
guide.getRange('A5:D8').format = {
  font: { name: 'Arial', size: 10, color: '#1F2937' },
  verticalAlignment: 'top',
  wrapText: true,
  borders: { insideHorizontal: { style: 'thin', color: '#E5E7EB' } }
};
guide.getRange('A5:A8').format = { font: { bold: true, color: '#1F4E78' } };
guide.getRange('A1:D1').format.rowHeight = 32;
guide.getRange('A2:D2').format.rowHeight = 34;
guide.getRange('A4:D4').format.rowHeight = 36;
guide.getRange('A5:D8').format.rowHeight = 86;
for (const [column, width] of Object.entries({ A: 18, B: 48, C: 54, D: 58 })) {
  guide.getRange(`${column}:${column}`).format.columnWidth = width;
}
guide.freezePanes.freezeRows(4);

await fs.mkdir(outputDir, { recursive: true });
const preview = await workbook.render({ sheetName: 'Review Pilot', range: 'A1:K18', scale: 1, format: 'png' });
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
const guidePreview = await workbook.render({ sheetName: 'Decision Guide', range: 'A1:D8', scale: 1, format: 'png' });
await fs.writeFile(guidePreviewPath, new Uint8Array(await guidePreview.arrayBuffer()));
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);

const inspection = await workbook.inspect({
  kind: 'table',
  sheetId: 'Review Pilot',
  range: 'A1:K8',
  include: 'values,formulas',
  tableMaxRows: 8,
  tableMaxCols: 11,
  maxChars: 5000
});
console.log(inspection.ndjson);
console.log(JSON.stringify({ outputPath, previewPath, guidePreviewPath, entryCount: entries.length }));
