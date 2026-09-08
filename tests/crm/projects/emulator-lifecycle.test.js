'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const {
    ROOT,
    getEmulatorConfig,
    emulatorEnvironment
} = require('../../../scripts/crm/projects/emulator-config');
const {
    isPortAvailable,
    isExpectedEmulatorProcess,
    startIsolatedEmulators,
    waitForChildExit
} = require('../../../scripts/crm/projects/emulator-process');

const RECOVERY_ROOT = path.join(ROOT, 'test-results', 'crm-projects', 'harness-recovery');

function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForFirestoreDescendant(processTracker, config, timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const records = processTracker.discover();
        const firestore = records.find((record) => isExpectedEmulatorProcess(record, config) && String(record.commandLine).includes(`--port ${config.firestore.port}`));
        if (firestore) return firestore;
        await sleep(250);
    }
    throw new Error(`Timed out waiting for the Firestore emulator descendant on ${config.firestore.port}.`);
}

function killCliOnly(pid) {
    const result = spawnSync('taskkill', ['/PID', String(pid), '/F'], {
        cwd: ROOT,
        shell: false,
        windowsHide: true,
        encoding: 'utf8'
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`taskkill CLI-only termination failed with exit ${result.status}: ${result.stderr || result.stdout || ''}`);
}

function createUnrelatedProcess() {
    return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        cwd: ROOT,
        env: { ...process.env, ...emulatorEnvironment(getEmulatorConfig({})) },
        stdio: 'ignore',
        windowsHide: true,
        shell: false
    });
}

async function assertDedicatedPortsAvailable(config, label) {
    const available = await Promise.all([
        isPortAvailable(config.auth.host, config.auth.port),
        isPortAvailable(config.firestore.host, config.firestore.port),
        isPortAvailable(config.firestore.host, config.firestore.websocketPort),
        isPortAvailable(config.storage.host, config.storage.port)
    ]);
    assert.ok(available.every(Boolean), `${label}: expected all dedicated emulator ports to be free, got ${available.join(', ')}`);
}

async function runStartupFailureProof(config) {
    const sessionDir = path.join(RECOVERY_ROOT, `startup-failure-${Date.now()}-${process.pid}`);
    let captured = null;
    const unrelated = createUnrelatedProcess();
    try {
        await assert.rejects(
            () => startIsolatedEmulators({
                config,
                sessionDir,
                onSpawn: async (state) => {
                    captured = state;
                    await waitForFirestoreDescendant(state.processTracker, config);
                    killCliOnly(state.child.pid);
                    await waitForChildExit(state.child, 10000);
                }
            }),
            /Firebase emulator process exited during startup/i,
            'a CLI exit after Firestore starts must reject startup'
        );
        assert.ok(captured?.processTracker.known.size > 0, 'startup failure must record an actual emulator descendant');
        await assertDedicatedPortsAvailable(config, 'startup failure cleanup');
        assert.strictEqual(fs.existsSync(captured.lock.lockPath), false, 'startup failure cleanup must release its own lock');
        assert.strictEqual(unrelated.exitCode, null, 'unrelated process must remain alive after owned startup cleanup');
        process.stdout.write(`startup failure recovered ${captured.processTracker.known.size} owned descendant(s); ports released\n`);
    } finally {
        if (unrelated.exitCode === null) unrelated.kill();
    }
}

async function runNormalCleanupProof(config) {
    const sessionDir = path.join(RECOVERY_ROOT, `normal-cleanup-${Date.now()}-${process.pid}`);
    const emulator = await startIsolatedEmulators({ config, sessionDir });
    try {
        const firestore = await waitForFirestoreDescendant(emulator.processTracker, config);
        assert.ok(firestore.pid > 0, 'normal cleanup proof must observe the real Firestore child');
        await emulator.stop();
        await assertDedicatedPortsAvailable(config, 'normal cleanup');
        assert.strictEqual(fs.existsSync(emulator.lockPath), false, 'normal cleanup must release its own lock');
        process.stdout.write(`normal cleanup released Firestore child ${firestore.pid} and dedicated ports\n`);
    } catch (error) {
        if (emulator.child.exitCode === null) {
            try { await emulator.stop(); } catch (_) { /* preserve the original assertion */ }
        }
        throw error;
    }
}

async function runForcedExitAfterReadinessProof(config) {
    const sessionDir = path.join(RECOVERY_ROOT, `forced-exit-${Date.now()}-${process.pid}`);
    const emulator = await startIsolatedEmulators({ config, sessionDir });
    const unrelated = createUnrelatedProcess();
    try {
        const firestore = await waitForFirestoreDescendant(emulator.processTracker, config);
        assert.ok(firestore.pid > 0, 'forced exit proof must observe the real Firestore child');
        killCliOnly(emulator.child.pid);
        await waitForChildExit(emulator.child, 10000);
        assert.notStrictEqual(emulator.child.exitCode, null, 'forced CLI exit must be visible to the parent process');
        await emulator.stop();
        await assertDedicatedPortsAvailable(config, 'forced CLI exit cleanup');
        assert.strictEqual(fs.existsSync(emulator.lockPath), false, 'forced CLI exit cleanup must release its own lock');
        assert.strictEqual(unrelated.exitCode, null, 'unrelated process must remain alive after descendant recovery');
        process.stdout.write(`forced CLI exit recovered Firestore child ${firestore.pid}; owned ports released; unrelated PID ${unrelated.pid} preserved\n`);
    } finally {
        if (unrelated.exitCode === null) unrelated.kill();
        if (emulator.child.exitCode === null) {
            try { await emulator.stop(); } catch (_) { /* preserve the original assertion */ }
        }
    }
}

async function main() {
    if (process.platform !== 'win32') {
        process.stdout.write('crm projects emulator lifecycle proof skipped: Windows descendant lineage is required\n');
        return;
    }
    const config = getEmulatorConfig({ ...process.env });
    fs.mkdirSync(RECOVERY_ROOT, { recursive: true });
    await assertDedicatedPortsAvailable(config, 'preflight');
    await runStartupFailureProof(config);
    await runNormalCleanupProof(config);
    await runForcedExitAfterReadinessProof(config);
    process.stdout.write('crm projects emulator lifecycle proofs passed\n');
}

main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
});
