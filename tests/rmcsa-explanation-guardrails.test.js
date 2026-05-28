/* eslint-disable no-console */

const assert = require('assert');
const path = require('path');
const ExcelJS = require('exceljs');

const WORKBOOK_PATH = path.join(__dirname, '..', 'public', 'database', 'RMCSA', 'RMCSA', 'RMCSA.xlsx');
const ALLOWED_TAGS = new Set(['p', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li', 'br', 'h3', 'h4']);

function stripHtml(value) {
  return decodeHtmlEntities(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value) {
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  };
  return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, body) => {
    const key = body.toLowerCase();
    if (key.startsWith('#x')) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
    if (key.startsWith('#')) return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
    return Object.prototype.hasOwnProperty.call(named, key) ? named[key] : entity;
  });
}

function parseAnswers(answerText) {
  const parts = String(answerText || '')
    .split(/\r?\n\s*-+\s*\r?\n|---\s*\r?\n|\r?\n\s*---/)
    .map((part) => part.trim())
    .filter(Boolean);

  const choicesRaw = parts.length >= 3 ? parts.slice(2).join('\n') : '';
  return choicesRaw
    .split(/\r?\n/)
    .map((line) => {
      const match = line.trim().match(/^\[([xX\s]*)\]\s*(.*)$/);
      if (!match) return null;
      return {
        text: match[2].trim(),
        isCorrect: match[1].toLowerCase().includes('x')
      };
    })
    .filter(Boolean);
}

function getUnsupportedTags(html) {
  const unsupported = new Set();
  const tagRe = /<\/?\s*([a-zA-Z0-9-]+)(?:\s[^>]*)?>/g;
  let match;
  while ((match = tagRe.exec(String(html || ''))) !== null) {
    const tagName = match[1].toLowerCase();
    if (!ALLOWED_TAGS.has(tagName)) unsupported.add(tagName);
  }
  return [...unsupported];
}

(async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(WORKBOOK_PATH);
  const worksheet = workbook.worksheets[0];
  const failures = [];
  let rowCount = 0;

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    rowCount += 1;

    const id = row.getCell(1).value;
    const title = String(row.getCell(2).value || '').trim();
    const choices = parseAnswers(row.getCell(3).value);
    const explanation = String(row.getCell(4).value || '').trim();
    const plainExplanation = stripHtml(explanation);
    const correctChoices = choices.filter((choice) => choice.isCorrect);
    const unsupportedTags = getUnsupportedTags(explanation);

    if (choices.length < 2) {
      failures.push(`Q${id} ${title}: expected at least 2 parsed choices, found ${choices.length}`);
    }
    if (correctChoices.length !== 1) {
      failures.push(`Q${id} ${title}: expected exactly 1 correct choice, found ${correctChoices.length}`);
    }
    if (plainExplanation.length < 200) {
      failures.push(`Q${id} ${title}: explanation is missing or too short (${plainExplanation.length} chars)`);
    }
    if (unsupportedTags.length) {
      failures.push(`Q${id} ${title}: unsupported explanation tags: ${unsupportedTags.join(', ')}`);
    }
    if (/```|<script|on\w+=|javascript:/i.test(explanation)) {
      failures.push(`Q${id} ${title}: explanation contains unsafe or markdown artifacts`);
    }
    for (const correctChoice of correctChoices) {
      if (!plainExplanation.toLowerCase().includes(correctChoice.text.toLowerCase())) {
        failures.push(`Q${id} ${title}: explanation does not mention correct answer "${correctChoice.text}"`);
      }
    }
    if (!/\b(incorrect|wrong|not supported|not mentioned|does not|isn't|fails|misses)\b/i.test(plainExplanation)) {
      failures.push(`Q${id} ${title}: explanation does not clearly address incorrect options`);
    }
  });

  assert(rowCount > 0, 'Expected RMCSA workbook to contain data rows');
  assert.deepEqual(failures, []);
  console.log(`RMCSA explanation guardrails passed for ${rowCount} rows.`);
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
