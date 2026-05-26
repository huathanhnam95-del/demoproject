/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const WORKBOOK_PATH = path.join(process.cwd(), 'public', 'database', 'SMW', 'SMW', 'SMW.xlsx');
const MANIFEST_PATH = path.join(process.cwd(), 'public', 'database', 'SMW', 'audio', 'manifest.json');
const AUDIO_ROOT = path.join(process.cwd(), 'public', 'database', 'SMW', 'audio');
const ALLOWED_EXPLANATION_TAGS = new Set(['p', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li', 'br', 'h3', 'h4']);

function parseAnswers(answerText) {
  const parts = String(answerText || '').split(/\r?\n-+\r?\n|---\r?\n|\r?\n---/);
  const cleanParts = parts.map(part => part.trim()).filter(Boolean);
  const choicesRaw = cleanParts.length >= 2 ? cleanParts[1] : String(answerText || '').trim();
  const choices = [];

  choicesRaw.split('\n').forEach((line) => {
    const match = line.trim().match(/^\[([xX\s]*)\]\s*(.*)$/);
    if (!match) return;
    choices.push({
      text: match[2].trim(),
      isCorrect: match[1].toLowerCase().includes('x')
    });
  });

  return choices;
}

function collectExplanationHtmlViolations(html) {
  const violations = [];
  const tagPattern = /<\/?\s*([a-zA-Z][\w:-]*)([^>]*)>/g;
  let match;

  while ((match = tagPattern.exec(String(html || ''))) !== null) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    const tail = match[2] || '';
    const isClosingTag = /^<\s*\//.test(fullTag);

    if (!ALLOWED_EXPLANATION_TAGS.has(tagName)) {
      violations.push(`disallowed tag <${tagName}>`);
      continue;
    }

    if (!isClosingTag) {
      const attributeText = tail.replace(/\/\s*$/, '').trim();
      if (attributeText) {
        violations.push(`attributes on <${tagName}>: ${attributeText}`);
      }
    }
  }

  return violations;
}

async function loadQuestions() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(WORKBOOK_PATH);
  const sheet = workbook.worksheets[0];
  const questions = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const id = row.getCell(1).value;
    if (!id) return;

    questions.push({
      id: String(id),
      title: String(row.getCell(2).value || '').trim(),
      choices: parseAnswers(row.getCell(3).value),
      transcript: String(row.getCell(4).value || '').trim(),
      explanation: String(row.getCell(5).value || '').trim()
    });
  });

  return questions;
}

(async () => {
  assert(fs.existsSync(WORKBOOK_PATH), `Expected SMW workbook at ${WORKBOOK_PATH}`);
  assert(fs.existsSync(MANIFEST_PATH), `Expected SMW audio manifest at ${MANIFEST_PATH}`);

  const questions = await loadQuestions();
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const workbookIds = questions.map(question => question.id).sort((a, b) => Number(a) - Number(b));
  const manifestIds = Object.keys(manifest).sort((a, b) => Number(a) - Number(b));

  assert.equal(questions.length, 89, 'SMW workbook should contain 89 questions');
  assert.deepEqual(manifestIds, workbookIds, 'SMW manifest ids should exactly match workbook ids');

  const explanationViolations = [];
  let audioFileCount = 0;

  for (const question of questions) {
    assert(question.title, `Question ${question.id} should have a title`);
    assert(/\[BEEP\]\s*$/i.test(question.transcript), `Question ${question.id} transcript should end with [BEEP]`);
    assert(question.choices.length >= 2, `Question ${question.id} should have at least two choices`);
    assert.equal(
      question.choices.filter(choice => choice.isCorrect).length,
      1,
      `Question ${question.id} should have exactly one correct choice`
    );
    assert(question.explanation.length > 30, `Question ${question.id} should have a detailed explanation`);

    const violations = collectExplanationHtmlViolations(question.explanation);
    if (violations.length) {
      explanationViolations.push(`#${question.id}: ${[...new Set(violations)].join('; ')}`);
    }

    const voices = manifest[question.id];
    assert(Array.isArray(voices), `Question ${question.id} should have a manifest entry`);
    assert.equal(voices.length, 3, `Question ${question.id} should have exactly 3 voice variants`);
    assert.equal(new Set(voices.map(voice => voice.id)).size, 3, `Question ${question.id} should use 3 unique voices`);

    for (const voice of voices) {
      const audioPath = path.join(AUDIO_ROOT, question.id, voice.file || '');
      assert(fs.existsSync(audioPath), `Expected audio file for question ${question.id}: ${voice.file}`);
      assert(fs.statSync(audioPath).size > 1000, `Audio file for question ${question.id} is unexpectedly small: ${voice.file}`);
      audioFileCount++;
    }
  }

  assert.deepEqual(explanationViolations, [], `SMW explanations must use only allowed clean HTML:\n${explanationViolations.join('\n')}`);
  assert.equal(audioFileCount, questions.length * 3, 'SMW should have exactly 3 audio files per workbook question');

  console.log(`SMW data guardrails passed: questions=${questions.length}, audioFiles=${audioFileCount}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
