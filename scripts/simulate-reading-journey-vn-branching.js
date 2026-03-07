#!/usr/bin/env node
/**
 * Reading Journey VN (A2–B1) large simulation runner with branching.
 *
 * Goals:
 * - Use a VN adult-safe topic dataset (>=200 topics) as keyword inputs.
 * - Generate >=N unique outlines (unique outlineId).
 * - Expand story variants by simulating user choices (branchMode=mcq|all).
 *
 * Output:
 * - docs/audits/reading-journey-vn-sim/YYYY-MM-DD/
 *
 * Usage:
 *   node scripts/simulate-reading-journey-vn-branching.js --count-outlines 3 --branch-mode mcq
 *   node scripts/simulate-reading-journey-vn-branching.js --count-outlines 300 --branch-mode mcq --resume
 *   node scripts/simulate-reading-journey-vn-branching.js --count-outlines 20 --branch-mode all
 */
require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CANONICAL_CHOICES = Object.freeze(['investigate', 'ask', 'wait']);
const MAX_INTERACTIVE_BEATS = 5;

function todayFolder() {
  const d = new Date();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseArgs(argv) {
  const args = {
    baseUrl: '',
    datasetPath: path.join(__dirname, 'data', '2025-vn-adult-topics.json'),
    countOutlines: 300,
    levels: ['A2', 'B1'],
    language: 'en',
    keywordsPerOutline: 3,
    branchMode: 'mcq', // mcq|all
    outputRoot: path.join('docs', 'audits', 'reading-journey-vn-sim', todayFolder()),
    startServer: true,
    keepServer: false,
    port: 8791,
    seed: Date.now(),
    concurrency: 1,
    requestConcurrency: 4,
    disableRateLimit: true,
    resume: false,
    maxAttempts: 0
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base-url') {
      args.baseUrl = String(argv[i + 1] || '');
      i += 1;
      continue;
    }
    if (arg === '--dataset') {
      args.datasetPath = String(argv[i + 1] || '');
      i += 1;
      continue;
    }
    if (arg === '--count-outlines' || arg === '--outlines') {
      args.countOutlines = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--levels') {
      args.levels = String(argv[i + 1] || '')
        .split(',')
        .map((v) => String(v || '').trim().toUpperCase())
        .filter(Boolean);
      i += 1;
      continue;
    }
    if (arg === '--keywords-per-outline') {
      args.keywordsPerOutline = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--branch-mode') {
      args.branchMode = String(argv[i + 1] || '').trim().toLowerCase();
      i += 1;
      continue;
    }
    if (arg === '--output-root') {
      args.outputRoot = String(argv[i + 1] || '');
      i += 1;
      continue;
    }
    if (arg === '--no-server') {
      args.startServer = false;
      continue;
    }
    if (arg === '--keep-server') {
      args.keepServer = true;
      continue;
    }
    if (arg === '--port') {
      args.port = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--seed') {
      args.seed = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--concurrency') {
      args.concurrency = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--request-concurrency') {
      args.requestConcurrency = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--no-disable-rate-limit') {
      args.disableRateLimit = false;
      continue;
    }
    if (arg === '--resume') {
      args.resume = true;
      continue;
    }
    if (arg === '--max-attempts') {
      args.maxAttempts = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
  }

  if (args.countOutlines > 50 && !process.env.I_KNOW_WHAT_I_AM_DOING) {
    console.error(`\n[SAFEGUARD] High outline count (${args.countOutlines}) detected.`);
    console.error('To run > 50 outlines, set env I_KNOW_WHAT_I_AM_DOING=true');
    process.exit(1);
  }

  if (!Number.isFinite(args.countOutlines) || args.countOutlines < 1) args.countOutlines = 300;
  if (!Number.isFinite(args.keywordsPerOutline) || args.keywordsPerOutline < 1 || args.keywordsPerOutline > 4) args.keywordsPerOutline = 3;
  if (!Number.isFinite(args.port) || args.port < 1) args.port = 8791;
  if (!Number.isFinite(args.seed)) args.seed = Date.now();
  if (!Number.isFinite(args.concurrency) || args.concurrency < 1 || args.concurrency > 4) args.concurrency = 1;
  if (!Number.isFinite(args.requestConcurrency) || args.requestConcurrency < 1 || args.requestConcurrency > 12) args.requestConcurrency = 4;
  if (!args.levels.length) args.levels = ['A2', 'B1'];

  if (!['mcq', 'all'].includes(args.branchMode)) args.branchMode = 'mcq';

  if (!args.baseUrl) {
    args.baseUrl = args.startServer ? `http://localhost:${args.port}` : 'http://localhost:8443';
  }

  if (!Number.isFinite(args.maxAttempts) || args.maxAttempts < 1) {
    args.maxAttempts = Math.max(args.countOutlines * 25, 200);
  }

  return args;
}

function createSemaphore(max) {
  const limit = Number(max);
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 1;
  let inFlight = 0;
  const waiters = [];

  function release() {
    inFlight = Math.max(0, inFlight - 1);
    const next = waiters.shift();
    if (next) next();
  }

  async function acquire() {
    if (inFlight < safeLimit) {
      inFlight += 1;
      return;
    }
    await new Promise((resolve) => waiters.push(resolve));
    inFlight += 1;
  }

  async function withLock(fn) {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  return { withLock };
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

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function pickOne(list, rng) {
  const arr = Array.isArray(list) ? list : [];
  if (!arr.length) return null;
  const idx = Math.floor(rng() * arr.length);
  return arr[idx] || null;
}

function normalizeKeywords(keywords) {
  return (keywords || [])
    .map((k) => String(k || '').trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('|');
}

function normalizeTopic(topic) {
  return String(topic || '').trim();
}

function safeFilename(text) {
  return String(text || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .slice(0, 120);
}

async function fetchJson(url, options = {}, { retries = 4 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, options);
      const json = await res.json().catch(() => null);

      if (res.status === 429 && attempt < retries) {
        const waitMs = 1_800 + attempt * 2_000;
        // eslint-disable-next-line no-await-in-loop
        await sleep(waitMs);
        continue;
      }

      return { response: res, json };
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(800 + attempt * 500);
        continue;
      }
    }
  }
  throw lastErr || new Error('fetch failed');
}

async function waitForServer(baseUrl, timeoutMs = 35_000) {
  const started = Date.now();
  const root = baseUrl.replace(/\/$/, '');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetchJson(`${root}/api/health`, { cache: 'no-store' }, { retries: 0 });
      if (res.response.ok && res.json?.success === true) return true;
    } catch {
      // ignore
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Server did not become ready at ${baseUrl}`);
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(500);
  }
}

function startLocalServer({ port, disableRateLimit }) {
  const child = spawn(process.execPath, ['server.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      READING_JOURNEY_ENABLED: 'true',
      ...(disableRateLimit ? { READING_JOURNEY_DISABLE_RATE_LIMIT: 'true' } : {})
    }
  });

  const lines = [];
  child.stdout.on('data', (d) => lines.push(String(d)));
  child.stderr.on('data', (d) => lines.push(String(d)));

  return {
    child,
    getOutput: () => lines.join('')
  };
}

async function stopLocalServer(serverProc) {
  if (!serverProc || !serverProc.child || serverProc.child.killed) return;
  serverProc.child.kill('SIGTERM');
  await sleep(700);
  if (!serverProc.child.killed) {
    serverProc.child.kill('SIGKILL');
  }
}

function loadDataset(datasetPath) {
  const full = path.isAbsolute(datasetPath) ? datasetPath : path.join(process.cwd(), datasetPath);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing dataset: ${datasetPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const topic = normalizeTopic(item?.topic);
    if (!topic) continue;
    const key = topic.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      topic,
      category: String(item?.category || '').trim(),
      language: String(item?.language || 'vi').trim() || 'vi',
      sourceUrls: Array.isArray(item?.sourceUrls) ? item.sourceUrls : []
    });
  }
  return out;
}

function loadExistingOutlineIds(outputRoot) {
  const outlinesDir = path.join(outputRoot, 'outlines');
  if (!fs.existsSync(outlinesDir)) return new Set();
  const out = new Set();
  for (const entry of fs.readdirSync(outlinesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = String(entry.name || '').trim();
    if (!name) continue;
    out.add(name);
  }
  return out;
}

function buildKeywordSet(dataset, rng, size = 3) {
  const list = Array.isArray(dataset) ? dataset : [];
  if (!list.length) return [];

  const first = pickOne(list, rng);
  if (!first) return [];

  const usedTopics = new Set([String(first.topic).toLowerCase()]);
  const usedCategories = new Set([String(first.category || '')]);

  const keywords = [first.topic];

  function pickNext(preferDifferentCategory = true) {
    const pool = list.filter((e) => {
      const topicKey = String(e?.topic || '').toLowerCase();
      if (!topicKey || usedTopics.has(topicKey)) return false;
      if (!preferDifferentCategory) return true;
      const cat = String(e?.category || '');
      return !usedCategories.has(cat);
    });
    const fallback = list.filter((e) => {
      const topicKey = String(e?.topic || '').toLowerCase();
      return topicKey && !usedTopics.has(topicKey);
    });
    return pickOne(pool.length ? pool : fallback, rng);
  }

  while (keywords.length < size) {
    const next = pickNext(keywords.length <= 2);
    if (!next) break;
    const topic = normalizeTopic(next.topic);
    if (!topic) break;
    usedTopics.add(topic.toLowerCase());
    usedCategories.add(String(next.category || ''));
    keywords.push(topic);
  }

  return keywords.slice(0, size);
}

function deterministicOpenChoice(outlineId, beatNumber) {
  const id = String(outlineId || '').trim();
  const beat = Number(beatNumber);
  const seed = `${id}|beat:${beat}|open-choice-v1`;
  const hash = crypto.createHash('sha256').update(seed).digest();
  const idx = hash[0] % CANONICAL_CHOICES.length;
  return CANONICAL_CHOICES[idx];
}

function buildProductionText({ level, actionId }) {
  const action = String(actionId || 'investigate').trim().toLowerCase();
  if (level === 'A2') {
    if (action === 'ask') return 'I will ask for help. I want to understand.';
    if (action === 'wait') return 'I will wait and watch. I want to be safe.';
    return 'I will investigate. I want to know more.';
  }
  // B1+
  if (action === 'ask') return 'I will ask for help because I want clear information.';
  if (action === 'wait') return 'I will wait and watch because I want to be careful.';
  return 'I will investigate because I want to find a clue.';
}

function countWords(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function countNewlinesInFile(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    let count = 0;
    for (let i = 0; i < buf.length; i += 1) {
      if (buf[i] === 10) count += 1;
    }
    return count;
  } catch (_) {
    return 0;
  }
}

function scanOutputRoot(outputRoot, { expectedVariantsLines = 0 } = {}) {
  const outlinesDir = path.join(outputRoot, 'outlines');
  if (!fs.existsSync(outlinesDir)) {
    return { outlineDirs: 0, completedOutlines: 0, fullVariantsOutlines: 0, incompleteOutlines: 0 };
  }

  const entries = fs.readdirSync(outlinesDir, { withFileTypes: true }).filter((e) => e.isDirectory());

  let completedOutlines = 0;
  let fullVariantsOutlines = 0;
  for (const entry of entries) {
    const dir = path.join(outlinesDir, entry.name);
    if (fs.existsSync(path.join(dir, 'outline.json'))) completedOutlines += 1;

    if (expectedVariantsLines > 0) {
      const variantsPath = path.join(dir, 'variants.jsonl');
      if (!fs.existsSync(variantsPath)) continue;
      const lines = countNewlinesInFile(variantsPath);
      if (lines === expectedVariantsLines) fullVariantsOutlines += 1;
    }
  }

  const outlineDirs = entries.length;
  const incompleteOutlines = Math.max(0, outlineDirs - completedOutlines);
  return { outlineDirs, completedOutlines, fullVariantsOutlines, incompleteOutlines };
}

async function expandOutlineVariants({
  sem,
  root,
  outlineId,
  level,
  language,
  keywords,
  title,
  topicTags,
  branchMode,
  firstBeat,
  outputDir
}) {
  ensureDir(outputDir);
  const variantsPath = path.join(outputDir, 'variants.jsonl');
  const stream = fs.createWriteStream(variantsPath, { flags: 'w' });
  stream.setMaxListeners(0);
  async function writeLine(line) {
    if (stream.write(line)) return;
    await new Promise((resolve) => stream.once('drain', resolve));
  }
  let variants = 0;
  let endedEarly = 0;
  let wordCountIssues = 0;

  async function visit(beat, beatNumber, pathSoFar, segmentsSoFar) {
    const segment = String(beat?.segment || '').trim();
    const nextSegments = segment ? [...segmentsSoFar, segment] : [...segmentsSoFar];
    const segmentWords = segment ? countWords(segment) : 0;
    if (segmentWords && (segmentWords < 50 || segmentWords > 60)) wordCountIssues += 1;

    const shouldEnd = Boolean(beat?.shouldEnd);
    if (shouldEnd || beatNumber >= (MAX_INTERACTIVE_BEATS + 1)) {
      if (beatNumber < (MAX_INTERACTIVE_BEATS + 1)) endedEarly += 1;
      const endWrap = String(beat?.endWrap || '').trim();
      const storyText = `${nextSegments.join(' ')}${endWrap ? ` ${endWrap}` : ''}`.trim();
      const out = {
        outlineId,
        title,
        level,
        language,
        keywords,
        topicTags,
        branchMode,
        path: Array.isArray(pathSoFar) ? pathSoFar : [],
        segments: nextSegments,
        endWrap,
        storyText
      };
      await writeLine(`${JSON.stringify(out)}\n`);
      variants += 1;
      return;
    }

    const questionType = String(beat?.questionType || '').trim().toLowerCase() || 'mcq';
    const choices = [];

    if (branchMode === 'all') {
      choices.push(...CANONICAL_CHOICES);
    } else if (questionType === 'mcq') {
      choices.push(...CANONICAL_CHOICES);
    } else {
      choices.push(deterministicOpenChoice(outlineId, beatNumber));
    }

    await Promise.all(choices.map(async (choiceId) => {
      const payload = {
        outlineId,
        currentBeatNumber: beatNumber,
        path: pathSoFar,
        level,
        language
      };

      if (questionType === 'open') {
        payload.productionText = buildProductionText({ level, actionId: choiceId });
      } else {
        payload.choiceId = choiceId;
      }

      const adv = await sem.withLock(() => fetchJson(`${root}/api/reading-journey/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }));

      if (!adv.response.ok || !adv.json?.success || !adv.json?.beat) {
        const msg = `Advance failed: HTTP ${adv.response.status} ${JSON.stringify(adv.json)}`;
        throw new Error(msg);
      }

      const nextBeat = adv.json.beat;
      const nextBeatNumber = Number(nextBeat?.beatNumber || beatNumber + 1);
      const nextPath = Array.isArray(nextBeat?.path) ? nextBeat.path : [...pathSoFar, choiceId];

      await visit(nextBeat, nextBeatNumber, nextPath, nextSegments);
    }));
  }

  try {
    await visit(firstBeat, 1, [], []);
  } finally {
    await new Promise((resolve) => stream.end(resolve));
  }

  const outlineMetaPath = path.join(outputDir, 'outline.json');
  writeJson(outlineMetaPath, {
    outlineId,
    title,
    level,
    language,
    keywords,
    topicTags,
    branchMode,
    variants,
    endedEarly,
    wordCountIssues,
    createdAt: new Date().toISOString()
  });

  return { variants, endedEarly, wordCountIssues, variantsPath, outlineMetaPath };
}

