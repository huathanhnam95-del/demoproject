/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ExcelJS = require('exceljs');

const root = process.cwd();
const workbookPath = path.join(root, 'public', 'database', 'SST', 'SST', 'SST.xlsx');
const manifestPath = path.join(root, 'public', 'database', 'SST', 'audio', 'manifest.json');
const audioRoot = path.join(root, 'public', 'database', 'SST', 'audio');
const ffmpegPath = path.join(root, 'ffmpeg.exe');

function readDurationSeconds(audioPath) {
  assert(fs.existsSync(ffmpegPath), 'ffmpeg.exe is required for SST audio duration checks');
  const probe = spawnSync(ffmpegPath, ['-hide_banner', '-i', audioPath], { encoding: 'utf8' });
  const match = String(probe.stderr || '').match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/);
  assert(match, `Could not determine MP3 duration: ${audioPath}`);
  return (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]);
}

(async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const sheet = workbook.worksheets[0];
  const headers = sheet.getRow(1).values.slice(1).map((value) => String(value || '').trim());
  assert.deepEqual(headers.slice(0, 4), ['ID', 'TITLE', 'ANSWER', 'MAIN_POINTS'], 'SST workbook contract should include MAIN_POINTS');

  const questions = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const id = String(row.getCell(1).value || '').trim();
    const transcript = String(row.getCell(3).value || '').trim();
    const mainPointsRaw = String(row.getCell(4).value || '').trim();
    assert(id && transcript, `Row ${rowNumber} must contain ID and transcript`);
    const mainPoints = JSON.parse(mainPointsRaw);
    assert(Array.isArray(mainPoints) && mainPoints.length >= 3 && mainPoints.length <= 5, `Question ${id} must contain 3-5 main points`);
    questions.push({ id });
  });

  assert.equal(questions.length, 585, 'SST question count must remain 585');
  assert(fs.existsSync(manifestPath), 'SST audio manifest must exist');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const workbookIds = questions.map((question) => question.id).sort((a, b) => Number(a) - Number(b));
  const manifestIds = Object.keys(manifest).sort((a, b) => Number(a) - Number(b));
  assert.deepEqual(manifestIds, workbookIds, 'SST manifest IDs must exactly match actual workbook IDs');

  let audioFileCount = 0;
  let audioBytes = 0;
  let longestDuration = 0;
  questions.forEach(({ id }) => {
    const voices = manifest[id];
    assert(Array.isArray(voices) && voices.length === 3, `Question ${id} must have exactly three variants`);
    assert.equal(new Set(voices.map((voice) => voice.id)).size, 3, `Question ${id} variants must be unique`);
    voices.forEach((voice) => {
      const audioPath = path.join(audioRoot, id, String(voice.file || ''));
      assert(fs.existsSync(audioPath), `Missing audio: ${audioPath}`);
      const size = fs.statSync(audioPath).size;
      assert(size > 1000, `Audio too small: ${audioPath}`);
      const duration = readDurationSeconds(audioPath);
      assert(duration > 0 && duration < 600, `Audio duration must be between 0 and 600 seconds: ${audioPath} (${duration})`);
      audioBytes += size;
      longestDuration = Math.max(longestDuration, duration);
      audioFileCount += 1;
    });
  });
  assert.equal(audioFileCount, 1755, 'SST should contain 1,755 generated MP3 files');
  console.log(`SST data guardrails passed: questions=${questions.length}, audioFiles=${audioFileCount}, audioMB=${(audioBytes / (1024 * 1024)).toFixed(1)}, longestSeconds=${longestDuration.toFixed(2)}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
