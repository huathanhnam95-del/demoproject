const fs = require('fs');
const path = require('path');

const sourcePath = path.resolve('tests/fixtures/pronunciation-segmentation/manifest.json');
const outputDir = path.resolve('test-results/pronunciation-rerecord-analysis');
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const cleanVietnamese = source.entries.filter((entry) =>
  entry.category === 'clean' && entry.speakerCohort === 'l1-vn-01'
);

const latestByWord = new Map();
for (const entry of cleanVietnamese) {
  const word = String(entry.targetWord || '').trim().toLowerCase();
  const current = latestByWord.get(word);
  if (!current || entry.sampleId.localeCompare(current.sampleId) > 0) latestByWord.set(word, entry);
}

const rerecorded = cleanVietnamese.filter((entry) => entry.sampleId.includes('-20260730-'));
const latest = [...latestByWord.values()].sort((a, b) => a.targetWord.localeCompare(b.targetWord));
fs.mkdirSync(outputDir, { recursive: true });
for (const [name, entries] of [['rerecorded-clean-manifest.json', rerecorded], ['latest-clean-by-word-manifest.json', latest]]) {
  fs.writeFileSync(path.join(outputDir, name), `${JSON.stringify({
    version: '2.0.0',
    createdAt: new Date().toISOString(),
    entries
  }, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify({ rerecordedSamples: rerecorded.length, latestUniqueWords: latest.length }, null, 2));
