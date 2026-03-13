#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regenerate Failed Story Paths (Vertex AI — gemini-3.1-pro-preview)
 *
 * Reads audit results and regenerates only the paths that failed (< 7.0).
 * Uses Vertex AI REST API (global endpoint) with the improved prompt.
 * Authenticated via serviceAccountKey.json (Google Cloud $300 free credit).
 *
 * Usage:
 *   node scripts/regenerate-failed-paths.js --dry-run --limit 1
 *   node scripts/regenerate-failed-paths.js --apply --limit 5
 *   node scripts/regenerate-failed-paths.js --apply --offset 0 --limit 5 --max-retries 2
 */

require('dotenv').config();

const crypto = require('crypto');
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
const MAX_INTERACTIVE_BEATS = 5;
const ENDING_BEAT_NUMBER = MAX_INTERACTIVE_BEATS + 1;
const CANONICAL_CHOICE_IDS = ['investigate', 'ask', 'wait'];
const PROGRESS_FILE = path.join(__dirname, '..', 'docs', 'audits', 'reading-journey-quality', 'progress.json');

const DEFAULT_PROJECT = 'listening-tasks-3ae34';
const DEFAULT_MODEL = 'gemini-3.1-pro-preview';

// ── Args ────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    apply: false,
    dryRun: false,
    limit: 0,
    offset: 0,
    maxRetries: 2,
    auditFile: '',
    sleepMs: 2000,
    model: DEFAULT_MODEL
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') { args.apply = true; continue; }
    if (arg === '--dry-run') { args.dryRun = true; continue; }
    if (arg === '--limit') { args.limit = Number(argv[i + 1]); i += 1; continue; }
    if (arg === '--offset') { args.offset = Number(argv[i + 1]); i += 1; continue; }
    if (arg === '--max-retries') { args.maxRetries = Number(argv[i + 1]); i += 1; continue; }
    if (arg === '--audit-file') { args.auditFile = argv[i + 1]; i += 1; continue; }
    if (arg === '--sleep-ms') { args.sleepMs = Number(argv[i + 1]); i += 1; continue; }
    if (arg === '--model') { args.model = argv[i + 1]; i += 1; continue; }
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
  mode: 'regenerate',
  batch: { offset: 0, limit: 0, totalFailed: 0 },
  current: { outlineIndex: 0, outlineTitle: '', outlineLevel: '', pathIndex: 0, totalPaths: 0, pathLabel: '' },
  totals: { improved: 0, stillFailing: 0, errors: 0 },
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

// ── Vertex AI REST API wrapper (global endpoint) ────────────────────────────────

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
      const BACKOFF_BASE_MS = 5000; // 5s, 15s, 30s, 60s

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const finalPrompt = attempt === 0 ? prompt : `${prompt}\n\nIMPORTANT: Return ONLY valid raw JSON.`;
        const reqBody = JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: finalPrompt }] }],
          generationConfig: { temperature, responseMimeType: 'application/json' }
        });

        // Retry loop for rate limits / transient errors
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
              const waitMs = BACKOFF_BASE_MS * Math.pow(2, apiRetry); // 5s, 10s, 20s, 40s
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
            break; // break inner retry, go to next attempt (with stricter prompt)
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

function computeOpenBeatNumbers(outlineId) {
  const base = String(outlineId || '').trim();
  if (!base) return [2, 4];
  const hash = crypto.createHash('sha256').update(`reading_journey_plan_v1|${base}`).digest();
  const picked = new Set();
  for (let i = 0; i < hash.length && picked.size < 2; i += 1) {
    picked.add((hash[i] % MAX_INTERACTIVE_BEATS) + 1);
  }
  const beats = Array.from(picked);
  while (beats.length < 2) {
    const beat = ((beats.length + 1) % MAX_INTERACTIVE_BEATS) + 1;
    if (!beats.includes(beat)) beats.push(beat);
  }
  return beats.sort((a, b) => a - b);
}

