/* eslint-disable no-console */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const core = require('./speech_coach_audio_core.js');
const inventoryCore = require('../read-aloud/connected-speech-index-core.js');
const service = require('../../functions/src/read-aloud/connected-speech-service.js');

const ROOT = path.resolve(__dirname, '../..');
const KOKORO_ROOT = process.env.KOKORO_ROOT
  || (fs.existsSync(path.join(ROOT, 'Kokoro-FastAPI')) ? path.join(ROOT, 'Kokoro-FastAPI') : 'C:\\Cursor AI\\Kokoro-FastAPI');
const KOKORO_URL = process.env.KOKORO_URL || 'http://127.0.0.1:8880';
const VOICE = 'af_heart';
const SPEED = 1;
const CONTRACT_VERSION = 'sc-kokoro-v1';
const AUDIO_ROOT = path.join(ROOT, 'public', 'database', 'RA', 'speech-coach-audio', 'v1');
const CLIP_ROOT = path.join(AUDIO_ROOT, 'clips');
const QUESTION_ROOT = path.join(AUDIO_ROOT, 'questions');
const REPORT_ROOT = path.join(ROOT, 'test-results', 'speech-coach-kokoro-full');

function parseArgs(argv) {
  const options = {
    dryRun: argv.includes('--dry-run'),
    resume: !argv.includes('--no-resume'),
    regenerateFailed: argv.includes('--regenerate-failed'),
    question: null,
    limit: Infinity,
    server: !argv.includes('--no-server')
  };
  const questionIndex = argv.indexOf('--question');
  if (questionIndex >= 0) options.question = String(argv[questionIndex + 1] || '');
  const limitIndex = argv.indexOf('--limit');
  if (limitIndex >= 0) options.limit = Math.max(0, Number(argv[limitIndex + 1]) || 0);
  return options;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256Bytes(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function getGeneratorRevision() {
  const sources = [__filename, path.join(__dirname, 'speech_coach_audio_core.js')];
  const hash = crypto.createHash('sha256');
  sources.forEach((sourcePath) => {
    hash.update(path.basename(sourcePath), 'utf8');
    hash.update('\0');
    hash.update(fs.readFileSync(sourcePath));
    hash.update('\0');
  });
  return hash.digest('hex');
}

function shouldReuseAsset(existing, fileExists, options) {
  return existing?.status === 'ready' && fileExists && options?.resume !== false;
}

function gitRevision(directory) {
  const result = spawnSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? String(result.stdout || '').trim() : null;
}

function wordList(text) {
  return String(text || '').match(/[A-Za-z0-9']+/g) || [];
}

function getTargetIpa(event) {
  if (event.family !== 'weak_form_reduction') return event.targetIpa || null;
  return event.targetIpa || null;
}

function buildInventory(rows, options = {}) {
  const selectedRows = rows
    .filter((row) => !options.question || String(inventoryCore.getQuestionId(row)) === String(options.question))
    .slice(0, options.limit == null ? Infinity : options.limit);
  return selectedRows.flatMap((row) => {
    const questionId = inventoryCore.getQuestionId(row);
    const referenceText = inventoryCore.getReferenceText(row);
    const events = service.buildGenericEvents(referenceText, questionId);
    return events.map((event) => {
      const context = core.buildEventContext(referenceText, event);
      return {
        questionId,
        referenceText,
        event,
        context,
        uiIpa: getTargetIpa(event)
      };
    });
  });
}

function splitPhonemeWords(phonemes, expectedWordCount) {
  const words = String(phonemes || '').trim().split(/\s+/).filter(Boolean);
  if (words.length !== expectedWordCount) {
    throw new Error(`phoneme alignment mismatch: expected ${expectedWordCount} words, got ${words.length}`);
  }
  return words;
}

function findFfmpeg() {
  const candidates = [process.env.FFMPEG, 'ffmpeg', path.join(KOKORO_ROOT, '.venv', 'Scripts', 'ffmpeg.exe')].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate !== 'ffmpeg' && !fs.existsSync(candidate)) continue;
    const result = spawnSync(candidate, ['-version'], { stdio: 'ignore', windowsHide: true });
    if (result.status === 0) return candidate;
  }
  const pythonCandidates = [process.env.PYTHON, path.join(KOKORO_ROOT, '.venv', 'Scripts', 'python.exe'), 'python'].filter(Boolean);
  for (const python of pythonCandidates) {
    const result = spawnSync(python, ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8', windowsHide: true });
    const candidate = String(result.stdout || '').trim();
    if (result.status === 0 && candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function startKokoroServer(logPath) {
  const python = path.join(KOKORO_ROOT, '.venv', 'Scripts', 'python.exe');
  if (!fs.existsSync(python)) throw new Error(`Kokoro Python runtime not found: ${python}`);
  const bundledEspeak = [
    path.join(KOKORO_ROOT, '.venv', 'Lib', 'site-packages', 'espeakng_loader', 'espeak-ng.dll'),
    path.join(KOKORO_ROOT, '.venv', 'Lib', 'site-packages', 'espeakng_loader', 'libespeak-ng.dll')
  ].find((candidate) => fs.existsSync(candidate));
  const espeakData = path.join(KOKORO_ROOT, '.venv', 'Lib', 'site-packages', 'espeakng_loader', 'espeak-ng-data');
  const env = {
    ...process.env,
    PHONEMIZER_ESPEAK_LIBRARY: process.env.PHONEMIZER_ESPEAK_LIBRARY || bundledEspeak || 'C:\\Program Files\\eSpeak NG\\libespeak-ng.dll',
    ESPEAK_DATA_PATH: process.env.ESPEAK_DATA_PATH || (fs.existsSync(espeakData) ? espeakData : undefined),
    PYTHONUTF8: '1',
    PYTHONUNBUFFERED: '1',
    PROJECT_ROOT: KOKORO_ROOT,
    USE_GPU: 'false',
    USE_ONNX: 'false',
    PYTHONPATH: `${KOKORO_ROOT};${path.join(KOKORO_ROOT, 'api')}`,
    MODEL_DIR: 'src/models',
    VOICES_DIR: 'src/voices/v1_0',
    WEB_PLAYER_PATH: path.join(KOKORO_ROOT, 'web')
  };
  const log = fs.openSync(logPath, 'a');
  const child = spawn(python, ['-m', 'uvicorn', 'api.src.main:app', '--host', '127.0.0.1', '--port', '8880'], {
    cwd: KOKORO_ROOT,
    env,
    detached: false,
    windowsHide: true,
    stdio: ['ignore', log, log]
  });
  return child;
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  return response.json();
}

async function waitForKokoro() {
  let lastError = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const voices = await requestJson(`${KOKORO_URL}/v1/audio/voices`);
      const text = JSON.stringify(voices);
      if (!text.includes(VOICE)) throw new Error(`voice ${VOICE} is not exposed`);
      const phonemeCheck = await requestJson(`${KOKORO_URL}/dev/phonemize`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'in mathematics', language: 'a' })
      });
      if (!phonemeCheck.phonemes) throw new Error('phoneme endpoint returned no phonemes');
      return { voices, phonemeCheck };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`Kokoro did not become ready: ${lastError?.message || 'unknown error'}`);
}

async function phonemize(text) {
  const result = await requestJson(`${KOKORO_URL}/dev/phonemize`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, language: 'a' })
  });
  return String(result.phonemes || '').trim();
}

