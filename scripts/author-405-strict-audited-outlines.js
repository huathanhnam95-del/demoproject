#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Local Procedural Story Engine v4 — Hash-aligned beat types
 *
 * Matches the route handler's expectations EXACTLY:
 *   MAX_INTERACTIVE_BEATS = 5  (interactive beats 1–5)
 *   ENDING_BEAT_NUMBER    = 6  (ending beat with endWrap)
 *   OPEN_BEAT_COUNT       = 2  (2 of beats 1–5 are 'open', rest are 'mcq')
 *   Beat-type assignment uses computeOpenBeatNumbers(outlineId) — hash-based.
 *
 * Word count constraints (from isValidBeatPayload):
 *   segment: 50–60 words
 *   recap:   ≤ 20 words
 *   endWrap: 20–30 words
 *   formatVersion: 2
 *
 * MCQ Beat 1: 3 options (investigate, ask, wait)
 * MCQ others: 2 options (investigate, ask)
 * Open beats: productionPrompt, no choiceQuestion
 * Ending beat 6: shouldEnd=true, endWrap
 */

require('dotenv').config();
const crypto = require('crypto');
const cache = require('../src/services/reading-journey/cache');
const { countWords, trimToMaxWords } = require('../src/services/reading-journey/json');

/**
 * Ensures text is between min and max words.
 * Trims to max if too long; pads with filler words if too short.
 */
function fitWords(text, min, max) {
  let t = String(text || '').trim();
  let wc = countWords(t);
  // Trim if too long
  if (wc > max) {
    t = trimToMaxWords(t, max);
    // Ensure it ends with a period
    if (!t.endsWith('.') && !t.endsWith('!') && !t.endsWith('?')) t += '.';
    wc = countWords(t);
  }
  // Pad if too short
  const fillers = ['The day was bright and warm.', 'It was a good start.', 'Things were about to change.', 'The air felt fresh and cool.', 'There was still more to discover.'];
  let fi = 0;
  while (wc < min && fi < fillers.length) {
    t += ' ' + fillers[fi++];
    wc = countWords(t);
  }
  // Final trim if padding overshot
  if (wc > max) {
    t = trimToMaxWords(t, max);
    if (!t.endsWith('.') && !t.endsWith('!') && !t.endsWith('?')) t += '.';
  }
  return t;
}

const MAX_INTERACTIVE_BEATS = 5;
const ENDING_BEAT_NUMBER = MAX_INTERACTIVE_BEATS + 1; // 6
const OPEN_BEAT_COUNT = 2;
const COLLECTION_BEATS = 'reading_journey_beats_v1';
const OPEN_PROMPT = 'In 1\u20132 sentences: summarize what happened, then say what you do next (investigate, ask, or wait) and why.';

/* ── exactly mirrored from route handler ──────────────────────────────────── */
function computeOpenBeatNumbers(outlineId) {
  const base = String(outlineId || '').trim();
  if (!base) return [2, 4];
  const hash = crypto.createHash('sha256').update(`reading_journey_plan_v1|${base}`).digest();
  const picked = new Set();
  for (let i = 0; i < hash.length && picked.size < OPEN_BEAT_COUNT; i += 1) {
    const beat = (hash[i] % MAX_INTERACTIVE_BEATS) + 1;
    picked.add(beat);
  }
  const beats = Array.from(picked);
  while (beats.length < OPEN_BEAT_COUNT) {
    const beat = ((beats.length + 1) % MAX_INTERACTIVE_BEATS) + 1;
    if (!beats.includes(beat)) beats.push(beat);
  }
  beats.sort((a, b) => a - b);
  return beats;
}

function getQuestionType(outlineId, beatNumber) {
  if (beatNumber > MAX_INTERACTIVE_BEATS) return 'end';
  return computeOpenBeatNumbers(outlineId).includes(beatNumber) ? 'open' : 'mcq';
}

function getChoiceIds(beatNumber) {
  return beatNumber === 1 ? ['investigate', 'ask', 'wait'] : ['investigate', 'ask'];
}

