/* eslint-disable no-console */
/**
 * Reorganize RA Audio Files
 * Groups all RA audio files on disk into subfolders named after their Question ID.
 * e.g., RA_1000_af_alloy_100.mp3 -> 1000/RA_1000_af_alloy_100.mp3
 *
 * Usage:
 *   node scratch/reorganize_ra_audio.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const AUDIO_DIR = path.join(ROOT_DIR, 'public', 'database', 'RA', 'Voice', 'audio');

function main() {
  const DRY_RUN = process.argv.includes('--dry-run');

  if (!fs.existsSync(AUDIO_DIR)) {
    console.error(`Audio directory does not exist: ${AUDIO_DIR}`);
    process.exit(1);
  }

  console.log(`Scanning directory: ${AUDIO_DIR}`);
  const items = fs.readdirSync(AUDIO_DIR);
  const files = items.filter((item) => {
    const itemPath = path.join(AUDIO_DIR, item);
    return fs.statSync(itemPath).isFile() && item.endsWith('.mp3');
  });

  console.log(`Found ${files.length} MP3 files in root audio directory.`);

  let movedCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    // Extract question ID from filename.
    // Patterns:
    // Kokoro: RA_1000_af_alloy_100.mp3 -> group 1: 1000
    // Legacy: RA_1_male_100.mp3 -> group 1: 1
    const match = file.match(/^RA_(\d+)_/);
    if (!match) {
      console.warn(`Skipping unmatched file: ${file}`);
      skippedCount++;
      continue;
    }

    const qId = match[1];
    const targetDir = path.join(AUDIO_DIR, qId);
    const sourcePath = path.join(AUDIO_DIR, file);
    const targetPath = path.join(targetDir, file);

    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would move: ${file} -> ${qId}/${file}`);
      movedCount++;
    } else {
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.renameSync(sourcePath, targetPath);
      movedCount++;
    }
  }

  console.log('\n=== Reorganization Summary ===');
  console.log(`${DRY_RUN ? 'Would move' : 'Moved'}: ${movedCount} files`);
  console.log(`Skipped: ${skippedCount} files`);
}

main();
