const fs = require('fs');

function parseArgs(argv) {
  const value = (name, fallback) => {
    const index = argv.indexOf(name);
    return index >= 0 ? String(argv[index + 1] || '') : fallback;
  };
  return {
    apply: argv.includes('--apply'),
    cachedOnly: argv.includes('--cached-only'),
    limit: Math.max(0, Number(value('--limit', '5000')) || 0),
    backendUrl: value('--backend-url', process.env.PRAAT_BACKEND_URL || 'https://praat-api-1071929245506.us-central1.run.app'),
    projectId: value('--project', process.env.GCLOUD_PROJECT || 'listening-tasks-3ae34'),
    checkpoint: value('--checkpoint', '')
  };
}

function parseOxfordWords(csv) {
  const words = [];
  const seen = new Set();
  String(csv || '').split(/\r?\n/).slice(1).forEach((line) => {
    const match = line.match(/^"([^"]+)"/);
    const word = String(match?.[1] || '').trim().toLowerCase();
    if (/^[a-z][a-z' -]{0,79}$/.test(word) && !word.includes(',') && !seen.has(word)) {
      seen.add(word);
      words.push(word);
    }
  });
  return words;
}

function referenceNeedsRefresh(variant) {
  return Boolean(
    variant?.audioUrl
    && (
      variant?.nativeAnalysis?.pitchProcessing?.version !== 'canonical-pitch-v1'
      || variant?.nativeAnalysis?.audioCompatibility?.version !== 'reference-audio-compatibility-v1'
    )
  );
}

function loadCheckpoint(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return new Set();
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return new Set(Array.isArray(data.completedWords) ? data.completedWords : []);
}

module.exports = { loadCheckpoint, parseArgs, parseOxfordWords, referenceNeedsRefresh };
