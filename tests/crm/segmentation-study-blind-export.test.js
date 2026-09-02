/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildBlindExport,
  exportBlindEvaluation,
  validateBlindBundle
} = require('../../scripts/segmentation-study/export-blind-evaluation');

const root = path.resolve(__dirname, '../..');
const manifestPath = path.join(root, 'scripts/data/segmentation-study-v2.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Sample mock Firestore task records containing both manual and automatic fields
const mockTasks = manifest.entries.map((entry, index) => ({
  taskId: entry.taskId,
  targetWord: entry.targetWord,
  targetSyllableCount: entry.targetSyllableCount,
  referenceSyllableIpa: entry.referenceSyllableIpa,
  referenceIpa: entry.referenceIpa,
  dialect: entry.dialect,
  split: entry.split,
  audioDurationSec: 1.5,
  storagePath: `audio/${entry.taskId}.wav`,
  // Manual annotations
  manualBoundaryTimesMs: [450, 890],
  annotatorId: 'annotator_1',
  status: 'annotated',
  // AUTOMATIC DATA (Must be strictly stripped by blind export!)
  automaticSegments: [{ label: 's1', start: 0, end: 0.45 }, { label: 's2', start: 0.45, end: 0.89 }],
  partitionVariants: { v2: [0.42, 0.91], v3: [0.46, 0.88], v4: [0.45, 0.89] },
  v4Syllabification: { confidence: 0.95, state: 'aligned' },
  engineVersion: 'v4.1.0',
  preferenceJudgment: 'v4_preferred'
}));

// Test 1: Blind export excludes automatic fields and version labels
const devExport = buildBlindExport({
  manifest,
  tasks: mockTasks,
  includeHoldout: false
});

assert.strictEqual(devExport.studyId, 'segmentation-study-v2');
assert.strictEqual(devExport.entries.length, 70, 'Default export must include only development split (70 items)');
assert.strictEqual(devExport.entries.every((e) => e.splitToken && !e.split), true, 'Raw split must be replaced by opaque split token');

for (const entry of devExport.entries) {
  // Required fields present
  assert.ok(entry.taskId, 'taskId required');
  assert.ok(entry.targetWord, 'targetWord required');
  assert.ok(entry.referenceSyllableIpa, 'referenceSyllableIpa required');
  assert.ok(entry.splitToken, 'splitToken required');

  // Forbidden fields stripped
  assert.strictEqual(entry.automaticSegments, undefined, 'automaticSegments must be stripped');
  assert.strictEqual(entry.partitionVariants, undefined, 'partitionVariants must be stripped');
  assert.strictEqual(entry.v4Syllabification, undefined, 'v4Syllabification must be stripped');
  assert.strictEqual(entry.engineVersion, undefined, 'engineVersion must be stripped');
  assert.strictEqual(entry.preferenceJudgment, undefined, 'preferenceJudgment must be stripped');
  assert.strictEqual(entry.split, undefined, 'raw split field must be stripped');

  // String check to ensure no leaked model tags
  const json = JSON.stringify(entry);
  assert.strictEqual(/(?:v2|v3|v4)Boundaries/i.test(json), false, 'Entry JSON must not contain model boundary tokens');
  assert.strictEqual(/v4Syllabification/i.test(json), false, 'Entry JSON must not contain v4Syllabification');
  assert.strictEqual(/automaticSegments/i.test(json), false, 'Entry JSON must not contain automaticSegments');
  assert.strictEqual(/"split":/i.test(json), false, 'Entry JSON must not leak raw split');
}

// Test 2: Validation of blind bundle passes
const validated = validateBlindBundle(devExport);
assert.strictEqual(validated.valid, true);

// Test 3: Unlocking holdout without valid protocol hash fails closed
assert.throws(() => {
  buildBlindExport({
    manifest,
    tasks: mockTasks,
    includeHoldout: true
    // missing protocolHash
  });
}, /protocol-hash/i, 'Must fail closed when holdout is requested without protocol hash');

assert.throws(() => {
  buildBlindExport({
    manifest,
    tasks: mockTasks,
    includeHoldout: true,
    protocolHash: 'invalid_hash_value'
  });
}, /protocol-hash/i, 'Must fail closed when holdout is requested with mismatched protocol hash');

// Test 4: Unlocking holdout with valid registered protocol hash succeeds
const protocolContent = fs.readFileSync(path.join(root, 'docs/evals/v4-a2-heldout-protocol.md'), 'utf8');
const crypto = require('crypto');
const validProtocolHash = crypto.createHash('sha256').update(protocolContent).digest('hex');

const fullExport = buildBlindExport({
  manifest,
  tasks: mockTasks,
  includeHoldout: true,
  protocolHash: validProtocolHash
});
assert.strictEqual(fullExport.entries.length, 100, 'Full export with authorized protocol hash must include 100 entries');

console.log('segmentation-study blind export tests passed');
