#!/usr/bin/env node
/**
 * Reading Journey cache refresh + cohesion re-evaluation.
 *
 * What it does:
 * - Upgrades legacy cache records to the current schema (formatVersion=2).
 * - Rebuilds cached outlines/beats using the current Gemini model.
 * - Re-assesses each rebuilt story focusing on coherence/cohesion.
 *
 * Notes:
 * - Uses Firestore directly (requires serviceAccountKey.json).
 * - Writes an audit report under docs/audits/reading-journey-cache-refresh/YYYY-MM-DD/.
 *
 * Usage:
 *   node scripts/refresh-reading-journey-cache.js --apply
 *   node scripts/refresh-reading-journey-cache.js --apply --limit 10
 *   node scripts/refresh-reading-journey-cache.js --dry-run
 */
require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { db } = require('../src/utils/firebase');
const cache = require('../src/services/reading-journey/cache');
const gemini = require('../src/services/reading-journey/gemini');

const COLLECTION_KEYWORD_TAGS = 'reading_journey_keyword_tags_v1';
const COLLECTION_OUTLINES = 'reading_journey_outlines_v1';
const COLLECTION_BEATS = 'reading_journey_beats_v1';

const MAX_INTERACTIVE_BEATS = 3;
const ENDING_BEAT_NUMBER = MAX_INTERACTIVE_BEATS + 1;

const CANONICAL_CHOICES = Object.freeze(['investigate', 'ask', 'wait']);
const DEFAULT_PATH_CHOICE = 'investigate';

function parseArgs(argv) {
  const args = {
    apply: false,
    dryRun: false,
    limit: 0,
    concurrency: 2,
    outputRoot: '',
    deleteLegacyBeats: true,
    keepLegacyBeats: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (arg === '--limit') {
      args.limit = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--concurrency') {
      args.concurrency = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--output-root') {
      args.outputRoot = String(argv[i + 1] || '');
      i += 1;
      continue;
    }
    if (arg === '--keep-legacy-beats') {
      args.keepLegacyBeats = true;
      args.deleteLegacyBeats = false;
      continue;
    }
    if (arg === '--no-delete-legacy-beats') {
      args.deleteLegacyBeats = false;
      continue;
    }
  }

  if (!Number.isFinite(args.limit) || args.limit < 0) args.limit = 0;
  if (!Number.isFinite(args.concurrency) || args.concurrency < 1 || args.concurrency > 6) args.concurrency = 2;

  if (args.dryRun) args.apply = false;

  if (!args.outputRoot) {
    const dateFolder = new Date().toISOString().slice(0, 10);
    args.outputRoot = path.join('docs', 'audits', 'reading-journey-cache-refresh', dateFolder);
  }

  return args;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowRunId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableRateLimit(err) {
  const msg = String(err?.message || err || '');
  if (!msg) return false;
  if (msg.includes('[429') || msg.toLowerCase().includes('too many requests')) return true;
  if (msg.toLowerCase().includes('rate limit')) return true;
  return false;
}

async function withRetry(fn, { maxAttempts = 5, baseDelayMs = 1200 } = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isRetryableRateLimit(e) || attempt === maxAttempts) break;
      const delay = baseDelayMs * attempt + Math.floor(Math.random() * 300);
      // eslint-disable-next-line no-await-in-loop
      await sleep(delay);
    }
  }
  throw lastErr;
}

function parseKeyParts(key) {
  const out = {};
  const text = String(key || '');
  for (const part of text.split('|')) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    const k = part.slice(0, idx);
    const v = part.slice(idx + 1);
    if (!k) continue;
    out[k] = v;
  }
  return out;
}

function parseOutlineKey(key) {
  const parts = parseKeyParts(key);
  const language = String(parts.lang || 'en').trim() || 'en';
  const level = String(parts.level || 'B1').trim().toUpperCase() || 'B1';
  const tagText = String(parts.tags || '').trim();
  const topicTags = tagText
    .split(',')
    .map((t) => String(t || '').trim().toLowerCase().replace(/\s+/g, '_'))
    .filter(Boolean);
  topicTags.sort();
  return { language, level, topicTags };
}

