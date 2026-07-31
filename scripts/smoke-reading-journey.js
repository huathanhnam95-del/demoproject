#!/usr/bin/env node
require('dotenv').config();

const { spawn } = require('child_process');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(baseUrl, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/health`, { cache: 'no-store' });
      if (res.ok) return;
    } catch (_) {
      // ignore until timeout
    }
    // eslint-disable-next-line no-await-in-loop
    await wait(400);
  }
  throw new Error(`Server did not become ready at ${baseUrl}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const json = await response.json().catch(() => null);
  return { response, json };
}

function countWords(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function pickChoiceId(beat) {
  const options = Array.isArray(beat?.choiceQuestion?.options) ? beat.choiceQuestion.options : [];
  const first = options[0] || null;
  return String(first?.id || '').trim();
}

function expectedOptionCount(beatNumber) {
  return Number(beatNumber) === 2 ? 2 : 3;
}

function normalizeScalar(value) {
  return String(value ?? '').trim();
}

function getQuestionType(beat) {
  const direct = String(beat?.questionType || '').trim().toLowerCase();
  if (direct) return direct;
  if (beat?.shouldEnd) return 'end';
  if (beat?.choiceQuestion) return 'mcq';
  if (beat?.productionPrompt) return 'open';
  return 'mcq';
}

function validateQuizDeck(quiz) {
  assert(Array.isArray(quiz?.questions), 'Quiz response must include questions');
  assert(Array.isArray(quiz?.storySnapshot?.paragraphs), 'Quiz response must include storySnapshot.paragraphs');
  assert(quiz.questions.length === 5, `Expected 5 quiz questions, got ${quiz.questions.length}`);
  assert(quiz.storySnapshot.paragraphs.length > 0, 'Quiz storySnapshot must contain at least one paragraph');

  const paragraphCount = quiz.storySnapshot.paragraphs.length;
  const vocabularyCount = quiz.questions.filter((question) => normalizeScalar(question?.skill).toLowerCase() === 'vocabulary').length;
  const comprehensionCount = quiz.questions.filter((question) => normalizeScalar(question?.skill).toLowerCase() === 'comprehension').length;
  const interactiveCount = quiz.questions.filter((question) => ['click_word_meaning', 'tap_evidence'].includes(normalizeScalar(question?.type))).length;

  assert(vocabularyCount >= 1, 'Quiz must include at least one vocabulary item');
  assert(comprehensionCount >= 1, 'Quiz must include at least one comprehension item');
  assert(interactiveCount >= 1, 'Quiz must include at least one interactive text-location item');

  quiz.questions.forEach((question) => {
    const type = normalizeScalar(question?.type);
    if (type === 'click_word_meaning' || type === 'tap_evidence') {
      const paragraphIndex = Number(question?.target?.paragraphIndex);
      assert(Number.isInteger(paragraphIndex), `Question ${question.id} missing target.paragraphIndex`);
      assert(paragraphIndex >= 0 && paragraphIndex < paragraphCount, `Question ${question.id} has invalid paragraphIndex ${paragraphIndex}`);
    }
  });
}

function startLocalServer({ port }) {
  const child = spawn(process.execPath, ['server.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      READING_JOURNEY_ENABLED: 'true',
      // Keep smoke verification independent from stale local Gemini 1.5 aliases.
      READING_JOURNEY_GEMINI_MODEL: 'gemini-3.1-flash-lite',
      READING_JOURNEY_GEMINI_FALLBACK_MODEL: 'gemini-3.1-flash-lite'
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
  await wait(500);
  if (!serverProc.child.killed) {
    serverProc.child.kill('SIGKILL');
  }
}

async function runSmoke(baseUrl, { fresh = false } = {}) {
  const rootUrl = baseUrl.replace(/\/$/, '');

  const health = await fetchJson(`${rootUrl}/api/reading-journey/health`, { cache: 'no-store' });
  if (!health.response.ok) {
    throw new Error(`Reading Journey health failed: HTTP ${health.response.status} ${JSON.stringify(health.json)}`);
  }
  if (!(health.json?.success === true && health.json?.enabled === true)) {
    throw new Error(`Reading Journey not enabled: ${JSON.stringify(health.json)}`);
  }

  const modelInfo = {
    model: health.json?.model,
    effectiveModel: health.json?.effectiveModel,
    fallbackModel: health.json?.fallbackModel
  };
  console.log('Reading Journey model:', JSON.stringify(modelInfo));

  const keywords = fresh
    ? [`Hot Honey ${Date.now()}`, 'mystery', 'friendship']
    : ['Hot Honey', 'mystery', 'friendship'];

  const setup = await fetchJson(`${rootUrl}/api/reading-journey/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keywords,
      level: 'B1',
      language: 'en'
    })
  });

  assert(setup.response.ok, `Setup failed: HTTP ${setup.response.status} ${JSON.stringify(setup.json)}`);
  assert(setup.json?.success === true, `Setup failed: ${JSON.stringify(setup.json)}`);
  assert(setup.json?.setup?.outlineId, 'Missing setup.outlineId');
  assert(setup.json?.beat?.segment, 'Missing beat.segment');

  const outlineId = String(setup.json.setup.outlineId);
  const segments = [];
  const questionTypes = [];

  let currentBeatNumber = Number(setup.json.beat.beatNumber);
  let path = Array.isArray(setup.json.beat.path) ? setup.json.beat.path : [];
  let beat = setup.json.beat;

  while (beat && beat.segment) {
    const segWords = countWords(beat.segment);
    // Current Gemini families can drift a few words while still producing a valid reading beat.
    assert(segWords >= 45 && segWords <= 65, `Beat ${currentBeatNumber} segment word count out of range: ${segWords}`);
    segments.push(String(beat.segment).trim());

    const qType = getQuestionType(beat);
    questionTypes.push(qType);

    if (beat.shouldEnd) {
      assert(currentBeatNumber === 4, `Expected ending beatNumber=4, got ${currentBeatNumber}`);
      const wrapWords = countWords(beat.endWrap);
      assert(wrapWords >= 15 && wrapWords <= 35, `endWrap word count out of range: ${wrapWords}`);
      assert(!beat.choiceQuestion, 'choiceQuestion must be null when shouldEnd=true');
      assert(!beat.productionPrompt, 'productionPrompt must be null when shouldEnd=true');
      break;
    }

    const payload = {
      outlineId,
      currentBeatNumber,
      path,
      level: 'B1',
      language: 'en'
    };

    if (qType === 'open') {
      assert(!beat.choiceQuestion, `open beat must not include choiceQuestion at beat ${currentBeatNumber}`);
      assert(beat.productionPrompt?.question, `Missing productionPrompt.question at beat ${currentBeatNumber}`);
      payload.productionText = 'I will investigate because it feels important.';
    } else {
      const expectedChoices = expectedOptionCount(currentBeatNumber);
      assert(
        beat.choiceQuestion?.options?.length === expectedChoices,
        `Expected ${expectedChoices} options at beat ${currentBeatNumber}`
      );
      assert(!beat.productionPrompt, `mcq beat must not include productionPrompt at beat ${currentBeatNumber}`);
      const choiceId = pickChoiceId(beat);
      assert(choiceId, `Missing choiceId at beat ${currentBeatNumber}`);
      payload.choiceId = choiceId;
    }

    // eslint-disable-next-line no-await-in-loop
    const adv = await fetchJson(`${rootUrl}/api/reading-journey/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert(adv.response.ok, `Advance failed at beat ${currentBeatNumber}: HTTP ${adv.response.status} ${JSON.stringify(adv.json)}`);
    assert(adv.json?.success === true, `Advance failed: ${JSON.stringify(adv.json)}`);
    assert(adv.json?.beat?.beatNumber === currentBeatNumber + 1, 'Beat number did not advance');
    beat = adv.json.beat;
    currentBeatNumber = Number(beat.beatNumber);
    path = Array.isArray(beat.path) ? beat.path : [];
  }

  const interactive = questionTypes.slice(0, 3);
  assert(interactive.filter((t) => t === 'open').length === 1, `Expected 1 open beat, got ${interactive.join(',')}`);
  assert(interactive.filter((t) => t === 'mcq').length === 2, `Expected 2 mcq beats, got ${interactive.join(',')}`);
  assert(currentBeatNumber === 4, `Expected to end at beat 4, ended at ${currentBeatNumber}`);
  assert(segments.length === 4, `Expected 4 segments (3 turns + ending), got ${segments.length}`);

  const quiz = await fetchJson(`${rootUrl}/api/reading-journey/quiz`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      outlineId,
      path,
      level: 'B1'
    })
  });

  assert(quiz.response.ok, `Quiz failed: HTTP ${quiz.response.status} ${JSON.stringify(quiz.json)}`);
  assert(quiz.json?.success === true, `Quiz failed: ${JSON.stringify(quiz.json)}`);
  validateQuizDeck(quiz.json);
  console.log('Reading Journey quiz mix:', quiz.json.questions.map((question) => question.type).join(', '));

  console.log('✅ Reading Journey smoke passed.');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const shouldStartServer = Boolean(args['start-server']);
  const port = Number(args.port || 8787);
  const fresh = Boolean(args.fresh);

  const baseUrl = String(args['base-url'] || (shouldStartServer ? `http://localhost:${port}` : 'http://localhost:8443'));

  let serverProc = null;
  try {
    if (shouldStartServer) {
      serverProc = startLocalServer({ port });
      await waitForServer(baseUrl, 35_000);
    }

    await runSmoke(baseUrl, { fresh });
  } finally {
    if (serverProc) {
      await stopLocalServer(serverProc);
    }
  }
}

main().catch((err) => {
  console.error('❌ Reading Journey smoke failed:', err?.message || err);
  process.exit(1);
});
