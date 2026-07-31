/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const ExcelJS = require('exceljs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');

const PROJECT_ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const WORKBOOK_PATH = path.join(PROJECT_ROOT, 'public', 'database', 'RA', 'RA.xlsx');
const TEMP_WORKBOOK_PATH = path.join(PROJECT_ROOT, 'public', 'database', 'RA', 'RA.chunking.tmp.xlsx');
const BACKUP_WORKBOOK_PATH = path.join(PROJECT_ROOT, 'public', 'database', 'RA', 'RA.pre-chunking.backup.xlsx');
const CHECKPOINT_PATH = path.join(PROJECT_ROOT, 'scripts', 'read-aloud-chunking-checkpoint.json');
const VALIDATION_REPORT_PATH = path.join(PROJECT_ROOT, 'scripts', 'read-aloud-chunking-validation.json');
const DIFF_REPORT_PATH = path.join(PROJECT_ROOT, 'scripts', 'read-aloud-chunking-diff.json');

const MODEL_NAME = 'gemini-3.1-flash-lite';
const REQUIRED_HEADERS = ['ID', 'TITLE', 'ANSWER', 'ANSWER FOR COMPARE OR TRANSCRIPT', 'Word count'];
const FINAL_HEADERS = [...REQUIRED_HEADERS, 'ANSWER CHUNKED'];
const BATCH_SIZE = 20;
const CONCURRENT_REQUESTS = 8;
const MAX_ATTEMPTS = 3;

async function loadGrammar() {
  await import(pathToFileURL(path.join(PROJECT_ROOT, 'public', 'js', 'read-aloud-prompt-grammar.js')).href);
  if (!globalThis.ReadAloudPromptGrammar) {
    throw new Error('Failed to load shared Read Aloud prompt grammar.');
  }
  return globalThis.ReadAloudPromptGrammar;
}

function parseArgs(argv) {
  const args = { validateOnly: false, dryRunGenerate: false, limit: null, resume: true };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--validate-only') {
      args.validateOnly = true;
    } else if (arg === '--dry-run-generate') {
      args.dryRunGenerate = true;
    } else if (arg === '--no-resume') {
      args.resume = false;
    } else if (arg === '--limit') {
      const next = Number(argv[index + 1]);
      if (!Number.isFinite(next) || next <= 0) {
        throw new Error('`--limit` requires a positive integer.');
      }
      args.limit = next;
      index += 1;
    }
  }
  return args;
}

async function loadWorkbookRows(workbookPath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('Read Aloud workbook has no worksheets.');
  }

  const headerRow = worksheet.getRow(1);
  const headers = headerRow.values.slice(1).map((value) => String(value || '').trim());
  const headerIndex = new Map();
  headers.forEach((header, index) => {
    if (!header) return;
    if (headerIndex.has(header)) {
      throw new Error(`Duplicate workbook header found: ${header}`);
    }
    headerIndex.set(header, index + 1);
  });

  REQUIRED_HEADERS.forEach((header, index) => {
    if (headers[index] !== header) {
      throw new Error(`Workbook header mismatch at column ${index + 1}: expected "${header}", got "${headers[index] || ''}"`);
    }
  });

  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const entry = {};
    headers.forEach((header, index) => {
      entry[header] = row.getCell(index + 1).value;
    });
    rows.push(entry);
  });

  return { workbook, worksheet, headers, rows };
}

function ensureFinalHeaderOrder(worksheet, headers) {
  const currentHeaders = headers.slice();
  if (currentHeaders.length === REQUIRED_HEADERS.length) {
    worksheet.getCell(1, FINAL_HEADERS.length).value = 'ANSWER CHUNKED';
    return FINAL_HEADERS;
  }

  if (currentHeaders.length !== FINAL_HEADERS.length) {
    throw new Error(`Unexpected workbook width: expected ${REQUIRED_HEADERS.length} or ${FINAL_HEADERS.length} columns, found ${currentHeaders.length}.`);
  }

  FINAL_HEADERS.forEach((header, index) => {
    if ((currentHeaders[index] || '') !== header) {
      throw new Error(`Workbook header mismatch at column ${index + 1}: expected "${header}", got "${currentHeaders[index] || ''}"`);
    }
  });
  return currentHeaders;
}

function normalizeCell(value) {
  if (value == null) return '';
  if (typeof value === 'object' && value.richText) {
    return value.richText.map((part) => part.text || '').join('');
  }
  return String(value).trim();
}

function getCheckpoint() {
  if (!fs.existsSync(CHECKPOINT_PATH)) return { completedIds: [] };
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8'));
  } catch (_) {
    return { completedIds: [] };
  }
}

