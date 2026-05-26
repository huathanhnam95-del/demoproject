const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Excel = require('exceljs');

const rootDir = path.resolve(__dirname, '..');
const EXCEL_PATH = path.join(rootDir, 'public', 'database', 'Highlight Incorrect Words', 'HIW', 'HIW.xlsx');
const AUDIO_DIR = path.join(rootDir, 'public', 'database', 'Highlight Incorrect Words', 'audio');
const MANIFEST_PATH = path.join(AUDIO_DIR, 'manifest.json');

async function runTests() {
  console.log('=== Running HIW Data Guardrails Tests ===');

  // 1. Check Excel existence
  assert(fs.existsSync(EXCEL_PATH), `Excel file not found at: ${EXCEL_PATH}`);
  console.log('PASS: Excel file existence verified.');

  // 2. Read and verify Excel structure
  const workbook = new Excel.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);
  const worksheet = workbook.getWorksheet(1);
  assert(worksheet, 'Sheet 1 not found in workbook');

  const headers = worksheet.getRow(1).values.filter(Boolean);
  const expectedHeaders = ['ID', 'TITLE', 'ANSWER', 'ANSWER FOR COMPARE OR TRANSCRIPT', 'EXPLANATION'];
  
  for (const expected of expectedHeaders) {
    assert(headers.includes(expected), `Header "${expected}" is missing. Found headers: [${headers.join(', ')}]`);
  }
  console.log('PASS: Excel headers structure verified.');

  // 3. Verify question 1 & 2 content
  const q1Row = worksheet.getRow(2);
  const q2Row = worksheet.getRow(3);

  const q1_id = q1Row.getCell(1).value;
  const q1_title = q1Row.getCell(2).value;
  const q1_answer = q1Row.getCell(3).value;
  const q1_compare = q1Row.getCell(4).value;
  const q1_explanation = q1Row.getCell(5).value;

  assert.equal(String(q1_id), '1', 'Question 1 ID mismatch');
  assert(q1_title, 'Question 1 Title is missing');
  assert(q1_answer && q1_answer.includes('__'), 'Question 1 ANSWER lacks incorrect-correct markdown (__incorrect/correct__)');
  assert(q1_compare && !q1_compare.includes('__'), 'Question 1 Column D (compare transcript) contains raw markdown');
  assert(q1_explanation && q1_explanation.length > 20, 'Question 1 explanation is missing or too short');
  console.log('PASS: Question 1 fields and Column D/E formatting verified.');

  const q2_id = q2Row.getCell(1).value;
  const q2_title = q2Row.getCell(2).value;
  const q2_answer = q2Row.getCell(3).value;
  const q2_compare = q2Row.getCell(4).value;
  const q2_explanation = q2Row.getCell(5).value;

  assert.equal(String(q2_id), '2', 'Question 2 ID mismatch');
  assert(q2_title, 'Question 2 Title is missing');
  assert(q2_answer && q2_answer.includes('__'), 'Question 2 ANSWER lacks incorrect-correct markdown');
  assert(q2_compare && !q2_compare.includes('__'), 'Question 2 Column D contains raw markdown');
  assert(q2_explanation && q2_explanation.length > 20, 'Question 2 explanation is missing or too short');
  console.log('PASS: Question 2 fields and Column D/E formatting verified.');

  // 4. Check Manifest and generated Audio files
  assert(fs.existsSync(MANIFEST_PATH), `Manifest file not found at: ${MANIFEST_PATH}`);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  console.log('PASS: Audio manifest existence verified.');

  const testIds = ['1', '2'];
  for (const qId of testIds) {
    const voices = manifest[qId];
    assert(voices && voices.length === 3, `Question ${qId} must have exactly 3 voices in the manifest`);
    
    for (const voice of voices) {
      assert(voice.id && voice.name && voice.gender && voice.accent && voice.file, `Invalid voice metadata in manifest for Q${qId}`);
      const audioFilepath = path.join(AUDIO_DIR, qId, voice.file);
      assert(fs.existsSync(audioFilepath), `Audio file missing: ${audioFilepath}`);
    }
  }
  console.log('PASS: Test audio files (Q1, Q2) successfully matched manifest entries and verified on disk.');

  console.log('\nALL GUARDRAIL TESTS PASSED!');
}

runTests().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
