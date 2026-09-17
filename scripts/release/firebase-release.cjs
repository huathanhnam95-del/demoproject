/* eslint-disable no-console */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const SUPPORTED_FIREBASE_VERSION = '15.2.1';
const SUPPORTED_FIREBASE_VERSIONS = new Set(['15.2.1', '15.29.0']);
const SHA_RE = /^[0-9a-f]{40}$/i;
const PROJECT_ID_RE = /^[a-z][a-z0-9-]{4,62}$/;
const PROFILE_NAMES = Object.freeze(['hosting', 'functions', 'full']);
const PROFILE_CONFIG = Object.freeze({
  hosting: Object.freeze({
    selector: 'hosting',
    products: Object.freeze(['hosting']),
    preparation: Object.freeze(['version', 'connectedSpeech'])
  }),
  functions: Object.freeze({
    selector: 'functions',
    products: Object.freeze(['functions']),
    preparation: Object.freeze(['connectedSpeech', 'segmentationV2'])
  }),
  full: Object.freeze({
    selector: 'hosting,functions:api,firestore:rules',
    products: Object.freeze(['hosting', 'functions']),
    preparation: Object.freeze(['version', 'connectedSpeech', 'segmentationV2'])
  })
});

const HOOK_CONTEXT_FIELDS = Object.freeze([
  'BEL_FIREBASE_RELEASE_CONTEXT',
  'BEL_FIREBASE_RELEASE_RECEIPT',
  'BEL_FIREBASE_RELEASE_PROFILE',
  'BEL_FIREBASE_RELEASE_CANDIDATE_ROOT',
  'BEL_FIREBASE_RELEASE_SOURCE_SHA',
  'BEL_FIREBASE_RELEASE_PROJECT_ID',
  'BEL_FIREBASE_RELEASE_PROJECT_ALIAS',
  'BEL_FIREBASE_RELEASE_CONFIG_PATH',
  'BEL_FIREBASE_RELEASE_SURFACE_SHA256'
]);
const HOOK_REQUIRED_FIELDS = Object.freeze([
  'BEL_FIREBASE_RELEASE_CONTEXT',
  'BEL_FIREBASE_RELEASE_RECEIPT',
  'BEL_FIREBASE_RELEASE_PROFILE',
  'BEL_FIREBASE_RELEASE_CANDIDATE_ROOT',
  'BEL_FIREBASE_RELEASE_SOURCE_SHA',
  'BEL_FIREBASE_RELEASE_PROJECT_ID',
  'BEL_FIREBASE_RELEASE_CONFIG_PATH',
  'BEL_FIREBASE_RELEASE_SURFACE_SHA256'
]);

const RELEASE_INPUTS = Object.freeze([
  'package.json',
  'package-lock.json',
  'functions/package.json',
  'functions/package-lock.json',
  'firebase.json',
  '.firebaserc',
  'scripts/sync-version.js',
  'scripts/read-aloud/build-connected-speech-index.js',
  'scripts/read-aloud/connected-speech-index-core.js',
  'public/js/read-aloud-prompt-grammar.js',
  'public/js/read-aloud-spoken-forms.js',
  'public/js/read-aloud-connected-speech-rules.js',
  'public/js/read-aloud-linking.js',
  'scripts/segmentation-study/sync-manifest.js',
  'scripts/release/firebase-release.cjs'
]);

class ReleaseError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ReleaseError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ReleaseError(code, message, details);
}

let ACTIVE_METRICS = null;

function getActiveMetrics() {
  return ACTIVE_METRICS;
}

function setActiveMetrics(metrics) {
  ACTIVE_METRICS = metrics;
}

function redactString(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/(?:bearer\s+)[a-zA-Z0-9_\-.]+/gi, 'Bearer [REDACTED]')
    .replace(/(?:key|token|secret|password|apikey)=([^\s&]+)/gi, '$1=[REDACTED]')
    .replace(/(firebase[a-z0-9_-]*token\s+)[^\s]+/gi, '$1[REDACTED]');
}

function redactArgs(args) {
  if (!Array.isArray(args)) return [];
  const redacted = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i]);
    if (arg === '--token' && i + 1 < args.length) {
      redacted.push(arg);
      redacted.push('[REDACTED]');
      i += 1;
    } else {
      redacted.push(redactString(arg));
    }
  }
  return redacted;
}

class ReleaseMetrics {
  constructor(options = {}) {
    this.startTime = Date.now();
    this.startHrTime = process.hrtime.bigint();
    this.options = { ...options };
    this.sourceSha = options.sha || null;
    this.profile = options.profile || null;
    this.mediaPublicationId = options.mediaPublicationId || null;
    this.projectId = options.project || null;
    this.projectAlias = null;
    this.toolVersions = { node: process.version };
    this.phases = {};
    this.activePhase = null;
    this.counters = {
      filesVisited: 0,
      mediaBytesRead: 0,
      rawHashBytes: 0,
      gitHashBytes: 0,
      cacheHits: 0,
      candidateBytes: 0,
      actualUploadedCount: 0,
      actualUploadedBytes: 0
    };
    this.subprocessTimers = [];
    this.success = null;
    this.error = null;
    this.verified = false;
    this.published = false;
    this.publication = null;
  }

  increment(counter, amount = 1) {
    if (typeof this.counters[counter] === 'number') {
      this.counters[counter] += amount;
    }
  }

  startPhase(name) {
    if (this.activePhase) this.endPhase(this.activePhase);
    this.activePhase = name;
    this.phases[name] = {
      startHr: process.hrtime.bigint(),
      startTime: new Date().toISOString(),
      durationMs: 0
    };
  }

  endPhase(name) {
    const phaseName = name || this.activePhase;
    if (phaseName && this.phases[phaseName] && this.phases[phaseName].startHr) {
      const elapsedNs = process.hrtime.bigint() - this.phases[phaseName].startHr;
      this.phases[phaseName].durationMs = Number(elapsedNs) / 1e6;
      delete this.phases[phaseName].startHr;
      if (this.activePhase === phaseName) this.activePhase = null;
    }
  }

  recordSubprocess(spec, durationMs, exitCode) {
    this.subprocessTimers.push({
      kind: spec.kind || 'subprocess',
      command: path.basename(spec.command),
      args: redactArgs(spec.args || []),
      durationMs: Number(durationMs.toFixed(3)),
      exitCode: exitCode === undefined ? 0 : exitCode
    });
  }

  setContextMetadata(ctx) {
    if (ctx) {
      this.sourceSha = ctx.sourceSha || this.sourceSha;
      this.profile = ctx.profile || this.profile;
      this.projectId = ctx.project?.id || this.projectId;
      this.projectAlias = ctx.project?.alias || null;
      if (ctx.toolVersions) {
        this.toolVersions = { ...this.toolVersions, ...ctx.toolVersions };
      }
      if (ctx.candidateBytes) {
        this.counters.candidateBytes = ctx.candidateBytes;
      }
    }
  }

  recordSuccess(details = {}) {
    if (this.activePhase) this.endPhase(this.activePhase);
    this.success = true;
    this.verified = Boolean(details.verified);
    this.published = Boolean(details.published);
    this.publication = details.publication || null;
  }

  recordFailure(error) {
    if (this.activePhase) this.endPhase(this.activePhase);
    this.success = false;
    this.verified = false;
    this.published = false;
    this.error = {
      code: error?.code || 'UNKNOWN_ERROR',
      message: redactString(error?.message || String(error)),
      phase: this.activePhase
    };
  }

  toJSON() {
    const totalNs = process.hrtime.bigint() - this.startHrTime;
    const totalWallMs = Number(totalNs) / 1e6;
    return {
      version: 1,
      sourceSha: this.sourceSha,
      profile: this.profile,
      mediaPublicationId: this.mediaPublicationId,
      projectId: this.projectId,
      projectAlias: this.projectAlias,
      toolVersions: this.toolVersions,
      wallTimeMs: Number(totalWallMs.toFixed(3)),
      startedAt: new Date(this.startTime).toISOString(),
      completedAt: new Date().toISOString(),
      success: this.success,
      verified: this.verified,
      published: this.published,
      error: this.error,
      counters: { ...this.counters },
      phases: Object.fromEntries(
        Object.entries(this.phases).map(([k, v]) => [k, { durationMs: Number((v.durationMs || 0).toFixed(3)), startTime: v.startTime }])
      ),
      subprocesses: this.subprocessTimers
    };
  }
}

function writeMetricsFile(ctx, metrics, options = {}) {
  if (!metrics) return null;
  const metricsData = metrics.toJSON();
  let targetDir = null;
  if (ctx && ctx.externalRoot && fs.existsSync(ctx.externalRoot)) {
    targetDir = ctx.externalRoot;
  } else if (options.externalRoot && fs.existsSync(options.externalRoot)) {
    targetDir = options.externalRoot;
  } else {
    targetDir = path.join(os.tmpdir(), 'bel-firebase-release');
    fs.mkdirSync(targetDir, { recursive: true });
  }
  const filePath = path.join(targetDir, 'release-metrics.json');
  fs.writeFileSync(filePath, `${JSON.stringify(metricsData, null, 2)}\n`, 'utf8');
  if (ctx) ctx.metricsPath = filePath;
  return filePath;
}


function isAbsoluteOutside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function isSameOrInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function assertInside(root, candidate, label = 'path') {
  if (isAbsoluteOutside(root, candidate)) fail('PATH_OUTSIDE_ROOT', `${label} must remain inside its root.`);
  return path.resolve(candidate);
}

function assertExternalRoot(sourceRoot, externalRoot, label = 'external root') {
  const source = path.resolve(sourceRoot);
  const external = path.resolve(externalRoot);
  if (!isAbsoluteOutside(source, external) || !isAbsoluteOutside(external, source)) {
    fail('EXTERNAL_ROOT', `${label} must be outside the source repository.`);
  }
  const resolveFutureReal = (candidate) => {
    let current = path.resolve(candidate);
    const suffix = [];
    while (true) {
      let stat;
      try { stat = fs.lstatSync(current); } catch (error) {
        if (error && error.code === 'ENOENT') {
          const parent = path.dirname(current);
          if (parent === current) fail('EXTERNAL_ROOT', `${label} has no existing ancestor.`);
          suffix.unshift(path.basename(current));
          current = parent;
          continue;
        }
        fail('EXTERNAL_ROOT', `${label} could not be resolved safely.`);
      }
      if (stat.isSymbolicLink()) fail('EXTERNAL_ROOT', `${label} crosses a symlink or junction.`);
      let resolved;
      try { resolved = fs.realpathSync.native(current); } catch (_) { fail('EXTERNAL_ROOT', `${label} could not be resolved safely.`); }
      return path.join(resolved, ...suffix);
    }
  };
  const sourceReal = resolveFutureReal(source);
  const externalReal = resolveFutureReal(external);
  if (!isAbsoluteOutside(sourceReal, externalReal) || !isAbsoluteOutside(externalReal, sourceReal)) {
    fail('EXTERNAL_ROOT', `${label} resolves inside the source repository.`);
  }
  return external;
}

function rejectLinkAncestors(root, candidate, label = 'path') {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  assertInside(base, target, label);
  let baseReal = base;
  try {
    const baseStat = fs.lstatSync(base);
    if (baseStat.isSymbolicLink()) fail('LINK_ESCAPE', `${label} crosses a symlink or junction.`);
    baseReal = fs.realpathSync.native(base);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') fail('LINK_ESCAPE', `${label} root could not be resolved safely.`);
  }
  const relative = path.relative(base, target);
  let current = base;
  for (const part of relative ? relative.split(path.sep) : []) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      fail('LINK_ESCAPE', `${label} could not be resolved safely.`);
    }
    if (stat.isSymbolicLink()) {
      fail('LINK_ESCAPE', `${label} crosses a symlink or junction.`);
    }
    const currentReal = fs.realpathSync.native(current);
    if (isAbsoluteOutside(baseReal, currentReal)) fail('LINK_ESCAPE', `${label} resolves outside its root.`);
  }
  return target;
}

function normalizeRelativePath(value, label = 'path') {
  const text = String(value == null ? '' : value);
  if (!text || text.includes('\0') || text.includes('\\') || /[<>:"|?*]/.test(text) || /^[A-Za-z]:/.test(text) || text.startsWith('/') || text.startsWith('//')) {
    fail('INVALID_PATH', `${label} must be a relative POSIX path.`);
  }
  const parts = text.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) fail('INVALID_PATH', `${label} contains an invalid path segment.`);
  const windowsReserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  if (parts.some((part) => /[. ]$/.test(part) || windowsReserved.test(part))) fail('INVALID_PATH', `${label} contains a Windows-incompatible path segment.`);
  const normalized = parts.join('/');
  if (normalized !== text) fail('INVALID_PATH', `${label} is not normalized.`);
  return normalized;
}

function sha256File(filePath, metrics = ACTIVE_METRICS) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  let totalBytes = 0;
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let read;
    do {
      read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (read) {
        hash.update(buffer.subarray(0, read));
        totalBytes += read;
      }
    } while (read);
  } finally {
    fs.closeSync(fd);
  }
  if (metrics && typeof metrics.increment === 'function') {
    metrics.increment('rawHashBytes', totalBytes);
  }
  return hash.digest('hex');
}

function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function gitBlobSha1(filePath, metrics = ACTIVE_METRICS) {
  const stat = fs.statSync(filePath);
  const hash = crypto.createHash('sha1');
  hash.update(`blob ${stat.size}\0`);
  const fd = fs.openSync(filePath, 'r');
  let totalBytes = 0;
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let read;
    do {
      read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (read) {
        hash.update(buffer.subarray(0, read));
        totalBytes += read;
      }
    } while (read);
  } finally {
    fs.closeSync(fd);
  }
  if (metrics && typeof metrics.increment === 'function') {
    metrics.increment('gitHashBytes', totalBytes);
  }
  return hash.digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
}

function commitSha(value, label = 'source SHA') {
  const text = String(value || '').trim();
  if (!SHA_RE.test(text)) fail('INVALID_SHA', `${label} must be a 40-character Git SHA.`);
  return text.toLowerCase();
}

function commandResult(command, args, options = {}) {
  const startHr = process.hrtime.bigint();
  let result;
  if (typeof options.executor === 'function') {
    result = options.executor([command, ...args], {
      cwd: options.cwd,
      env: options.env,
      kind: options.kind || 'command'
    });
    if (typeof result === 'number') result = { status: result, stdout: '', stderr: '' };
    else result = result || { status: 0, stdout: '', stderr: '' };
  } else {
    result = spawnSync(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.stdio || 'pipe',
      encoding: options.encoding || 'utf8',
      shell: false,
      windowsHide: true,
      input: options.input,
      maxBuffer: options.maxBuffer || 64 * 1024 * 1024
    });
  }
  const durationMs = Number(process.hrtime.bigint() - startHr) / 1e6;
  const metrics = options.metrics || ACTIVE_METRICS;
  if (metrics && typeof metrics.recordSubprocess === 'function') {
    metrics.recordSubprocess({ command, args, kind: options.kind }, durationMs, result ? result.status : -1);
  }
  if (result && result.error) fail('COMMAND_ERROR', `${command} could not be started: ${result.error.message}`);
  return result;
}
function runCommand(command, args, options = {}) {
  const result = commandResult(command, args, options);
  if (result.status !== 0) {
    const stderrText = String(result.stderr || '').trim();
    const stdoutText = String(result.stdout || '').trim();
    if (stderrText) console.error(`[COMMAND FAILED STDERR]\n${stderrText}`);
    if (stdoutText) console.error(`[COMMAND FAILED STDOUT]\n${stdoutText}`);
    const detail = (stderrText || stdoutText).split(/\r?\n/).slice(-3).join(' | ');
    fail('COMMAND_FAILED', `${command} ${args.join(' ')} failed (exit code ${result.status})${detail ? `: ${detail}` : '.'}`);
  }
  return result;
}

function gitText(args, options = {}) {
  if (options.git && typeof options.git.run === 'function') {
    const result = options.git.run(args, { cwd: options.cwd, env: options.env });
    if (typeof result === 'string') return result.trim();
    if (result && result.status === 0) return String(result.stdout || '').trim();
    fail('GIT_FAILED', `git ${args.join(' ')} failed.`);
  }
  return runCommand(options.git || 'git', args, options).stdout.trim();
}

