#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Discovery script: counts all cached paths per outline without making API calls.
 * Output: docs/audits/reading-journey-quality/discovery.json
 */

require('dotenv').config();
if (!process.env.GEMINI_API_KEY) {
  try { require('dotenv').config({ path: require('path').join(__dirname, '..', 'functions', '.env') }); } catch (_) {}
}

const fs = require('fs');
const path = require('path');
const cache = require('../src/services/reading-journey/cache');

const COLLECTION_OUTLINES = 'reading_journey_outlines_v1';
const COLLECTION_BEATS = 'reading_journey_beats_v1';
const MAX_INTERACTIVE_BEATS = 3;
const ENDING_BEAT_NUMBER = MAX_INTERACTIVE_BEATS + 1;
const CANONICAL_CHOICE_IDS = ['investigate', 'ask', 'wait'];

async function countPaths(outlineId) {
  let total = 0;
  let complete = 0;
  let partial = 0;

  async function walk(beatNumber, pathSoFar, segCount) {
    const pathSlice = pathSoFar.slice(0, Math.max(0, beatNumber - 1));
    const key = cache.computeBeatCacheKey({ outlineId, beatNumber, path: pathSlice });
    const beat = await cache.getCachedValue({ collection: COLLECTION_BEATS, id: key.id });

    if (!beat || typeof beat !== 'object') return;

    const seg = String(beat.segment || '').trim();
    const newSegCount = seg ? segCount + 1 : segCount;

    if (beatNumber === ENDING_BEAT_NUMBER || beat.shouldEnd) {
      total += 1;
      complete += 1;
      return;
    }

    if (beatNumber < ENDING_BEAT_NUMBER) {
      let anyChild = false;
      for (const choiceId of CANONICAL_CHOICE_IDS) {
        const childPath = [...pathSoFar, choiceId];
        const childKey = cache.computeBeatCacheKey({ outlineId, beatNumber: beatNumber + 1, path: childPath });
        const childBeat = await cache.getCachedValue({ collection: COLLECTION_BEATS, id: childKey.id });
        if (childBeat && typeof childBeat === 'object') {
          anyChild = true;
          await walk(beatNumber + 1, childPath, newSegCount);
        }
      }
      if (!anyChild && newSegCount >= 2) {
        total += 1;
        partial += 1;
      }
    }
  }

  await walk(1, [], 0);
  return { total, complete, partial };
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log(' Reading Journey — Path Discovery');
  console.log('═══════════════════════════════════════════════════\n');

  const outlines = await cache.listCachedOutlines();
  console.log(`Total outlines: ${outlines.length}\n`);

  const results = [];
  let grandTotal = 0;
  let grandComplete = 0;
  let grandPartial = 0;
  let emptyCount = 0;
  let withPaths = 0;

  for (let i = 0; i < outlines.length; i += 1) {
    const entry = outlines[i];
    const outlineId = String(entry?.outlineId || entry?.id || '').trim();
    if (!outlineId) continue;

    // Get outline data for title/level
    const outline = await cache.getCachedValue({ collection: COLLECTION_OUTLINES, id: outlineId });
    const title = String(outline?.title || '').trim().slice(0, 50) || outlineId.slice(0, 12);
    const level = String(outline?.level || entry?.level || '?').toUpperCase();
    const hasQuality = outline?.qualityScore ? true : false;

    const counts = await countPaths(outlineId);

    if (counts.total === 0) {
      emptyCount += 1;
    } else {
      withPaths += 1;
    }

    grandTotal += counts.total;
    grandComplete += counts.complete;
    grandPartial += counts.partial;

    if (counts.total > 0) {
      console.log(`  [${i + 1}/${outlines.length}] ${title} (${level}) → ${counts.complete} complete, ${counts.partial} partial`);
    }

    results.push({
      outlineId,
      title,
      level,
      ...counts,
      hasExistingAudit: hasQuality
    });

    // Periodic progress
    if ((i + 1) % 50 === 0) {
      console.log(`  ... ${i + 1}/${outlines.length} checked, ${grandTotal} paths found so far ...`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(' DISCOVERY SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Total outlines:       ${outlines.length}`);
  console.log(`  With cached paths:    ${withPaths}`);
  console.log(`  Empty (no paths):     ${emptyCount}`);
  console.log(`  Total paths:          ${grandTotal}`);
  console.log(`  Complete paths:       ${grandComplete}`);
  console.log(`  Partial paths:        ${grandPartial}`);
  console.log(`  Already audited:      ${results.filter(r => r.hasExistingAudit).length}`);

  // Level breakdown
  const byLevel = {};
  for (const r of results) {
    if (!byLevel[r.level]) byLevel[r.level] = { outlines: 0, paths: 0 };
    byLevel[r.level].outlines += 1;
    byLevel[r.level].paths += r.total;
  }
  console.log('\n  By CEFR level:');
  for (const [level, data] of Object.entries(byLevel).sort()) {
    console.log(`    ${level}: ${data.outlines} outlines, ${data.paths} paths`);
  }

  // Estimate time
  const apiCallsNeeded = grandComplete; // only complete paths get assessed
  const aiStudioMinutes = Math.ceil(apiCallsNeeded / 60); // 60 RPM
  const vertexMinutes = Math.ceil(apiCallsNeeded / 60);
  console.log(`\n  Estimated audit time:`);
  console.log(`    AI Studio (free, 60 RPM):  ~${aiStudioMinutes} min`);
  console.log(`    AI Studio (free, 1500 RPD): ~${Math.ceil(apiCallsNeeded / 1500)} days`);
  console.log(`    Vertex AI (paid, 60 RPM):  ~${vertexMinutes} min`);

  // Write results
  const outDir = path.join('docs', 'audits', 'reading-journey-quality');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'discovery.json');
  fs.writeFileSync(outFile, JSON.stringify({
    discoveredAt: new Date().toISOString(),
    summary: {
      totalOutlines: outlines.length,
      withPaths,
      empty: emptyCount,
      totalPaths: grandTotal,
      completePaths: grandComplete,
      partialPaths: grandPartial,
      alreadyAudited: results.filter(r => r.hasExistingAudit).length,
      byLevel
    },
    outlines: results
  }, null, 2), 'utf8');
  console.log(`\n📄 Discovery written: ${outFile}`);
}

main().catch(err => {
  console.error('Fatal:', err?.message || err);
  process.exit(1);
});
