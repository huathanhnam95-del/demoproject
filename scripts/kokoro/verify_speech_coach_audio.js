/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const core = require('./speech_coach_audio_core.js');
const inventoryCore = require('../read-aloud/connected-speech-index-core.js');
const service = require('../../functions/src/read-aloud/connected-speech-service.js');

const ROOT = path.resolve(__dirname, '../..');
const AUDIO_ROOT = path.join(ROOT, 'public', 'database', 'RA', 'speech-coach-audio', 'v1');
const QUESTION_ROOT = path.join(AUDIO_ROOT, 'questions');

function parseArgs(argv) {
  const questionIndex = argv.indexOf('--question');
  const limitIndex = argv.indexOf('--limit');
  return {
    question: questionIndex >= 0 ? String(argv[questionIndex + 1] || '') : null,
    limit: limitIndex >= 0 ? Math.max(0, Number(argv[limitIndex + 1]) || 0) : Infinity,
    allowFailed: argv.includes('--allow-failed')
  };
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function findFfmpeg() {
  const candidates = [process.env.FFMPEG, 'ffmpeg'].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate !== 'ffmpeg' && !fs.existsSync(candidate)) continue;
    if (spawnSync(candidate, ['-version'], { stdio: 'ignore', windowsHide: true }).status === 0) return candidate;
  }
  const pythonCandidates = [process.env.PYTHON, 'python'].filter(Boolean);
  for (const python of pythonCandidates) {
    const result = spawnSync(python, ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8', windowsHide: true });
    const candidate = String(result.stdout || '').trim();
    if (result.status === 0 && candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function decodeMp3(ffmpeg, filePath) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', filePath, '-ac', '1', '-ar', '24000', '-f', 'wav', 'pipe:1'], {
    encoding: null,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(String(result.stderr || 'ffmpeg decode failed').trim());
  return Buffer.from(result.stdout || Buffer.alloc(0));
}

function getExpectedInventory(rows, options) {
  const selectedRows = rows
    .filter((row) => !options.question || String(inventoryCore.getQuestionId(row)) === String(options.question))
    .slice(0, options.limit);
  const expected = new Map();
  selectedRows.forEach((row) => {
    const questionId = String(inventoryCore.getQuestionId(row));
    const referenceText = inventoryCore.getReferenceText(row);
    expected.set(questionId, service.buildGenericEvents(referenceText, questionId));
  });
  return expected;
}

async function verify(options = {}) {
  const manifestPath = path.join(AUDIO_ROOT, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const workbookPath = path.join(ROOT, 'public', 'database', 'RA', 'RA.xlsx');
  const rows = (await inventoryCore.loadWorkbookRows(workbookPath)).rows;
  const expected = getExpectedInventory(rows, options);
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error('ffmpeg is required for MP3 verification');
  const report = { manifest: manifestPath, questionCount: expected.size, eventCount: 0, ready: 0, failed: 0, missing: 0, malformed: 0, stale: 0, errors: [] };

  expected.forEach((events, questionId) => {
    const questionPath = path.join(QUESTION_ROOT, `${questionId}.json`);
    if (!fs.existsSync(questionPath)) {
      report.missing += events.length;
      report.errors.push({ questionId, reason: 'question_manifest_missing' });
      return;
    }
    const question = JSON.parse(fs.readFileSync(questionPath, 'utf8'));
    const expectedIds = new Set(events.map((event) => event.eventId));
    const actualIds = new Set(Object.keys(question.events || {}));
    events.forEach((event) => {
      report.eventCount += 1;
      const entry = question.events?.[event.eventId];
      if (!entry) {
        report.missing += 1;
        report.errors.push({ questionId, eventId: event.eventId, reason: 'event_missing' });
        return;
      }
      if (entry.status === 'failed') {
        report.failed += 1;
        report.errors.push({ questionId, eventId: event.eventId, reason: 'event_failed', detail: entry.reason || null });
        return;
      }
      const asset = manifest.assets?.[entry.assetId];
      const relative = String(asset?.file || '');
      const filePath = path.join(AUDIO_ROOT, relative.replace(/^[/\\]+/, ''));
      const check = core.validateManifestEntry({ event: entry, asset, fileExists: fs.existsSync(filePath) });
      if (!check.ok) {
        report[check.reason === 'file_missing' ? 'stale' : 'malformed'] += 1;
        report.errors.push({ questionId, eventId: event.eventId, reason: check.reason });
        return;
      }
      try {
        const transformation = core.validatePhonemeTransformation({
          family: asset.family,
          baselineWords: asset.baselinePhonemeWords,
          transformedWords: asset.transformedPhonemeWords,
          targetIndex: asset.targetOffset,
          targetIpa: asset.uiIpa
        });
        if (!transformation.ok) throw new Error(transformation.reason);
        const mp3Hash = sha256File(filePath);
        if (asset.mp3Sha256 !== mp3Hash) throw new Error('mp3_hash_mismatch');
        const decoded = decodeMp3(ffmpeg, filePath);
        const audio = core.parseWavHeader(core.normalizeWavBuffer(decoded));
        if (Math.abs(audio.durationMs - Number(asset.durationMs)) > 120) throw new Error('duration_mismatch');
        report.ready += 1;
      } catch (error) {
        report.malformed += 1;
        report.errors.push({ questionId, eventId: event.eventId, reason: error.message });
      }
    });
    for (const eventId of actualIds) {
      if (!expectedIds.has(eventId)) report.errors.push({ questionId, eventId, reason: 'unexpected_event' });
    }
  });
  return report;
}

if (require.main === module) {
  (async () => {
    try {
      const options = parseArgs(process.argv.slice(2));
      const report = await verify(options);
      console.log(JSON.stringify(report, null, 2));
      if ((report.missing || report.malformed || report.stale || (!options.allowFailed && report.failed)) > 0) process.exitCode = 1;
    } catch (error) {
      console.error(error.stack || error.message || error);
      process.exitCode = 1;
    }
  })();
}

module.exports = { parseArgs, verify, decodeMp3 };
