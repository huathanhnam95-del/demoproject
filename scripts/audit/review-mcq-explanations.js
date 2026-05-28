/* eslint-disable no-console */

const ExcelJS = require('exceljs');
const path = require('path');

const MODES = [
  {
    mode: 'RMCSA',
    workbook: path.join('public', 'database', 'RMCSA', 'RMCSA', 'RMCSA.xlsx'),
    answerColumn: 3,
    explanationColumn: 4,
    hasPassage: true,
    answerType: 'single'
  },
  {
    mode: 'RMCMA',
    workbook: path.join('public', 'database', 'RMCMA', 'RMCMA', 'RMCMA.xlsx'),
    answerColumn: 3,
    explanationColumn: 4,
    hasPassage: true,
    answerType: 'multi'
  },
  {
    mode: 'LMCSA',
    workbook: path.join('public', 'database', 'LMCSA', 'LMCSA', 'LMCSA.xlsx'),
    answerColumn: 3,
    explanationColumn: 5,
    hasPassage: false,
    answerType: 'single'
  },
  {
    mode: 'LMCMA',
    workbook: path.join('public', 'database', 'LMCMA', 'LMCMA', 'LMCMA.xlsx'),
    answerColumn: 3,
    explanationColumn: 5,
    hasPassage: false,
    answerType: 'multi'
  }
];

const UNSAFE_POSITION_RE = /\b(?:first|second|third|fourth|fifth|last)\s+(?:answer|choice|option)\b|\b(?:Option|Answer|Choice)\s+[A-E]\b/g;
const INVALIDATION_RE = /\b(incorrect|wrong|not supported|not mentioned|does not|is not|isn't|fails|misses|do not select|not selected|not select|contradict|unsupported|too broad|too narrow|not the answer|not choose|irrelevant)\b/i;

function decodeEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'");
}

function stripHtml(value) {
  return decodeEntities(String(value || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForSearch(value) {
  return stripHtml(value)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitAnswer(answerText, hasPassage) {
  const normalized = String(answerText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  let parts = normalized
    .split(/\n\s*-{3,}\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < (hasPassage ? 3 : 2)) {
    parts = normalized
      .split(/-{3,}/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  if (hasPassage) {
    return {
      passage: parts[0] || '',
      question: parts[1] || '',
      choicesRaw: parts.slice(2).join('\n')
    };
  }

  return {
    passage: '',
    question: parts[0] || '',
    choicesRaw: parts.slice(1).join('\n') || normalized
  };
}

function parseChoices(choicesRaw) {
  return String(choicesRaw || '')
    .split(/\n/)
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

function choiceIsMentioned(normalizedExplanation, choiceText) {
  const normalizedChoice = normalizeForSearch(choiceText);
  if (!normalizedChoice) return false;
  if (normalizedExplanation.includes(normalizedChoice)) return true;

  const words = normalizedChoice
    .split(' ')
    .filter((word) => word.length > 2)
    .filter((word) => !['the', 'and', 'for', 'with', 'that', 'this', 'from', 'they', 'were', 'are', 'was'].includes(word));

  if (words.length === 0) return true;
  const hits = words.filter((word) => normalizedExplanation.includes(word)).length;
  return hits >= Math.max(2, Math.ceil(words.length * 0.75));
}

async function auditMode(config) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(config.workbook);
  const worksheet = workbook.worksheets[0];
  const issues = [];
  let rowCount = 0;

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    rowCount += 1;

    const id = String(row.getCell(1).value || '').trim();
    const title = String(row.getCell(2).value || '').trim();
    const answer = String(row.getCell(config.answerColumn).value || '');
    const explanation = String(row.getCell(config.explanationColumn).value || '');
    const parsed = splitAnswer(answer, config.hasPassage);
    const choices = parseChoices(parsed.choicesRaw);
    const correctChoices = choices.filter((choice) => choice.isCorrect);
    const plainExplanation = stripHtml(explanation);
    const normalizedExplanation = normalizeForSearch(explanation);
    const rowIssues = [];

    if (choices.length < 2) {
      rowIssues.push(`parsed only ${choices.length} choices`);
    }
    if (config.answerType === 'single' && correctChoices.length !== 1) {
      rowIssues.push(`expected exactly 1 correct answer, found ${correctChoices.length}`);
    }
    if (config.answerType === 'multi' && correctChoices.length < 1) {
      rowIssues.push('expected at least 1 correct answer');
    }
    if (plainExplanation.length < 200) {
      rowIssues.push(`explanation too short (${plainExplanation.length} chars)`);
    }
    if (/```|<script|on\w+=|javascript:/i.test(explanation)) {
      rowIssues.push('explanation contains unsafe or markdown artifacts');
    }
    if (UNSAFE_POSITION_RE.test(plainExplanation)) {
      rowIssues.push('explanation uses shuffled-choice-unsafe positional wording');
    }
    UNSAFE_POSITION_RE.lastIndex = 0;

    if (correctChoices.some((choice) => !choiceIsMentioned(normalizedExplanation, choice.text))) {
      rowIssues.push('selected answer is not clearly mentioned');
    }
    if (choices.some((choice) => !choiceIsMentioned(normalizedExplanation, choice.text))) {
      rowIssues.push('not every option is clearly mentioned');
    }
    if (!INVALIDATION_RE.test(plainExplanation)) {
      rowIssues.push('incorrect/not-selected option rationale cue missing');
    }

    if (rowIssues.length) {
      issues.push({
        mode: config.mode,
        id,
        title,
        question: parsed.question.slice(0, 160),
        issues: rowIssues
      });
    }
  });

  return { mode: config.mode, rowCount, issueCount: issues.length, issues };
}

(async () => {
  const results = [];
  for (const config of MODES) {
    results.push(await auditMode(config));
  }

  const totalRows = results.reduce((sum, result) => sum + result.rowCount, 0);
  const allIssues = results.flatMap((result) => result.issues);

  for (const result of results) {
    console.log(`${result.mode}: ${result.rowCount} rows checked, ${result.issueCount} issue row(s)`);
  }

  if (allIssues.length) {
    console.log(JSON.stringify(allIssues, null, 2));
    console.error(`MCQ explanation audit failed: ${allIssues.length} issue row(s) across ${totalRows} rows.`);
    process.exit(1);
  }

  console.log(`MCQ explanation audit passed for ${totalRows} rows.`);
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
