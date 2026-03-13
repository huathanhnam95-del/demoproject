#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Audit all cached Reading Journey stories against the 8-criterion rubric.
 *
 * Primary:  Google AI Studio (@google/generative-ai) with GEMINI_API_KEY
 * Fallback: Vertex AI (@google-cloud/vertexai) with FIREBASE_PROJECT_ID
 *
 * Usage:
 *   node scripts/audit-reading-journey-stories.js --dry-run
 *   node scripts/audit-reading-journey-stories.js --apply
 *   node scripts/audit-reading-journey-stories.js --apply --limit 5
 *   node scripts/audit-reading-journey-stories.js --apply --offset 10 --limit 5
 *   node scripts/audit-reading-journey-stories.js --apply --regenerate
 */

require('dotenv').config();
// Also load functions/.env for GEMINI_API_KEY if not set in root.
if (!process.env.GEMINI_API_KEY) {
  try { require('dotenv').config({ path: require('path').join(__dirname, '..', 'functions', '.env') }); } catch (_) { /* noop */ }
}

const fs = require('fs');
const path = require('path');

const rubric = require('../src/services/reading-journey/rubric');
const { safeJsonParse } = require('../src/services/reading-journey/json');
const cache = require('../src/services/reading-journey/cache');

const COLLECTION_OUTLINES = 'reading_journey_outlines_v1';
const COLLECTION_BEATS = 'reading_journey_beats_v1';
const MAX_INTERACTIVE_BEATS = 5;
const ENDING_BEAT_NUMBER = MAX_INTERACTIVE_BEATS + 1;
const PROGRESS_FILE = path.join(__dirname, '..', 'docs', 'audits', 'reading-journey-quality', 'progress.json');

// Live progress state — written to disk for dashboard
const progress = {
  startedAt: null,
  status: 'initializing',
  batch: { offset: 0, limit: 0, totalOutlines: 0 },
  current: { outlineIndex: 0, outlineTitle: '', outlineLevel: '', pathIndex: 0, totalPaths: 0, pathLabel: '' },
  totals: { passed: 0, failed: 0, skipped: 0, errors: 0 },
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

// ── Args ────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    apply: false,
    dryRun: false,
    limit: 0,
    offset: 0,
    regenerate: false,
    outputRoot: '',
    sleepMs: 500,
    model: 'auto'
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') { args.apply = true; continue; }
    if (arg === '--dry-run') { args.dryRun = true; continue; }
    if (arg === '--regenerate') { args.regenerate = true; continue; }
    if (arg === '--limit') { args.limit = Number(argv[i + 1]); i += 1; continue; }
    if (arg === '--offset') { args.offset = Number(argv[i + 1]); i += 1; continue; }
    if (arg === '--output-root') { args.outputRoot = argv[i + 1]; i += 1; continue; }
    if (arg === '--sleep-ms') { args.sleepMs = Number(argv[i + 1]); i += 1; continue; }
    if (arg === '--model') { args.model = argv[i + 1]; i += 1; continue; }
  }

  if (args.dryRun) args.apply = false;
  if (!Number.isFinite(args.limit) || args.limit < 0) args.limit = 0;
  if (!Number.isFinite(args.offset) || args.offset < 0) args.offset = 0;
  if (!Number.isFinite(args.sleepMs) || args.sleepMs < 0) args.sleepMs = 500;

  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Model Providers ─────────────────────────────────────────────────────────────

