#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const REQUIRED_COLUMNS = [
  'speaker_id',
  'item_id',
  'contrast_id',
  'target_phoneme',
  'azure_score',
  'azure_top_candidate',
  'human_rater_1',
  'human_rater_2',
  'heard_label_r1',
  'heard_label_r2',
  'needs_adjudication',
  'notes'
];

function splitCsvLine(line) {
  const out = [];
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
      out.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  out.push(current);
  return out;
}

function parseCsv(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    return row;
  });

  return {
    headers,
    rows
  };
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pearson(xs, ys) {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const meanX = average(xs);
  const meanY = average(ys);
  let numerator = 0;
  let left = 0;
  let right = 0;

  for (let index = 0; index < xs.length; index += 1) {
    const dx = xs[index] - meanX;
    const dy = ys[index] - meanY;
    numerator += dx * dy;
    left += dx * dx;
    right += dy * dy;
  }

  if (!left || !right) return null;
  return numerator / Math.sqrt(left * right);
}

function rank(values) {
  const pairs = values.map((value, index) => ({ value, index })).sort((left, right) => left.value - right.value);
  const ranks = Array(values.length).fill(0);
  let cursor = 0;

  while (cursor < pairs.length) {
    let end = cursor;
    while (end + 1 < pairs.length && pairs[end + 1].value === pairs[cursor].value) {
      end += 1;
    }
    const rankValue = (cursor + end + 2) / 2;
    for (let index = cursor; index <= end; index += 1) {
      ranks[pairs[index].index] = rankValue;
    }
    cursor = end + 1;
  }

  return ranks;
}

