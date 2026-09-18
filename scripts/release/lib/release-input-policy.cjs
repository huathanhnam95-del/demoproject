'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_POLICY_PATH = path.resolve(__dirname, '..', 'release-input-policy.json');

function loadReleaseInputPolicy(customPath) {
  const policyPath = customPath ? path.resolve(customPath) : DEFAULT_POLICY_PATH;
  if (!fs.existsSync(policyPath)) {
    throw new Error(`[ReleaseInputPolicy] Policy file not found at: ${policyPath}`);
  }
  const raw = fs.readFileSync(policyPath, 'utf8');
  const policySha256 = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
  const policy = JSON.parse(raw);

  if (policy.schemaVersion !== 1) {
    throw new Error(`[ReleaseInputPolicy] Unsupported schemaVersion: ${policy.schemaVersion}`);
  }

  const protectedSet = new Set((policy.protectedInputs || []).map((p) => p.replace(/\\/g, '/')));

  return {
    policy,
    policyPath,
    policySha256,
    protectedSet
  };
}

function resolveExcludedPaths(policyObj, options = {}) {
  const { policy, protectedSet } = policyObj;
  const activeCohorts = [];

  if (options.cohort) {
    activeCohorts.push(options.cohort);
  } else if (Array.isArray(options.activeCohorts)) {
    activeCohorts.push(...options.activeCohorts);
  }

  const excluded = new Set();
  if (activeCohorts.length === 0) {
    return excluded;
  }

  for (const cohortName of activeCohorts) {
    const cohort = policy.cohorts && policy.cohorts[cohortName];
    if (!cohort) {
      throw new Error(`[ReleaseInputPolicy] Unknown cohort: ${cohortName}`);
    }

    if (cohort.productionEligible === false && options.isProduction === true && !options.allowPilot) {
      const err = new Error(`[ReleaseInputPolicy] Cohort '${cohortName}' is marked ineligible for production.`);
      err.code = 'PILOT_MEDIA_INELIGIBLE';
      throw err;
    }

    for (const assetPath of cohort.assets || []) {
      const normalized = assetPath.replace(/\\/g, '/').replace(/^\/+/, '');
      if (protectedSet.has(normalized)) {
        throw new Error(`[ReleaseInputPolicy] Cannot exclude protected builder input: ${normalized}`);
      }
      excluded.add(normalized);
    }

    if (Array.isArray(cohort.catalogShards)) {
      const projectRoot = options.projectRoot || (policyObj.policyPath ? path.dirname(path.dirname(policyObj.policyPath)) : process.cwd());
      for (const shardRelPath of cohort.catalogShards) {
        const candidates = [
          path.join(projectRoot, 'public', shardRelPath),
          path.join(projectRoot, shardRelPath),
          path.join('C:/Cursor AI/public', shardRelPath),
          path.join(projectRoot, '.media-checkpoints', cohort.publicationId || '', path.basename(shardRelPath)),
          path.join('C:/Cursor AI/.media-checkpoints', cohort.publicationId || '', path.basename(shardRelPath))
        ];
        let shardData = null;
        for (const candidatePath of candidates) {
          if (fs.existsSync(candidatePath)) {
            try {
              shardData = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
              break;
            } catch (_) {}
          }
        }
        if (shardData && shardData.assets) {
          for (const assetPath of Object.keys(shardData.assets)) {
            const normalized = assetPath.replace(/\\/g, '/').replace(/^\/+/, '');
            if (protectedSet.has(normalized)) {
              throw new Error(`[ReleaseInputPolicy] Cannot exclude protected builder input: ${normalized}`);
            }
            excluded.add(normalized);
          }
        }
      }
    }
  }

  return excluded;
}

function resolveExcludedRoots(policyObj, options = {}) {
  const { policy } = policyObj;
  const activeCohorts = [];

  if (options.cohort) {
    activeCohorts.push(options.cohort);
  } else if (Array.isArray(options.activeCohorts)) {
    activeCohorts.push(...options.activeCohorts);
  }

  const roots = new Set();
  for (const cohortName of activeCohorts) {
    const cohort = policy.cohorts && policy.cohorts[cohortName];
    if (cohort && Array.isArray(cohort.roots)) {
      for (const r of cohort.roots) {
        roots.add(r.replace(/\\/g, '/').replace(/^\/+/, ''));
      }
    }
  }
  return roots;
}

