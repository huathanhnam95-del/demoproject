/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const ExcelJS = require('exceljs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { VertexAI } = require('@google-cloud/vertexai');
require('dotenv').config();

function parseArgs(argv) {
  const args = {
    inputPath: 'C:\\Cursor AI\\public\\database\\RFIB\\RFIB Final ver.xlsx',
    outputPath: null,
    sheetIndex: 0,
    provider: 'vertex', // vertex | ai-studio
    vertexProject: null,
    vertexLocation: null,
    model: 'auto',
    listModels: false,
    dryRun: false,
    limit: null,
    startRow: 2,
    resume: true,
    rerunEmptyExplanation: false,
    sleepMs: 250,
    saveEvery: 25,
    printFirst: 0,
    printFails: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') {
      args.inputPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--output') {
      args.outputPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--sheet-index') {
      args.sheetIndex = Number(argv[i + 1] || '0');
      i += 1;
      continue;
    }
    if (arg === '--provider') {
      args.provider = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--vertex-project') {
      args.vertexProject = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--vertex-location') {
      args.vertexLocation = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--model') {
      args.model = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--list-models') {
      args.listModels = true;
      continue;
    }
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (arg === '--limit') {
      args.limit = Number(argv[i + 1] || '0');
      i += 1;
      continue;
    }
    if (arg === '--start-row') {
      args.startRow = Number(argv[i + 1] || '2');
      i += 1;
      continue;
    }
    if (arg === '--no-resume') {
      args.resume = false;
      continue;
    }
    if (arg === '--rerun-empty-explanation') {
      args.rerunEmptyExplanation = true;
      continue;
    }
    if (arg === '--sleep-ms') {
      args.sleepMs = Number(argv[i + 1] || '0');
      i += 1;
      continue;
    }
    if (arg === '--save-every') {
      args.saveEvery = Math.max(1, Number(argv[i + 1] || '25'));
      i += 1;
      continue;
    }
    if (arg === '--print-first') {
      args.printFirst = Math.max(0, Number(argv[i + 1] || '0'));
      i += 1;
      continue;
    }
    if (arg === '--print-fails') {
      args.printFails = true;
      continue;
    }
  }

  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAvailableModels(apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ListModels failed: HTTP ${res.status} ${res.statusText} ${text}`.trim());
  }
  const data = await res.json();
  return Array.isArray(data?.models) ? data.models : [];
}

function supportsGenerateContent(model) {
  const methods = model?.supportedGenerationMethods;
  return Array.isArray(methods) && methods.includes('generateContent');
}

function pickMostAdvancedModel(models) {
  const candidates = models
    .filter((m) => m && typeof m.name === 'string' && supportsGenerateContent(m))
    .filter((m) => m.name.startsWith('models/gemini'))
    .filter((m) => !/embedding|imagen|veo|aqa/i.test(m.name))
    .filter((m) => !/native-audio|tts|image/i.test(m.name));

  const byName = new Map(candidates.map((m) => [m.name, m]));
  const preference = [
    'models/gemini-3.1-pro-preview',
    'models/gemini-3-pro-preview',
    'models/gemini-3.1-flash-lite',
    'models/gemini-pro-latest',
    'models/gemini-flash-latest',
    'models/gemini-flash-lite-latest'
  ];
  for (const name of preference) {
    if (byName.has(name)) return name;
  }

  const pro = candidates.filter((m) => /pro/i.test(m.name));
  if (pro.length) return pro[0].name;
  return candidates[0]?.name || null;
}

function nowBackupSuffix() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(
    d.getMinutes()
  )}${pad(d.getSeconds())}`;
}

function normalizeCellValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value && typeof value === 'object') {
    if (value.richText && Array.isArray(value.richText)) {
      return value.richText.map((p) => p.text || '').join('');
    }
    if (value.text) return String(value.text);
  }
  return String(value);
}

function extractBlanks(answerText) {
  const text = normalizeCellValue(answerText);
  if (!text) return [];

  const matches = [...text.matchAll(/__([^_]+?)__/g)];
  return matches.map((m, idx) => {
    const payload = (m[1] || '').trim();
    const options = payload.split('/').map((s) => s.trim());
    const correct = options[0] || '';
    return { index: idx + 1, correct, options };
  });
}

