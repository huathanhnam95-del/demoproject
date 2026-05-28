/* eslint-disable no-console */

const path = require('path');
const ExcelJS = require('exceljs');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const WORKBOOK_PATH = path.join(ROOT_DIR, 'public', 'database', 'HCS', 'HCS', 'HCS.xlsx');
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4:latest';
const ALLOWED_TAGS = new Set(['p', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li', 'br', 'h3', 'h4']);
const POSITION_REFERENCE_RE = /\b((first|second|third|fourth|1st|2nd|3rd|4th)\s+(choice|option|paragraph|summary|distractor|one)|(choice|option|paragraph|summary|distractor)\s*(1|2|3|4|one|two|three|four|first|second|third|fourth))\b/i;

function parseChoices(answerText) {
  const parts = String(answerText || '').split(/\r?\n-+\r?\n|---\r?\n|\r?\n---/).map((part) => part.trim()).filter(Boolean);
  const question = parts.length >= 2 ? parts[0] : '';
  const choicesRaw = parts.length >= 2 ? parts[1] : String(answerText || '').trim();
  const choices = choicesRaw.split(/\r?\n/).map((line) => {
    const match = line.trim().match(/^\[([xX\s]*)\]\s*(.*)$/);
    if (!match) return null;
    return {
      text: match[2].trim(),
      isCorrect: match[1].toLowerCase().includes('x'),
    };
  }).filter(Boolean);

  return { question, choices };
}

function stripHtml(text) {
  return String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function getTags(html) {
  const tags = [];
  const tagRe = /<\/?\s*([a-zA-Z0-9-]+)(?:\s[^>]*)?>/g;
  let match;
  while ((match = tagRe.exec(String(html || ''))) !== null) {
    tags.push(match[1].toLowerCase());
  }
  return tags;
}

function normalizeExplanationHtml(html) {
  return String(html || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/<\/?q>/gi, '"')
    .trim();
}

function validateExplanation(html) {
  const cleanHtml = normalizeExplanationHtml(html);
  const plain = stripHtml(cleanHtml);
  if (plain.length < 450) {
    throw new Error(`Explanation is too short (${plain.length} plain-text characters)`);
  }
  if (POSITION_REFERENCE_RE.test(plain)) {
    throw new Error('Explanation still contains position-dependent choice wording');
  }
  if (/<script|on\w+=|javascript:/i.test(cleanHtml)) {
    throw new Error('Explanation contains unsafe HTML');
  }
  const unsupportedTags = [...new Set(getTags(cleanHtml).filter((tag) => !ALLOWED_TAGS.has(tag)))];
  if (unsupportedTags.length) {
    throw new Error(`Explanation contains unsupported HTML tags: ${unsupportedTags.join(', ')}`);
  }
  if (!/\b(correct summary|best summary|accurate summary)\b/i.test(plain)) {
    throw new Error('Explanation does not clearly identify the correct summary');
  }
  if (!/\b(other summaries|weaker summaries|incorrect summaries|less effective summaries|other alternatives|weaker alternatives|other options|distractors)\b/i.test(plain)) {
    throw new Error('Explanation does not clearly discuss why the other summaries are weaker');
  }
  return cleanHtml;
}

function buildPrompt(row) {
  const correct = row.choices.find((choice) => choice.isCorrect)?.text || '';
  const otherSummaries = row.choices.filter((choice) => !choice.isCorrect).map((choice) => `- ${choice.text}`).join('\n');
  return `Rewrite the PTE Highlight Correct Summary explanation for this item.

Return ONLY the HTML explanation body. Do not wrap it in JSON or markdown.
Use this structure:
<p><strong>Why the correct summary works:</strong> ...</p>
<p><strong>Why the other summaries are weaker:</strong></p>
<ul><li>...</li><li>...</li><li>...</li></ul>

Rules:
- The UI shuffles answer order. Do NOT use positional labels or numbers for choices, including first/second/third/fourth choice, option 1/2/3/4, choice one/two, or distractor 1/2/3.
- Refer to the answer as "the correct summary" and refer to the alternatives by content, not order.
- Explain why the correct summary matches the transcript.
- Include a section or sentence using one of these phrases: "other summaries", "weaker alternatives", or "distractors". Explain why they are weaker, inaccurate, too narrow, too broad, or unsupported.
- Use only these HTML tags: <p>, <strong>, <b>, <em>, <i>, <ul>, <ol>, <li>, <br>, <h3>, <h4>.
- Do not use markdown, tables, scripts, links, attributes, or unsupported tags.
- Aim for 180-320 words.

Question ID: ${row.id}
Title: ${row.title}

Transcript:
${row.transcript}

Correct summary:
${correct}

Other summaries:
${otherSummaries}
`;
}

async function callOllama(prompt) {
  const response = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      prompt,
      options: { temperature: 0.1 },
    }),
  });
  if (!response.ok) {
    throw new Error(`Ollama ${response.status}: ${response.statusText}`);
  }
  const payload = await response.json();
  let text = String(payload.response || '').trim();
  text = text.replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  return { explanation: text };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(WORKBOOK_PATH);
  const worksheet = workbook.worksheets[0];
  const rows = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const id = String(row.getCell(1).value || '').trim();
    if (!id) return;
    const parsed = parseChoices(row.getCell(3).value);
    rows.push({
      rowNumber,
      id,
      title: String(row.getCell(2).value || '').trim(),
      question: parsed.question,
      choices: parsed.choices,
      transcript: String(row.getCell(4).value || '').trim(),
    });
  });

  let rewritten = 0;
  for (const [index, row] of rows.entries()) {
    let lastError = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      console.log(`[${index + 1}/${rows.length}] Q${row.id} ${row.title} attempt ${attempt}`);
      try {
        const payload = await callOllama(buildPrompt(row));
        const explanation = validateExplanation(payload.explanation);
        if (!dryRun) {
          worksheet.getRow(row.rowNumber).getCell(5).value = explanation;
        }
        rewritten += 1;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        console.warn(`  rejected: ${error.message}`);
      }
    }
    if (lastError) {
      throw new Error(`Failed to rewrite Q${row.id}: ${lastError.message}`);
    }
  }

  if (!dryRun) {
    await workbook.xlsx.writeFile(WORKBOOK_PATH);
  }
  console.log(JSON.stringify({ rewritten, dryRun, workbookPath: WORKBOOK_PATH }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