function spearman(xs, ys) {
  if (xs.length !== ys.length || xs.length < 2) return null;
  return pearson(rank(xs), rank(ys));
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseBoolean(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function humanScoreToHundredMark(value) {
  if (!Number.isFinite(value)) return null;
  return ((value - 1) / 4) * 100;
}

function groupMean(rows, key, valueSelector) {
  const groups = new Map();
  for (const row of rows) {
    const bucket = String(row[key] || '').trim() || 'unknown';
    if (!groups.has(bucket)) groups.set(bucket, []);
    const value = valueSelector(row);
    if (value !== null) {
      groups.get(bucket).push(value);
    }
  }

  return Array.from(groups.entries()).map(([bucket, values]) => ({
    key: bucket,
    mean: values.length ? average(values) : null,
    count: values.length
  }));
}

function confusionSummary(rows) {
  const counts = new Map();
  for (const row of rows) {
    const labels = [row.heard_label_r1, row.heard_label_r2].filter(Boolean);
    for (const label of labels) {
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  return Array.from(counts.entries()).map(([label, count]) => ({ label, count }));
}

function validateCsv(headers, rows) {
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missingColumns.length) {
    throw new Error(`CSV is missing required columns: ${missingColumns.join(', ')}`);
  }
  if (!rows.length) {
    throw new Error('CSV has no data rows.');
  }
}

function buildMetrics(rows) {
  const warnings = [];
  const scored = rows
    .map((row) => {
      const azureScore = toNumber(row.azure_score);
      const r1 = toNumber(row.human_rater_1);
      const r2 = toNumber(row.human_rater_2);
      const humanMean = r1 !== null && r2 !== null ? average([r1, r2]) : null;
      const disagreement = r1 !== null && r2 !== null ? Math.abs(r1 - r2) : null;
      const declaredNeedsAdjudication = parseBoolean(row.needs_adjudication);
      const derivedNeedsAdjudication = disagreement !== null ? disagreement >= 2 : false;
      return {
        ...row,
        azureScore,
        humanMean,
        disagreement,
        declaredNeedsAdjudication,
        derivedNeedsAdjudication,
        normalizedHumanScore: humanMean === null ? null : humanScoreToHundredMark(humanMean)
      };
    })
    .filter((row) => row.azureScore !== null && row.humanMean !== null);

  if (rows.length < 20) {
    warnings.push(`Only ${rows.length} row(s) present. Treat correlation metrics as unstable until the dataset is expanded.`);
  }
  if (scored.length < 10) {
    warnings.push(`Only ${scored.length} scored row(s) have complete Azure + human labels.`);
  }

  const azureScores = scored.map((row) => row.azureScore);
  const humanMeans = scored.map((row) => row.humanMean);
  const declaredAdjudicationRate = scored.length
    ? scored.filter((row) => row.declaredNeedsAdjudication).length / scored.length
    : null;
  const derivedAdjudicationRate = scored.length
    ? scored.filter((row) => row.derivedNeedsAdjudication).length / scored.length
    : null;
  const adjudicationMismatches = scored
    .filter((row) => row.declaredNeedsAdjudication !== row.derivedNeedsAdjudication)
    .map((row) => ({
      itemId: row.item_id,
      contrastId: row.contrast_id,
      declared: row.declaredNeedsAdjudication,
      derived: row.derivedNeedsAdjudication
    }));

  const disagreementItems = scored
    .map((row) => ({
      itemId: row.item_id,
      contrastId: row.contrast_id,
      azureScore: row.azureScore,
      humanMean: row.humanMean,
      normalizedHumanScore: row.normalizedHumanScore,
      absoluteGap: Math.abs(row.azureScore - row.normalizedHumanScore)
    }))
    .sort((left, right) => right.absoluteGap - left.absoluteGap)
    .slice(0, 10);

  return {
    warnings,
    rowCount: rows.length,
    scoredCount: scored.length,
    pearson: pearson(azureScores, humanMeans),
    spearman: spearman(azureScores, humanMeans),
    declaredAdjudicationRate,
    derivedAdjudicationRate,
    adjudicationMismatches,
    perContrastAzure: groupMean(scored, 'contrast_id', (row) => row.azureScore),
    perContrastHuman: groupMean(scored, 'contrast_id', (row) => row.humanMean),
    confusion: confusionSummary(rows),
    disagreements: disagreementItems
  };
}

function printMetricBlock(title, rows, formatValue) {
  console.log(`\n${title}`);
  for (const row of rows) {
    console.log(`- ${row.key || row.label || row.itemId}: ${formatValue(row)}`);
  }
}

const csvPath = process.argv[2] || path.join(process.cwd(), 'data', 'evals', 'pronunciation-test', 'template.csv');
const csvText = fs.readFileSync(csvPath, 'utf8');
const parsed = parseCsv(csvText);
validateCsv(parsed.headers, parsed.rows);
const metrics = buildMetrics(parsed.rows);

console.log(`Rows: ${metrics.rowCount}`);
console.log(`Scored rows: ${metrics.scoredCount}`);
console.log(`Pearson: ${metrics.pearson === null ? 'n/a' : metrics.pearson.toFixed(4)}`);
console.log(`Spearman: ${metrics.spearman === null ? 'n/a' : metrics.spearman.toFixed(4)}`);
console.log(`Declared adjudication rate: ${metrics.declaredAdjudicationRate === null ? 'n/a' : metrics.declaredAdjudicationRate.toFixed(4)}`);
console.log(`Derived adjudication rate: ${metrics.derivedAdjudicationRate === null ? 'n/a' : metrics.derivedAdjudicationRate.toFixed(4)}`);

if (metrics.warnings.length) {
  console.log('\nWarnings');
  for (const warning of metrics.warnings) {
    console.log(`- ${warning}`);
  }
}

printMetricBlock('Per-contrast Azure mean', metrics.perContrastAzure, (row) => row.mean === null ? 'n/a' : `${row.mean.toFixed(2)} (${row.count})`);
printMetricBlock('Per-contrast human mean', metrics.perContrastHuman, (row) => row.mean === null ? 'n/a' : `${row.mean.toFixed(2)} (${row.count})`);
printMetricBlock('Heard-label confusion summary', metrics.confusion, (row) => row.count);
printMetricBlock('Top disagreements', metrics.disagreements, (row) => `azure=${row.azureScore.toFixed(2)} human(100)=${row.normalizedHumanScore.toFixed(2)} gap=${row.absoluteGap.toFixed(2)}`);
printMetricBlock('Adjudication mismatches', metrics.adjudicationMismatches, (row) => `declared=${row.declared} derived=${row.derived}`);