function computeOpenBeatNumbers() {
  // Fixed layout: beat 3 is always the open-ended question.
  // Beat 1 = MCQ (3 opts), Beat 2 = MCQ (2 opts), Beat 3 = Open, Beat 4 = Ending.
  return [3];
}

function getQuestionTypeForBeat(outlineId, beatNumber) {
  const safeBeat = Number(beatNumber);
  if (!Number.isFinite(safeBeat) || safeBeat < 1) return 'mcq';
  if (safeBeat > MAX_INTERACTIVE_BEATS) return 'end';
  const openBeats = computeOpenBeatNumbers(outlineId);
  return openBeats.includes(safeBeat) ? 'open' : 'mcq';
}

function buildStorySoFarFromBeats(previousBeats) {
  const recaps = [];
  const segments = [];
  for (const beat of previousBeats) {
    if (!beat || typeof beat !== 'object') continue;
    const recap = String(beat.recap || '').trim();
    const segment = String(beat.segment || '').trim();
    if (recap) recaps.push(recap);
    if (segment) segments.push(segment);
  }

  const parts = [];
  if (recaps.length) {
    parts.push(`Recaps so far: ${recaps.map((r, i) => `${i + 1}) ${r}`).join(' ')}`);
  }
  if (segments.length) {
    parts.push(`Most recent scene: ${segments.slice(-2).join(' ')}`);
  }
  return parts.join('\n');
}

function buildStoryText({ segments, endWrap }) {
  const segText = (segments || []).map((s) => String(s || '').trim()).filter(Boolean).join(' ');
  const wrap = String(endWrap || '').trim();
  return `${segText}${wrap ? ` ${wrap}` : ''}`.trim();
}

async function upgradeKeywordTags({ ttlMs, apply }) {
  const snap = await db.collection(COLLECTION_KEYWORD_TAGS).get();
  let upgraded = 0;
  let kept = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const current = data.value;
    if (current && typeof current === 'object' && Number(current.formatVersion) === 2 && Array.isArray(current.topicTags)) {
      kept += 1;
      continue;
    }

    let topicTags = [];
    if (Array.isArray(current)) {
      topicTags = current;
    } else if (current && typeof current === 'object' && Array.isArray(current.topicTags)) {
      topicTags = current.topicTags;
    }

    const nextValue = { formatVersion: 2, topicTags };
    upgraded += 1;

    if (apply) {
      // Keep existing key string if present (contains normalized keywords).
      await cache.setCachedValue({
        collection: COLLECTION_KEYWORD_TAGS,
        id: doc.id,
        key: data.key,
        value: nextValue,
        ttlMs
      });
    }
  }

  return { total: snap.size, upgraded, kept };
}

async function refreshOutlines({ ttlMs, apply, limit }) {
  const snap = await db.collection(COLLECTION_OUTLINES).get();
  const docs = snap.docs.slice(0, limit > 0 ? limit : snap.docs.length);

  const refreshed = [];

  for (let i = 0; i < docs.length; i += 1) {
    const doc = docs[i];
    const data = doc.data() || {};
    const existing = data.value && typeof data.value === 'object' ? data.value : {};
    const meta = parseOutlineKey(data.key);

    // eslint-disable-next-line no-console
    console.log(`[outline ${i + 1}/${docs.length}] ${doc.id} level=${meta.level} tags=${meta.topicTags.join(',')}`);

    const fresh = await withRetry(() => gemini.generateOutline({
      keywords: meta.topicTags,
      topicTags: meta.topicTags,
      level: meta.level,
      language: meta.language,
      temperature: 0.5
    }));

    const nextOutline = {
      formatVersion: 2,
      title: String(existing.title || fresh.title || 'Reading Journey'),
      premise: String(existing.premise || fresh.premise || ''),
      setting: String(existing.setting || fresh.setting || ''),
      topicTags: meta.topicTags,
      characters: Array.isArray(existing.characters) && existing.characters.length ? existing.characters : fresh.characters,
      beatOutline: Array.isArray(existing.beatOutline) && existing.beatOutline.length === MAX_INTERACTIVE_BEATS ? existing.beatOutline : fresh.beatOutline
    };

    if (apply) {
      await cache.setCachedValue({
        collection: COLLECTION_OUTLINES,
        id: doc.id,
        key: data.key,
        value: nextOutline,
        ttlMs
      });
    }

    refreshed.push({
      outlineId: doc.id,
      key: data.key,
      level: meta.level,
      language: meta.language,
      topicTags: meta.topicTags,
      title: nextOutline.title
    });
  }

  return { total: snap.size, processed: docs.length, refreshed };
}

