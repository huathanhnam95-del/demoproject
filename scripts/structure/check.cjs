'use strict';

/*
 * STR-01 is intentionally self-contained.  It reads ordinary files and Git
 * objects, but never loads application code, runs a package command, fetches a
 * ref, or writes inside the repository.
 */

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const EXIT_CODES = Object.freeze({ CLEAN: 0, POLICY: 1, INPUT: 2 });
const ADOPTION_SHA = 'ffbc380ae0790d92eb904ddc6edb183748f00c06';
const DEFAULT_EXCLUDED = ['.git', 'node_modules', '.venv', 'venv', 'Kokoro-FastAPI', '.firebase'];
const LFS_POINTER = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\n(?:oid sha256:[0-9a-f]+\n)?size \d+\n?$/;

function isSha(value) { return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function jsonSha(value) { return sha256(Buffer.isBuffer(value) ? value : Buffer.from(value)); }

function normalizeRepoPath(input) {
  if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) throw new Error('invalid repository path');
  if (/^(?:[A-Za-z]:|[\\/]{2})/.test(input)) throw new Error(`drive/UNC path is not allowed: ${input}`);
  const normalized = input.replaceAll('\\', '/');
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) throw new Error(`path traversal or absolute path is not allowed: ${input}`);
  const result = normalized.split('/').filter(Boolean).join('/');
  if (!result || result === '.' || result.split('/').includes('.')) throw new Error(`invalid repository path: ${input}`);
  return result;
}

function findCaseCollisions(paths) {
  const groups = new Map();
  for (const original of paths) {
    const normalized = normalizeRepoPath(original);
    const key = normalized.toLocaleLowerCase('en-US');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(normalized);
  }
  return [...groups.values()].filter((group) => new Set(group).size > 1).flat().sort();
}

function isInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function nearestExisting(target) {
  let current = path.resolve(target);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function validateOutputDestination(destination, repositoryRoot) {
  const findings = [];
  if (typeof destination !== 'string' || !path.isAbsolute(destination)) findings.push({ ruleId: 'R1.OUTPUT_ABSOLUTE', path: String(destination), message: 'output root must be absolute' });
  if (findings.length) return { ok: false, findings };
  const resolvedRepo = path.resolve(repositoryRoot);
  const resolved = path.resolve(destination);
  if (isInside(resolved, resolvedRepo)) findings.push({ ruleId: 'R1.OUTPUT_REPOSITORY_ESCAPE', path: resolved, message: 'output destination is inside repository' });
  try {
    const realRepo = fs.realpathSync.native(resolvedRepo);
    const realNearest = fs.realpathSync.native(nearestExisting(resolved));
    if (isInside(realNearest, realRepo)) findings.push({ ruleId: 'R1.OUTPUT_REPOSITORY_ESCAPE', path: resolved, message: 'output destination resolves inside repository' });
  } catch (error) { findings.push({ ruleId: 'R1.OUTPUT_REALPATH', path: resolved, message: error.message }); }
  if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) findings.push({ ruleId: 'R1.OUTPUT_LINK_ESCAPE', path: resolved, message: 'output root cannot be a symlink/junction' });
  return { ok: findings.length === 0, findings };
}

function validateRepositoryOutputDestination(relativeDestination, repositoryRoot) {
  const findings = [];
  let relative;
  try { relative = normalizeRepoPath(relativeDestination); } catch (error) { return { ok: false, findings: [{ ruleId: 'R1.OUTPUT_PATH', path: String(relativeDestination), message: error.message }] }; }
  const repo = path.resolve(repositoryRoot);
  const absolute = path.resolve(repo, ...relative.split('/'));
  if (!isInside(absolute, repo)) findings.push({ ruleId: 'R1.OUTPUT_REPOSITORY_ESCAPE', path: relative, message: 'repository output destination escapes repository' });
  let current = repo;
  for (const component of relative.split('/')) {
    current = path.join(current, component);
    if (!fs.existsSync(current)) continue;
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) findings.push({ ruleId: 'R1.OUTPUT_LINK_ESCAPE', path: relative, message: 'repository output destination cannot traverse a symlink/junction' });
      const real = fs.realpathSync.native(current);
      const realRepo = fs.realpathSync.native(repo);
      if (!isInside(real, realRepo)) findings.push({ ruleId: 'R1.OUTPUT_REPOSITORY_ESCAPE', path: relative, message: 'repository output destination resolves outside repository' });
    } catch (error) { findings.push({ ruleId: 'R1.OUTPUT_REALPATH', path: relative, message: error.message }); }
  }
  return { ok: findings.length === 0, findings };
}

function commonSchemaErrors(value, schemaVersion = 1) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['value must be an object'];
  if (value.schemaVersion !== schemaVersion) errors.push(`schemaVersion must be ${schemaVersion}`);
  return errors;
}

function validateContract(contract, options = {}) {
  const errors = commonSchemaErrors(contract);
  const changes = contract && contract.changes;
  if (!isSha(contract && contract.baseSha)) errors.push('baseSha must be a 40-character Git SHA');
  if (!contract || typeof contract.taskId !== 'string' || !contract.taskId.trim()) errors.push('taskId is required');
  if (!contract || typeof contract.owner !== 'string' || !contract.owner.trim()) errors.push('owner is required');
  if (!changes || typeof changes !== 'object') errors.push('changes is required');
  else for (const key of ['create', 'modify', 'delete', 'rename']) if (!Array.isArray(changes[key])) errors.push(`changes.${key} must be an array`);
  const seen = new Set();
  if (changes) {
    for (const key of ['create', 'modify', 'delete']) for (const entry of changes[key] || []) {
      try { const normalized = normalizeRepoPath(entry); if (seen.has(normalized)) errors.push(`duplicate declared path: ${normalized}`); seen.add(normalized); } catch (error) { errors.push(error.message); }
    }
    for (const entry of changes.rename || []) {
      const from = typeof entry === 'string' ? entry : entry && (entry.from || entry.old);
      const to = typeof entry === 'string' ? entry : entry && (entry.to || entry.new);
      if (!from || !to) { errors.push('rename entries require from/to'); continue; }
      for (const name of [from, to]) try { const normalized = normalizeRepoPath(name); if (seen.has(normalized)) errors.push(`duplicate declared path: ${normalized}`); seen.add(normalized); } catch (error) { errors.push(error.message); }
    }
  }
  if (!Array.isArray(contract && contract.outputs)) errors.push('outputs must be an array');
  else for (const output of contract.outputs) {
    if (!output || typeof output !== 'object' || typeof output.root !== 'string' || typeof output.class !== 'string' || typeof output.tracked !== 'boolean') { errors.push('outputs entries require absolute root, class, tracked'); continue; }
    const relativeOutput = !path.isAbsolute(output.root) ? (() => { try { return normalizeRepoPath(output.root); } catch { return null; } })() : null;
    const approvedRepoEvidence = Boolean(options.repositoryRoot && relativeOutput && output.class === 'ephemeral-evidence' && output.tracked === false && (relativeOutput === 'test-results' || relativeOutput.startsWith('test-results/')));
    if (approvedRepoEvidence) {
      const result = validateRepositoryOutputDestination(relativeOutput, options.repositoryRoot);
      if (!result.ok) errors.push(...result.findings.map((f) => f.message));
    } else {
      if (relativeOutput) errors.push(`output root must be absolute or approved repository evidence: ${output.root}`);
      const result = validateOutputDestination(output.root, options.repositoryRoot || path.parse(output.root).root);
      if (!result.ok && options.repositoryRoot) errors.push(...result.findings.map((f) => f.message));
      if (options.externalRoot && !isInside(path.resolve(output.root), path.resolve(options.externalRoot))) errors.push(`output root is outside declared external task directory: ${output.root}`);
    }
  }
  for (const key of ['protectedContracts', 'verification', 'exceptions']) if (!Array.isArray(contract && contract[key])) errors.push(`${key} must be an array`);
  return { ok: errors.length === 0, errors };
}

