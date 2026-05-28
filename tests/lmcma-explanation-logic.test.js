/* eslint-disable no-console */

const assert = require('assert');
const path = require('path');
const ExcelJS = require('exceljs');

const WORKBOOK_PATH = path.join(process.cwd(), 'public', 'database', 'LMCMA', 'LMCMA', 'LMCMA.xlsx');

function parseAnswer(answerText) {
  const choices = [];
  String(answerText || '').split(/\r?\n/).forEach((line) => {
    const match = line.trim().match(/^\[([xX\s]*)\]\s*(.*)$/);
    if (!match) return;
    choices.push({
      selected: match[1].toLowerCase().includes('x'),
      text: match[2].trim()
    });
  });
  return choices;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function optionWindow(explanation, choiceText) {
  const cleanExplanation = stripHtml(explanation);
  const needle = choiceText.slice(0, Math.min(40, choiceText.length));
  const index = cleanExplanation.toLowerCase().indexOf(needle.toLowerCase());
  assert(index >= 0, `Expected explanation to mention choice: ${choiceText}`);
  return cleanExplanation.slice(Math.max(0, index - 180), index + choiceText.length + 260);
}

async function loadRowsById(ids) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(WORKBOOK_PATH);
  const sheet = workbook.worksheets[0];
  const rows = new Map();

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const id = String(row.getCell(1).value || '');
    if (!ids.includes(id)) return;
    rows.set(id, {
      rowNumber,
      title: String(row.getCell(2).value || ''),
      choices: parseAnswer(row.getCell(3).value),
      transcript: String(row.getCell(4).value || ''),
      explanation: String(row.getCell(5).value || '')
    });
  });

  for (const id of ids) {
    assert(rows.has(id), `Expected LMCMA row ${id} to exist`);
  }
  return rows;
}

(async () => {
  const rows = await loadRowsById(['42', '112']);

  const row112 = rows.get('112');
  const selected112 = row112.choices.filter((choice) => choice.selected).map((choice) => choice.text);
  assert.deepStrictEqual(selected112, [
    'Bad guys are more likely to borrow money from others.',
    'Nice people are rewarded more because they are very nice.'
  ], 'ID 112 should select only the false statements');
  assert(!selected112.includes('Nice people like to help others, even to their own detriment.'),
    'ID 112 should not select a statement supported by the transcript');

  const helpOthersWindow = optionWindow(
    row112.explanation,
    'Nice people like to help others, even to their own detriment.'
  );
  assert(/true|supported|accurately summarizes/i.test(helpOthersWindow),
    'ID 112 explanation should describe the help-others statement as supported/true');
  assert(!/\(Correct\)|correct answer|statements that are false/i.test(helpOthersWindow),
    'ID 112 explanation should not frame the supported help-others statement as a selected false answer');

  const row42 = rows.get('42');
  const selected42 = row42.choices.filter((choice) => choice.selected).map((choice) => choice.text);
  assert.deepStrictEqual(selected42, [
    'Forestry as a profession',
    'Where foresters work'
  ], 'ID 42 workbook key should preserve both selected answers');
  const whereWindow = optionWindow(row42.explanation, 'Where foresters work');
  assert(/correct|supported|also/i.test(whereWindow),
    'ID 42 explanation should support the selected "Where foresters work" answer');
  assert(!/incorrect|secondary|not the answer/i.test(whereWindow),
    'ID 42 explanation should not contradict the selected "Where foresters work" answer');

  console.log('LMCMA explanation logic guardrails passed.');
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
