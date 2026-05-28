/* eslint-disable no-console */
/**
 * Kokoro TTS Batch Audio Generator - Summarize Spoken Text (SST)
 *
 * Reads SST.xlsx, selects three deterministic voice variants per actual
 * question ID, generates static audio, and writes an ID-keyed manifest.
 */

const fs = require('fs');
const path = require('path');
const Excel = require('exceljs');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const EXCEL_PATH = path.join(ROOT_DIR, 'public', 'database', 'SST', 'SST', 'SST.xlsx');
const AUDIO_DIR = path.join(ROOT_DIR, 'public', 'database', 'SST', 'audio');
const MANIFEST_PATH = path.join(AUDIO_DIR, 'manifest.json');
const ERROR_LOG_PATH = path.join(ROOT_DIR, 'kokoro_sst_errors.log');
const KOKORO_API = process.env.KOKORO_API || 'http://localhost:8880/v1/audio/speech';
const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.KOKORO_TIMEOUT_MS || '120000') || 120000);
const SPEED = 1.0;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;
const SAVE_EVERY_N_QUESTIONS = 10;

const US_FEMALE = [
  { id: 'af_alloy', name: 'Alloy', gender: 'female', accent: 'American' },
  { id: 'af_bella', name: 'Bella', gender: 'female', accent: 'American' },
  { id: 'af_heart', name: 'Heart', gender: 'female', accent: 'American' },
  { id: 'af_kore', name: 'Kore', gender: 'female', accent: 'American' },
  { id: 'af_sarah', name: 'Sarah', gender: 'female', accent: 'American' }
];
const US_MALE = [
  { id: 'am_echo', name: 'Echo', gender: 'male', accent: 'American' },
  { id: 'am_eric', name: 'Eric', gender: 'male', accent: 'American' },
  { id: 'am_fenrir', name: 'Fenrir', gender: 'male', accent: 'American' },
  { id: 'am_liam', name: 'Liam', gender: 'male', accent: 'American' },
  { id: 'am_michael', name: 'Michael', gender: 'male', accent: 'American' },
  { id: 'am_puck', name: 'Puck', gender: 'male', accent: 'American' }
];
const UK_VOICES = [
  { id: 'bf_emma', name: 'Emma', gender: 'female', accent: 'British' },
  { id: 'bm_fable', name: 'Fable', gender: 'male', accent: 'British' },
  { id: 'bm_george', name: 'George', gender: 'male', accent: 'British' },
  { id: 'bm_lewis', name: 'Lewis', gender: 'male', accent: 'British' }
];

function parseArguments(argv = process.argv.slice(2)) {
  const limitIndex = argv.indexOf('--limit');
  const concurrencyIndex = argv.indexOf('--question-concurrency');
  return {
    dryRun: argv.includes('--dry-run'),
    parallelVoices: argv.includes('--parallel-voices'),
    limit: limitIndex >= 0 ? Number.parseInt(argv[limitIndex + 1], 10) : Infinity,
    questionConcurrency: concurrencyIndex >= 0
      ? Math.max(1, Number.parseInt(argv[concurrencyIndex + 1], 10) || 1)
      : 1
  };
}

function selectVoicesForQuestion(questionId) {
  const numericId = Number.parseInt(questionId, 10) || 0;
  return [
    US_FEMALE[numericId % US_FEMALE.length],
    US_MALE[(numericId + 1) % US_MALE.length],
    UK_VOICES[(numericId + 2) % UK_VOICES.length]
  ];
}

function shouldFailGenerationRun(stats) {
  return Boolean(stats && stats.failed > 0);
}

async function loadQuestions() {
  const workbook = new Excel.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);
  const sheet = workbook.getWorksheet(1);
  const questions = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const id = String(row.getCell(1).value || '').trim();
    const transcript = String(row.getCell(3).value || '').trim();
    if (id && transcript) questions.push({ id, transcript });
  });
  return questions;
}

function loadManifest() {
  return fs.existsSync(MANIFEST_PATH) ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) : {};
}