function filterTrackedInventory(inventory, excludedSet) {
  if (!Array.isArray(inventory)) return { filtered: [], excluded: [], excludedCount: 0, avoidedBytes: 0 };
  if (!excludedSet || excludedSet.size === 0) {
    return {
      filtered: inventory.slice(),
      excluded: [],
      excludedCount: 0,
      avoidedBytes: 0
    };
  }

  const filtered = [];
  const excluded = [];
  let avoidedBytes = 0;

  for (const item of inventory) {
    const normalized = String(item.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (excludedSet.has(normalized)) {
      excluded.push(item);
      if (typeof item.size === 'number') {
        avoidedBytes += item.size;
      }
    } else {
      filtered.push(item);
    }
  }

  return {
    filtered,
    excluded,
    excludedCount: excluded.length,
    avoidedBytes
  };
}

function validatePublicationEligibility(lockData, options = {}) {
  if (!lockData) return;
  const isProd = options.isProduction !== false;
  if (isProd && (lockData.ineligibleForProduction === true || String(lockData.publicationId || '').startsWith('pilot-'))) {
    if (!options.allowPilot) {
      const err = new Error(`Publication '${lockData.publicationId}' is marked ineligible for production.`);
      err.code = 'PILOT_MEDIA_INELIGIBLE';
      throw err;
    }
  }
}

function matchesPattern(relPath, pattern) {
  const norm = relPath.replace(/\\/g, '/');
  if (pattern === '*' || pattern === '**') return true;
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3);
    return norm === prefix || norm.startsWith(prefix + '/');
  }
  if (pattern.startsWith('*.')) {
    const ext = pattern.slice(1);
    return norm.endsWith(ext);
  }
  if (pattern.endsWith('*') && !pattern.includes('/')) {
    const base = path.basename(norm);
    const prefix = pattern.slice(0, -1);
    return base.startsWith(prefix);
  }
  if (pattern.includes('*')) {
    const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
    return regex.test(norm) || regex.test(path.basename(norm));
  }
  return norm === pattern || path.basename(norm) === pattern;
}

