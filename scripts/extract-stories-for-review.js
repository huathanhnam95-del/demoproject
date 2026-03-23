#!/usr/bin/env node
/**
 * Extract 1 sample story per unaudited outline for manual assessment.
 * No API calls — just reads cached Firestore data.
 * Outputs stories in batches of 20 to /tmp/stories-batch-N.txt
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

// Load discovery data to know which outlines have paths
const discovery = JSON.parse(fs.readFileSync('docs/audits/reading-journey-quality/discovery.json', 'utf8'));

// Load batch 1 audit to know which are already scored
let alreadyScored = new Set();
try {
  const audit = JSON.parse(fs.readFileSync('docs/audits/reading-journey-quality/2026-03-19/audit-2026-03-19.json', 'utf8'));
  for (const r of audit.results) {
    const scored = (r.paths || []).filter(p => typeof p.weightedAverage === 'number');
    if (scored.length > 0) alreadyScored.add(r.outlineId);
  }
} catch (_) {}

// Pick a deterministic sample path: first path found via DFS
async function extractOnePath(outlineId) {
  const segments = [];
  let endWrap = '';
  const pathChoices = [];

  for (let beat = 1; beat <= ENDING_BEAT_NUMBER; beat++) {
    const pathSlice = pathChoices.slice(0, Math.max(0, beat - 1));
    const key = cache.computeBeatCacheKey({ outlineId, beatNumber: beat, path: pathSlice });
    const beatData = await cache.getCachedValue({ collection: COLLECTION_BEATS, id: key.id });

    if (!beatData) return null;

    const seg = String(beatData.segment || '').trim();
    if (seg) segments.push(seg);

    if (beat === ENDING_BEAT_NUMBER || beatData.shouldEnd) {
      endWrap = String(beatData.endWrap || '').trim();
      break;
    }

    // Pick first available choice for deterministic path
    let picked = false;
    for (const choiceId of CANONICAL_CHOICE_IDS) {
      const childPath = [...pathChoices, choiceId];
      const childKey = cache.computeBeatCacheKey({ outlineId, beatNumber: beat + 1, path: childPath });
      const childBeat = await cache.getCachedValue({ collection: COLLECTION_BEATS, id: childKey.id });
      if (childBeat) {
        pathChoices.push(choiceId);
        picked = true;
        break;
      }
    }
    if (!picked) break;
  }

  if (segments.length < 2) return null;

  return {
    path: pathChoices,
    segments,
    endWrap,
    beatText: segments.map((s, i) => `Beat ${i + 1}: ${s}`).join('\n') + (endWrap ? `\nEnding: ${endWrap}` : '')
  };
}

async function main() {
  // Filter to outlines with paths that aren't already scored
  const toExtract = discovery.outlines.filter(o => o.complete > 0 && !alreadyScored.has(o.outlineId));
  console.log(`Total unaudited outlines with paths: ${toExtract.length}`);
  console.log(`Already scored (batch 1): ${alreadyScored.size}`);

  const BATCH_SIZE = 20;
  let batchNum = 0;
  let extracted = 0;
  let currentBatch = [];

  for (let i = 0; i < toExtract.length; i++) {
    const entry = toExtract[i];
    const outline = await cache.getCachedValue({ collection: COLLECTION_OUTLINES, id: entry.outlineId });
    if (!outline) continue;

    const title = String(outline.title || '').trim() || entry.title;
    const level = String(outline.level || '?').toUpperCase();
    const premise = String(outline.premise || '').trim();
    const setting = String(outline.setting || '').trim();

    const story = await extractOnePath(entry.outlineId);
    if (!story) { console.log(`  Skip: ${title} (no complete path)`); continue; }

    currentBatch.push({
      index: extracted + 1,
      outlineId: entry.outlineId,
      title,
      level,
      premise,
      setting,
      path: story.path.join('→'),
      beatText: story.beatText,
      wordCount: story.segments.join(' ').split(/\s+/).length
    });
    extracted++;

    if (currentBatch.length >= BATCH_SIZE || i === toExtract.length - 1) {
      batchNum++;
      const batchFile = `/tmp/stories-batch-${batchNum}.txt`;
      let content = `═══ BATCH ${batchNum} — Stories ${currentBatch[0].index}-${currentBatch[currentBatch.length - 1].index} ═══\n\n`;

      for (const s of currentBatch) {
        content += `──── STORY #${s.index}: ${s.title} (${s.level}) ────\n`;
        content += `OutlineID: ${s.outlineId}\n`;
        content += `Premise: ${s.premise}\n`;
        content += `Setting: ${s.setting}\n`;
        content += `Path: ${s.path}\n`;
        content += `Words: ${s.wordCount}\n\n`;
        content += s.beatText + '\n\n';
      }

      fs.writeFileSync(batchFile, content, 'utf8');
      console.log(`  Wrote ${batchFile} (${currentBatch.length} stories)`);
      currentBatch = [];
    }

    if ((i + 1) % 50 === 0) console.log(`  Progress: ${i + 1}/${toExtract.length}`);
  }

  console.log(`\nDone. Extracted ${extracted} stories in ${batchNum} batch files.`);
  console.log(`Files: /tmp/stories-batch-1.txt through /tmp/stories-batch-${batchNum}.txt`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
