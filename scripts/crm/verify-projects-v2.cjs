'use strict';

// Local-only acceptance selection. Persisted tests run exclusively behind the
// existing demo-project/loopback/lock guards; no production configuration is read.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../..');
const GROUPS = ['node', 'routes', 'chrome', 'performance', 'emulator-guards', 'emulator', 'quality', 'structure', 'ci'];
const projectTest = name => `tests/crm/projects/${name}.test.js`;
const nodeChecks = [
    ['focused', ['v2-row-editors', 'v2-quick-create', 'v2-task-detail', 'v2-views-navigation', 'v2-automations', 'v2-mobile-accessibility', 'v2-performance-reconciliation', 'v2-rollout-readiness', 'v2-inline-create', 'v2-project-switch-cache', 'crm-admin-projects-reload-route']],
    ['adjacent', ['phase7-automation-designer-client', 'phase7-automation-designer-contract', 'phase7-automation-preview', 'phase5-views-client', 'views-overhaul-ux', 'views-predecessor-refresh', 'views-project-links-refresh', 'nonvoice-discussion-client', 'phase4-recovery-client', 'task-detail-modal-ux']],
    ['broad-regression', ['board-initial-creation', 'board-keyboard-move-focus', 'board-local-save-lineage', 'board-manual-refresh-readiness', 'board-overhaul-baseline', 'board-presentation', 'board-refresh-interaction', 'board-successor-interaction', 'field-save-feedback', 'projects-ui-scale', 'v2-columns', 'v2-entry', 'v2-shell', 'workspace-presentation']]
];
function buildChecks(options = {}) {
    const out = options.out || '<external-output>';
    const checks = [];
    const add = (group, id, command, args) => checks.push({ group, id, command, args });
    for (const [id, names] of nodeChecks) add('node', id, 'node', ['--test', ...names.map(projectTest)]);
    add('routes', 'routes-api-service', 'node', ['--test', ...['phase1-people-access-api', 'phase2-domain-api', 'phase5-transaction-retry', 'remote-observation', 'remote-observer-scope-handoff', 'remote-viewer-hydration', 'rollups', 'hierarchy-depth'].map(projectTest), 'tests/crm/automation-service.test.js']);
    add('routes', 'legacy-board-contract', 'node', [projectTest('phase3-board-contract')]);
    for (const name of ['shell', 'row-editors', 'quick-create', 'task-detail', 'views-navigation', 'automations', 'mobile-accessibility', 'rollout-readiness']) {
        add('chrome', `chrome-${name}`, 'python', [`tests/browser/crm-projects/v2-${name}-browser-check.py`, '--out', path.join(out, `chrome-${name}`)]);
    }
    add('chrome', 'chrome-consistency', 'python', ['tests/browser/crm-projects/v2-performance-reconciliation-browser-check.py', '--regressions-only', '--out', path.join(out, 'chrome-consistency')]);
    for (const rate of [1, 4]) add('performance', `performance-${rate}x`, 'python', ['tests/browser/crm-projects/v2-performance-reconciliation-browser-check.py', '--cpu-rate', String(rate), '--out', path.join(out, `performance-${rate}x`)]);
    add('emulator', 'emulator-seed', 'node', ['scripts/crm/projects/seed-fixtures.js']);
    for (const name of ['emulator-roundtrip', 'phase1-people-access-persisted', 'phase2-domain-persisted', 'phase4-discussions-recovery-api', 'phase4-recovery-persisted', 'phase5-views-calendar-links-api', 'phase5-views-calendar-links-persisted', 'phase5-transaction-retry-persisted', 'phase6-engine-persisted', 'phase7-automation-designer-api']) add('emulator', name, 'node', [projectTest(name)]);
    add('quality', 'selection-tests', 'node', ['--test', 'tests/crm/verification-selection.test.cjs']);
    for (const name of ['emulator-isolation', 'emulator-lifecycle']) add('emulator-guards', `${name}-guard`, 'node', [projectTest(name)]);
    add('quality', 'selection', 'node', ['scripts/crm/verification-selection.cjs', 'check']);
    add('quality', 'runner-list', 'node', ['scripts/crm/verify-crm-suite.js', '--list']);
    add('quality', 'lint', 'node', ['scripts/crm/verify-crm-suite.js', '--lint']);
    add('quality', 'whitespace', 'git', ['diff', '--check', options.base || '<base>', options.head || 'HEAD']);
    add('structure', 'local-structure', 'node', ['scripts/structure/check.cjs', 'check', '--base', options.base || '<base>', '--contract', options.contract || '<contract>', '--snapshot', options.snapshot || '<snapshot>', '--json']);
    add('ci', 'committed-tree-ci', 'node', ['scripts/structure/check.cjs', 'check', '--ci', '--base', options.base || '<base>', '--head', options.head || 'HEAD', '--json']);
    return checks.filter(check => !options.groups?.length || options.groups.includes(check.group));
}
function parseArgs(argv) {
    const options = { groups: [] };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--list') options.list = true;
        else if (['--out', '--base', '--head', '--contract', '--snapshot', '--group'].includes(arg)) {
            if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`${arg} requires a value`);
            const value = argv[++i];
            if (arg === '--group') {
                if (!GROUPS.includes(value)) throw new Error(`Unknown group: ${value}`);
                if (options.groups.includes(value)) throw new Error(`Duplicate group: ${value}`);
                options.groups.push(value);
            } else options[arg.slice(2)] = value;
        } else throw new Error(`Unknown argument: ${arg}`);
    }
    return options;
}
function externalOutput(value) {
    if (!value || !path.isAbsolute(value)) throw new Error('--out requires an absolute external directory');
    const out = path.resolve(value);
    // Resolve existing ancestors too: an apparent external path must not be a
    // junction back into the repository, or overwrite another evidence package.
    let ancestor = out;
    while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
    const resolved = path.join(fs.realpathSync(ancestor), path.relative(ancestor, out));
    const relative = path.relative(fs.realpathSync(ROOT), resolved);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Evidence output must be outside the repository');
    if (fs.existsSync(out)) throw new Error('Evidence output already exists; use a fresh directory');
    return out;
}
function execute(checks, { out, env = process.env, spawn = spawnSync, record = () => {} } = {}) {
    const results = [];
    for (const check of checks) {
        const start = Date.now();
        let result;
        try {
            result = spawn(check.command === 'node' ? process.execPath : check.command, check.args, { cwd: ROOT, env, shell: false, windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
        } catch (error) { result = { status: null, error }; }
        if (out) {
            fs.writeFileSync(path.join(out, `${check.id}.stdout.log`), result.stdout || '');
            fs.writeFileSync(path.join(out, `${check.id}.stderr.log`), result.stderr || '');
        }
        const row = { ...check, pid: result.pid || null, exitCode: result.status ?? null, signal: result.signal || null, error: result.error?.message || null, durationMs: Date.now() - start };
        row.passed = row.exitCode === 0 && !row.error && !row.signal;
        results.push(row); record(row);
    }
    return results;
}
const runtimeLogs = ['firebase-debug.log', 'firestore-debug.log', 'storage-debug.log'];
function assertRuntimeOutputAvailable(root = ROOT) {
    for (const name of runtimeLogs) if (fs.existsSync(path.join(root, name))) throw new Error(`Existing runtime artifact must be preserved before emulator execution: ${name}`);
}
function archiveRuntime(out, guardPid, root = ROOT) {
    const archive = path.join(out, 'runtime-artifacts');
    const moved = [];
    function moveFile(file) {
        const relative = path.relative(root, file);
        if (relative.startsWith('..') || path.isAbsolute(relative) || fs.lstatSync(file).isSymbolicLink()) throw new Error('Unsafe runtime artifact path');
        const target = path.join(archive, relative);
        if (fs.existsSync(target)) throw new Error(`Runtime archive collision: ${relative}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        fs.renameSync(file, target);
        moved.push({ path: relative, destination: target, sha256 });
    }
    for (const name of runtimeLogs) if (fs.existsSync(path.join(root, name))) moveFile(path.join(root, name));
    const recovery = path.join(root, 'test-results/crm-projects/harness-recovery');
    if (guardPid && fs.existsSync(recovery)) {
        for (const name of fs.readdirSync(recovery)) {
            if (!new RegExp(`^(startup-failure|normal-cleanup|forced-exit)-[0-9]+-${guardPid}$`).test(name)) continue;
            const dir = path.join(recovery, name);
            if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('Unsafe runtime directory');
            for (const item of fs.readdirSync(dir)) {
                if (!['firebase.json', 'firebase.stdout.log', 'firebase.stderr.log'].includes(item)) throw new Error(`Unclassified runtime artifact: ${name}/${item}`);
            }
            for (const item of fs.readdirSync(dir)) moveFile(path.join(dir, item));
            fs.rmdirSync(dir); // Only the now-empty directory of this exact child PID.
        }
    }
    return moved;
}
function emulatorTestEnvironment(env, config) {
    const { emulatorEnvironment } = require('./projects/emulator-config');
    // This setting is local to guarded demo test children. The real presentation
    // flag and the caller's environment remain unchanged.
    return { ...env, ...emulatorEnvironment(config), CRM_PROJECTS_EMULATOR_READY: '1', CRM_PROJECTS_ENABLED: 'true' };
}
function sourceIdentity() {
    const git = args => {
        const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
        if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
        return result.stdout.trim();
    };
    const files = git(['ls-files', 'public/crm-admin.*', 'public/css/crm-projects*.css', 'public/js/crm/projects', 'tests/crm/projects', 'tests/browser/crm-projects', 'tests/fixtures/crm/projects*', 'scripts/crm']).split('\n');
    // Include new PR12 files before the atomic commit as well.
    files.push('scripts/crm/verify-projects-v2.cjs', projectTest('v2-rollout-readiness'), 'tests/browser/crm-projects/v2-rollout-readiness-browser-check.py');
    const hashes = Object.fromEntries([...new Set(files)].sort().filter(p => p && fs.existsSync(path.join(ROOT, p))).map(p => [p, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex')]));
    return { head: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']), status: git(['status', '--porcelain=v1']), hashes };
}
async function main(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    if (options.list) { console.log(JSON.stringify(buildChecks(options), null, 2)); return 0; }
    if (!options.head) {
        const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
        if (head.status !== 0) throw new Error('Cannot resolve committed HEAD');
        options.head = head.stdout.trim();
    }
    const checks = buildChecks(options);
    if (checks.some(c => ['structure', 'ci', 'quality'].includes(c.group)) && !options.base) throw new Error('--base is required for quality/structure/CI');
    if (checks.some(c => c.group === 'structure') && (!options.contract || !options.snapshot)) throw new Error('Local structure requires --contract and --snapshot');
    const out = externalOutput(options.out);
    fs.mkdirSync(out, { recursive: true });
    const report = { scope: options.groups.length ? 'selected groups only' : 'complete local selection', releaseAuthorized: false, startedAt: new Date().toISOString(), before: sourceIdentity(), checks: [], errors: [] };
    const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    const record = row => { report.checks.push(row); console.log(`${row.id}: ${row.passed ? 'PASS' : 'FAIL'} (${row.exitCode})`); save(); };
    let emulator;
    try {
        for (const group of GROUPS) {
            const selected = checks.filter(c => c.group === group);
            if (!selected.length) continue;
            let env = { ...process.env };
            if (group === 'emulator' || group === 'emulator-guards') assertRuntimeOutputAvailable();
            if (group === 'emulator') {
                const { getEmulatorConfig } = require('./projects/emulator-config');
                const { startIsolatedEmulators } = require('./projects/emulator-process');
                try {
                    const config = getEmulatorConfig(env);
                    emulator = await startIsolatedEmulators({ config, sessionDir: path.join(out, 'emulator-runtime') });
                    report.emulator = { config, started: true, stopped: false, ownerPid: emulator.ownerPid, lockPath: emulator.lockPath };
                    env = emulatorTestEnvironment(env, config);
                } catch (error) {
                    report.errors.push(`Emulator unavailable: ${error.message}`);
                    for (const check of selected) record({ ...check, passed: false, exitCode: null, error: 'Blocked: isolated emulator startup failed' });
                    continue;
                }
            }
            const results = execute(selected, { out, env, record });
            if (emulator) {
                await emulator.stop(); emulator = null; report.emulator.stopped = true;
            }
            if (group === 'emulator' || group === 'emulator-guards') {
                const guardPid = results.find(r => r.id === 'emulator-lifecycle-guard')?.pid;
                if (group === 'emulator' || results.every(r => r.passed)) report.runtimeArtifacts = [...(report.runtimeArtifacts || []), ...archiveRuntime(path.join(out, group), guardPid)];
            }
        }
    } catch (error) { report.errors.push(error.stack || error.message); }
    finally {
        if (emulator) { try { await emulator.stop(); report.emulator.stopped = true; } catch (error) { report.errors.push(`Emulator cleanup failed: ${error.message}`); } }
        report.after = sourceIdentity();
        if (JSON.stringify(report.before) !== JSON.stringify(report.after)) report.errors.push('Source changed during verification');
        report.passed = !report.errors.length && report.checks.length === checks.length && report.checks.every(c => c.passed);
        report.finishedAt = new Date().toISOString(); save();
    }
    return report.passed ? 0 : 1;
}
module.exports = { GROUPS, buildChecks, parseArgs, externalOutput, execute, assertRuntimeOutputAvailable, archiveRuntime, emulatorTestEnvironment, main };
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