function captureTrackedInventory(sourceRoot, sourceSha, options = {}) {
  if (Array.isArray(options.treeInventory)) return options.treeInventory.map((item) => ({ ...item, path: String(item.path).replace(/\\/g, '/'), oid: item.oid || item.sha1 }));
  let result = options.git && typeof options.git.run === 'function'
    ? options.git.run(['ls-tree', '-r', '-z', sourceSha], { cwd: sourceRoot, env: options.env })
    : commandResult(options.git || 'git', ['--no-lazy-fetch', 'ls-tree', '-r', '-z', sourceSha], { ...options, cwd: sourceRoot, encoding: 'buffer' });
  if (typeof result === 'string') result = { status: 0, stdout: result };
  if (result.status !== 0) fail('GIT_FAILED', 'Could not capture the selected source tree.');
  const records = [];
  for (const record of Buffer.from(typeof result === 'string' ? result : (result.stdout || '')).toString('utf8').split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    const left = tab >= 0 ? record.slice(0, tab) : record;
    const relative = tab >= 0 ? record.slice(tab + 1) : '';
    const parts = left.split(/\s+/);
    if (parts.length < 3 || !relative) continue;
    if (parts[1] !== 'blob') fail('GIT_TREE', `Selected Git tree contains an unsupported entry at ${relative}.`);
    records.push({ path: relative.replace(/\\/g, '/'), mode: parts[0], oid: parts[2] });
  }
  return records;
}

const PROVISIONED_MEDIA_ROOTS = Object.freeze([
  'public/database/RA/Voice/audio',
  'public/database/RA/speech-coach-audio/v1/clips',
  'public/database/Highlight Incorrect Words/audio',
  'public/database/SST/audio',
  'public/audio',
  'public/assets',
  'public/media'
]);
const PROVISIONED_MEDIA_EXTENSIONS = Object.freeze(new Set(['.wav', '.mp3', '.m4a', '.ogg', '.webm', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']));
const KNOWN_BINARY_EXTENSIONS = Object.freeze(new Set([
  '.wav', '.mp3', '.m4a', '.ogg', '.webm', '.flac', '.aac', '.wma',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp', '.tiff',
  '.pdf', '.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt',
  '.zip', '.gz', '.tgz', '.tar', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.pkl', '.pth', '.onnx', '.tflite'
]));

function minimizeRoots(roots = []) {
  if (!Array.isArray(roots)) return [];
  const normalized = [];
  for (const raw of roots) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim().replace(/\\/g, '/');
    if (!trimmed) continue;
    const parts = trimmed.split('/').filter(Boolean);
    if (!parts.length) continue;
    normalized.push(parts.join('/'));
  }
  const unique = [...new Set(normalized)];
  const retained = unique.filter((candidate) => {
    return !unique.some((parent) => parent !== candidate && candidate.startsWith(`${parent}/`));
  });
  return retained.sort((a, b) => a.localeCompare(b));
}

function captureObservedProvisionedAssets(sourceRoot, trackedInventory, options = {}) {
  if (options.autoProvisionedAssets === false) return [];
  const tracked = new Set((trackedInventory || []).map((item) => String(item.path).replace(/\\/g, '/')));
  const assets = [];
  const seenPaths = new Set();
  const configuredRoots = Array.isArray(options.mediaRoots) ? options.mediaRoots : [];
  const rawCandidates = [...new Set([...PROVISIONED_MEDIA_ROOTS, ...configuredRoots])];
  const validatedRoots = [];
  for (const relativeRoot of rawCandidates) {
    if (typeof relativeRoot !== 'string' || !relativeRoot.trim()) continue;
    validatedRoots.push(relativeConfigPath(sourceRoot, relativeRoot, 'Provisioned media root'));
  }
  const activeRoots = minimizeRoots(validatedRoots);
  for (const safeRoot of activeRoots) {
    const absoluteRoot = path.join(sourceRoot, ...safeRoot.split('/'));
    if (!fs.existsSync(absoluteRoot)) continue;
    for (const file of listFiles(absoluteRoot, { exclude: ['node_modules', '.git'] })) {
      const relative = `${safeRoot}/${file.path}`;
      if (seenPaths.has(relative) || tracked.has(relative) || !PROVISIONED_MEDIA_EXTENSIONS.has(path.extname(file.path).toLowerCase())) continue;
      seenPaths.add(relative);
      const metrics = options.metrics || ACTIVE_METRICS;
      if (metrics && typeof metrics.increment === 'function') {
        metrics.increment('mediaBytesRead', file.stat.size);
      }
      assets.push({
        sourcePath: relative,
        targetPath: relative,
        size: file.stat.size,
        mtimeMs: file.stat.mtimeMs,
        ino: file.stat.ino,
        dev: file.stat.dev,
        sha256: sha256File(file.absolute, metrics)
      });
      if (assets.length > 50000) fail('ASSET_SCOPE', 'Provisioned media inventory exceeds the bounded release scope.');
    }
  }
  return assets;
}

function detectProjectRoot(cwd, options = {}) {
  if (options.projectRoot) return path.resolve(options.projectRoot);
  try {
    return path.resolve(gitText(['rev-parse', '--show-toplevel'], { ...options, cwd }));
  } catch (error) {
    const configPath = options.configPath && path.resolve(options.configPath);
    if (configPath) return path.dirname(configPath);
    return path.resolve(cwd);
  }
}

function parseGitStatus(status) {
  const records = [];
  for (const raw of String(status || '').split('\0')) {
    if (!raw) continue;
    const code = raw.slice(0, 2);
    const value = raw.slice(3);
    if (code.includes('R') || code.includes('C')) {
      const pieces = value.split('\0');
      records.push({ code, path: pieces[0] });
      if (pieces[1]) records.push({ code, path: pieces[1] });
    } else records.push({ code, path: value });
  }
  return records;
}

function guardDirtyReleaseInputs(root, options = {}) {
  let result = options.git && typeof options.git.run === 'function'
    ? options.git.run(['diff', '--name-only', '-z', 'HEAD'], { cwd: root, env: options.env })
    : commandResult(options.git || 'git', ['diff', '--name-only', '-z', 'HEAD'], { cwd: root });
  if (typeof result === 'string') result = { status: 0, stdout: result };
  if (result.status !== 0) fail('SOURCE_ROOT', 'Unable to inspect tracked release inputs.');
  const profile = options.profile || 'full';
  const extraPaths = (options.extraPaths || []).map((value) => {
    const absolute = path.resolve(root, value);
    if (isAbsoluteOutside(root, absolute)) fail('DIRTY_SCOPE', 'Selected release input must remain inside the source repository.');
    return path.relative(root, absolute).replace(/\\/g, '/');
  }).filter(Boolean);
  const status = Buffer.isBuffer(result.stdout) ? result.stdout.toString('utf8') : String(result.stdout || '');
  const selected = status.split('\0').filter(Boolean).filter(n =>
    RELEASE_INPUTS.includes(n) || n.startsWith('scripts/read-aloud/') || n.startsWith('scripts/segmentation-study/') || n.startsWith('scripts/data/') ||
    n.startsWith('public/database/RA/') || (profile !== 'functions' && n.startsWith('public/')) ||
    (profile !== 'hosting' && n.startsWith('functions/')) || (profile === 'full' && n === 'firestore.rules') ||
    (options.configPath && path.resolve(root, n) === path.resolve(options.cwd || root, options.configPath)) ||
    extraPaths.some((prefix) => n === prefix || n.startsWith(`${prefix}/`)));
  if (selected.length) fail('DIRTY_RELEASE_INPUT', 'Tracked release inputs are modified: ' + selected.join(', '));
  return { dirty: [] };
}

function resolveSource(options = {}) {
  const originalCwd = path.resolve(options.cwd || process.cwd());
  const root = detectProjectRoot(originalCwd, options);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) fail('SOURCE_ROOT', 'Source repository root does not exist.');
  if (options.guardDirty !== false) guardDirtyReleaseInputs(root, options);
  let sourceSha = options.sha || options.sourceSha;
  if (!sourceSha) sourceSha = gitText(['rev-parse', 'HEAD'], { ...options, cwd: root });
  sourceSha = commitSha(sourceSha);
  if (options.git && typeof options.git.verifyCommit === 'function') {
    if (!options.git.verifyCommit(sourceSha, { cwd: root })) fail('INVALID_SHA', 'Selected SHA is not a commit.');
  } else runCommand(options.git || 'git', ['--no-lazy-fetch', 'cat-file', '-e', `${sourceSha}^{commit}`], { ...options, cwd: root, stdio: 'ignore' });
  let committerEpoch;
  if (options.committerEpoch !== undefined) committerEpoch = Number(options.committerEpoch);
  else committerEpoch = Number(gitText(['--no-lazy-fetch', 'show', '-s', '--format=%ct', sourceSha], { ...options, cwd: root }));
  if (!Number.isInteger(committerEpoch) || committerEpoch < 0) fail('SOURCE_METADATA', 'Selected commit has no valid committer epoch.');
  return { root, sourceSha, committerEpoch, originalCwd };
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail('INVALID_JSON', `${label} is not valid JSON: ${error.message}`);
  }
}

function readFirebaserc(root, options = {}) {
  if (options.firebaserc && typeof options.firebaserc === 'object') return options.firebaserc;
  const filePath = path.join(root, '.firebaserc');
  return fs.existsSync(filePath) ? readJson(filePath, '.firebaserc') : {};
}

function relativeConfigPath(root, value, label) {
  if (typeof value !== 'string' || !value.trim()) fail('FIREBASE_CONFIG', `${label} must be a nonempty path.`);
  const absolute = path.resolve(root, value);
  assertInside(root, absolute, label);
  const relative = path.relative(root, absolute).replace(/\\/g, '/');
  return normalizeRelativePath(relative, label);
}

function selectedReleaseInputPaths(root, config, configRelative, profile) {
  const paths = [configRelative, '.firebaserc'];
  const hosting = config && config.hosting;
  if (profile === 'hosting' || profile === 'full') {
    const hostingEntries = Array.isArray(hosting) ? hosting : (hosting ? [hosting] : []);
    for (const entry of hostingEntries) if (entry && typeof entry.public === 'string') paths.push(relativeConfigPath(root, entry.public, 'Hosting public root'));
  }
  if (profile === 'functions' || profile === 'full') {
    for (const entry of functionsConfigEntries(config)) {
      if (!entry || typeof entry !== 'object') continue;
      if (typeof entry.source === 'string') paths.push(relativeConfigPath(root, entry.source, 'Functions source root'));
      if (typeof entry.configDir === 'string') paths.push(relativeConfigPath(root, entry.configDir, 'Functions config directory'));
      if (Array.isArray(entry.additionalSources)) for (const source of entry.additionalSources) {
        if (typeof source === 'string') paths.push(relativeConfigPath(root, source, 'Functions additional source'));
      }
    }
  }
  if (profile === 'full') {
    for (const value of [config?.firestore?.rules, config?.firestore?.indexes, config?.storage?.rules]) {
      if (typeof value === 'string') paths.push(relativeConfigPath(root, value, 'Firebase rules or indexes path'));
    }
  }
  return [...new Set(paths)];
}

function validateSelectedReleaseWiring(root, sourceSha, config, configRelative, profile, options = {}) {
  const packageJson = options.packageJson || readGitJson(root, sourceSha, 'package.json', options, 'selected package.json');
  if (!packageJson || typeof packageJson !== 'object' || !packageJson.scripts || typeof packageJson.scripts !== 'object') {
    fail('SOURCE_WIRING', 'Selected source has no usable package scripts.');
  }
  const required = ['package.json', configRelative, 'scripts/release/firebase-release.cjs', 'scripts/structure/policy.json'];
  if (profile === 'hosting' || profile === 'full') required.push('scripts/sync-version.js');
  if (profile === 'hosting' || profile === 'functions' || profile === 'full') {
    required.push('scripts/read-aloud/build-connected-speech-index.js', 'scripts/read-aloud/connected-speech-index-core.js');
  }
  if (profile === 'functions' || profile === 'full') required.push('scripts/segmentation-study/sync-manifest.js', 'functions/package.json', 'functions/package-lock.json');
  required.push('package-lock.json', 'public/database/RA/RA.xlsx', 'public/database/RA/Voice/audio/manifest.json',
    'public/js/read-aloud-prompt-grammar.js', 'public/js/read-aloud-spoken-forms.js',
    'public/js/read-aloud-connected-speech-rules.js', 'public/js/read-aloud-linking.js');
  const inventory = options.trackedInventory || captureTrackedInventory(root, sourceSha, options);
  const present = new Set(inventory.map((item) => String(item.path).replace(/\\/g, '/')));
  const missing = [...new Set(required)].filter((item) => !present.has(item));
  if (missing.length) fail('SOURCE_WIRING', `Selected source is missing required release wiring: ${missing.join(', ')}.`);
  const expectedRootScript = profile === 'full' ? 'node scripts/release/firebase-release.cjs full' : 'node scripts/release/firebase-release.cjs hosting';
  if ((profile === 'hosting' || profile === 'full') && packageJson.scripts[profile === 'full' ? 'deploy:full' : 'deploy'] !== expectedRootScript) {
    fail('SOURCE_WIRING', 'Selected root package deploy script does not invoke the verified release controller.');
  }
  if (profile === 'functions') {
    const functionsPackage = options.functionsPackageJson || readGitJson(root, sourceSha, 'functions/package.json', options, 'selected Functions package.json');
    if (functionsPackage.scripts?.deploy !== 'node ../scripts/release/firebase-release.cjs functions') {
      fail('SOURCE_WIRING', 'Selected Functions package deploy script does not invoke the verified release controller.');
    }
  }
  const expectedHooks = new Map();
  if (profile === 'hosting' || profile === 'full') expectedHooks.set('hosting', 'node scripts/release/firebase-release.cjs hook --product hosting');
  if (profile === 'functions' || profile === 'full') expectedHooks.set('functions', 'node scripts/release/firebase-release.cjs hook --product functions');
  for (const [product, expected] of expectedHooks) {
    const value = config && config[product];
    const entries = Array.isArray(value) ? value : (value ? [value] : []);
    if (!entries.length || entries.some((entry) => !Array.isArray(entry.predeploy) || entry.predeploy.length !== 1 || entry.predeploy[0] !== expected)) {
      fail('SOURCE_WIRING', `Selected Firebase config has no exact ${product} release hook.`);
    }
  }
  // A nested --config changes Firebase's project root and its relative archive
  // paths. The controller intentionally supports only root-level alternate
  // filenames until every selected-config-relative path is made explicit.
  if (configRelative.includes('/')) fail('FIREBASE_CONFIG', 'Nested Firebase config paths are unsupported; use a root-level config filename.');
  return { packageJson, inventory };
}

function readGitJson(sourceRoot, sourceSha, relative, options = {}, label = relative) {
  const text = gitText(['--no-lazy-fetch', 'show', `${sourceSha}:${relative}`], { ...options, cwd: sourceRoot });
  try { return JSON.parse(text); } catch (error) { fail('INVALID_JSON', `${label} is not valid JSON: ${error.message}`); }
}

function normalizeProjectId(value) {
  const text = String(value || '').trim();
  if (/^\d+$/.test(text)) fail('NUMERIC_PROJECT_UNSUPPORTED', 'Numeric Firebase project numbers are unsupported; use the project ID or configured alias.');

  if (!PROJECT_ID_RE.test(text)) fail('PROJECT_ID', 'Firebase project must be a valid project ID or configured alias.');
  return text;
}

