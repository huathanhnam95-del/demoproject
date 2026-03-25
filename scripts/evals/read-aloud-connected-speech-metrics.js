#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const REQUIRED_COLUMNS = [
  'attemptId',
  'questionId',
  'eventId',
  'family',
  'phrase',
  'referenceText',
  'recognizedText',
  'systemStatus',
  'humanLabel',
  'audioStatus',
  'workerStatus'
];

function splitCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === ',' && !quoted) {
      values.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  values.push(current);
  return values;
}

function parseCsv(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  if (!lines.length) {
    throw new Error('CSV is empty.');
  }

  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  const rows = lines.slice(1).map((line, lineNumber) => {
    const values = splitCsvLine(line);
    if (values.length > headers.length) {
      throw new Error(`Row ${lineNumber + 2} has more values than headers.`);
    }
    const row = {};
    headers.forEach((header, index) => {
      row[header] = String(values[index] || '').trim();
    });
    return row;
  });

  return { headers, rows };
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase() || 'unknown';
}

function ensureColumns(headers) {
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length) {
    throw new Error(`CSV is missing required columns: ${missing.join(', ')}`);
  }
}

function summarizeRows(rows) {
  const byFamily = new Map();
  const disagreements = [];

  for (const row of rows) {
    const family = String(row.family || '').trim() || 'unknown';
    if (!byFamily.has(family)) {
      byFamily.set(family, {
        total: 0,
        detected: 0,
        notDetected: 0,
        uncertain: 0,
        notRateable: 0,
        humanLabeled: 0,
        agreements: 0,
        audioFailures: 0,
        workerFailures: 0,
        audioQualityFailures: 0
      });
    }

    const summary = byFamily.get(family);
    const systemStatus = normalizeStatus(row.systemStatus);
    const humanLabel = normalizeStatus(row.humanLabel);

    summary.total += 1;
    if (systemStatus === 'detected') summary.detected += 1;
    else if (systemStatus === 'not_detected') summary.notDetected += 1;
    else if (systemStatus === 'uncertain') summary.uncertain += 1;
    else if (systemStatus === 'not_rateable') summary.notRateable += 1;

    if (normalizeStatus(row.audioStatus) && normalizeStatus(row.audioStatus) !== 'complete') {
      summary.audioFailures += 1;
    }
    if (normalizeStatus(row.workerStatus) && normalizeStatus(row.workerStatus) !== 'complete') {
      summary.workerFailures += 1;
    }
    const audioQualityReason = normalizeStatus(row.audioQualityReason);
    const audioQualityPassed = normalizeStatus(row.audioQualityPassed);
    if (audioQualityReason && audioQualityReason !== 'none') {
      summary.audioQualityFailures += 1;
    }
    if (audioQualityPassed && audioQualityPassed !== 'true' && audioQualityPassed !== 'passed') {
      summary.audioQualityFailures += 1;
    }

    if (humanLabel && humanLabel !== 'unknown') {
      summary.humanLabeled += 1;
      if (humanLabel === systemStatus) {
        summary.agreements += 1;
      } else {
        disagreements.push({
          family,
          attemptId: row.attemptId,
          eventId: row.eventId,
          systemStatus,
          humanLabel,
          phrase: row.phrase
        });
      }
    }
  }

  return { byFamily, disagreements };
}

function printFamilySummary(family, summary) {
  const agreementRate = summary.humanLabeled ? (summary.agreements / summary.humanLabeled) : null;
  const abstentionRate = summary.total ? (summary.uncertain / summary.total) : null;

  console.log(`\n${family}`);
  console.log(`  total: ${summary.total}`);
  console.log(`  detected: ${summary.detected}`);
  console.log(`  not_detected: ${summary.notDetected}`);
  console.log(`  uncertain: ${summary.uncertain}`);
  console.log(`  not_rateable: ${summary.notRateable}`);
  console.log(`  human_labeled: ${summary.humanLabeled}`);
  console.log(`  agreement_rate: ${agreementRate === null ? 'n/a' : agreementRate.toFixed(4)}`);
  console.log(`  abstention_rate: ${abstentionRate === null ? 'n/a' : abstentionRate.toFixed(4)}`);
  console.log(`  audio_failures: ${summary.audioFailures}`);
  console.log(`  worker_failures: ${summary.workerFailures}`);
  console.log(`  audio_quality_failures: ${summary.audioQualityFailures}`);
}

function main() {
  const csvPath = process.argv[2] || path.join(process.cwd(), 'data', 'evals', 'read-aloud-connected-speech', 'template.csv');
  const csvText = fs.readFileSync(csvPath, 'utf8');
  const parsed = parseCsv(csvText);
  ensureColumns(parsed.headers);

  if (!parsed.rows.length) {
    throw new Error('CSV has no data rows.');
  }

  const { byFamily, disagreements } = summarizeRows(parsed.rows);

  console.log(`Rows: ${parsed.rows.length}`);
  for (const [family, summary] of byFamily.entries()) {
    printFamilySummary(family, summary);
  }

  console.log('\nTop disagreements');
  if (!disagreements.length) {
    console.log('  n/a');
  } else {
    for (const row of disagreements.slice(0, 10)) {
      console.log(`  - ${row.family} / ${row.eventId} (${row.attemptId}): system=${row.systemStatus} human=${row.humanLabel} phrase="${row.phrase}"`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