function validateSnapshot(snapshot, contract, contractBytes) {
  const errors = commonSchemaErrors(snapshot);
  if (!contract || snapshot.taskId !== contract.taskId) errors.push('snapshot taskId does not match contract');
  if (!contract || snapshot.baseSha !== contract.baseSha || !isSha(snapshot.baseSha)) errors.push('snapshot baseSha is invalid or does not match contract');
  if (typeof snapshot.root !== 'string' || !path.isAbsolute(snapshot.root)) errors.push('snapshot root must be absolute');
  if (typeof contractBytes !== 'string' && !Buffer.isBuffer(contractBytes)) errors.push('contract bytes are required for exact hash validation');
  else if (!/^[0-9a-f]{64}$/i.test(snapshot.contractSha256 || '') || snapshot.contractSha256.toLowerCase() !== jsonSha(contractBytes)) errors.push('snapshot contractSha256 does not match exact contract bytes');
  if (!Array.isArray(snapshot.excluded) || snapshot.excluded.join('\0') !== DEFAULT_EXCLUDED.join('\0')) errors.push('snapshot excluded list does not match required exclusions');
  if (!Array.isArray(snapshot.links)) errors.push('snapshot links must be an array');
  if (typeof snapshot.gitStatus !== 'string') errors.push('snapshot gitStatus must be a string');
  if (!snapshot.files || typeof snapshot.files !== 'object' || Array.isArray(snapshot.files)) errors.push('snapshot files must be an object');
  else for (const [rel, meta] of Object.entries(snapshot.files)) {
    try { normalizeRepoPath(rel); } catch (error) { errors.push(error.message); }
    if (!meta || !Number.isFinite(meta.size) || !Number.isFinite(meta.mtimeMs) || !/^[0-9a-f]{64}$/i.test(meta.sha256 || '')) errors.push(`invalid snapshot metadata for ${rel}`);
  }
  if (snapshot.index !== undefined) {
    if (!snapshot.index || typeof snapshot.index !== 'object' || Array.isArray(snapshot.index)) errors.push('snapshot index must be an object');
    else for (const [rel, value] of Object.entries(snapshot.index)) {
      try { normalizeRepoPath(rel); } catch (error) { errors.push(error.message); }
      if (!value || !/^[0-9a-f]{40}$/i.test(value.oid || '') || typeof value.mode !== 'string' || typeof value.stage !== 'number') errors.push(`invalid snapshot index metadata for ${rel}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

function listFiles(root, options = {}) {
  const excluded = options.excluded || DEFAULT_EXCLUDED;
  const includeHashes = options.includeHashes !== false;
  const includeBytes = options.includeBytes === true;
  const files = new Map();
  const links = [];
  const exclusions = new Set(excluded);
  function visit(directory) {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch (error) { throw new Error(`cannot read ${directory}: ${error.message}`); }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const rel = normalizeRepoPath(path.relative(root, absolute));
      if (exclusions.has(entry.name)) continue;
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) { links.push(rel); continue; }
      if (entry.isDirectory()) { visit(absolute); continue; }
      if (!entry.isFile()) continue;
      const meta = { size: stat.size, mtimeMs: stat.mtimeMs, absolute };
      if (includeHashes) meta.sha256 = hashFile(absolute);
      if (includeBytes) meta.bytes = fs.readFileSync(absolute);
      files.set(rel, meta);
    }
  }
  visit(root);
  return { files, links };
}

function git(root, args, input) {
  const result = cp.spawnSync('git', ['-C', root, ...args], { input, encoding: null, windowsHide: true, maxBuffer: 1024 * 1024 * 1024 });
  if (result.error) throw new Error(`git failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error((result.stderr || Buffer.from('git command failed')).toString('utf8').trim() || 'git command failed');
  return result.stdout || Buffer.alloc(0);
}

function ensureSha(sha, label) { if (!isSha(sha)) throw new Error(`${label || 'SHA'} must be a 40-character Git SHA`); }

function readGitTree(root, treeSha) {
  ensureSha(treeSha, 'tree SHA');
  const raw = git(root, ['ls-tree', '-r', '-z', treeSha]);
  const entries = [];
  for (const record of raw.toString('utf8').split('\0')) {
    if (!record) continue;
    const match = /^(\d+)\s+(blob|commit|tree)\s+([0-9a-f]{40})\t([\s\S]+)$/.exec(record);
    if (!match) throw new Error(`unsupported git tree record: ${record.slice(0, 120)}`);
    if (match[2] === 'blob') entries.push({ path: normalizeRepoPath(match[4]), oid: match[3] });
  }
  const files = new Map();
  for (const entry of entries) files.set(entry.path, { oid: entry.oid });
  return files;
}

function readGitBlobs(root, treeFiles, requestedPaths) {
  const paths = [...new Set(requestedPaths || [])].filter((name) => treeFiles.has(name));
  if (!paths.length) return new Map();
  const input = Buffer.from(paths.map((name) => treeFiles.get(name).oid).join('\n') + '\n');
  const cat = git(root, ['cat-file', '--batch'], input);
  let offset = 0;
  const result = new Map();
  for (const name of paths) {
    const headerEnd = cat.indexOf(10, offset);
    if (headerEnd < 0) throw new Error('truncated git cat-file header');
    const header = cat.subarray(offset, headerEnd).toString('utf8').split(' ');
    if (header[1] !== 'blob') throw new Error(`git object is not a blob: ${treeFiles.get(name).oid}`);
    const size = Number(header[2]);
    const start = headerEnd + 1;
    const bytes = cat.subarray(start, start + size);
    if (bytes.length !== size || cat[start + size] !== 10) throw new Error(`truncated git blob: ${treeFiles.get(name).oid}`);
    result.set(name, { ...treeFiles.get(name), bytes: Buffer.from(bytes), sha256: sha256(bytes) });
    offset = start + size + 1;
  }
  return result;
}

function asPattern(pattern) {
  const source = String(pattern);
  let expression = '';
  for (let index = 0; index < source.length;) {
    if (source[index] === '*' && source[index + 1] === '*') {
      if (source[index + 2] === '/') { expression += '(?:.*/)?'; index += 3; }
      else { expression += '.*'; index += 2; }
      continue;
    }
    if (source[index] === '*') { expression += '[^/]*'; index += 1; continue; }
    expression += /[.+^${}()|[\]\\]/.test(source[index]) ? `\\${source[index]}` : source[index];
    index += 1;
  }
  return new RegExp(`^${expression}$`);
}

function matchesAny(value, patterns = []) { return patterns.some((pattern) => asPattern(pattern).test(value)); }
function firstSegment(value) { return value.split('/')[0]; }
function rootFile(pathName) { return pathName.includes('/') ? null : pathName; }
function basename(pathName) { return path.posix.basename(pathName); }

function finding(ruleId, pathName, condition, extra = {}) {
  return { ruleId, path: pathName, edge: extra.edge || '', condition: condition || '', occurrence: extra.occurrence || 1, category: extra.category || 'policy', rationale: extra.rationale || '', owner: extra.owner || 'unassigned', triageStatus: extra.triageStatus || 'unassigned', reviewDate: extra.reviewDate || '', fingerprint: `${ruleId}|${pathName}|${extra.edge || ''}|${condition || ''}|${extra.occurrence || 1}` };
}

function rootEntryAllowed(pathName, policy) {
  const entries = Array.isArray(policy.rootEntries) ? policy.rootEntries : [];
  return entries.some((entry) => typeof entry === 'string' ? entry === pathName : entry && (entry.path === pathName || (entry.pattern && asPattern(entry.pattern).test(pathName))));
}

function analyzePaths(paths, policy, options = {}) {
  const findings = [];
  const normalized = [];
  const seen = new Set();
  for (const raw of paths) {
    let pathName;
    try { pathName = normalizeRepoPath(raw); } catch (error) { findings.push(finding('R1.INVALID_PATH', String(raw), error.message)); continue; }
    if (seen.has(pathName)) continue;
    seen.add(pathName); normalized.push(pathName);
    const root = firstSegment(pathName);
    const file = rootFile(pathName);
    if (file && !rootEntryAllowed(file, policy)) findings.push(finding('R1.ROOT_ENTRY', pathName, 'unregistered root file', { category: 'placement', rationale: 'new root files require an exact registered role' }));
    const supported = (policy.supportedRoots || []).includes(root) || root === '.github' || root === '.agent';
    if (!supported && !file) findings.push(finding('R1.UNSUPPORTED_ROOT', pathName, 'legacy/specialized root used without exact registration', { category: 'placement', rationale: 'new source homes require a supported root or exception' }));
    const artifactClasses = policy.artifactClasses && !Array.isArray(policy.artifactClasses) ? policy.artifactClasses : {};
    const trackedDependency = matchesAny(pathName, [...new Set([...(artifactClasses.dependency || []), '**/node_modules/**', 'node_modules/**'])]);
    if (trackedDependency) findings.push(finding('R4.TRACKED_DEPENDENCY', pathName, 'tracked dependency artifact', { category: 'dependency', rationale: 'dependencies are restored from manifests, not tracked as source' }));
    const trackedCache = matchesAny(pathName, [...new Set([...(artifactClasses.cache || []), '**/__pycache__/**', '__pycache__/**', '**/.cache/**', '.cache/**'])]);
    if (trackedCache) findings.push(finding('R4.TRACKED_CACHE', pathName, 'tracked cache artifact', { category: 'cache', rationale: 'cache artifacts are reproducible from source and must not grow under tracked paths' }));
    if (root === 'public' && pathName.split('/').length === 2 && /\.(?:js|mjs|cjs|py|ps1|bat|cmd)$/i.test(pathName) && /(?:debug|maintenance|sync|generate|fix|update|check|verify|audit|test|inspect|convert|analy|patch|seed|script)/i.test(basename(pathName)) && !rootEntryAllowed(pathName, policy)) {
      findings.push(finding('R1.PUBLIC_MAINTENANCE', pathName, 'public maintenance/debug script', { category: 'placement', rationale: 'public root is for served entrypoints and content, not operator scripts' }));
    }
    if (root === 'public' && pathName.split('/').length === 2 && Array.isArray(policy.registeredRootEntries) && !policy.registeredRootEntries.some((entry) => entry === pathName || asPattern(entry).test(pathName))) {
      findings.push(finding('R1.PUBLIC_ROOT_ENTRY', pathName, 'unregistered public root entry', { category: 'placement', rationale: 'new public root entries require an exact registered served role' }));
    }
    if (root === 'public' && pathName.split('/').length > 2 && /\.(?:py|ps1|bat|cmd)$/i.test(pathName)) {
      findings.push(finding('R1.PUBLIC_OPERATOR_SCRIPT', pathName, 'operator script under public tree', { category: 'placement', rationale: 'public tree is served content and cannot contain operator scripts' }));
    }
  }
  const collisions = findCaseCollisions(normalized);
  if (collisions.length) findings.push(finding('R1.CASE_COLLISION', collisions.join(','), 'case-colliding paths', { category: 'placement', rationale: 'served/repository paths must be unambiguous on case-insensitive hosts' }));
  return { findings, notices: [], unsupported: [], scanned: normalized.length, paths: normalized };
}

function toBaselineEntry(item, observationSha = ADOPTION_SHA) {
  return { fingerprint: item.fingerprint, ruleId: item.ruleId, path: item.path, edge: item.edge, condition: item.condition, occurrence: item.occurrence, observationSha, category: item.category, rationale: item.rationale || 'Observed before structure governance adoption; owner assignment remains triage work.', owner: item.owner || 'unassigned', triageStatus: item.triageStatus || 'triage-required', reviewDate: item.reviewDate || new Date().toISOString().slice(0, 10) };
}

function validateBaseline(baseline) {
  const errors = commonSchemaErrors(baseline);
  if (!isSha(baseline && baseline.adoptionSha)) errors.push('baseline adoptionSha must be a Git SHA');
  if (!Array.isArray(baseline && baseline.findings)) errors.push('baseline findings must be an array');
  else {
    const defaults = baseline.metadata && typeof baseline.metadata === 'object' ? baseline.metadata : {};
    const fingerprints = new Set();
    for (const entry of baseline.findings) {
      if (!entry || typeof entry.fingerprint !== 'string') errors.push('baseline finding requires fingerprint');
      const owner = entry && entry.owner !== undefined ? entry.owner : defaults.owner;
      const triageStatus = entry && entry.triageStatus !== undefined ? entry.triageStatus : defaults.triageStatus;
      const rationale = entry && entry.rationale !== undefined ? entry.rationale : defaults.rationale;
      const reviewDate = entry && entry.reviewDate !== undefined ? entry.reviewDate : defaults.reviewDate;
      if (entry && ((!owner && owner !== 'unassigned') || (owner === 'unassigned' && triageStatus !== 'triage-required') || !rationale || !reviewDate)) errors.push(`baseline finding metadata incomplete for ${entry && entry.path}`);
      if (entry && fingerprints.has(entry.fingerprint)) errors.push(`duplicate baseline fingerprint: ${entry.fingerprint}`);
      if (entry) fingerprints.add(entry.fingerprint);
    }
  }
  return { ok: errors.length === 0, errors };
}

function baselineMap(baseline) { return new Map((baseline.findings || []).map((entry) => [entry.fingerprint, entry])); }

function baselineDetails(entry) {
  if (entry && entry.path && entry.ruleId) return entry;
  const parts = String(entry && entry.fingerprint || '').split('|');
  return { ...(entry || {}), ruleId: parts[0] || 'BASELINE.UNKNOWN', path: parts[1] || '', edge: parts[2] || '', condition: parts[3] || '', occurrence: Number(parts[4]) || 1 };
}

function matchingException(item, exceptions = []) {
  return (exceptions || []).find((exception) => exception && exception.ruleId === item.ruleId && exception.path === item.path && (exception.condition === undefined || exception.condition === item.condition) && (exception.edge === undefined || exception.edge === item.edge));
}

function compareFindings(baseResult, candidateResult, baseline, options = {}) {
  const blocking = [];
  const notices = [];
  const actionable = [];
  const baseMap = new Map((baseResult.findings || []).map((entry) => [entry.fingerprint, entry]));
  const candidateMap = new Map((candidateResult.findings || []).map((entry) => [entry.fingerprint, entry]));
  const baseLineMap = baselineMap(baseline || { findings: [] });
  const adoptionMap = new Set((options.adoptionFindings || []).map((entry) => entry.fingerprint));
  for (const item of candidateResult.findings || []) {
    const inBaseline = baseLineMap.has(item.fingerprint);
    const inBase = baseMap.has(item.fingerprint);
    const reproduced = adoptionMap.has(item.fingerprint);
    const exception = matchingException(item, options.exceptions);
    if (exception) {
      const scope = options.scopePaths ? new Set(options.scopePaths) : null;
      const changed = !inBase || Boolean(scope && scope.has(item.path)) || (inBase && (baseMap.get(item.fingerprint).occurrence || 1) < (item.occurrence || 1));
      const expired = exception.expires && !Number.isNaN(Date.parse(exception.expires)) && Date.parse(exception.expires) < Date.now();
      if (!expired || !changed) {
        notices.push({ type: expired ? 'exception-triage' : 'exception', message: `${expired ? 'expired unchanged' : 'approved'} exception applies: ${item.path}`, exception, finding: item });
        continue;
      }
      blocking.push({ ...item, ruleId: 'GOVERNANCE.EXPIRED_EXCEPTION', message: 'expired exception cannot cover a new or changed finding' });
      continue;
    }
    if (inBaseline && (inBase || (reproduced && options.bootstrap))) notices.push({ type: 'legacy', message: `legacy finding remains: ${item.path}`, finding: item });
    else if (inBaseline && !inBase && !reproduced) blocking.push({ ...item, message: 'baseline entry cannot self-grandfather a new finding' });
    else blocking.push({ ...item, message: inBaseline ? 'new finding or expanded occurrence' : 'new policy violation' });
  }
  const scope = options.scopePaths ? new Set(options.scopePaths) : null;
  for (const item of baseResult.findings || []) if ((!scope || scope.has(item.path)) && !candidateMap.has(item.fingerprint) && baseLineMap.has(item.fingerprint)) actionable.push({ ...item, message: 'stale baseline entry requires cleanup' });
  for (const entry of baseline && baseline.findings || []) if ((!scope || scope.has(baselineDetails(entry).path)) && !candidateMap.has(entry.fingerprint) && !actionable.some((item) => item.fingerprint === entry.fingerprint)) actionable.push({ ...baselineDetails(entry), message: 'stale baseline entry requires cleanup' });
  return { blocking, notices, actionable };
}

function validatePolicy(policy) {
  const errors = commonSchemaErrors(policy);
  const expired = [];
  if (!isSha(policy && policy.adoptionSha)) errors.push('policy adoptionSha must be a Git SHA');
  if (!Array.isArray(policy && policy.supportedRoots)) errors.push('supportedRoots must be an array');
  else {
    const roots = new Set();
    for (const root of policy.supportedRoots) {
      try { const normalized = normalizeRepoPath(root); if (normalized.includes('/')) errors.push(`supported root must be a single path segment: ${root}`); if (roots.has(normalized)) errors.push(`duplicate supported root: ${root}`); roots.add(normalized); } catch (error) { errors.push(error.message); }
    }
  }
  if (!Array.isArray(policy && policy.rootEntries)) errors.push('rootEntries must be an array');
  else for (const entry of policy.rootEntries) {
    const name = typeof entry === 'string' ? entry : entry && (entry.path || entry.pattern);
    if (!name || (typeof entry !== 'string' && typeof entry.role !== 'string')) errors.push('rootEntries require path/pattern and role');
    if (entry && entry.path) try { normalizeRepoPath(entry.path); } catch (error) { errors.push(error.message); }
  }
  if (policy && policy.registeredRootEntries !== undefined) {
    if (!Array.isArray(policy.registeredRootEntries)) errors.push('registeredRootEntries must be an array');
    else for (const entry of policy.registeredRootEntries) {
      if (typeof entry !== 'string' || !entry) errors.push('registeredRootEntries must contain nonempty paths');
      else try { normalizeRepoPath(entry); } catch (error) { errors.push(error.message); }
    }
  }
  if (!Array.isArray(policy && policy.domains)) errors.push('domains must be an array');
  else {
    const domainIds = new Set();
    for (const domain of policy.domains) {
      if (!domain || typeof domain.id !== 'string' || !Array.isArray(domain.roots) || typeof domain.owner !== 'string') { errors.push('domains require id, roots, and owner'); continue; }
      if (domainIds.has(domain.id)) errors.push(`duplicate domain id: ${domain.id}`);
      domainIds.add(domain.id);
      for (const root of domain.roots) if (typeof root !== 'string' || !root.trim()) errors.push(`domain ${domain.id} roots must contain nonempty strings`);
    }
  }
  if (!policy || !policy.artifactClasses || Array.isArray(policy.artifactClasses) || typeof policy.artifactClasses !== 'object') errors.push('artifactClasses must be an object of finite path patterns');
  else for (const [name, patterns] of Object.entries(policy.artifactClasses)) if (!Array.isArray(patterns) || patterns.some((value) => typeof value !== 'string' || !value)) errors.push(`artifactClasses.${name} must contain path patterns`);
  if (!Array.isArray(policy && policy.commands)) errors.push('commands must be an array');
  else for (const command of policy.commands) if (!command || typeof command.name !== 'string' || typeof command.program !== 'string' || !Array.isArray(command.args) || typeof command.target !== 'string' || !Array.isArray(command.effects)) errors.push('commands require name, program, args, target, and effects');
  if (!Array.isArray(policy && policy.generatedFamilies)) errors.push('generatedFamilies must be an array');
  else for (const family of policy.generatedFamilies) {
    if (!family || typeof family.id !== 'string' || typeof family.generator !== 'string' || typeof family.owner !== 'string') { errors.push('generatedFamilies require id, generator, and owner'); continue; }
    const pairs = family.comparisonPairs || ((family.source || family.sources) ? [{ source: (family.source || family.sources)[0], outputs: family.outputs || [], comparisonMode: family.comparisonMode }] : []);
    if (!pairs.length) errors.push(`generated family ${family.id} has no comparison pair`);
    for (const pair of pairs) if (!pair || typeof pair.source !== 'string' || !Array.isArray(pair.outputs) || !['byte-identical', 'ordered-json-array'].includes(pair.comparisonMode)) errors.push(`generated family ${family.id} has invalid comparison pair`);
    for (const identityPath of [...(family.canonicalInputs || []), ...(family.requiredOutputs || [])]) {
      if (typeof identityPath !== 'string' || !identityPath) errors.push(`generated family ${family.id} has invalid registered path`);
      else try { normalizeRepoPath(identityPath); } catch (error) { errors.push(error.message); }
    }
    if (family.identity && (family.identity.count !== undefined && (!Number.isInteger(family.identity.count) || family.identity.count < 0))) errors.push(`generated family ${family.id} identity count is invalid`);
  }
  if (policy && Array.isArray(policy.exceptions)) for (const exception of policy.exceptions) {
    if (!exception || !exception.path || !exception.ruleId || !exception.owner || exception.owner === 'unassigned' || !exception.rationale || !exception.evidence || !exception.approval || !exception.reviewDate) errors.push(`exception metadata incomplete for ${exception && exception.path}`);
    if (exception && exception.path) try { normalizeRepoPath(exception.path); } catch (error) { errors.push(error.message); }
    if (exception && [exception.path, exception.ruleId, exception.condition, exception.edge].some((value) => typeof value === 'string' && /[*?\[\]]/.test(value))) errors.push(`exception matching fields must be exact, without wildcards: ${exception.path}`);
    if (exception && exception.expires && Number.isNaN(Date.parse(exception.expires))) errors.push(`exception expiry is invalid: ${exception.path}`);
    if (exception && exception.expires && !Number.isNaN(Date.parse(exception.expires)) && Date.parse(exception.expires) < Date.now()) {
      expired.push(exception);
      if (exception.expanded === true) errors.push(`expired exception cannot be expanded: ${exception.path}`);
    }
  }
  return { ok: errors.length === 0, errors, expired };
}

function compareGovernance(basePolicy, candidatePolicy, baseBaseline, candidateBaseline, options = {}) {
  const notices = [];
  const blocking = [];
  const baseValidation = validatePolicy(basePolicy || {});
  const candidateValidation = validatePolicy(candidatePolicy || {});
  if (!candidateValidation.ok) blocking.push(...candidateValidation.errors.map((message) => ({ ruleId: 'GOVERNANCE.SCHEMA', path: 'scripts/structure/policy.json', message })));
  const baseRoots = new Set(basePolicy && basePolicy.supportedRoots || []);
  const candidateRoots = new Set(candidatePolicy && candidatePolicy.supportedRoots || []);
  const widenedRoots = [...candidateRoots].filter((root) => !baseRoots.has(root));
  if (widenedRoots.length) {
    notices.push({ type: 'governance-review', message: `governance review required for widened roots: ${widenedRoots.join(', ')}`, affectedPaths: options.changedPaths || [] });
  }
  const baseFamilies = JSON.stringify(basePolicy && basePolicy.generatedFamilies || []);
  const candidateFamilies = JSON.stringify(candidatePolicy && candidatePolicy.generatedFamilies || []);
  const artifactChanged = JSON.stringify(basePolicy && basePolicy.artifactClasses || {}) !== JSON.stringify(candidatePolicy && candidatePolicy.artifactClasses || {});
  const rootsChanged = JSON.stringify(basePolicy && basePolicy.supportedRoots || []) !== JSON.stringify(candidatePolicy && candidatePolicy.supportedRoots || []) || JSON.stringify(basePolicy && basePolicy.rootEntries || []) !== JSON.stringify(candidatePolicy && candidatePolicy.rootEntries || []) || JSON.stringify(basePolicy && basePolicy.registeredRootEntries || []) !== JSON.stringify(candidatePolicy && candidatePolicy.registeredRootEntries || []);
  const familiesChanged = baseFamilies !== candidateFamilies;
  if (familiesChanged) notices.push({ type: 'governance-review', message: 'governance review required for generated-family coverage change', affectedPaths: options.changedPaths || [] });
  const baseCommands = JSON.stringify(basePolicy && basePolicy.commands || []);
  if (baseCommands !== JSON.stringify(candidatePolicy && candidatePolicy.commands || [])) notices.push({ type: 'governance-review', message: 'governance review required for command registry change', affectedPaths: options.changedPaths || [] });
  if (artifactChanged) notices.push({ type: 'governance-review', message: 'governance review required for artifact coverage change', affectedPaths: options.changedPaths || [] });
  if (rootsChanged) notices.push({ type: 'governance-review', message: 'governance review required for root/entry coverage change', affectedPaths: options.changedPaths || [] });
  if (familiesChanged || artifactChanged || rootsChanged) for (const candidatePath of options.affectedPaths || []) {
    const baseResult = analyzePaths([candidatePath], basePolicy || {}, { treeSha: options.baseSha });
    const candidateResult = analyzePaths([candidatePath], candidatePolicy || {}, { treeSha: options.candidateSha });
    const baseFingerprints = baseResult.findings.map((item) => item.fingerprint).sort();
    const candidateFingerprints = candidateResult.findings.map((item) => item.fingerprint).sort();
    if (JSON.stringify(baseFingerprints) !== JSON.stringify(candidateFingerprints)) blocking.push({ ruleId: 'GOVERNANCE.COVERAGE_CHANGE', path: candidatePath, message: 'candidate policy changes the finding coverage for an affected path; governance review cannot self-approve it' });
  }
  if ((options.changedPaths || []).includes('scripts/structure/check.cjs')) notices.push({ type: 'governance-review', message: 'governance review required for checker implementation change', affectedPaths: options.changedPaths });
  const baselineAdded = new Set((candidateBaseline && candidateBaseline.findings || []).map((entry) => entry.fingerprint));
  for (const entry of baseBaseline && baseBaseline.findings || []) baselineAdded.delete(entry.fingerprint);
  if (baselineAdded.size) notices.push({ type: 'governance-review', message: `governance review required for ${baselineAdded.size} baseline additions`, affectedPaths: [...baselineAdded] });
  return { ok: blocking.length === 0, blocking, notices, baseValidation, candidateValidation };
}

function validateCommands(policy, existingPaths) {
  const findings = [];
  const paths = new Set(existingPaths);
  for (const command of policy.commands || []) {
    if (!command || typeof command.name !== 'string' || typeof command.program !== 'string' || !Array.isArray(command.args) || typeof command.target !== 'string' || !Array.isArray(command.effects)) { findings.push(finding('R5.COMMAND_SCHEMA', 'package.json', 'command declaration incomplete')); continue; }
    if (!paths.has(command.target)) findings.push(finding('R5.COMMAND_TARGET', command.target, `command ${command.name} target does not exist`));
    if (command.effects.some((effect) => !['read-only', 'local-write', 'external-temp', 'emulator-write', 'remote-write', 'billable'].includes(effect))) findings.push(finding('R5.COMMAND_EFFECT', command.name, 'unsupported command effect'));
    if (command.program === 'node' && command.args.length && !command.args.includes(command.target)) findings.push(finding('R5.COMMAND_ARGUMENTS', command.name, 'declared node target is absent from arguments'));
  }
  return { ok: findings.length === 0, findings };
}

function validatePackageScripts(policy, packageJson) {
  const findings = [];
  const scripts = packageJson && packageJson.scripts;
  if (!scripts || typeof scripts !== 'object') return { ok: false, findings: [finding('R5.PACKAGE_SCRIPTS', 'package.json', 'package scripts are missing')] };
  for (const command of policy.commands || []) {
    const expected = [command.program, ...(command.args || [])].join(' ');
    if (scripts[command.name] !== expected) findings.push(finding('R5.PACKAGE_COMMAND', 'package.json', `script ${command.name} must equal the declared program and arguments`));
  }
  return { ok: findings.length === 0, findings };
}

function comparePackageScripts(basePackageJson, candidatePackageJson, policy) {
  const findings = [];
  const notices = [];
  const baseScripts = basePackageJson && basePackageJson.scripts && typeof basePackageJson.scripts === 'object' ? basePackageJson.scripts : {};
  const candidateScripts = candidatePackageJson && candidatePackageJson.scripts && typeof candidatePackageJson.scripts === 'object' ? candidatePackageJson.scripts : {};
  const registered = new Set((policy && policy.commands || []).map((command) => command && command.name).filter(Boolean));
  for (const name of new Set([...Object.keys(baseScripts), ...Object.keys(candidateScripts)])) {
    if (baseScripts[name] === candidateScripts[name]) continue;
    if (candidateScripts[name] === undefined) {
      if (!registered.has(name)) notices.push({ type: 'command-scope', message: `existing complex npm script was removed outside declared command scope: ${name}`, path: 'package.json' });
      continue;
    }
    if (registered.has(name)) continue;
    const message = `changed npm script ${name} is outside the declared command registry`;
    findings.push({ ...finding('R5.PACKAGE_UNDECLARED', 'package.json', message), message });
  }
  for (const name of Object.keys(baseScripts)) if (candidateScripts[name] === baseScripts[name] && !registered.has(name)) notices.push({ type: 'command-scope', message: `existing complex npm script remains outside declared command scope: ${name}`, path: 'package.json' });
  return { ok: findings.length === 0, findings, notices };
}

function parseJsonBytes(bytes, label) { try { return JSON.parse(Buffer.from(bytes).toString('utf8')); } catch (error) { throw new Error(`invalid JSON in ${label}: ${error.message}`); } }

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
}

function canonicalJsonHashWithoutField(value, fieldName) {
  const copy = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : value;
  if (copy && typeof copy === 'object' && !Array.isArray(copy)) delete copy[fieldName];
  return sha256(JSON.stringify(canonicalJson(copy)));
}

function compareGeneratedFamily(family, files) {
  const findings = [];
  for (const required of family.canonicalInputs || []) if (!files[required]) findings.push(finding('R3.FAMILY_INPUT_MISSING', required, 'registered canonical input is missing'));
  for (const required of family.requiredOutputs || []) if (!files[required]) findings.push(finding('R3.FAMILY_OUTPUT_MISSING', required, 'registered generated output is missing'));
  if (Array.isArray(family.comparisonPairs)) {
    for (const pair of family.comparisonPairs) {
      const sourceBytes = files[pair.source] && (files[pair.source].bytes || files[pair.source]);
      if (!sourceBytes) { findings.push(finding('R3.FAMILY_MISSING', pair.source, 'canonical comparison source is missing')); continue; }
      for (const output of pair.outputs || []) {
        const outputBytes = files[output] && (files[output].bytes || files[output]);
        if (!outputBytes) { findings.push(finding('R3.FAMILY_MISSING', output, 'generated comparison output is missing')); continue; }
        if (pair.comparisonMode === 'byte-identical' && !Buffer.from(sourceBytes).equals(Buffer.from(outputBytes))) findings.push(finding('R3.FAMILY_MISMATCH', output, 'generated bytes differ from canonical comparison source'));
        if (pair.comparisonMode === 'ordered-json-array') {
          const sourceJson = parseJsonBytes(sourceBytes, pair.source);
          const outputJson = parseJsonBytes(outputBytes, output);
          if (JSON.stringify(sourceJson) !== JSON.stringify(outputJson)) findings.push(finding('R3.FAMILY_SEMANTIC_MISMATCH', output, 'ordered JSON values differ'));
        }
      }
    }
    if (family.identity) {
      const identitySource = family.identity.source || (family.comparisonPairs[0] && family.comparisonPairs[0].source);
      const sourceBytes = files[identitySource] && (files[identitySource].bytes || files[identitySource]);
      if (!sourceBytes) findings.push(finding('R3.IDENTITY_MISSING', identitySource || family.id || 'generated-family', 'identity source is missing'));
      else {
        const sourceJson = parseJsonBytes(sourceBytes, identitySource);
        const entries = family.identity.entriesPath ? String(family.identity.entriesPath).split('.').reduce((value, key) => value && value[key], sourceJson) : sourceJson;
        if (Number.isFinite(family.identity.count) && (!Array.isArray(entries) || entries.length !== family.identity.count)) findings.push(finding('R3.IDENTITY_COUNT', identitySource, `expected identity count ${family.identity.count}`));
        if (family.identity.manifestHashField) {
          const actualHash = canonicalJsonHashWithoutField(sourceJson, family.identity.manifestHashField);
          if (sourceJson[family.identity.manifestHashField] !== actualHash) findings.push(finding('R3.IDENTITY_MANIFEST', identitySource, 'stored manifest hash does not match canonical content'));
          if (family.identity.canonicalManifestSha256 && actualHash !== family.identity.canonicalManifestSha256) findings.push(finding('R3.IDENTITY_MANIFEST', identitySource, 'canonical manifest hash does not match reviewed identity'));
        }
        for (const [field, expected] of Object.entries(family.identity.manifestFields || {})) if (sourceJson[field] !== expected) findings.push(finding('R3.IDENTITY_MANIFEST', identitySource, `${field} does not match reviewed identity`));
        for (const pair of family.comparisonPairs) for (const output of pair.outputs || []) {
          const outputBytes = files[output] && (files[output].bytes || files[output]);
          if (!outputBytes) continue;
          const outputJson = parseJsonBytes(outputBytes, output);
          const outputEntries = family.identity.entriesPath ? String(family.identity.entriesPath).split('.').reduce((value, key) => value && value[key], outputJson) : outputJson;
          if (Number.isFinite(family.identity.count) && (!Array.isArray(outputEntries) || outputEntries.length !== family.identity.count)) findings.push(finding('R3.IDENTITY_COUNT', output, `expected identity count ${family.identity.count}`));
          if (family.identity.manifestHashField) {
            const actualHash = canonicalJsonHashWithoutField(outputJson, family.identity.manifestHashField);
            if (outputJson[family.identity.manifestHashField] !== actualHash) findings.push(finding('R3.IDENTITY_MANIFEST', output, 'generated manifest hash does not match canonical content'));
            if (family.identity.canonicalManifestSha256 && actualHash !== family.identity.canonicalManifestSha256) findings.push(finding('R3.IDENTITY_MANIFEST', output, 'generated manifest hash does not match reviewed identity'));
          }
          for (const [field, expected] of Object.entries(family.identity.manifestFields || {})) if (outputJson[field] !== expected) findings.push(finding('R3.IDENTITY_MANIFEST', output, `${field} does not match reviewed identity`));
        }
      }
    }
    return { ok: findings.length === 0, findings };
  }
  const sources = family.source || family.sources || [];
  const outputs = family.outputs || [];
  if (!sources.length || !outputs.length) return { ok: false, findings: [finding('R3.FAMILY_SCHEMA', family.id || 'generated-family', 'source and outputs are required')] };
  const sourceBytes = files[sources[0]] && (files[sources[0]].bytes || files[sources[0]]);
  if (!sourceBytes) findings.push(finding('R3.FAMILY_MISSING', sources[0], 'canonical source is missing'));
  for (const output of outputs) {
    const outputBytes = files[output] && (files[output].bytes || files[output]);
    if (!outputBytes) { findings.push(finding('R3.FAMILY_MISSING', output, 'generated output is missing')); continue; }
    if (sourceBytes && family.comparisonMode === 'byte-identical' && !Buffer.from(sourceBytes).equals(Buffer.from(outputBytes))) findings.push(finding('R3.FAMILY_MISMATCH', output, 'generated bytes differ from canonical source'));
    if (sourceBytes && family.comparisonMode === 'ordered-json-array') {
      const sourceJson = parseJsonBytes(sourceBytes, sources[0]);
      const outputJson = parseJsonBytes(outputBytes, output);
      if (!Array.isArray(sourceJson) || !Array.isArray(outputJson) || JSON.stringify(sourceJson) !== JSON.stringify(outputJson)) findings.push(finding('R3.FAMILY_SEMANTIC_MISMATCH', output, 'ordered JSON arrays differ'));
    }
  }
  return { ok: findings.length === 0, findings };
}

function collectDeclaredChanges(contract) {
  const declared = new Set();
  for (const key of ['create', 'modify', 'delete']) for (const value of contract.changes[key] || []) declared.add(normalizeRepoPath(value));
  for (const entry of contract.changes.rename || []) {
    const from = typeof entry === 'string' ? entry : entry.from || entry.old;
    const to = typeof entry === 'string' ? entry : entry.to || entry.new;
    declared.add(normalizeRepoPath(from)); declared.add(normalizeRepoPath(to));
  }
  return declared;
}

function outputRoots(contract, repositoryRoot = process.cwd()) { return (contract.outputs || []).filter((output) => !path.isAbsolute(output.root)).map((output) => path.resolve(repositoryRoot, ...output.root.replaceAll('\\', '/').split('/'))).concat((contract.outputs || []).filter((output) => path.isAbsolute(output.root)).map((output) => path.resolve(output.root))); }
function isInOutputRoot(absolute, roots) { return roots.some((root) => isInside(absolute, root)); }

function entryHash(root, rel, entry) {
  if (!entry) return null;
  if (entry.sha256) return entry.sha256;
  if (entry.bytes) return sha256(entry.bytes);
  if (entry.absolute) return hashFile(entry.absolute);
  const absolute = path.join(root, ...rel.split('/'));
  return fs.existsSync(absolute) ? hashFile(absolute) : null;
}

function statusPaths(root) {
  const raw = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).toString('utf8');
  const result = [];
  for (const record of raw.split('\0')) {
    if (!record) continue;
    const value = record.slice(3);
    if (!value) continue;
    if (value.includes(' -> ')) result.push(...value.split(' -> ').map((part) => normalizeRepoPath(part)));
    else result.push(normalizeRepoPath(value));
  }
  return result;
}

function indexPaths(root) {
  const raw = git(root, ['diff', '--cached', '--name-status', '-z']).toString('utf8');
  const result = [];
  const tokens = raw.toString('utf8').split('\0').filter(Boolean);
  for (let i = 0; i < tokens.length;) {
    const first = tokens[i++];
    const parts = first.split('\t');
    const status = parts[0] || '';
    const firstPath = parts[1] || tokens[i++];
    if (firstPath) result.push(normalizeRepoPath(firstPath));
    if ((status.startsWith('R') || status.startsWith('C')) && i < tokens.length) result.push(normalizeRepoPath(tokens[i++]));
  }
  return result;
}

function gitIndexState(root) {
  const raw = git(root, ['ls-files', '--stage', '-z']).toString('utf8');
  const state = {};
  for (const record of raw.split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab < 0) throw new Error(`unsupported git index record: ${record.slice(0, 120)}`);
    const header = record.slice(0, tab).split(' ');
    const rel = normalizeRepoPath(record.slice(tab + 1));
    if (header.length !== 3 || !/^[0-9a-f]{40}$/i.test(header[1]) || !/^\d+$/.test(header[2])) throw new Error(`invalid git index metadata: ${record.slice(0, 120)}`);
    state[rel] = { mode: header[0], oid: header[1], stage: Number(header[2]) };
  }
  return state;
}