function loadFirebaseCli(options = {}) {
  if (options.firebaseCli) return options.firebaseCli;
  let entry = options.firebaseCliEntrypoint;
  if (!entry) {
    // Resolve the package associated with the PATH shim, including npm global
    // and local .bin layouts. Never resolve a separate configstore installation.
    for (const directory of (process.env.PATH || '').split(path.delimiter)) {
      const shim = ['firebase', 'firebase.cmd'].map(n => path.join(directory, n)).find(n => fs.existsSync(n));
      if (!shim) continue;
      const roots = [path.join(directory, 'node_modules/firebase-tools'), path.resolve(directory, '../firebase-tools')];
      if (fs.lstatSync(shim).isSymbolicLink()) entry = fs.realpathSync(shim);
      else for (const root of roots) if (fs.existsSync(path.join(root, 'package.json'))) { entry = path.join(root, 'lib/bin/firebase.js'); break; }
      break;
    }
    if (!entry) {
      try { entry = path.join(path.dirname(require.resolve('firebase-tools/package.json', { paths: [options.requireRoot || REPOSITORY_ROOT] })), 'lib/bin/firebase.js'); } catch (_) { /* actionable failure below */ }
    }
  }
  if (!entry || !path.isAbsolute(entry) || !fs.existsSync(entry)) fail('FIREBASE_CLI_UNSUPPORTED', `Install Firebase CLI (${Array.from(SUPPORTED_FIREBASE_VERSIONS).join(' or ')}) or provide --firebase-cli with its absolute JavaScript entrypoint.`);
  entry = fs.realpathSync(entry);
  let root = path.dirname(entry), metadata;
  while (true) {
    const file = path.join(root, 'package.json');
    if (fs.existsSync(file)) {
      const value = readJson(file, 'Firebase CLI package');
      if (value.name === 'firebase-tools') { metadata = value; break; }
    }
    const parent = path.dirname(root); if (parent === root) break; root = parent;
  }
  if (!metadata || !SUPPORTED_FIREBASE_VERSIONS.has(metadata.version)) fail('FIREBASE_CLI_VERSION', `Firebase CLI ${Array.from(SUPPORTED_FIREBASE_VERSIONS).join(' or ')} is required.`);
  const bin = typeof metadata.bin === 'string' ? metadata.bin : metadata.bin?.firebase;
  if (!bin || fs.realpathSync(path.resolve(root, bin)) !== entry) fail('FIREBASE_CLI_UNSUPPORTED', 'Firebase entrypoint must match the selected package executable.');
  const configstorePath = path.join(root, 'lib/configstore.js');
  if (!fs.existsSync(configstorePath) || isAbsoluteOutside(root, fs.realpathSync(configstorePath))) fail('FIREBASE_CLI_UNSUPPORTED', 'Firebase configstore module must belong to the selected CLI.');
  const result = { version: metadata.version, entrypoint: entry, packageRoot: root, configstorePath, packageJson: metadata };
  if (options.loadConfigstore !== false) result.configstore = require(configstorePath);
  return result;
}

function configStoreValue(firebaseCli, options = {}) {
  // Lazy: help, explicit project selection and receipt hooks never load this.
  const candidate = options.configStore || firebaseCli.configstore || require(firebaseCli.configstorePath);
  const store = candidate.configstore || candidate;
  if (typeof store.get !== 'function') fail('FIREBASE_CLI_UNSUPPORTED', 'Firebase active-project API is unavailable.');
  try { return store.get('activeProjects') || {}; }
  catch (_) { fail('FIREBASE_CONFIGSTORE', 'Firebase active-project selection could not be read.'); }
}

function ancestorPaths(value) {
  const result = [];
  let current = path.resolve(value);
  while (true) {
    result.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return result;
}

function resolveFirebaseProject(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  let configPath;
  if (options.configPath) configPath = path.resolve(cwd, options.configPath);
  else {
    let current = cwd;
    while (!fs.existsSync(path.join(current, 'firebase.json'))) {
      const parent = path.dirname(current);
      if (parent === current) fail('FIREBASE_CONFIG', 'No Firebase configuration found.');
      current = parent;
    }
    configPath = path.join(current, 'firebase.json');
  }
  const root = path.dirname(configPath);
  rejectLinkAncestors(options.projectRoot || root, configPath, 'Firebase config');
  const config = options.firebaseConfig && typeof options.firebaseConfig === 'object'
    ? options.firebaseConfig
    : readJson(configPath, 'Firebase config');
  const firebaserc = readFirebaserc(root, options);
  const projects = firebaserc.projects || {};
  const requested = options.project || options.projectArg;
  const cli = options.firebaseCli || loadFirebaseCli({ ...options, loadConfigstore: !requested });
  if (!SUPPORTED_FIREBASE_VERSIONS.has(cli.version)) fail('FIREBASE_CLI_VERSION', `Firebase CLI ${Array.from(SUPPORTED_FIREBASE_VERSIONS).join(' or ')} is required.`);
  let selected = options.project || options.projectArg;
  if (selected && /^\d+$/.test(String(selected))) normalizeProjectId(selected);
  if (!selected) {
    const active = configStoreValue(cli, options);
    for (const directory of ancestorPaths(root)) if (active[directory]) { selected = active[directory]; break; }
  }
  if (!selected && typeof config.firebase === 'string') selected = config.firebase;
  let alias = null;
  if (selected && Object.prototype.hasOwnProperty.call(projects, selected)) { alias = selected; selected = projects[selected]; }
  if (!selected) {
    const keys = Object.keys(projects);
    if (keys.length === 1) { alias = keys[0]; selected = projects[alias]; }
    else if (projects.default) { alias = 'default'; selected = projects.default; }
  }
  if (!selected) fail('FIREBASE_PROJECT', 'Select a Firebase project ID or configured alias with --project.');
  if (alias && !/^[a-zA-Z0-9_-]+$/.test(alias)) fail('FIREBASE_PROJECT', 'Unsupported project alias filename.');
  return { id: normalizeProjectId(selected), alias, config, configPath, projectRoot: root, firebaserc, firebaseCli: cli };
}

function batchReader(fd) {
  let buffered = Buffer.alloc(0);
  let offset = 0;
  const refill = () => {
    const chunk = Buffer.allocUnsafe(64 * 1024);
    const count = fs.readSync(fd, chunk, 0, chunk.length, null);
    if (!count) return false;
    buffered = offset < buffered.length
      ? Buffer.concat([buffered.subarray(offset), chunk.subarray(0, count)])
      : chunk.subarray(0, count);
    offset = 0;
    return true;
  };
  const readLine = () => {
    while (true) {
      const end = buffered.indexOf(0x0a, offset);
      if (end >= 0) {
        const line = buffered.subarray(offset, end).toString('utf8');
        offset = end + 1;
        return line;
      }
      if (buffered.length - offset > 256) fail('GIT_TREE', 'Git blob batch header is unexpectedly large.');
      if (!refill()) fail('GIT_TREE', 'Git blob batch output is truncated.');
    }
  };
  const copyBytes = (size, output) => {
    let remaining = size;
    while (remaining > 0) {
      if (offset >= buffered.length && !refill()) fail('GIT_TREE', 'Git blob batch output is truncated.');
      const count = Math.min(remaining, buffered.length - offset);
      let written = 0;
      while (written < count) {
        const progress = fs.writeSync(output, buffered, offset + written, count - written);
        if (!progress) fail('GIT_TREE', 'Git blob candidate write made no progress.');
        written += progress;
      }
      offset += count;
      remaining -= count;
    }
  };
  const readByte = () => {
    if (offset >= buffered.length && !refill()) return null;
    return buffered[offset++];
  };
  return { readLine, copyBytes, readByte };
}

function validateRawTreeEntries(entries) {
  if (!Array.isArray(entries)) fail('GIT_TREE', 'Selected Git tree inventory is invalid.');
  const exact = new Set();
  const folded = new Set();
  const filePaths = new Set();
  const result = entries.map((item) => {
    if (!item || typeof item !== 'object') fail('GIT_TREE', 'Selected Git tree contains an invalid entry.');
    const relative = normalizeRelativePath(item.path, 'Git tree path');
    const mode = String(item.mode || '100644');
    if (mode !== '100644' && mode !== '100755') fail('GIT_TREE_LINK', `Git tree contains an unsupported non-file entry at ${relative}.`);
    const oid = String(item.oid || item.sha1 || '').toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(oid)) fail('GIT_TREE', `Git tree object ID is invalid for ${relative}.`);
    const foldedPath = relative.toLocaleLowerCase('en-US');
    if (exact.has(relative)) fail('PATH_COLLISION', `Git tree contains a duplicate path: ${relative}.`);
    if (folded.has(foldedPath)) fail('PATH_COLLISION', `Git tree paths collide on a case-insensitive filesystem: ${relative}.`);
    exact.add(relative); folded.add(foldedPath); filePaths.add(foldedPath);
    return { path: relative, mode, oid };
  });
  for (const item of result) {
    const parts = item.path.toLocaleLowerCase('en-US').split('/');
    for (let index = 1; index < parts.length; index += 1) {
      if (filePaths.has(parts.slice(0, index).join('/'))) fail('PATH_COLLISION', `Git tree contains a file/directory collision at ${item.path}.`);
    }
  }
  return result;
}

function exportGitTreeRaw(sourceRoot, sourceSha, destination, inventory, options = {}) {
  if (options.git && typeof options.git.run === 'function') fail('GIT_TREE', 'Raw Git tree export requires the Git executable.');
  const entries = validateRawTreeEntries(Array.isArray(inventory) ? inventory : captureTrackedInventory(sourceRoot, sourceSha, options));
  const externalRunRoot = path.resolve(options.externalRunRoot || options.externalRoot || path.dirname(destination));
  fs.mkdirSync(externalRunRoot, { recursive: true });
  fs.mkdirSync(destination, { recursive: true });

  const checkInput = entries.map((item) => `${String(item.oid || item.sha1 || '').toLowerCase()}\n`).join('');
  const checkResult = spawnSync(options.git || 'git', ['--no-lazy-fetch', 'cat-file', '--batch-check'], {
    cwd: sourceRoot,
    input: checkInput,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    shell: false
  });
  if (checkResult.error || checkResult.status !== 0) fail('GIT_TREE', 'Could not inspect the selected Git blobs.');
  const blobSizes = new Map();
  for (const line of String(checkResult.stdout || '').trim().split(/\r?\n/)) {
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length >= 3 && parts[1] === 'blob') {
      blobSizes.set(parts[0].toLowerCase(), Number(parts[2]));
    }
  }

  const entriesToSpool = [];
  for (const item of entries) {
    const relative = normalizeRelativePath(item.path, 'Git tree path');
    const mode = String(item.mode || '100644');
    const expectedOid = String(item.oid || item.sha1 || '').toLowerCase();
    const blobSize = blobSizes.get(expectedOid);
    const ext = path.extname(relative).toLowerCase();
    let hardlinked = false;
    if (KNOWN_BINARY_EXTENSIONS.has(ext) && typeof blobSize === 'number') {
      const source = path.join(sourceRoot, ...relative.split('/'));
      if (fs.existsSync(source)) {
        const sourceStat = fs.lstatSync(source);
        if (sourceStat.isFile() && !sourceStat.isSymbolicLink() && sourceStat.size === blobSize) {
          const target = rejectLinkAncestors(destination, path.join(destination, ...relative.split('/')), 'Git tree path');
          fs.mkdirSync(path.dirname(target), { recursive: true });
          try {
            if (fs.existsSync(target)) fs.unlinkSync(target);
            fs.linkSync(source, target);
            try { fs.chmodSync(target, parseInt(mode, 8) & 0o777); } catch (_) { /* Windows may reject POSIX modes. */ }
            hardlinked = true;
          } catch (_) {
            hardlinked = false;
          }
        }
      }
    }
    if (!hardlinked) {
      entriesToSpool.push(item);
    }
  }

  if (!entriesToSpool.length) return;

  const batchPath = path.join(externalRunRoot, `.source-blobs-${process.pid}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.batch`);
  assertExternalRoot(sourceRoot, externalRunRoot, 'Git export spool');
  const output = fs.openSync(batchPath, 'wx', 0o600);
  try {
    const input = entriesToSpool.map((item) => `${String(item.oid || item.sha1 || '').toLowerCase()}\n`).join('');
    const result = spawnSync(options.git || 'git', ['--no-lazy-fetch', 'cat-file', '--batch'], {
      cwd: sourceRoot,
      input,
      stdio: ['pipe', output, 'ignore'],
      windowsHide: true,
      shell: false
    });
    if (result.error || result.status !== 0) fail('GIT_TREE', 'Could not read the selected Git blobs.');
  } finally {
    fs.closeSync(output);
  }
  const inputFd = fs.openSync(batchPath, 'r');
  try {
    const reader = batchReader(inputFd);
    for (const item of entriesToSpool) {
      const relative = normalizeRelativePath(item.path, 'Git tree path');
      const mode = String(item.mode || '100644');
      const header = reader.readLine().split(/\s+/);
      const expectedOid = String(item.oid || item.sha1 || '').toLowerCase();
      if (header[0]?.toLowerCase() !== expectedOid || header[1] !== 'blob') fail('GIT_TREE', `Git blob identity could not be read for ${relative}.`);
      const size = Number(header[2]);
      if (!Number.isSafeInteger(size) || size < 0) fail('GIT_TREE', `Git blob size is invalid for ${relative}.`);
      const target = rejectLinkAncestors(destination, path.join(destination, ...relative.split('/')), 'Git tree path');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const targetFd = fs.openSync(target, 'wx', 0o600);
      try { reader.copyBytes(size, targetFd); } finally { fs.closeSync(targetFd); }
      if (reader.readByte() !== 0x0a) fail('GIT_TREE', `Git blob batch separator is invalid for ${relative}.`);
      try { fs.chmodSync(target, parseInt(mode, 8) & 0o777); } catch (_) { /* Windows may reject POSIX modes. */ }
    }
    if (reader.readByte() !== null) fail('GIT_TREE', 'Git blob batch output contains trailing records.');
  } finally {
    fs.closeSync(inputFd);
    try { fs.unlinkSync(batchPath); } catch (_) { /* cleanup is best effort. */ }
  }
}

