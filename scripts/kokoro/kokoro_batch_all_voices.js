/* eslint-disable no-console */
/**
 * Kokoro TTS Batch Audio Generator — All Voices
 *
 * Generates audio for ALL Read Aloud questions across ALL 15 Kokoro voices.
 * Updates manifest.json with the new voice-keyed schema as files are generated.
 *
 * Usage:
 *   node scripts/kokoro/kokoro_batch_all_voices.js                    # Full run
 *   node scripts/kokoro/kokoro_batch_all_voices.js --dry-run          # Validate without generating
 *   node scripts/kokoro/kokoro_batch_all_voices.js --limit 5          # Only process first 5 questions
 *   node scripts/kokoro/kokoro_batch_all_voices.js --voice am_echo    # Only generate for one voice
 *   node scripts/kokoro/kokoro_batch_all_voices.js --resume           # Skip existing files (default)
 */

const fs = require('fs');
const path = require('path');

// === Configuration ===
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const RA_JSON_PATH = path.join(ROOT_DIR, 'RA_rechunked.json');
const AUDIO_DIR = path.join(ROOT_DIR, 'public', 'database', 'RA', 'Voice', 'audio');
const MANIFEST_PATH = path.join(AUDIO_DIR, 'manifest.json');
const ERROR_LOG_PATH = path.join(ROOT_DIR, 'kokoro_generation_errors.log');
const KOKORO_API = 'http://localhost:8880/v1/audio/speech';
const SPEEDS = [
  { key: '100', speed: 0.9, label: 'Normal' },
  { key: '80',  speed: 0.75, label: 'Slow' },
];
const MAX_CONCURRENT = 3;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;
const SAVE_EVERY_N_QUESTIONS = 20;

// === Voice Registry ===
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
const voiceIdx = args.indexOf('--voice');
const SINGLE_VOICE = voiceIdx >= 0 ? args[voiceIdx + 1] : null;

function prepareText(prompt) {
  const chunkedText = prompt.new_chunked || prompt.old_chunked || prompt.text;
  return chunkedText
    .replace(/\s*\/\/\s*/g, '... ')
    .replace(/\s*\/\s*/g, ', ');
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

async function processQuestion(prompt, voices, manifest, stats) {
  const qId = String(prompt.id);
  const text = prepareText(prompt);

  for (const voice of voices) {
    for (const speedCfg of SPEEDS) {
      const filename = `RA_${qId}_${voice.id}_${speedCfg.key}.mp3`;
      const filepath = path.join(AUDIO_DIR, filename);

      // Skip if already exists (resume support)
      if (fs.existsSync(filepath)) {
        stats.skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`  [DRY-RUN] Would generate: ${filename}`);
        stats.dryRun++;
        continue;
      }

      try {
        const buffer = await generateAudio(text, voice.id, speedCfg.speed);
        fs.writeFileSync(filepath, buffer);
        stats.generated++;

        // Update manifest
        if (!manifest[qId]) manifest[qId] = {};
        if (!manifest[qId][voice.gender]) manifest[qId][voice.gender] = {};
        if (!manifest[qId][voice.gender][voice.id]) {
          manifest[qId][voice.gender][voice.id] = {
            name: voice.name,
            accent: voice.accent,
            files: {},
          };
        }
        manifest[qId][voice.gender][voice.id].files[speedCfg.key] = filename;

        process.stdout.write(`  \u2713 ${filename}\n`);
      } catch (err) {
        stats.failed++;
        logError(qId, voice.id, err.message);
        console.error(`  \u2717 ${filename}: ${err.message}`);
      }
    }
  }
}

async function main() {
  console.log('=== Kokoro TTS Batch Generator ===');
  console.log(`API: ${KOKORO_API}`);
  console.log(`Speeds: ${SPEEDS.map(s => `${s.label}(${s.speed})`).join(', ')}`);
  console.log(`DRY-RUN: ${DRY_RUN}`);
  if (SINGLE_VOICE) console.log(`Single voice: ${SINGLE_VOICE}`);
  if (LIMIT < Infinity) console.log(`Limit: ${LIMIT} questions`);
  console.log('');

  // Load questions
  const prompts = JSON.parse(fs.readFileSync(RA_JSON_PATH, 'utf-8'));
  const questionsToProcess = prompts.slice(0, LIMIT);
  console.log(`Questions to process: ${questionsToProcess.length} / ${prompts.length}`);

  // Filter voices
  const voices = SINGLE_VOICE
    ? VOICES.filter(v => v.id === SINGLE_VOICE)
    : VOICES;
  console.log(`Voices to generate: ${voices.length} (${voices.map(v => v.id).join(', ')})`);
  console.log(`Total files: ~${questionsToProcess.length * voices.length * SPEEDS.length} (${voices.length} voices x ${SPEEDS.length} speeds)`);
  console.log('');

  // Load existing manifest
  const manifest = loadManifest();

  const stats = { generated: 0, skipped: 0, failed: 0, dryRun: 0 };
  const startTime = Date.now();

  for (let i = 0; i < questionsToProcess.length; i++) {
    const prompt = questionsToProcess[i];
    const progress = `[${i + 1}/${questionsToProcess.length}]`;
    console.log(`${progress} Q${prompt.id}`);

    await processQuestion(prompt, voices, manifest, stats);

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
