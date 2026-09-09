'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
    DEMO_PROJECT_ID,
    emulatorEnvironment,
    getEmulatorConfig
} = require('./projects/emulator-config');
const { startIsolatedEmulators, ensureDirectory } = require('./projects/emulator-process');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_MANIFEST_PATH = path.join(__dirname, 'projects/phase-manifest.json');
const DEFAULT_REPORT_DIR = path.join(ROOT, 'test-results/crm-projects');

function isPathInsideRoot(candidate, root = ROOT) {
    const relative = path.relative(root, path.resolve(candidate));
    return relative === '' || (relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveInsideRoot(relativeOrAbsolute, label) {
    const resolved = path.resolve(ROOT, relativeOrAbsolute);
    if (!isPathInsideRoot(resolved)) throw new Error(`${label} must stay inside the workspace: ${relativeOrAbsolute}`);
    return resolved;
}

function parseArgs(argv = process.argv.slice(2)) {
    const options = {
        phase: null,
        all: false,
        noEmulator: false,
        manifestPath: DEFAULT_MANIFEST_PATH,
        reportPath: null
    };
    const errors = [];
    for (let index = 0; index < argv.length; index += 1) {
        const argument = String(argv[index]);
        const phaseMatch = argument.match(/^--phase(\d+)$/i);
        if (phaseMatch) {
            options.phase = Number(phaseMatch[1]);
        } else if (argument === '--all') {
            options.all = true;
        } else if (argument === '--no-emulator') {
            options.noEmulator = true;
        } else if (argument === '--manifest') {
            if (!argv[index + 1]) errors.push('--manifest requires a workspace-relative path.');
            else options.manifestPath = argv[++index];
        } else if (argument.startsWith('--manifest=')) {
            options.manifestPath = argument.slice('--manifest='.length);
        } else if (argument === '--report') {
            if (!argv[index + 1]) errors.push('--report requires a workspace-relative path.');
            else options.reportPath = argv[++index];
        } else if (argument.startsWith('--report=')) {
            options.reportPath = argument.slice('--report='.length);
        } else if (argument === '--phase') {
            const value = argv[index + 1];
            if (!value) errors.push('--phase requires a numeric phase.');
            else options.phase = Number(value), index += 1;
        } else {
            errors.push(`Unknown argument ${argument}. Arbitrary test paths are not accepted.`);
        }
    }
    if (options.all && options.phase !== null) errors.push('Choose --all or one --phaseN, not both.');
    if (!options.all && options.phase === null) errors.push('Choose one phase with --phaseN or use --all.');
    if (options.phase !== null && (!Number.isInteger(options.phase) || options.phase < 0 || options.phase > 10)) {
        errors.push(`Unknown phase ${options.phase}; expected 0 through 10.`);
    }
    return { options, errors };
}

function loadManifest(manifestPath) {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function looksLikePath(argument) {
    const value = String(argument || '');
    return /[\\/]/.test(value) || /\.(?:c?m?js|json|test|ts)$/i.test(value);
}

function validateManifest(manifest, { root = ROOT, requireAllPhases = false, validatePhaseIds = null } = {}) {
    const errors = [];
    if (!manifest || manifest.schemaVersion !== 1) errors.push('Manifest schemaVersion must be 1.');
    if (!Array.isArray(manifest?.phases)) {
        errors.push('Manifest phases must be an array.');
        return { errors };
    }
    const ids = new Set();
    for (const phase of manifest.phases) {
        if (!Number.isInteger(phase?.id) || phase.id < 0 || phase.id > 10) {
            errors.push(`Invalid phase id ${phase?.id}.`);
            continue;
        }
        if (ids.has(phase.id)) errors.push(`Duplicate phase ${phase.id}.`);
        ids.add(phase.id);
        if (phase.mandatory !== true) errors.push(`Phase ${phase.id} must be marked mandatory.`);
        if (!Array.isArray(phase.tests) || phase.tests.length === 0) {
            errors.push(`Phase ${phase.id} has zero tests; mandatory phases cannot be empty.`);
            continue;
        }
        const shouldValidateFiles = validatePhaseIds === null || validatePhaseIds.has(phase.id);
        for (const test of phase.tests) {
            if (!test || typeof test.id !== 'string' || !test.id.trim()) errors.push(`Phase ${phase.id} contains a test without an id.`);
            if (test?.required !== true) errors.push(`Phase ${phase.id} test ${test?.id || '(unknown)'} must be required.`);
            if (typeof test?.runner !== 'string' || !test.runner.trim()) {
                errors.push(`Phase ${phase.id} test ${test?.id || '(unknown)'} has no runner.`);
                continue;
            }
            if (/[\\/]/.test(test.runner) && path.resolve(test.runner) !== process.execPath) {
                errors.push(`Phase ${phase.id} test ${test.id} runner must be a named command or Node executable.`);
            }
            if (!Array.isArray(test.args)) errors.push(`Phase ${phase.id} test ${test.id} args must be an array.`);
            const args = Array.isArray(test.args) ? test.args : [];
            for (const argument of args) {
                if (!looksLikePath(argument)) continue;
                const candidate = resolveInsideRoot(argument, `Phase ${phase.id} test ${test.id} path`);
                if (shouldValidateFiles && !fs.existsSync(candidate)) errors.push(`Phase ${phase.id} test ${test.id} mandatory file is missing: ${argument}`);
            }
        }
    }
    if (requireAllPhases) {
        for (let phase = 0; phase <= 10; phase += 1) {
            if (!ids.has(phase)) errors.push(`Mandatory phase ${phase} is missing from the manifest.`);
        }
    }
    return { errors };
}

function commandForTest(test) {
    let command = test.runner;
    if (command === 'node') command = process.execPath;
    if (command === 'npm') command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    if (command === 'eslint') command = process.platform === 'win32' ? 'eslint.cmd' : 'eslint';
    return { command, args: test.args || [] };
}

function buildCommandText(command, args) {
    return [command, ...(args || [])].map((value) => String(value)).join(' ');
}

function runCommand(test, env) {
    const startedAt = Date.now();
    const executable = commandForTest(test);
    const result = spawnSync(executable.command, executable.args, {
        cwd: ROOT,
        env,
        shell: false,
        windowsHide: true,
        encoding: 'utf8'
    });
    const record = {
        id: test.id,
        label: test.label || test.id,
        command: buildCommandText(executable.command, executable.args),
        cwd: ROOT,
        startedAt: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        exitCode: Number.isInteger(result.status) ? result.status : null,
        signal: result.signal || null,
        stdout: result.stdout || '',
        stderr: result.stderr || ''
    };
    if (result.error) record.spawnError = { code: result.error.code, message: result.error.message };
    if (record.stdout) process.stdout.write(record.stdout);
    if (record.stderr) process.stderr.write(record.stderr);
    return record;
}

function getRevision() {
    const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', shell: false, windowsHide: true });
    return result.status === 0 ? result.stdout.trim() : 'unknown';
}

function defaultReportPath() {
    ensureDirectory(DEFAULT_REPORT_DIR);
    return path.join(DEFAULT_REPORT_DIR, `phase-run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
}

function isCanonicalVerificationScope({ canonicalManifest, all, noEmulator }) {
    return canonicalManifest === true && all !== true && noEmulator !== true;
}

function writeReport(reportPath, report) {
    ensureDirectory(path.dirname(reportPath));
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function reportedError(message) {
    const error = new Error(message);
    error.alreadyReported = true;
    return error;
}

async function runVerification({ argv = process.argv.slice(2), env = process.env } = {}) {
    const parsed = parseArgs(argv);
    const options = parsed.options;
    const reportPath = options.reportPath ? resolveInsideRoot(options.reportPath, 'Report path') : defaultReportPath();
    const manifestPath = resolveInsideRoot(options.manifestPath, 'Manifest path');
    const report = {
        schemaVersion: 1,
        revision: getRevision(),
        startedAt: new Date().toISOString(),
        finishedAt: null,
        root: ROOT,
        manifestPath,
        selection: options.all ? 'all' : options.phase === null ? null : `phase${options.phase}`,
        projectId: DEMO_PROJECT_ID,
        reportPath,
        emulator: null,
        canonicalManifest: false,
        isCanonicalScope: false,
        customScope: false,
        certifiesCanonicalPhase: false,
        commands: [],
        errors: [...parsed.errors],
        summary: { total: 0, passed: 0, failed: 0 },
        success: false
    };
    let emulator = null;
    try {
        if (parsed.errors.length) throw reportedError(parsed.errors.join(' '));
        if (!fs.existsSync(manifestPath)) throw new Error(`Manifest is missing: ${manifestPath}`);
        const manifest = loadManifest(manifestPath);
        report.manifestId = manifest.manifestId || null;
        report.canonicalManifest = path.resolve(manifestPath) === path.resolve(DEFAULT_MANIFEST_PATH);
        report.isCanonicalScope = isCanonicalVerificationScope({
            canonicalManifest: report.canonicalManifest,
            all: options.all,
            noEmulator: options.noEmulator
        });
        report.customScope = !report.canonicalManifest;
        report.certifiesCanonicalPhase = false;
        const validation = validateManifest(manifest, {
            root: ROOT,
            requireAllPhases: options.all,
            validatePhaseIds: options.all ? null : new Set([options.phase])
        });
        if (validation.errors.length) {
            report.errors.push(...validation.errors);
            throw reportedError(validation.errors.join(' '));
        }
        const phase = options.all ? null : manifest.phases.find((candidate) => candidate.id === options.phase);
        if (!options.all && !phase) throw new Error(`Unknown phase ${options.phase}; no manifest entry exists.`);
        const selectedPhases = options.all ? manifest.phases.slice().sort((left, right) => left.id - right.id) : [phase];
        // Every approved phase includes persisted or authenticated acceptance.
        // Pure diagnostics may explicitly opt out with --no-emulator.
        const needsEmulator = selectedPhases.length > 0;
        let childEnv = { ...env };
        if (needsEmulator && !options.noEmulator) {
            const config = getEmulatorConfig(childEnv);
            const sessionDir = path.join(ROOT, 'test-results/crm-projects/sessions', `${Date.now()}-${process.pid}`);
            report.emulator = {
                projectId: config.projectId,
                auth: config.auth,
                firestore: config.firestore,
                storage: config.storage,
                sessionDir,
                stdoutPath: path.join(sessionDir, 'firebase.stdout.log'),
                stderrPath: path.join(sessionDir, 'firebase.stderr.log'),
                started: false,
                stopped: false
            };
            emulator = await startIsolatedEmulators({ config, sessionDir });
            Object.assign(report.emulator, {
                command: buildCommandText(emulator.command.command, emulator.command.args),
                started: true,
                lockPath: emulator.lockPath,
                ownerPid: emulator.ownerPid
            });
            childEnv = { ...childEnv, ...emulatorEnvironment(config), CRM_PROJECTS_EMULATOR_READY: '1' };
            const seedRecord = runCommand({
                id: 'phase0-emulator-fixtures',
                label: 'Seed and round-trip isolated Auth and Firestore fixtures',
                runner: 'node',
                args: ['scripts/crm/projects/seed-fixtures.js']
            }, childEnv);
            report.commands.push(seedRecord);
            if (seedRecord.exitCode !== 0) throw new Error('Isolated emulator fixture seeding failed.');
        }
        for (const currentPhase of selectedPhases) {
            for (const test of currentPhase.tests) {
                const result = runCommand(test, childEnv);
                result.phase = currentPhase.id;
                report.commands.push(result);
                if (result.exitCode !== 0 || result.spawnError) report.errors.push(`Phase ${currentPhase.id} test ${test.id} failed with exit ${result.exitCode ?? 'spawn-error'}.`);
            }
        }
        report.summary.total = report.commands.length;
        report.summary.failed = report.commands.filter((command) => command.exitCode !== 0 || command.spawnError).length;
        report.summary.passed = report.summary.total - report.summary.failed;
        report.success = report.errors.length === 0 && report.summary.failed === 0;
        report.certifiesCanonicalPhase = report.isCanonicalScope && report.success;
    } catch (error) {
        if (!error?.alreadyReported) report.errors.push(error?.message || String(error));
        report.summary.total = report.commands.length;
        report.summary.failed = report.commands.filter((command) => command.exitCode !== 0 || command.spawnError).length;
        if (report.errors.length > 0 && report.summary.failed === 0) {
            report.summary.total = 1;
            report.summary.failed = 1;
        }
        report.summary.passed = report.summary.total - report.summary.failed;
        report.success = false;
        report.certifiesCanonicalPhase = false;
    } finally {
        if (emulator) {
            try {
                await emulator.stop();
                if (report.emulator) report.emulator.stopped = true;
            } catch (error) {
                if (report.emulator) report.emulator.cleanupError = error?.message || String(error);
                report.errors.push(`Isolated emulator cleanup failed: ${error?.message || String(error)}`);
                report.success = false;
                report.certifiesCanonicalPhase = false;
            }
        }
        if (!report.success && report.errors.length > 0 && report.summary.failed === 0) {
            report.summary.total = Math.max(report.summary.total, report.commands.length + 1);
            report.summary.failed = 1;
            report.summary.passed = report.summary.total - report.summary.failed;
        }
        report.finishedAt = new Date().toISOString();
        writeReport(reportPath, report);
    }
    return { exitCode: report.success ? 0 : 1, report };
}

if (require.main === module) {
    runVerification().then(({ exitCode }) => {
        process.exitCode = exitCode;
    }).catch((error) => {
        process.stderr.write(`${error.stack || error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    ROOT,
    DEFAULT_MANIFEST_PATH,
    isPathInsideRoot,
    resolveInsideRoot,
    parseArgs,
    loadManifest,
    validateManifest,
    commandForTest,
    buildCommandText,
    runCommand,
    getRevision,
    isCanonicalVerificationScope,
    runVerification
};