function fillCorrectOptions(answerText) {
  const text = normalizeCellValue(answerText);
  if (!text) return '';

  return text.replace(/__([^_]+?)__/g, (_m, payload) => {
    const options = String(payload || '')
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);
    return options[0] || '';
  });
}

function buildHeaderIndex(worksheet) {
  const headerRow = worksheet.getRow(1);
  const indexByName = {};
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const name = normalizeCellValue(cell.value).trim();
    if (name) indexByName[name] = colNumber;
  });
  return indexByName;
}

function ensureColumn(worksheet, headerIndex, headerName) {
  if (headerIndex[headerName]) return headerIndex[headerName];
  const nextCol = worksheet.columnCount + 1;
  worksheet.getRow(1).getCell(nextCol).value = headerName;
  headerIndex[headerName] = nextCol;
  return nextCol;
}

function truncateForPrompt(text, maxChars) {
  const s = normalizeCellValue(text);
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}\n\n[TRUNCATED: ${s.length - maxChars} chars omitted]`;
}

function buildPrompt({ id, title, passage, blanks, currentLabel, currentDetails }) {
  const rubric = [
    'Cohesion rubric (mark TRUE if ANY correct blank uses cohesion):',
    'A) Grammatical cohesion devices (device is the blank answer itself):',
    '- Reference: personal/possessive/demonstrative pronouns; relative pronouns; articles.',
    '- Conjunction/transition: linking words/phrases that connect clauses/sentences (e.g., however, therefore, in addition to).',
    '- Substitution/ellipsis markers: e.g., one/ones/another/the other, do so/doing so, if not.',
    'B) Lexical cohesion (tie to other words in the same passage):',
    '- Repetition of a meaningful content word.',
    '- Synonym/antonym/hypernym/hyponym tie IN CONTEXT (avoid WordNet/polysemy traps: e.g., "draw" can mean "attract" but in "graffiti drawn" it means "sketched").'
  ].join('\n');

  const blanksBlock = blanks.length
    ? blanks
        .map((b) => {
          const correct = b.correct || '';
          return `- Blank ${b.index}: correct="${correct}"`;
        })
        .join('\n')
    : '(No blanks detected)';

  return [
    'You are auditing an English cohesion tag and its explanation for a fill-in-the-blank question.',
    'Return raw JSON ONLY (no markdown, no commentary).',
    '',
    'Verdict rules (STRICT):',
    '- PASS only if (a) suggested_label matches Current label AND (b) Current details contain NO incorrect cohesion claims (omissions are ok).',
    '- FAIL if (a) suggested_label differs from Current label OR (b) any part of Current details is incorrect/misleading in context (even if the label is correct).',
    '- REVIEW only if you truly cannot decide from the provided passage.',
    '',
    'Required JSON keys:',
    '- verdict: "PASS" | "FAIL" | "REVIEW" (REVIEW only if truly uncertain)',
    '- suggested_label: "TRUE" | "FALSE"',
    '- corrected_explanation: string (MUST be non-empty; cite blank numbers; if suggested_label=FALSE, say why no cohesion applies)',
    '- invalid_reasons: string (brief; empty if none)',
    '- confidence: number (0.0-1.0)',
    '',
    rubric,
    '',
    `ID: ${normalizeCellValue(id)}`,
    `TITLE: ${normalizeCellValue(title)}`,
    `Current label: ${normalizeCellValue(currentLabel)}`,
    `Current details: ${normalizeCellValue(currentDetails)}`,
    '',
    'Blanks (correct answers only):',
    blanksBlock,
    '',
    'Passage:',
    truncateForPrompt(passage, 3500)
  ].join('\n');
}

function extractJsonObject(text) {
  const raw = normalizeCellValue(text);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return match[0];
}

async function generateWithRetry(model, prompt, { maxAttempts = 3, baseDelayMs = 800 } = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      lastErr = err;
      const waitMs = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`⚠️ Gemini call failed (attempt ${attempt}/${maxAttempts}): ${err.message || err}`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

async function main() {
  const args = parseArgs(process.argv);

  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ ERROR: GEMINI_API_KEY is missing (set it in .env or as an environment variable).');
    process.exit(1);
  }

  const availableModels = await fetchAvailableModels(process.env.GEMINI_API_KEY);
  console.log(`Available models from API key (${availableModels.length}):`);
  for (const m of availableModels) console.log(`- ${m.name}`);

  if (args.listModels) return;

  if (!args.model || args.model === 'auto') {
    const selected = pickMostAdvancedModel(availableModels);
    if (!selected) {
      console.error('❌ ERROR: No suitable generateContent Gemini model found for this API key.');
      process.exit(1);
    }
    args.model = selected;
  } else if (!args.model.startsWith('models/')) {
    args.model = `models/${args.model}`;
  }
  console.log(`Using model: ${args.model}`);

  if (!fs.existsSync(args.inputPath)) {
    console.error(`❌ ERROR: Input Excel not found: ${args.inputPath}`);
    process.exit(1);
  }

  const backupSuffix = nowBackupSuffix();
  const inputBase = args.inputPath.replace(/\.xlsx$/i, '');
  const backupPath = `${inputBase}.backup.${backupSuffix}.xlsx`;
  const defaultFallbackOutputPath = `${inputBase}.cohesion_audit.${backupSuffix}.xlsx`;
  let outputPath = args.outputPath || args.inputPath;

  if (!args.dryRun && outputPath === args.inputPath) {
    fs.copyFileSync(args.inputPath, backupPath);
    console.log(`📦 Backup created: ${backupPath}`);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(args.inputPath);
  const worksheet = workbook.worksheets[args.sheetIndex] || workbook.worksheets[0];
  if (!worksheet) {
    console.error('❌ ERROR: No worksheet found in workbook.');
    process.exit(1);
  }

  const headerIndex = buildHeaderIndex(worksheet);
  const required = ['ID', 'TITLE', 'ANSWER', 'Full Text', 'Cohesion Feature', 'Cohesion Feature Details'];
  const missing = required.filter((h) => !headerIndex[h]);
  if (missing.length) {
    console.error(`❌ ERROR: Missing required columns: ${missing.join(', ')}`);
    process.exit(1);
  }

  const colAuditVerdict = ensureColumn(worksheet, headerIndex, 'Cohesion Audit Verdict');
  const colAuditSuggested = ensureColumn(worksheet, headerIndex, 'Cohesion Audit Suggested Label');
  const colAuditExplanation = ensureColumn(worksheet, headerIndex, 'Cohesion Audit Explanation');
  const colAuditInvalid = ensureColumn(worksheet, headerIndex, 'Cohesion Audit Invalid Reasons');
  const colAuditModel = ensureColumn(worksheet, headerIndex, 'Cohesion Audit Model');

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const geminiModel = genAI.getGenerativeModel({
    model: args.model,
    generationConfig: { temperature: 0 }
  });

  const start = args.startRow;
  const end = worksheet.rowCount;
  const limitEnd = args.limit ? Math.min(end, start + args.limit - 1) : end;

  let processed = 0;
  let skipped = 0;
  const verdictCounts = { PASS: 0, FAIL: 0, REVIEW: 0, ERROR: 0 };
  const suggestedCounts = { TRUE: 0, FALSE: 0 };

  for (let r = start; r <= limitEnd; r += 1) {
    const row = worksheet.getRow(r);
    const id = row.getCell(headerIndex.ID).value;
    const title = row.getCell(headerIndex.TITLE).value;
    const answer = row.getCell(headerIndex.ANSWER).value;
    const fullText = row.getCell(headerIndex['Full Text']).value;
    const currentLabel = row.getCell(headerIndex['Cohesion Feature']).value;
    const currentDetails = row.getCell(headerIndex['Cohesion Feature Details']).value;

    const existingVerdict = normalizeCellValue(row.getCell(colAuditVerdict).value).trim();
    if (args.resume && existingVerdict) {
      if (args.rerunEmptyExplanation) {
        const existingExplanation = normalizeCellValue(row.getCell(colAuditExplanation).value).trim();
        const existingSuggested = normalizeCellValue(row.getCell(colAuditSuggested).value).trim();
        if (existingExplanation && (existingSuggested === 'TRUE' || existingSuggested === 'FALSE')) {
          skipped += 1;
          continue;
        }
      } else {
        skipped += 1;
        continue;
      }
    }

    const blanks = extractBlanks(answer);
    const passage = normalizeCellValue(fullText).trim() || fillCorrectOptions(answer);

    const prompt = buildPrompt({
      id,
      title,
      passage,
      blanks,
      currentLabel,
      currentDetails
    });

    let audit = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      const responseText = await generateWithRetry(geminiModel, prompt);
      const jsonString = extractJsonObject(responseText);
      audit = jsonString ? JSON.parse(jsonString) : null;
    } catch (err) {
      audit = {
        verdict: 'ERROR',
        suggested_label: normalizeCellValue(currentLabel).trim() || 'REVIEW',
        corrected_explanation: '',
        invalid_reasons: `Gemini error: ${err.message || err}`,
        confidence: 0
      };
    }

    const verdict = String(audit?.verdict || 'REVIEW').toUpperCase();
    const suggested = String(audit?.suggested_label || '').toUpperCase();
    const correctedExplanation = normalizeCellValue(audit?.corrected_explanation || '').trim();
    const invalidReasons = normalizeCellValue(audit?.invalid_reasons || '').trim();
    const confidence = audit?.confidence;

    verdictCounts[verdict] = (verdictCounts[verdict] || 0) + 1;
    if (suggested === 'TRUE' || suggested === 'FALSE') suggestedCounts[suggested] += 1;

    processed += 1;

    if (
      (args.printFirst > 0 && processed <= args.printFirst) ||
      (args.printFails && verdict !== 'PASS')
    ) {
      const oneLine = (s, n = 220) =>
        normalizeCellValue(s)
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, n);
      console.log(
        `ROW ${r} ID=${oneLine(id, 40)} verdict=${verdict} suggested=${suggested || '-'} conf=${
          typeof confidence === 'number' ? confidence : '-'
        }`
      );
      if (invalidReasons) console.log(`  invalid: ${oneLine(invalidReasons)}`);
      if (correctedExplanation) console.log(`  expl: ${oneLine(correctedExplanation, 320)}`);
    }

    if (!args.dryRun) {
      row.getCell(colAuditVerdict).value = verdict;
      row.getCell(colAuditSuggested).value = suggested || null;
      row.getCell(colAuditExplanation).value = correctedExplanation || null;
      row.getCell(colAuditInvalid).value = invalidReasons || null;
      row.getCell(colAuditModel).value = `${args.model}${typeof confidence === 'number' ? ` (conf=${confidence})` : ''}`;
      row.commit();
    }

    if (processed % 10 === 0) {
      console.log(
        `... row ${r}/${limitEnd} processed=${processed} skipped=${skipped} PASS=${verdictCounts.PASS || 0} FAIL=${
          verdictCounts.FAIL || 0
        } REVIEW=${verdictCounts.REVIEW || 0} ERROR=${verdictCounts.ERROR || 0}`
      );
    }

    if (!args.dryRun && processed % args.saveEvery === 0) {
      // eslint-disable-next-line no-await-in-loop
      try {
        // eslint-disable-next-line no-await-in-loop
        await workbook.xlsx.writeFile(outputPath);
        console.log(`💾 Saved progress at row ${r} -> ${outputPath}`);
      } catch (err) {
        const isLocked = err && (err.code === 'EBUSY' || err.code === 'EPERM');
        if (!isLocked) throw err;
        outputPath = defaultFallbackOutputPath;
        console.warn(`⚠️ Output file is locked. Switching output to: ${outputPath}`);
        // eslint-disable-next-line no-await-in-loop
        await workbook.xlsx.writeFile(outputPath);
        console.log(`💾 Saved progress at row ${r} -> ${outputPath}`);
      }
    }

    if (args.sleepMs > 0) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(args.sleepMs);
    }
  }

  console.log('--- SUMMARY ---');
  console.log(`Input: ${args.inputPath}`);
  console.log(`Model: ${args.model}`);
  console.log(`Dry-run: ${args.dryRun ? 'YES' : 'NO'}`);
  console.log(`Processed: ${processed}`);
  console.log(`Skipped (resume): ${skipped}`);
  console.log('Verdicts:', verdictCounts);
  console.log('Suggested labels:', suggestedCounts);

  if (!args.dryRun) {
    try {
      await workbook.xlsx.writeFile(outputPath);
      console.log(`✅ Done writing audit columns -> ${outputPath}`);
    } catch (err) {
      const isLocked = err && (err.code === 'EBUSY' || err.code === 'EPERM');
      if (!isLocked) throw err;
      outputPath = defaultFallbackOutputPath;
      console.warn(`⚠️ Output file is locked. Writing to: ${outputPath}`);
      await workbook.xlsx.writeFile(outputPath);
      console.log(`✅ Done writing audit columns -> ${outputPath}`);
    }
  }
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
