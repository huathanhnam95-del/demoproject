#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regenerate Full Story Tree (all 6 paths per outline)
 *
 * For the new 3-beat structure (3×2×1 = 6 paths):
 *   Beat 1: MCQ with 3 options (investigate, ask, wait)
 *   Beat 2: MCQ with 2 options (investigate, ask)
 *   Beat 3: Open-ended (1 option — auto-advance)
 *   Beat 4: Ending
 *
 * Each path is scored and regenerated until it passes (≥ 7.0) or max retries.
 *
 * Usage:
 *   node scripts/regen-full-tree.js --dry-run --limit 1
 *   node scripts/regen-full-tree.js --apply --limit 5
 *   node scripts/regen-full-tree.js --apply --offset 0 --limit 5 --max-retries 3
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');

// Set GOOGLE_APPLICATION_CREDENTIALS if not already set
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  const saKeyPath = path.join(__dirname, '..', 'serviceAccountKey.json');
  if (fs.existsSync(saKeyPath)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = saKeyPath;
  }
}

const cache = require('../src/services/reading-journey/cache');
const rubric = require('../src/services/reading-journey/rubric');
const { safeJsonParse, countWords, trimToMaxWords } = require('../src/services/reading-journey/json');

const COLLECTION_OUTLINES = 'reading_journey_outlines_v1';
const COLLECTION_BEATS = 'reading_journey_beats_v1';
const MAX_INTERACTIVE_BEATS = 3;
const ENDING_BEAT_NUMBER = MAX_INTERACTIVE_BEATS + 1;
const CANONICAL_CHOICE_IDS = ['investigate', 'ask', 'wait'];
const BEAT_2_CHOICE_IDS = ['investigate', 'ask'];
const PROGRESS_FILE = path.join(__dirname, '..', 'docs', 'audits', 'reading-journey-quality', 'progress.json');

const DEFAULT_PROJECT = 'listening-tasks-3ae34';
const DEFAULT_MODEL = 'gemini-3.1-pro-preview';

const OPEN_PRODUCTION_PROMPT = 'In 1–2 sentences: summarize what happened, then say what you do next (investigate, ask, or wait) and why.';

/**
 * All 6 path combinations for the 3-beat tree.
 * Beat 1 has 3 choices, Beat 2 has 2 choices, Beat 3 is open (auto-advance).
 */
const ALL_PATHS = [];
for (const b1 of CANONICAL_CHOICE_IDS) {
  for (const b2 of BEAT_2_CHOICE_IDS) {
    ALL_PATHS.push([b1, b2, 'open']);
  }
}

// ── Args ────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    apply: false,
    dryRun: false,
    limit: 0,
    offset: 0,
    maxRetries: 3,
    sleepMs: 2000,
    model: DEFAULT_MODEL,
    outlineId: '' // single outline mode
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') { args.apply = true; continue; }
    if (arg === '--dry-run') { args.dryRun = true; continue; }
    if (arg === '--limit') { args.limit = Number(argv[i + 1]); i += 1; continue; }
    if (arg === '--offset') { args.offset = Number(argv[i + 1]); i += 1; continue; }
    if (arg === '--max-retries') { args.maxRetries = Number(argv[i + 1]); i += 1; continue; }
    if (arg === '--sleep-ms') { args.sleepMs = Number(argv[i + 1]); i += 1; continue; }
    if (arg === '--model') { args.model = argv[i + 1]; i += 1; continue; }
    if (arg === '--outline') { args.outlineId = argv[i + 1]; i += 1; continue; }
  }

  if (args.dryRun) args.apply = false;
  return args;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function normalizeScalar(v) { return String(v ?? '').trim(); }

// ── Progress tracking ───────────────────────────────────────────────────────────