function classifyTrackedPath(relPath, profile, policyObj, options = {}) {
  const policy = policyObj && policyObj.policy ? policyObj.policy : (policyObj || {});
  const exportPolicy = policy.profileExportPolicy || {};
  const omissions = policy.omissionClassifications || [];
  const protectedSet = policyObj && policyObj.protectedSet ? policyObj.protectedSet : new Set(policy.protectedInputs || []);

  const norm = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const profileKey = String(profile || 'hosting').toLowerCase();
  const profileRules = exportPolicy[profileKey] || exportPolicy.hosting || {};

  // Protected builder inputs required by the profile are always included
  if (protectedSet.has(norm)) {
    return { status: 'include', category: 'build-only', reason: 'protected builder input' };
  }

  // 1. Required prefixes for the profile
  for (const prefix of profileRules.requiredPrefixes || []) {
    const cleanPrefix = prefix.replace(/\/$/, '');
    if (norm === cleanPrefix || norm.startsWith(cleanPrefix + '/')) {
      const category = cleanPrefix === 'public' ? 'app-runtime' : (cleanPrefix === 'functions' ? 'backend-functions' : 'app-runtime');
      return { status: 'include', category, reason: `matches required prefix ${prefix}` };
    }
  }

  // Dynamic sources configured in firebase.json (configDir, additionalSources)
  const projectConfig = options.projectConfig;
  if (projectConfig && (profileKey === 'functions' || profileKey === 'full')) {
    const functionsConfigs = Array.isArray(projectConfig.functions)
      ? projectConfig.functions
      : (projectConfig.functions ? [projectConfig.functions] : []);

    for (const fn of functionsConfigs) {
      if (!fn) continue;
      if (typeof fn.configDir === 'string') {
        const fnConfigDir = fn.configDir.replace(/^\/+/, '').replace(/\/+$/, '');
        if (fnConfigDir && (norm === fnConfigDir || norm.startsWith(fnConfigDir + '/'))) {
          return { status: 'include', category: 'backend-functions', reason: `matches configured function configDir ${fnConfigDir}` };
        }
      }
      if (Array.isArray(fn.additionalSources)) {
        for (const addSource of fn.additionalSources) {
          const cleanAdd = String(addSource || '').replace(/^\/+/, '').replace(/\/+$/, '');
          if (cleanAdd && (norm === cleanAdd || norm.startsWith(cleanAdd + '/'))) {
            return { status: 'include', category: 'backend-functions', reason: `matches configured function additionalSource ${cleanAdd}` };
          }
        }
      }
    }
  }

  // 2. Required exact files
  if (Array.isArray(profileRules.requiredFiles) && profileRules.requiredFiles.includes(norm)) {
    return { status: 'include', category: 'build-only', reason: 'matches required release file' };
  }

  // 3. Required directory prefixes
  for (const prefix of profileRules.requiredDirectoryPrefixes || []) {
    if (norm.startsWith(prefix)) {
      return { status: 'include', category: 'build-only', reason: `matches required directory prefix ${prefix}` };
    }
  }

  // 4. Cross-profile exclusions
  if (profileKey === 'hosting' && norm.startsWith('functions/')) {
    return { status: 'omit', category: 'backend-functions', reason: 'functions code omitted from hosting profile' };
  }
  if (profileKey === 'functions' && norm.startsWith('public/')) {
    return { status: 'omit', category: 'app-runtime', reason: 'public app omitted from functions profile' };
  }

  // 5. Omission classifications
  for (const group of omissions) {
    for (const pattern of group.patterns || []) {
      if (matchesPattern(norm, pattern)) {
        return { status: 'omit', category: group.category, reason: `matches omission pattern ${pattern}` };
      }
    }
  }

  return { status: 'unclassified', category: 'unknown', reason: 'no classification matched' };
}

function filterTrackedInventoryForProfile(inventory, profile, policyObj, options = {}) {
  if (!Array.isArray(inventory)) {
    return { filtered: [], omitted: [], omittedCount: 0, omittedBytes: 0, breakdown: {} };
  }

  const policy = policyObj && policyObj.policy ? policyObj : loadReleaseInputPolicy(options.policyPath);
  const filtered = [];
  const omitted = [];
  let omittedBytes = 0;
  const breakdown = {};

  for (const item of inventory) {
    const rel = String(item.path || '').replace(/\\/g, '/');
    const classification = classifyTrackedPath(rel, profile, policy, options);

    if (classification.status === 'unclassified') {
      const err = new Error(`[ReleaseInputPolicy] File '${rel}' is outside profile '${profile}' surface and has no explicit omission classification in release-input-policy.json.`);
      err.code = 'UNCLASSIFIED_RELEASE_INPUT';
      err.file = rel;
      throw err;
    }

    if (classification.status === 'include') {
      filtered.push({ ...item, classification: classification.category });
    } else {
      omitted.push({ ...item, classification: classification.category });
      const size = typeof item.size === 'number' ? item.size : 0;
      omittedBytes += size;
      if (!breakdown[classification.category]) {
        breakdown[classification.category] = { count: 0, bytes: 0 };
      }
      breakdown[classification.category].count += 1;
      breakdown[classification.category].bytes += size;
    }
  }

  return {
    filtered,
    omitted,
    omittedCount: omitted.length,
    omittedBytes,
    breakdown
  };
}

module.exports = {
  DEFAULT_POLICY_PATH,
  loadReleaseInputPolicy,
  resolveExcludedPaths,
  resolveExcludedRoots,
  filterTrackedInventory,
  validatePublicationEligibility,
  matchesPattern,
  classifyTrackedPath,
  filterTrackedInventoryForProfile
};