async function deleteAllBeats({ apply }) {
  const snap = await db.collection(COLLECTION_BEATS).get();
  if (!apply) return { total: snap.size, deleted: 0, skipped: snap.size };

  let deleted = 0;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 450) {
    const batch = db.batch();
    const slice = docs.slice(i, i + 450);
    slice.forEach((doc) => batch.delete(doc.ref));
    // eslint-disable-next-line no-await-in-loop
    await batch.commit();
    deleted += slice.length;
  }

  return { total: snap.size, deleted, skipped: 0 };
}

async function generateStoryForOutline({
  outlineId,
  outline,
  level,
  language,
  ttlMs,
  apply
}) {
  const rubric = require('../src/services/reading-journey/rubric');
  const beats = [];
  const segments = [];

  const makePath = (beatNumber) => {
    const len = Math.max(0, Math.min(MAX_INTERACTIVE_BEATS, Number(beatNumber) - 1));
    return Array.from({ length: len }, () => DEFAULT_PATH_CHOICE);
  };

  async function generateOnce({ temperature }) {
    beats.length = 0;
    segments.length = 0;

    for (let beatNumber = 1; beatNumber <= ENDING_BEAT_NUMBER; beatNumber += 1) {
      const questionType = getQuestionTypeForBeat(outlineId, beatNumber);
      const pathArr = makePath(beatNumber);
      const storySoFar = buildStorySoFarFromBeats(beats);

      // eslint-disable-next-line no-await-in-loop
      const beat = await withRetry(() => gemini.generateBeat({
        outline,
        beatNumber,
        path: pathArr,
        questionType,
        storySoFar,
        level,
        language,
        temperature
      }));

      beats.push({ beatNumber, path: pathArr, ...beat });
      if (beat?.segment) segments.push(String(beat.segment).trim());

      if (apply) {
        const beatKey = cache.computeBeatCacheKey({ outlineId, beatNumber, path: pathArr });
        // eslint-disable-next-line no-await-in-loop
        await cache.setCachedValue({
          collection: COLLECTION_BEATS,
          id: beatKey.id,
          key: beatKey.key,
          value: beat,
          ttlMs
        });
      }
    }

    const finalBeat = beats[beats.length - 1] || {};
    const storyText = buildStoryText({ segments, endWrap: finalBeat.endWrap });
    const scoreResult = await withRetry(() => gemini.assessAndScore({ storyText, level }));
    return { storyText, ...scoreResult };
  }

  const primary = await generateOnce({ temperature: 0.55 });
  if (primary.passed) {
    return { ...primary, retried: false };
  }

  // eslint-disable-next-line no-console
  console.log(`  ↳ FAILED (avg=${primary.weightedAverage}, criticals=[${primary.criticalFailures.join(',')}]). Retrying...`);
  const retry = await generateOnce({ temperature: 0.3 });
  return {
    ...retry,
    retried: true,
    previousAssessment: primary.assessment,
    previousWeightedAverage: primary.weightedAverage
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  const out = new Array(list.length);
  let idx = 0;

  async function runOne() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const current = idx;
      idx += 1;
      if (current >= list.length) return;
      // eslint-disable-next-line no-await-in-loop
      out[current] = await worker(list[current], current);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, list.length) }, () => runOne());
  await Promise.all(runners);
  return out.filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv);

  if (!db) {
    // eslint-disable-next-line no-console
    console.error('❌ Firestore is not initialized (missing serviceAccountKey.json?).');
    process.exit(1);
  }

  const ttlMs = cache.resolveTtlMs();
  const apply = Boolean(args.apply);

  ensureDir(args.outputRoot);
  const runId = nowRunId();
  const configuredModel = gemini.getModelName();
  const effectiveModel = gemini.getEffectiveModelName();

  // eslint-disable-next-line no-console
  console.log(`\nReading Journey cache refresh\n- apply=${apply}\n- model=${configuredModel}\n- effectiveModel=${effectiveModel}\n- output=${args.outputRoot}\n`);

  const keywordTags = await upgradeKeywordTags({ ttlMs, apply });
  const outlines = await refreshOutlines({ ttlMs, apply, limit: args.limit });

  const beatsBefore = await db.collection(COLLECTION_BEATS).get();
  const deletePlan = args.keepLegacyBeats ? { total: beatsBefore.size, deleted: 0, skipped: beatsBefore.size } : await deleteAllBeats({ apply: apply && args.deleteLegacyBeats });

  let beatWrites = 0;
  const perOutline = await mapWithConcurrency(outlines.refreshed, args.concurrency, async (item, index) => {
    const outlineId = item.outlineId;
    const outline = await cache.getCachedValue({ collection: COLLECTION_OUTLINES, id: outlineId });
    if (!outline || typeof outline !== 'object') return null;

    // eslint-disable-next-line no-console
    console.log(`[story ${index + 1}/${outlines.refreshed.length}] ${outlineId} (${item.level})`);

    const result = await generateStoryForOutline({
      outlineId,
      outline,
      level: item.level,
      language: item.language,
      ttlMs,
      apply
    });

    beatWrites += ENDING_BEAT_NUMBER;
    if (result.retried) beatWrites += ENDING_BEAT_NUMBER;

    return {
      outlineId,
      level: item.level,
      topicTags: item.topicTags,
      title: item.title,
      assessment: result.assessment,
      weightedAverage: result.weightedAverage,
      passed: result.passed,
      criticalFailures: result.criticalFailures,
      retried: result.retried,
      previousAssessment: result.previousAssessment || null,
      previousWeightedAverage: result.previousWeightedAverage || null
    };
  });

  const summary = {
    weightedAvgMean: Number((perOutline.reduce((sum, o) => sum + Number(o.weightedAverage || 0), 0) / Math.max(1, perOutline.length)).toFixed(2)),
    passedCount: perOutline.filter((o) => o.passed).length,
    failedCount: perOutline.filter((o) => !o.passed).length,
    retriedCount: perOutline.filter((o) => o.retried).length,
    tooHardCount: perOutline.filter((o) => o.assessment?.flags?.tooHard).length,
    tooEasyCount: perOutline.filter((o) => o.assessment?.flags?.tooEasy).length,
    unsafeCount: perOutline.filter((o) => o.assessment?.flags?.unsafe).length
  };

  const runOutput = {
    runId,
    createdAt: new Date().toISOString(),
    apply,
    model: configuredModel,
    effectiveModel: gemini.getEffectiveModelName(),
    fallbackModel: gemini.getFallbackModelName(),
    fallbackReason: gemini.getForceFallbackReason() || '',
    ttlMs,
    keywordTags,
    outlines: { total: outlines.total, processed: outlines.processed },
    beats: {
      before: beatsBefore.size,
      deletePlan,
      generatedBeatsWritesApprox: beatWrites
    },
    summary,
    perOutline
  };

  const runFile = path.join(args.outputRoot, `run-${runId}.json`);
  fs.writeFileSync(runFile, `${JSON.stringify(runOutput, null, 2)}\n`, 'utf8');

  // eslint-disable-next-line no-console
  console.log(`\n✅ Wrote report: ${runFile}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('❌ Cache refresh failed:', err?.message || err);
  process.exit(1);
});
