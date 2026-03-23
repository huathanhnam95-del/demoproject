require('dotenv').config();
const cache = require('./src/services/reading-journey/cache');
const crypto = require('crypto');

const MAX_INTERACTIVE_BEATS = 5;
const OPEN_BEAT_COUNT = 2;
const ENDING_BEAT_NUMBER = 6;

function computeOpenBeatNumbers(outlineId) {
  const base = String(outlineId || '').trim();
  if (!base) return [2, 4];
  const hash = crypto.createHash('sha256').update(`reading_journey_plan_v1|${base}`).digest();
  const picked = new Set();
  for (let i = 0; i < hash.length && picked.size < OPEN_BEAT_COUNT; i++) {
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

function countWords(s) { return s.split(/\s+/).filter(Boolean).length; }

function getChoiceIdsForBeat(beatNumber) {
  return beatNumber === 1 ? ['investigate', 'ask', 'wait'] : ['investigate', 'ask'];
}

function hasValidChoiceQuestion(cq, opts = {}) {
  if (!cq || typeof cq !== 'object') return false;
  const q = String(cq.question || '').trim();
  if (!q) return false;
  const options = Array.isArray(cq.options) ? cq.options : [];
  const expected = opts.expectedOptionCount || 3;
  return options.length === expected;
}

function isValidBeatPayload(beat, { beatNumber, questionType }) {
  if (!beat || typeof beat !== 'object') return 'not object';
  if (Number(beat.formatVersion) !== 2) return 'formatVersion != 2 (got: ' + beat.formatVersion + ')';
  const segment = String(beat.segment || '').trim();
  const wc = countWords(segment);
  if (wc < 50 || wc > 60) return 'word count ' + wc + ' not in 50-60';
  const shouldEnd = Boolean(beat.shouldEnd);
  const safeBeat = Number(beatNumber);
  if (!Number.isFinite(safeBeat) || safeBeat < 1 || safeBeat > ENDING_BEAT_NUMBER) return 'invalid beat number';
  const recap = String(beat.recap || '').trim();
  if (recap && countWords(recap) > 20) return 'recap too long';
  
  const expectedType = String(questionType || '').trim().toLowerCase();
  if (!expectedType) return 'no expected type';
  if (String(beat.questionType || '').trim().toLowerCase() !== expectedType) {
    return 'questionType mismatch: cached=' + beat.questionType + ' expected=' + expectedType;
  }
  
  if (safeBeat <= MAX_INTERACTIVE_BEATS) {
    if (shouldEnd) return 'shouldEnd on interactive beat';
    if (expectedType === 'mcq') {
      const expectedChoiceIds = getChoiceIdsForBeat(safeBeat);
      const expectedCount = expectedChoiceIds.length;
      if (!hasValidChoiceQuestion(beat.choiceQuestion, { expectedOptionCount: expectedCount })) return 'invalid choiceQuestion';
      return null; // valid
    }
    if (expectedType === 'open') {
      const question = String(beat.productionPrompt?.question || '').trim();
      if (!question) return 'missing productionPrompt.question';
      if (beat.choiceQuestion) return 'open beat has choiceQuestion';
      return null; // valid
    }
    return 'unknown type';
  }
  
  // ending beat
  if (!shouldEnd) return 'ending beat missing shouldEnd';
  const endWrap = String(beat.endWrap || '').trim();
  if (!endWrap) return 'missing endWrap';
  return null; // valid
}

(async () => {
  const outlines = await cache.listCachedOutlines();
  console.log(`Checking beat 1 validation for all ${outlines.length} outlines...`);
  
  let pass = 0, fail = 0;
  const failures = [];
  
  for (const entry of outlines) {
    const outlineId = entry.id;
    const qt = getQuestionType(outlineId, 1);
    const beatKey = cache.computeBeatCacheKey({ outlineId, beatNumber: 1, path: [] });
    const beat = await cache.getCachedValue({ collection: 'reading_journey_beats_v1', id: beatKey.id });
    
    const err = isValidBeatPayload(beat, { beatNumber: 1, questionType: qt });
    if (err) {
      fail++;
      if (failures.length < 5) failures.push({ title: entry.value?.title, outlineId, qt, err });
    } else {
      pass++;
    }
  }
  
  console.log(`\nResults: ${pass} pass, ${fail} fail out of ${outlines.length}`);
  if (failures.length) {
    console.log('\nFirst failures:');
    failures.forEach(f => console.log(`  "${f.title}" (${f.outlineId.substring(0,12)}...) expected=${f.qt} err=${f.err}`));
  }
  
  process.exit(0);
})();
