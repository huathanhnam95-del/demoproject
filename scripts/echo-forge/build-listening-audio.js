import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generateListeningAudio } from './listening-audio-core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRIMARY_WORKSPACE_ROOT = path.resolve(ROOT, '..', 'Cursor AI');
const SANDBOX_KOKORO_ROOT = path.join(ROOT, 'Kokoro-FastAPI');
const PRIMARY_KOKORO_ROOT = path.join(PRIMARY_WORKSPACE_ROOT, 'Kokoro-FastAPI');
const KOKORO_ROOT = existsSync(PRIMARY_KOKORO_ROOT) ? PRIMARY_KOKORO_ROOT : SANDBOX_KOKORO_ROOT;
const DEFAULTS = Object.freeze({
  catalogPath: path.join(ROOT, 'public/database/echo-forge/challenges.v1.json'),
  sourcePath: path.join(ROOT, 'data/echo-forge/challenges.source.json'),
  audioRoot: path.join(ROOT, 'public'),
  manifestPath: path.join(ROOT, 'public/database/echo-forge/audio-manifest.v1.json'),
  ttsEndpoint: 'http://127.0.0.1:8880/v1/audio/speech',
  modelPath: path.join(KOKORO_ROOT, 'api/src/models/v1_0/kokoro-v1_0.pth'),
  voicePath: path.join(KOKORO_ROOT, 'api/src/voices/v1_0/af_heart.pt'),
});

function requiredValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value == null || String(value).startsWith('--')) throw new TypeError(`${flag} requires a value`);
  return String(value);
}

export function parseArgs(argv = []) {
  const options = { ...DEFAULTS, modelSha256: process.env.ECHO_FORGE_MODEL_SHA256 || null, voiceSha256: process.env.ECHO_FORGE_VOICE_SHA256 || null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = String(argv[index]);
    if (flag === '--catalog') options.catalogPath = requiredValue(argv, index++, flag);
    else if (flag === '--source') options.sourcePath = requiredValue(argv, index++, flag);
    else if (flag === '--audio-root') options.audioRoot = requiredValue(argv, index++, flag);
    else if (flag === '--manifest') options.manifestPath = requiredValue(argv, index++, flag);
    else if (flag === '--data-manifest') options.dataManifestPath = requiredValue(argv, index++, flag);
    else if (flag === '--tts-endpoint') options.ttsEndpoint = requiredValue(argv, index++, flag);
    else if (flag === '--model-sha256') options.modelSha256 = requiredValue(argv, index++, flag);
    else if (flag === '--voice-sha256') options.voiceSha256 = requiredValue(argv, index++, flag);
    else if (flag === '--model-path') options.modelPath = requiredValue(argv, index++, flag);
    else if (flag === '--voice-path') options.voicePath = requiredValue(argv, index++, flag);
    else throw new TypeError(`unknown option: ${flag}`);
  }
  return Object.freeze(options);
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}

async function resolveHash(explicit, filePath, label) {
  if (explicit) return explicit;
  if (!filePath) throw new TypeError(`${label} requires --${label.toLowerCase()}-sha256 or a path`);
  try {
    return await sha256File(filePath);
  } catch (error) {
    throw new Error(`${label} hash is unavailable; provide --${label.toLowerCase()}-sha256 (${error.message})`);
  }
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(argv);
  const catalog = JSON.parse(await readFile(options.catalogPath, 'utf8'));
  const source = JSON.parse(await readFile(options.sourcePath, 'utf8'));
  const modelSha256 = await resolveHash(options.modelSha256, options.modelPath, 'model');
  const voiceSha256 = await resolveHash(options.voiceSha256, options.voicePath, 'voice');
  const result = await generateListeningAudio({
    ...options,
    catalog,
    source,
    modelSha256,
    voiceSha256,
    fetchImpl: dependencies.fetchImpl || globalThis.fetch,
  });
  process.stdout.write(`Echo Forge listening audio: ${result.generatedCount} generated, ${result.reusedCount} reused, ${result.manifest.entries.length} manifest entries.\n`);
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    process.stderr.write(`Echo Forge listening audio failed: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