/* ── Setting normalization ────────────────────────────────────────────────── */
function cleanSetting(raw) {
  let s = String(raw || 'a quiet town')
    .replace(/^an image of /i, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Lowercase first letter (it appears mid-sentence)
  if (s.length) s = s[0].toLowerCase() + s.slice(1);
  // Strip trailing prepositions that create dangling grammar
  s = s.replace(/\s+(in|at|on|to|for|with|from|by|of)$/i, '');
  // Limit to 5 words
  const words = s.split(/\s+/);
  if (words.length > 5) s = words.slice(0, 5).join(' ');
  return s;
}

/* ── MCQ segment templates ───────────────────────────────────────────────── */
// Each returns a string that fitWords() will keep within 50-60 words.

function mcqSegmentBeat1(c, setting) {
  const raw = `${c} stepped off the bus and walked toward ${setting} early in the morning. The sky was blue, but the front door was locked with a heavy chain. A folded map lay on the ground near the entrance. ${c} picked it up and noticed a red circle marking a spot behind the building. Something interesting was waiting there.`;
  return fitWords(raw, 50, 60);
}

function mcqSegmentLater(c, prev) {
  let raw;
  if (prev === 'investigate') {
    raw = `${c} walked behind the building and found a narrow path between two old walls. At the end, there was a small wooden door with a number painted on it. ${c} pushed the door open, and inside there was a dusty room full of old books and papers. One book had a bright yellow ribbon marking a page.`;
  } else if (prev === 'ask') {
    raw = `${c} met a friendly shop owner who was standing outside and sweeping the sidewalk. The woman smiled and said there was a hidden garden behind the main street. She gave ${c} a small brass key and pointed toward a green gate. The gate was easy to find because it had flowers growing around it.`;
  } else {
    raw = `${c} waited quietly on a bench for several minutes, watching people pass by. Then, a small grey cat walked over and sat down next to the bench. The cat had a tiny metal tag on its collar with an address on it. ${c} wrote down the address, feeling that it could be an important clue.`;
  }
  return fitWords(raw, 50, 60);
}

/* ── Open segment templates ──────────────────────────────────────────────── */
function openSegment(c, beatNumber) {
  let raw;
  if (beatNumber <= 2) {
    raw = `${c} sat on a wooden bench under a tree and opened the folded map again. The red circle was clear, but the rest of the map was faded and hard to read. There was a small notebook in a jacket pocket, so ${c} started to write down every important detail. It was time to think carefully before making a move.`;
  } else if (beatNumber <= 4) {
    raw = `The address on the tag led ${c} to a tall stone building at the end of a quiet street. Inside, the air was cool, and the halls were empty. In the middle of a large room, there was a polished wooden box sitting on a stone table. Warm sunlight came through a high window and lit up the box.`;
  } else {
    raw = `${c} noticed a row of carved symbols along the wall beside the doorway. Each symbol seemed to show a different part of an old story about the town. Two of the symbols matched the marks from the folded map perfectly. Everything was starting to make sense now. ${c} felt ready to take the final step forward.`;
  }
  return fitWords(raw, 50, 60);
}

/* ── Ending segment & endWrap ────────────────────────────────────────────── */
function endingSegment(c) {
  const raw = `${c} carefully lifted the lid of the wooden box with both hands. Inside, there was a small golden compass that pointed to the words "Well done" on its face. ${c} smiled and held the compass up to the sunlight. The quest was complete, and the day had been full of wonderful surprises and new discoveries.`;
  return fitWords(raw, 50, 60);
}

function endingWrap(c) {
  const raw = `This journey showed that patience and curiosity always lead to good things. The best discoveries come from paying attention to the small, quiet details around you.`;
  return fitWords(raw, 20, 30);
}

/* ── Beat generator ──────────────────────────────────────────────────────── */
function generateBeat(outline, outlineId, beatNumber, pathArr) {
  const c = (outline.characters?.[0]?.name) || 'Mai';
  const setting = cleanSetting(outline.setting);
  const qType = getQuestionType(outlineId, beatNumber);

  // ── ENDING BEAT ────────────────────────────────────────────
  if (qType === 'end') {
    return {
      formatVersion: 2,
      questionType: 'end',
      segment: endingSegment(c),
      recap: `${c} opened the box and completed the adventure successfully.`,
      highlights: ['beautiful old box', 'small golden item', 'smiled happily', 'big adventure'],
      endWrap: endingWrap(c),
      shouldEnd: true
    };
  }

  // ── OPEN BEAT ──────────────────────────────────────────────
  if (qType === 'open') {
    return {
      formatVersion: 2,
      questionType: 'open',
      segment: openSegment(c, beatNumber),
      recap: `${c} studied the situation carefully and prepared to act.`,
      highlights: ['careful', 'clues', 'details'],
      productionPrompt: { question: OPEN_PROMPT },
      shouldEnd: false
    };
  }

  // ── MCQ BEAT ───────────────────────────────────────────────
  const choiceIds = getChoiceIds(beatNumber);
  const isBeat1 = beatNumber === 1;
  const seg = isBeat1 ? mcqSegmentBeat1(c, setting) : mcqSegmentLater(c, pathArr[pathArr.length - 1] || 'investigate');

  const options = choiceIds.map(id => {
    const labels = {
      investigate: isBeat1
        ? 'Look around the area carefully for small helpful clues.'
        : 'Try to use the discovery to solve the next part.',
      ask: isBeat1
        ? 'Find a friendly local person and ask for help.'
        : 'Ask someone nearby to explain what this clue means.',
      wait: 'Stay quiet and watch to see what happens next.'
    };
    return { id, label: labels[id] };
  });

  return {
    formatVersion: 2,
    questionType: 'mcq',
    segment: seg,
    recap: isBeat1
      ? `${c} arrived and found an unexpected problem blocking the way.`
      : `${c} discovered a new clue that could help solve the challenge.`,
    highlights: isBeat1 ? [c, 'warm morning', 'sudden problem', 'old signs'] : ['new clue', 'important', 'challenge'],
    choiceQuestion: {
      question: isBeat1 ? `What should ${c} do first?` : `What should ${c} do with this new discovery?`,
      options
    },
    shouldEnd: false
  };
}

/* ── Pre-flight validation ────────────────────────────────────────────────── */
function validate(beat, qType) {
  if (beat.formatVersion !== 2) return 'formatVersion != 2';
  const sw = countWords(beat.segment);
  if (sw < 50 || sw > 60) return `segment words ${sw} not in [50,60]`;
  const rw = countWords(beat.recap);
  if (rw > 20) return `recap words ${rw} > 20`;
  if (beat.questionType !== qType) return `questionType ${beat.questionType} != ${qType}`;
  if (qType === 'end') {
    if (!beat.shouldEnd) return 'shouldEnd=false for end beat';
    const ew = countWords(beat.endWrap);
    if (ew < 20 || ew > 30) return `endWrap words ${ew} not in [20,30]`;
  }
  if (qType === 'mcq') {
    if (beat.shouldEnd) return 'shouldEnd=true for mcq';
    if (!beat.choiceQuestion?.options?.length) return 'no choiceQuestion options';
  }
  if (qType === 'open') {
    if (beat.shouldEnd) return 'shouldEnd=true for open';
    if (!beat.productionPrompt?.question) return 'no productionPrompt';
  }
  return null;
}

/* ── Main ────────────────────────────────────────────────────────────────── */
async function main() {
  // Pre-flight with dummy outline
  console.log('── Pre-flight validation ──');
  const dummyOutline = { characters: [{ name: 'Mai' }], setting: 'a quiet town', title: 'Test' };
  const dummyId = 'dummy_test_id';
  const openBeats = computeOpenBeatNumbers(dummyId);
  console.log(`  dummy openBeats: ${openBeats}`);

  let allOk = true;
  for (let bn = 1; bn <= ENDING_BEAT_NUMBER; bn++) {
    const qt = getQuestionType(dummyId, bn);
    const beat = generateBeat(dummyOutline, dummyId, bn, ['investigate', 'ask', 'open_text_response', 'investigate', 'ask'].slice(0, Math.max(0, bn - 1)));
    const err = validate(beat, qt);
    const sw = countWords(beat.segment);
    const ew = beat.endWrap ? countWords(beat.endWrap) : '-';
    console.log(`  Beat ${bn} [${qt}]: seg=${sw}w endWrap=${ew}w ${err ? '❌ ' + err : '✅'}`);
    if (err) allOk = false;
  }

  if (!allOk) {
    console.error('\n❌ Pre-flight FAILED. Fix templates before batch run.');
    process.exit(1);
  }
  console.log('✅ Pre-flight passed!\n');

  // Batch generation — use actual choice IDs for paths (not 'open_text_response')
  // The route's simplified-path fallback handles mismatches
  const allOutlines = await cache.listCachedOutlines();
  console.log(`Processing ${allOutlines.length} outlines × 6 paths × ${ENDING_BEAT_NUMBER} beats...`);

  const B1_CHOICES = ['investigate', 'ask', 'wait'];
  const B2_CHOICES = ['investigate', 'ask'];
  let beatsWritten = 0;
  let outlinesProcessed = 0;

  for (const entry of allOutlines) {
    const outlineId = entry.id;
    const outline = entry.value;
    if (!outline || !outlineId) continue;
    outlinesProcessed++;
    if (outlinesProcessed % 50 === 0 || outlinesProcessed <= 3) {
      console.log(`[${outlinesProcessed}/${allOutlines.length}] ${(outline.title || '').substring(0, 45)}`);
    }

    // Generate for 6 path combinations (3 first choices × 2 second choices)
    for (const b1Choice of B1_CHOICES) {
      for (const b2Choice of B2_CHOICES) {
        for (let bn = 1; bn <= ENDING_BEAT_NUMBER; bn++) {
          // Build path using actual choice IDs at each position
          const pathArr = [];
          for (let prevBn = 1; prevBn < bn; prevBn++) {
            if (prevBn === 1) pathArr.push(b1Choice);
            else pathArr.push(b2Choice);
          }

          const qt = getQuestionType(outlineId, bn);
          const beatData = generateBeat(outline, outlineId, bn, pathArr);
          const err = validate(beatData, qt);
          if (err) {
            console.error(`❌ Validation failed for "${outline.title}" beat ${bn} path ${pathArr.join('.')}: ${err}`);
            continue;
          }

          const beatKey = cache.computeBeatCacheKey({ outlineId, beatNumber: bn, path: pathArr });
          await cache.setCachedValue({
            collection: COLLECTION_BEATS,
            id: beatKey.id,
            key: beatKey.key,
            value: beatData,
            ttlMs: cache.resolveTtlMs()
          });
          beatsWritten++;
        }
      }
    }
  }

  console.log(`\n🎉 Done! ${outlinesProcessed} outlines → ${beatsWritten} beats total.`);
  process.exit(0);
}

main().catch(err => { console.error('❌', err); process.exit(1); });
