#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Cleanup Old Beats — Remove 5-beat path data from Firestore
 *
 * After migrating from 5 interactive beats to 3 interactive beats,
 * old 5-beat path entries are now incompatible. This script identifies
 * and deletes beat cache entries that belong to the old structure:
 *   - Beats with beatNumber > 4 (ENDING_BEAT_NUMBER is now 4, was 6)
 *   - Beats whose path array has more than 3 elements
 *   - Beats keyed with the old "wait" choice in positions that no longer use it
 *
 * Usage:
 *   node scripts/cleanup-old-beats.js --dry-run            # Preview what would be deleted
 *   node scripts/cleanup-old-beats.js --apply              # Actually delete
 *   node scripts/cleanup-old-beats.js --apply --limit 100  # Delete first 100 stale entries
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { db } = require('../src/utils/firebase');

const COLLECTION_BEATS = 'reading_journey_beats_v1';

// New structure constants
const MAX_INTERACTIVE_BEATS = 3;
const ENDING_BEAT_NUMBER = MAX_INTERACTIVE_BEATS + 1; // 4
const BEAT_2_VALID_CHOICES = new Set(['investigate', 'ask']);

// ── Args ────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    apply: false,
    dryRun: false,
    limit: 0
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') { args.apply = true; continue; }
    if (arg === '--dry-run') { args.dryRun = true; continue; }
    if (arg === '--limit') { args.limit = Number(argv[i + 1]); i += 1; continue; }
  }

  if (args.dryRun) args.apply = false;
  return args;
}

// ── Parse beat cache key ────────────────────────────────────────────────────────

function parseBeatKey(key) {
  // Key format: v1|outline:<hash>|beat:<number>|path:<choice1.choice2.choice3...>
  const result = { outline: '', beatNumber: 0, path: [] };
  if (!key || typeof key !== 'string') return result;

  for (const part of key.split('|')) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    const k = part.slice(0, idx);
    const v = part.slice(idx + 1);
    if (k === 'outline') result.outline = v;
    if (k === 'beat') result.beatNumber = Number(v);
    if (k === 'path') result.path = v ? v.split('.').filter(Boolean) : [];
  }

  return result;
}

// ── Determine if a beat entry is stale ──────────────────────────────────────────

function isStale(parsed) {
  const { beatNumber, path: pathArr } = parsed;

  // Old beats had up to beat 6 (5 interactive + 1 ending). Anything > 4 is stale.
  if (beatNumber > ENDING_BEAT_NUMBER) return 'beat_number_too_high';

  // Old paths had up to 5 elements. New paths have max 3 (b1 choice, b2 choice, b3 auto).
  // In practice, max path length at any beat is (beatNumber - 1).
  // The longest valid path is for beat 4 (ending): 3 elements.
  if (pathArr.length > MAX_INTERACTIVE_BEATS) return 'path_too_long';

  // Beat 2 only allows "investigate" and "ask" (no "wait").
  // If the first path element (beat 1's choice) is valid but the second (beat 2's choice)
  // is "wait", it's a stale 5-beat path.
  if (pathArr.length >= 2 && !BEAT_2_VALID_CHOICES.has(pathArr[1])) return 'beat2_invalid_choice';

  return null;
}

// ── Main ────────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  console.log('═══════════════════════════════════════════════════');
  console.log(' Reading Journey — Cleanup Old Beats');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Mode: ${args.apply ? 'APPLY (will DELETE)' : 'DRY-RUN (preview only)'}`);

  if (!db) {
    console.error('❌ Firestore is not initialized (missing serviceAccountKey.json?).');
    process.exit(1);
  }

  // 1. Load all beat entries
  console.log('\n  Loading all beat entries from Firestore...');
  const snap = await db.collection(COLLECTION_BEATS).get();
  console.log(`  Total beat entries: ${snap.size}`);

  // 2. Classify
  const staleEntries = [];
  const validEntries = [];
  const staleReasons = {};

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const parsed = parseBeatKey(data.key);
    const reason = isStale(parsed);

    if (reason) {
      staleEntries.push({ docId: doc.id, key: data.key, reason, parsed });
      staleReasons[reason] = (staleReasons[reason] || 0) + 1;
    } else {
      validEntries.push({ docId: doc.id, key: data.key, parsed });
    }
  }

  console.log(`\n  Valid entries (keep):  ${validEntries.length}`);
  console.log(`  Stale entries (drop): ${staleEntries.length}`);
  console.log(`\n  Stale breakdown:`);
  for (const [reason, count] of Object.entries(staleReasons).sort()) {
    console.log(`    ${reason}: ${count}`);
  }

  if (staleEntries.length === 0) {
    console.log('\n✅ Nothing to clean up. All entries are valid for the 3-beat structure.');
    return;
  }

  // 3. Preview
  const previewCount = Math.min(10, staleEntries.length);
  console.log(`\n  Preview (first ${previewCount} stale entries):`);
  for (let i = 0; i < previewCount; i += 1) {
    const e = staleEntries[i];
    console.log(`    [${e.reason}] beat=${e.parsed.beatNumber} path=[${e.parsed.path.join(',')}] outline=${e.parsed.outline.slice(0, 12)}…`);
  }

  // 4. Delete
  if (!args.apply) {
    console.log(`\n⚠ DRY-RUN: Would delete ${staleEntries.length} entries. Use --apply to actually delete.`);
    // Write preview report
    const date = new Date().toISOString().slice(0, 10);
    const outDir = path.join('docs', 'audits', 'reading-journey-quality', date);
    fs.mkdirSync(outDir, { recursive: true });
    const reportPath = path.join(outDir, `cleanup-preview-${date}.json`);
    fs.writeFileSync(reportPath, JSON.stringify({
      date,
      mode: 'dry-run',
      totalEntries: snap.size,
      validEntries: validEntries.length,
      staleEntries: staleEntries.length,
      staleReasons,
      preview: staleEntries.slice(0, 50).map(e => ({ reason: e.reason, beat: e.parsed.beatNumber, path: e.parsed.path }))
    }, null, 2) + '\n', 'utf8');
    console.log(`📄 Preview: ${reportPath}`);
    return;
  }

  // Actual deletion
  const toDelete = args.limit > 0 ? staleEntries.slice(0, args.limit) : staleEntries;
  console.log(`\n  Deleting ${toDelete.length} stale entries...`);

  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 450) {
    const batch = db.batch();
    const slice = toDelete.slice(i, i + 450);
    for (const entry of slice) {
      batch.delete(db.collection(COLLECTION_BEATS).doc(entry.docId));
    }
    await batch.commit();
    deleted += slice.length;
    if ((i + slice.length) % 900 === 0 || i + slice.length >= toDelete.length) {
      console.log(`    ... ${deleted}/${toDelete.length} deleted`);
    }
  }

  console.log(`\n✅ Deleted ${deleted} stale beat entries.`);

  // Write report
  const date = new Date().toISOString().slice(0, 10);
  const outDir = path.join('docs', 'audits', 'reading-journey-quality', date);
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, `cleanup-${date}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({
    date,
    mode: 'apply',
    totalEntries: snap.size,
    validEntries: validEntries.length,
    staleDeleted: deleted,
    staleReasons
  }, null, 2) + '\n', 'utf8');
  console.log(`📄 Report: ${reportPath}`);
}

main().catch((err) => {
  console.error('❌ Fatal error:', err?.message || err);
  process.exit(1);
});
