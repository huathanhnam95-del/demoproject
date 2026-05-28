/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const WORKBOOK_PATH = path.join(ROOT_DIR, 'public', 'database', 'HCS', 'HCS', 'HCS.xlsx');
const OUTPUT_DIR = path.join(ROOT_DIR, 'docs', 'audits');
const JSON_PATH = path.join(OUTPUT_DIR, 'hcs-explanation-review.json');
const XLSX_PATH = path.join(OUTPUT_DIR, 'hcs-explanation-review.xlsx');
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

function deterministicReview(row) {
  const issues = [];
  const explanation = row.explanation;
  const plain = stripHtml(explanation);
  const tags = getTags(explanation);
  const unsupportedTags = [...new Set(tags.filter((tag) => !ALLOWED_TAGS.has(tag)))];

  if (plain.length < 200) {
    issues.push({ severity: 'high', type: 'too_short', message: `Explanation is only ${plain.length} plain-text characters.` });
  }
  if (row.choices.length !== 4) {
    issues.push({ severity: 'high', type: 'choice_count', message: `Expected 4 choices, found ${row.choices.length}.` });
  }
  if (row.choices.filter((choice) => choice.isCorrect).length !== 1) {
    issues.push({ severity: 'high', type: 'correct_key_count', message: 'Expected exactly 1 correct choice.' });
  }
  if (unsupportedTags.length) {
    issues.push({ severity: 'high', type: 'unsupported_html', message: `Unsupported HTML tags: ${unsupportedTags.join(', ')}.` });
  }
  if (/<script|on\w+=|javascript:/i.test(explanation)) {
    issues.push({ severity: 'high', type: 'unsafe_html', message: 'Explanation contains script/event-handler-like HTML.' });
  }
  if (/```|^\s*[-*]\s+/m.test(explanation)) {
    issues.push({ severity: 'medium', type: 'markdown_artifact', message: 'Explanation contains markdown-style formatting artifacts.' });
  }
  if (POSITION_REFERENCE_RE.test(plain)) {
    issues.push({
      severity: 'high',
      type: 'position_dependent_reference',
      message: 'Explanation refers to a numbered choice/option, but HCS choices are shuffled in the UI.',
    });
  }
  if (!/\b(correct|accurate|main argument|central|summary)\b/i.test(plain)) {
    issues.push({ severity: 'medium', type: 'missing_correct_rationale', message: 'Explanation may not clearly justify the correct summary.' });
  }
  if (!/\b(incorrect|distractor|wrong|misses|misrepresents|too broad|too narrow|not supported)\b/i.test(plain)) {
    issues.push({ severity: 'medium', type: 'missing_distractor_rationale', message: 'Explanation may not clearly address why distractors are wrong.' });
  }

  return { issues, plain };
}

function buildPrompt(row) {
  const correct = row.choices.find((choice) => choice.isCorrect)?.text || '';
  const distractors = row.choices.filter((choice) => !choice.isCorrect).map((choice, index) => `${index + 1}. ${choice.text}`).join('\n');
  return `Review this PTE Highlight Correct Summary explanation for factual alignment and learner usefulness.

Return ONLY valid JSON:
{
  "semanticStatus": "pass" | "needs_revision",
  "semanticIssues": [{"severity":"high|medium|low","message":"..."}],
  "notes": "one concise sentence"
}

Rules:
- Judge the explanation against the transcript and answer choices.
- The UI shuffles answer order, so any explanation relying on first/second/third/fourth choice positions needs revision.
- Do not require exact transcript quotes; paraphrase is acceptable if faithful.
- Mark needs_revision if the explanation endorses a claim not supported by the transcript, fails to justify the correct summary, or gives misleading rationale.

Question ID: ${row.id}
Title: ${row.title}

Transcript:
${row.transcript}

Correct summary:
${correct}

Distractors:
${distractors}

Existing explanation:
${stripHtml(row.explanation)}
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
      options: { temperature: 0 },
    }),
  });
  if (!response.ok) {
    throw new Error(`Ollama ${response.status}: ${response.statusText}`);
  }
  const payload = await response.json();
  let text = String(payload.response || '').trim();
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(text);
}

