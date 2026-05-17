/* eslint-disable no-console */
/**
 * Kokoro TTS Batch Audio Generator — Respond To a Situation (RTS)
 *
 * Generates audio for all 146 RTS questions using randomized Kokoro voices.
 * Each question gets ONE voice (randomly selected from 15 voices) at 1x speed.
 *
 * Usage:
 *   node scripts/kokoro/kokoro_batch_rts.js                    # Full run
 *   node scripts/kokoro/kokoro_batch_rts.js --dry-run          # Validate without generating
 *   node scripts/kokoro/kokoro_batch_rts.js --limit 5          # Only process first 5 questions
 *   node scripts/kokoro/kokoro_batch_rts.js --resume           # Skip existing files (default)
 */

const fs = require('fs');
const path = require('path');

// === Configuration ===
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const JSON_PATH = path.join(ROOT_DIR, 'public', 'database', 'RTS', 'rts_questions.json');
const AUDIO_DIR = path.join(ROOT_DIR, 'public', 'database', 'RTS', 'audio');
const MANIFEST_PATH = path.join(AUDIO_DIR, 'manifest.json');
const ERROR_LOG_PATH = path.join(ROOT_DIR, 'kokoro_rts_errors.log');
const KOKORO_API = 'http://localhost:8880/v1/audio/speech';
const SPEED = 1.0;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;
const SAVE_EVERY_N_QUESTIONS = 20;

// === Voice Registry (same 15 voices as Read Aloud) ===
const VOICES = [
  { id: 'af_alloy',   name: 'Alloy',   gender: 'female', accent: 'American' },
  { id: 'af_bella',   name: 'Bella',   gender: 'female', accent: 'American' },
  { id: 'af_heart',   name: 'Heart',   gender: 'female', accent: 'American' },
  { id: 'af_kore',    name: 'Kore',    gender: 'female', accent: 'American' },
  { id: 'af_sarah',   name: 'Sarah',   gender: 'female', accent: 'American' },
  { id: 'bf_emma',    name: 'Emma',    gender: 'female', accent: 'British'  },
  { id: 'am_echo',    name: 'Echo',    gender: 'male',   accent: 'American' },
  { id: 'am_eric',    name: 'Eric',    gender: 'male',   accent: 'American' },
  { id: 'am_fenrir',  name: 'Fenrir',  gender: 'male',   accent: 'American' },
  { id: 'am_liam',    name: 'Liam',    gender: 'male',   accent: 'American' },
  { id: 'am_michael', name: 'Michael', gender: 'male',   accent: 'American' },
  { id: 'am_puck',    name: 'Puck',    gender: 'male',   accent: 'American' },
  { id: 'bm_fable',   name: 'Fable',   gender: 'male',   accent: 'British'  },
  { id: 'bm_george',  name: 'George',  gender: 'male',   accent: 'British'  },
  { id: 'bm_lewis',   name: 'Lewis',   gender: 'male',   accent: 'British'  },
];

// === CLI args ===
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;

/**
 * Deterministic but random-looking voice assignment per question ID.
 * Uses a simple hash so the same ID always gets the same voice.
 */
function assignVoice(questionId) {
  // Simple hash: spread IDs across the voice array
  const hash = (questionId * 2654435761) >>> 0; // Knuth multiplicative hash
  return VOICES[hash % VOICES.length];
}

