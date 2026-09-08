'use strict';

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const {
    acquireEmulatorLock,
    assertPortsAvailable,
    createProcessTracker,
    findDescendantProcesses,
    isExpectedEmulatorProcess,
    releaseEmulatorLock,
    startIsolatedEmulators,
    stopIsolatedEmulators,
    terminateOwnedDescendants,
    waitForPortsReleased
} = require('../../../scripts/crm/projects/emulator-process');
const {
    DEMO_PROJECT_ID,
    getEmulatorConfig
} = require('../../../scripts/crm/projects/emulator-config');
const {
    applyEmulatorEnvironment,
    seedFixtures
} = require('../../../scripts/crm/projects/seed-fixtures');

function listenOnEphemeralPort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

function closeServer(server) {
    return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function main() {
    assert.throws(
        () => getEmulatorConfig({ CRM_PROJECTS_EMULATOR_PROJECT: 'production-crm' }),
        /demo project/i,
        'non-demo project configuration must be rejected'
    );
    assert.throws(
        () => getEmulatorConfig({ CRM_PROJECTS_EMULATOR_HOST: '192.0.2.10' }),
        /loopback/i,
        'non-loopback emulator host must be rejected'
    );
    assert.throws(
        () => getEmulatorConfig({ CRM_PROJECTS_EMULATOR_AUTH_PORT: '443' }),
        /loopback port/i,
        'privileged or invalid emulator ports must be rejected'
    );
    assert.throws(
        () => getEmulatorConfig({
            CRM_PROJECTS_EMULATOR_AUTH_PORT: '9180',
            CRM_PROJECTS_EMULATOR_FIRESTORE_PORT: '9180'
        }),
        /distinct/i,
        'Auth and Firestore ports must be distinct'
    );

    assert.throws(
        () => getEmulatorConfig({
            CRM_PROJECTS_EMULATOR_AUTH_PORT: '9181',
            FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9180'
        }),
        /points to.*refusing/i,
        'an inherited endpoint for another port must be rejected'
    );

    const safeConfig = getEmulatorConfig({});
    const productionEnv = { FIREBASE_AUTH_EMULATOR_HOST: '203.0.113.20:443' };
    const originalProductionEnv = { ...productionEnv };
    assert.throws(
        () => applyEmulatorEnvironment(safeConfig, productionEnv),
        /refusing to overwrite/i,
        'fixture setup must reject an existing production endpoint before mutation'
    );
    assert.deepStrictEqual(productionEnv, originalProductionEnv, 'rejected environment must not be mutated');

    let injectedAuthCalled = false;
    const injectedApp = {
        options: { projectId: 'production-crm' },
        auth() {
            injectedAuthCalled = true;
            throw new Error('injected app must not be used');
        }
    };
    await assert.rejects(
        () => seedFixtures({ config: safeConfig, app: injectedApp }),
        /dedicated demo project/i,
        'an injected app must not bypass the demo-project guard'
    );
    assert.strictEqual(injectedAuthCalled, false, 'invalid injected app must be rejected before SDK access or writes');

    const lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-projects-emulator-lock-'));
    const lockPath = path.join(lockRoot, 'suite.lock');
    try {
        const firstLock = acquireEmulatorLock(safeConfig, {
            lockPath,
            root: lockRoot,
            ownerPid: process.pid,
            token: 'first-suite-token'
        });
        assert.throws(
            () => acquireEmulatorLock(getEmulatorConfig({ CRM_PROJECTS_EMULATOR_AUTH_PORT: '9181' }), {
                lockPath,
                root: lockRoot,
                ownerPid: process.pid,
                token: 'second-suite-token',
                processAlive: () => true
            }),
            /already owns/i,
            'a second suite must be refused by the workspace/demo-project lock before it can use alternate ports'
        );
        assert.throws(
            () => releaseEmulatorLock({ ...firstLock, token: 'wrong-token' }),
            /ownership/i,
            'a suite must not release another owner\'s lock'
        );
        releaseEmulatorLock(firstLock);
        assert.strictEqual(fs.existsSync(lockPath), false, 'the owner must release its lock after cleanup');

        fs.writeFileSync(lockPath, `${JSON.stringify({
            schemaVersion: 1,
            projectId: safeConfig.projectId,
            root: lockRoot,
            ownerPid: 2147483647,
            token: 'stale-race-token'
        })}\n`, 'utf8');
        assert.throws(
            () => acquireEmulatorLock(safeConfig, {
                lockPath,
                root: lockRoot,
                ownerPid: process.pid,
                token: 'race-recovery-token',
                processAlive: () => {
                    fs.writeFileSync(lockPath, `${JSON.stringify({
                        schemaVersion: 1,
                        projectId: safeConfig.projectId,
                        root: lockRoot,
                        ownerPid: process.pid,
                        token: 'replacement-live-token'
                    })}\n`, 'utf8');
                    return false;
                }
            }),
            /stale/i,
            'dead-owner locks must fail closed without automatic recovery'
        );
        assert.strictEqual(JSON.parse(fs.readFileSync(lockPath, 'utf8')).token, 'replacement-live-token', 'replacement lock must remain intact');
        fs.unlinkSync(lockPath);
    } finally {
        fs.rmSync(lockRoot, { recursive: true, force: true });
    }

    const processRecords = [
        { pid: 7001, parentPid: 7000, name: 'java.exe', creationDate: '20260907090000.000000+420', commandLine: `java -jar cloud-firestore-emulator.jar --port ${safeConfig.firestore.port} --websocket_port ${safeConfig.firestore.websocketPort} --project_id ${safeConfig.projectId}` },
        { pid: 7002, parentPid: 7000, name: 'java.exe', commandLine: `java -jar cloud-firestore-emulator.jar --port ${safeConfig.firestore.port} --project_id another-project` },
        { pid: 7003, parentPid: 7001, name: 'node.exe', commandLine: 'node unrelated-child.js' }
    ];
    assert.deepStrictEqual(findDescendantProcesses(processRecords, 7000).map((record) => record.pid), [7001, 7003, 7002], 'lineage discovery must stay rooted at the spawned CLI PID');
    assert.strictEqual(isExpectedEmulatorProcess(processRecords[0], safeConfig), true);
    assert.strictEqual(isExpectedEmulatorProcess(processRecords[1], safeConfig), false, 'matching a dedicated port without the suite project must not authorize termination');
    const terminated = [];
    const tracker = createProcessTracker({
        child: { pid: 7000 },
        config: safeConfig,
        listProcesses: () => processRecords
    });
    const terminatedResult = terminateOwnedDescendants(tracker, {
        processAlive: (pid) => pid === 7001,
        terminate: (pid) => {
            terminated.push(pid);
            return { status: 0 };
        }
    });
    assert.deepStrictEqual(terminated, [7001], 'only the expected project emulator descendant may be terminated');
    assert.deepStrictEqual(terminatedResult, { terminated: 1, discovered: 1 });
    let replacementSnapshot = 0;
    const replacementTracker = createProcessTracker({
        child: { pid: 7000 },
        config: safeConfig,
        listProcesses: () => {
            replacementSnapshot += 1;
            return replacementSnapshot === 1
                ? [processRecords[0]]
                : [{ ...processRecords[0], parentPid: 7999, commandLine: 'java unrelated --port 8188 --project_id another-project' }];
        }
    });
    const replacementTerminated = [];
    const replacementResult = terminateOwnedDescendants(replacementTracker, {
        processAlive: () => true,
        terminate: (pid) => {
            replacementTerminated.push(pid);
            return { status: 0 };
        }
    });
    assert.deepStrictEqual(replacementTerminated, [], 'a reused PID with changed lineage/command must not be terminated');
    assert.deepStrictEqual(replacementResult, { terminated: 0, discovered: 1 });

    const occupied = await listenOnEphemeralPort();
    try {
        const occupiedPort = occupied.address().port;
        const occupiedConfig = getEmulatorConfig({ CRM_PROJECTS_EMULATOR_AUTH_PORT: String(occupiedPort) });
        await assert.rejects(
            () => assertPortsAvailable(occupiedConfig),
            /already in use/i,
            'an occupied dedicated port must be refused before emulator startup'
        );
        assert.strictEqual(occupied.listening, true, 'the existing listener must remain untouched');

        await assert.rejects(
            () => startIsolatedEmulators({
                config: occupiedConfig,
                sessionDir: path.join(lockRoot, 'pre-spawn-port-failure'),
                lockPath: path.join(lockRoot, 'pre-spawn-port-failure.lock')
            }),
            (error) => /already in use/i.test(error.message) && !/cleanup failed/i.test(error.message),
            'a pre-spawn occupied port must report the original guard failure without treating the external listener as owned cleanup'
        );
        assert.strictEqual(fs.existsSync(path.join(lockRoot, 'pre-spawn-port-failure.lock')), false, 'pre-spawn failure must release its own lock');

        await assert.rejects(
            () => waitForPortsReleased(occupiedConfig, 100),
            /not released/i,
            'occupied ports must not be reported as released'
        );
        await assert.rejects(
            () => stopIsolatedEmulators({ exitCode: 0 }, null, null, occupiedConfig, { portTimeoutMs: 100 }),
            /not released/i,
            'cleanup must propagate a port-release failure'
        );
        assert.strictEqual(occupied.listening, true, 'cleanup failure must not terminate an unowned listener');
    } finally {
        await closeServer(occupied);
    }

    assert.strictEqual(safeConfig.projectId, DEMO_PROJECT_ID);
    process.stdout.write('crm projects emulator isolation guards passed\n');
}

main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
});
