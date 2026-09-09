'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const files = [
    'tests/crm/accounts-role-management.test.js',
    'tests/crm/activity-service.test.js',
    'tests/crm/teacher-scheduler-behavior.test.js',
    'tests/crm/teacher-scheduler-client-controller.test.js',
    'tests/crm/crm-shell-static.test.js',
    'tests/crm/projects/phase5-board-access-client.test.js',
    'tests/crm/projects/phase6-notifications-client.test.js',
    'tests/crm/projects/phase7-automation-designer-client.test.js',
    'tests/crm/projects/phase9-assistant-client.test.js'
];
const results = files.map(file => {
    const run = spawnSync(process.execPath, [file], { cwd: root, encoding: 'utf8', env: process.env, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    if (run.status !== 0) process.stderr.write(`${file}\n${run.stdout || ''}${run.stderr || ''}${run.error?.message || ''}\n`);
    return { file, exitCode: run.status, passed: run.status === 0 && !run.error };
});
process.stdout.write(`${JSON.stringify({ provenance: 'Actual legacy and integration regression executables; full canonical phases remain separate', results }, null, 2)}\n`);
assert.ok(results.every(result => result.passed), 'Every legacy/integration regression must pass.');