function changedIndexPaths(root, beforeIndex) {
  const current = gitIndexState(root);
  const previous = beforeIndex && typeof beforeIndex === 'object' ? beforeIndex : null;
  const names = new Set([...Object.keys(current), ...(previous ? Object.keys(previous) : [])]);
  const changed = [];
  for (const name of names) {
    if (!previous || JSON.stringify(current[name] || null) !== JSON.stringify(previous[name] || null)) changed.push(name);
  }
  return { current, changed };
}

function diffPaths(root, baseSha, headSha) {
  const raw = git(root, ['diff', '--name-status', '-z', baseSha, headSha]).toString('utf8');
  const tokens = raw.split('\0').filter(Boolean);
  const result = [];
  for (let i = 0; i < tokens.length;) {
    const first = tokens[i++];
    const parts = first.split('\t');
    const status = parts[0] || '';
    const firstPath = parts[1] || tokens[i++];
    if (firstPath) result.push(normalizeRepoPath(firstPath));
    if ((status.startsWith('R') || status.startsWith('C')) && i < tokens.length) result.push(normalizeRepoPath(tokens[i++]));
  }
  return result;
}

function checkLocal(options) {
  const root = path.resolve(options.root || process.cwd());
  const contract = options.contract;
  const snapshot = options.snapshot;
  const policy = options.policy;
  const errors = [...(validateContract(contract, { repositoryRoot: root }).errors), ...(validateSnapshot(snapshot, contract, options.contractBytes || JSON.stringify(contract)).errors)];
  try { ensureSha(options.baseSha || contract.baseSha, 'base SHA'); resolveTreeRef(root, options.baseSha || contract.baseSha); } catch (error) { errors.push(error.message); }
  if (options.baseSha && contract.baseSha !== options.baseSha) errors.push('contract baseSha does not match --base');
  if (options.baseSha && snapshot.baseSha !== options.baseSha) errors.push('snapshot baseSha does not match --base');
  if (policy && policy.adoptionSha !== ADOPTION_SHA) errors.push(`policy adoptionSha must remain ${ADOPTION_SHA}`);
  const policyValidation = validatePolicy(policy);
  errors.push(...policyValidation.errors);
  try {
    const snapshotRoot = fs.realpathSync.native(path.resolve(snapshot.root));
    const currentRoot = fs.realpathSync.native(root);
    if (snapshotRoot !== currentRoot) errors.push('snapshot root does not match current repository root');
  } catch (error) { errors.push(`repository root identity could not be verified: ${error.message}`); }
  if (typeof snapshot.gitStatus === 'string' && snapshot.gitStatus.trim() && snapshot.index === undefined) errors.push('snapshot captured a dirty or ambiguous Git state without index metadata');
  if (errors.length) return { status: EXIT_CODES.INPUT, blocking: errors.map((message) => ({ ruleId: 'INPUT.SCHEMA', path: '', message })), notices: [], actionable: [], errors };
  let baseFindings = [];
  try {
    const baseTree = policyFromTree(root, options.baseSha || contract.baseSha);
    const basePolicy = baseTree.policy || policy;
    if (baseTree.policy) {
      const baseValidation = validatePolicy(baseTree.policy);
      if (!baseValidation.ok) throw new Error(baseValidation.errors.join('; '));
    }
    baseFindings = analyzePaths([...baseTree.files.keys()], basePolicy, { treeSha: options.baseSha || contract.baseSha }).findings;
  } catch (error) {
    const message = `base tree analysis failed: ${error.message}`;
    return { status: EXIT_CODES.INPUT, blocking: [{ ruleId: 'INPUT.ANALYSIS', path: '', message }], notices: [], actionable: [], errors: [message] };
  }
  const tree = options.currentFiles instanceof Map ? options.currentFiles : new Map(Object.entries(options.currentFiles || {}).map(([name, value]) => [name, Buffer.isBuffer(value) ? { bytes: value } : typeof value === 'string' ? { bytes: Buffer.from(value) } : value]));
  const before = new Map(Object.entries(snapshot.files || {}));
  const declared = collectDeclaredChanges(contract);
  const roots = outputRoots(contract, root);
  const deltaFindings = [];
  let changedByGit = [];
  let stagedPaths = [];
  let currentIndex = null;
  try { changedByGit = statusPaths(root); } catch { changedByGit = []; }
  try {
    if (snapshot.index && typeof snapshot.index === 'object' && !Array.isArray(snapshot.index)) {
      const index = changedIndexPaths(root, snapshot.index);
      currentIndex = index.current;
      stagedPaths = index.changed;
    } else {
      stagedPaths = indexPaths(root);
      try { currentIndex = gitIndexState(root); } catch { currentIndex = null; }
    }
  } catch { try { stagedPaths = indexPaths(root); } catch { stagedPaths = []; } }
  const staged = new Set(stagedPaths);
  const relevantPaths = new Set([...(options.changedPaths || []), ...changedByGit, ...stagedPaths, ...declared]);
  const allPaths = new Set([...before.keys(), ...tree.keys(), ...stagedPaths]);
  for (const rel of allPaths) {
    const current = tree.get(rel);
    const prior = before.get(rel);
    let changed = !current || !prior || staged.has(rel);
    if (!changed && relevantPaths.has(rel)) changed = entryHash(root, rel, current) !== prior.sha256;
    if (!changed && current && prior && Number.isFinite(current.size) && Number.isFinite(prior.size) && current.size !== prior.size) changed = true;
    if (!changed && current && prior && Number.isFinite(current.mtimeMs) && Number.isFinite(prior.mtimeMs) && Math.abs(current.mtimeMs - prior.mtimeMs) > 2) changed = entryHash(root, rel, current) !== prior.sha256;
    if (!changed || isInOutputRoot(path.join(root, ...rel.split('/')), roots)) continue;
    if (!declared.has(rel)) deltaFindings.push(finding('R1.UNDECLARED_CHANGE', rel, 'working-tree change was not declared', { category: 'contract' }));
  }
  const changedPaths = [...allPaths].filter((rel) => {
    const current = tree.get(rel); const prior = before.get(rel);
    if (!current || !prior || staged.has(rel)) return true;
    if (relevantPaths.has(rel)) return entryHash(root, rel, current) !== prior.sha256;
    if (Number.isFinite(current.size) && Number.isFinite(prior.size) && current.size !== prior.size) return true;
    return Number.isFinite(current.mtimeMs) && Number.isFinite(prior.mtimeMs) && Math.abs(current.mtimeMs - prior.mtimeMs) > 2;
  });
  // A deletion is audited through the contract/index delta and stale-baseline
  // comparison. It is not a candidate artifact to classify as a newly placed
  // dependency/cache/root. Keep the path in changedPaths for those audits, but
  // omit it from placement analysis when it was present in the snapshot, was
  // removed from the current index, and is absent from the checker file set.
  // The last condition matters for ignored dependency bytes: listFiles omits
  // node_modules even when an index-only removal leaves those bytes installed,
  // while a retained public/source file must remain covered by placement rules.
  // Other ignored generated files, such as Python bytecode, remain in the file
  // scan after index-only removal. Exclude only a generated artifact that the
  // base policy already classified and whose retained bytes match the snapshot.
  const snapshotIndex = snapshot.index && typeof snapshot.index === 'object' && !Array.isArray(snapshot.index) ? snapshot.index : null;
  const baseGeneratedPaths = new Set(baseFindings.filter((item) => item.ruleId === 'R4.TRACKED_DEPENDENCY' || item.ruleId === 'R4.TRACKED_CACHE').map((item) => item.path));
  const placementPaths = changedPaths.filter((rel) => {
    const wasIndexed = Boolean(snapshotIndex && Object.prototype.hasOwnProperty.call(snapshotIndex, rel));
    const isIndexed = Boolean(currentIndex && Object.prototype.hasOwnProperty.call(currentIndex, rel));
    const indexDeleted = wasIndexed && currentIndex && staged.has(rel) && !isIndexed;
    if (indexDeleted && !tree.has(rel)) return false;
    if (indexDeleted && baseGeneratedPaths.has(rel) && before.has(rel) && entryHash(root, rel, tree.get(rel)) === before.get(rel).sha256) return false;
    if (isIndexed) return true;
    return tree.has(rel);
  });
  const placement = analyzePaths(placementPaths, policy, { treeSha: options.treeSha || SHA_PLACEHOLDER });
  const baseline = options.baseline || { schemaVersion: 1, adoptionSha: policy.adoptionSha, findings: [] };
  const currentLinks = new Set(options.currentLinks || []);
  const beforeLinks = new Set(snapshot.links || []);
  for (const link of currentLinks) if (!beforeLinks.has(link) && !declared.has(link)) deltaFindings.push(finding('R1.UNDECLARED_LINK', link, 'new symlink/junction was not declared', { category: 'contract' }));
  for (const link of beforeLinks) if (!currentLinks.has(link) && !declared.has(link)) deltaFindings.push(finding('R1.UNDECLARED_LINK', link, 'pre-existing symlink/junction was removed without declaration', { category: 'contract' }));
  const comparison = compareFindings({ findings: baseFindings }, { findings: [...placement.findings, ...deltaFindings] }, baseline, { adoptionSha: policy.adoptionSha, adoptionFindings: options.adoptionFindings || [], bootstrap: false, scopePaths: changedPaths, exceptions: policy.exceptions });
  const commands = validateCommands(policy, [...tree.keys()]);
  const packageCommands = options.packageJson ? validatePackageScripts(policy, options.packageJson) : { findings: [] };
  const packageRegistry = options.basePackageJson && options.packageJson ? comparePackageScripts(options.basePackageJson, options.packageJson, policy) : { findings: [], notices: [] };
  const familyFindings = [];
  const familyFiles = {};
  for (const family of policy.generatedFamilies || []) for (const name of [...(family.source || family.sources || []), ...(family.outputs || []), ...(family.canonicalInputs || []), ...(family.requiredOutputs || []), ...((family.comparisonPairs || []).flatMap((pair) => [pair.source, ...(pair.outputs || [])])), ...(family.identity && family.identity.source ? [family.identity.source] : [])]) {
    const entry = tree.get(name);
    const absolute = path.join(root, ...name.split('/'));
    if (entry && fs.existsSync(absolute)) familyFiles[name] = { ...entry, bytes: fs.readFileSync(absolute) };
  }
  for (const family of policy.generatedFamilies || []) familyFindings.push(...compareGeneratedFamily(family, familyFiles).findings);
  if (options.adoptionFindings) {
    const adoptionFingerprints = new Set(options.adoptionFindings.map((item) => item.fingerprint));
    for (const entry of baseline.findings || []) if (!adoptionFingerprints.has(entry.fingerprint)) familyFindings.push({ ...entry, ruleId: 'BASELINE.REPRODUCTION', message: 'baseline entry is not reproducible in fixed adoption tree' });
  }
  const staleBaseline = comparison.actionable.map((item) => ({ ...item, ruleId: 'BASELINE.STALE', message: item.message }));
  const blocking = [...comparison.blocking, ...commands.findings, ...packageCommands.findings, ...packageRegistry.findings, ...familyFindings, ...staleBaseline];
  const notices = [...comparison.notices, ...comparison.actionable.map((item) => ({ type: 'baseline', message: item.message, finding: item })), ...packageRegistry.notices, ...policyValidation.expired.map((exception) => ({ type: 'exception-triage', message: `exception review date has expired: ${exception.path}`, exception }))];
  return { status: blocking.length ? EXIT_CODES.POLICY : EXIT_CODES.CLEAN, blocking, notices, actionable: comparison.actionable, errors: [], analysis: { contractSnapshot: { status: 'evaluated' }, outputHistory: { status: 'evaluated' }, scannedPaths: changedPaths, excluded: DEFAULT_EXCLUDED, index: { status: currentIndex ? 'evaluated' : 'fallback-clean-snapshot' } } };
}