async function main() {
  const args = parseArgs(process.argv);
  const rng = mulberry32(args.seed);
  const sem = createSemaphore(args.requestConcurrency);

  const dataset = loadDataset(args.datasetPath);
  if (dataset.length < 200) {
    throw new Error(`Dataset too small: need >=200, have ${dataset.length}`);
  }

  ensureDir(args.outputRoot);
  ensureDir(path.join(args.outputRoot, 'outlines'));

  const existingOutlines = args.resume ? loadExistingOutlineIds(args.outputRoot) : new Set();
  const seenOutlines = new Set(existingOutlines);
  const seenKeywordSets = new Set();

  let serverProc = null;
  const root = args.baseUrl.replace(/\/$/, '');

  try {
    if (args.startServer) {
      serverProc = startLocalServer({ port: args.port, disableRateLimit: args.disableRateLimit });
      await waitForServer(root);
    }

    const health = await sem.withLock(() => fetchJson(`${root}/api/reading-journey/health`, { cache: 'no-store' }, { retries: 1 }));
    const healthJson = health.response.ok ? health.json : null;

    const runId = nowRunId();
    const runStart = new Date().toISOString();

    const perOutline = [];
    const errors = [];

    let attempts = 0;

    async function worker(workerId) {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (seenOutlines.size >= args.countOutlines) return;
        if (attempts >= args.maxAttempts) return;

        attempts += 1;
        const level = args.levels[(seenOutlines.size + workerId) % args.levels.length] || 'B1';
        const keywords = buildKeywordSet(dataset, rng, args.keywordsPerOutline);
        if (!keywords.length) continue;

        const keywordKey = normalizeKeywords(keywords);
        if (seenKeywordSets.has(keywordKey)) continue;
        seenKeywordSets.add(keywordKey);

        let setup = null;
        try {
          setup = await sem.withLock(() => fetchJson(`${root}/api/reading-journey/setup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keywords, level, language: args.language })
          }));
        } catch (e) {
          errors.push({
            type: 'setup_fetch_failed',
            message: e?.message || String(e)
          });
          continue;
        }

        if (!setup.response.ok || !setup.json?.success || !setup.json?.setup || !setup.json?.beat) {
          errors.push({
            type: 'setup_failed',
            httpStatus: setup.response.status,
            payload: setup.json || null
          });
          continue;
        }

        const outlineId = String(setup.json.setup.outlineId || '').trim();
        if (!outlineId) continue;

        if (seenOutlines.has(outlineId)) {
          continue;
        }

        // Claim outlineId early to avoid races across workers.
        seenOutlines.add(outlineId);

        const title = String(setup.json.setup.title || '').trim() || 'Reading Journey';
        const topicTags = Array.isArray(setup.json.setup.topicTags) ? setup.json.setup.topicTags : [];
        const outlineDirName = safeFilename(outlineId);
        const outlineDir = path.join(args.outputRoot, 'outlines', outlineDirName);

        const result = await expandOutlineVariants({
          sem,
          root,
          outlineId,
          level,
          language: args.language,
          keywords,
          title,
          topicTags,
          branchMode: args.branchMode,
          firstBeat: setup.json.beat,
          outputDir: outlineDir
        }).catch((e) => {
          errors.push({
            type: 'expand_failed',
            outlineId,
            message: e?.message || String(e)
          });
          return null;
        });

        if (!result) continue;

        perOutline.push({
          outlineId,
          title,
          level,
          keywords,
          topicTags,
          variants: result.variants,
          endedEarly: result.endedEarly,
          wordCountIssues: result.wordCountIssues
        });

        // eslint-disable-next-line no-console
        console.log(`[outline ${seenOutlines.size}/${args.countOutlines}] ${outlineId} (${level}) variants=${result.variants}`);
      }
    }

    const workers = Array.from({ length: Math.min(args.concurrency, args.countOutlines) }, (_, i) => worker(i));
    await Promise.all(workers);

    const runOutput = {
      runId,
      createdAt: new Date().toISOString(),
      startedAt: runStart,
      baseUrl: root,
      dataset: {
        path: args.datasetPath,
        total: dataset.length
      },
      simulation: {
        targetOutlines: args.countOutlines,
        collectedOutlines: seenOutlines.size,
        attempts,
        maxAttempts: args.maxAttempts,
        branchMode: args.branchMode,
        levels: args.levels,
        language: args.language,
        keywordsPerOutline: args.keywordsPerOutline,
        concurrency: args.concurrency,
        seed: args.seed,
        resumedFromExisting: existingOutlines.size
      },
      health: healthJson,
      perOutline,
      errors: errors.slice(-50)
    };

    const runFile = path.join(args.outputRoot, `run-${runId}.json`);
    writeJson(runFile, runOutput);

    const summaryFile = path.join(args.outputRoot, `summary-${runId}.json`);
    const totals = perOutline.reduce(
      (acc, o) => {
        acc.outlines += 1;
        acc.variants += Number(o.variants || 0);
        acc.endedEarly += Number(o.endedEarly || 0);
        acc.wordCountIssues += Number(o.wordCountIssues || 0);
        return acc;
      },
      { outlines: 0, variants: 0, endedEarly: 0, wordCountIssues: 0 }
    );
    const scan = scanOutputRoot(args.outputRoot, { expectedVariantsLines: args.branchMode === 'mcq' ? 27 : 0 });
    writeJson(summaryFile, {
      runId,
      createdAt: new Date().toISOString(),
      baseUrl: root,
      ...runOutput.simulation,
      totals,
      scan,
      errors: runOutput.errors
    });

    const readmePath = path.join(args.outputRoot, 'README.md');
    const lines = [];
    lines.push('# Reading Journey VN Simulation Audit');
    lines.push('');
    lines.push(`Run ID: \`${runId}\``);
    lines.push(`Date: \`${todayFolder()}\``);
    lines.push(`Base URL: \`${root}\``);
    lines.push(`Dataset: \`${args.datasetPath}\` (${dataset.length} topics)`);
    lines.push(`Branch mode: \`${args.branchMode}\``);
    lines.push(`Levels: \`${args.levels.join(',')}\``);
    lines.push(`Outlines (dirs): \`${scan.outlineDirs}\` (target ${args.countOutlines})`);
    lines.push(`Outlines (completed): \`${scan.completedOutlines}\``);
    if (args.branchMode === 'mcq') {
      lines.push(`Outlines (variants=27): \`${scan.fullVariantsOutlines}\``);
    }
    lines.push(`Incomplete outlines: \`${scan.incompleteOutlines}\``);
    lines.push('');
    lines.push('## This run (new)');
    lines.push(`Outlines (new): \`${totals.outlines}\``);
    lines.push(`Variants (new): \`${totals.variants}\``);
    lines.push(`Ended early (new): \`${totals.endedEarly}\``);
    lines.push(`Segment word-count issues (new): \`${totals.wordCountIssues}\``);
    lines.push('');
    lines.push('## Re-run');
    lines.push(`- \`node scripts/simulate-reading-journey-vn-branching.js --count-outlines ${args.countOutlines} --branch-mode ${args.branchMode} --resume\``);
    lines.push('');
    fs.writeFileSync(readmePath, `${lines.join('\n')}\n`, 'utf8');

    // eslint-disable-next-line no-console
    console.log(`\n✅ Wrote:\n- ${runFile}\n- ${summaryFile}\n- ${readmePath}`);
  } finally {
    if (args.startServer && serverProc && !args.keepServer) {
      await stopLocalServer(serverProc);
    }
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('❌ VN branching simulation failed:', err?.message || err);
  process.exit(1);
});