async function readRows() {
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
      id,
      title: String(row.getCell(2).value || '').trim(),
      question: parsed.question,
      choices: parsed.choices,
      transcript: String(row.getCell(4).value || '').trim(),
      explanation: String(row.getCell(5).value || '').trim(),
    });
  });

  return rows;
}

async function writeWorkbook(results) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('HCS Explanation Review');
  worksheet.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Title', key: 'title', width: 28 },
    { header: 'Status', key: 'status', width: 18 },
    { header: 'Issue Count', key: 'issueCount', width: 12 },
    { header: 'High Issues', key: 'highIssues', width: 12 },
    { header: 'Medium Issues', key: 'mediumIssues', width: 14 },
    { header: 'Issue Types', key: 'issueTypes', width: 38 },
    { header: 'Notes', key: 'notes', width: 70 },
  ];

  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const result of results) {
    worksheet.addRow({
      id: result.id,
      title: result.title,
      status: result.status,
      issueCount: result.issues.length,
      highIssues: result.issues.filter((issue) => issue.severity === 'high').length,
      mediumIssues: result.issues.filter((issue) => issue.severity === 'medium').length,
      issueTypes: [...new Set(result.issues.map((issue) => issue.type))].join(', '),
      notes: result.issues.map((issue) => `[${issue.severity}] ${issue.message}`).join(' | '),
    });
  }

  worksheet.eachRow((row) => {
    row.alignment = { vertical: 'top', wrapText: true };
  });

  await workbook.xlsx.writeFile(XLSX_PATH);
}

async function main() {
  const useOllama = process.argv.includes('--ollama');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const rows = await readRows();
  const results = [];

  for (const [index, row] of rows.entries()) {
    const deterministic = deterministicReview(row);
    let semantic = null;
    if (useOllama) {
      console.log(`[${index + 1}/${rows.length}] Reviewing Q${row.id} ${row.title}`);
      try {
        semantic = await callOllama(buildPrompt(row));
      } catch (error) {
        semantic = {
          semanticStatus: 'needs_revision',
          semanticIssues: [{ severity: 'medium', message: `Semantic review failed: ${error.message}` }],
          notes: 'Semantic review failed.',
        };
      }
    }

    const semanticIssues = (semantic?.semanticIssues || []).map((issue) => ({
      severity: issue.severity || 'medium',
      type: 'semantic_review',
      message: issue.message || 'Semantic review flagged this row.',
    }));
    const issues = [...deterministic.issues, ...semanticIssues];
    const status = issues.some((issue) => issue.severity === 'high') ||
      semantic?.semanticStatus === 'needs_revision' ? 'needs_revision' : 'pass';

    results.push({
      id: row.id,
      title: row.title,
      status,
      issues,
      semanticStatus: semantic?.semanticStatus || 'not_run',
      semanticNotes: semantic?.notes || '',
      explanationPlainLength: deterministic.plain.length,
    });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    workbookPath: WORKBOOK_PATH,
    rowCount: results.length,
    statusCounts: results.reduce((acc, result) => {
      acc[result.status] = (acc[result.status] || 0) + 1;
      return acc;
    }, {}),
    issueCounts: results.flatMap((result) => result.issues).reduce((acc, issue) => {
      acc[issue.type] = (acc[issue.type] || 0) + 1;
      return acc;
    }, {}),
    results,
  };

  fs.writeFileSync(JSON_PATH, `${JSON.stringify(summary, null, 2)}\n`);
  await writeWorkbook(results);
  console.log(JSON.stringify({
    rowCount: summary.rowCount,
    statusCounts: summary.statusCounts,
    issueCounts: summary.issueCounts,
    jsonPath: JSON_PATH,
    xlsxPath: XLSX_PATH,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