function makeCiReport(options) {
  return { status: (options.findings || []).length ? EXIT_CODES.POLICY : EXIT_CODES.CLEAN, blocking: options.findings || [], notices: options.notices || [], actionable: options.actionable || [], analysis: { contractSnapshot: { status: 'not-evaluated' }, outputHistory: { status: 'not-evaluated' }, scannedPaths: options.scannedPaths || [], excluded: options.excluded || DEFAULT_EXCLUDED } };
}

function filesObject(map) { const result = {}; for (const [name, value] of map) result[name] = value; return result; }

function verifyReleaseIdentity(expected, candidate) {
  const blocking = [];
  if (!expected || !isSha(expected.sha)) blocking.push({ ruleId: 'R8.EXPECTED_SHA', message: 'trusted expected SHA is required' });
  if (!candidate || candidate.sourceSha !== expected.sha) blocking.push({ ruleId: 'R8.SOURCE_SHA', message: 'candidate source SHA does not match trusted expected SHA' });
  const expectedFiles = expected && expected.files;
  if (!expectedFiles || typeof expectedFiles !== 'object' || Array.isArray(expectedFiles) || Object.keys(expectedFiles).length === 0) blocking.push({ ruleId: 'R8.MANIFEST', message: 'trusted expected file/hash manifest is required' });
  const requiredHydrated = expected && expected.requiredHydrated;
  if (requiredHydrated !== undefined) {
    if (!Array.isArray(requiredHydrated) || requiredHydrated.some((name) => typeof name !== 'string' || !name)) blocking.push({ ruleId: 'R8.HYDRATED_SCHEMA', message: 'requiredHydrated must be an array of file paths' });
    else for (const name of requiredHydrated) {
      try { normalizeRepoPath(name); } catch (error) { blocking.push({ ruleId: 'R8.HYDRATED_PATH', path: name, message: error.message }); continue; }
      if (!expectedFiles || !Object.prototype.hasOwnProperty.call(expectedFiles, name)) blocking.push({ ruleId: 'R8.HYDRATED_MANIFEST', path: name, message: 'required hydrated file is absent from trusted manifest' });
    }
  }
  let candidateFiles = candidate && candidate.files ? candidate.files : null;
  if (!candidateFiles && candidate && candidate.directory) try { candidateFiles = readSafeCandidateDirectory(candidate.directory); } catch (error) { blocking.push({ ruleId: 'R8.CANDIDATE_DIRECTORY', message: error.message }); }
  if (!candidateFiles || typeof candidateFiles !== 'object' || Array.isArray(candidateFiles)) blocking.push({ ruleId: 'R8.CANDIDATE_FILES', message: 'candidate files or safe candidate directory is required' });
  const expectedMap = expectedFiles && typeof expectedFiles === 'object' ? expectedFiles : {};
  const candidateMap = candidateFiles && typeof candidateFiles === 'object' ? candidateFiles : {};
  const expectedNames = Object.keys(expectedMap).sort();
  const candidateNames = Object.keys(candidateMap).sort();
  if (JSON.stringify(expectedNames) !== JSON.stringify(candidateNames)) blocking.push({ ruleId: 'R8.FILE_SET', message: 'candidate files do not exactly match approved manifest' });
  for (const name of expectedNames) {
    const value = candidateMap[name];
    const bytes = Buffer.isBuffer(value) ? value : typeof value === 'string' ? Buffer.from(value) : null;
    if (!bytes) { blocking.push({ ruleId: 'R8.FILE_MISSING', path: name, message: 'required candidate file is missing' }); continue; }
    const expectedHash = typeof expectedMap[name] === 'string' ? expectedMap[name] : expectedMap[name] && expectedMap[name].sha256;
    if (!/^[0-9a-f]{64}$/i.test(expectedHash || '') || sha256(bytes) !== expectedHash) blocking.push({ ruleId: 'R8.FILE_HASH', path: name, message: 'candidate file hash differs from trusted manifest' });
    if ((requiredHydrated || []).includes(name) && LFS_POINTER.test(bytes.toString('utf8'))) blocking.push({ ruleId: 'R8.LFS_POINTER', path: name, message: 'required hydrated media is still an LFS pointer' });
  }
  return { ok: blocking.length === 0, blocking };
}

function readSafeCandidateDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('candidate directory must be absolute');
  const root = path.resolve(directory);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) throw new Error('candidate directory is not a safe real directory');
  const files = {};
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`candidate directory contains symlink/junction: ${absolute}`);
      if (entry.isDirectory()) { visit(absolute); continue; }
      if (entry.isFile()) files[normalizeRepoPath(path.relative(root, absolute))] = fs.readFileSync(absolute);
    }
  }
  visit(root);
  return files;
}

function readJsonFile(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')); }
function validateExternalInputFile(filePath, repositoryRoot) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('contract and snapshot inputs must be absolute paths');
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved) || !fs.lstatSync(resolved).isFile()) throw new Error(`external input is not a regular file: ${resolved}`);
  const repoReal = fs.realpathSync.native(path.resolve(repositoryRoot));
  const inputReal = fs.realpathSync.native(resolved);
  if (isInside(inputReal, repoReal)) throw new Error(`external input must be outside repository: ${resolved}`);
  return resolved;
}
function resolveTreeRef(root, sha) { ensureSha(sha, 'tree SHA'); git(root, ['cat-file', '-e', `${sha}^{commit}`]); return sha; }

function policyFromTree(root, treeSha, policyOverride = null) {
  const files = readGitTree(root, treeSha);
  const metadataPaths = ['scripts/structure/policy.json', 'scripts/structure/legacy-baseline.json', 'package.json'];
  const metadata = readGitBlobs(root, files, metadataPaths);
  const policy = policyOverride || (metadata.has('scripts/structure/policy.json') ? parseJsonBytes(metadata.get('scripts/structure/policy.json').bytes, 'scripts/structure/policy.json') : null);
  const familyPaths = [];
  for (const family of policy && policy.generatedFamilies || []) {
    familyPaths.push(...(family.source || family.sources || []), ...(family.outputs || []), ...(family.canonicalInputs || []), ...(family.requiredOutputs || []));
    for (const pair of family.comparisonPairs || []) familyPaths.push(pair.source, ...(pair.outputs || []));
    if (family.identity && family.identity.source) familyPaths.push(family.identity.source);
  }
  const loaded = readGitBlobs(root, files, [...metadataPaths, ...familyPaths]);
  for (const [name, value] of loaded) files.set(name, value);
  return { files, policy, baseline: metadata.has('scripts/structure/legacy-baseline.json') ? parseJsonBytes(metadata.get('scripts/structure/legacy-baseline.json').bytes, 'scripts/structure/legacy-baseline.json') : null };
}

