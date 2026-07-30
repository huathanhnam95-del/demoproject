import fs from 'node:fs/promises';
import path from 'node:path';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const workspace = 'C:\\Cursor AI';
const classificationPath = path.join(workspace, 'test-results', 'pronunciation-stressed-schwa-classification.json');
const outputDir = path.join(workspace, 'outputs', 'pronunciation-manual-input-20260729');
const outputPath = path.join(outputDir, 'oxford-american-ipa-input.xlsx');
const previewPath = path.join(outputDir, 'oxford-american-ipa-input-preview.png');

const classification = JSON.parse(await fs.readFile(classificationPath, 'utf8'));
const entries = classification.entries
  .filter((entry) => entry.decision === 'review')
  .map((entry, index) => {
    const source = entry.sourceIPA || '';
    const reference = entry.referenceIPA || '';
    let checkType = 'Full-word Oxford check';
    if (!reference) checkType = 'No reference IPA';
    else if (/ˈ[^/]*ə/u.test(source) && reference.includes('ʌ')) checkType = 'Stressed schwa + other differences';
    else if (/ˈ[^/]*ə/u.test(source)) checkType = 'Stressed schwa, different reference vowel';
    return [
      `review-${String(index + 1).padStart(3, '0')}`,
      entry.word,
      source,
      reference,
      '',
      '',
      '',
      checkType
    ];
  });

await fs.mkdir(outputDir, { recursive: true });

const workbook = Workbook.create();
const sheet = workbook.worksheets.add('IPA Input');
sheet.showGridLines = false;

sheet.mergeCells('A1:H1');
sheet.getRange('A1').values = [['Oxford American IPA Input']];
sheet.mergeCells('A2:H2');
sheet.getRange('A2').values = [[
  'Enter only Oxford American IPA. One form: fill Strong IPA. Two forms: fill Strong IPA and Weak IPA. If the word is not valid for this corpus, choose quarantine.'
]];
sheet.mergeCells('A3:H3');
sheet.getRange('A3').values = [[
  'Do not fill IPA and quarantine on the same row. Leave the gray reference columns unchanged; Codex will make the final decisions after you finish.'
]];

sheet.getRange('A4:H4').values = [[
  'Case',
  'Word',
  'Current IPA',
  'Reference IPA (cross-check)',
  'Strong IPA (enter)',
  'Weak IPA (enter if applicable)',
  'Quarantine?',
  'Why flagged'
]];
sheet.getRange(`A5:H${entries.length + 4}`).values = entries;

const title = sheet.getRange('A1:H1');
title.format = {
  fill: '#1F4E78',
  font: { bold: true, color: '#FFFFFF', size: 16 },
  horizontalAlignment: 'center',
  verticalAlignment: 'center'
};
title.format.rowHeight = 30;

for (const range of ['A2:H2', 'A3:H3']) {
  sheet.getRange(range).format = {
    fill: '#EAF2F8',
    font: { color: '#1F2937', size: 10 },
    wrapText: true,
    verticalAlignment: 'center'
  };
}
sheet.getRange('A2:H2').format.rowHeight = 28;
sheet.getRange('A3:H3').format.rowHeight = 24;

const headers = sheet.getRange('A4:H4');
headers.format = {
  fill: '#D9EAF7',
  font: { bold: true, color: '#1F2937', size: 10 },
  wrapText: true,
  horizontalAlignment: 'center',
  verticalAlignment: 'center',
  borders: { preset: 'all', style: 'thin', color: '#A6A6A6' }
};
headers.format.rowHeight = 34;

const body = sheet.getRange(`A5:H${entries.length + 4}`);
body.format = {
  font: { color: '#1F2937', size: 10 },
  verticalAlignment: 'center',
  borders: { preset: 'insideHorizontal', style: 'thin', color: '#E5E7EB' }
};
sheet.getRange(`A5:A${entries.length + 4}`).format = {
  fill: '#F3F4F6',
  font: { color: '#6B7280', size: 9 },
  horizontalAlignment: 'center'
};
sheet.getRange(`C5:D${entries.length + 4}`).format = {
  fill: '#F3F4F6',
  font: { color: '#374151', size: 10 }
};
sheet.getRange(`E5:F${entries.length + 4}`).format = {
  fill: '#FFF2CC',
  font: { color: '#111827', size: 11 }
};
sheet.getRange(`G5:G${entries.length + 4}`).format = {
  fill: '#FCE4D6',
  font: { color: '#7F1D1D', size: 10 },
  horizontalAlignment: 'center'
};
sheet.getRange(`H5:H${entries.length + 4}`).format = {
  fill: '#F8FAFC',
  font: { color: '#4B5563', size: 9 },
  wrapText: true
};

sheet.getRange(`G5:G${entries.length + 4}`).dataValidation = {
  rule: { type: 'list', values: ['', 'quarantine'] }
};

sheet.getRange(`E5:F${entries.length + 4}`).conditionalFormats.add('notContainsBlanks', {
  format: { fill: '#E2F0D9' }
});
sheet.getRange(`G5:G${entries.length + 4}`).conditionalFormats.add('containsText', {
  text: 'quarantine',
  format: { fill: '#F4CCCC', font: { bold: true, color: '#9C0006' } }
});

const table = sheet.tables.add(`A4:H${entries.length + 4}`, true, 'OxfordIPAInputTable');
table.style = 'TableStyleMedium2';
table.showFilterButton = true;

sheet.freezePanes.freezeRows(4);
sheet.freezePanes.freezeColumns(2);

sheet.getRange(`A1:H${entries.length + 4}`).format.wrapText = false;
sheet.getRange('A2:H3').format.wrapText = true;
sheet.getRange(`H5:H${entries.length + 4}`).format.wrapText = true;
sheet.getRange('A:A').format.columnWidth = 13;
sheet.getRange('B:B').format.columnWidth = 18;
sheet.getRange('C:D').format.columnWidth = 25;
sheet.getRange('E:F').format.columnWidth = 27;
sheet.getRange('G:G').format.columnWidth = 14;
sheet.getRange('H:H').format.columnWidth = 34;

const preview = await workbook.render({
  sheetName: 'IPA Input',
  range: 'A1:H16',
  scale: 1.5,
  format: 'png'
});
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);

const inspection = await workbook.inspect({
  kind: 'table',
  range: `IPA Input!A1:H12`,
  include: 'values,formulas',
  tableMaxRows: 12,
  tableMaxCols: 8,
  tableMaxCellChars: 100
});
console.log(JSON.stringify({ outputPath, previewPath, rows: entries.length, inspection: inspection.ndjson }, null, 2));
