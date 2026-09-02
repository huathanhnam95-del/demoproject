/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '../..');
const PROTOCOL_PATH = path.join(root, 'docs/evals/v4-a2-heldout-protocol.md');

function getCanonicalProtocolHash() {
  if (!fs.existsSync(PROTOCOL_PATH)) {
    throw new Error(`Preregistered evaluation protocol not found at: ${PROTOCOL_PATH}`);
  }
  const content = fs.readFileSync(PROTOCOL_PATH, 'utf8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

function computeSplitToken(taskId, split) {
  const salt = 'v4-a2-blind-split-salt-20260902';
  return crypto.createHmac('sha256', salt).update(`${split}:${taskId}`).digest('hex').slice(0, 16);
}

function buildBlindExport(options = {}) {
  const {
    manifest,
    tasks = [],
    includeHoldout = false,
    protocolHash = null
  } = options;

  if (!manifest || !Array.isArray(manifest.entries)) {
    throw new Error('Valid study manifest required for blind export.');
  }

  if (includeHoldout) {
    const canonicalHash = getCanonicalProtocolHash();
    if (!protocolHash || protocolHash !== canonicalHash) {
      throw new Error(`Cannot export holdout split: invalid or missing protocol-hash. Provided: ${protocolHash}, expected: ${canonicalHash}`);
    }
  }

  const tasksMap = new Map((tasks || []).map((t) => [t.taskId, t]));
  const filteredEntries = manifest.entries.filter((entry) => {
    if (entry.split === 'development') return true;
    if (entry.split === 'holdout') return Boolean(includeHoldout);
    return false;
  });

  const exportEntries = filteredEntries.map((entry) => {
    const task = tasksMap.get(entry.taskId) || {};

    const cleanEntry = {
      taskId: entry.taskId,
      targetWord: entry.targetWord,
      targetSyllableCount: entry.targetSyllableCount,
      referenceSyllableIpa: [...(entry.referenceSyllableIpa || [])],
      referenceIpa: entry.referenceIpa,
      dialect: entry.dialect || 'en-US',
      splitToken: computeSplitToken(entry.taskId, entry.split),
      audioDurationSec: task.audioDurationSec || entry.audioDurationSec || null,
      storagePath: task.storagePath || `audio/${entry.taskId}.wav`
    };

    if (task.manualBoundaryTimesMs || task.manualAnnotations) {
      cleanEntry.manualAnnotations = {
        annotatorId: task.annotatorId || 'anonymous',
        boundaryTimesMs: task.manualBoundaryTimesMs || [],
        status: task.status || 'pending'
      };
    }

    return cleanEntry;
  });

  const exportBundle = {
    studyId: manifest.studyId,
    manifestSha256: manifest.manifestSha256,
    exportMode: includeHoldout ? 'full-authorized-holdout' : 'development-blind',
    exportedAt: new Date().toISOString(),
    entryCount: exportEntries.length,
    entries: exportEntries
  };

  const bundleHash = crypto.createHash('sha256').update(JSON.stringify(exportBundle)).digest('hex');
  exportBundle.bundleSha256 = bundleHash;

  return exportBundle;
}

function validateBlindBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || !Array.isArray(bundle.entries)) {
    return { valid: false, reason: 'Invalid bundle structure' };
  }

  const forbiddenKeys = [
    'automaticSegments',
    'partitionVariants',
    'v4Syllabification',
    'engineVersion',
    'preferenceJudgment',
    'split'
  ];

  for (const entry of bundle.entries) {
    for (const key of forbiddenKeys) {
      if (key in entry) {
        return { valid: false, reason: `Forbidden key "${key}" detected in entry ${entry.taskId}` };
      }
    }
    const serialized = JSON.stringify(entry);
    const forbiddenPatterns = [
      /(?:v2|v3|v4)Boundaries/i,
      /v4Syllabification/i,
      /engineVersion/i,
      /preferenceJudgment/i,
      /partitionVariants/i,
      /automaticSegments/i,
      /"split":/i
    ];

    for (const pattern of forbiddenPatterns) {
      if (pattern.test(serialized)) {
        return { valid: false, reason: `Forbidden pattern ${pattern} found in entry ${entry.taskId}` };
      }
    }
  }

  return { valid: true };
}

function exportBlindEvaluation(options = {}) {
  const manifestPath = options.manifestPath || path.join(root, 'scripts/data/segmentation-study-v2.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const bundle = buildBlindExport({
    manifest,
    tasks: options.tasks || [],
    includeHoldout: options.includeHoldout,
    protocolHash: options.protocolHash
  });

  const validation = validateBlindBundle(bundle);
  if (!validation.valid) {
    throw new Error(`Blind export validation failed: ${validation.reason}`);
  }

  if (options.outputPath) {
    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    fs.writeFileSync(options.outputPath, JSON.stringify(bundle, null, 2), 'utf8');
  }

  return bundle;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    args[key] = value && !value.startsWith('--') ? value : true;
    if (args[key] !== true) i += 1;
  }
  return args;
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const bundle = exportBlindEvaluation({
      manifestPath: args.manifest,
      outputPath: args.out || args.output,
      includeHoldout: Boolean(args['include-holdout']),
      protocolHash: args['protocol-hash']
    });
    console.log(`Exported ${bundle.entryCount} blind entries for ${bundle.studyId} (mode: ${bundle.exportMode}).`);
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = {
  buildBlindExport,
  computeSplitToken,
  exportBlindEvaluation,
  getCanonicalProtocolHash,
  validateBlindBundle
};

