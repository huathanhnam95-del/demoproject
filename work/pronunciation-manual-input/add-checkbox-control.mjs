import fs from 'node:fs/promises';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const sourcePath = 'C:/Cursor AI/outputs/pronunciation-manual-input-20260729/oxford-american-ipa-input.xlsx';
const workbookPath = 'C:/Cursor AI/outputs/pronunciation-manual-input-20260729/oxford-american-ipa-input-yes-no.xlsx';
const input = await FileBlob.load(sourcePath);
const workbook = await SpreadsheetFile.importXlsx(input);
const sheet = workbook.worksheets.getItem('IPA Input');
const quarantineRange = sheet.getRange('G5:G367');
const currentValues = quarantineRange.values;

const checkboxValues = currentValues.map(([value]) => {
  if (String(value || '').toLowerCase() === 'quarantine' || value === '☑' || value === 'yes') return ['Yes'];
  return ['No'];
});
quarantineRange.values = checkboxValues;
quarantineRange.dataValidation = {
  rule: { type: 'list', values: ['No', 'Yes'] }
};
quarantineRange.format = {
  fill: '#FFF2CC',
  font: { color: '#7F1D1D', size: 11 },
  horizontalAlignment: 'center',
  verticalAlignment: 'center'
};
quarantineRange.conditionalFormats.deleteAll();
quarantineRange.conditionalFormats.add('containsText', {
  text: 'Yes',
  format: { fill: '#F4CCCC', font: { bold: true, color: '#9C0006', size: 11 } }
});

sheet.getRange('A2').values = [[
  'Enter only Oxford American IPA. One form: fill Strong IPA. Two forms: fill Strong IPA and Weak IPA. If the word is not valid for this corpus, select Yes in Quarantine?.'
]];
sheet.getRange('A3').values = [[
  'Leave No for normal cases. Select Yes for quarantine using the cell dropdown arrow. Do not fill IPA and select Yes on the same row; Codex will make the final decisions after you finish.'
]];

const preview = await workbook.render({ sheetName: 'IPA Input', range: 'A1:H16', scale: 1.5, format: 'png' });
await fs.writeFile('C:/Cursor AI/outputs/pronunciation-manual-input-20260729/oxford-american-ipa-input-checkbox-preview.png', new Uint8Array(await preview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(workbookPath);

const check = await workbook.inspect({
  kind: 'table',
  range: 'IPA Input!E4:G8',
  include: 'values,formulas',
  tableMaxRows: 5,
  tableMaxCols: 3
});
console.log(JSON.stringify({ workbookPath, checkboxValues: check.ndjson }, null, 2));
