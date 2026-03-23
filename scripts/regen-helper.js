#!/usr/bin/env node
/**
 * Regeneration Helper — Read outlines and write beats to Firestore.
 *
 * Usage:
 *   node scripts/regen-helper.js read                     — List first 20 outlines
 *   node scripts/regen-helper.js read <outlineId>         — Read a specific outline
 *   node scripts/regen-helper.js read-batch <offset> <n>  — List N outlines starting at offset
 *   node scripts/regen-helper.js write <jsonFile>         — Write beats from JSON file to Firestore
 *   node scripts/regen-helper.js verify <outlineId>       — Read back & print the primary path story
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

// ─── READ: List or show outlines ─────────────────────────────────
async function listOutlines(offset = 0, limit = 20) {
  const all = await cache.listCachedOutlines();
  console.log(`Total outlines in Firestore: ${all.length}\n`);

  const slice = all.slice(offset, offset + limit);
  for (let i = 0; i < slice.length; i++) {
    const o = slice[i];
    const v = o.value || {};
    console.log(`[${offset + i + 1}] ID: ${o.id}`);
    console.log(`    Title: ${v.title || '?'}`);
    console.log(`    Premise: ${(v.premise || '').slice(0, 100)}`);
    console.log(`    Setting: ${v.setting || '?'}`);
    const chars = (v.characters || []).map(c => c.name).join(', ');
    console.log(`    Characters: ${chars || '?'}`);
    const beats = (v.beatOutline || []).map(b => `B${b.beat}: ${b.milestone}`).join(' | ');
    console.log(`    Milestones: ${beats}`);
    console.log('');
  }
}

async function readOutline(outlineId) {
  const val = await cache.getCachedValue({ collection: COLLECTION_OUTLINES, id: outlineId });
  if (!val) { console.log('Outline not found:', outlineId); return; }

  console.log('═══ OUTLINE DETAILS ═══');
  console.log(`ID: ${outlineId}`);
  console.log(`Title: ${val.title}`);
  console.log(`Premise: ${val.premise}`);
  console.log(`Setting: ${val.setting}`);
  console.log(`Topic Tags: ${(val.topicTags || []).join(', ')}`);
  console.log('\nCharacters:');
  for (const c of (val.characters || [])) {
    console.log(`  - ${c.name} (${c.role}): ${c.goal}`);
  }
  console.log('\nBeat Milestones:');
  for (const b of (val.beatOutline || [])) {
    console.log(`  Beat ${b.beat}: ${b.milestone}`);
  }
  console.log('\n═══ END ═══');
}

// ─── WRITE: Save beats from JSON file ────────────────────────────
async function writeBeats(jsonFile) {
  const raw = fs.readFileSync(jsonFile, 'utf8');
  const data = JSON.parse(raw);

  if (!data.outlineId) throw new Error('JSON must have outlineId');
  if (!Array.isArray(data.beats)) throw new Error('JSON must have beats array');

  console.log(`Writing ${data.beats.length} beats for outline ${data.outlineId}...`);

  let written = 0;
  for (const beat of data.beats) {
    const beatNumber = Number(beat.beatNumber);
    const pathArray = Array.isArray(beat.path) ? beat.path : [];

    const key = cache.computeBeatCacheKey({
      outlineId: data.outlineId,
      beatNumber,
      path: pathArray
    });

    const value = {
      formatVersion: 2,
      questionType: beat.questionType || (beatNumber === ENDING_BEAT_NUMBER ? 'end' : 'mcq'),
      segment: beat.segment,
      recap: beat.recap || '',
      highlights: beat.highlights || [],
      choiceQuestion: beat.choiceQuestion || null,
      productionPrompt: beat.productionPrompt || null,
      shouldEnd: beat.shouldEnd || false
    };

    if (beat.endWrap) value.endWrap = beat.endWrap;

    await cache.setCachedValue({
      collection: COLLECTION_BEATS,
      id: key.id,
      key: key.key,
      value
    });

    written++;
    console.log(`  ✓ Beat ${beatNumber} [path: ${pathArray.join('.')||'root'}] → ${key.id.slice(0,8)}...`);
  }

  console.log(`\nDone. Wrote ${written} beats to Firestore.`);
}

// ─── VERIFY: Read back primary path ──────────────────────────────
async function verifyPrimaryPath(outlineId) {
  const outline = await cache.getCachedValue({ collection: COLLECTION_OUTLINES, id: outlineId });
  if (!outline) { console.log('Outline not found'); return; }

  console.log(`═══ VERIFYING: ${outline.title} ═══\n`);

  const pathChoices = [];
  const segments = [];

  for (let beat = 1; beat <= ENDING_BEAT_NUMBER; beat++) {
    const pathSlice = pathChoices.slice(0, Math.max(0, beat - 1));
    const key = cache.computeBeatCacheKey({ outlineId, beatNumber: beat, path: pathSlice });
    const beatData = await cache.getCachedValue({ collection: COLLECTION_BEATS, id: key.id });

    if (!beatData) {
      console.log(`  Beat ${beat}: NOT FOUND (path: ${pathSlice.join('.')||'root'})`);
      break;
    }

    const seg = String(beatData.segment || '').trim();
    const wordCount = seg.split(/\s+/).length;
    segments.push(seg);

    console.log(`Beat ${beat} [${beatData.questionType}] (${wordCount} words):`);
    console.log(`  ${seg}`);
    if (beatData.recap) console.log(`  Recap: ${beatData.recap}`);
    if (beatData.highlights) console.log(`  Highlights: ${beatData.highlights.join(', ')}`);

    if (beatData.shouldEnd || beat === ENDING_BEAT_NUMBER) {
      if (beatData.endWrap) console.log(`  EndWrap: ${beatData.endWrap}`);
      break;
    }

    if (beatData.choiceQuestion) {
      const opts = beatData.choiceQuestion.options || [];
      for (const o of opts) console.log(`    [${o.id}] ${o.label}`);
    }

    // Follow first available choice
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
    if (!picked) {
      console.log(`  No child beats found for beat ${beat + 1}`);
      break;
    }
    console.log('');
  }

  const fullStory = segments.join(' ');
  const totalWords = fullStory.split(/\s+/).length;
  console.log(`\n═══ FULL STORY (${totalWords} words, path: ${pathChoices.join('→')}) ═══`);
  console.log(fullStory);
  console.log('═══ END ═══');
}

// ─── CLI ────────────────────────────────────────────────────────
async function main() {
  const [,, cmd, ...args] = process.argv;

  switch (cmd) {
    case 'read':
      if (args[0] && args[0].length > 10) await readOutline(args[0]);
      else await listOutlines(Number(args[0]) || 0, Number(args[1]) || 20);
      break;
    case 'read-batch':
      await listOutlines(Number(args[0]) || 0, Number(args[1]) || 20);
      break;
    case 'write':
      if (!args[0]) { console.log('Usage: write <jsonFile>'); return; }
      await writeBeats(args[0]);
      break;
    case 'verify':
      if (!args[0]) { console.log('Usage: verify <outlineId>'); return; }
      await verifyPrimaryPath(args[0]);
      break;
    default:
      console.log('Usage: node regen-helper.js <read|read-batch|write|verify> [args]');
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