function saveManifest(manifest) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const tempPath = `${MANIFEST_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(manifest, null, 2));
  fs.renameSync(tempPath, MANIFEST_PATH);
}

function recordFailure(questionId, voiceId, error) {
  fs.appendFileSync(
    ERROR_LOG_PATH,
    `[${new Date().toISOString()}] Q${questionId} voice=${voiceId}: ${error}\n`
  );
}

async function generateAudio(text, voiceId, attempt = 0) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(KOKORO_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: text,
        voice: voiceId,
        response_format: 'mp3',
        speed: SPEED
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`API ${response.status}: ${response.statusText}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (attempt >= MAX_RETRIES) throw error;
    const delay = RETRY_BASE_DELAY_MS * (2 ** attempt);
    console.warn(`  Retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms: ${error.message}`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return generateAudio(text, voiceId, attempt + 1);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function processQuestion(question, manifest, stats, { dryRun, parallelVoices }) {
  const variants = selectVoicesForQuestion(question.id);
  const folder = path.join(AUDIO_DIR, question.id);
  if (!dryRun) fs.mkdirSync(folder, { recursive: true });
  if (!manifest[question.id]) manifest[question.id] = [];

  const processVoice = async (voice) => {
    const file = `SST_${question.id}_${voice.id}.mp3`;
    const filePath = path.join(folder, file);
    const entry = { id: voice.id, name: voice.name, gender: voice.gender, accent: voice.accent, file };
    const existingIndex = manifest[question.id].findIndex((item) => item.id === voice.id);
    if (existingIndex >= 0) manifest[question.id][existingIndex] = entry;
    else manifest[question.id].push(entry);

    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
      stats.skipped += 1;
      return;
    }
    if (dryRun) {
      stats.dryRun += 1;
      console.log(`  [DRY-RUN] Would generate ${file}`);
      return;
    }
    try {
      const temporaryPath = `${filePath}.tmp`;
      fs.writeFileSync(temporaryPath, await generateAudio(question.transcript, voice.id));
      fs.renameSync(temporaryPath, filePath);
      stats.generated += 1;
      console.log(`  OK ${file}`);
    } catch (error) {
      const temporaryPath = `${filePath}.tmp`;
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
      stats.failed += 1;
      recordFailure(question.id, voice.id, error.message);
      console.error(`  FAIL ${file}: ${error.message}`);
    }
  };

  if (parallelVoices) {
    await Promise.all(variants.map(processVoice));
    return;
  }
  for (const voice of variants) {
    await processVoice(voice);
  }
}

async function main(argv = process.argv.slice(2)) {
  const { dryRun, parallelVoices, limit, questionConcurrency } = parseArguments(argv);
  console.log('=== Kokoro TTS Batch Generator - SST ===');
  console.log(`Workbook: ${EXCEL_PATH}`);
  console.log(`Output: ${AUDIO_DIR}`);
  console.log(`Dry run: ${dryRun}`);
  console.log(`Parallel voices: ${parallelVoices}`);
  console.log(`Question concurrency: ${questionConcurrency}`);

  const allQuestions = await loadQuestions();
  const questions = allQuestions.slice(0, Number.isFinite(limit) ? limit : allQuestions.length);
  const manifest = loadManifest();
  const stats = { generated: 0, skipped: 0, failed: 0, dryRun: 0 };
  console.log(`Loaded ${allQuestions.length} questions. Processing ${questions.length}.`);

  for (let index = 0; index < questions.length; index += questionConcurrency) {
    const batch = questions.slice(index, index + questionConcurrency);
    batch.forEach((question, offset) => {
      console.log(`[${index + offset + 1}/${questions.length}] Q${question.id}`);
    });
    await Promise.all(batch.map((question) => processQuestion(question, manifest, stats, { dryRun, parallelVoices })));
    if (!dryRun && (index + batch.length) % SAVE_EVERY_N_QUESTIONS === 0) saveManifest(manifest);
  }
  if (!dryRun) saveManifest(manifest);

  console.log(`Generated: ${stats.generated}`);
  console.log(`Skipped: ${stats.skipped}`);
  console.log(`Failed: ${stats.failed}`);
  if (dryRun) console.log(`Would generate: ${stats.dryRun}`);
  if (shouldFailGenerationRun(stats)) process.exitCode = 1;
  return stats;
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArguments,
  selectVoicesForQuestion,
  shouldFailGenerationRun
};