function getQuestionTypeForBeat(outlineId, beatNumber) {
  if (beatNumber > MAX_INTERACTIVE_BEATS) return 'end';
  return computeOpenBeatNumbers(outlineId).includes(beatNumber) ? 'open' : 'mcq';
}

function buildStorySoFar(previousBeats) {
  const recaps = previousBeats.filter(b => b?.recap).map((b, i) => `${i + 1}) ${b.recap}`);
  const segments = previousBeats.filter(b => b?.segment).map(b => b.segment);
  const parts = [];
  if (recaps.length) parts.push(`Recaps so far: ${recaps.join(' ')}`);
  if (segments.length) parts.push(`Most recent scene: ${segments.slice(-2).join(' ')}`);
  return parts.join('\n');
}

const OPEN_PRODUCTION_PROMPT = 'In 1–2 sentences: summarize what happened, then say what you do next (investigate, ask, or wait) and why.';

// ── Generate a single beat (with improved prompt) ───────────────────────────────

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

    // ── CEFR vocabulary constraints (NEW) ──
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

    // ── Choice narrative guidance (NEW) ──
    'Choice narrative guide (use the MOST RECENT choice to shape this beat\'s tone):',
    '- investigate: The character actively searches, examines closely, or discovers something new. Show physical action and sensory detail.',
    '- ask: The character talks to someone, asks questions, or learns new information through dialogue. Include direct speech.',
    '- wait: The character pauses and observes carefully, noticing a subtle clue, overhearing something, or having a realization.',
    '  CRITICAL for "wait": waiting MUST still advance the plot. The character must notice, discover, or realize something',
    '  that changes the situation. Pure inaction or repetition of previous events is NEVER acceptable.',
    'Now generate this beat.'
  ];

  if (storySoFar) {
    parts.push('Story so far (continue from this, do not restart):', storySoFar);
  }

  if (safeQuestionType === 'mcq') {
    parts.push(
      'MCQ rules:',
      '- Include choiceQuestion with exactly 3 options.',
      '- Use ONLY these option IDs: investigate, ask, wait.',
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
    '  "choiceQuestion": { "question": "What do you do next?", "options": [ {"id":"investigate","label":"..."}, {"id":"ask","label":"..."}, {"id":"wait","label":"..."} ] },',
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

// ── Regenerate a single path ────────────────────────────────────────────────────

async function regeneratePath({ wrapper, outlineId, outline, level, pathChoices, apply }) {
  const beats = [];
  const segments = [];

  for (let beatNumber = 1; beatNumber <= ENDING_BEAT_NUMBER; beatNumber += 1) {
    const questionType = getQuestionTypeForBeat(outlineId, beatNumber);
    const pathArr = pathChoices.slice(0, Math.max(0, beatNumber - 1));
    const storySoFar = buildStorySoFar(beats);

    const prompt = buildBeatPrompt({ outline, beatNumber, pathArr, questionType, storySoFar, level });
    const json = await wrapper.generateJson(prompt, { temperature: 0.5 });

    const beat = {
      formatVersion: 2,
      questionType: questionType,
      segment: normalizeScalar(json?.segment),
      recap: normalizeScalar(json?.recap) ? trimToMaxWords(normalizeScalar(json.recap), 20) : '',
      highlights: Array.isArray(json?.highlights) ? json.highlights.map(h => normalizeScalar(h)).filter(h => h.length > 0 && h.length <= 40).slice(0, 6) : [],
      choiceQuestion: questionType === 'mcq' && json?.choiceQuestion ? {
        question: normalizeScalar(json.choiceQuestion.question) || 'What do you do next?',
        options: CANONICAL_CHOICE_IDS.map(id => ({
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

    await sleep(200); // Small delay between beats
  }

  // Assess the full story
  const segText = segments.join(' ');
  const endWrap = (beats[beats.length - 1] || {}).endWrap || '';
  const storyText = `${segText}${endWrap ? ` ${endWrap}` : ''}`.trim();

  // Use the same wrapper for assessment
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

// ── Find latest audit file ──────────────────────────────────────────────────────

function findLatestAuditFile() {
  const auditRoot = path.join(__dirname, '..', 'docs', 'audits', 'reading-journey-quality');
  if (!fs.existsSync(auditRoot)) return null;
  const dirs = fs.readdirSync(auditRoot, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .sort((a, b) => b.name.localeCompare(a.name));
  for (const dir of dirs) {
    const files = fs.readdirSync(path.join(auditRoot, dir.name))
      .filter(f => f.startsWith('audit-') && f.endsWith('.json'));
    if (files.length) return path.join(auditRoot, dir.name, files[0]);
  }
  return null;
}

// ── Main ────────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  console.log('═══════════════════════════════════════════════════');
  console.log(' Reading Journey — Regenerate Failed Paths');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Mode:        ${args.apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`  Max Retries: ${args.maxRetries}`);

  // 1. Create model wrapper (AI Studio)
  const wrapper = await createModelWrapper(args.model);
  console.log(`\n✅ Provider: ${wrapper.provider} → ${wrapper.modelName}\n`);

  // 2. Load audit report
  const auditFilePath = args.auditFile || findLatestAuditFile();
  if (!auditFilePath || !fs.existsSync(auditFilePath)) {
    console.error('❌ No audit file found. Run the audit first or specify --audit-file');
    process.exit(1);
  }
  console.log(`  Audit File:  ${auditFilePath}`);

  const auditData = JSON.parse(fs.readFileSync(auditFilePath, 'utf8'));
  const auditResults = Array.isArray(auditData.results) ? auditData.results : [];

  // 3. Collect all failed paths
  const failedWork = [];
  for (const outlineResult of auditResults) {
    const failedPaths = (outlineResult.paths || []).filter(p => p.passed === false && Array.isArray(p.path));
    if (!failedPaths.length) continue;
    failedWork.push({
      outlineId: outlineResult.outlineId,
      title: outlineResult.title,
      level: outlineResult.level,
      failedPaths
    });
  }

  const totalFailedPaths = failedWork.reduce((s, o) => s + o.failedPaths.length, 0);
  console.log(`  Failed Outlines: ${failedWork.length} (of ${auditResults.length} audited)`);
  console.log(`  Failed Paths:    ${totalFailedPaths}`);

  const sliceStart = args.offset || 0;
  const sliceEnd = args.limit > 0 ? sliceStart + args.limit : failedWork.length;
  const toProcess = failedWork.slice(sliceStart, sliceEnd);
  console.log(`  Processing:      Outlines ${sliceStart + 1}–${sliceStart + toProcess.length} of ${failedWork.length}\n`);

  // Init progress
  progress.startedAt = Date.now();
  progress.status = 'running';
  progress.batch = { offset: sliceStart, limit: toProcess.length, totalFailed: totalFailedPaths };
  progress.provider = wrapper.provider;
  progress.model = wrapper.modelName;
  writeProgress();

  // 4. Process
  let improvedCount = 0;
  let stillFailingCount = 0;
  let errorCount = 0;

  for (let i = 0; i < toProcess.length; i += 1) {
    const work = toProcess[i];

    const outline = await cache.getCachedValue({ collection: COLLECTION_OUTLINES, id: work.outlineId });
    if (!outline) {
      console.log(`[${i + 1}/${toProcess.length}] ⏭ Skipped ${work.outlineId.slice(0, 12)}… (not in cache)`);
      continue;
    }

    console.log(`[${i + 1}/${toProcess.length}] ${work.outlineId.slice(0, 12)}… "${work.title}" (${work.level}) — ${work.failedPaths.length} failed`);
    progress.current = { outlineIndex: i + 1, outlineTitle: work.title, outlineLevel: work.level, pathIndex: 0, totalPaths: work.failedPaths.length, pathLabel: '' };
    writeProgress();

    let outlineImproved = 0;

    for (let p = 0; p < work.failedPaths.length; p += 1) {
      const fp = work.failedPaths[p];
      const pathChoices = fp.path;
      const pathLabel = pathChoices.join('→') || 'root';
      const oldScore = fp.weightedAverage || 0;

      progress.current.pathIndex = p + 1;
      progress.current.pathLabel = pathLabel;
      writeProgress();

      let bestScore = 0;
      let bestPassed = false;
      let bestCriticals = [];

      for (let attempt = 1; attempt <= args.maxRetries; attempt += 1) {
        try {
          const result = await regeneratePath({
            wrapper,
            outlineId: work.outlineId,
            outline,
            level: work.level,
            pathChoices,
            apply: args.apply && attempt === args.maxRetries // Apply on last attempt only
          });

          if (result.weightedAverage > bestScore) {
            bestScore = result.weightedAverage;
            bestPassed = result.passed;
            bestCriticals = result.criticalFailures;
          }

          // If it passes, apply now and break
          if (result.passed && args.apply && attempt < args.maxRetries) {
            await regeneratePath({ wrapper, outlineId: work.outlineId, outline, level: work.level, pathChoices, apply: true });
          }
          if (result.passed) break;
        } catch (err) {
          console.error(`     ⚠ Attempt ${attempt} error: ${err.message}`);
          if (attempt < args.maxRetries) await sleep(args.sleepMs * 2);
        }
      }

      if (bestScore === 0) {
        console.log(`     ❌ [${pathLabel}] ERROR — all attempts failed`);
        errorCount += 1;
      } else {
        const improved = bestScore > oldScore;
        const symbol = bestPassed ? '✅' : improved ? '🔄' : '❌';
        console.log(`     ${symbol} [${pathLabel}] old=${oldScore} → new=${bestScore.toFixed(1)} ${bestPassed ? 'PASS' : improved ? 'improved' : 'still-fail'}${bestCriticals.length ? ` criticals=[${bestCriticals.join(',')}]` : ''}`);

        if (bestPassed || improved) { improvedCount += 1; outlineImproved += 1; }
        else stillFailingCount += 1;

        progress.recentPaths = [
          { pathLabel, score: bestScore, passed: bestPassed, oldScore, outline: work.title, improved: bestScore > oldScore },
          ...progress.recentPaths.slice(0, 19)
        ];
      }

      progress.totals = { improved: improvedCount, stillFailing: stillFailingCount, errors: errorCount };
      writeProgress();

      if (args.sleepMs > 0 && p < work.failedPaths.length - 1) await sleep(args.sleepMs);
    }

    console.log(`   📊 ${outlineImproved}/${work.failedPaths.length} improved or passing`);
    progress.completedOutlines.push({
      title: work.title,
      level: work.level,
      pathCount: work.failedPaths.length,
      improved: outlineImproved,
      stillFailing: work.failedPaths.length - outlineImproved
    });
    writeProgress();
  }

  // 5. Summary
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' REGENERATION SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Improved/Passing:  ${improvedCount}`);
  console.log(`  Still Failing:     ${stillFailingCount}`);
  console.log(`  Errors:            ${errorCount}`);

  // 6. Write report
  const date = new Date().toISOString().slice(0, 10);
  const outputRoot = path.join('docs', 'audits', 'reading-journey-quality', date);
  fs.mkdirSync(outputRoot, { recursive: true });
  const reportPath = path.join(outputRoot, `regen-${date}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({ date, mode: args.apply ? 'apply' : 'dry-run', model: wrapper.modelName, summary: { improved: improvedCount, stillFailing: stillFailingCount, errors: errorCount } }, null, 2) + '\n', 'utf8');
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