function saveCheckpoint(completedIds) {
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify({ completedIds: Array.from(completedIds) }, null, 2));
}

function countChunkMarkers(grammar, text) {
  const tokens = grammar.tokenizePrompt(text || '', { allowChunkMarkers: true });
  return tokens.filter((token) => token.type === 'chunk_short' || token.type === 'chunk_long').length;
}

function buildBoundarySet(grammar, text) {
  const tokens = grammar.tokenizePrompt(text || '', { allowChunkMarkers: true });
  return grammar.buildSpokenBoundaryKeys(tokens).blockedBoundarySet;
}

function symmetricDifferenceSize(leftSet, rightSet) {
  let count = 0;
  leftSet.forEach((value) => {
    if (!rightSet.has(value)) count += 1;
  });
  rightSet.forEach((value) => {
    if (!leftSet.has(value)) count += 1;
  });
  return count;
}

function buildQualityReports(grammar, rows) {
  const reportRows = rows.map((row) => {
    const plainText = normalizeCell(row['ANSWER FOR COMPARE OR TRANSCRIPT']);
    const legacyChunked = normalizeCell(row.ANSWER);
    const chunked = normalizeCell(row['ANSWER CHUNKED']);
    const plainWordCount = grammar.tokenizePrompt(plainText, { allowChunkMarkers: false }).filter((token) => token.type === 'spoken').length;
    const chunkCount = countChunkMarkers(grammar, chunked);
    const legacyBoundarySet = buildBoundarySet(grammar, legacyChunked);
    const newBoundarySet = buildBoundarySet(grammar, chunked);
    return {
      id: normalizeCell(row.ID),
      plainWordCount,
      chunkCount,
      hasLongPause: chunked.includes('//'),
      zeroMarkers: chunkCount === 0,
      highDensity: plainWordCount > 0 ? (chunkCount / plainWordCount) > 0.35 : false,
      driftFromLegacy: symmetricDifferenceSize(legacyBoundarySet, newBoundarySet),
      containsComplexToken: /Ph\.D\.|[A-Za-z]{1,3}\.(?:[A-Za-z]{1,3}\.)+|\d+\.\d+|\d{1,2}:\d{2}|["“”()]/.test(plainText)
    };
  });

  const highDriftRows = reportRows
    .filter((row) => row.driftFromLegacy > 0)
    .sort((left, right) => right.driftFromLegacy - left.driftFromLegacy)
    .slice(0, 50);

  return {
    summary: {
      totalRows: reportRows.length,
      zeroMarkerRows: reportRows.filter((row) => row.zeroMarkers && row.plainWordCount >= 8).length,
      oneMarkerRows: reportRows.filter((row) => row.chunkCount === 1).length,
      highDensityRows: reportRows.filter((row) => row.highDensity).length,
      rowsWithLongPause: reportRows.filter((row) => row.hasLongPause).length,
      averageChunkCount: reportRows.length
        ? Number((reportRows.reduce((sum, row) => sum + row.chunkCount, 0) / reportRows.length).toFixed(2))
        : 0,
      changedRowsVsLegacy: reportRows.filter((row) => row.driftFromLegacy > 0).length
    },
    reviewBuckets: {
      highDriftRows,
      zeroMarkerLongRows: reportRows.filter((row) => row.zeroMarkers && row.plainWordCount >= 8),
      highDensityRows: reportRows.filter((row) => row.highDensity),
      complexTokenRows: reportRows.filter((row) => row.containsComplexToken)
    }
  };
}

function validateChunkedRow(grammar, row) {
  const plainText = normalizeCell(row['ANSWER FOR COMPARE OR TRANSCRIPT']);
  const chunkedText = normalizeCell(row['ANSWER CHUNKED']);
  return grammar.validateChunkedPrompt(plainText, chunkedText);
}

function buildPrompt(id, plainText, failureHint = '', legacyChunkedHint = '') {
  const lines = [
    'Insert semantic chunk markers into this Read Aloud prompt.',
    'Rules:',
    '1. Preserve every word and every punctuation mark exactly.',
    '2. Only add ` / ` and ` // ` as chunk markers.',
    '3. Use ` / ` for a short phrase break and ` // ` for a stronger clause or sentence break.',
    '4. Do not rewrite, paraphrase, fix capitalization, or remove punctuation.',
    '5. Never place a chunk marker immediately before punctuation. Keep commas, periods, colons, semicolons, dashes, and quotation marks in their original positions.',
    '6. Do not use brackets, bullets, JSON, quotation marks, or explanations.',
    '7. Return only the chunked sentence, with no explanation.',
    'Example plain: The amount of sunlight that Earth reflects back into space has decreased measurably in recent years.',
    'Example chunked: The amount of sunlight / that Earth reflects back into space // has decreased measurably in recent years.',
  ];
  if (failureHint) {
    lines.push(`Previous attempt failed validation: ${failureHint}`);
  }
  if (legacyChunkedHint && legacyChunkedHint !== plainText) {
    lines.push(`Legacy chunking hint: ${legacyChunkedHint}`);
  }
  lines.push(`Question ID: ${id}`);
  lines.push(`Prompt: ${plainText}`);
  return lines.join('\n');
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeGeneratedCandidate(text) {
  let candidate = String(text || '').trim();
  candidate = candidate.replace(/^["“](.*)["”]$/u, '$1').trim();
  candidate = candidate.replace(/\s(\/{1,2})\s+([,.;:!?—–])/gu, '$2 $1 ');
  candidate = candidate.replace(/(\/{1,2})([,.;:!?—–])/gu, '$2 $1');
  candidate = candidate.replace(/^\s*(?:\/{1,2})\s+/u, '');
  candidate = candidate.replace(/\s+(?:\/{1,2})\s*$/u, '');
  candidate = candidate.replace(/[ \t]{2,}/g, ' ');
  return candidate.trim();
}

function buildValidationHint(validation) {
  if (!validation || validation.ok) return '';
  if (validation.reason === 'leading_or_trailing_marker') {
    return 'Do not place a chunk marker at the beginning or end of the sentence.';
  }
  if (validation.reason === 'consecutive_markers') {
    return 'Do not place two chunk markers next to each other.';
  }

  const diagnostics = validation.diagnostics || {};
  const leftToken = diagnostics.leftToken || null;
  const rightToken = diagnostics.rightToken || null;
  if (validation.reason === 'token_mismatch' && leftToken) {
    if (leftToken.type === 'punct' && rightToken?.type === 'space') {
      return `Keep the punctuation mark "${leftToken.value}" exactly where it appears. Do not insert a space before it.`;
    }
    if (leftToken.type === 'space' && rightToken?.type === 'punct') {
      return `Do not insert the punctuation mark "${rightToken.value}" where the source has a space.`;
    }
    if (leftToken.type === 'spoken') {
      return `Preserve the exact spoken token "${leftToken.value}" unchanged. Do not rewrite or split it.`;
    }
  }

  return `Preserve every original token exactly. Validation failed with reason: ${validation.reason}.`;
}

async function generateChunkedText(grammar, model, row) {
  const id = normalizeCell(row.ID);
  const plainText = normalizeCell(row['ANSWER FOR COMPARE OR TRANSCRIPT']);
  const legacyChunkedHint = normalizeCell(row.ANSWER);
  let lastError = null;
  let lastValidation = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: buildPrompt(id, plainText, buildValidationHint(lastValidation), legacyChunkedHint) }] }],
        generationConfig: {
          temperature: attempt === 1 ? 0.2 : 0,
          topP: 0.9
        }
      });
      const response = await result.response;
      const candidate = normalizeGeneratedCandidate(response.text());
      row['ANSWER CHUNKED'] = candidate;
      const validation = validateChunkedRow(grammar, row);
      if (validation.ok) {
        return { ok: true, chunkedText: candidate, attempt };
      }
      lastValidation = validation;
      lastError = new Error(`Validation failed: ${validation.reason}`);
      lastError.validation = validation;
    } catch (error) {
      lastError = error;
    }
    await sleep(Math.min(1500 * attempt, 5000));
  }

  if (legacyChunkedHint) {
    row['ANSWER CHUNKED'] = legacyChunkedHint;
    const legacyValidation = validateChunkedRow(grammar, row);
    if (legacyValidation.ok) {
      return {
        ok: true,
        chunkedText: legacyChunkedHint,
        attempt: 'legacy_fallback'
      };
    }
  }

  return {
    ok: false,
    error: lastError ? String(lastError.message || lastError) : 'Unknown generation failure',
    diagnostics: lastError?.validation || null
  };
}