function createCandidate(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot || options.root || REPOSITORY_ROOT);
  const phaseRoot = assertExternalRoot(sourceRoot, options.externalRoot || path.join(os.tmpdir(), 'bel-firebase-release'));
  fs.mkdirSync(phaseRoot, { recursive: true });
  // An explicitly supplied external root is already the caller's isolated run
  // directory (the CLI contract makes it unique per invocation).  Keep
  // receipts and evidence directly beneath it; internally-created defaults
  // still receive a unique run directory.
  const externalRoot = options.runRoot
    ? assertExternalRoot(sourceRoot, options.runRoot)
    : options.externalRoot
      ? phaseRoot
      : fs.mkdtempSync(path.join(phaseRoot, 'run-'));
  fs.mkdirSync(externalRoot, { recursive: true });
  const runId = `${process.pid}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  let candidateRoot = options.candidateRoot && path.resolve(options.candidateRoot);
  if (candidateRoot) {
    assertExternalRoot(sourceRoot, path.dirname(candidateRoot), 'candidate root');
    rejectLinkAncestors(externalRoot, candidateRoot, 'candidate root');
    fs.mkdirSync(candidateRoot, { recursive: true });
  } else {
    candidateRoot = fs.mkdtempSync(path.join(externalRoot, 'candidate-'));
    exportGitTreeRaw(sourceRoot, commitSha(options.sourceSha), candidateRoot, options.treeInventory, {
      ...options,
      externalRunRoot: externalRoot
    });
  }
  const lfsPointers = hydrateWorktreeLfs(sourceRoot, candidateRoot);
  return { sourceRoot, phaseRoot, externalRoot, candidateRoot, lfsPointers, runId };
}

function parseLfsPointer(filePath) {
  if (fs.statSync(filePath).size > 512) return null;
  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch (_) { return null; }
  const lines = content.split(/\r?\n/);
  if (lines[0] !== 'version https://git-lfs.github.com/spec/v1') return null;
  const oid = lines.find((line) => /^oid sha256:[0-9a-f]{64}$/i.test(line));
  const size = lines.find((line) => /^size \d+$/.test(line));
  if (!oid || !size) return null;
  return { sha256: oid.slice('oid sha256:'.length).toLowerCase(), size: Number(size.slice(5)) };
}


function hydrateWorktreeLfs(sourceRoot, candidateRoot) {
  const pointers = new Map();
  for (const file of listFiles(candidateRoot, { exclude: ['node_modules', '.git', '.cache', '__pycache__'] })) {
    const pointer = parseLfsPointer(file.absolute);
    if (!pointer) continue;
    const relative = file.path.replace(/\\/g, '/');
    pointers.set(relative, pointer);
    const source = path.join(sourceRoot, ...relative.split('/'));
    if (!fs.existsSync(source) || !fs.lstatSync(source).isFile()) continue;
    const sourceStat = fs.lstatSync(source);
    if (sourceStat.size === pointer.size && sha256File(source) === pointer.sha256) {
      try {
        if (fs.existsSync(file.absolute)) fs.unlinkSync(file.absolute);
        fs.linkSync(source, file.absolute);
      } catch (_) {
        fs.copyFileSync(source, file.absolute);
      }
    }
  }
  return pointers;
}

function listFiles(root, options = {}) {
  const files = [];
  const excluded = new Set(options.exclude || []);
  const ignoreRules = Array.isArray(options.ignoreRules) ? options.ignoreRules.map((rule) => String(rule).replace(/\\/g, '/')).filter(Boolean) : [];
  const ignored = (relative) => {
    const normalized = relative.replace(/\\/g, '/');
    const segments = normalized.split('/');
    return ignoreRules.some((rule) => {
      // Firebase's archive matcher evaluates absolute paths with minimatch's
      // matchBase behavior. Only unambiguous literal basenames are safe to
      // prune here; slash/glob/comment rules remain visible to sealing.
      if (rule === '.' || rule === '..' || !/^[A-Za-z0-9._-]+$/.test(rule)) return false;
      return segments.includes(rule);
    });
  };
  const visit = (directory, relative) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (excluded.has(entry.name) || excluded.has(childRelative) || ignored(childRelative)) continue;
      const child = path.join(directory, entry.name);
      const stat = fs.lstatSync(child);
      if (stat.isSymbolicLink()) fail('LINK_ESCAPE', `Candidate contains a symlink: ${childRelative}.`);
      if (stat.isDirectory()) visit(child, childRelative);
      else if (stat.isFile()) {
        if (ACTIVE_METRICS) ACTIVE_METRICS.increment('filesVisited');
        files.push({ path: childRelative.replace(/\\/g, '/'), absolute: child, stat });
      }
    }
  };
  visit(root, '');
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function safeTargetPath(root, relative, label) {
  const normalized = normalizeRelativePath(relative, label);
  return { normalized, absolute: rejectLinkAncestors(root, path.join(root, ...normalized.split('/')), label) };
}

function copyProvisionedAssets(ctx, assets = []) {
  const copied = [];
  for (const item of assets || []) {
    if (!item || typeof item !== 'object') fail('ASSET_SCHEMA', 'Provisioned asset entries must be objects.');
    const targetSpec = safeTargetPath(ctx.candidateRoot, item.targetPath || item.target || item.path || '', 'asset target');
    const expected = item.sha256 || item.hash;
    let actual;
    let sourceStat;
    let source = null;
    let inline = null;
    if (item.bytes !== undefined) {
      inline = Buffer.isBuffer(item.bytes) ? item.bytes : Buffer.from(String(item.bytes));
      actual = sha256Bytes(inline);
      sourceStat = { size: inline.length };
    } else {
      source = path.resolve(ctx.sourceRoot, item.sourcePath || item.source || '');
      rejectLinkAncestors(ctx.sourceRoot, source, 'asset source');
      if (!fs.existsSync(source) || !fs.lstatSync(source).isFile()) fail('ASSET_MISSING', `Provisioned asset is missing: ${targetSpec.normalized}.`);
      sourceStat = fs.lstatSync(source);
      if (sourceStat.isSymbolicLink()) fail('ASSET_LINK', `Provisioned asset is a symlink: ${targetSpec.normalized}.`);
      actual = (item.sha256 && item.size === sourceStat.size) ? item.sha256 : sha256File(source);
    }
    if (expected && String(expected).toLowerCase() !== actual) fail('ASSET_HASH', `Provisioned asset hash changed: ${targetSpec.normalized}.`);
    const existingPointer = fs.existsSync(targetSpec.absolute) ? parseLfsPointer(targetSpec.absolute) : null;
    if (existingPointer && (existingPointer.sha256 !== actual || existingPointer.size !== sourceStat.size)) {
      fail('LFS_ASSET_HASH', `Hydrated asset does not match its selected LFS pointer: ${targetSpec.normalized}.`);
    }
    fs.mkdirSync(path.dirname(targetSpec.absolute), { recursive: true });
    if (inline) {
      fs.writeFileSync(targetSpec.absolute, inline);
    } else {
      try {
        if (fs.existsSync(targetSpec.absolute)) fs.unlinkSync(targetSpec.absolute);
        fs.linkSync(source, targetSpec.absolute);
      } catch (_) {
        fs.copyFileSync(source, targetSpec.absolute);
      }
    }
    copied.push({
      path: targetSpec.normalized,
      size: sourceStat.size,
      mtimeMs: sourceStat.mtimeMs,
      ino: sourceStat.ino,
      dev: sourceStat.dev,
      sha256: actual
    });
  }
  return copied;
}

function verifyProvisionedAssets(ctx) {
  for (const item of ctx.assets || []) {
    const target = safeTargetPath(ctx.candidateRoot, item.path, 'provisioned asset').absolute;
    if (!fs.existsSync(target)) fail('ASSET_CHANGED', `Provisioned asset is missing from the candidate: ${item.path}.`);
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== item.size) {
      fail('ASSET_CHANGED', `Provisioned asset changed in the candidate: ${item.path}.`);
    }
    const isSameHardlink = item.ino && stat.ino === item.ino && stat.dev === item.dev && stat.mtimeMs === item.mtimeMs;
    if (!isSameHardlink && sha256File(target) !== item.sha256) {
      fail('ASSET_CHANGED', `Provisioned asset changed in the candidate: ${item.path}.`);
    }
  }
  for (const item of ctx.observedAssets || []) {
    const source = safeTargetPath(ctx.sourceRoot, item.sourcePath, 'observed provisioned asset').absolute;
    if (!fs.existsSync(source)) fail('ASSET_CHANGED', `Observed provisioned asset disappeared from the source: ${item.sourcePath}.`);
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== item.size) {
      fail('ASSET_CHANGED', `Observed provisioned asset changed in the source: ${item.sourcePath}.`);
    }
    const isUnmodified = item.mtimeMs !== undefined && stat.mtimeMs === item.mtimeMs && stat.size === item.size;
    if (!isUnmodified && sha256File(source) !== item.sha256) {
      fail('ASSET_CHANGED', `Observed provisioned asset changed in the source: ${item.sourcePath}.`);
    }
  }
  return { checked: (ctx.assets || []).length + (ctx.observedAssets || []).length };
}

function recognizedDotenvNames(project) {
  const values = ['.env'];
  if (project.id) values.push(`.env.${project.id}`);
  if (project.alias && project.alias !== project.id) values.push(`.env.${project.alias}`);
  return [...new Set(values)];
}

function joinRelativePath(directory, name) {
  return directory ? `${directory}/${name}` : name;
}

function excludedFunctionsDotenvNames(project) {
  const names = recognizedDotenvNames(project);
  if (project?.id) names.push(`.env.${project.id}.local`);
  if (project?.alias) names.push(`.env.${project.alias}.local`);
  names.push('.env.local', '.env.secret.local');
  return [...new Set(names)];
}

function functionsConfigEntries(config) {
  if (Array.isArray(config && config.functions)) return config.functions;
  if (config && config.functions && typeof config.functions === 'object') return [config.functions];
  return [];
}

function functionsConfigDirectories(config, root) {
  const entries = functionsConfigEntries(config);
  return entries.map((entry) => {
    const source = entry && typeof entry.source === 'string' ? entry.source : 'functions';
    const configured = entry && typeof entry.configDir === 'string' ? entry.configDir : source;
    const directory = path.resolve(root, configured);
    assertInside(root, directory, 'Functions config directory');
    return directory;
  });
}

function functionsSourceDirectories(config, root) {
  const entries = functionsConfigEntries(config);
  return entries.map((entry) => {
    const source = entry && typeof entry.source === 'string' ? entry.source : 'functions';
    const directory = path.resolve(root, source);
    assertInside(root, directory, 'Functions source');
    return directory;
  });
}

function stageFunctionsDotenv(ctx, project, options = {}) {
  if (!ctx.profileConfig.products.includes('functions')) return [];
  const staged = [];
  const sourceDirectories = ctx.functionsConfigDirs && ctx.functionsConfigDirs.length
    ? ctx.functionsConfigDirs
    : [path.join(ctx.sourceRoot, 'functions')];
  for (const sourceFunctions of sourceDirectories) {
    rejectLinkAncestors(ctx.sourceRoot, sourceFunctions, 'Functions config directory');
    const relativeConfigDir = path.relative(ctx.sourceRoot, sourceFunctions).replace(/\\/g, '/');
    const candidateFunctions = path.join(ctx.candidateRoot, ...relativeConfigDir.split('/'));
    rejectLinkAncestors(ctx.candidateRoot, candidateFunctions, 'Candidate Functions config directory');
    const names = recognizedDotenvNames(project);
    const present = names.filter((name) => fs.existsSync(path.join(sourceFunctions, name)));
    const idFile = `.env.${project.id}`;
    const aliasFile = project.alias && `.env.${project.alias}`;
    if (aliasFile && ((aliasFile === idFile && present.includes(idFile)) || (aliasFile !== idFile && present.includes(idFile) && present.includes(aliasFile)))) {
      fail('DOTENV_CONFLICT', 'Functions project-ID and project-alias dotenv files conflict; retain one selected identity.');
    }
    for (const name of present) {
      const source = path.join(sourceFunctions, name);
      const stat = fs.lstatSync(source);
      if (!stat.isFile() || stat.isSymbolicLink()) fail('DOTENV_INPUT', `Functions dotenv input is not a regular file: ${name}.`);
      const target = path.join(candidateFunctions, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
      staged.push({ name, relativePath: joinRelativePath(relativeConfigDir, name) });
    }
  }
  return staged;
}

function applyFunctionsDotenvIgnore(candidateRoot, project, configPathArg) {
  const configPath = configPathArg
    ? rejectLinkAncestors(candidateRoot, path.resolve(configPathArg), 'candidate Firebase config')
    : path.join(candidateRoot, 'firebase.json');
  if (!fs.existsSync(configPath)) return { added: [] };
  const config = readJson(configPath, 'candidate firebase.json');
  const result = addFunctionsDotenvIgnore(config, project);
  if (result.added.length) fs.writeFileSync(configPath, `${JSON.stringify(result.config, null, 2)}\n`, 'utf8');
  return { added: result.added };
}

function addFunctionsDotenvIgnore(config, project) {
  const next = JSON.parse(JSON.stringify(config || {}));
  const entries = functionsConfigEntries(config);
  if (!entries.length) return { config: next, added: [] };
  const added = [];
  const nextEntries = functionsConfigEntries(next);
  for (const entry of nextEntries) {
    if (!entry || typeof entry !== 'object') continue;
    const explicit = Array.isArray(entry.ignore);
    const ignores = explicit ? [...entry.ignore] : ['node_modules', '.git'];
    const names = recognizedDotenvNames(project || {});
    for (const rule of names) {
      if (!ignores.includes(rule)) {
        ignores.push(rule);
        added.push(rule);
      }
    }
    entry.ignore = ignores;
  }
  return { config: next, added: [...new Set(added)] };
}

function validatePrivateInputLayout(config, root, project = {}) {
  const hostingPublic = config && config.hosting && typeof config.hosting.public === 'string'
    ? path.resolve(root, config.hosting.public)
    : null;
  if (hostingPublic) {
    assertInside(root, hostingPublic, 'Hosting public root');
    rejectLinkAncestors(root, hostingPublic, 'Hosting public root');
  }
  const functions = functionsConfigEntries(config);
  for (const entry of functions) {
    if (!entry || typeof entry !== 'object') fail('PRIVATE_INPUT_LAYOUT', 'Functions configuration entries must be objects.');
    const sourceRoot = path.resolve(root, typeof entry.source === 'string' ? entry.source : 'functions');
    assertInside(root, sourceRoot, 'Functions source');
    rejectLinkAncestors(root, sourceRoot, 'Functions source');
    const configDir = path.resolve(root, typeof entry.configDir === 'string' ? entry.configDir : (typeof entry.source === 'string' ? entry.source : 'functions'));
    assertInside(root, configDir, 'Functions configDir');
    rejectLinkAncestors(root, configDir, 'Functions configDir');
    if (hostingPublic && (!isAbsoluteOutside(hostingPublic, sourceRoot) || !isAbsoluteOutside(sourceRoot, hostingPublic))) fail('PRIVATE_INPUT_LAYOUT', 'Functions source overlaps the Hosting public root.');
    if (hostingPublic && (!isAbsoluteOutside(hostingPublic, configDir) || !isAbsoluteOutside(configDir, hostingPublic))) fail('PRIVATE_INPUT_LAYOUT', 'Functions configDir overlaps the Hosting public root.');
    if (entry.configDir !== undefined) {
      if (typeof entry.configDir !== 'string' || !entry.configDir.trim()) fail('PRIVATE_INPUT_LAYOUT', 'Functions configDir must be a nonempty path.');
    }
    if (entry.additionalSources === undefined) continue;
    if (!Array.isArray(entry.additionalSources)) fail('PRIVATE_INPUT_LAYOUT', 'Functions additionalSources must be an array.');
    const privateNames = new Set(recognizedDotenvNames(project));
    for (const source of entry.additionalSources) {
      if (typeof source !== 'string' || !source.trim()) fail('PRIVATE_INPUT_LAYOUT', 'Functions additionalSources contains an invalid path.');
      const resolved = path.resolve(root, source);
      assertInside(root, resolved, 'Functions additional source');
      rejectLinkAncestors(root, resolved, 'Functions additional source');
      const basename = path.basename(source);
      const privateDotenv = privateNames.has(basename) || /^\.env(?:\.|$)/i.test(basename);
      if (privateDotenv || resolved === configDir) fail('PRIVATE_INPUT_LAYOUT', 'Functions additionalSources may not expose a private dotenv input or entire config directory.');
      if (hostingPublic && (!isAbsoluteOutside(hostingPublic, resolved) || !isAbsoluteOutside(resolved, hostingPublic))) {
        fail('PRIVATE_INPUT_LAYOUT', 'Functions additionalSources overlaps the Hosting public root.');
      }
    }
  }
  return functionsConfigDirectories(config, root);
}

function surfaceFiles(candidateRoot, profile, options = {}) {
  const files = new Map();
  const add = (relative) => {
    const normalized = normalizeRelativePath(relative, 'surface path');
    files.set(normalized, path.join(candidateRoot, ...normalized.split('/')));
  };
  const configuredPath = options.configPath
    ? normalizeRelativePath(path.relative(candidateRoot, path.resolve(options.configPath)).replace(/\\/g, '/'), 'Firebase config path')
    : 'firebase.json';
  for (const relative of [configuredPath, '.firebaserc', 'package.json', 'functions/package.json']) {
    if (fs.existsSync(path.join(candidateRoot, ...relative.split('/')))) add(relative);
  }
  const config = options.config || (fs.existsSync(path.join(candidateRoot, 'firebase.json')) ? readJson(path.join(candidateRoot, 'firebase.json'), 'candidate Firebase config') : {});
  const includePublic = profile === 'hosting' || profile === 'full';
  const includeFunctions = profile === 'functions' || profile === 'full';
  const scopes = [];
  const extraFiles = [];
  const rootRelative = (value, label) => {
    const absolute = path.resolve(candidateRoot, String(value || ''));
    if (isAbsoluteOutside(candidateRoot, absolute)) fail('SURFACE_SCOPE', `${label} must remain inside the release candidate.`);
    const relative = path.relative(candidateRoot, absolute).replace(/\\/g, '/');
    if (!relative) fail('SURFACE_SCOPE', `${label} may not select the candidate root itself.`);
    return normalizeRelativePath(relative, label);
  };
  if (profile === 'full') {
    for (const [value, label] of [[config.firestore?.rules, 'Firestore rules'], [config.firestore?.indexes, 'Firestore indexes'], [config.storage?.rules, 'Storage rules']]) {
      if (typeof value !== 'string') continue;
      const relative = rootRelative(value, label);
      const absolute = path.join(candidateRoot, ...relative.split('/'));
      if (!fs.existsSync(absolute)) fail('SURFACE_MISSING', `Configured ${label} file is missing: ${relative}.`);
      add(relative);
    }
  }
  if (includePublic) {
    const publicRoot = rootRelative(config.hosting?.public || 'public', 'Hosting public root');
    const hostingIgnore = Array.isArray(config.hosting?.ignore)
      ? config.hosting.ignore
      : ['firebase.json', '**/.*', '**/node_modules/**'];
    scopes.push({ rootName: publicRoot, ignoreRules: hostingIgnore });
  }
  if (includeFunctions) {
    const entries = functionsConfigEntries(config).length ? functionsConfigEntries(config) : [{ source: 'functions' }];
    for (const entry of entries) {
      const sourceRoot = rootRelative(entry && entry.source || 'functions', 'Functions source root');
      const functionIgnore = Array.isArray(entry && entry.ignore) ? entry.ignore : ['node_modules', '.git'];
      scopes.push({ rootName: sourceRoot, ignoreRules: functionIgnore });
      for (const extra of Array.isArray(entry && entry.additionalSources) ? entry.additionalSources : []) {
        const relative = rootRelative(extra, 'Functions additional source root');
        const absolute = path.join(candidateRoot, ...relative.split('/'));
        if (!fs.existsSync(absolute)) fail('SURFACE_MISSING', `Functions additional source is missing: ${relative}.`);
        if (fs.lstatSync(absolute).isFile()) extraFiles.push(relative);
        else if (fs.lstatSync(absolute).isDirectory()) scopes.push({ rootName: relative, ignoreRules: functionIgnore });
        else fail('SURFACE_INPUT', `Functions additional source is not a regular file or directory: ${relative}.`);
      }
    }
  }
  const excludedDotenv = new Set(options.privateDotenvPaths || []);
  for (const scope of scopes) {
    for (const file of listFiles(path.join(candidateRoot, scope.rootName), { ignoreRules: scope.ignoreRules })) {
      const relative = `${scope.rootName}/${file.path}`;
      if (excludedDotenv.has(relative)) continue;
      add(relative);
    }
  }
  for (const relative of extraFiles) {
    const target = safeTargetPath(candidateRoot, relative, 'Functions additional source').absolute;
    if (!excludedDotenv.has(relative)) add(relative);
  }
  if (options.additionalPaths) for (const relative of options.additionalPaths) {
    const target = safeTargetPath(candidateRoot, relative, 'surface path');
    if (fs.existsSync(target.absolute) && !excludedDotenv.has(target.normalized)) add(target.normalized);
  }
  return [...files.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([relative, absolute]) => ({ relative, absolute }));
}

function privateDotenvPaths(ctx) {
  if (!ctx.project || !ctx.profileConfig.products.includes('functions')) return [];
  const configured = functionsConfigDirectories(ctx.config || {}, ctx.candidateRoot);
  const directories = configured.length ? configured : [path.join(ctx.candidateRoot, 'functions')];
  const names = recognizedDotenvNames(ctx.project);
  return directories.flatMap((directory) => {
    const relative = path.relative(ctx.candidateRoot, directory).replace(/\\/g, '/');
    return names.map((name) => joinRelativePath(relative, name));
  });
}

function inventorySurface(ctx) {
  const records = [];
  const cache = ctx && typeof ctx === 'object' ? (ctx._surfaceHashCache = ctx._surfaceHashCache || new Map()) : null;
  if (cache && cache.size === 0 && Array.isArray(ctx.assets)) {
    for (const asset of ctx.assets) {
      if (asset.path && asset.sha256 && asset.mtimeMs !== undefined) {
        cache.set(asset.path, { size: asset.size, mtimeMs: asset.mtimeMs, sha256: asset.sha256 });
      }
    }
  }
  for (const item of surfaceFiles(ctx.candidateRoot, ctx.profile, {
    additionalPaths: ctx.surfacePaths,
    config: ctx.config,
    configPath: ctx.candidateConfigPath,
    privateDotenvPaths: privateDotenvPaths(ctx)
  })) {
    if (!fs.existsSync(item.absolute)) fail('SURFACE_MISSING', `Selected publish file is missing: ${item.relative}.`);
    const stat = fs.lstatSync(item.absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) fail('SURFACE_INPUT', `Selected publish file is not a regular file: ${item.relative}.`);
    const record = { path: item.relative, size: stat.size, mode: stat.mode & 0o777 };
    const cached = cache ? cache.get(item.relative) : null;
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      record.sha256 = cached.sha256;
      const metrics = ctx?.metrics || ACTIVE_METRICS;
      if (metrics && typeof metrics.increment === 'function') metrics.increment('cacheHits');
    } else {
      record.sha256 = sha256File(item.absolute);
      if (cache) cache.set(item.relative, { size: stat.size, mtimeMs: stat.mtimeMs, sha256: record.sha256 });
    }
    if (stat.size <= 512) {
      const probe = fs.readFileSync(item.absolute);
      if (probe.toString('utf8').includes('version https://git-lfs.github.com/spec/v1')) fail('LFS_POINTER', `Selected publish file is an unresolved Git LFS pointer: ${item.relative}.`);
    }
    records.push(record);
  }
  const totalCandidateBytes = records.reduce((sum, r) => sum + r.size, 0);
  if (ctx) ctx.candidateBytes = totalCandidateBytes;
  const metrics = ctx?.metrics || ACTIVE_METRICS;
  if (metrics) metrics.counters.candidateBytes = totalCandidateBytes;
  return records;
}

const VERSION_MUTABLE_PATHS = Object.freeze(new Set([
  'public/index.html',
  'public/crm-admin.html',
  'public/crm-entrance-test-result.html',
  'tests/crm/crm-shell-static.test.js',
  'GEMINI.md'
]));
const CONNECTED_SPEECH_MUTABLE_PATHS = Object.freeze(new Set([
  'public/database/RA/connected-speech-index.json',
  'public/database/RA/connected-speech-featured-prompts.json',
  'functions/src/data/read-aloud-connected-speech-index.json'
]));
const SEGMENTATION_MUTABLE_PATHS = Object.freeze(new Set([
  'functions/src/data/segmentation-study-v2.json'
]));

function allowedGeneratedPaths(ctx) {
  const allowed = new Set();
  if (ctx.profileConfig.preparation.includes('version')) for (const item of VERSION_MUTABLE_PATHS) allowed.add(item);
  if (ctx.profileConfig.preparation.includes('connectedSpeech')) for (const item of CONNECTED_SPEECH_MUTABLE_PATHS) allowed.add(item);
  if (ctx.profileConfig.preparation.includes('segmentationV2')) for (const item of SEGMENTATION_MUTABLE_PATHS) allowed.add(item);
  if (ctx.privateConfigDelta?.added?.length && ctx.configPathRelative) allowed.add(ctx.configPathRelative);
  const policyPath = path.join(ctx.candidateRoot, 'scripts', 'structure', 'policy.json');
  if (fs.existsSync(policyPath)) {
    const policy = readJson(policyPath, 'structure policy');
    if (!policy || typeof policy !== 'object' || !Array.isArray(policy.generatedFamilies)) fail('GENERATED_SCHEMA', 'Selected structure policy has no valid generatedFamilies array.');
    for (const family of policy.generatedFamilies) {
      if (!family || family.id === 'segmentation-study-v1' || (family.id === 'segmentation-study-v2' && !ctx.profileConfig.preparation.includes('segmentationV2'))) continue;
      for (const pair of Array.isArray(family.comparisonPairs) ? family.comparisonPairs : []) {
        for (const output of Array.isArray(pair?.outputs) ? pair.outputs : []) if (typeof output === 'string') allowed.add(normalizeRelativePath(output, 'generated output'));
      }
      for (const output of Array.isArray(family.requiredOutputs) ? family.requiredOutputs : []) if (typeof output === 'string') allowed.add(normalizeRelativePath(output, 'generated required output'));
    }
  }
  return allowed;
}

function surfacePathSet(ctx) {
  return new Set(surfaceFiles(ctx.candidateRoot, ctx.profile, {
    additionalPaths: ctx.surfacePaths,
    config: ctx.config,
    configPath: ctx.candidateConfigPath,
    privateDotenvPaths: privateDotenvPaths(ctx)
  }).map((item) => item.relative));
}

function verifyUnexpectedSurfaceFiles(ctx) {
  if (!ctx.surfaceBeforePreparation) return { checked: false };
  const allowed = allowedGeneratedPaths(ctx);
  const unexpected = [...surfacePathSet(ctx)].filter((relative) =>
    !ctx.surfaceBeforePreparation.has(relative) && !allowed.has(relative) && !isDependencyInstallPath(ctx, relative));
  if (unexpected.length) fail('SURFACE_EXTRA', `Preparation created an undeclared publish file: ${unexpected.slice(0, 12).join(', ')}${unexpected.length > 12 ? '…' : ''}.`);
  return { checked: true };
}

function isDependencyInstallPath(ctx, relative) {
  const normalized = normalizeRelativePath(relative, 'surface path');
  if (normalized === 'node_modules' || normalized.startsWith('node_modules/')) return true;
  const roots = Array.isArray(ctx.functionsSourceDirs) && ctx.functionsSourceDirs.length
    ? ctx.functionsSourceDirs
    : [path.join(ctx.candidateRoot, 'functions')];
  return roots.some((root) => {
    const rootRelative = path.relative(ctx.candidateRoot, root).replace(/\\/g, '/');
    const prefix = joinRelativePath(rootRelative, 'node_modules');
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  });
}

function validateCandidateConfigDelta(ctx) {
  if (!ctx.configPathRelative || !ctx.sourceConfigSnapshot) return { checked: false };
  const actual = readJson(ctx.candidateConfigPath, 'candidate Firebase config');
  const expected = ctx.profileConfig.products.includes('functions')
    ? addFunctionsDotenvIgnore(ctx.sourceConfigSnapshot, ctx.project).config
    : ctx.sourceConfigSnapshot;
  if (JSON.stringify(canonicalJson(actual)) !== JSON.stringify(canonicalJson(expected))) {
    fail('CONFIG_CHANGED', 'Selected Firebase configuration changed outside the approved private dotenv ignore delta.');
  }
  return { checked: true };
}

function verifyTrackedSource(ctx) {
  if (!Array.isArray(ctx.trackedInventory) || !ctx.trackedInventory.length) return { checked: 0 };
  const allowed = allowedGeneratedPaths(ctx);
  const failures = [];
  for (const item of ctx.trackedInventory) {
    const relative = String(item.path).replace(/\\/g, '/');
    if (relative === 'node_modules' || relative.startsWith('node_modules/') || relative.startsWith('functions/node_modules/')) continue;
    const candidate = path.join(ctx.candidateRoot, ...relative.split('/'));
    if (allowed.has(relative)) {
      if (!fs.existsSync(candidate) || !fs.lstatSync(candidate).isFile()) failures.push(relative);
      continue;
    }
    if (!fs.existsSync(candidate) || !fs.lstatSync(candidate).isFile()) {
      failures.push(relative);
      continue;
    }
    if (process.platform !== 'win32') {
      const candidateMode = fs.statSync(candidate).mode & 0o777;
      const expectedMode = parseInt(String(item.mode || '100644'), 8) & 0o777;
      if (candidateMode !== expectedMode) {
        failures.push(relative);
        continue;
      }
    }
    const actual = gitBlobSha1(candidate);
    if (String(item.oid || item.sha1 || '').toLowerCase() === actual) continue;
    const pointer = ctx.lfsPointers && ctx.lfsPointers.get(relative);
    const stat = fs.statSync(candidate);
    if (!pointer || pointer.size !== stat.size || sha256File(candidate) !== pointer.sha256) failures.push(relative);
  }
  if (failures.length) fail('SOURCE_CHANGED', `Selected source files changed in the candidate: ${failures.slice(0, 12).join(', ')}${failures.length > 12 ? '…' : ''}.`, failures);
  return { checked: ctx.trackedInventory.length };
}

function compareInventory(expected, actual) {
  const actualMap = new Map((actual || []).map((item) => [item.path, item]));
  const expectedMap = new Map((expected || []).map((item) => [item.path, item]));
  const differences = [];
  for (const [name, item] of expectedMap) {
    const current = actualMap.get(name);
    if (!current || current.size !== item.size || current.mode !== item.mode || (item.sha256 && current.sha256 !== item.sha256)) differences.push(name);
  }
  for (const name of actualMap.keys()) if (!expectedMap.has(name)) differences.push(name);
  return differences.sort();
}

function validateGeneratedFamilies(ctx) {
  const policyPath = path.join(ctx.candidateRoot, 'scripts', 'structure', 'policy.json');
  if (!fs.existsSync(policyPath)) return [];
  const policy = readJson(policyPath, 'structure policy');
  if (!policy || typeof policy !== 'object' || !Array.isArray(policy.generatedFamilies)) fail('GENERATED_SCHEMA', 'Structure policy generatedFamilies must be an array.');
  const families = policy.generatedFamilies;
  const checked = [];
  for (const family of families) {
    if (!family || typeof family !== 'object' || (family.comparisonPairs !== undefined && !Array.isArray(family.comparisonPairs)) || (family.requiredOutputs !== undefined && !Array.isArray(family.requiredOutputs))) {
      fail('GENERATED_SCHEMA', 'Generated family policy entry is invalid.');
    }
    // V1 is a historical comparison artifact.  The release route owns only
    // the explicit V2 manifest preparation; never expand a release into a V1
    // generator/validation route by accident.
    if (family.id === 'segmentation-study-v1') continue;
    if (family.id === 'segmentation-study-v2' && !ctx.profileConfig.preparation.includes('segmentationV2')) continue;
    const pairs = Array.isArray(family.comparisonPairs) ? family.comparisonPairs : [];
    for (const pair of pairs) {
      if (!pair || typeof pair !== 'object' || pair.comparisonMode !== 'byte-identical' || typeof pair.source !== 'string' || !Array.isArray(pair.outputs)) {
        fail('GENERATED_SCHEMA', `Generated family ${family.id || 'unknown'} has an invalid comparison pair.`);
      }
      const source = safeTargetPath(ctx.candidateRoot, pair.source, 'generated source').absolute;
      if (!fs.existsSync(source)) fail('GENERATED_MISSING', `Generated source is missing: ${pair.source}.`);
      for (const output of pair.outputs || []) {
        const target = safeTargetPath(ctx.candidateRoot, output, 'generated output').absolute;
        if (!fs.existsSync(target)) fail('GENERATED_MISSING', `Generated output is missing: ${output}.`);
        if (!Buffer.from(fs.readFileSync(source)).equals(Buffer.from(fs.readFileSync(target)))) fail('GENERATED_MISMATCH', `Generated output differs from its source: ${output}.`);
        checked.push(output);
      }
    }
    const identity = family.identity;
    if (identity !== undefined && (!identity || typeof identity !== 'object' || typeof identity.source !== 'string' || typeof identity.entriesPath !== 'string' || !Number.isInteger(identity.count) || identity.count < 0)) {
      fail('GENERATED_SCHEMA', `Generated family ${family.id || 'unknown'} has an invalid identity declaration.`);
    }
    if (identity && identity.source && identity.entriesPath && Number.isInteger(identity.count)) {
      const source = safeTargetPath(ctx.candidateRoot, identity.source, 'generated identity source').absolute;
      if (!fs.existsSync(source)) fail('GENERATED_MISSING', `Generated identity source is missing: ${identity.source}.`);
      const document = readJson(source, `generated family ${family.id}`);
      const entries = document[identity.entriesPath];
      if (!Array.isArray(entries) || entries.length !== identity.count) fail('GENERATED_IDENTITY', `Generated family ${family.id} has an invalid entry count.`);
      if (identity.manifestHashField && identity.canonicalManifestSha256) {
        const field = identity.manifestHashField;
        const copy = { ...document };
        delete copy[field];
        if (sha256Bytes(JSON.stringify(canonicalJson(copy))) !== identity.canonicalManifestSha256) fail('GENERATED_IDENTITY', `Generated family ${family.id} has an invalid canonical manifest hash.`);
      }
      if (identity.manifestFields) {
        const workbook = safeTargetPath(ctx.candidateRoot, 'public/database/RA/RA.xlsx', 'connected-speech workbook').absolute;
        const audio = safeTargetPath(ctx.candidateRoot, 'public/database/RA/Voice/audio/manifest.json', 'connected-speech audio manifest').absolute;
        if (!fs.existsSync(workbook) || !fs.existsSync(audio)) fail('GENERATED_INPUT_MISSING', 'Connected-speech canonical workbook or audio manifest is missing.');
        if (identity.manifestFields.sourceWorkbookSha256 && sha256File(workbook) !== identity.manifestFields.sourceWorkbookSha256) fail('GENERATED_INPUT_HASH', 'Connected-speech workbook identity does not match policy.');
        if (identity.manifestFields.audioManifestSha256 && sha256File(audio) !== identity.manifestFields.audioManifestSha256) fail('GENERATED_INPUT_HASH', 'Connected-speech audio manifest identity does not match policy.');
        const generatedWorkbookSha = document.sourceWorkbookSha256 || document.inputs?.workbookSha256;
        const generatedAudioSha = document.audioManifestSha256 || document.inputs?.audioManifestSha256;
        if (identity.manifestFields.sourceWorkbookSha256 && generatedWorkbookSha !== identity.manifestFields.sourceWorkbookSha256) fail('GENERATED_IDENTITY', `Generated family ${family.id} has an invalid workbook identity.`);
        if (identity.manifestFields.audioManifestSha256 && generatedAudioSha !== identity.manifestFields.audioManifestSha256) fail('GENERATED_IDENTITY', `Generated family ${family.id} has an invalid audio-manifest identity.`);
      }
      if (ctx.committerEpoch && document.generatedAt && document.generatedAt !== new Date(ctx.committerEpoch * 1000).toISOString()) fail('GENERATED_TIMESTAMP', `Generated family ${family.id} timestamp is not reproducible from the selected commit.`);
    }
    for (const output of Array.isArray(family.requiredOutputs) ? family.requiredOutputs : []) {
      const required = safeTargetPath(ctx.candidateRoot, output, 'generated required output').absolute;
      if (!fs.existsSync(required) || !fs.lstatSync(required).isFile()) fail('GENERATED_MISSING', `Generated required output is missing: ${output}.`);
    }
    if (family.id === 'read-aloud-connected-speech-index') {
      const coverageDir = path.join(ctx.externalRoot, 'connected-speech-coverage');
      const sourceDocument = readJson(safeTargetPath(ctx.candidateRoot, 'public/database/RA/connected-speech-index.json', 'connected-speech index').absolute, 'connected-speech index');
      const featuredPath = safeTargetPath(ctx.candidateRoot, 'public/database/RA/connected-speech-featured-prompts.json', 'connected-speech featured prompts').absolute;
      const featured = readJson(featuredPath, 'connected-speech featured prompts');
      if (featured.version !== '1' || featured.updatedAt !== sourceDocument.generatedAt) fail('GENERATED_IDENTITY', 'Connected-speech featured metadata is not bound to the generated index.');
      for (const name of ['coverage.json', 'summary.md']) {
        const output = path.join(coverageDir, name);
        if (!fs.existsSync(output) || !fs.lstatSync(output).isFile()) fail('GENERATED_MISSING', `Connected-speech coverage output is missing: ${name}.`);
        if (name === 'coverage.json') {
          const coverage = readJson(output, 'connected-speech coverage');
          if (coverage.generatedAt !== sourceDocument.generatedAt) fail('GENERATED_TIMESTAMP', 'Connected-speech coverage timestamp does not match its index.');
        } else if (!fs.readFileSync(output, 'utf8').includes(String(sourceDocument.generatedAt || ''))) {
          fail('GENERATED_TIMESTAMP', 'Connected-speech coverage summary is not bound to its index.');
        }
      }
    }
  }
  return checked;
}

function comparePrivateInputInventory(ctx, expected) {
  if (!expected) fail('PRIVATE_INPUT_CHANGED', 'Release receipt has no private input inventory.');
  if (!ctx.profileConfig.products.includes('functions')) {
    if (expected.length) fail('PRIVATE_INPUT_CHANGED', 'Hosting-only receipt unexpectedly contains Functions private inputs.');
    return { ok: true };
  }
  const expectedByPath = new Map();
  for (const item of expected) {
    const present = item && item.present !== false;
    if (!item || typeof item.path !== 'string' || typeof present !== 'boolean' ||
        (present && (!Number.isSafeInteger(item.size) || item.size < 0 || !/^[0-9a-f]{64}$/i.test(String(item.sha256 || '')))) ||
        (!present && (item.size !== null || item.sha256 !== null))) {
      fail('PRIVATE_INPUT_CHANGED', 'Release receipt private input inventory is invalid.');
    }
    const relative = normalizeRelativePath(item.path, 'private input path');
    if (expectedByPath.has(relative)) fail('PRIVATE_INPUT_CHANGED', 'Release receipt contains duplicate private input paths.');
    expectedByPath.set(relative, { ...item, path: relative, present, sha256: present ? String(item.sha256).toLowerCase() : null });
  }
  const configDirs = functionsConfigDirectories(ctx.config || {}, ctx.candidateRoot);
  const directories = configDirs.length ? configDirs : [path.join(ctx.candidateRoot, 'functions')];
  const observed = new Set();
  for (const directory of directories) {
    const relativeDirectory = path.relative(ctx.candidateRoot, directory).replace(/\\/g, '/');
    for (const name of recognizedDotenvNames(ctx.project || {})) {
      const relative = joinRelativePath(relativeDirectory, name);
      const target = safeTargetPath(ctx.candidateRoot, relative, 'private input path').absolute;
      const exists = fs.existsSync(target);
      const expectedItem = expectedByPath.get(relative);
      if (exists) {
        const stat = fs.lstatSync(target);
        if (!stat.isFile() || stat.isSymbolicLink()) fail('PRIVATE_INPUT_CHANGED', `Private input is not a regular file: ${relative}.`);
        if (!expectedItem || !expectedItem.present || stat.size !== expectedItem.size || sha256File(target) !== expectedItem.sha256) fail('PRIVATE_INPUT_CHANGED', `Private input changed: ${relative}.`);
        observed.add(relative);
      } else if (!expectedItem || expectedItem.present) fail('PRIVATE_INPUT_CHANGED', `Private input is missing: ${relative}.`);
      else observed.add(relative);
    }
  }
  for (const relative of expectedByPath.keys()) if (!observed.has(relative)) fail('PRIVATE_INPUT_CHANGED', `Private input is outside the selected Functions config roots: ${relative}.`);
  return { ok: true };
}

function comparePrivateInputs(ctx) {
  const expected = ctx.receipt && ctx.receipt.privateInputs && Array.isArray(ctx.receipt.privateInputs.dotenv)
    ? ctx.receipt.privateInputs.dotenv
    : null;
  return comparePrivateInputInventory(ctx, expected);
}

function capturePrivateInputInventory(ctx) {
  if (!ctx.profileConfig.products.includes('functions')) return [];
  const names = recognizedDotenvNames(ctx.project || {});
  const directories = functionsConfigDirectories(ctx.config || {}, ctx.candidateRoot);
  const roots = directories.length ? directories : [path.join(ctx.candidateRoot, 'functions')];
  const result = [];
  const seen = new Set();
  for (const directory of roots) {
    const relativeDirectory = path.relative(ctx.candidateRoot, directory).replace(/\\/g, '/');
    for (const name of names) {
      const relative = normalizeRelativePath(joinRelativePath(relativeDirectory, name), 'private input path');
      if (seen.has(relative)) continue;
      seen.add(relative);
      const filePath = safeTargetPath(ctx.candidateRoot, relative, 'private input path').absolute;
      if (!fs.existsSync(filePath)) {
        result.push({ path: relative, present: false, size: null, sha256: null });
        continue;
      }
      const stat = fs.lstatSync(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) fail('PRIVATE_INPUT_CHANGED', `Private input is not a regular file: ${relative}.`);
      result.push({ path: relative, present: true, size: stat.size, sha256: sha256File(filePath) });
    }
  }
  return result;
}

function versionDateToken(epoch) {
  const vn = new Date(Number(epoch) * 1000 + (7 * 60 * 60 * 1000));
  return `${vn.getUTCFullYear()}${String(vn.getUTCMonth() + 1).padStart(2, '0')}${String(vn.getUTCDate()).padStart(2, '0')}`;
}

function validateVersionOracle(ctx) {
  const packagePath = path.join(ctx.candidateRoot, 'package.json');
  if (!fs.existsSync(packagePath)) fail('VERSION_INPUT', 'Candidate package.json is missing.');
  const packageJson = readJson(packagePath, 'candidate package.json');
  const version = String(packageJson.version || '').trim();
  if (!version) fail('VERSION_INPUT', 'Candidate package version is missing.');
  const dateToken = versionDateToken(ctx.committerEpoch);
  const crmVersion = `${dateToken}-v${version}`;
  const html = (relative) => {
    const filePath = path.join(ctx.candidateRoot, ...relative.split('/'));
    if (!fs.existsSync(filePath)) fail('VERSION_OUTPUT', `Version output is missing: ${relative}.`);
    return fs.readFileSync(filePath, 'utf8');
  };
  const index = html('public/index.html');
  const indicator = [...index.matchAll(/id=["']version-indicator["'][^>]*>\s*V([^<\s]+)\s*</gi)];
  const readAloud = [...index.matchAll(/\bsrc=["']\/read-aloud-mode\.js\?v=([^"'&\s]+)["']/gi)];
  if (indicator.length !== 1 || indicator[0][1] !== version || readAloud.length !== 1 || readAloud[0][1] !== version) {
    fail('VERSION_OUTPUT', 'public/index.html does not contain exactly one current version indicator and read-aloud script token.');
  }
  for (const relative of ['public/crm-admin.html', 'public/crm-entrance-test-result.html']) {
    const tokens = [...html(relative).matchAll(/(?:^|[^0-9])(\d{8}-v\d+\.\d+\.\d+)(?=[^0-9]|$)/g)].map((match) => match[1]);
    if (!tokens.length || tokens.some((token) => token !== crmVersion)) fail('VERSION_OUTPUT', `${relative} contains a stale or missing Vietnam-date version token.`);
  }
  return { version, crmVersion };
}

function buildPreparationCommands(ctx) {
  const node = ctx.node || process.execPath;
  const timestamp = new Date(ctx.committerEpoch * 1000).toISOString();
  const commands = buildDependencyCommands(ctx);
  if (ctx.profileConfig.preparation.includes('version')) commands.push({
    command: node,
    args: ['scripts/sync-version.js', '--timestamp', timestamp],
    cwd: ctx.candidateRoot,
    kind: 'version'
  });
  if (ctx.profileConfig.preparation.includes('connectedSpeech')) commands.push({
    command: node,
    args: [
      'scripts/read-aloud/build-connected-speech-index.js',
      '--timestamp', timestamp,
      '--workbook', path.join(ctx.candidateRoot, 'public', 'database', 'RA', 'RA.xlsx'),
      '--audio-manifest', path.join(ctx.candidateRoot, 'public', 'database', 'RA', 'Voice', 'audio', 'manifest.json'),
      '--public-index', path.join(ctx.candidateRoot, 'public', 'database', 'RA', 'connected-speech-index.json'),
      '--featured-prompts', path.join(ctx.candidateRoot, 'public', 'database', 'RA', 'connected-speech-featured-prompts.json'),
      '--functions-index', path.join(ctx.candidateRoot, 'functions', 'src', 'data', 'read-aloud-connected-speech-index.json'),
      '--coverage-dir', path.join(ctx.externalRoot, 'connected-speech-coverage')
    ],
    cwd: ctx.candidateRoot,
    kind: 'connectedSpeech'
  });
  if (ctx.profileConfig.preparation.includes('segmentationV2')) commands.push({
    command: node,
    args: [
      'scripts/segmentation-study/sync-manifest.js',
      '--study-version', 'v2',
      '--source', path.join(ctx.candidateRoot, 'scripts', 'data', 'segmentation-study-v2.json'),
      '--destination', path.join(ctx.candidateRoot, 'functions', 'src', 'data', 'segmentation-study-v2.json')
    ],
    cwd: ctx.candidateRoot,
    kind: 'segmentationV2'
  });
  return commands;
}

function resolveNpmInvocation(ctx) {
  if (ctx.npmCli) {
    const entrypoint = path.resolve(ctx.npmCli);
    if (!path.isAbsolute(ctx.npmCli) || !fs.existsSync(entrypoint)) fail('NPM_CLI_UNSUPPORTED', 'npm CLI entrypoint must be an existing absolute path.');
    return { command: process.execPath, prefix: [entrypoint] };
  }
  const configured = process.env.npm_execpath;
  if (configured && path.isAbsolute(configured) && fs.existsSync(configured)) return { command: process.execPath, prefix: [fs.realpathSync(configured)] };
  const bundled = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(bundled)) return { command: process.execPath, prefix: [bundled] };
  return { command: 'npm', prefix: [] };
}

function buildDependencyCommands(ctx) {
  const invocation = resolveNpmInvocation(ctx);
  const commands = [];
  if (fs.existsSync(path.join(ctx.candidateRoot, 'package-lock.json'))) commands.push({
    command: invocation.command,
    args: [...invocation.prefix, 'ci', '--prefer-offline', '--no-audit', '--no-fund'],
    cwd: ctx.candidateRoot,
    kind: 'npm-root'
  });
  if (ctx.profileConfig.products.includes('functions')) {
    const configured = Array.isArray(ctx.functionsSourceDirs) && ctx.functionsSourceDirs.length
      ? ctx.functionsSourceDirs
      : [path.join(ctx.candidateRoot, 'functions')];
    for (const source of configured) if (fs.existsSync(path.join(source, 'package-lock.json'))) commands.push({
      command: invocation.command,
      args: [...invocation.prefix, 'ci', '--prefer-offline', '--no-audit', '--no-fund'],
      cwd: source,
      kind: 'npm-functions'
    });
  }
  if (commands.length) commands.unshift({
    command: invocation.command,
    args: [...invocation.prefix, '--version'],
    cwd: ctx.candidateRoot,
    kind: 'npm-version'
  });
  return commands;
}

function invokeContextCommand(ctx, spec) {
  const metrics = ctx.metrics || ACTIVE_METRICS;
  if (typeof ctx.executor === 'function') return commandResult(spec.command, spec.args, { cwd: spec.cwd, env: ctx.env, kind: spec.kind, executor: ctx.executor, metrics });
  return runCommand(spec.command, spec.args, { cwd: spec.cwd, env: ctx.env, kind: spec.kind, metrics });
}

function prepareOnce(ctx) {
  if (ctx.sealed) fail('POST_SEAL_WRITE', 'Release preparation is forbidden after sealing.');
  if (ctx.prepared) fail('PREPARE_REPEATED', 'Release preparation may run only once.');
  ctx.prepared = true;
  const commands = buildPreparationCommands(ctx);
  if (typeof ctx.prepare === 'function') {
    const result = ctx.prepare({ ...ctx, commands });
    return { commands, result };
  }
  const metrics = ctx.metrics || ACTIVE_METRICS;
  for (const spec of commands) {
    const phaseName = spec.kind && spec.kind.startsWith('npm-') ? 'npm-installation' : `generator-${spec.kind}`;
    if (metrics) metrics.startPhase(phaseName);
    const result = invokeContextCommand(ctx, spec);
    if (metrics) metrics.endPhase(phaseName);
    if (result && result.status !== 0) fail('PREPARE_FAILED', `${spec.kind} preparation failed.`);
    if (spec.kind === 'npm-version') ctx.toolVersions = { ...(ctx.toolVersions || {}), npm: String(result && result.stdout || '').trim() };
  }
  return { commands };
}

function receiptPath(ctx) {
  return path.join(ctx.externalRoot, `firebase-release-${ctx.profile}-${ctx.sourceSha.slice(0, 12)}-${ctx.runId || `${process.pid}-${Date.now()}`}.receipt.json`);
}

function verifyAndSeal(ctx) {
  if (ctx.sealed) fail('SEALED', 'Release candidate is already sealed.');
  validateCandidateConfigDelta(ctx);
  verifyUnexpectedSurfaceFiles(ctx);
  verifyProvisionedAssets(ctx);
  comparePrivateInputInventory(ctx, ctx.privateInputSnapshot);
  const metrics = ctx.metrics || ACTIVE_METRICS;
  if (metrics) metrics.startPhase('tracked-source-validation');
  verifyTrackedSource(ctx);
  if (ctx.profileConfig.preparation.includes('version')) ctx.versionOracle = validateVersionOracle(ctx);
  validateGeneratedFamilies(ctx);
  if (metrics) metrics.endPhase('tracked-source-validation');

  if (metrics) metrics.startPhase('app-inventory-sealing');
  const inventory = typeof ctx.inventory === 'function' ? ctx.inventory(ctx) : inventorySurface(ctx);
  const receipt = {
    schemaVersion: 1,
    profile: ctx.profile,
    sourceSha: ctx.sourceSha,
    committerEpoch: ctx.committerEpoch,
    project: { id: ctx.project.id, alias: ctx.project.alias, configPath: path.relative(ctx.candidateRoot, ctx.candidateConfigPath).replace(/\\/g, '/') },
    candidateRoot: ctx.candidateRoot,
    surface: inventory,
    prepared: ctx.preparation || null,
    tools: {
      node: ctx.node === process.execPath ? process.version : null,
      npm: ctx.toolVersions?.npm || null,
      firebase: ctx.firebaseCli?.version || null
    },
    privateInputs: {
      dotenv: ctx.privateInputSnapshot || capturePrivateInputInventory(ctx),
      functionsIgnoreAdded: ctx.privateConfigDelta?.added || []
    },
    context: {
      marker: 'BEL_FIREBASE_RELEASE_CONTEXT',
      profile: ctx.profile,
      sourceSha: ctx.sourceSha,
      projectId: ctx.project.id,
      projectAlias: ctx.project.alias || null,
      configPath: path.relative(ctx.candidateRoot, ctx.candidateConfigPath).replace(/\\/g, '/'),
      candidateRoot: ctx.candidateRoot,
      surfaceSha256: sha256Bytes(JSON.stringify(inventory))
    },
    createdAt: new Date().toISOString()
  };
  fs.mkdirSync(ctx.externalRoot, { recursive: true });
  const filePath = receiptPath(ctx);
  fs.writeFileSync(filePath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  try { fs.chmodSync(filePath, 0o600); } catch (_) { /* Windows ACLs govern the external directory. */ }
  ctx.receipt = receipt;
  ctx.receiptPath = filePath;
  ctx.sealed = true;
  if (metrics) metrics.endPhase('app-inventory-sealing');
  return receipt;
}

function compareSealedSurface(ctx) {
  if (!ctx.sealed || !ctx.receipt) fail('NOT_SEALED', 'Release candidate must be sealed before comparison.');
  comparePrivateInputs(ctx);
  const inventory = typeof ctx.inventory === 'function' ? ctx.inventory(ctx) : inventorySurface(ctx);
  const differences = compareInventory(ctx.receipt.surface, inventory);
  if (differences.length) fail('SURFACE_CHANGED', `Verified publish surface changed: ${differences.join(', ')}.`);
  return { ok: true, inventory };
}

function buildHookEnvironment(ctx) {
  return {
    BEL_FIREBASE_RELEASE_CONTEXT: '1',
    BEL_FIREBASE_RELEASE_RECEIPT: ctx.receiptPath,
    BEL_FIREBASE_RELEASE_PROFILE: ctx.profile,
    BEL_FIREBASE_RELEASE_CANDIDATE_ROOT: ctx.candidateRoot,
    BEL_FIREBASE_RELEASE_SOURCE_SHA: ctx.sourceSha,
    BEL_FIREBASE_RELEASE_PROJECT_ID: ctx.project.id,
    BEL_FIREBASE_RELEASE_PROJECT_ALIAS: ctx.project.alias || '',
    BEL_FIREBASE_RELEASE_CONFIG_PATH: ctx.candidateConfigPath,
    BEL_FIREBASE_RELEASE_SURFACE_SHA256: sha256Bytes(JSON.stringify(ctx.receipt.surface))
  };
}

function inspectHookContext(env = process.env) {
  const present = HOOK_CONTEXT_FIELDS.filter((name) => Object.prototype.hasOwnProperty.call(env, name));
  if (!present.length) return { state: 'absent', present: [] };
  const missing = HOOK_REQUIRED_FIELDS.filter((name) => !String(env[name] || '').trim());
  if (!Object.prototype.hasOwnProperty.call(env, 'BEL_FIREBASE_RELEASE_PROJECT_ALIAS')) {
    missing.push('BEL_FIREBASE_RELEASE_PROJECT_ALIAS');
  }
  if (missing.length) return { state: 'invalid', present, missing, message: `incomplete release context: ${missing.join(', ')}` };
  if (String(env.BEL_FIREBASE_RELEASE_CONTEXT) !== '1') return { state: 'invalid', present, message: 'release context marker is invalid' };
  const profile = String(env.BEL_FIREBASE_RELEASE_PROFILE);
  if (!PROFILE_CONFIG[profile]) return { state: 'invalid', present, message: `unsupported release profile: ${profile}` };
  if (!SHA_RE.test(String(env.BEL_FIREBASE_RELEASE_SOURCE_SHA))) return { state: 'invalid', present, message: 'release context source SHA is invalid' };
  return { state: 'valid', present, profile };
}

function validateHookReceipt(env, receipt, state, product) {
  if (!receipt || receipt.schemaVersion !== 1 || !PROFILE_CONFIG[state.profile]) {
    fail('INVALID_HOOK_CONTEXT', 'release receipt schema is unsupported.');
  }
  if (typeof receipt.candidateRoot !== 'string' || !receipt.candidateRoot.trim()) {
    fail('INVALID_HOOK_CONTEXT', 'release receipt has no candidate identity.');
  }
  const sourceSha = commitSha(receipt.sourceSha, 'receipt source SHA');
  if (sourceSha !== String(env.BEL_FIREBASE_RELEASE_SOURCE_SHA).toLowerCase()) {
    fail('INVALID_HOOK_CONTEXT', 'release context source identity does not match its receipt.');
  }
  if (receipt.profile !== state.profile || !PROFILE_CONFIG[state.profile].products.includes(product)) {
    fail('INVALID_HOOK_CONTEXT', 'release context profile does not match the Firebase product.');
  }
  const receiptRoot = path.resolve(String(receipt.candidateRoot || ''));
  const contextRoot = path.resolve(String(env.BEL_FIREBASE_RELEASE_CANDIDATE_ROOT || ''));
  if (!receiptRoot || receiptRoot !== contextRoot || !fs.existsSync(receiptRoot) || !fs.lstatSync(receiptRoot).isDirectory()) {
    fail('INVALID_HOOK_CONTEXT', 'release candidate identity does not match its receipt.');
  }
  rejectLinkAncestors(receiptRoot, receiptRoot, 'release candidate root');
  if (!receipt.project || typeof receipt.project !== 'object') fail('INVALID_HOOK_CONTEXT', 'release receipt has no project identity.');
  const projectId = normalizeProjectId(receipt.project.id);
  if (projectId !== normalizeProjectId(env.BEL_FIREBASE_RELEASE_PROJECT_ID)) fail('INVALID_HOOK_CONTEXT', 'release project ID does not match its receipt.');
  const receiptAlias = receipt.project.alias || null;
  const contextAlias = env.BEL_FIREBASE_RELEASE_PROJECT_ALIAS || null;
  if (receiptAlias !== contextAlias) fail('INVALID_HOOK_CONTEXT', 'release project alias does not match its receipt.');
  const relativeConfig = normalizeRelativePath(receipt.project.configPath, 'receipt config path');
  const receiptConfig = rejectLinkAncestors(receiptRoot, path.join(receiptRoot, ...relativeConfig.split('/')), 'receipt Firebase config');
  const contextConfig = path.resolve(String(env.BEL_FIREBASE_RELEASE_CONFIG_PATH || ''));
  if (receiptConfig !== contextConfig || !fs.existsSync(receiptConfig) || !fs.lstatSync(receiptConfig).isFile()) {
    fail('INVALID_HOOK_CONTEXT', 'release config identity does not match its receipt.');
  }
  const context = receipt.context;
  if (!context || context.marker !== 'BEL_FIREBASE_RELEASE_CONTEXT' || context.profile !== state.profile ||
      context.sourceSha !== sourceSha || context.projectId !== projectId ||
      (context.projectAlias || null) !== receiptAlias || context.configPath !== relativeConfig ||
      context.candidateRoot !== receiptRoot || context.surfaceSha256 !== String(env.BEL_FIREBASE_RELEASE_SURFACE_SHA256).toLowerCase()) {
    fail('INVALID_HOOK_CONTEXT', 'release context metadata does not match its receipt.');
  }
  if (!Array.isArray(receipt.surface)) fail('INVALID_HOOK_CONTEXT', 'release receipt has no sealed surface.');
  if (sha256Bytes(JSON.stringify(receipt.surface)) !== String(env.BEL_FIREBASE_RELEASE_SURFACE_SHA256).toLowerCase()) {
    fail('INVALID_HOOK_CONTEXT', 'release surface identity does not match its receipt.');
  }
  if (env.PROJECT_DIR) {
    const value = path.resolve(env.PROJECT_DIR);
    if (value !== receiptRoot) fail('INVALID_HOOK_CONTEXT', 'Firebase PROJECT_DIR does not match the release candidate.');
  }
  if (env.RESOURCE_DIR) {
    const value = path.resolve(env.RESOURCE_DIR);
    const config = readJson(receiptConfig, 'candidate Firebase config');
    validatePrivateInputLayout(config, receiptRoot, { id: projectId, alias: receiptAlias });
    const expected = product === 'functions'
      ? (functionsConfigEntries(config).length ? functionsConfigEntries(config).map((entry) => path.resolve(receiptRoot, entry && typeof entry.source === 'string' ? entry.source : 'functions')) : [path.resolve(receiptRoot, 'functions')])
      : [path.resolve(receiptRoot, typeof config.hosting?.public === 'string' ? config.hosting.public : '.')];
    if (!expected.includes(value)) fail('INVALID_HOOK_CONTEXT', 'Firebase RESOURCE_DIR does not match the release candidate.');
    rejectLinkAncestors(receiptRoot, value, 'Firebase RESOURCE_DIR');
    if (!fs.existsSync(value) || !fs.lstatSync(value).isDirectory()) fail('INVALID_HOOK_CONTEXT', 'Firebase RESOURCE_DIR is not a candidate directory.');
  }
  if (env.GCLOUD_PROJECT && normalizeProjectId(env.GCLOUD_PROJECT) !== projectId) {
    fail('INVALID_HOOK_CONTEXT', 'Firebase project environment does not match its receipt.');
  }
  return { sourceSha, projectId, projectAlias: receiptAlias, candidateRoot: receiptRoot, candidateConfigPath: receiptConfig };
}

function assertReceiptOutsideCandidate(candidateRoot, receiptPathValue) {
  const receiptPath = path.resolve(receiptPathValue);
  const receiptDirectory = path.dirname(receiptPath);
  if (!isAbsoluteOutside(candidateRoot, receiptPath)) fail('INVALID_HOOK_CONTEXT', 'Release receipt must remain outside the candidate tree.');
  const candidateReal = fs.realpathSync.native(path.resolve(candidateRoot));
  const directoryReal = fs.realpathSync.native(receiptDirectory);
  if (isSameOrInside(candidateReal, directoryReal)) fail('INVALID_HOOK_CONTEXT', 'Release receipt directory must remain outside the candidate tree.');
  rejectLinkAncestors(receiptDirectory, receiptPath, 'release receipt');
  return receiptPath;
}

const PATH_ENV_KEYS = Object.freeze([
  'GOOGLE_APPLICATION_CREDENTIALS',
  'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE',
  'GOOGLE_GHA_CREDS_PATH'
]);

function normalizeInheritedEnvironment(originalCwd, input = process.env) {
  const env = { ...input };
  for (const key of PATH_ENV_KEYS) {
    const value = env[key];
    if (!value) continue;
    const resolved = path.isAbsolute(value) ? path.normalize(value) : path.resolve(originalCwd, value);
    if (!fs.existsSync(resolved)) fail('ENV_INPUT', `${key} does not resolve to a readable file from the original invocation directory.`);
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()) fail('ENV_INPUT', `${key} does not resolve to a regular file.`);
    try { env[key] = fs.realpathSync.native(resolved); }
    catch (_) { fail('ENV_INPUT', `${key} could not be resolved safely.`); }
  }
  return env;
}

function runLegacyHook(product, options = {}) {
  const node = options.node || process.execPath;
  const cwd = path.resolve(options.cwd || process.cwd());
  const commands = [];
  if (product === 'hosting' || product === 'functions') commands.push({ command: node, args: ['scripts/read-aloud/build-connected-speech-index.js'], cwd, kind: 'legacy-connectedSpeech' });
  if (product === 'functions') commands.push({ command: node, args: ['scripts/segmentation-study/sync-manifest.js'], cwd, kind: 'legacy-segmentationV2' });
  if (!commands.length) fail('HOOK_PRODUCT', `Unsupported Firebase hook product: ${product}.`);
  for (const spec of commands) {
    const result = typeof options.executor === 'function'
      ? commandResult(spec.command, spec.args, { cwd: spec.cwd, env: options.env || process.env, kind: spec.kind, executor: options.executor })
      : runCommand(spec.command, spec.args, { cwd: spec.cwd, env: options.env || process.env, kind: spec.kind });
    if (result && result.status !== 0) fail('LEGACY_HOOK_FAILED', `${spec.kind} hook failed.`);
  }
  return { mode: 'legacy', product, commands };
}

function runHook(options = {}) {
  const product = options.product;
  const state = inspectHookContext(options.env || process.env);
  if (state.state === 'absent') return runLegacyHook(product, options);
  if (state.state !== 'valid') fail('INVALID_HOOK_CONTEXT', state.message);
  const env = options.env || process.env;
  const receiptPathValue = path.resolve(env.BEL_FIREBASE_RELEASE_RECEIPT);
  if (!fs.existsSync(receiptPathValue)) fail('INVALID_HOOK_CONTEXT', 'release receipt is missing or unreadable.');
  const receiptStat = fs.lstatSync(receiptPathValue);
  if (!receiptStat.isFile() || receiptStat.isSymbolicLink()) fail('INVALID_HOOK_CONTEXT', 'release receipt must be a private regular file.');
  const receipt = readJson(receiptPathValue, 'release receipt');
  const identity = validateHookReceipt(env, receipt, state, product);
  assertReceiptOutsideCandidate(identity.candidateRoot, receiptPathValue);
  if (!isAbsoluteOutside(identity.candidateRoot, receiptPathValue) || !isAbsoluteOutside(receiptPathValue, identity.candidateRoot)) {
    fail('INVALID_HOOK_CONTEXT', 'release receipt must remain outside the candidate tree.');
  }
  const candidateRoot = identity.candidateRoot;
  const project = { id: identity.projectId, alias: identity.projectAlias };
  const ctx = {
    profile: state.profile,
    profileConfig: PROFILE_CONFIG[state.profile],
    candidateRoot,
    candidateConfigPath: identity.candidateConfigPath,
    config: readJson(identity.candidateConfigPath, 'candidate Firebase config'),
    sourceSha: identity.sourceSha,
    project,
    receipt,
    sealed: true,
    inventory: options.inventory,
    surfacePaths: options.surfacePaths
  };
  compareSealedSurface(ctx);
  return { mode: 'verified', product, profile: state.profile };
}

function resolveCandidateConfigPath(sourceRoot, candidateRoot, originalConfigPath) {
  const relative = path.relative(sourceRoot, originalConfigPath);
  if (isAbsoluteOutside(sourceRoot, originalConfigPath)) fail('FIREBASE_CONFIG', 'Firebase config must be inside the source repository.');
  return rejectLinkAncestors(candidateRoot, path.join(candidateRoot, relative), 'candidate Firebase config');
}

function buildReleaseContext(options = {}) {
  const source = options.source || resolveSource({
    ...options,
    cwd: options.cwd || process.cwd(),
    sha: options.sha || options.sourceSha
  });
  const sourceConfigRelative = options.configPath
    ? path.relative(source.root, path.resolve(source.originalCwd, options.configPath)).replace(/\\/g, '/')
    : 'firebase.json';
  if (sourceConfigRelative.includes('/')) fail('FIREBASE_CONFIG', 'Nested Firebase config paths are unsupported; use a root-level config filename.');
  if (isAbsoluteOutside(source.root, path.resolve(source.originalCwd, options.configPath || path.join(source.root, 'firebase.json')))) fail('FIREBASE_CONFIG', 'Firebase config must be inside the selected source repository.');
  const originalConfigPath = path.resolve(source.originalCwd, options.configPath || path.join(source.root, sourceConfigRelative));
  const originalConfig = options.projectContext ? null : readJson(originalConfigPath, 'original Firebase config');
  const originalFirebaserc = options.projectContext ? null : readFirebaserc(path.dirname(originalConfigPath), options);
  const selectedConfig = options.projectContext ? null : readGitJson(source.root, source.sourceSha, sourceConfigRelative, options, 'selected Firebase config');
  const selectedFirebaserc = options.projectContext ? null : (() => {
    try { return readGitJson(source.root, source.sourceSha, '.firebaserc', options, 'selected .firebaserc'); }
    catch (error) { if (error && error.code === 'COMMAND_FAILED') return {}; throw error; }
  })();
  let project = options.projectContext;
  let originalProject = null;
  if (!project) {
    originalProject = resolveFirebaseProject({
      ...options,
      cwd: source.originalCwd,
      projectRoot: source.root,
      configPath: originalConfigPath,
      firebaseConfig: originalConfig,
      firebaserc: originalFirebaserc
    });
    const selectedIdentity = originalProject.alias || originalProject.id;
    const selectedProject = resolveFirebaseProject({
      ...options,
      cwd: source.originalCwd,
      projectRoot: source.root,
      configPath: path.join(source.root, sourceConfigRelative),
      project: selectedIdentity,
      firebaseConfig: selectedConfig,
      firebaserc: selectedFirebaserc,
      firebaseCli: originalProject.firebaseCli
    });
    if (selectedProject.id !== originalProject.id || (originalProject.alias && selectedProject.alias !== originalProject.alias)) {
      fail('FIREBASE_PROJECT', 'Selected source Firebase project identity does not match the original invocation identity.');
    }
    project = { ...selectedProject, id: originalProject.id, alias: originalProject.alias, config: selectedConfig };
  }
  const profile = String(options.profile || '').trim();
  if (!PROFILE_CONFIG[profile]) fail('PROFILE', `Unsupported release profile: ${profile}.`);
  const metrics = options.metrics || ACTIVE_METRICS;
  if (metrics) metrics.startPhase('git-inventory');
  const trackedInventory = Array.isArray(options.trackedInventory)
    ? options.trackedInventory
    : captureTrackedInventory(source.root, source.sourceSha, options);
  if (metrics) metrics.endPhase('git-inventory');
  if (metrics) metrics.startPhase('tracked-source-validation');
  if (!options.projectContext) {
    validateSelectedReleaseWiring(source.root, source.sourceSha, project.config, sourceConfigRelative, profile, {
      ...options,
      trackedInventory
    });
  }
  const selectedPaths = selectedReleaseInputPaths(source.root, project.config, sourceConfigRelative, profile);
  guardDirtyReleaseInputs(source.root, {
    ...options,
    cwd: source.originalCwd,
    profile,
    extraPaths: selectedPaths
  });
  if (metrics) metrics.endPhase('tracked-source-validation');
  const configuredPublicRoot = (profile === 'hosting' || profile === 'full') && project.config?.hosting && typeof project.config.hosting.public === 'string'
    ? [project.config.hosting.public]
    : [];
  if (metrics) metrics.startPhase('media-discovery');
  const observedAssets = captureObservedProvisionedAssets(source.root, trackedInventory, {
    ...options,
    mediaRoots: configuredPublicRoot,
    metrics
  });
  if (metrics) metrics.endPhase('media-discovery');
  if (metrics) metrics.startPhase('source-export');
  const candidate = createCandidate({
    ...options,
    sourceRoot: source.root,
    sourceSha: source.sourceSha,
    treeInventory: trackedInventory,
    externalRoot: options.externalRoot
  });
  if (metrics) metrics.endPhase('source-export');
  const candidateConfigPath = resolveCandidateConfigPath(source.root, candidate.candidateRoot, project.configPath);
  if (!fs.existsSync(candidateConfigPath)) fail('FIREBASE_CONFIG', 'Selected source does not contain the requested Firebase config.');
  validatePrivateInputLayout(project.config, candidate.candidateRoot, project);
  const functionsConfigDirs = validatePrivateInputLayout(project.config, source.root, project);
  const ctx = {
    ...source,
    ...candidate,
    profile,
    profileConfig: PROFILE_CONFIG[profile],
    project,
    candidateConfigPath,
    config: project.config,
    configPathRelative: path.relative(candidate.candidateRoot, candidateConfigPath).replace(/\\/g, '/'),
    sourceConfigSnapshot: readJson(candidateConfigPath, 'selected Firebase config'),
    firebaseCli: project.firebaseCli,
    trackedInventory,
    committerEpoch: source.committerEpoch,
    node: options.node || process.execPath,
    npmCli: options.npmCli,
    nonInteractive: options.nonInteractive === true,
    executor: options.executor,
    prepare: options.prepare,
    inventory: options.inventory,
    surfacePaths: options.surfacePaths,
    functionsConfigDirs,
    functionsSourceDirs: functionsSourceDirectories(project.config, candidate.candidateRoot),
    prepared: false,
    sealed: false
  };
  const invocationRelativeCwd = path.relative(source.root, source.originalCwd);
  ctx.publishCwd = rejectLinkAncestors(
    ctx.candidateRoot,
    path.join(ctx.candidateRoot, invocationRelativeCwd),
    'Candidate publish cwd'
  );
  if (!fs.existsSync(ctx.publishCwd) || !fs.lstatSync(ctx.publishCwd).isDirectory()) {
    fail('CANDIDATE_CWD', 'The original invocation directory is unavailable in the release candidate.');
  }
  const assets = [...observedAssets, ...(options.provisionedAssets || options.assets || [])];
  ctx.observedAssets = observedAssets;
  if (metrics) metrics.startPhase('provisioned-copying');
  ctx.assets = copyProvisionedAssets(ctx, assets);
  if (metrics) metrics.endPhase('provisioned-copying');
  ctx.dotenv = stageFunctionsDotenv(ctx, project, options);
  ctx.privateConfigDelta = ctx.profileConfig.products.includes('functions')
    ? applyFunctionsDotenvIgnore(ctx.candidateRoot, project, ctx.candidateConfigPath)
    : { added: [] };
  ctx.config = readJson(ctx.candidateConfigPath, 'candidate Firebase config');
  ctx.surfaceBeforePreparation = surfacePathSet(ctx);
  ctx.privateInputSnapshot = capturePrivateInputInventory(ctx);
  ctx.env = normalizeInheritedEnvironment(source.originalCwd, options.env || process.env);
  ctx.metrics = metrics;
  return ctx;
}

function resolveFirebaseBinary(options = {}) {
  if (options.firebaseBin) return options.firebaseBin;
  if (process.env.FIREBASE_CLI_BIN) return process.env.FIREBASE_CLI_BIN;
  return 'firebase';
}

function resolveFirebaseInvocation(options = {}, ctx = {}) {
  if (options.firebaseCliEntrypoint) {
    const entrypoint = path.resolve(options.firebaseCliEntrypoint);
    if (!path.isAbsolute(options.firebaseCliEntrypoint) || !fs.existsSync(entrypoint)) fail('FIREBASE_CLI_UNSUPPORTED', 'Firebase CLI entrypoint must be an existing absolute path.');
    return { command: process.execPath, prefix: [entrypoint] };
  }
  const firebaseCli = options.firebaseCli || ctx.firebaseCli;
  if (firebaseCli && firebaseCli.entrypoint) {
    const entrypoint = path.resolve(firebaseCli.entrypoint);
    if (!fs.existsSync(entrypoint)) fail('FIREBASE_CLI_UNSUPPORTED', 'Firebase CLI entrypoint is missing.');
    return { command: process.execPath, prefix: [entrypoint] };
  }
  if (firebaseCli && firebaseCli.packagePath) {
    const metadata = firebaseCli.packageJson || readJson(firebaseCli.packagePath, 'Firebase CLI package metadata');
    const bin = typeof metadata.bin === 'string' ? metadata.bin : metadata.bin && (metadata.bin.firebase || metadata.bin['firebase-tools']);
    if (!bin) fail('FIREBASE_CLI_UNSUPPORTED', 'Firebase CLI package has no supported executable entrypoint.');
    const entrypoint = path.resolve(path.dirname(firebaseCli.packagePath), bin);
    if (!fs.existsSync(entrypoint)) fail('FIREBASE_CLI_UNSUPPORTED', 'Firebase CLI executable entrypoint is missing.');
    return { command: process.execPath, prefix: [entrypoint] };
  }
  return { command: resolveFirebaseBinary(options), prefix: [] };
}

function dispatchFirebase(ctx, options = {}) {
  if (options.verifyOnly || ctx.verifyOnly) {
    fail('VERIFY_ONLY_DISPATCH', 'dispatchFirebase must not be invoked when verifyOnly is active.');
  }
  compareSealedSurface(ctx);
  const selector = ctx.profileConfig.selector;
  const invocation = resolveFirebaseInvocation(options, ctx);
  const projectSelector = ctx.project.alias || ctx.project.id;
  const args = [...invocation.prefix, 'deploy', '--project', projectSelector, '--config', ctx.candidateConfigPath, '--only', selector];
  if (ctx.nonInteractive || options.nonInteractive === true) args.push('--non-interactive');
  const env = { ...(ctx.env || process.env), FUNCTIONS_DISCOVERY_TIMEOUT: process.env.FUNCTIONS_DISCOVERY_TIMEOUT || '60', ...buildHookEnvironment(ctx) };
  const publisher = options.publisher || ctx.publisher;
  if (typeof publisher === 'function') {
    const result = publisher({ command: invocation.command, args, cwd: ctx.publishCwd || ctx.candidateRoot, env, profile: ctx.profile, selector });
    if (typeof result === 'number' && result !== 0) fail('PUBLISH_FAILED', 'Firebase publication failed.');
    if (result && typeof result.status === 'number' && result.status !== 0) fail('PUBLISH_FAILED', 'Firebase publication failed.');
    return { selector, args, result };
  }
  const result = runCommand(invocation.command, args, { cwd: ctx.publishCwd || ctx.candidateRoot, env, kind: 'firebase-publish', metrics: ctx.metrics || ACTIVE_METRICS });
  return { selector, args, result };
}

function runRelease(options = {}) {
  const metrics = options.metrics || new ReleaseMetrics(options);
  setActiveMetrics(metrics);
  let ctx = null;
  try {
    ctx = buildReleaseContext({ ...options, metrics });
    ctx.metrics = metrics;
    if (options.verifyOnly) ctx.verifyOnly = true;
    metrics.setContextMetadata(ctx);

    ctx.preparation = prepareOnce(ctx);
    verifyAndSeal(ctx);
    ctx.env = { ...(ctx.env || process.env), ...buildHookEnvironment(ctx) };

    if (options.verifyOnly) {
      metrics.startPhase('hook-validation');
      for (const product of ctx.profileConfig.products) {
        runHook({ product, env: ctx.env });
      }
      metrics.endPhase('hook-validation');
      metrics.recordSuccess({ verified: true, published: false });
      const metricsPath = writeMetricsFile(ctx, metrics, options);
      return {
        ok: true,
        verified: true,
        published: false,
        profile: ctx.profile,
        selector: ctx.profileConfig.selector,
        sourceSha: ctx.sourceSha,
        project: { id: ctx.project.id, alias: ctx.project.alias },
        publication: null,
        metricsPath,
        metrics: metrics.toJSON()
      };
    }

    metrics.startPhase('publish');
    const publication = dispatchFirebase(ctx, options);
    metrics.endPhase('publish');

    metrics.recordSuccess({ verified: true, published: true, publication });
    const metricsPath = writeMetricsFile(ctx, metrics, options);
    return {
      ok: true,
      verified: true,
      published: true,
      profile: ctx.profile,
      selector: ctx.profileConfig.selector,
      sourceSha: ctx.sourceSha,
      project: { id: ctx.project.id, alias: ctx.project.alias },
      publication: { selector: publication.selector, args: publication.args },
      metricsPath,
      metrics: metrics.toJSON()
    };
  } catch (error) {
    metrics.recordFailure(error);
    writeMetricsFile(ctx, metrics, options);
    throw error;
  } finally {
    setActiveMetrics(null);
  }
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = { json: false, nonInteractive: false, verifyOnly: false };
  const tokens = [...argv];
  if (tokens[0] && !tokens[0].startsWith('--')) args.profile = tokens.shift();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--json') args.json = true;
    else if (token === '--non-interactive') args.nonInteractive = true;
    else if (token === '--verify-only') args.verifyOnly = true;
    else if (['--sha', '--project', '--config', '--firebase-cli', '--npm-cli', '--external-root'].includes(token)) {
      if (!tokens[index + 1] || tokens[index + 1].startsWith('--')) fail('CLI_ARGUMENT', `${token} requires a value.`);
      args[token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = tokens[++index];
    } else if (token === '--hook') {
      args.hook = true;
    } else if (token === '--product') {
      if (!tokens[index + 1] || tokens[index + 1].startsWith('--')) fail('CLI_ARGUMENT', '--product requires a value.');
      args.product = tokens[++index];
    } else fail('CLI_ARGUMENT', `Unknown argument: ${token}.`);
  }
  if (args.profile === 'hook') { args.hook = true; delete args.profile; }
  if (args.hook && args.profile) fail('CLI_ARGUMENT', 'Hook mode cannot include a release profile.');
  return args;
}

function publicResult(result) {
  return {
    ok: Boolean(result && result.ok),
    verified: Boolean(result && result.verified !== undefined ? result.verified : result && result.ok),
    published: Boolean(result && result.published !== undefined ? result.published : result && result.ok),
    profile: result && result.profile,
    selector: result && result.selector,
    sourceSha: result && result.sourceSha,
    project: result && result.project
  };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.hook) {
    const result = runHook({ product: args.product });
    if (args.json) console.log(JSON.stringify({ ok: true, mode: result.mode, product: result.product }));
    return result;
  }
  if (!args.profile) fail('CLI_ARGUMENT', 'A release profile is required: hosting, functions, or full.');
  const result = runRelease({
    profile: args.profile,
    sha: args.sha,
    project: args.project,
    configPath: args.config,
    npmCli: args.npmCli,
    nonInteractive: args.nonInteractive,
    verifyOnly: args.verifyOnly,
    firebaseCliEntrypoint: args.firebaseCli,
    externalRoot: args.externalRoot
  });
  if (args.json) console.log(JSON.stringify(publicResult(result)));
  else if (args.verifyOnly) console.log(`${args.profile} Firebase release verified without publication.`);
  else console.log(`${args.profile} Firebase release succeeded.`);
  return result;
}

module.exports = {
  REPOSITORY_ROOT,
  RELEASE_INPUTS,
  SUPPORTED_FIREBASE_VERSION,
  PROFILE_CONFIG,
  PROFILE_NAMES,
  HOOK_CONTEXT_FIELDS,
  PROVISIONED_MEDIA_ROOTS,
  minimizeRoots,
  ReleaseMetrics,
  redactArgs,
  redactString,
  writeMetricsFile,
  getActiveMetrics,
  setActiveMetrics,
  ReleaseError,
  canonicalJson,
  commitSha,
  sha256File,
  sha256Bytes,
  captureTrackedInventory,
  captureObservedProvisionedAssets,
  exportGitTreeRaw,
  normalizeRelativePath,
  rejectLinkAncestors,
  assertExternalRoot,
  listFiles,
  parseGitStatus,
  guardDirtyReleaseInputs,
  resolveSource,
  resolveFirebaseProject,
  detectProjectRoot,
  createCandidate,
  copyProvisionedAssets,
  stageFunctionsDotenv,
  validatePrivateInputLayout,
  recognizedDotenvNames,
  surfaceFiles,
  inventorySurface,
  compareInventory,
  validateGeneratedFamilies,
  validateVersionOracle,
  resolveNpmInvocation,
  buildDependencyCommands,
  normalizeInheritedEnvironment,
  buildHookEnvironment,
  validateHookReceipt,
  buildPreparationCommands,
  prepareOnce,
  verifyAndSeal,
  compareSealedSurface,
  inspectHookContext,
  runLegacyHook,
  runHook,
  buildReleaseContext,
  dispatchFirebase,
  runRelease,
  parseArgs,
  main
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof ReleaseError ? `${error.code}: ${error.message}` : error.message || String(error));
    process.exitCode = 1;
  }
}
