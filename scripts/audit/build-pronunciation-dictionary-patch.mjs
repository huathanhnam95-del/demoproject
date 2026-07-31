import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspace = 'C:\\Cursor AI';
const defaultInput = path.join(workspace, 'test-results', 'pronunciation-input-verification-20260731.json');
const defaultDictionary = path.join(workspace, 'public', 'ipa-dict.json');
const defaultOutput = path.join(workspace, 'test-results', 'pronunciation-dictionary-patch-20260731.json');

const EXPECTED_SUMMARY = Object.freeze({
  inputRows: 363,
  approve: 258,
  merge: 22,
  quarantine: 83,
  review: 0
});

function asArray(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string');
  return typeof value === 'string' ? [value] : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isIPA(value) {
  return typeof value === 'string' && /^\/.+\/$/u.test(value);
}

function finalIPAFor(entry) {
  return unique([entry.correctedIPA, entry.alternateIPA]).filter(isIPA);
}

function validateReport(report, dictionary) {
  if (!report || !report.summary || !Array.isArray(report.entries)) {
    throw new Error('Verification report must contain summary and entries.');
  }

  for (const [key, expected] of Object.entries(EXPECTED_SUMMARY)) {
    if (report.summary[key] !== expected) {
      throw new Error(`Verification report summary ${key} must be ${expected}, got ${report.summary[key]}.`);
    }
  }

  if (report.entries.length !== EXPECTED_SUMMARY.inputRows) {
    throw new Error(`Verification report must contain ${EXPECTED_SUMMARY.inputRows} entries.`);
  }

  const ids = new Set();
  const counts = { approve: 0, merge: 0, quarantine: 0, review: 0 };
  for (const entry of report.entries) {
    if (!entry.caseId || ids.has(entry.caseId)) {
      throw new Error(`Verification report case IDs must be unique: ${entry.caseId || '(missing)'}.`);
    }
    ids.add(entry.caseId);
    if (!Object.prototype.hasOwnProperty.call(counts, entry.decision)) {
      throw new Error(`Unsupported verification decision for ${entry.caseId}: ${entry.decision}.`);
    }
    counts[entry.decision] += 1;

    if (entry.decision === 'approve' || entry.decision === 'merge') {
      if (!isIPA(entry.correctedIPA)) {
        throw new Error(`${entry.caseId} must contain a delimited corrected IPA.`);
      }
      if (entry.alternateIPA && !isIPA(entry.alternateIPA)) {
        throw new Error(`${entry.caseId} contains an invalid alternate IPA.`);
      }
      if (entry.correctedWeakIPA && !isIPA(entry.correctedWeakIPA)) {
        throw new Error(`${entry.caseId} contains an invalid weak IPA.`);
      }
      if (!Object.prototype.hasOwnProperty.call(dictionary, entry.word)) {
        throw new Error(`${entry.caseId} refers to missing dictionary word: ${entry.word}.`);
      }
      const currentIPA = asArray(dictionary[entry.word]);
      const alreadyApplied = finalIPAFor(entry).some((variant) => currentIPA.includes(variant));
      if (!currentIPA.includes(entry.sourceIPA) && !alreadyApplied) {
        throw new Error(`${entry.caseId} source IPA is not present for dictionary word: ${entry.word}.`);
      }
    }

    if (entry.decision === 'quarantine') {
      if (entry.correctedIPA || entry.alternateIPA || entry.correctedWeakIPA) {
        throw new Error(`${entry.caseId} is quarantined but contains IPA output.`);
      }
    }
  }

  const expectedDecisionCounts = {
    approve: EXPECTED_SUMMARY.approve,
    merge: EXPECTED_SUMMARY.merge,
    quarantine: EXPECTED_SUMMARY.quarantine,
    review: EXPECTED_SUMMARY.review
  };
  for (const [key, expected] of Object.entries(expectedDecisionCounts)) {
    if (counts[key] !== expected) {
      throw new Error(`Verification report decision count ${key} must be ${expected}, got ${counts[key]}.`);
    }
  }
}

function buildPatch(report, dictionary) {
  validateReport(report, dictionary);

  const updatesByWord = new Map();
  const canonicalByKey = new Map();
  const merges = [];
  const quarantine = [];

  for (const entry of report.entries) {
    if (entry.decision === 'quarantine') {
      quarantine.push({
        word: entry.word,
        caseId: entry.caseId,
        originalIPA: asArray(dictionary[entry.word]),
        reason: entry.reason
      });
      continue;
    }

    if (entry.decision !== 'approve' && entry.decision !== 'merge') continue;

    const finalIPA = finalIPAFor(entry);
    const mergeKey = [entry.word, ...finalIPA, entry.correctedWeakIPA || ''].join('\u0000');
    const existing = updatesByWord.get(entry.word) || {
      word: entry.word,
      originalIPA: asArray(dictionary[entry.word]),
      proposedIPA: [],
      resultingIPA: asArray(dictionary[entry.word]),
      weakIPA: '',
      caseIds: [],
      sourceReplacements: [],
      reasons: [],
      sourceUrls: []
    };

    existing.proposedIPA = unique([...existing.proposedIPA, ...finalIPA]);
    existing.weakIPA = existing.weakIPA || entry.correctedWeakIPA || '';
    existing.caseIds.push(entry.caseId);
    existing.reasons.push(entry.reason);
    if (entry.sourceUrl) existing.sourceUrls.push(entry.sourceUrl);
    existing.sourceReplacements.push({
      caseId: entry.caseId,
      sourceIPA: entry.sourceIPA,
      replacementIPA: finalIPA,
      decision: entry.decision
    });
    updatesByWord.set(entry.word, existing);

    if (entry.decision === 'approve') {
      if (canonicalByKey.has(mergeKey)) {
        throw new Error(`Two approve records resolve to the same final form without a merge decision: ${entry.caseId}.`);
      }
      canonicalByKey.set(mergeKey, entry);
    } else {
      const canonical = canonicalByKey.get(mergeKey);
      if (!canonical) {
        throw new Error(`Merge record ${entry.caseId} has no earlier canonical approval.`);
      }
      merges.push({
        word: entry.word,
        caseIds: [entry.caseId],
        canonicalCaseId: canonical.caseId,
        finalIPA,
        weakIPA: entry.correctedWeakIPA || '',
        reason: entry.reason
      });
    }
  }

  const quarantineWords = new Set(quarantine.map((entry) => entry.word));
  for (const word of updatesByWord.keys()) {
    if (quarantineWords.has(word)) {
      throw new Error(`Word appears in both update and quarantine streams: ${word}.`);
    }
  }

  const updates = [...updatesByWord.values()].map((update) => {
    for (const replacement of update.sourceReplacements) {
      const replacementAlreadyApplied = replacement.replacementIPA.some((variant) => (
        update.originalIPA.includes(variant)
      ));
      if (!update.originalIPA.includes(replacement.sourceIPA) && !replacementAlreadyApplied) {
        throw new Error(`Cannot apply source replacement for ${update.word}: ${replacement.sourceIPA}.`);
      }
    }

    // A reviewed record is an authoritative replacement, not an additive
    // patch. Keeping an unreviewed legacy variant can make getIPA() select it
    // because the runtime intentionally uses the first dictionary value.
    const resultingIPA = unique(update.proposedIPA);
    return { ...update, resultingIPA };
  });

  return {
    version: 1,
    decisionSource: 'pronunciation-input-verification-20260731.json',
    summary: {
      inputRows: report.summary.inputRows,
      approvedRecords: report.summary.approve,
      mergeRecords: report.summary.merge,
      quarantineRecords: report.summary.quarantine,
      reviewRecords: report.summary.review
    },
    updates,
    merges,
    quarantine
  };
}

function applyPatch(dictionary, patch, { applyQuarantine = true } = {}) {
  const next = { ...dictionary };
  for (const update of patch.updates) {
    next[update.word] = update.resultingIPA;
  }
  if (applyQuarantine) {
    for (const entry of patch.quarantine) delete next[entry.word];
  }
  return next;
}

function parseArgs(argv) {
  const args = { input: defaultInput, dictionary: defaultDictionary, output: defaultOutput, write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write') {
      args.write = true;
    } else if (['--input', '--dictionary', '--output'].includes(arg)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a path.`);
      args[arg.slice(2)] = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const [report, dictionary] = await Promise.all([
    readJson(args.input),
    readJson(args.dictionary)
  ]);
  const patch = buildPatch(report, dictionary);
  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.writeFile(args.output, `${JSON.stringify(patch, null, 2)}\n`, 'utf8');

  if (args.write) {
    const updatedDictionary = applyPatch(dictionary, patch);
    await fs.writeFile(args.dictionary, `${JSON.stringify(updatedDictionary, null, 2)}\n`, 'utf8');
  }

  console.log(JSON.stringify({
    outputPath: args.output,
    write: args.write,
    inputRows: patch.summary.inputRows,
    approvedRecords: patch.summary.approvedRecords,
    mergeRecords: patch.summary.mergeRecords,
    quarantineRecords: patch.summary.quarantineRecords,
    updateWords: patch.updates.length,
    quarantineWords: new Set(patch.quarantine.map((entry) => entry.word)).size
  }, null, 2));
  return patch;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}

export { applyPatch, buildPatch, validateReport };
