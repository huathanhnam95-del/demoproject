'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const RUNNER = path.join(ROOT, 'scripts/crm/verify-projects-phase.js');
const MANIFEST = path.join(ROOT, 'scripts/crm/projects/phase-manifest.json');
const { isCanonicalVerificationScope } = require('../../../scripts/crm/verify-projects-phase');
const {
    DEFAULT_FEATURE_CONFIG,
    getProjectsFeatureConfig,
    getRequestedProjectsFeatureConfig
} = require('../../../functions/src/crm/projects/feature-config');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function runRunner(args, env = {}) {
    return spawnSync(process.execPath, [RUNNER, ...args], {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
            ...process.env,
            CRM_PROJECTS_NO_EMULATOR: '1',
            ...env
        },
        timeout: 30000
    });
}

assert.deepStrictEqual(DEFAULT_FEATURE_CONFIG, {
    projects: false,
    automations: false,
    paidVoice: false
});
assert.deepStrictEqual(getProjectsFeatureConfig({}), DEFAULT_FEATURE_CONFIG);
assert.deepStrictEqual(getProjectsFeatureConfig({
    CRM_PROJECTS_ENABLED: 'true',
    CRM_PROJECTS_AUTOMATIONS_ENABLED: '1',
    CRM_PROJECTS_PAID_VOICE_ENABLED: 'true'
}), {
    projects: true,
    automations: true,
    paidVoice: false
}, 'paid voice stays disabled until the hard-cap gate passes');
assert.strictEqual(getRequestedProjectsFeatureConfig({ CRM_PROJECTS_PAID_VOICE_ENABLED: 'true' }).paidVoice, true);
assert.strictEqual(getProjectsFeatureConfig({
    CRM_PROJECTS_PAID_VOICE_ENABLED: 'true',
    CRM_PROJECTS_PAID_VOICE_HARD_CAP_PASSED: 'true'
}).paidVoice, true);
assert.deepStrictEqual(getProjectsFeatureConfig({
    CRM_PROJECTS_ENABLED: 'TRUE',
    CRM_PROJECTS_AUTOMATIONS_ENABLED: 'yes',
    CRM_PROJECTS_PAID_VOICE_ENABLED: 'on'
}), DEFAULT_FEATURE_CONFIG, 'only explicit boolean values may enable a flag');
assert.strictEqual(isCanonicalVerificationScope({ canonicalManifest: true, all: false, noEmulator: true }), false, 'canonical phase cannot certify without managed emulator checks');
assert.strictEqual(isCanonicalVerificationScope({ canonicalManifest: true, all: false, noEmulator: false }), true);