function writeReports(validationReport, diffReport) {
  fs.writeFileSync(VALIDATION_REPORT_PATH, JSON.stringify(validationReport, null, 2));
  fs.writeFileSync(DIFF_REPORT_PATH, JSON.stringify(diffReport, null, 2));
}

async function writeWorkbook(workbook, destinationPath) {
  await workbook.xlsx.writeFile(destinationPath);
}

async function processWithConcurrency(items, limit, task) {
  const queue = Array.isArray(items) ? items.slice() : [];
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length || 1)) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;
      await task(item);
    }
  });
  await Promise.all(workers);
}

function assertGeminiApiKey() {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY. This migration uses Google AI Studio only.');
  }
  return apiKey;
}

async function main() {
  const grammar = await loadGrammar();
  const args = parseArgs(process.argv);
  const sourceWorkbookPath = args.resume && fs.existsSync(TEMP_WORKBOOK_PATH)
    ? TEMP_WORKBOOK_PATH
    : WORKBOOK_PATH;
  const { workbook, worksheet, headers, rows } = await loadWorkbookRows(sourceWorkbookPath);
  ensureFinalHeaderOrder(worksheet, headers);

  rows.forEach((row, index) => {
    row['ANSWER CHUNKED'] = normalizeCell(worksheet.getRow(index + 2).getCell(FINAL_HEADERS.length).value);
  });

  if (args.limit) {
    rows.length = Math.min(rows.length, args.limit);
  }

  const completedIds = new Set(args.resume ? getCheckpoint().completedIds.map(String) : []);
  const validationFailures = [];

  if (!args.validateOnly) {
    const apiKey = assertGeminiApiKey();
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    for (let start = 0; start < rows.length; start += BATCH_SIZE) {
      const batch = rows.slice(start, start + BATCH_SIZE);
      await processWithConcurrency(batch, CONCURRENT_REQUESTS, async (row) => {
        const id = normalizeCell(row.ID);
        const plainText = normalizeCell(row['ANSWER FOR COMPARE OR TRANSCRIPT']);
        const existingChunked = normalizeCell(row['ANSWER CHUNKED']);
        if (!plainText) {
          validationFailures.push({ id, reason: 'missing_plain_text' });
          return;
        }
        if (existingChunked) {
          const existingValidation = validateChunkedRow(grammar, row);
          if (existingValidation.ok) {
            completedIds.add(id);
            return;
          }
        }
        if (completedIds.has(id) && existingChunked) {
          return;
        }

        const result = await generateChunkedText(grammar, model, row);
        if (!result.ok) {
          validationFailures.push({ id, reason: 'generation_failed', error: result.error, diagnostics: result.diagnostics });
        } else {
          completedIds.add(id);
        }
      });
      rows.forEach((row, index) => {
        worksheet.getRow(index + 2).getCell(FINAL_HEADERS.length).value = normalizeCell(row['ANSWER CHUNKED']);
      });
      await writeWorkbook(workbook, TEMP_WORKBOOK_PATH);
      saveCheckpoint(completedIds);
    }
  }

  rows.forEach((row, index) => {
    worksheet.getRow(index + 2).getCell(FINAL_HEADERS.length).value = normalizeCell(row['ANSWER CHUNKED']);
  });

  const validationRows = rows.map((row) => {
    const validation = validateChunkedRow(grammar, row);
    return {
      id: normalizeCell(row.ID),
      ok: validation.ok,
      reason: validation.reason || null,
      diagnostics: validation.diagnostics || null
    };
  });

  const invalidRows = [
    ...validationFailures,
    ...validationRows.filter((row) => !row.ok)
  ];
  const invalidRowsById = new Map();
  invalidRows.forEach((row) => {
    const key = String(row.id || '');
    if (!invalidRowsById.has(key)) {
      invalidRowsById.set(key, row);
    }
  });
  const diffReport = buildQualityReports(grammar, rows);
  const validationReport = {
    generatedAt: new Date().toISOString(),
    validateOnly: args.validateOnly,
    invalidRowCount: invalidRowsById.size,
    invalidRows: Array.from(invalidRowsById.values())
  };

  writeReports(validationReport, diffReport);

  if (invalidRowsById.size > 0) {
    console.error(`Validation failed for ${invalidRowsById.size} row(s). Reports written to scripts/.`);
    process.exitCode = 1;
    return;
  }

  await writeWorkbook(workbook, TEMP_WORKBOOK_PATH);

  if (!args.validateOnly && !args.dryRunGenerate) {
    fs.copyFileSync(WORKBOOK_PATH, BACKUP_WORKBOOK_PATH);
    fs.copyFileSync(TEMP_WORKBOOK_PATH, WORKBOOK_PATH);
  }

  console.log(args.validateOnly
    ? `Validation succeeded for ${rows.length} row(s).`
    : args.dryRunGenerate
      ? `Dry-run generation succeeded for ${rows.length} row(s). Temp workbook written to ${TEMP_WORKBOOK_PATH}.`
      : `Chunking workbook generated successfully for ${rows.length} row(s).`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
