const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');

const logLines = [];
function log(...args) {
  const line = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ');
  console.log(line);
  logLines.push(line);
}

function writeLogFile() {
  try {
    fs.writeFileSync(path.join(__dirname, 'verify_log.txt'), logLines.join('\n'), 'utf8');
  } catch (e) {
    console.error('Failed to write log file:', e);
  }
}

// Ignore SSL errors for local dev server
const localAgent = new https.Agent({
  rejectUnauthorized: false
});

function getAudioFilesFromManifest(manifest) {
  const keys = Object.keys(manifest);
  const files = [];
  for (const qId of keys) {
    const entry = manifest[qId];
    for (const gender of ['male', 'female']) {
      const genderBlock = entry[gender];
      if (!genderBlock) continue;

      if (genderBlock.files) {
        for (const speed of Object.keys(genderBlock.files)) {
          files.push(genderBlock.files[speed]);
        }
      }

      const voices = Object.keys(genderBlock).filter(k => k !== 'voiceId' && k !== 'voiceName' && k !== 'files');
      for (const voiceId of voices) {
        const voiceBlock = genderBlock[voiceId];
        if (voiceBlock && voiceBlock.files) {
          for (const speed of Object.keys(voiceBlock.files)) {
            files.push(voiceBlock.files[speed]);
          }
        }
      }
    }
  }
  return files;
}

async function main() {
  const localManifestPath = path.join(__dirname, '../public/database/RA/Voice/audio/manifest.json');
  const productionManifestUrl = 'https://betterenglishlearning.com/database/RA/Voice/audio/manifest.json';

  log('Loading local manifest.json...');
  const localManifest = JSON.parse(fs.readFileSync(localManifestPath, 'utf8'));
  const localKeys = Object.keys(localManifest);
  log(`Local manifest contains ${localKeys.length} question entries.`);

  log(`Fetching production manifest from ${productionManifestUrl}...`);
  let prodManifest;
  try {
    const response = await axios.get(productionManifestUrl, { timeout: 15000 });
    prodManifest = response.data;
  } catch (error) {
    log('Failed to fetch production manifest:', error.message);
    process.exitCode = 1;
    writeLogFile();
    return;
  }

  const prodKeys = Object.keys(prodManifest);
  log(`Production manifest contains ${prodKeys.length} question entries.`);

  // Verify that all keys are identical
  const localOnlyKeys = localKeys.filter(k => !prodManifest[k]);
  const prodOnlyKeys = prodKeys.filter(k => !localManifest[k]);

  if (localOnlyKeys.length === 0 && prodOnlyKeys.length === 0) {
    log('SUCCESS: Local and production manifests contain the exact same question IDs!');
  } else {
    log('WARNING: Manifest mismatch!');
    log(`Number of keys only in local manifest: ${localOnlyKeys.length}`);
    if (localOnlyKeys.length > 0) log('Sample local-only keys:', localOnlyKeys.slice(0, 10));
    log(`Number of keys only in production manifest: ${prodOnlyKeys.length}`);
    if (prodOnlyKeys.length > 0) log('Sample prod-only keys:', prodOnlyKeys.slice(0, 10));
  }

  // --- Production Check ---
  const prodAudioFiles = getAudioFilesFromManifest(prodManifest);
  log(`Total audio files in production manifest: ${prodAudioFiles.length}`);

  const prodSampleSize = 5;
  const prodSampled = [];
  const prodTempSet = new Set();
  while (prodSampled.length < prodSampleSize) {
    const randomIndex = Math.floor(Math.random() * prodAudioFiles.length);
    const file = prodAudioFiles[randomIndex];
    if (!prodTempSet.has(file)) {
      prodTempSet.add(file);
      prodSampled.push(file);
    }
  }

  log(`Checking ${prodSampleSize} random audio files on production server...`);
  let prodSuccessCount = 0;
  let prodFailCount = 0;
  const prodFailedFiles = [];

  for (let i = 0; i < prodSampled.length; i++) {
    const filename = prodSampled[i];
    const url = `https://betterenglishlearning.com/database/RA/Voice/audio/${filename}`;
    try {
      log(`Production requesting HEAD [${i + 1}/${prodSampled.length}]: ${filename}`);
      const res = await axios.head(url, { timeout: 15000 });
      log(`Production response for ${filename}: ${res.status}`);
      if (res.status === 200) {
        prodSuccessCount++;
      } else {
        prodFailCount++;
        prodFailedFiles.push({ filename, status: res.status });
      }
    } catch (error) {
      log(`Production error for ${filename}: ${error.message}`);
      prodFailCount++;
      prodFailedFiles.push({ filename, error: error.message });
    }
  }

  // --- Local Check ---
  const localAudioFiles = getAudioFilesFromManifest(localManifest);
  log(`Total audio files in local manifest: ${localAudioFiles.length}`);

  const localSampleSize = 5;
  const localSampled = [];
  const localTempSet = new Set();
  while (localSampled.length < localSampleSize) {
    const randomIndex = Math.floor(Math.random() * localAudioFiles.length);
    const file = localAudioFiles[randomIndex];
    if (!localTempSet.has(file)) {
      localTempSet.add(file);
      localSampled.push(file);
    }
  }

  log(`Checking ${localSampleSize} random audio files on local server (https://localhost:8443)...`);
  let localSuccessCount = 0;
  let localFailCount = 0;
  const localFailedFiles = [];

  for (let i = 0; i < localSampled.length; i++) {
    const filename = localSampled[i];
    const url = `https://localhost:8443/database/RA/Voice/audio/${filename}`;
    try {
      log(`Local requesting HEAD [${i + 1}/${localSampled.length}]: ${filename}`);
      const res = await axios.head(url, { 
        timeout: 15000,
        httpsAgent: localAgent
      });
      log(`Local response for ${filename}: ${res.status}`);
      if (res.status === 200) {
        localSuccessCount++;
      } else {
        localFailCount++;
        localFailedFiles.push({ filename, status: res.status });
      }
    } catch (error) {
      log(`Local error for ${filename}: ${error.message}`);
      localFailCount++;
      localFailedFiles.push({ filename, error: error.message });
    }
  }

  log('\n=========================================');
  log('--- Production & Local Verification Summary ---');
  log(`Production - Checked: ${prodSampleSize}, Success (200): ${prodSuccessCount}, Failures: ${prodFailCount}`);
  log(`Local      - Checked: ${localSampleSize}, Success (200): ${localSuccessCount}, Failures: ${localFailCount}`);
  log('=========================================\n');


  if (prodFailCount > 0) {
    log('Production failed assets details (first 10):', prodFailedFiles.slice(0, 10));
  }
  if (localFailCount > 0) {
    log('Local failed assets details (first 10):', localFailedFiles.slice(0, 10));
  }

  if (prodFailCount > 0 || localFailCount > 0) {
    process.exitCode = 1;
  } else {
    log('SUCCESS: All checked production and local assets are live and reachable!');
    process.exitCode = 0;
  }
  writeLogFile();
}

main().catch(err => {
  log('CRITICAL ERROR in main:', err.message, err.stack);
  process.exitCode = 1;
  writeLogFile();
});



