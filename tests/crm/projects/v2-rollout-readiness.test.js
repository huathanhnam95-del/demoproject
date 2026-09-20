'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runner = require('../../../scripts/crm/verify-projects-v2.cjs');
const crm = require('../../../scripts/crm/verify-crm-suite.js');
const { JSDOM } = require(process.env.CRM_TEST_JSDOM || 'jsdom');

test('legacy scale disposal retires input, summary, drag and theme listeners before reinitialization', async () => {
    const dom = new JSDOM('<section data-panel="projects"><details class="crm-projects-view-options"><summary>View</summary><div class="crm-projects-view-options-popover"><input id="projects-ui-scale"><output id="projects-ui-scale-value"></output><button id="btn-projects-theme">Theme</button></div></details></section>', { runScripts: 'outside-only' });
    try {
        const w = dom.window, writes = [];
        w.eval(fs.readFileSync(path.resolve(__dirname, '../../../public/js/crm/projects/ui-scale.js'), 'utf8'));
        const storage = { getItem: () => '150', setItem: (...args) => writes.push(args) };
        const input = w.document.getElementById('projects-ui-scale');
        const summary = w.document.querySelector('summary');
        const first = w.CrmProjectsUiScale.init({ storage });
        summary.click(); assert.ok(w.document.getElementById('crm-projects-view-portal-host'));
        first.dispose(); first.dispose();
        assert.equal(w.document.getElementById('crm-projects-view-portal-host'), null);
        input.value = '100'; input.dispatchEvent(new w.Event('input'));
        assert.equal(writes.length, 0, 'disposed scale controller must not write a legacy preference');
        const second = w.CrmProjectsUiScale.init({ storage });
        summary.click(); assert.ok(w.document.getElementById('crm-projects-view-portal-host'), 'one active summary owner');
        input.value = '125'; input.dispatchEvent(new w.Event('input'));
        assert.deepEqual(writes, [['crm:projects:ui-scale', '125']]);
        second.dispose();
        summary.click(); assert.equal(w.document.getElementById('crm-projects-view-portal-host'), null);
    } finally { dom.window.close(); }
});

test('settled selection retains every V2 gate and both unwaived broad failure files', () => {
    const checks = runner.buildChecks();
    assert.equal(new Set(checks.map(c => c.id)).size, checks.length);
    const files = checks.flatMap(c => c.args);
    for (const file of fs.readdirSync(__dirname).filter(f => f.startsWith('v2-') && f.endsWith('.test.js'))) {
        assert.equal(files.filter(p => p === `tests/crm/projects/${file}`).length, 1, file);
        assert.equal(crm.ORIGINAL_CHECKS.flatMap(([, args]) => args).filter(p => p === `tests/crm/projects/${file}`).length, 1, `CRM registration: ${file}`);
    }
    for (const file of ['board-successor-interaction', 'board-keyboard-move-focus']) assert.ok(files.includes(`tests/crm/projects/${file}.test.js`));
    assert.ok(checks.some(c => c.id === 'chrome-consistency' && c.args.includes('--regressions-only')));
    assert.deepEqual(checks.filter(c => c.group === 'performance').map(c => c.args[c.args.indexOf('--cpu-rate') + 1]), ['1', '4']);
});
test('failed, signalled and unavailable commands remain failed and do not hide later checks', () => {
    const seen = [];
    const checks = [1, 2, 3, 4].map(n => ({ id: String(n), command: 'node', args: [String(n)] }));
    const replies = [{ status: 1 }, { status: null, signal: 'SIGTERM' }, { status: null, error: Error('missing runtime') }, { status: 0 }];
    const results = runner.execute(checks, { spawn: (_, args) => { seen.push(args[0]); return replies.shift(); } });
    assert.deepEqual(seen, ['1', '2', '3', '4']);
    assert.deepEqual(results.map(r => r.passed), [false, false, false, true]);
    assert.equal(results[2].error, 'missing runtime');
});
test('effectful checks are explicit and group selection cannot accept arbitrary commands', () => {
    assert.throws(() => runner.parseArgs(['--group', 'production']), /Unknown group/);
    assert.throws(() => runner.parseArgs(['--skip-failures']), /Unknown argument/);
    assert.throws(() => runner.parseArgs(['--group', 'node', '--group', 'node']), /Duplicate/);
    const checks = runner.buildChecks(runner.parseArgs(['--group', 'node']));
    assert.ok(checks.length > 0 && checks.every(c => c.group === 'node'));
    assert.ok(!checks.flatMap(c => c.args).some(p => p.includes('persisted') || p.endsWith('.py')));
    for (const c of runner.buildChecks().filter(c => c.args.some(p => p.includes('persisted')))) assert.equal(c.group, 'emulator');
    for (const name of ['phase4-discussions-recovery-api', 'phase5-views-calendar-links-api', 'phase7-automation-designer-api']) {
        assert.equal(runner.buildChecks().find(c => c.args.includes(`tests/crm/projects/${name}.test.js`)).group, 'emulator');
    }
});
test('evidence output rejects repository paths and existing packages', () => {
    assert.throws(() => runner.externalOutput(path.resolve(__dirname, 'evidence')), /outside/);
    assert.throws(() => runner.externalOutput('relative-output'), /absolute/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-v2-runner-'));
    try {
        assert.throws(() => runner.externalOutput(dir), /already exists/);
        assert.equal(runner.externalOutput(path.join(dir, 'new-run')), path.join(dir, 'new-run'));
    } finally { fs.rmdirSync(dir); }
});
test('emulator child settings are demo-only and leave caller flags unchanged', () => {
    const { getEmulatorConfig } = require('../../../scripts/crm/projects/emulator-config');
    const input = { CRM_PROJECTS_ENABLED: 'false' };
    const child = runner.emulatorTestEnvironment(input, getEmulatorConfig({}));
    assert.equal(child.CRM_PROJECTS_ENABLED, 'true');
    assert.equal(child.GCLOUD_PROJECT, 'demo-crm-projects');
    assert.equal(child.CRM_PROJECTS_EMULATOR_READY, '1');
    assert.equal(input.CRM_PROJECTS_ENABLED, 'false');
    assert.throws(() => runner.emulatorTestEnvironment(input, { ...getEmulatorConfig({}), projectId: 'production' }), /refusing/);
});
test('runtime archival preserves existing artifacts and moves only the owned lifecycle PID directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-v2-archive-'));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-v2-receipt-'));
    const recovery = path.join(root, 'test-results/crm-projects/harness-recovery');
    const own = path.join(recovery, 'normal-cleanup-123-456');
    const other = path.join(recovery, 'normal-cleanup-123-789');
    fs.mkdirSync(own, { recursive: true }); fs.mkdirSync(other);
    fs.writeFileSync(path.join(root, 'firebase-debug.log'), 'owned log');
    fs.writeFileSync(path.join(own, 'firebase.json'), 'owned config');
    fs.writeFileSync(path.join(other, 'firebase.json'), 'unowned config');
    assert.throws(() => runner.assertRuntimeOutputAvailable(root), /must be preserved/);
    const receipt = runner.archiveRuntime(out, 456, root);
    assert.equal(receipt.length, 2);
    assert.equal(fs.readFileSync(path.join(other, 'firebase.json'), 'utf8'), 'unowned config');
    assert.ok(!fs.existsSync(own));
    for (const row of receipt) assert.ok(fs.existsSync(row.destination) && row.sha256.length === 64);
    assert.doesNotThrow(() => runner.assertRuntimeOutputAvailable(root));
    // These test-owned fixtures are retained in the OS temporary directory.
});
