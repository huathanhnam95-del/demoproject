/* eslint-disable no-console */
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const core = require('./pronunciation_reference_audio_core');

const ROOT = path.resolve(__dirname, '../..');
const KOKORO_ROOT = process.env.KOKORO_ROOT || path.join(ROOT, 'Kokoro-FastAPI');
const KOKORO_URL = String(process.env.KOKORO_URL || 'http://127.0.0.1:8880').replace(/\/+$/, '');

function apiUrl(base, route) {
  const normalized = String(base || '').replace(/\/+$/, '');
  return normalized.endsWith('/api') ? `${normalized}${route}` : `${normalized}/api${route}`;
}

async function adminFetch(url, token, options = {}) {
  if (!token) throw new Error('CRM_ADMIN_TOKEN or --token is required.');
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  return response;
}

function gitRevision(directory) {
  const result = spawnSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? String(result.stdout || '').trim() : 'unknown';
}

function generatorRevision() {
  const hash = crypto.createHash('sha256');
  for (const source of [__filename, path.join(__dirname, 'pronunciation_reference_audio_core.js')]) hash.update(fs.readFileSync(source));
  return hash.digest('hex');
}

function findFfmpeg() {
  for (const candidate of [process.env.FFMPEG, 'ffmpeg'].filter(Boolean)) {
    const result = spawnSync(candidate, ['-version'], { stdio: 'ignore', windowsHide: true });
    if (result.status === 0) return candidate;
  }
  throw new Error('ffmpeg is required to produce mono 24 kHz MP3 assets.');
}

function wavDurationMs(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Kokoro returned an invalid WAV file.');
  let offset = 12;
  let byteRate = 0;
  let dataBytes = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === 'fmt ' && size >= 16) byteRate = bytes.readUInt32LE(offset + 8 + 8);
    if (id === 'data') dataBytes = size;
    offset += 8 + size + (size % 2);
  }
  if (!byteRate || !dataBytes) throw new Error('Kokoro WAV structure is incomplete.');
  return (dataBytes / byteRate) * 1000;
}

async function kokoroReady() {
  const response = await fetch(`${KOKORO_URL}/v1/audio/voices`);
  if (!response.ok || !(await response.text()).includes(core.VOICE)) throw new Error('Kokoro af_heart voice is unavailable.');
}

function startKokoro(logFile) {
  const python = path.join(KOKORO_ROOT, '.venv', 'Scripts', 'python.exe');
  if (!fs.existsSync(python)) throw new Error(`Kokoro Python runtime not found: ${python}`);
  const log = fs.openSync(logFile, 'a');
  return spawn(python, ['-m', 'uvicorn', 'api.src.main:app', '--host', '127.0.0.1', '--port', '8880'], {
    cwd: KOKORO_ROOT,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1', PROJECT_ROOT: KOKORO_ROOT, USE_GPU: 'false', USE_ONNX: 'false', PYTHONPATH: `${KOKORO_ROOT};${path.join(KOKORO_ROOT, 'api')}`, MODEL_DIR: 'src/models', VOICES_DIR: 'src/voices/v1_0' },
    windowsHide: true,
    stdio: ['ignore', log, log]
  });
}

async function ensureKokoro(startServer, logFile) {
  try {
    await kokoroReady();
    return null;
  } catch (error) {
    if (!startServer) throw error;
  }
  const child = startKokoro(logFile);
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await kokoroReady();
      return child;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  try { child.kill(); } catch (_) { /* best effort */ }
  throw new Error(`Kokoro did not become ready: ${lastError?.message || 'unknown error'}`);
}

async function generateWav(controlledPhonemes) {
  const response = await fetch(`${KOKORO_URL}/dev/generate_from_phonemes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'audio/wav' },
    body: JSON.stringify({ phonemes: controlledPhonemes, voice: core.VOICE })
  });
  if (!response.ok) throw new Error(`Kokoro generation failed (${response.status}): ${await response.text()}`);
  return Buffer.from(await response.arrayBuffer());
}

async function transcode(ffmpeg, wavPath, mp3Path) {
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', wavPath, '-ac', '1', '-ar', '24000', '-codec:a', 'libmp3lame', '-b:a', '96k', mp3Path], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr || `ffmpeg exited ${code}`)));
  });
}

async function uploadGenerated(options, item, mp3, metadata) {
  const form = new FormData();
  form.append('audio', new Blob([mp3], { type: 'audio/mpeg' }), `${metadata.referenceAudioKey}.mp3`);
  form.append('metadata', JSON.stringify(metadata));
  const response = await adminFetch(
    apiUrl(options.apiBase, `/admin/dev/reference-audio-queue/${metadata.referenceAudioKey}/generated-audio`),
    options.token,
    { method: 'POST', body: form }
  );
  return response.json();
}

async function main() {
  const options = core.parseArgs(process.argv.slice(2));
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const reportDir = path.join(ROOT, 'test-results', 'pronunciation-reference-audio', runId);
  await fsp.mkdir(reportDir, { recursive: true });
  const response = await adminFetch(apiUrl(options.apiBase, '/admin/dev/reference-audio-queue/manifest'), options.token);
  const payload = await response.json();
  const jobs = core.selectWaitingItems(payload.items || payload.data?.items || [], options);
  console.log(JSON.stringify({ runId, waiting: jobs.length, dryRun: options.dryRun, voice: core.VOICE }, null, 2));
  if (options.dryRun || !jobs.length) return;

  const ffmpeg = findFfmpeg();
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bel-reference-audio-'));
  let server = null;
  const results = [];
  try {
    server = await ensureKokoro(options.startServer, path.join(reportDir, 'kokoro-server.log'));
    const provenance = { modelRevision: gitRevision(KOKORO_ROOT), generatorRevision: generatorRevision() };
    for (const item of jobs) {
      const key = item.referenceAudioKey || item.id;
      try {
        const controlledPhonemes = core.buildControlledPhonemes(item);
        const wav = await generateWav(controlledPhonemes);
        const durationMs = wavDurationMs(wav);
        const wavPath = path.join(tempDir, `${key}.wav`);
        const mp3Path = path.join(tempDir, `${key}.mp3`);
        await fsp.writeFile(wavPath, wav);
        await transcode(ffmpeg, wavPath, mp3Path);
        const metadata = core.buildGenerationMetadata(item, { ...provenance, controlledPhonemes, durationMs });
        const result = await uploadGenerated(options, item, await fsp.readFile(mp3Path), metadata);
        results.push({ referenceAudioKey: key, status: 'generated', response: result });
        console.log(`${item.word || key}: generated and verified`);
      } catch (error) {
        results.push({ referenceAudioKey: key, status: 'waiting', error: error.message });
        console.error(`${item.word || key}: ${error.message}`);
      }
      await fsp.writeFile(path.join(reportDir, 'generation-report.json'), `${JSON.stringify({ runId, results }, null, 2)}\n`);
    }
  } finally {
    if (server) try { server.kill(); } catch (_) { /* best effort */ }
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

module.exports = { apiUrl, findFfmpeg, generatorRevision, wavDurationMs };
