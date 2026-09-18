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

module.exports = {
  DEFAULT_POLICY_PATH,
  loadReleaseInputPolicy,
  resolveExcludedPaths,
  resolveExcludedRoots,
  filterTrackedInventory,
  validatePublicationEligibility
};
