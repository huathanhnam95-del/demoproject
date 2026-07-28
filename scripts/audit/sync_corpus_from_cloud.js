const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API_KEY = 'AIzaSyB0vXX7NwOvME_XoaGiJlYaiLRcaHJtrIQ';
const AUTH_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;
const API_BASE = 'https://us-central1-listening-tasks-3ae34.cloudfunctions.net/api';

const EMAIL = 'huathanhnam95@gmail.com';
const PASSWORD = 'Alphaein@1new';

const AUDIO_DIR = path.join(__dirname, '../../test-results/pronunciation-segmentation-corpus');
const MANIFEST_PATH = path.join(__dirname, '../../tests/fixtures/pronunciation-segmentation/manifest.json');

async function main() {
  console.log('🔒 Signing in to Cloud Backend...');
  const authRes = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true })
  });

  const authData = await authRes.json();
  if (!authData.idToken) {
    throw new Error(`Auth failed: ${JSON.stringify(authData)}`);
  }
  const token = authData.idToken;
  console.log('✅ Authenticated successfully.');

  console.log('📥 Fetching corpus samples metadata...');
  const listRes = await fetch(`${API_BASE}/api/admin/dev/corpus-samples?limit=500`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const listData = await listRes.json();
  if (!listData.success || !listData.samples) {
    throw new Error(`Failed to fetch samples: ${JSON.stringify(listData)}`);
  }

  const samples = listData.samples;
  console.log(`📦 Found ${samples.length} sample(s) in cloud corpus.`);

  if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
  }

  const manifestEntries = [];
  let downloaded = 0;

  for (const s of samples) {
    const sampleId = s.sampleId || s.id;
    const wavPath = path.join(AUDIO_DIR, `${sampleId}.wav`);
    
    // Download WAV if missing or hash mismatch
    let buffer;
    if (fs.existsSync(wavPath)) {
      buffer = fs.readFileSync(wavPath);
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      if (s.sourceHash && hash !== s.sourceHash) {
        console.log(`  🔄 Hash mismatch for ${sampleId}, re-downloading...`);
        buffer = null;
      }
    }

    if (!buffer) {
      const audioRes = await fetch(s.audioUrl);
      if (!audioRes.ok) {
        throw new Error(`Failed to download audio for ${sampleId}: ${audioRes.statusText}`);
      }
      const ab = await audioRes.arrayBuffer();
      buffer = Buffer.from(ab);
      fs.writeFileSync(wavPath, buffer);
    }

    const calculatedHash = crypto.createHash('sha256').update(buffer).digest('hex');
    downloaded++;
    console.log(`  [${downloaded}/${samples.length}] Synced ${sampleId}.wav (${buffer.length} bytes, SHA256: ${calculatedHash.slice(0, 8)}...)`);

    manifestEntries.push({
      sampleId: sampleId,
      targetWord: s.targetWord,
      referenceIpa: s.referenceIpa,
      expectedObservedCount: Number.isInteger(s.expectedObservedCount) ? s.expectedObservedCount : s.targetSyllableCount,
      targetSyllableCount: Number.isInteger(s.targetSyllableCount) ? s.targetSyllableCount : 1,
      category: s.category || 'clean',
      speakerCohort: s.speakerCohort || 'l1-vn-01',
      sourceHash: calculatedHash,
      labelProvenance: 'manual',
      verifiedSpans: null
    });
  }

  // Sort manifest entries by sampleId
  manifestEntries.sort((a, b) => a.sampleId.localeCompare(b.sampleId));

  const manifest = {
    version: '2.0.0',
    createdAt: new Date().toISOString(),
    entries: manifestEntries
  };

  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  console.log(`\n🎉 Manifest written to ${MANIFEST_PATH} with ${manifestEntries.length} entries!`);
}

main().catch(err => {
  console.error('❌ Error syncing corpus:', err);
  process.exit(1);
});
