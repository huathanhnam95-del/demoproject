/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const sourcePath = path.join(root, 'scripts/data/segmentation-study-v1.json');
const destinationPath = path.join(root, 'functions/src/data/segmentation-study-v1.json');

function syncManifest() {
  const manifest = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  if (manifest.studyId !== 'segmentation-study-v1' || !Array.isArray(manifest.entries) || manifest.entries.length !== 100 || !manifest.manifestSha256) {
    throw new Error('Refusing to bundle an invalid segmentation-study-v1 manifest.');
  }
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
  return { sourcePath, destinationPath, manifestSha256: manifest.manifestSha256 };
}

if (require.main === module) {
  const result = syncManifest();
  console.log(`Bundled segmentation study manifest ${result.manifestSha256}.`);
}

module.exports = { destinationPath, sourcePath, syncManifest };