const progress = {
  startedAt: null,
  status: 'initializing',
  mode: 'regen-full-tree',
  batch: { offset: 0, limit: 0, totalOutlines: 0 },
  current: { outlineIndex: 0, outlineTitle: '', outlineLevel: '', pathIndex: 0, totalPaths: ALL_PATHS.length, pathLabel: '' },
  totals: { passed: 0, failed: 0, errors: 0 },
  completedOutlines: [],
  recentPaths: []
};

function writeProgress() {
  try {
    progress.updatedAt = Date.now();
    fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true });
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf8');
  } catch (_) { /* non-critical */ }
}

// ── Vertex AI REST API wrapper ──────────────────────────────────────────────────

async function createModelWrapper(modelName) {
  const { GoogleAuth } = require('google-auth-library');
  const project = String(process.env.FIREBASE_PROJECT_ID || process.env.CLIENT_FIREBASE_PROJECT_ID || DEFAULT_PROJECT).trim();

  const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
  const client = await auth.getClient();

  // Verify connectivity
  const testUrl = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${modelName}:generateContent`;
  const testBody = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Say OK' }] }], generationConfig: { temperature: 0.1 } });
  const testToken = await client.getAccessToken();
  const testRes = await fetch(testUrl, { method: 'POST', headers: { 'Authorization': `Bearer ${testToken.token}`, 'Content-Type': 'application/json' }, body: testBody });
  if (!testRes.ok) {
    const errText = await testRes.text().catch(() => '');
    throw new Error(`Vertex AI connectivity test failed (HTTP ${testRes.status}): ${errText.substring(0, 300)}`);
  }
  const testData = await testRes.json();
  console.log(`   ✅ Model verified: ${modelName} → "${(testData.candidates?.[0]?.content?.parts?.[0]?.text || '').substring(0, 30).trim()}"`);

  const baseUrl = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${modelName}:generateContent`;

  return {
    provider: 'vertex-ai',
    modelName,
    generateJson: async (prompt, { temperature = 0.5 } = {}) => {
      const MAX_API_RETRIES = 4;
      const BACKOFF_BASE_MS = 5000;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const finalPrompt = attempt === 0 ? prompt : `${prompt}\n\nIMPORTANT: Return ONLY valid raw JSON.`;
        const reqBody = JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: finalPrompt }] }],
          generationConfig: { temperature, responseMimeType: 'application/json' }
        });

        let lastError = null;
        for (let apiRetry = 0; apiRetry < MAX_API_RETRIES; apiRetry += 1) {
          try {
            const token = await client.getAccessToken();
            const res = await fetch(baseUrl, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token.token}`, 'Content-Type': 'application/json' },
              body: reqBody
            });

            if (res.status === 429 || res.status === 499 || res.status === 503) {
              const waitMs = BACKOFF_BASE_MS * Math.pow(2, apiRetry);
              console.log(`       ⏳ HTTP ${res.status} — backing off ${(waitMs / 1000).toFixed(0)}s (retry ${apiRetry + 1}/${MAX_API_RETRIES})`);
              await sleep(waitMs);
              continue;
            }

            if (!res.ok) {
              const errText = await res.text().catch(() => '');
              throw new Error(`Vertex AI HTTP ${res.status}: ${errText.substring(0, 200)}`);
            }

            const data = await res.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const parsed = safeJsonParse(text);
            if (parsed) return parsed;
            lastError = new Error('JSON parse failed');
            break;
          } catch (fetchErr) {
            if (fetchErr.message?.includes('Vertex AI HTTP')) throw fetchErr;
            lastError = fetchErr;
            if (apiRetry < MAX_API_RETRIES - 1) {
              const waitMs = BACKOFF_BASE_MS * Math.pow(2, apiRetry);
              console.log(`       ⏳ Network error — backing off ${(waitMs / 1000).toFixed(0)}s (retry ${apiRetry + 1}/${MAX_API_RETRIES})`);
              await sleep(waitMs);
            }
          }
        }
        if (lastError && attempt === 1) throw lastError;
      }
      throw new Error('Failed to parse JSON from Vertex AI response');
    }
  };
}

// ── Beat helpers ────────────────────────────────────────────────────────────────

function getQuestionTypeForBeat(beatNumber) {
  if (beatNumber > MAX_INTERACTIVE_BEATS) return 'end';
  // Fixed layout: beats 1,2 = MCQ; beat 3 = open
  if (beatNumber === 3) return 'open';
  return 'mcq';
}

function getChoiceIdsForBeat(beatNumber) {
  if (beatNumber === 2) return BEAT_2_CHOICE_IDS;
  return CANONICAL_CHOICE_IDS;
}

function buildStorySoFar(previousBeats) {
  const recaps = previousBeats.filter(b => b?.recap).map((b, i) => `${i + 1}) ${b.recap}`);
  const segments = previousBeats.filter(b => b?.segment).map(b => b.segment);
  const parts = [];
  if (recaps.length) parts.push(`Recaps so far: ${recaps.join(' ')}`);
  if (segments.length) parts.push(`Most recent scene: ${segments.slice(-2).join(' ')}`);
  return parts.join('\n');
}

// ── Generate a single beat ──────────────────────────────────────────────────────

function buildBeatPrompt({ outline, beatNumber, pathArr, questionType, storySoFar, level }) {
  const safeLevel = String(level || 'B1').toUpperCase();
  const safeBeat = beatNumber;
  const shouldEnd = safeBeat === ENDING_BEAT_NUMBER;
  const safeQuestionType = shouldEnd ? 'end' : questionType;

  const milestoneBeat = safeBeat > MAX_INTERACTIVE_BEATS ? MAX_INTERACTIVE_BEATS : safeBeat;
  const milestone = (outline?.beatOutline || []).find(b => Number(b?.beat) === milestoneBeat)?.milestone || '';

  const characters = (outline?.characters || [])
    .map(c => `${c?.name || 'Maya'} (${c?.role || 'friend'}: ${c?.goal || 'goal'})`)
    .join('; ');
  const tags = (outline?.topicTags || []).join(', ');

  const effectiveChoiceIds = getChoiceIdsForBeat(beatNumber);
  const choiceIdList = effectiveChoiceIds.join(', ');

  const parts = [
    'Return raw JSON only.',
    'You are writing a cohesive, engaging interactive English reading story.',
    `Language: en. Target CEFR: ${safeLevel}.`,
    'Hard constraints:',
    '- Segment must be 50 to 60 words.',
    '- Recap must be 20 words or fewer.',
    `- This is beat ${safeBeat}/${ENDING_BEAT_NUMBER}.`,
    `- questionType must be "${safeQuestionType}".`,
    '- If questionType is "end", set shouldEnd=true and include endWrap (20 to 30 words).',
    '- Otherwise set shouldEnd=false.',
    '- Keep content PG and classroom-safe. No real celebrities, politicians, or brands.',

    `Vocabulary constraints for ${safeLevel}:`,
    safeLevel === 'A2'
      ? '- Use ONLY common, everyday words (top 2000 frequency). Avoid abstract nouns, idioms, and any B1+ vocabulary. Prefer short sentences (8-12 words).'
      : safeLevel === 'B1'
        ? '- Use mostly common words. A few intermediate words are OK only if surrounding context makes the meaning clear. Avoid B2+ vocabulary like "persistence", "resolution", or "affirmed".'
        : safeLevel === 'B2'
          ? '- Use a mix of common and intermediate vocabulary. Some complex words in context are fine. Avoid rare/academic words.'
          : '- Full range of vocabulary is acceptable for advanced learners.',

    'Continuity rules:',
    '- Continue directly from the story so far; keep the same setting and characters.',
    '- Maintain clear cause-and-effect across beats; avoid sudden topic shifts.',
    '- Reuse important objects and problems; do not invent a new unrelated goal.',
    '- Use a connector (After that, Because of this, Then) to link to the previous beat.',
    '- Mention at least one concrete detail from the most recent scene.',
    'Story contract:',
    `- Title: ${outline?.title || 'Reading Journey'}`,
    `- Setting: ${outline?.setting || '(not provided)'}`,
    `- Premise: ${outline?.premise || '(not provided)'}`,
    `- Topic tags: ${tags || '(none)'}`,
    `- Characters: ${characters || '(none)'}`,
    `- Locked milestone for this beat (${milestoneBeat}/${MAX_INTERACTIVE_BEATS}): ${milestone}`,
    `- User choices so far (IDs): ${pathArr.join(', ') || '(none yet)'}`,

    'Choice narrative guide (use the MOST RECENT choice to shape this beat\'s tone):',
    '- investigate: The character actively searches, examines closely, or discovers something new.',
    '- ask: The character talks to someone, asks questions, or learns new information through dialogue.',
    '- wait: The character pauses and observes carefully, noticing a subtle clue or having a realization.',
    '  CRITICAL for "wait": waiting MUST still advance the plot.',
    'Now generate this beat.'
  ];

  if (storySoFar) {
    parts.push('Story so far (continue from this, do not restart):', storySoFar);
  }

  if (safeQuestionType === 'mcq') {
    parts.push(
      'MCQ rules:',
      `- Include choiceQuestion with exactly ${effectiveChoiceIds.length} options.`,
      `- Use ONLY these option IDs: ${choiceIdList}.`,
      '- Each option.label must be 6-12 words, CEFR-appropriate, and fit the current milestone.',
      '- Do NOT include productionPrompt.'
    );
  } else if (safeQuestionType === 'open') {
    parts.push(
      'Open question rules:',
      '- Do NOT include choiceQuestion.',
      `- Include productionPrompt.question EXACTLY: "${OPEN_PRODUCTION_PROMPT}"`,
      '- Do NOT include choiceQuestion.'
    );
  } else {
    parts.push(
      'Ending rules:',
      '- Do NOT include choiceQuestion or productionPrompt.',
      '- Resolve the story clearly and naturally.'
    );
  }

  parts.push(
    'JSON schema:',
    '{',
    '  "formatVersion": 2,',
    '  "questionType": "mcq|open|end",',
    '  "segment": "string",',
    '  "recap": "string",',
    '  "highlights": ["word or phrase", "...up to 6 items"],',
    '  "choiceQuestion": { "question": "What do you do next?", "options": [ {"id":"investigate","label":"..."}, ... ] },',
    '  "productionPrompt": { "question": "string" },',
    '  "shouldEnd": true/false,',
    '  "endWrap": "string"',
    '}',
    'Highlights rules:',
    '- Pick 3 to 6 words or short phrases (1-3 words each) from the segment.',
    '- Choose the most important vocabulary, key topic terms, or main-idea phrases.',
    '- Do NOT include grammar words (the, and, is, etc.).',
    '- Return them as exact substrings of the segment (case-insensitive match is fine).'
  );

  return parts.join('\n');
}

// ── Regenerate a single path (all beats) ────────────────────────────────────────

async function regeneratePath({ wrapper, outlineId, outline, level, pathChoices, apply }) {
  const beats = [];
  const segments = [];

  for (let beatNumber = 1; beatNumber <= ENDING_BEAT_NUMBER; beatNumber += 1) {
    const questionType = getQuestionTypeForBeat(beatNumber);
    const pathArr = pathChoices.slice(0, Math.max(0, beatNumber - 1));
    const storySoFar = buildStorySoFar(beats);

    const prompt = buildBeatPrompt({ outline, beatNumber, pathArr, questionType, storySoFar, level });
    const json = await wrapper.generateJson(prompt, { temperature: 0.5 });

    const effectiveChoiceIds = getChoiceIdsForBeat(beatNumber);

    const beat = {
      formatVersion: 2,
      questionType: questionType,
      segment: normalizeScalar(json?.segment),
      recap: normalizeScalar(json?.recap) ? trimToMaxWords(normalizeScalar(json.recap), 20) : '',
      highlights: Array.isArray(json?.highlights) ? json.highlights.map(h => normalizeScalar(h)).filter(h => h.length > 0 && h.length <= 40).slice(0, 6) : [],
      choiceQuestion: questionType === 'mcq' && json?.choiceQuestion ? {
        question: normalizeScalar(json.choiceQuestion.question) || 'What do you do next?',
        options: effectiveChoiceIds.map(id => ({
          id,
          label: (Array.isArray(json.choiceQuestion.options) ? json.choiceQuestion.options : [])
            .find(o => normalizeScalar(o?.id).toLowerCase() === id)?.label || `${id.charAt(0).toUpperCase() + id.slice(1)} and see what happens.`
        }))
      } : null,
      productionPrompt: questionType === 'open' ? { question: OPEN_PRODUCTION_PROMPT } : null,
      shouldEnd: beatNumber === ENDING_BEAT_NUMBER
    };

    if (beat.shouldEnd) {
      beat.endWrap = normalizeScalar(json?.endWrap) || 'The story comes to a peaceful close.';
      if (countWords(beat.endWrap) > 30) beat.endWrap = trimToMaxWords(beat.endWrap, 30);
    }

    // Enforce segment word count
    let seg = beat.segment;
    if (countWords(seg) > 60) seg = trimToMaxWords(seg, 60);
    beat.segment = seg;

    beats.push({ beatNumber, path: pathArr, ...beat });
    if (beat.segment) segments.push(beat.segment);

    if (apply) {
      const beatKey = cache.computeBeatCacheKey({ outlineId, beatNumber, path: pathArr });
      await cache.setCachedValue({
        collection: COLLECTION_BEATS,
        id: beatKey.id,
        key: beatKey.key,
        value: beat,
        ttlMs: cache.resolveTtlMs()
      });
    }

    await sleep(200);
  }

  // Assess the full story
  const segText = segments.join(' ');
  const endWrap = (beats[beats.length - 1] || {}).endWrap || '';
  const storyText = `${segText}${endWrap ? ` ${endWrap}` : ''}`.trim();

  const assessPrompt = rubric.getAssessmentPrompt(level);
  const assessJson = await wrapper.generateJson(`${assessPrompt}\n\nStory text:\n${storyText.slice(0, 6000)}`, { temperature: 0.2 });

  const scores = {
    plot: Math.max(1, Math.min(10, Number(assessJson?.plot) || 1)),
    character: Math.max(1, Math.min(10, Number(assessJson?.character) || 1)),
    vocabulary: Math.max(1, Math.min(10, Number(assessJson?.vocabulary) || 1)),
    grammar: Math.max(1, Math.min(10, Number(assessJson?.grammar) || 1)),
    pacing: Math.max(1, Math.min(10, Number(assessJson?.pacing) || 1)),
    emotion: Math.max(1, Math.min(10, Number(assessJson?.emotion) || 1)),
    setting: Math.max(1, Math.min(10, Number(assessJson?.setting) || 1)),
    coherence: Math.max(1, Math.min(10, Number(assessJson?.coherence) || 1))
  };
  const flags = {
    tooHard: Boolean(assessJson?.flags?.tooHard),
    tooEasy: Boolean(assessJson?.flags?.tooEasy),
    unsafe: Boolean(assessJson?.flags?.unsafe)
  };
  const result = rubric.computeWeightedScore(scores, level, flags);

  return { storyText, ...result, scores };
}

// ── Main ────────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  console.log('═══════════════════════════════════════════════════');
  console.log(' Reading Journey — Regenerate Full Tree (6 paths)');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Mode:        ${args.apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`  Max Retries: ${args.maxRetries}`);
  console.log(`  Paths/tree:  ${ALL_PATHS.length}`);
  console.log(`  Path combos: ${ALL_PATHS.map(p => p.slice(0, 2).join('→')).join(', ')}`);

  // 1. Create model wrapper
  const wrapper = await createModelWrapper(args.model);
  console.log(`\n✅ Provider: ${wrapper.provider} → ${wrapper.modelName}\n`);

  // 2. Load outlines
  let outlines;
  if (args.outlineId) {
    const outline = await cache.getCachedValue({ collection: COLLECTION_OUTLINES, id: args.outlineId });
    if (!outline) {
      console.error(`❌ Outline not found: ${args.outlineId}`);
      process.exit(1);
    }
    outlines = [{ id: args.outlineId, value: outline }];
  } else {
    outlines = await cache.listCachedOutlines();
  }

  console.log(`  Total outlines: ${outlines.length}`);

  const sliceStart = args.offset || 0;
  const sliceEnd = args.limit > 0 ? sliceStart + args.limit : outlines.length;
  const toProcess = outlines.slice(sliceStart, sliceEnd);
  console.log(`  Processing:     ${sliceStart + 1}–${sliceStart + toProcess.length} of ${outlines.length}\n`);

  // Init progress
  progress.startedAt = Date.now();
  progress.status = 'running';
  progress.batch = { offset: sliceStart, limit: toProcess.length, totalOutlines: outlines.length };
  progress.provider = wrapper.provider;
  progress.model = wrapper.modelName;
  writeProgress();

  // 3. Process each outline
  let passedCount = 0;
  let failedCount = 0;
  let errorCount = 0;
  const perOutlineResults = [];

  for (let i = 0; i < toProcess.length; i += 1) {
    const entry = toProcess[i];
    const outlineId = String(entry?.id || entry?.outlineId || '').trim();
    if (!outlineId) continue;

    const outline = entry.value || await cache.getCachedValue({ collection: COLLECTION_OUTLINES, id: outlineId });
    if (!outline) {
      console.log(`[${i + 1}/${toProcess.length}] ⏭ Skipped ${outlineId.slice(0, 12)}… (not in cache)`);
      continue;
    }

    const title = String(outline?.title || '').slice(0, 40);
    const level = String(outline?.level || entry?.key?.match?.(/level:(\w+)/)?.[1] || 'B1').toUpperCase();

    console.log(`[${i + 1}/${toProcess.length}] ${outlineId.slice(0, 12)}… "${title}" (${level})`);
    progress.current = { outlineIndex: i + 1, outlineTitle: title, outlineLevel: level, pathIndex: 0, totalPaths: ALL_PATHS.length, pathLabel: '' };
    writeProgress();

    const pathResults = [];

    for (let p = 0; p < ALL_PATHS.length; p += 1) {
      const pathChoices = ALL_PATHS[p];
      const pathLabel = pathChoices.slice(0, 2).join('→');

      progress.current.pathIndex = p + 1;
      progress.current.pathLabel = pathLabel;
      writeProgress();

      let bestScore = 0;
      let bestPassed = false;
      let bestCriticals = [];
      let lastAppliedOnPass = false;

      for (let attempt = 1; attempt <= args.maxRetries; attempt += 1) {
        try {
          // Only apply on the attempt that passes, or on last attempt
          const shouldApply = args.apply;
          const result = await regeneratePath({
            wrapper,
            outlineId,
            outline,
            level,
            pathChoices,
            apply: shouldApply && (attempt === args.maxRetries) // tentatively apply last attempt
          });

          if (result.weightedAverage > bestScore) {
            bestScore = result.weightedAverage;
            bestPassed = result.passed;
            bestCriticals = result.criticalFailures;
          }

          // If it passes and we haven't applied yet, apply now and break
          if (result.passed) {
            if (shouldApply && attempt < args.maxRetries) {
              // Re-run with apply=true since the passing attempt needs to be saved
              await regeneratePath({ wrapper, outlineId, outline, level, pathChoices, apply: true });
            }
            lastAppliedOnPass = true;
            break;
          }
        } catch (err) {
          console.error(`     ⚠ Attempt ${attempt} error: ${err.message}`);
          if (attempt < args.maxRetries) await sleep(args.sleepMs * 2);
        }
      }

      if (bestScore === 0) {
        console.log(`     ❌ [${pathLabel}] ERROR — all attempts failed`);
        errorCount += 1;
        pathResults.push({ path: pathLabel, score: 0, passed: false, error: true });
      } else {
        const symbol = bestPassed ? '✅' : '❌';
        console.log(`     ${symbol} [${pathLabel}] score=${bestScore.toFixed(1)} ${bestPassed ? 'PASS' : 'FAIL'}${bestCriticals.length ? ` criticals=[${bestCriticals.join(',')}]` : ''}`);

        if (bestPassed) passedCount += 1;
        else failedCount += 1;

        pathResults.push({ path: pathLabel, score: bestScore, passed: bestPassed, criticals: bestCriticals, appliedOnPass: lastAppliedOnPass });
      }

      progress.totals = { passed: passedCount, failed: failedCount, errors: errorCount };
      progress.recentPaths = [
        { pathLabel, score: bestScore, passed: bestPassed, outline: title },
        ...progress.recentPaths.slice(0, 19)
      ];
      writeProgress();

      if (args.sleepMs > 0 && p < ALL_PATHS.length - 1) await sleep(args.sleepMs);
    }

    const outlinePassed = pathResults.filter(r => r.passed).length;
    console.log(`   📊 ${outlinePassed}/${ALL_PATHS.length} paths passed`);

    perOutlineResults.push({
      outlineId,
      title,
      level,
      pathsProcessed: pathResults.length,
      pathsPassed: outlinePassed,
      pathsFailed: pathResults.filter(r => !r.passed && !r.error).length,
      pathsError: pathResults.filter(r => r.error).length,
      paths: pathResults
    });

    progress.completedOutlines.push({
      title,
      level,
      passed: outlinePassed,
      failed: ALL_PATHS.length - outlinePassed
    });
    writeProgress();
  }

  // 4. Summary
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' FULL TREE REGENERATION SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Outlines processed: ${perOutlineResults.length}`);
  console.log(`  Paths passed:       ${passedCount}`);
  console.log(`  Paths failed:       ${failedCount}`);
  console.log(`  Paths errored:      ${errorCount}`);
  console.log(`  Pass rate:          ${((passedCount / Math.max(1, passedCount + failedCount)) * 100).toFixed(1)}%`);

  // 5. Write report
  const date = new Date().toISOString().slice(0, 10);
  const outputRoot = path.join('docs', 'audits', 'reading-journey-quality', date);
  fs.mkdirSync(outputRoot, { recursive: true });
  const reportPath = path.join(outputRoot, `regen-full-tree-${date}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({
    date,
    mode: args.apply ? 'apply' : 'dry-run',
    model: wrapper.modelName,
    structureInfo: { maxInteractiveBeats: MAX_INTERACTIVE_BEATS, pathCombinations: ALL_PATHS.length, beatLayout: 'Beat1:MCQ(3) → Beat2:MCQ(2) → Beat3:Open(1) → Beat4:Ending' },
    summary: {
      outlinesProcessed: perOutlineResults.length,
      passed: passedCount,
      failed: failedCount,
      errors: errorCount,
      passRate: Number(((passedCount / Math.max(1, passedCount + failedCount)) * 100).toFixed(1))
    },
    perOutline: perOutlineResults
  }, null, 2) + '\n', 'utf8');
  console.log(`\n📄 Report: ${reportPath}`);

  progress.status = 'done';
  progress.finishedAt = Date.now();
  writeProgress();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('❌ Fatal error:', err?.message || err);
  process.exit(1);
});
