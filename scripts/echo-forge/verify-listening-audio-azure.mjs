import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import {
  DEFAULT_THRESHOLD,
  DEFAULT_TIMEOUT_MS,
  loadAzureCredentials,
  runListeningAudioSemanticQa,
} from './listening-audio-semantic-qa-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULTS = Object.freeze({
  catalogPath: path.join(ROOT, 'public/database/echo-forge/challenges.v1.json'),
  sourcePath: path.join(ROOT, 'data/echo-forge/challenges.source.json'),
  audioRoot: path.join(ROOT, 'public'),
  publicManifestPath: path.join(ROOT, 'public/database/echo-forge/audio-manifest.v1.json'),
  dataManifestPath: path.join(ROOT, 'data/echo-forge/audio-manifest.v1.json'),
  sandboxRoot: ROOT,
  primaryRoot: path.resolve(ROOT, '..', 'Cursor AI'),
  threshold: DEFAULT_THRESHOLD,
  timeoutMs: DEFAULT_TIMEOUT_MS,
});

function requiredValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value == null || String(value).startsWith('--')) throw new TypeError(`${flag} requires a value`);
  return String(value);
}

export function parseArgs(argv = []) {
  const options = { ...DEFAULTS, execute: false, jsonPath: null, csvPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = String(argv[index]);
    if (flag === '--execute') options.execute = true;
    else if (flag === '--catalog') options.catalogPath = requiredValue(argv, index++, flag);
    else if (flag === '--source') options.sourcePath = requiredValue(argv, index++, flag);
    else if (flag === '--audio-root') options.audioRoot = requiredValue(argv, index++, flag);
    else if (flag === '--public-manifest' || flag === '--manifest') options.publicManifestPath = requiredValue(argv, index++, flag);
    else if (flag === '--data-manifest') options.dataManifestPath = requiredValue(argv, index++, flag);
    else if (flag === '--json' || flag === '--output-json' || flag === '--json-output') options.jsonPath = requiredValue(argv, index++, flag);
    else if (flag === '--csv' || flag === '--output-csv' || flag === '--csv-output') options.csvPath = requiredValue(argv, index++, flag);
    else if (flag === '--threshold') options.threshold = Number(requiredValue(argv, index++, flag));
    else if (flag === '--timeout-ms') options.timeoutMs = Number(requiredValue(argv, index++, flag));
    else throw new TypeError(`unknown option: ${flag}`);
  }
  return Object.freeze(options);
}

function assertCliOptions(options) {
  if (!options.execute) throw new Error('explicit --execute is required');
  if (!options.jsonPath || !options.csvPath) throw new Error('--json and --csv output paths are required');
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(argv);
  assertCliOptions(options);
  const credentials = dependencies.credentials || await loadAzureCredentials({
    env: dependencies.env || process.env,
    sandboxRoot: options.sandboxRoot,
    primaryRoot: options.primaryRoot,
  });
  const result = await runListeningAudioSemanticQa({
    ...options,
    ...credentials,
    generatedAt: dependencies.now ? dependencies.now() : new Date().toISOString(),
    fetchImpl: dependencies.fetchImpl || globalThis.fetch,
  });
  if (!result.passed) throw new Error('semantic QA gate failed');
  process.stdout.write('Echo Forge listening audio semantic QA completed.\n');
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(() => {
    process.stderr.write('Echo Forge listening audio semantic QA failed.\n');
    process.exitCode = 1;
  });
}
