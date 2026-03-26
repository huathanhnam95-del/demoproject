#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const {
  parseCsv,
  ensureColumns,
  summarizeRows,
  normalizeStatus
} = require('./read-aloud-connected-speech-metrics');

function formatRate(numerator, denominator) {
  if (!denominator) return 'n/a';
  return (numerator / denominator).toFixed(4);
}

function summarizeDisagreements(rows) {
  const disagreements = [];
  for (const row of rows) {
    const humanLabel = normalizeStatus(row.humanLabel);
    const systemStatus = normalizeStatus(row.systemStatus);
    if (humanLabel && humanLabel !== 'unknown' && humanLabel !== systemStatus) {
      disagreements.push({
        attemptId: row.attemptId || 'unknown',
        questionId: row.questionId || 'unknown',
        eventId: row.eventId || 'unknown',
        family: row.family || 'unknown',
        phrase: row.phrase || '',
        systemStatus,
        humanLabel,
        audioStatus: normalizeStatus(row.audioStatus),
        workerStatus: normalizeStatus(row.workerStatus),
        reason: normalizeStatus(row.audioQualityReason || row.raterNotes || '')
      });
    }
  }
  disagreements.sort((left, right) => {
    if (left.family !== right.family) return left.family.localeCompare(right.family);
    if (left.questionId !== right.questionId) return left.questionId.localeCompare(right.questionId);
    return left.eventId.localeCompare(right.eventId);
  });
  return disagreements;
}

function summarizeTopFailures(rows) {
  const counts = new Map();
  for (const row of rows) {
    const reason = normalizeStatus(row.audioQualityReason || row.raterNotes || row.workerStatus || row.audioStatus || '');
    if (!reason || reason === 'unknown' || reason === 'complete') continue;
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10);
}

function main() {
  const csvPath = process.argv[2] || path.join(process.cwd(), 'data', 'evals', 'read-aloud-connected-speech', 'template.csv');
  const csvText = fs.readFileSync(csvPath, 'utf8');
  const parsed = parseCsv(csvText);
  ensureColumns(parsed.headers);

  const { byFamily, disagreements } = summarizeRows(parsed.rows);
  const failureCounts = summarizeTopFailures(parsed.rows);

  console.log(`Source: ${csvPath}`);
  console.log(`Rows: ${parsed.rows.length}`);
  console.log('\nFamily rollup');
  for (const [family, summary] of byFamily.entries()) {
    console.log(`  ${family}: total=${summary.total}, detected=${summary.detected}, not_detected=${summary.notDetected}, uncertain=${summary.uncertain}, not_rateable=${summary.notRateable}, abstention_rate=${formatRate(summary.uncertain + summary.notRateable, summary.total)}`);
  }

  console.log('\nTop failure reasons');
  if (!failureCounts.length) {
    console.log('  n/a');
  } else {
    for (const [reason, count] of failureCounts) {
      console.log(`  - ${reason}: ${count}`);
    }
  }

  console.log('\nTop disagreements');
  if (!disagreements.length) {
    console.log('  n/a');
  } else {
    for (const row of summarizeDisagreements(parsed.rows).slice(0, 10)) {
      console.log(`  - ${row.family} / ${row.eventId} (${row.attemptId}, q${row.questionId}): system=${row.systemStatus} human=${row.humanLabel} audio=${row.audioStatus} worker=${row.workerStatus} phrase="${row.phrase}"`);
    }
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = {
  formatRate,
  summarizeDisagreements,
  summarizeTopFailures,
  main
};