async function generateWav(phonemes) {
  const response = await fetch(`${KOKORO_URL}/dev/generate_from_phonemes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'audio/wav' },
    body: JSON.stringify({ phonemes, voice: VOICE })
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  return Buffer.from(await response.arrayBuffer());
}

async function transcodeToMp3(ffmpeg, wavPath, mp3Path) {
  await fsp.mkdir(path.dirname(mp3Path), { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', wavPath, '-ac', '1', '-ar', '24000', '-codec:a', 'libmp3lame', '-b:a', '96k', mp3Path], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr || `ffmpeg exited ${code}`)));
  });
}

// Coverage describes written question manifests, including manifests with failed events.
// Never silently shrink declared coverage when an output has disappeared or is corrupt.
function collectQuestionManifestIds(questionRoot, declaredIds = []) {
  if (!Array.isArray(declaredIds) || declaredIds.some((id) => typeof id !== 'string' || !/^[1-9]\d*$/.test(id))
    || new Set(declaredIds).size !== declaredIds.length) throw new Error('Invalid questionManifestIds catalog');
  const files = fs.existsSync(questionRoot) ? fs.readdirSync(questionRoot).filter((name) => name.endsWith('.json')) : [];
  const ids = new Set(declaredIds);
  for (const file of files) {
    const id = file.slice(0, -5);
    if (!/^[1-9]\d*$/.test(id)) throw new Error(`Invalid question manifest filename: ${file}`);
    ids.add(id);
  }
  for (const id of ids) {
    const question = JSON.parse(fs.readFileSync(path.join(questionRoot, `${id}.json`), 'utf8'));
    if (question?.version !== CONTRACT_VERSION || question.questionId !== id
      || !question.events || typeof question.events !== 'object' || Array.isArray(question.events)) {
      throw new Error(`Invalid question manifest: ${id}`);
    }
  }
  return [...ids].sort((a, b) => a.length - b.length || a.localeCompare(b));
}

async function loadOrCreateManifest(workbookPath, runId) {
  const manifestPath = path.join(AUDIO_ROOT, 'manifest.json');
  let manifest = {};
  if (fs.existsSync(manifestPath)) manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  manifest.questionManifestIds = collectQuestionManifestIds(QUESTION_ROOT, manifest.questionManifestIds);
  manifest.version = CONTRACT_VERSION;
  manifest.voice = VOICE;
  manifest.speed = SPEED;
  manifest.format = 'mp3';
  manifest.sampleRate = 24000;
  manifest.channels = 1;
  manifest.sourceWorkbookSha256 = sha256File(workbookPath);
  manifest.rulesVersion = service.VERSION;
  manifest.generatorRevision = getGeneratorRevision();
  manifest.generatorRunId = runId;
  manifest.kokoro = {
    checkout: KOKORO_ROOT,
    revision: gitRevision(KOKORO_ROOT),
    voiceEndpoint: `${KOKORO_URL}/v1/audio/voices`,
    phonemeEndpoint: `${KOKORO_URL}/dev/phonemize`,
    generationEndpoint: `${KOKORO_URL}/dev/generate_from_phonemes`
  };
  manifest.questionManifestPattern = 'questions/{questionId}.json';
  manifest.assets = manifest.assets || {};
  return { manifest, manifestPath };
}

async function saveJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(REPORT_ROOT, runId);
  await fsp.mkdir(runDir, { recursive: true });
  const workbookPath = path.join(ROOT, 'public', 'database', 'RA', 'RA.xlsx');
  const { rows } = await inventoryCore.loadWorkbookRows(workbookPath);
  const inventory = buildInventory(rows, options);
  const byQuestion = new Map();
  inventory.forEach((item) => {
    if (!byQuestion.has(item.questionId)) byQuestion.set(item.questionId, []);
    byQuestion.get(item.questionId).push(item);
  });
  const counts = inventory.reduce((acc, item) => { acc[item.event.family] = (acc[item.event.family] || 0) + 1; return acc; }, {});
  console.log(JSON.stringify({ runId, questionCount: byQuestion.size, eventCount: inventory.length, counts, dryRun: options.dryRun }, null, 2));
  if (options.dryRun) return;

  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error('ffmpeg is required for MP3 output; install it or set FFMPEG');
  let server = null;
  let serverStarted = false;
  try {
    if (options.server) {
      try { await waitForKokoro(); } catch (_) {
        server = startKokoroServer(path.join(runDir, 'kokoro-server.log'));
        serverStarted = true;
        await waitForKokoro();
      }
    }
    const { manifest, manifestPath } = await loadOrCreateManifest(workbookPath, runId);
    const stats = { generated: 0, reused: 0, failed: 0, skipped: 0 };
    const failures = [];
    for (const [questionId, items] of byQuestion.entries()) {
      const question = { version: CONTRACT_VERSION, questionId, events: {} };
      for (const item of items) {
        const { event } = item;
        let context = item.context;
        if (!context) {
          question.events[event.eventId] = { eventId: event.eventId, family: event.family, status: 'failed', reason: 'context_unavailable' };
          failures.push({ questionId, eventId: event.eventId, family: event.family, reason: 'context_unavailable' });
          stats.failed += 1;
          continue;
        }
        let attempt = 0;
        let completed = false;
        while (!completed) {
          try {
            const baseline = await phonemize(context.text);
            const baselineWords = splitPhonemeWords(baseline, wordList(context.text).length);
            const targetIpa = core.resolveWeakTargetIpa({
              targetWord: event.leftWord || event.phrase,
              nextPhonemeWord: baselineWords[context.targetOffset + 1] || '',
              fallbackIpa: item.uiIpa
            });
            const transformedWords = core.transformPhonemeWords({ family: event.family, phonemeWords: baselineWords, targetIndex: context.targetOffset, targetIpa });
            const transformation = core.validatePhonemeTransformation({
              family: event.family,
              baselineWords,
              transformedWords,
              targetIndex: context.targetOffset,
              targetIpa
            });
            if (!transformation.ok) throw new Error(transformation.reason);
            const controlledPhonemes = core.buildControlledPhonemes({ family: event.family, phonemeWords: transformedWords });
            const assetId = core.buildAssetId({ version: CONTRACT_VERSION, voice: VOICE, speed: SPEED, family: event.family, spokenText: context.text, targetOffset: context.targetOffset, phonemes: controlledPhonemes });
            const relativeFile = `clips/${assetId.slice(0, 2)}/${assetId}.mp3`;
            const mp3Path = path.join(AUDIO_ROOT, relativeFile);
            const existing = manifest.assets[assetId];
            if (shouldReuseAsset(existing, fs.existsSync(mp3Path), options)) {
              existing.file = relativeFile;
              existing.family = event.family;
              existing.spokenText = context.text;
              existing.targetOffset = context.targetOffset;
              existing.baselinePhonemeWords = baselineWords;
              existing.transformedPhonemeWords = transformedWords;
              existing.phonemes = controlledPhonemes;
              existing.uiIpa = targetIpa;
              existing.mp3Sha256 = existing.mp3Sha256 || sha256File(mp3Path);
              stats.reused += 1;
            } else {
              const wav = await generateWav(controlledPhonemes);
              const normalizedWav = core.normalizeWavBuffer(wav);
              let wavMeta;
              try {
                wavMeta = core.parseWavHeader(normalizedWav);
              } catch (error) {
                const diagnosticPath = path.join(runDir, 'diagnostics', `${assetId}.wav`);
                await fsp.mkdir(path.dirname(diagnosticPath), { recursive: true });
                await fsp.writeFile(diagnosticPath, wav);
                throw error;
              }
              const wavPath = path.join(runDir, 'wav', `${assetId}.wav`);
              await fsp.mkdir(path.dirname(wavPath), { recursive: true });
              await fsp.writeFile(wavPath, normalizedWav);
              await transcodeToMp3(ffmpeg, wavPath, mp3Path);
              manifest.assets[assetId] = { assetId, status: 'ready', file: relativeFile, family: event.family, spokenText: context.text, targetOffset: context.targetOffset, baselinePhonemeWords: baselineWords, transformedPhonemeWords: transformedWords, phonemes: controlledPhonemes, uiIpa: targetIpa, durationMs: wavMeta.durationMs, wavSha256: sha256Bytes(normalizedWav), mp3Sha256: sha256File(mp3Path), generatedAt: new Date().toISOString() };
              stats.generated += 1;
            }
            question.events[event.eventId] = { eventId: event.eventId, assetId, status: manifest.assets[assetId].status, file: `/database/RA/speech-coach-audio/v1/${relativeFile.replace(/\\/g, '/')}`, family: event.family, spokenText: context.text, targetOffset: context.targetOffset, phonemes: controlledPhonemes, uiIpa: targetIpa, durationMs: manifest.assets[assetId].durationMs, mp3Sha256: manifest.assets[assetId].mp3Sha256 };
            completed = true;
          } catch (error) {
            if (event.family === 'weak_form_reduction' && attempt === 0) {
              const wider = core.buildEventContext(item.referenceText, event, 5);
              if (wider && wider.text !== context.text) {
                context = wider;
                attempt += 1;
                continue;
              }
            }
            question.events[event.eventId] = { eventId: event.eventId, family: event.family, phrase: event.phrase, status: 'failed', reason: error.message };
            failures.push({ questionId, eventId: event.eventId, family: event.family, reason: error.message });
            stats.failed += 1;
            completed = true;
          }
        }
      }
      await saveJson(path.join(QUESTION_ROOT, `${questionId}.json`), question);
      manifest.questionManifestIds = [...new Set([...manifest.questionManifestIds, questionId])]
        .sort((a, b) => a.length - b.length || a.localeCompare(b));
      await saveJson(manifestPath, manifest);
      console.log(`question ${questionId}: ${Object.keys(question.events).length} events`);
    }
    await saveJson(path.join(runDir, 'generation-report.json'), { runId, counts, stats, manifest: manifestPath });
    await saveJson(path.join(runDir, 'failure-report.json'), { runId, failures });
    await saveJson(path.join(runDir, 'listening-report.json'), {
      runId,
      status: 'pending_manual_audit',
      note: 'Audio generation and deterministic file validation do not replace human listening. Audit rare yod events, every family, every weak-word type, regenerated items, and a seeded sample before release.',
      seed: 731,
      sampleRate: 0.01
    });
    console.log(JSON.stringify({ runId, stats }, null, 2));
  } finally {
    if (serverStarted && server) {
      try { server.kill(); } catch (_) { /* best effort */ }
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { collectQuestionManifestIds, parseArgs, buildInventory, splitPhonemeWords, getTargetIpa, getGeneratorRevision, shouldReuseAsset, waitForKokoro };