async function fetchAvailableModels(apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ListModels failed: HTTP ${res.status} ${res.statusText} ${text}`.trim());
  }
  const data = await res.json();
  return Array.isArray(data?.models) ? data.models : [];
}

function pickMostAdvancedModel(models) {
  const candidates = models
    .filter((m) => m && typeof m.name === 'string')
    .filter((m) => {
      const methods = m?.supportedGenerationMethods;
      return Array.isArray(methods) && methods.includes('generateContent');
    })
    .filter((m) => m.name.startsWith('models/gemini'))
    .filter((m) => !/embedding|imagen|veo|aqa/i.test(m.name))
    .filter((m) => !/native-audio|tts|image/i.test(m.name));

  const preference = [
    'models/gemini-3.1-pro-preview',
    'models/gemini-3-pro-preview',
    'models/gemini-3.1-flash-lite-preview',
    'models/gemini-3-flash-preview',
    'models/gemini-2.5-pro',
    'models/gemini-2.5-flash',
    'models/gemini-2.0-flash',
    'models/gemini-pro-latest'
  ];
  const byName = new Map(candidates.map((m) => [m.name, m]));
  for (const name of preference) {
    if (byName.has(name)) return name;
  }

  const pro = candidates.filter((m) => /pro/i.test(m.name));
  if (pro.length) return pro[0].name;
  return candidates[0]?.name || null;
}

/**
 * Create a model wrapper that works with either AI Studio or Vertex AI.
 * Primary: AI Studio via GEMINI_API_KEY
 * Fallback: Vertex AI via FIREBASE_PROJECT_ID
 */
async function createModelWrapper(requestedModel) {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();

  // Try AI Studio first
  if (apiKey) {
    console.log('🔑 Using Google AI Studio (GEMINI_API_KEY)');

    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const availableModels = await fetchAvailableModels(apiKey);
      console.log(`   Available models: ${availableModels.length}`);

      let modelName = requestedModel;
      if (!modelName || modelName === 'auto') {
        modelName = pickMostAdvancedModel(availableModels);
        if (!modelName) throw new Error('No suitable model found for AI Studio key');
      } else if (!modelName.startsWith('models/')) {
        modelName = `models/${modelName}`;
      }

      console.log(`   Selected model: ${modelName}`);
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { temperature: 0.2 }
      });

      return {
        provider: 'ai-studio',
        modelName,
        generateJson: async (prompt) => {
          const result = await model.generateContent(prompt);
          const text = result.response.text();
          return safeJsonParse(text);
        }
      };
    } catch (err) {
      console.warn(`⚠️ AI Studio init failed: ${err.message}. Trying Vertex AI...`);
    }
  }

  // Fallback: Vertex AI
  const project = String(process.env.FIREBASE_PROJECT_ID || '').trim();
  if (!project) {
    throw new Error('No GEMINI_API_KEY or FIREBASE_PROJECT_ID found. Set one in .env.');
  }

  console.log('🔑 Using Vertex AI (FIREBASE_PROJECT_ID) as fallback');
  const { VertexAI } = require('@google-cloud/vertexai');
  const location = String(process.env.GOOGLE_CLOUD_LOCATION || 'us-central1').trim();
  const vertexClient = new VertexAI({ project, location });

  let modelName = requestedModel;
  if (!modelName || modelName === 'auto') {
    modelName = 'gemini-2.5-pro';
  }

  console.log(`   Selected model: ${modelName}`);
  const model = vertexClient.getGenerativeModel({ model: modelName });

  return {
    provider: 'vertex-ai',
    modelName,
    generateJson: async (prompt) => {
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 }
      });
      const parts = result?.response?.candidates?.[0]?.content?.parts;
      const text = Array.isArray(parts) ? parts.map((p) => p.text || '').join('') : '';
      return safeJsonParse(text);
    }
  };
}

// ── Assessment ──────────────────────────────────────────────────────────────────

async function assessStoryText(wrapper, storyText, level) {
  const prompt = `${rubric.getAssessmentPrompt(level)}\n\nStory text:\n${storyText.slice(0, 6000)}`;

  const json = await wrapper.generateJson(prompt);
  const scores = {
    plot: Math.max(1, Math.min(10, Number(json?.plot) || 1)),
    character: Math.max(1, Math.min(10, Number(json?.character) || 1)),
    vocabulary: Math.max(1, Math.min(10, Number(json?.vocabulary) || 1)),
    grammar: Math.max(1, Math.min(10, Number(json?.grammar) || 1)),
    pacing: Math.max(1, Math.min(10, Number(json?.pacing) || 1)),
    emotion: Math.max(1, Math.min(10, Number(json?.emotion) || 1)),
    setting: Math.max(1, Math.min(10, Number(json?.setting) || 1)),
    coherence: Math.max(1, Math.min(10, Number(json?.coherence) || 1)),
    cefrFit: String(json?.cefrFit || level).trim(),
    notes: String(json?.notes || '').trim(),
    flags: {
      tooHard: Boolean(json?.flags?.tooHard),
      tooEasy: Boolean(json?.flags?.tooEasy),
      unsafe: Boolean(json?.flags?.unsafe)
    }
  };

  const result = rubric.computeWeightedScore(scores, level, scores.flags);
  return {
    scores,
    weightedAverage: result.weightedAverage,
    passed: result.passed,
    criticalFailures: result.criticalFailures,
    flagFailures: result.flagFailures,
    perCriterion: result.perCriterion
  };
}

// ── Story Reconstruction (all paths) ────────────────────────────────────────────

const CANONICAL_CHOICE_IDS = ['investigate', 'ask', 'wait'];

/**
 * Discover all cached story paths for an outline via recursive tree-walk.
 * Returns an array of { path, segments, endWrap, text }.
 */
async function discoverAllPaths(outlineId) {
  const stories = [];

  async function walk(beatNumber, pathSoFar, segmentsSoFar) {
    const pathSlice = pathSoFar.slice(0, Math.max(0, beatNumber - 1));
    const key = cache.computeBeatCacheKey({ outlineId, beatNumber, path: pathSlice });
    const beat = await cache.getCachedValue({ collection: COLLECTION_BEATS, id: key.id });

    if (!beat || typeof beat !== 'object') return;

    const seg = String(beat.segment || '').trim();
    const newSegments = seg ? [...segmentsSoFar, seg] : [...segmentsSoFar];

    // Ending beat — collect the story
    if (beatNumber === ENDING_BEAT_NUMBER || beat.shouldEnd) {
      const endWrap = String(beat.endWrap || '').trim();
      const text = newSegments.join(' ') + (endWrap ? ` ${endWrap}` : '');
      stories.push({
        path: [...pathSoFar],
        segments: newSegments,
        endWrap,
        text: text.trim()
      });
      return;
    }

    // For interactive beats, try all 3 canonical choices
    if (beatNumber < ENDING_BEAT_NUMBER) {
      let anyChildFound = false;
      for (const choiceId of CANONICAL_CHOICE_IDS) {
        const childPath = [...pathSoFar, choiceId];
        const childKey = cache.computeBeatCacheKey({ outlineId, beatNumber: beatNumber + 1, path: childPath });
        // eslint-disable-next-line no-await-in-loop
        const childBeat = await cache.getCachedValue({ collection: COLLECTION_BEATS, id: childKey.id });
        if (childBeat && typeof childBeat === 'object') {
          anyChildFound = true;
          // eslint-disable-next-line no-await-in-loop
          await walk(beatNumber + 1, childPath, newSegments);
        }
      }

      // If no child beats cached, store partial story (incomplete path)
      if (!anyChildFound && newSegments.length >= 2) {
        stories.push({
          path: [...pathSoFar],
          segments: newSegments,
          endWrap: '',
          text: newSegments.join(' ').trim(),
          partial: true
        });
      }
    }
  }

  await walk(1, [], []);
  return stories;
}


// ── Main ────────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  console.log('═══════════════════════════════════════════════════');
  console.log(' Reading Journey Story Quality Audit');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Mode:    ${args.apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`  Offset:  ${args.offset || 0}`);
  console.log(`  Limit:   ${args.limit || 'ALL'}`);
  console.log(`  Regen:   ${args.regenerate ? 'YES' : 'NO'}`);
  console.log(`  Model:   ${args.model}`);
  console.log('');

  // 1. Create model wrapper
  const wrapper = await createModelWrapper(args.model);
  console.log(`\n✅ Provider: ${wrapper.provider} → ${wrapper.modelName}\n`);

  // 2. List all outlines
  const outlines = await cache.listCachedOutlines();
  console.log(`Found ${outlines.length} cached outlines.`);
  if (!outlines.length) {
    console.log('Nothing to audit. Exiting.');
    return;
  }

  const sliceStart = args.offset || 0;
  const sliceEnd = args.limit > 0 ? sliceStart + args.limit : outlines.length;
  const toProcess = outlines.slice(sliceStart, sliceEnd);
  console.log(`Processing outlines ${sliceStart + 1}–${sliceStart + toProcess.length} of ${outlines.length} total...\n`);

  // Init progress
  progress.startedAt = Date.now();
  progress.status = 'running';
  progress.batch = { offset: sliceStart, limit: toProcess.length, totalOutlines: outlines.length };
  progress.provider = wrapper.provider;
  progress.model = wrapper.modelName;
  writeProgress();

  // 3. Assess each outline
  const results = [];
  let passCount = 0;
  let failCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (let i = 0; i < toProcess.length; i += 1) {
    const entry = toProcess[i];
    const outlineId = String(entry?.outlineId || entry?.id || '').trim();
    if (!outlineId) { skipCount += 1; continue; }

    const outline = await cache.getCachedValue({ collection: COLLECTION_OUTLINES, id: outlineId });
    if (!outline || typeof outline !== 'object') { skipCount += 1; continue; }

    const level = String(outline?.level || entry?.level || 'B1').toUpperCase();
    const title = String(outline?.title || entry?.title || 'Unknown').trim();

    console.log(`[${i + 1}/${toProcess.length}] ${outlineId.slice(0, 12)}… "${title}" (${level})`);
    progress.current = { outlineIndex: i + 1, outlineTitle: title, outlineLevel: level, pathIndex: 0, totalPaths: 0, pathLabel: '' };
    writeProgress();

    // Discover all cached paths
    const allPaths = await discoverAllPaths(outlineId);
    const validPaths = allPaths.filter((p) => p.text && p.segments.length >= 2 && !p.partial);

    if (!validPaths.length) {
      console.log(`   ⏭ Skipped (${allPaths.length} paths found, ${validPaths.length} valid)`);
      skipCount += 1;
      continue;
    }

    console.log(`   📂 ${validPaths.length} path(s) found`);
    progress.current.totalPaths = validPaths.length;
    writeProgress();
    const pathResults = [];

    for (let p = 0; p < validPaths.length; p += 1) {
      const story = validPaths[p];
      const pathLabel = story.path.length ? story.path.join('→') : 'root';

      let assessment = null;
      try {
        // eslint-disable-next-line no-await-in-loop
        assessment = await assessStoryText(wrapper, story.text, level);
      } catch (err) {
        console.error(`     ❌ Path [${pathLabel}] error: ${err.message}`);
        errorCount += 1;
        pathResults.push({ path: story.path, pathLabel, error: err.message });
        if (args.sleepMs > 0) await sleep(args.sleepMs * 2);
        continue;
      }

      const symbol = assessment.passed ? '✅' : '❌';
      console.log(`     ${symbol} [${pathLabel}] avg=${assessment.weightedAverage}${assessment.criticalFailures.length ? ` criticals=[${assessment.criticalFailures.join(',')}]` : ''}`);

      if (assessment.passed) passCount += 1;
      else failCount += 1;

      // Update live progress
      progress.current.pathIndex = p + 1;
      progress.current.pathLabel = pathLabel;
      progress.totals = { passed: passCount, failed: failCount, skipped: skipCount, errors: errorCount };
      progress.recentPaths = [
        { pathLabel, score: assessment.weightedAverage, passed: assessment.passed, criticals: assessment.criticalFailures, outline: title },
        ...progress.recentPaths.slice(0, 19)
      ];
      writeProgress();

      pathResults.push({
        path: story.path,
        pathLabel,
        segmentCount: story.segments.length,
        weightedAverage: assessment.weightedAverage,
        passed: assessment.passed,
        criticalFailures: assessment.criticalFailures,
        flagFailures: assessment.flagFailures,
        scores: assessment.scores,
        perCriterion: assessment.perCriterion
      });

      if (args.sleepMs > 0 && p < validPaths.length - 1) await sleep(args.sleepMs);
    }

    // Combine path results — best and worst for the outline
    const scoredPaths = pathResults.filter((r) => typeof r.weightedAverage === 'number');
    const worstAvg = scoredPaths.length ? Math.min(...scoredPaths.map((r) => r.weightedAverage)) : 0;
    const bestAvg = scoredPaths.length ? Math.max(...scoredPaths.map((r) => r.weightedAverage)) : 0;
    const allPassed = scoredPaths.length > 0 && scoredPaths.every((r) => r.passed);

    console.log(`   📊 ${scoredPaths.length} paths scored: best=${bestAvg} worst=${worstAvg} allPassed=${allPassed}`);
    progress.completedOutlines.push({ title, level, pathCount: scoredPaths.length, bestAvg, worstAvg, allPassed });
    writeProgress();

    // Store qualityScore on the outline (if apply mode) — uses worst-case avg
    if (args.apply) {
      const qualityScore = {
        assessedAt: Date.now(),
        weightedAverage: worstAvg,
        bestAverage: bestAvg,
        passed: allPassed,
        pathCount: scoredPaths.length,
        needsRegeneration: !allPassed,
        auditModel: wrapper.modelName,
        auditProvider: wrapper.provider
      };

      await cache.setCachedValue({
        collection: COLLECTION_OUTLINES,
        id: outlineId,
        value: { qualityScore },
        ttlMs: cache.resolveTtlMs()
      });
    }

    results.push({
      outlineId,
      title,
      level,
      pathCount: scoredPaths.length,
      bestAverage: bestAvg,
      worstAverage: worstAvg,
      allPassed,
      paths: pathResults
    });

    if (args.sleepMs > 0) await sleep(args.sleepMs);
  }


  // 4. Summary
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' AUDIT SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Provider:  ${wrapper.provider}`);
  console.log(`  Model:     ${wrapper.modelName}`);
  console.log(`  Processed: ${results.length}`);
  console.log(`  Passed:    ${passCount}`);
  console.log(`  Failed:    ${failCount}`);
  console.log(`  Skipped:   ${skipCount}`);
  console.log(`  Errors:    ${errorCount}`);

  const validResults = results.filter((r) => typeof r.worstAverage === 'number');
  if (validResults.length > 0) {
    const avgWorst = validResults.reduce((s, r) => s + r.worstAverage, 0) / validResults.length;
    const avgBest = validResults.reduce((s, r) => s + r.bestAverage, 0) / validResults.length;
    const totalPaths = validResults.reduce((s, r) => s + (r.pathCount || 0), 0);
    console.log(`  Total Paths: ${totalPaths}`);
    console.log(`  Avg Worst:   ${avgWorst.toFixed(2)}`);
    console.log(`  Avg Best:    ${avgBest.toFixed(2)}`);
  }

  // 5. Write report
  const date = new Date().toISOString().slice(0, 10);
  const outputRoot = args.outputRoot || path.join('docs', 'audits', 'reading-journey-quality', date);
  fs.mkdirSync(outputRoot, { recursive: true });

  const reportPath = path.join(outputRoot, `audit-${date}.json`);
  const report = {
    date,
    provider: wrapper.provider,
    model: wrapper.modelName,
    mode: args.apply ? 'apply' : 'dry-run',
    passThreshold: rubric.PASS_THRESHOLD,
    criticalMin: rubric.CRITICAL_MIN,
    summary: { total: results.length, passed: passCount, failed: failCount, skipped: skipCount, errors: errorCount },
    results
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`\n📄 Report written: ${reportPath}`);

  // List failures for easy review
  if (failCount > 0) {
    console.log('\n❌ Failed outlines (at least one path failed):');
    for (const r of results.filter((r) => r.allPassed === false)) {
      const failedPaths = (r.paths || []).filter((p) => p.passed === false);
      console.log(`   - ${r.outlineId.slice(0, 12)}… "${r.title}" (${r.level}) worst=${r.worstAverage} failedPaths=${failedPaths.length}/${r.pathCount}`);
    }
  }

  progress.status = 'done';
  progress.finishedAt = Date.now();
  writeProgress();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('❌ Fatal error:', err?.message || err);
  process.exit(1);
});
