/* eslint-disable no-console */
/**
 * Kokoro TTS Batch Audio Generator - Highlight Incorrect Words (HIW)
 *
 * Reads HIW.xlsx, cleans Column C (ANSWER) to create Column D (correct transcripts),
 * generates 3 randomized voice MP3s per question using local Kokoro,
 * and writes manifest.json.
 */

const fs = require('fs');
const path = require('path');
const Excel = require('exceljs');

// === Configuration ===
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const EXCEL_PATH = path.join(ROOT_DIR, 'public', 'database', 'Highlight Incorrect Words', 'HIW', 'HIW.xlsx');
const AUDIO_DIR = path.join(ROOT_DIR, 'public', 'database', 'Highlight Incorrect Words', 'audio');
const MANIFEST_PATH = path.join(AUDIO_DIR, 'manifest.json');
const ERROR_LOG_PATH = path.join(ROOT_DIR, 'kokoro_hiw_errors.log');
const KOKORO_API = 'http://localhost:8880/v1/audio/speech';
const SPEED = 1.0;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;
const SAVE_EVERY_N_QUESTIONS = 5;

// === Voice Registry ===
const US_FEMALE = [
  { id: 'af_alloy',   name: 'Alloy',   gender: 'female', accent: 'American' },
  { id: 'af_bella',   name: 'Bella',   gender: 'female', accent: 'American' },
  { id: 'af_heart',   name: 'Heart',   gender: 'female', accent: 'American' },
  { id: 'af_kore',    name: 'Kore',    gender: 'female', accent: 'American' },
  { id: 'af_sarah',   name: 'Sarah',   gender: 'female', accent: 'American' },
];

const US_MALE = [
  { id: 'am_echo',    name: 'Echo',    gender: 'male',   accent: 'American' },
  { id: 'am_eric',    name: 'Eric',    gender: 'male',   accent: 'American' },
  { id: 'am_fenrir',  name: 'Fenrir',  gender: 'male',   accent: 'American' },
  { id: 'am_liam',    name: 'Liam',    gender: 'male',   accent: 'American' },
  { id: 'am_michael', name: 'Michael', gender: 'male',   accent: 'American' },
  { id: 'am_puck',    name: 'Puck',    gender: 'male',   accent: 'American' },
];

const UK_VOICES = [
  { id: 'bf_emma',    name: 'Emma',    gender: 'female', accent: 'British'  },
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
 * Deterministically select 3 voices based on question ID.
 * Returns [US_Female, US_Male, UK_Voice]
 */
function selectVoicesForQuestion(qId) {
  const numId = parseInt(qId, 10) || 0;
  const usFemale = US_FEMALE[numId % US_FEMALE.length];
  const usMale = US_MALE[(numId + 1) % US_MALE.length];
  const ukVoice = UK_VOICES[(numId + 2) % UK_VOICES.length];
  return [usFemale, usMale, ukVoice];
}

async function generateSpeechAudio(text, voiceId, speed, retries = 0) {
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
      return generateSpeechAudio(text, voiceId, speed, retries + 1);
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

function getCleanTranscript(answerText) {
  const pattern = /__([^_/]+)\/([^_/]+)__/g;
  return answerText.replace(pattern, '$2');
}

async function loadQuestionsAndPrepareExcel() {
  const workbook = new Excel.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);
  const worksheet = workbook.getWorksheet(1);
  const questions = [];

  // Ensure headers for D and E are set
  worksheet.getRow(1).getCell(4).value = 'ANSWER FOR COMPARE OR TRANSCRIPT';
  worksheet.getRow(1).getCell(5).value = 'EXPLANATION';

  let xlModified = false;

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    const id = row.getCell(1).value;
    const answer = row.getCell(3).value;
    
    if (id && answer) {
      const cleanTranscript = getCleanTranscript(String(answer).trim());
      const currentTranscript = row.getCell(4).value;
      
      if (String(currentTranscript).trim() !== cleanTranscript) {
        row.getCell(4).value = cleanTranscript;
        row.commit();
        xlModified = true;
      }

      questions.push({
        id: String(id),
        transcript: cleanTranscript,
      });
    }
  });

  if (xlModified && !DRY_RUN) {
    await workbook.xlsx.writeFile(EXCEL_PATH);
    console.log('Saved updated clean transcripts to Column D of workbook.');
  }

  return questions;
}

async function processQuestion(question, manifest, stats) {
  const qId = question.id;
  const transcript = question.transcript;
  const voices = selectVoicesForQuestion(qId);

  const folder = path.join(AUDIO_DIR, qId);
  if (!fs.existsSync(folder) && !DRY_RUN) {
    fs.mkdirSync(folder, { recursive: true });
  }

  // Ensure manifest list exists
  if (!manifest[qId]) {
    manifest[qId] = [];
  }

  for (const voice of voices) {
    const filename = `HIW_${qId}_${voice.id}.mp3`;
    const filepath = path.join(folder, filename);

    // Update manifest entry metadata
    const manifestEntry = {
      id: voice.id,
      name: voice.name,
      gender: voice.gender,
      accent: voice.accent,
      file: filename,
    };

    const existingIdx = manifest[qId].findIndex(v => v.id === voice.id);
    if (existingIdx >= 0) {
      manifest[qId][existingIdx] = manifestEntry;
    } else {
      manifest[qId].push(manifestEntry);
    }

    // Generate file if not exists
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
      // Generate speech via Kokoro
      const speechBuffer = await generateSpeechAudio(transcript, voice.id, SPEED);
      
      // Save directly to the destination file
      fs.writeFileSync(filepath, speechBuffer);
      
      stats.generated++;
      console.log(`  OK ${filename} (Speech, voice: ${voice.name})`);
    } catch (err) {
      stats.failed++;
      logError(qId, voice.id, err.message);
      console.error(`  FAIL ${filename}: ${err.message}`);
    }
  }
}

async function main() {
  console.log('=== Kokoro TTS Batch Generator - HIW ===');
  console.log(`EXCEL: ${EXCEL_PATH}`);
  console.log(`OUTPUT: ${AUDIO_DIR}`);
  console.log(`DRY-RUN: ${DRY_RUN}`);
  if (LIMIT < Infinity) console.log(`Limit: ${LIMIT} questions`);
  console.log('');

  // Ensure output directory exists
  if (!fs.existsSync(AUDIO_DIR) && !DRY_RUN) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    console.log(`Created directory: ${AUDIO_DIR}`);
  }

  // Load questions and write clean transcripts to Column D
  const allQuestions = await loadQuestionsAndPrepareExcel();
  const questionsToProcess = allQuestions.slice(0, LIMIT);
  console.log(`Loaded ${allQuestions.length} questions. Processing first ${questionsToProcess.length}.`);

  const manifest = loadManifest();
  const stats = { generated: 0, skipped: 0, failed: 0, dryRun: 0 };
  const startTime = Date.now();

  for (let i = 0; i < questionsToProcess.length; i++) {
    const question = questionsToProcess[i];
    const progress = `[${i + 1}/${questionsToProcess.length}]`;
    console.log(`${progress} Q${question.id}`);

    await processQuestion(question, manifest, stats);

    if ((i + 1) % SAVE_EVERY_N_QUESTIONS === 0 && !DRY_RUN) {
      saveManifest(manifest);
      console.log(`  [Manifest saved after ${i + 1} questions]`);
    }
  }

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
