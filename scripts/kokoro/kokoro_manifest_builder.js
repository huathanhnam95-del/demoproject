/* eslint-disable no-console */
/**
 * Kokoro Manifest Builder — Rebuild manifest.json from disk
 *
 * Scans the audio directory for all Kokoro-style MP3 files (RA_{id}_{voiceId}.mp3)
 * and reconstructs the manifest.json. Preserves legacy ElevenLabs entries.
 *
 * Usage:
 *   node scripts/kokoro/kokoro_manifest_builder.js              # Rebuild manifest
 *   node scripts/kokoro/kokoro_manifest_builder.js --dry-run    # Preview without writing
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const AUDIO_DIR = path.join(ROOT_DIR, 'public', 'database', 'RA', 'Voice', 'audio');
const MANIFEST_PATH = path.join(AUDIO_DIR, 'manifest.json');

const VOICE_MAP = {
  af_alloy:   { name: 'Alloy',   gender: 'female', accent: 'American' },
  af_bella:   { name: 'Bella',   gender: 'female', accent: 'American' },
  af_heart:   { name: 'Heart',   gender: 'female', accent: 'American' },
  af_kore:    { name: 'Kore',    gender: 'female', accent: 'American' },
  af_sarah:   { name: 'Sarah',   gender: 'female', accent: 'American' },
  bf_emma:    { name: 'Emma',    gender: 'female', accent: 'British'  },
  am_echo:    { name: 'Echo',    gender: 'male',   accent: 'American' },
  am_eric:    { name: 'Eric',    gender: 'male',   accent: 'American' },
  am_fenrir:  { name: 'Fenrir',  gender: 'male',   accent: 'American' },
  am_liam:    { name: 'Liam',    gender: 'male',   accent: 'American' },
  am_michael: { name: 'Michael', gender: 'male',   accent: 'American' },
  am_puck:    { name: 'Puck',    gender: 'male',   accent: 'American' },
  bm_fable:   { name: 'Fable',   gender: 'male',   accent: 'British'  },
  bm_george:  { name: 'George',  gender: 'male',   accent: 'British'  },
  bm_lewis:   { name: 'Lewis',   gender: 'male',   accent: 'British'  },
};

const KOKORO_VOICE_IDS = new Set(Object.keys(VOICE_MAP));

function main() {
  const DRY_RUN = process.argv.includes('--dry-run');

  // Load existing manifest (to preserve legacy entries)
  let manifest = {};
  if (fs.existsSync(MANIFEST_PATH)) {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  }

  // Scan audio directory
  const files = fs.readdirSync(AUDIO_DIR).filter(f => f.endsWith('.mp3'));
  console.log(`Found ${files.length} MP3 files in ${AUDIO_DIR}`);

  let kokoroCount = 0;
  let legacyCount = 0;

  for (const file of files) {
    // Match Kokoro pattern: RA_{id}_{voicePrefix}_{voiceName}_{speed}.mp3
    // e.g., RA_731_am_echo_100.mp3 → id=731, voiceId=am_echo, speed=100
    const kokoroMatch = file.match(/^RA_(\d+)_([a-z]{2}_[a-z]+)_(\d+)\.mp3$/);
    if (kokoroMatch) {
      const [, qId, voiceId, speed] = kokoroMatch;
      const voiceInfo = VOICE_MAP[voiceId];
      if (!voiceInfo) continue; // Unknown voice, skip

      if (!manifest[qId]) manifest[qId] = {};
      if (!manifest[qId][voiceInfo.gender]) manifest[qId][voiceInfo.gender] = {};

      // Don't overwrite if this is a legacy-format key
      if (!manifest[qId][voiceInfo.gender][voiceId]) {
        manifest[qId][voiceInfo.gender][voiceId] = {};
      }

      manifest[qId][voiceInfo.gender][voiceId] = {
        name: voiceInfo.name,
        accent: voiceInfo.accent,
        files: { ...(manifest[qId][voiceInfo.gender][voiceId]?.files || {}), [speed]: file },
      };
      kokoroCount++;
      continue;
    }

    // Match legacy pattern: RA_{id}_{gender}_{speed}.mp3
    // e.g., RA_731_male_100.mp3
    const legacyMatch = file.match(/^RA_(\d+)_(male|female)_(\d+)\.mp3$/);
    if (legacyMatch) {
      const [, qId, gender, speed] = legacyMatch;
      if (!manifest[qId]) manifest[qId] = {};
      if (!manifest[qId][gender]) manifest[qId][gender] = {};

      // Only set legacy fields if no Kokoro voices exist yet for this gender
      const hasKokoroVoices = Object.keys(manifest[qId][gender]).some(k => KOKORO_VOICE_IDS.has(k));
      if (!hasKokoroVoices) {
        // Preserve legacy format
        if (!manifest[qId][gender].files) manifest[qId][gender].files = {};
        manifest[qId][gender].files[speed] = file;
      }
      legacyCount++;
    }
  }

  console.log(`Kokoro entries: ${kokoroCount}`);
  console.log(`Legacy entries: ${legacyCount}`);
  console.log(`Total questions in manifest: ${Object.keys(manifest).length}`);

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] Would write manifest with above stats');
    // Show a sample entry
    const sampleKey = Object.keys(manifest)[0];
    if (sampleKey) {
      console.log(`\nSample entry (Q${sampleKey}):`);
      console.log(JSON.stringify(manifest[sampleKey], null, 2));
    }
  } else {
    const tmpPath = MANIFEST_PATH + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2));
    fs.renameSync(tmpPath, MANIFEST_PATH);
    console.log(`\nManifest saved to ${MANIFEST_PATH}`);
  }
}

main();
