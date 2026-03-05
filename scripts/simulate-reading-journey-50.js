#!/usr/bin/env node
/**
 * Reading Journey (hidden /readingjourney) simulation runner.
 *
 * Goals:
 * - Generate >= N stories from 2025 topic inputs.
 * - Simulate A2–C1 learner production answers (simple logic).
 * - Assess each finished story via /api/reading-journey/assess-story.
 * - Write run artifacts under docs/audits/reading-journey-sim/2026-03-05/.
 *
 * Usage:
 *   node scripts/simulate-reading-journey-50.js --count 50
 *   node scripts/simulate-reading-journey-50.js --base-url http://localhost:8443 --count 50 --no-server
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function parseArgs(argv) {
  const args = {
    baseUrl: '',
    count: 50,
    outputRoot: path.join('docs', 'audits', 'reading-journey-sim', '2026-03-05'),
    startServer: true,
    keepServer: false,
    port: 8787,
    seed: Date.now(),
    disableRateLimit: true
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base-url') {
      args.baseUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--count') {
      args.count = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--output-root') {
      args.outputRoot = argv[i + 1];
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
    if (arg === '--no-disable-rate-limit') {
      args.disableRateLimit = false;
      continue;
    }
  }

  if (!Number.isFinite(args.count) || args.count < 1) args.count = 50;
  if (!Number.isFinite(args.port) || args.port < 1) args.port = 8787;
  if (!Number.isFinite(args.seed)) args.seed = Date.now();

  if (!args.baseUrl) {
    args.baseUrl = args.startServer ? `http://localhost:${args.port}` : 'http://localhost:8443';
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

function uniqueByTopic(entries) {
  const out = [];
  const seen = new Set();
  for (const entry of entries || []) {
    const topic = String(entry?.topic || '').trim();
    if (!topic) continue;
    const key = topic.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...entry, topic });
  }
  return out;
}

function shuffle(list, rng) {
  const out = [...(list || [])];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function fetchJson(url, options = {}, { retries = 3 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, options);
      const json = await res.json().catch(() => null);

      if (res.status === 429 && attempt < retries) {
        const waitMs = 2_000 + attempt * 2_000;
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

function countWords(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function shortSummary(segment, maxWords = 8) {
  const words = String(segment || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return 'something happens';
  return words.slice(0, maxWords).join(' ').replace(/[,:;]+$/, '');
}

function chooseOption(beat, level, rng) {
  const options = Array.isArray(beat?.choiceQuestion?.options) ? beat.choiceQuestion.options : [];
  if (!options.length) return null;

  const patternsByLevel = {
    A2: [/ask/, /wait/, /listen/, /stay/, /look/],
    B1: [/look/, /ask/, /check/, /follow/, /talk/],
    B2: [/investigate/, /follow/, /search/, /enter/, /compare/],
    C1: [/plan/, /compare/, /test/, /carefully/, /explain/]
  };

  const patterns = patternsByLevel[level] || [];
  for (const re of patterns) {
    const match = options.find((opt) => re.test(`${opt?.id || ''} ${opt?.label || ''}`.toLowerCase()));
    if (match) return match;
  }

  const fallbackIndexByLevel = { A2: 0, B1: 1, B2: 2, C1: Math.floor(rng() * options.length) };
  const idx = Number.isFinite(fallbackIndexByLevel[level]) ? fallbackIndexByLevel[level] : 0;
  return options[Math.min(Math.max(idx, 0), options.length - 1)];
}

function getQuestionType(beat) {
  const direct = String(beat?.questionType || '').trim().toLowerCase();
  if (direct) return direct;
  if (beat?.shouldEnd) return 'end';
  if (beat?.choiceQuestion) return 'mcq';
  if (beat?.productionPrompt) return 'open';
  return 'mcq';
}

function chooseOpenActionId(rng) {
  const r = rng();
  if (r < 0.55) return 'investigate';
  if (r < 0.8) return 'ask';
  return 'wait';
}

function actionPhrase(actionId) {
  const id = String(actionId || '').trim().toLowerCase();
  if (id === 'ask') return 'ask for help';
  if (id === 'wait') return 'wait and watch';
  return 'investigate carefully';
}

function buildProductionText({ level, segment, actionId }) {
  const summary = shortSummary(segment);
  const id = String(actionId || 'investigate').trim().toLowerCase() || 'investigate';
  const phrase = actionPhrase(id);

  if (level === 'A2') {
    if (id === 'ask') return `I read "${summary}". I will ask for help.`;
    if (id === 'wait') return `I read "${summary}". I will wait and watch.`;
    return `I read "${summary}". I will investigate.`;
  }
  if (level === 'B1') {
    return `They see "${summary}". I will ${phrase} because I want to learn more.`;
  }
  if (level === 'B2') {
    return `They see "${summary}". I will ${phrase} because it could reveal an important clue.`;
  }
  return `They see "${summary}". I will ${phrase} because it supports our goal and reduces risk. However, we should stay alert.`;
}

function buildKeywords(dataset, mainEntry, rng) {
  const main = String(mainEntry?.topic || '').trim();
  const category = String(mainEntry?.category || '').trim().toLowerCase();

  const sameBucket = (dataset || []).filter((e) => {
    const topic = String(e?.topic || '').trim();
    if (!topic) return false;
    if (topic.toLowerCase() === main.toLowerCase()) return false;
    return String(e?.category || '').trim().toLowerCase() === category;
  });

  const secondary = pickOne(sameBucket, rng) || pickOne(dataset, rng);
  const second = String(secondary?.topic || '').trim();

  const keywords = [main, second].filter(Boolean);
  const deduped = [];
  const seen = new Set();
  for (const k of keywords) {
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(k);
  }
  return deduped.slice(0, 3);
}

function computeSummary(stories) {
  const nums = (key) => stories.map((s) => Number(s?.assessment?.[key]) || 0).filter((n) => Number.isFinite(n) && n > 0);
  const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);

  const coherence = avg(nums('coherence'));
  const cohesion = avg(nums('cohesion'));
  const grammar = avg(nums('grammar'));
  const vocabulary = avg(nums('vocabulary'));

  const cefrFit = {};
  const flags = { tooHard: 0, tooEasy: 0, unsafe: 0 };
  let endedEarly = 0;
  let segmentsOutOfRange = 0;

  for (const story of stories) {
    const fit = String(story?.assessment?.cefrFit || '').trim() || 'unknown';
    cefrFit[fit] = (cefrFit[fit] || 0) + 1;
    if (story?.assessment?.flags?.tooHard) flags.tooHard += 1;
    if (story?.assessment?.flags?.tooEasy) flags.tooEasy += 1;
    if (story?.assessment?.flags?.unsafe) flags.unsafe += 1;
    if (story?.endedEarly) endedEarly += 1;
    segmentsOutOfRange += Number(story?.segmentCompliance?.outOfRangeCount || 0);
  }

  return {
    count: stories.length,
    averages: { coherence, cohesion, grammar, vocabulary },
    cefrFit,
    flags,
    endedEarly,
    segmentsOutOfRange
  };
}

function buildReadme({ runId, model, baseUrl, count, summary }) {
  const lines = [];
  lines.push(`# Reading Journey Simulation Audit (2026-03-05)`);
  lines.push('');
  lines.push(`Latest run: \`${runId}\``);
  if (model) lines.push(`Model: \`${model}\``);
  lines.push(`Base URL: \`${baseUrl}\``);
  lines.push(`Stories: \`${count}\``);
  lines.push('');
  lines.push('## Results (aggregate)');
  lines.push(`- Averages (1–5): coherence ${summary.averages.coherence.toFixed(2)}, cohesion ${summary.averages.cohesion.toFixed(2)}, grammar ${summary.averages.grammar.toFixed(2)}, vocabulary ${summary.averages.vocabulary.toFixed(2)}`);
  lines.push(`- Flags: tooHard ${summary.flags.tooHard}, tooEasy ${summary.flags.tooEasy}, unsafe ${summary.flags.unsafe}`);
  lines.push(`- Ended early: ${summary.endedEarly}`);
  lines.push(`- Segment word-count issues (total): ${summary.segmentsOutOfRange}`);
  lines.push('');
  lines.push('## CEFR fit distribution');
  for (const [k, v] of Object.entries(summary.cefrFit).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push('');
  lines.push('## Sources (2025 topic inputs)');
  lines.push('- https://trends.withgoogle.com/year-in-search/2025/');
  lines.push('- https://wikimediafoundation.org/news/2025/12/10/googles-year-in-search-2025-mikey-madison-justin-baldoni-the-hunting-wives-land-on-2025-trend-report/');
  lines.push('');
  lines.push('Curated inputs: `scripts/data/2025-topics.json`');
  lines.push('');
  lines.push('## Re-run');
  lines.push('- `node scripts/simulate-reading-journey-50.js --count 50`');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  const rng = mulberry32(args.seed);

  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY (set it in .env).');
  }

  const datasetPath = path.join(__dirname, 'data', '2025-topics.json');
  if (!fs.existsSync(datasetPath)) {
    throw new Error(`Missing dataset: ${datasetPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  const dataset = uniqueByTopic(Array.isArray(raw) ? raw : []);
  if (dataset.length < args.count) {
    throw new Error(`Dataset too small: need ${args.count}, have ${dataset.length}`);
  }

  ensureDir(args.outputRoot);

  let serverProc = null;
  try {
    if (args.startServer) {
      serverProc = startLocalServer({ port: args.port, disableRateLimit: args.disableRateLimit });
      await waitForServer(args.baseUrl);
    }

    const root = args.baseUrl.replace(/\/$/, '');

    const health = await fetchJson(`${root}/api/reading-journey/health`, { cache: 'no-store' }, { retries: 1 });
    if (!health.response.ok || !health.json?.enabled) {
      throw new Error(
        `Reading Journey is disabled at ${root}. Set READING_JOURNEY_ENABLED=true and retry. (HTTP ${health.response.status})`
      );
    }

    const model = String(health.json?.model || '').trim();

    const picked = shuffle(dataset, rng).slice(0, args.count);
    const levels = ['A2', 'B1', 'B2', 'C1'];

    const stories = [];
    const startedAt = new Date().toISOString();

    for (let i = 0; i < picked.length; i += 1) {
      const entry = picked[i];
      const level = levels[i % levels.length];
      const storyRng = mulberry32((args.seed + i * 9973) >>> 0);
      const keywords = buildKeywords(dataset, entry, storyRng);

      // eslint-disable-next-line no-console
      console.log(`[${i + 1}/${picked.length}] level=${level} keywords=${keywords.join(', ')}`);

      const setup = await fetchJson(`${root}/api/reading-journey/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords, level, language: 'en' })
      });

      if (!setup.response.ok || !setup.json?.success) {
        throw new Error(`Setup failed: HTTP ${setup.response.status} ${JSON.stringify(setup.json)}`);
      }

      const outlineId = String(setup.json.setup.outlineId);
      let beat = setup.json.beat;
      let currentBeatNumber = Number(beat?.beatNumber || 1);
      let path = Array.isArray(beat?.path) ? beat.path : [];

      const segments = [];
      const segmentCompliance = { outOfRangeCount: 0 };
      let endedEarly = false;

      while (beat && beat.segment) {
        const segText = String(beat.segment).trim();
        const segWords = countWords(segText);
        if (segWords < 50 || segWords > 60) segmentCompliance.outOfRangeCount += 1;
        segments.push(segText);

        if (beat.shouldEnd) break;
        if (currentBeatNumber >= 6) break;

        const qType = getQuestionType(beat);
        const payload = {
          outlineId,
          currentBeatNumber,
          path,
          level,
          language: 'en'
        };

        if (qType === 'open') {
          const actionId = chooseOpenActionId(storyRng);
          payload.productionText = buildProductionText({ level, segment: segText, actionId });
        } else {
          const option = chooseOption(beat, level, storyRng);
          if (!option?.id) {
            throw new Error(`Missing option at beat ${currentBeatNumber}`);
          }
          payload.choiceId = option.id;
        }

        const adv = await fetchJson(`${root}/api/reading-journey/advance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!adv.response.ok || !adv.json?.success) {
          throw new Error(`Advance failed: HTTP ${adv.response.status} ${JSON.stringify(adv.json)}`);
        }

        beat = adv.json.beat;
        currentBeatNumber = Number(beat?.beatNumber || currentBeatNumber + 1);
        path = Array.isArray(beat?.path) ? beat.path : [];

        if (beat?.shouldEnd && currentBeatNumber < 6) {
          endedEarly = true;
          break;
        }
      }

      const endWrap = String(beat?.endWrap || '').trim();
      const storyText = `${segments.join(' ')}${endWrap ? ` ${endWrap}` : ''}`.trim();

      const assess = await fetchJson(`${root}/api/reading-journey/assess-story`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level, storyText })
      });

      if (!assess.response.ok || !assess.json?.success || !assess.json?.assessment) {
        throw new Error(`Assess failed: HTTP ${assess.response.status} ${JSON.stringify(assess.json)}`);
      }

      stories.push({
        index: i + 1,
        level,
        keywords,
        outlineId,
        title: String(setup.json?.setup?.title || '').trim(),
        topicTags: Array.isArray(setup.json?.setup?.topicTags) ? setup.json.setup.topicTags : [],
        path,
        segments,
        endWrap,
        storyTextWordCount: countWords(storyText),
        endedEarly,
        segmentCompliance,
        assessment: assess.json.assessment
      });
    }

    const runId = nowRunId();
    const summary = computeSummary(stories);

    const runOutput = {
      runId,
      createdAt: new Date().toISOString(),
      startedAt,
      baseUrl: root,
      model,
      count: stories.length,
      seed: args.seed,
      stories
    };

    const summaryOutput = {
      runId,
      createdAt: new Date().toISOString(),
      baseUrl: root,
      model,
      ...summary
    };

    const runFile = path.join(args.outputRoot, `run-${runId}.json`);
    const summaryFile = path.join(args.outputRoot, `summary-${runId}.json`);
    fs.writeFileSync(runFile, `${JSON.stringify(runOutput, null, 2)}\n`, 'utf8');
    fs.writeFileSync(summaryFile, `${JSON.stringify(summaryOutput, null, 2)}\n`, 'utf8');

    const readmePath = path.join(args.outputRoot, 'README.md');
    fs.writeFileSync(readmePath, buildReadme({ runId, model, baseUrl: root, count: stories.length, summary }), 'utf8');

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
  console.error('❌ Simulation failed:', err?.message || err);
  process.exit(1);
});
