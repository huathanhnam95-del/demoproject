const assert = require('assert');
const fs = require('fs');
const path = require('path');
/* eslint-disable no-console */

console.log('Starting PTE attempt archive frontend contract test...');

const helperPath = path.join(process.cwd(), 'public', 'js', 'pte-attempt-archive.js');
const indexPath = path.join(process.cwd(), 'public', 'index.html');
const asyncPatchModePaths = [
  path.join(process.cwd(), 'public', 'write-essay-mode.js'),
  path.join(process.cwd(), 'public', 'swt-mode.js'),
  path.join(process.cwd(), 'public', 'sst-mode.js'),
  path.join(process.cwd(), 'public', 'rts-mode.js')
];
assert.ok(fs.existsSync(helperPath), 'public/js/pte-attempt-archive.js should exist');

const helper = fs.readFileSync(helperPath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');
const asyncPatchModes = asyncPatchModePaths.map((filePath) => ({
  filePath,
  src: fs.readFileSync(filePath, 'utf8')
}));

assert.ok(
  helper.includes('window.PTEAttemptArchive'),
  'archive helper should expose window.PTEAttemptArchive'
);
assert.ok(
  helper.includes("PracticeScopeManager.getScope() !== 'pte'"),
  'archive helper should no-op outside PTE scope'
);
assert.ok(
  helper.includes('/api/practice-attempts/save'),
  'archive helper should call the save endpoint'
);
assert.ok(
  helper.includes('/api/practice-attempts/prepare'),
  'archive helper should prepare media uploads'
);
assert.ok(
  helper.includes('firebase.storage()'),
  'archive helper should upload media through Firebase Storage compat'
);
assert.ok(
  helper.includes('normalizePositiveDurationMs'),
  'archive helper should normalize client-reported media durations through a positive-duration helper'
);
assert.ok(
  helper.includes('durationMs > 0'),
  'archive helper should treat null/zero WebM durations as missing so metadata hydration runs'
);
assert.ok(
  helper.includes('readBlobDurationMs(item.blob)'),
  'archive helper should read WebM Blob metadata before preparing/uploading media'
);
assert.ok(
  helper.includes('patchAttempt'),
  'archive helper should expose patchAttempt for delayed AI scoring updates'
);
assert.ok(
  index.includes('firebase-storage-compat.js'),
  'index.html should load Firebase Storage compat for media uploads'
);
assert.ok(
  index.includes('js/pte-attempt-archive.js'),
  'index.html should load the PTE archive helper before mode scripts'
);
asyncPatchModes.forEach(({ filePath, src }) => {
  assert.ok(
    /archiveSavePromise|ArchiveSavePromise/.test(src) && src.includes('ensureArchiveAttemptId'),
    `${path.basename(filePath)} should wait for the initial archive save before patching delayed AI scoring`
  );
});

console.log('PTE attempt archive frontend contract test passed.');