function runCi(options) {
  const root = path.resolve(options.root || process.cwd());
  const head = options.head || (() => { const value = git(root, ['rev-parse', 'HEAD']).toString('utf8').trim(); ensureSha(value, 'HEAD'); return value; })();
  resolveTreeRef(root, head);
  if (!options.full && !options.base) throw new Error('CI check requires --base or --full');
  if (options.base) resolveTreeRef(root, options.base);
  const candidate = policyFromTree(root, head);
  if (!candidate.policy || !candidate.baseline) throw new Error('candidate policy and baseline are required');
  if (candidate.policy.adoptionSha !== ADOPTION_SHA || candidate.baseline.adoptionSha !== ADOPTION_SHA) throw new Error(`adoptionSha must remain ${ADOPTION_SHA}`);
  const candidatePolicyValidation = validatePolicy(candidate.policy);
  const candidateBaselineValidation = validateBaseline(candidate.baseline);
  if (!candidatePolicyValidation.ok || !candidateBaselineValidation.ok) throw new Error([...candidatePolicyValidation.errors, ...candidateBaselineValidation.errors].join('; '));
  const candidateAnalysis = analyzePaths([...candidate.files.keys()], candidate.policy, { treeSha: head });
  const candidateFamilies = [];
  for (const family of candidate.policy.generatedFamilies || []) candidateFamilies.push(...compareGeneratedFamily(family, filesObject(candidate.files)).findings);
  const candidateFindings = [...candidateAnalysis.findings, ...candidateFamilies];
  const commandFindings = validateCommands(candidate.policy, [...candidate.files.keys()]).findings;
  const packageBytes = candidate.files.get('package.json') && candidate.files.get('package.json').bytes;
  const candidatePackageJson = packageBytes ? parseJsonBytes(packageBytes, 'package.json') : null;
  const packageFindings = candidatePackageJson ? validatePackageScripts(candidate.policy, candidatePackageJson).findings : [];
  candidateFindings.push(...commandFindings, ...packageFindings);
  let baseAnalysis = { findings: [] };
  let governance = { blocking: [], notices: [] };
  let adoptionFindings = [];
  let bootstrap = false;
  let previousPackageJson = null;
  let actualChangedPaths = [];
  if (options.full) {
    if (candidate.policy.adoptionSha !== ADOPTION_SHA || candidate.baseline.adoptionSha !== ADOPTION_SHA) throw new Error(`adoptionSha must remain ${ADOPTION_SHA}`);
    const adoption = policyFromTree(root, ADOPTION_SHA);
    const adoptionPackage = adoption.files.get('package.json') && adoption.files.get('package.json').bytes;
    previousPackageJson = adoptionPackage ? parseJsonBytes(adoptionPackage, 'package.json') : null;
    const adoptionPolicy = candidate.policy;
    actualChangedPaths = diffPaths(root, ADOPTION_SHA, head);
    adoptionFindings = analyzePaths([...adoption.files.keys()], adoptionPolicy, { treeSha: ADOPTION_SHA }).findings;
    const baselineSet = new Set(candidate.baseline.findings.map((entry) => entry.fingerprint));
    for (const entry of candidate.baseline.findings) if (!adoptionFindings.some((item) => item.fingerprint === entry.fingerprint)) baseAnalysis.findings.push({ ...entry, message: 'baseline entry is not reproducible in fixed adoption tree' });
    baseAnalysis = { findings: adoptionFindings };
  } else {
    const base = policyFromTree(root, options.base);
    if (!base.policy || !base.baseline) {
      bootstrap = true;
      const adoption = policyFromTree(root, ADOPTION_SHA);
      const adoptionPackage = adoption.files.get('package.json') && adoption.files.get('package.json').bytes;
      previousPackageJson = adoptionPackage ? parseJsonBytes(adoptionPackage, 'package.json') : null;
      adoptionFindings = analyzePaths([...adoption.files.keys()], candidate.policy, { treeSha: ADOPTION_SHA }).findings;
      baseAnalysis = { findings: adoptionFindings };
      const initialPaths = diffPaths(root, options.base, head);
      actualChangedPaths = initialPaths;
      governance = { blocking: [], notices: [{ type: 'governance-review', message: 'initial adoption bootstrap requires human governance review; historical findings are evaluated against the fixed adoption tree', affectedPaths: initialPaths.filter((name) => name.startsWith('scripts/structure/')) }] };
    } else {
      const basePolicyValidation = validatePolicy(base.policy);
      const baseBaselineValidation = validateBaseline(base.baseline);
      if (!basePolicyValidation.ok || !baseBaselineValidation.ok) throw new Error([...basePolicyValidation.errors, ...baseBaselineValidation.errors].join('; '));
      if (base.policy.adoptionSha !== ADOPTION_SHA || base.baseline.adoptionSha !== ADOPTION_SHA) throw new Error(`base adoptionSha must remain ${ADOPTION_SHA}`);
      const basePackage = base.files.get('package.json') && base.files.get('package.json').bytes;
      previousPackageJson = basePackage ? parseJsonBytes(basePackage, 'package.json') : null;
      baseAnalysis = analyzePaths([...base.files.keys()], base.policy, { treeSha: options.base });
      const changed = diffPaths(root, options.base, head);
      actualChangedPaths = changed;
      governance = compareGovernance(base.policy, candidate.policy, base.baseline, candidate.baseline, { baseSha: options.base, candidateSha: head, changedPaths: changed.filter((name) => name.startsWith('scripts/structure/')), affectedPaths: changed });
    }
  }
  const packageRegistry = comparePackageScripts(previousPackageJson, candidatePackageJson, candidate.policy);
  const packageRegistryFindings = packageRegistry.findings;
  const comparison = compareFindings(baseAnalysis, { findings: candidateFindings }, candidate.baseline, { adoptionSha: ADOPTION_SHA, adoptionFindings, bootstrap, exceptions: candidate.policy.exceptions, scopePaths: actualChangedPaths });
  const staleBaseline = comparison.actionable.map((item) => ({ ...item, ruleId: 'BASELINE.STALE', message: item.message }));
  const findings = [...comparison.blocking, ...governance.blocking, ...packageRegistryFindings, ...staleBaseline];
  const notices = [...comparison.notices, ...comparison.actionable.map((item) => ({ type: 'baseline', message: item.message, finding: item })), ...governance.notices, ...packageRegistry.notices, ...candidatePolicyValidation.expired.map((exception) => ({ type: 'exception-triage', message: `exception review date has expired: ${exception.path}`, exception }))];
  if (options.full && candidate.baseline.findings.some((entry) => !adoptionFindings.some((item) => item.fingerprint === entry.fingerprint))) findings.push({ ruleId: 'BASELINE.REPRODUCTION', path: '', message: 'baseline contains a finding not present at fixed adoption SHA' });
  return { ...makeCiReport({ findings, notices, actionable: comparison.actionable, scannedPaths: [...candidate.files.keys()] }), governance: { status: governance.notices.length || governance.blocking.length ? 'review-required' : 'unchanged' }, head, base: options.base || null, full: Boolean(options.full) };
}

