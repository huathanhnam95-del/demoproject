import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const root = process.cwd();
const workbookPath = process.argv[2] ?? path.join(root, 'outputs', 'pronunciation-review-pilot-20260729', 'pronunciation-review-pilot.xlsx');
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
const sheet = workbook.worksheets.getItem('Review Pilot');
const values = sheet.getRange('A3:K29').values;
console.log(JSON.stringify({ workbookPath, rows: values }, null, 2));
