const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveServiceAccountPath } = require('../src/utils/service-account-path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-service-account-'));
const worktreeDir = path.join(tempRoot, '_worktrees', 'crm-workflow-fixes', 'src', 'utils');
fs.mkdirSync(worktreeDir, { recursive: true });

const rootServiceAccount = path.join(tempRoot, 'serviceAccountKey.json');
fs.writeFileSync(rootServiceAccount, JSON.stringify({ project_id: 'demo-project' }), 'utf8');

const resolved = resolveServiceAccountPath(worktreeDir);

assert.strictEqual(resolved, rootServiceAccount);

const nestedResolved = resolveServiceAccountPath(path.join(worktreeDir, 'nested', 'deeper'));
assert.strictEqual(nestedResolved, rootServiceAccount);

console.log('service account path resolution passed');
