const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { buildQuestionRecord } = require('./dd-dataset-core');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const WORKBOOK_PATH = path.join(PROJECT_ROOT, 'public', 'database', 'DD', 'DD', 'D&D.xlsx');
const OUTPUT_QUESTIONS_PATH = path.join(PROJECT_ROOT, 'public', 'database', 'DD', 'dd-questions.json');
const OUTPUT_REPORT_PATH = path.join(PROJECT_ROOT, 'public', 'database', 'DD', 'dd-dataset-report.json');

function normalizeCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(normalizeCell).join('');
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => normalizeCell(part?.text || '')).join('');
    }
    if (typeof value.text === 'string') return value.text.trim();
  }
  return String(value).trim();
}

async function build() {
  console.log(`Reading workbook from: ${WORKBOOK_PATH}`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(WORKBOOK_PATH);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('Workbook has no worksheets.');
  }

  const headers = [];
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    headers[columnNumber - 1] = normalizeCell(cell.value);
  });

  console.log('Headers found:', headers);

  const rawRows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const entry = {};
    headers.forEach((header, index) => {
      if (!header) return;
      entry[header] = row.getCell(index + 1).value;
    });
    rawRows.push({ entry, rowNumber });
  });

  console.log(`Total data rows read: ${rawRows.length}`);

  const questions = [];
  const report = {
    totalRows: rawRows.length,
    usableRows: 0,
    skippedRows: [],
    warningsDistribution: {},
    blankCountDistribution: {},
    optionCountDistribution: {}
  };

  for (const { entry, rowNumber } of rawRows) {
    const idVal = entry['ID'] || entry['id'] || entry['Question ID'];
    const titleVal = entry['TITLE'] || entry['Title'] || entry['title'];
    const answerCellVal = entry['ANSWER'] || entry['Answer'] || entry['answer'];
    const compareTextVal = entry['ANSWER FOR COMPARE OR TRANSCRIPT'] || entry['Compare Text'] || entry['compare_text'];

    if (!idVal && !answerCellVal) {
      continue;
    }

    const idRaw = normalizeCell(idVal);
    const id = parseInt(idRaw, 10);

    if (isNaN(id)) {
      report.skippedRows.push({
        rowNumber,
        id: idRaw,
        reason: 'Invalid or missing ID'
      });
      continue;
    }

    const title = normalizeCell(titleVal) || `Question #${id}`;
    const answerCell = normalizeCell(answerCellVal);
    const compareText = normalizeCell(compareTextVal);

    const record = buildQuestionRecord({
      id,
      title,
      sourceRow: rowNumber,
      answerCell,
      compareText
    });

    if (!record.validation.isUsable) {
      report.skippedRows.push({
        rowNumber,
        id,
        title,
        reason: 'Validation failed (e.g. no blanks)',
        warnings: record.validation.warnings
      });
      continue;
    }

    questions.push(record);

    const blanksCount = record.blanks.length;
    const optionsCount = record.options.length;
    report.blankCountDistribution[blanksCount] = (report.blankCountDistribution[blanksCount] || 0) + 1;
    report.optionCountDistribution[optionsCount] = (report.optionCountDistribution[optionsCount] || 0) + 1;

    record.validation.warnings.forEach(w => {
      report.warningsDistribution[w] = (report.warningsDistribution[w] || 0) + 1;
    });
  }

  questions.sort((a, b) => a.id - b.id);
  report.usableRows = questions.length;

  console.log(`Usable questions: ${questions.length}`);
  console.log(`Skipped rows: ${report.skippedRows.length}`);

  fs.mkdirSync(path.dirname(OUTPUT_QUESTIONS_PATH), { recursive: true });

  fs.writeFileSync(OUTPUT_QUESTIONS_PATH, JSON.stringify(questions, null, 2), 'utf8');
  fs.writeFileSync(OUTPUT_REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

  console.log(`Questions written to ${OUTPUT_QUESTIONS_PATH}`);
  console.log(`Report written to ${OUTPUT_REPORT_PATH}`);
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