const manifest = readJson(MANIFEST);
assert.strictEqual(manifest.schemaVersion, 1);
assert.deepStrictEqual(manifest.phases.map((phase) => phase.id), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
assert.ok(manifest.phases.every((phase) => phase.mandatory === true), 'every phase must be mandatory');
assert.ok(manifest.phases.every((phase) => Array.isArray(phase.tests) && phase.tests.length > 0), 'future tests must be listed explicitly');
assert.ok(manifest.phases.slice(1).every((phase) => phase.tests.every((test) => test.required === true)), 'future tests must be required');

const tempRoot = fs.mkdtempSync(path.join(ROOT, 'tmp', 'crm-projects-phase0-'));
try {
    const reportPath = path.join(tempRoot, 'report.json');
    const passManifestPath = path.join(tempRoot, 'pass-manifest.json');
    writeJson(passManifestPath, {
        schemaVersion: 1,
        phases: [{
            id: 0,
            name: 'harness fixture',
            mandatory: true,
            tests: [{
                id: 'pass-child',
                required: true,
                runner: process.execPath,
                args: ['tests/crm/projects/fixtures/pass-child.js']
            }]
        }]
    });
    const pass = runRunner(['--phase', '0', '--no-emulator', '--manifest', passManifestPath, '--report', reportPath]);
    assert.strictEqual(pass.status, 0, `passing fixture should pass: ${pass.stderr}`);
    const passReport = readJson(reportPath);
    assert.strictEqual(passReport.success, true);
    assert.strictEqual(passReport.customScope, true, 'fixture manifests must be labelled custom scope');
    assert.strictEqual(passReport.certifiesCanonicalPhase, false, 'custom fixtures must not certify canonical phase completion');
    assert.strictEqual(passReport.summary.failed, 0);
    assert.strictEqual(passReport.commands[0].stdout, 'PASS-CHILD-STDOUT\n');
    const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
    assert.strictEqual(passReport.revision, revision, 'report must contain the actual checkout revision');
    assert.match(passReport.commands[0].command, /pass-child\.js/);

    const failManifestPath = path.join(tempRoot, 'fail-manifest.json');
    const failReportPath = path.join(tempRoot, 'fail-report.json');
    writeJson(failManifestPath, {
        schemaVersion: 1,
        phases: [{
            id: 0,
            name: 'deliberate failure',
            mandatory: true,
            tests: [{
                id: 'fail-child',
                required: true,
                runner: process.execPath,
                args: ['tests/crm/projects/fixtures/fail-child.js']
            }]
        }]
    });
    const fail = runRunner(['--phase0', '--no-emulator', '--manifest', failManifestPath, '--report', failReportPath]);
    assert.notStrictEqual(fail.status, 0);
    const failReport = readJson(failReportPath);
    assert.strictEqual(failReport.success, false);
    assert.strictEqual(failReport.certifiesCanonicalPhase, false, 'failed runs must never certify canonical phase completion');
    assert.strictEqual(failReport.commands[0].exitCode, 17);
    assert.strictEqual(failReport.commands[0].stdout, 'FAIL-CHILD-STDOUT\n');
    assert.strictEqual(failReport.commands[0].stderr, 'FAIL-CHILD-STDERR\n');
    assert.ok(fail.stdout.includes('FAIL-CHILD-STDOUT'), 'child stdout must be preserved exactly');
    assert.ok(fail.stderr.includes('FAIL-CHILD-STDERR'), 'child stderr must be preserved exactly');

    const missingManifestPath = path.join(tempRoot, 'missing-manifest.json');
    const missingReportPath = path.join(tempRoot, 'missing-report.json');
    writeJson(missingManifestPath, {
        schemaVersion: 1,
        phases: [{
            id: 0,
            name: 'missing mandatory test',
            mandatory: true,
            tests: [{
                id: 'missing-child',
                required: true,
                runner: process.execPath,
                args: ['tests/crm/projects/fixtures/does-not-exist.test.js']
            }]
        }]
    });
    const missing = runRunner(['--phase0', '--no-emulator', '--manifest', missingManifestPath, '--report', missingReportPath]);
    assert.notStrictEqual(missing.status, 0);
    const missingReport = readJson(missingReportPath);
    assert.strictEqual(missingReport.summary.failed, 1);
    assert.match(missingReport.errors.join('\n'), /missing-child|does-not-exist/);
    assert.strictEqual(missingReport.commands.length, 0, 'missing mandatory files must fail before spawning commands');

    const zeroManifestPath = path.join(tempRoot, 'zero-manifest.json');
    const zeroReportPath = path.join(tempRoot, 'zero-report.json');
    writeJson(zeroManifestPath, { schemaVersion: 1, phases: [{ id: 0, name: 'zero', mandatory: true, tests: [] }] });
    const zero = runRunner(['--phase0', '--no-emulator', '--manifest', zeroManifestPath, '--report', zeroReportPath]);
    assert.notStrictEqual(zero.status, 0);
    assert.match(readJson(zeroReportPath).errors.join('\n'), /zero tests|at least one/i);

    const badPhaseReportPath = path.join(tempRoot, 'bad-phase-report.json');
    const badPhase = runRunner(['--phase99', '--no-emulator', '--manifest', passManifestPath, '--report', badPhaseReportPath]);
    assert.notStrictEqual(badPhase.status, 0);
    assert.match(readJson(badPhaseReportPath).errors.join('\n'), /phase 99|unknown phase/i);

    const spawnManifestPath = path.join(tempRoot, 'spawn-manifest.json');
    const spawnReportPath = path.join(tempRoot, 'spawn-report.json');
    writeJson(spawnManifestPath, {
        schemaVersion: 1,
        phases: [{
            id: 0,
            name: 'spawn failure',
            mandatory: true,
            tests: [{ id: 'spawn-failure', required: true, runner: 'crm-projects-command-that-does-not-exist', args: [] }]
        }]
    });
    const spawnFailure = runRunner(['--phase0', '--no-emulator', '--manifest', spawnManifestPath, '--report', spawnReportPath]);
    assert.notStrictEqual(spawnFailure.status, 0);
    const spawnReport = readJson(spawnReportPath);
    assert.strictEqual(spawnReport.commands[0].spawnError.code, 'ENOENT');

    const escapeManifestPath = path.join(tempRoot, 'escape-manifest.json');
    const escapeReportPath = path.join(tempRoot, 'escape-report.json');
    writeJson(escapeManifestPath, {
        schemaVersion: 1,
        phases: [{
            id: 0,
            name: 'path escape',
            mandatory: true,
            tests: [{ id: 'escape', required: true, runner: process.execPath, args: ['../../outside.test.js'] }]
        }]
    });
    const escape = runRunner(['--phase0', '--no-emulator', '--manifest', escapeManifestPath, '--report', escapeReportPath]);
    assert.notStrictEqual(escape.status, 0);
    assert.match(readJson(escapeReportPath).errors.join('\n'), /workspace|outside|path/i);

    const allReportPath = path.join(tempRoot, 'all-report.json');
    const incompleteManifestPath = path.join(tempRoot, 'incomplete-all-manifest.json');
    writeJson(incompleteManifestPath, {
        schemaVersion: 1,
        phases: manifest.phases.map(phase => ({ ...phase, tests: [{
            id: `isolated-phase-${phase.id}`, required: true, runner: process.execPath,
            args: [phase.id === 10 ? 'tests/crm/projects/fixtures/does-not-exist.test.js' : 'tests/crm/projects/fixtures/pass-child.js']
        }] }))
    });
    const all = runRunner(['--all', '--no-emulator', '--manifest', incompleteManifestPath, '--report', allReportPath]);
    assert.notStrictEqual(all.status, 0, '--all must reject an isolated manifest with a missing mandatory test');
    const allReport = readJson(allReportPath);
    assert.strictEqual(allReport.commands.length, 0, '--all must validate all phases before execution');
    assert.ok(allReport.errors.some((error) => /phase 1|phase 10|missing/i.test(error)));
} finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
}

process.stdout.write('crm projects phase0 harness contract passed\n');