function createSnapshot(options) {
  const root = path.resolve(options.root || process.cwd());
  const contractPath = path.resolve(options.contractPath);
  const outPath = path.resolve(options.outPath);
  const raw = fs.readFileSync(contractPath);
  const contract = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
  const contractValidation = validateContract(contract, { repositoryRoot: root });
  if (!contractValidation.ok) throw new Error(contractValidation.errors.join('; '));
  const outputCheck = validateOutputDestination(outPath, root);
  if (!outputCheck.ok) throw new Error(outputCheck.findings.map((f) => f.message).join('; '));
  if (!isInside(outPath, path.resolve(contract.outputs[0].root))) throw new Error('snapshot output must be under a declared external output root');
  const listing = listFiles(root);
  const files = {};
  for (const [name, meta] of listing.files) files[name] = { size: meta.size, mtimeMs: meta.mtimeMs, sha256: meta.sha256 };
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all']).toString('utf8');
  let index;
  try { index = gitIndexState(root); } catch (error) { throw new Error(`cannot capture Git index state: ${error.message}`); }
  const value = { schemaVersion: 1, taskId: contract.taskId, root, baseSha: contract.baseSha, contractSha256: jsonSha(raw), capturedAt: new Date().toISOString(), files, excluded: DEFAULT_EXCLUDED, links: listing.links, index, gitStatus: status, bootstrap: 'Manual pre-coding snapshot; eventual checker must validate this schema and declared delta.' };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(value, null, 2)}\n`);
  return { snapshot: value, outPath };
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') result.json = true;
    else if (arg === '--ci') result.ci = true;
    else if (arg === '--full') result.full = true;
    else if (arg.startsWith('--')) { const key = arg.slice(2); if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`missing value for --${key}`); result[key] = argv[++i]; }
    else result._.push(arg);
  }
  return result;
}

function cli(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    const command = args._[0];
    if (command === 'snapshot') {
      if (!args.contract || !args.out) throw new Error('snapshot requires --contract and --out');
      const snapshotRoot = path.resolve(args.root || process.cwd());
      const externalContract = validateExternalInputFile(args.contract, snapshotRoot);
      const result = createSnapshot({ root: snapshotRoot, contractPath: externalContract, outPath: args.out });
      if (args.json) process.stdout.write(`${JSON.stringify(result)}\n`); else process.stdout.write(`snapshot written: ${result.outPath}\n`);
      return EXIT_CODES.CLEAN;
    }
    if (command !== 'check') throw new Error('command must be snapshot or check');
    let result;
    if (args.ci) result = runCi({ root: args.root || process.cwd(), base: args.base, head: args.head, full: Boolean(args.full) });
    else {
      if (!args.base || !args.contract || !args.snapshot) throw new Error('local check requires --base --contract --snapshot');
      const root = path.resolve(args.root || process.cwd());
      const externalContract = validateExternalInputFile(args.contract, root);
      const externalSnapshot = validateExternalInputFile(args.snapshot, root);
      const contractBytes = fs.readFileSync(externalContract);
      const contract = JSON.parse(contractBytes.toString('utf8').replace(/^\uFEFF/, ''));
      const snapshotValue = readJsonFile(externalSnapshot);
      const listing = listFiles(root, { includeHashes: false });
      const policy = readJsonFile(path.join(root, 'scripts/structure/policy.json'));
      const packageJson = readJsonFile(path.join(root, 'package.json'));
      const baselinePath = path.join(root, 'scripts/structure/legacy-baseline.json');
      const baseline = fs.existsSync(baselinePath) ? readJsonFile(baselinePath) : { schemaVersion: 1, adoptionSha: ADOPTION_SHA, findings: [] };
      const adoptionFiles = readGitTree(root, ADOPTION_SHA);
      const adoptionFindings = analyzePaths([...adoptionFiles.keys()], policy, { treeSha: ADOPTION_SHA }).findings;
      const baseTree = policyFromTree(root, args.base);
      const basePackageJson = baseTree.files.get('package.json') && parseJsonBytes(baseTree.files.get('package.json').bytes, 'package.json');
      result = checkLocal({ root, contract, contractBytes, snapshot: snapshotValue, policy, packageJson, basePackageJson, baseline, adoptionFindings, currentFiles: listing.files, currentLinks: listing.links, treeSha: args.base, baseSha: args.base });
    }
    process.stdout.write(`${JSON.stringify(result, null, args.json ? 2 : 0)}\n`);
    return result.status;
  } catch (error) {
    const output = { status: EXIT_CODES.INPUT, error: error.message, blocking: [{ ruleId: 'INPUT.ANALYSIS', path: '', message: error.message }] };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return EXIT_CODES.INPUT;
  }
}

const SHA_PLACEHOLDER = '0'.repeat(40);

module.exports = {
  ADOPTION_SHA,
  DEFAULT_EXCLUDED,
  EXIT_CODES,
  normalizeRepoPath,
  findCaseCollisions,
  validateOutputDestination,
  validateContract,
  validateSnapshot,
  validatePolicy,
  validateBaseline,
  createSnapshot,
  listFiles,
  readGitTree,
  analyzePaths,
  toBaselineEntry,
  compareFindings,
  compareGovernance,
  validateCommands,
  validatePackageScripts,
  comparePackageScripts,
  compareGeneratedFamily,
  canonicalJsonHashWithoutField,
  checkLocal,
  makeCiReport,
  verifyReleaseIdentity,
  runCi,
  cli
};

if (require.main === module) process.exitCode = cli();