async function generateAudio(text, voiceId, speed, retries = 0) {
  try {
    const response = await fetch(KOKORO_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: text,
        voice: voiceId,
        response_format: 'mp3',
        speed: speed,
      }),
    });
    if (!response.ok) {
      throw new Error(`API ${response.status}: ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    if (retries < MAX_RETRIES) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, retries);
      console.warn(`  Retry ${retries + 1}/${MAX_RETRIES} in ${delay}ms: ${err.message}`);
      await new Promise(r => setTimeout(r, delay));
      return generateAudio(text, voiceId, speed, retries + 1);
    }
    throw err;
  }
}

function loadManifest() {
  if (fs.existsSync(MANIFEST_PATH)) {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  }
  return {};
}

function saveManifest(manifest) {
  const tmpPath = MANIFEST_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2));
  fs.renameSync(tmpPath, MANIFEST_PATH);
}

function logError(qId, voiceId, error) {
  const line = `[${new Date().toISOString()}] Q${qId} voice=${voiceId}: ${error}\n`;
  fs.appendFileSync(ERROR_LOG_PATH, line);
}

function loadQuestions() {
  console.log(`Reading JSON: ${JSON_PATH}`);
  const raw = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
  return raw.filter(q => q.id && q.answer);
}

async function processQuestion(question, manifest, stats) {
  const qId = String(question.id);
  const voice = assignVoice(question.id);
  const filename = `RTS_${qId}.mp3`;
  const filepath = path.join(AUDIO_DIR, filename);

  // Skip if already exists (resume support)
  if (fs.existsSync(filepath)) {
    stats.skipped++;
    // Still ensure manifest entry exists
    if (!manifest[qId]) {
      manifest[qId] = { voice: voice.id, voiceName: voice.name, gender: voice.gender, accent: voice.accent, file: filename };
    }
    return;
  }

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] Would generate: ${filename} (voice: ${voice.name}/${voice.id})`);
    stats.dryRun++;
    return;
  }

  try {
    const buffer = await generateAudio(question.answer, voice.id, SPEED);
    fs.writeFileSync(filepath, buffer);
    stats.generated++;

    // Update manifest
    manifest[qId] = {
      voice: voice.id,
      voiceName: voice.name,
      gender: voice.gender,
      accent: voice.accent,
      file: filename,
    };

    process.stdout.write(`  ✓ ${filename} (${voice.name}/${voice.accent})\n`);
  } catch (err) {
    stats.failed++;
    logError(qId, voice.id, err.message);
    console.error(`  ✗ ${filename}: ${err.message}`);
  }
}

async function main() {
  console.log('=== Kokoro TTS Batch Generator — RTS ===');
  console.log(`API: ${KOKORO_API}`);
  console.log(`Speed: ${SPEED}`);
  console.log(`DRY-RUN: ${DRY_RUN}`);
  if (LIMIT < Infinity) console.log(`Limit: ${LIMIT} questions`);
  console.log('');

  // Ensure output directory exists
  if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    console.log(`Created output directory: ${AUDIO_DIR}`);
  }

  // Load questions from XLSX
  const allQuestions = loadQuestions();
  const questionsToProcess = allQuestions.slice(0, LIMIT);
  console.log(`Questions to process: ${questionsToProcess.length} / ${allQuestions.length}`);

  // Show voice distribution preview
  const voiceDist = {};
  questionsToProcess.forEach(q => {
    const v = assignVoice(q.id);
    voiceDist[v.name] = (voiceDist[v.name] || 0) + 1;
  });
  console.log(`Voice distribution: ${Object.entries(voiceDist).map(([n, c]) => `${n}:${c}`).join(', ')}`);
  console.log('');

  // Load existing manifest
  const manifest = loadManifest();

  const stats = { generated: 0, skipped: 0, failed: 0, dryRun: 0 };
  const startTime = Date.now();

  for (let i = 0; i < questionsToProcess.length; i++) {
    const question = questionsToProcess[i];
    const progress = `[${i + 1}/${questionsToProcess.length}]`;
    console.log(`${progress} Q${question.id}: ${question.title}`);

    await processQuestion(question, manifest, stats);

    // Save manifest every N questions
    if ((i + 1) % SAVE_EVERY_N_QUESTIONS === 0 && !DRY_RUN) {
      saveManifest(manifest);
      console.log(`  [Manifest saved after ${i + 1} questions]`);
    }
  }

  // Final manifest save
  if (!DRY_RUN) {
    saveManifest(manifest);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n=== Complete ===');
  console.log(`Generated: ${stats.generated}`);
  console.log(`Skipped (existing): ${stats.skipped}`);
  console.log(`Failed: ${stats.failed}`);
  if (DRY_RUN) console.log(`Would generate: ${stats.dryRun}`);
  console.log(`Time: ${elapsed}s`);
  if (stats.failed > 0) console.log(`Error log: ${ERROR_LOG_PATH}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
