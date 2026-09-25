/* eslint-disable no-console */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const KOKORO_ROOT = process.env.KOKORO_ROOT
  || (fs.existsSync(path.join(ROOT, 'Kokoro-FastAPI')) ? path.join(ROOT, 'Kokoro-FastAPI') : 'C:\\Cursor AI\\Kokoro-FastAPI');
const KOKORO_URL = process.env.KOKORO_URL || 'http://127.0.0.1:8880';
const VOICE = 'af_heart';
const OUTPUT_DIR = path.join(ROOT, 'public', 'database', 'RA', 'weak-forms', 'canonical');

const CANONICAL_ITEMS = [
  { key: 'to', phrase: 'to go', ipa: '/tə ɡoʊ/', targetOffset: 0, targetIpa: '/tə/' },
  { key: 'the-consonant', phrase: 'the book', ipa: '/ðə bʊk/', targetOffset: 0, targetIpa: '/ðə/' },
  { key: 'the-vowel', phrase: 'the apple', ipa: '/ði ˈæp.əl/', targetOffset: 0, targetIpa: '/ði/' },
  { key: 'a', phrase: 'a book', ipa: '/ə bʊk/', targetOffset: 0, targetIpa: '/ə/' },
  { key: 'an', phrase: 'an hour', ipa: '/ən ˈaʊ.ər/', targetOffset: 0, targetIpa: '/ən/' },
  { key: 'of', phrase: 'cup of tea', ipa: '/kʌp əv tiː/', targetOffset: 1, targetIpa: '/əv/' },
  { key: 'and', phrase: 'bread and butter', ipa: '/bɹɛd ən ˈbʌt.ər/', targetOffset: 1, targetIpa: '/ən/' },
  { key: 'for', phrase: 'wait for me', ipa: '/weɪt fər miː/', targetOffset: 1, targetIpa: '/fər/' },
  { key: 'can', phrase: 'you can go', ipa: '/juː kən ɡoʊ/', targetOffset: 1, targetIpa: '/kən/' },
  { key: 'have', phrase: 'we have seen', ipa: '/wiː həv siːn/', targetOffset: 1, targetIpa: '/həv/' },
  { key: 'has', phrase: 'she has done', ipa: '/ʃiː həz dʌn/', targetOffset: 1, targetIpa: '/həz/' },
  { key: 'was', phrase: 'it was good', ipa: '/ɪt wəz ɡʊd/', targetOffset: 1, targetIpa: '/wəz/' },
  { key: 'were', phrase: 'they were here', ipa: '/ðeɪ wər hɪr/', targetOffset: 1, targetIpa: '/wər/' },
  { key: 'from', phrase: 'away from home', ipa: '/əˈweɪ frəm hoʊm/', targetOffset: 1, targetIpa: '/frəm/' }
];

function wordList(text) {
  return String(text || '').match(/[A-Za-z0-9']+/g) || [];
}

function normalizeIpa(value) {
  return String(value || '').replace(/^\/+|\/+$/g, '').trim();
}

function splitPhonemeWords(phonemes, expectedWordCount) {
  const words = String(phonemes || '').trim().split(/\s+/).filter(Boolean);
  if (words.length !== expectedWordCount) {
    throw new Error(`phoneme alignment mismatch: expected ${expectedWordCount} words, got ${words.length} (${phonemes})`);
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

async function main() {
  await fsp.mkdir(OUTPUT_DIR, { recursive: true });
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error('ffmpeg is required for MP3 transcoding');

  let server = null;
  try {
    try {
      await waitForKokoro();
    } catch (_) {
      console.log('Starting local Kokoro-FastAPI server...');
      const logPath = path.join(ROOT, 'kokoro-canonical-server.log');
      server = startKokoroServer(logPath);
      await waitForKokoro();
      console.log('Kokoro-FastAPI server is ready.');
    }

    const manifest = {
      version: 'canonical-weak-forms-v1',
      voice: VOICE,
      format: 'mp3',
      sampleRate: 24000,
      generatedAt: new Date().toISOString(),
      items: {}
    };

    const tempWav = path.join(OUTPUT_DIR, '_temp.wav');

    for (const item of CANONICAL_ITEMS) {
      console.log(`Generating canonical weak form [${item.key}] ("${item.phrase}")...`);
      const words = wordList(item.phrase);
      const baseline = await phonemize(item.phrase);
      let controlledPhonemes;
      try {
        const baselineWords = splitPhonemeWords(baseline, words.length);
        baselineWords[item.targetOffset] = normalizeIpa(item.targetIpa);
        controlledPhonemes = baselineWords.join(' ');
      } catch (e) {
        console.warn(`Word split fallback for "${item.phrase}":`, e.message);
        controlledPhonemes = normalizeIpa(item.ipa);
      }

      console.log(`  Phonemes: ${controlledPhonemes}`);
      const wavBuffer = await generateWav(controlledPhonemes);
      await fsp.writeFile(tempWav, wavBuffer);

      const mp3Path = path.join(OUTPUT_DIR, `${item.key}.mp3`);
      await transcodeToMp3(ffmpeg, tempWav, mp3Path);

      manifest.items[item.key] = {
        key: item.key,
        phrase: item.phrase,
        targetIpa: item.targetIpa,
        fullIpa: item.ipa,
        controlledPhonemes,
        file: `/database/RA/weak-forms/canonical/${item.key}.mp3`,
        sizeBytes: (await fsp.stat(mp3Path)).size
      };
      console.log(`  Saved ${mp3Path} (${manifest.items[item.key].sizeBytes} bytes)`);
    }

    if (fs.existsSync(tempWav)) {
      await fsp.unlink(tempWav);
    }

    const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
    await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    console.log(`Successfully generated all 14 canonical weak forms in ${OUTPUT_DIR}`);
  } finally {
    if (server) {
      console.log('Stopping Kokoro server...');
      server.kill();
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error generating canonical weak forms:', err);
    process.exit(1);
  });
}

module.exports = {
  CANONICAL_ITEMS,
  main
};
