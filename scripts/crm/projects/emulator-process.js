'use strict';

const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const {
    DEMO_PROJECT_ID,
    FIREBASE_CONFIG_PATH,
    ROOT,
    assertSafeEmulatorConfig
} = require('./emulator-config');

const LOCK_SCHEMA_VERSION = 1;

function ensureDirectory(directoryPath) {
    fs.mkdirSync(directoryPath, { recursive: true });
    return directoryPath;
}

function createLockToken() {
    return crypto.randomBytes(16).toString('hex');
}

function isProcessAlive(pid) {
    const candidate = Number(pid);
    if (!Number.isInteger(candidate) || candidate <= 0) return false;
    try {
        process.kill(candidate, 0);
        return true;
    } catch (error) {
        if (error?.code === 'EPERM') return true;
        return false;
    }
}

function emulatorLockPath(config, root = ROOT) {
    assertSafeEmulatorConfig(config);
    const base = path.resolve(root);
    return path.resolve(base, 'test-results', 'crm-projects', `.${config.projectId}.emulator.lock`);
}

function readLock(lockPath) {
    let value;
    try {
        value = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch (error) {
        throw new Error(`CRM Projects emulator lock cannot be read safely at ${lockPath}: ${error.message}`);
    }
    if (!value || value.schemaVersion !== LOCK_SCHEMA_VERSION || !Number.isInteger(value.ownerPid) || value.ownerPid <= 0 || typeof value.token !== 'string' || !value.token) {
        throw new Error(`CRM Projects emulator lock is invalid at ${lockPath}; refusing to overwrite it.`);
    }
    return value;
}

function acquireEmulatorLock(config, {
    lockPath = emulatorLockPath(config),
    root = ROOT,
    ownerPid = process.pid,
    token = createLockToken(),
    processAlive = isProcessAlive,
    now = () => new Date().toISOString()
} = {}) {
    assertSafeEmulatorConfig(config);
    const resolvedRoot = path.resolve(root);
    if (!Number.isInteger(ownerPid) || ownerPid <= 0) throw new Error('CRM Projects emulator lock owner PID must be a positive integer.');
    if (typeof token !== 'string' || !token) throw new Error('CRM Projects emulator lock token is required.');
    const resolvedLockPath = path.resolve(lockPath);
    const metadata = {
        schemaVersion: LOCK_SCHEMA_VERSION,
        projectId: config.projectId,
        root: resolvedRoot,
        ownerPid,
        token,
        ports: {
            auth: config.auth.port,
            firestore: config.firestore.port,
            firestoreWebsocket: config.firestore.websocketPort,
            storage: config.storage.port
        },
        acquiredAt: now()
    };
    ensureDirectory(path.dirname(resolvedLockPath));

    let descriptor = null;
    try {
        descriptor = fs.openSync(resolvedLockPath, 'wx');
        fs.writeFileSync(descriptor, `${JSON.stringify(metadata)}\n`, 'utf8');
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = null;
        return { ...metadata, lockPath: resolvedLockPath };
    } catch (error) {
        if (descriptor !== null) {
            try { fs.closeSync(descriptor); } catch (_) { /* best effort after a failed lock write */ }
        }
        if (error?.code !== 'EEXIST') throw error;
        const existing = readLock(resolvedLockPath);
        let alive;
        try {
            alive = Boolean(processAlive(existing.ownerPid));
        } catch (aliveError) {
            throw new Error(`CRM Projects emulator lock owner ${existing.ownerPid} could not be verified safely: ${aliveError.message}`);
        }
        if (alive) {
            throw new Error(`CRM Projects emulator suite already owns ${resolvedRoot}/${config.projectId} (PID ${existing.ownerPid}). Refusing a concurrent suite before emulator spawn.`);
        }
        throw new Error(`CRM Projects emulator lock is stale at ${resolvedLockPath} (owner PID ${existing.ownerPid} is not alive); refusing automatic recovery. Verify the lock and remove it explicitly before retrying.`);
    }
}

function releaseEmulatorLock(lock) {
    if (!lock || typeof lock.lockPath !== 'string' || typeof lock.token !== 'string' || !lock.token) {
        throw new Error('CRM Projects emulator lock ownership metadata is required for release.');
    }
    let existing;
    try {
        existing = readLock(lock.lockPath);
    } catch (error) {
        if (error?.code === 'ENOENT') return { released: false, missing: true };
        if (/cannot be read safely/.test(error.message) && !fs.existsSync(lock.lockPath)) return { released: false, missing: true };
        throw error;
    }
    if (existing.token !== lock.token || existing.ownerPid !== lock.ownerPid) {
        throw new Error(`CRM Projects emulator lock ownership mismatch at ${lock.lockPath}; refusing release.`);
    }
    try {
        fs.unlinkSync(lock.lockPath);
    } catch (error) {
        if (error?.code === 'ENOENT') return { released: false, missing: true };
        throw error;
    }
    return { released: true };
}

function resolveFirebaseCommand() {
    if (process.platform !== 'win32') return { command: 'firebase', prefixArgs: [] };
    const shimPath = path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
    if (fs.existsSync(shimPath)) return { command: process.execPath, prefixArgs: [shimPath] };
    const localPath = path.join(ROOT, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
    if (fs.existsSync(localPath)) return { command: process.execPath, prefixArgs: [localPath] };
    throw new Error('Firebase CLI JavaScript entrypoint could not be resolved without a shell wrapper.');
}

function isPortAvailable(host, port) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', (error) => {
            server.close();
            if (error.code === 'EADDRINUSE') return resolve(false);
            reject(error);
        });
        server.once('listening', () => {
            server.close(() => resolve(true));
        });
        server.listen(port, host);
    });
}

async function assertPortsAvailable(config) {
    assertSafeEmulatorConfig(config);
    for (const endpoint of [config.auth, config.firestore, { host: config.firestore.host, port: config.firestore.websocketPort }, config.storage]) {
        if (!await isPortAvailable(endpoint.host, endpoint.port)) {
            throw new Error(`Dedicated emulator port ${endpoint.host}:${endpoint.port} is already in use; refusing to touch an existing emulator.`);
        }
    }
}

function waitForHttp(url, { timeoutMs = 90000, pollMs = 250 } = {}) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
        const attempt = () => {
            const request = http.get(url, (response) => {
                response.resume();
                response.once('end', () => resolve({ statusCode: response.statusCode }));
            });
            request.once('error', () => {
                if (Date.now() - startedAt >= timeoutMs) {
                    reject(new Error(`Timed out waiting for emulator endpoint ${url}.`));
                } else {
                    setTimeout(attempt, pollMs);
                }
            });
            request.setTimeout(1000, () => request.destroy());
        };
        attempt();
    });
}

function writeRuntimeFirebaseConfig(config, sessionDir) {
    assertSafeEmulatorConfig(config);
    const runtimeConfigPath = path.join(sessionDir, 'firebase.json');
    fs.writeFileSync(runtimeConfigPath, `${JSON.stringify({
        firestore: {
            rules: path.join(ROOT, 'firestore.rules'),
            indexes: path.join(ROOT, 'firestore.indexes.json')
        },
        storage: { rules: path.join(ROOT, 'storage.rules') },
        emulators: {
            auth: { host: config.auth.host, port: config.auth.port },
            firestore: {
                host: config.firestore.host,
                port: config.firestore.port,
                websocketPort: config.firestore.websocketPort
            },
            storage: { host: config.storage.host, port: config.storage.port },
            ui: { enabled: false }
        }
    }, null, 2)}\n`, 'utf8');
    return runtimeConfigPath;
}

function emulatorCommand(config, runtimeConfigPath = FIREBASE_CONFIG_PATH) {
    assertSafeEmulatorConfig(config);
    const cli = resolveFirebaseCommand();
    return {
        command: cli.command,
        args: [
            ...cli.prefixArgs,
            'emulators:start',
            '--only',
            'auth,firestore,storage',
            '--project',
            DEMO_PROJECT_ID,
            '--config',
            runtimeConfigPath,
            '--non-interactive'
        ]
    };
}

function parseWindowsProcessSnapshot(output) {
    if (!String(output || '').trim()) return [];
    let parsed;
    try {
        parsed = JSON.parse(output);
    } catch (error) {
        throw new Error(`Windows process snapshot was not valid JSON: ${error.message}`);
    }
    const records = Array.isArray(parsed) ? parsed : [parsed];
    return records.map((record) => ({
        pid: Number(record.ProcessId ?? record.pid),
        parentPid: Number(record.ParentProcessId ?? record.parentPid),
        name: String(record.Name ?? record.name ?? ''),
        commandLine: String(record.CommandLine ?? record.commandLine ?? ''),
        creationDate: String(record.CreationDate ?? record.creationDate ?? '')
    })).filter((record) => Number.isInteger(record.pid) && record.pid > 0 && Number.isInteger(record.parentPid) && record.parentPid >= 0);
}

function listWindowsProcesses({
    spawnSyncImpl = spawnSync,
    platform = process.platform
} = {}) {
    if (platform !== 'win32') return [];
    const script = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,CreationDate | ConvertTo-Json -Compress';
    const result = spawnSyncImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        cwd: ROOT,
        shell: false,
        windowsHide: true,
        encoding: 'utf8'
    });
    if (result?.error) throw new Error(`Unable to inspect Windows process lineage: ${result.error.message}`);
    if (result?.status !== 0) {
        const detail = String(result?.stderr || result?.stdout || '').trim();
        throw new Error(`Unable to inspect Windows process lineage (exit ${result?.status ?? 'unknown'})${detail ? `: ${detail}` : '.'}`);
    }
    return parseWindowsProcessSnapshot(result?.stdout);
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function commandHasFlagValue(commandLine, flag, value) {
    const pattern = new RegExp(`${escapeRegExp(flag)}(?:=|\\s+)["']?${escapeRegExp(value)}["']?(?=\\s|$)`, 'i');
    return pattern.test(String(commandLine || ''));
}

function commandHasPort(commandLine, port, host) {
    const value = String(port);
    const argumentPattern = new RegExp(`(?:--port|--websocket_port)(?:=|\\s+)["']?${escapeRegExp(value)}["']?(?=\\s|$)`, 'i');
    return argumentPattern.test(String(commandLine || '')) || String(commandLine || '').includes(`${host}:${value}`);
}

function isExpectedEmulatorProcess(record, config) {
    const commandLine = String(record?.commandLine || '');
    if (!commandLine) return false;
    const projectMatch = commandHasFlagValue(commandLine, '--project', config.projectId) || commandHasFlagValue(commandLine, '--project_id', config.projectId);
    if (!projectMatch) return false;
    const portMatch = [
        [config.auth.port, config.auth.host],
        [config.firestore.port, config.firestore.host],
        [config.firestore.websocketPort, config.firestore.host],
        [config.storage.port, config.storage.host]
    ].some(([port, host]) => commandHasPort(commandLine, port, host));
    if (!portMatch) return false;
    return /firebase(?:\.js)?|emulator|cloud-firestore/i.test(commandLine);
}

function findDescendantProcesses(records, rootPid) {
    const byParent = new Map();
    for (const record of records || []) {
        const children = byParent.get(record.parentPid) || [];
        children.push(record);
        byParent.set(record.parentPid, children);
    }
    const descendants = [];
    const visited = new Set([rootPid]);
    const visit = (parentPid, depth) => {
        for (const record of byParent.get(parentPid) || []) {
            if (visited.has(record.pid)) continue;
            visited.add(record.pid);
            descendants.push({ ...record, depth });
            visit(record.pid, depth + 1);
        }
    };
    visit(rootPid, 1);
    return descendants;
}

function createProcessTracker({ child, config, command, listProcesses = () => listWindowsProcesses() }) {
    const known = new Map();
    return {
        child,
        config,
        command,
        known,
        discover() {
            if (!child?.pid) return [];
            const records = listProcesses();
            const descendants = findDescendantProcesses(records, child.pid);
            const current = [];
            for (const record of descendants) {
                if (isExpectedEmulatorProcess(record, config)) {
                    known.set(record.pid, record);
                    current.push(record);
                }
            }
            return current.sort((left, right) => (right.depth || 0) - (left.depth || 0));
        }
    };
}

function terminateProcessTree(pid, {
    spawnSyncImpl = spawnSync,
    platform = process.platform
} = {}) {
    if (platform === 'win32') {
        const result = spawnSyncImpl('taskkill', ['/PID', String(pid), '/T', '/F'], {
            cwd: ROOT,
            shell: false,
            windowsHide: true,
            encoding: 'utf8'
        });
        return result;
    }
    try {
        process.kill(pid, 'SIGTERM');
        return { status: 0, stdout: '', stderr: '' };
    } catch (error) {
        return { status: null, stdout: '', stderr: error.message, error };
    }
}

function assertProcessTermination(result, pid, processAlive = isProcessAlive) {
    if (result?.error) {
        if (!processAlive(pid)) return;
        throw new Error(`Failed to terminate owned emulator descendant ${pid}: ${result.error.message}`);
    }
    if (result?.status !== 0 && processAlive(pid)) {
        const detail = String(result?.stderr || result?.stdout || '').trim();
        throw new Error(`Failed to terminate owned emulator descendant ${pid} (exit ${result?.status ?? 'unknown'})${detail ? `: ${detail}` : '.'}`);
    }
}

function terminateOwnedDescendants(processTracker, {
    terminate = terminateProcessTree,
    processAlive = isProcessAlive
} = {}) {
    if (!processTracker) return { terminated: 0, discovered: 0 };
    const descendants = processTracker.discover();
    let terminated = 0;
    for (const record of descendants) {
        const freshRecord = processTracker.discover().find((candidate) => candidate.pid === record.pid
            && candidate.parentPid === record.parentPid
            && candidate.commandLine === record.commandLine
            && (!record.creationDate || !candidate.creationDate || candidate.creationDate === record.creationDate));
        if (!freshRecord || !processAlive(freshRecord.pid)) continue;
        const result = terminate(freshRecord.pid);
        assertProcessTermination(result, freshRecord.pid, processAlive);
        terminated += 1;
    }
    return { terminated, discovered: descendants.length };
}

async function startIsolatedEmulators({ config, sessionDir, onSpawn = null, lockPath = null }) {
    assertSafeEmulatorConfig(config);
    const lock = acquireEmulatorLock(config, lockPath ? { lockPath } : undefined);
    let child = null;
    let stdout = null;
    let stderr = null;
    let command = null;
    let processTracker = null;
    let lockReleased = false;
    try {
        try {
            await assertPortsAvailable(config);
        } catch (error) {
            try {
                releaseEmulatorLock(lock);
                lockReleased = true;
            } catch (releaseError) {
                error.message = `${error.message} Lock cleanup failed: ${releaseError.message}`;
                error.cleanupError = releaseError;
            }
            throw error;
        }
        ensureDirectory(sessionDir);
        const stdoutPath = path.join(sessionDir, 'firebase.stdout.log');
        const stderrPath = path.join(sessionDir, 'firebase.stderr.log');
        stdout = fs.createWriteStream(stdoutPath, { flags: 'a' });
        stderr = fs.createWriteStream(stderrPath, { flags: 'a' });
        const runtimeConfigPath = writeRuntimeFirebaseConfig(config, sessionDir);
        command = emulatorCommand(config, runtimeConfigPath);
        child = spawn(command.command, command.args, {
            cwd: ROOT,
            env: {
                ...process.env,
                GCLOUD_PROJECT: DEMO_PROJECT_ID,
                FIREBASE_PROJECT_ID: DEMO_PROJECT_ID
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            shell: false
        });
        child.stdout.pipe(stdout);
        child.stderr.pipe(stderr);
        processTracker = createProcessTracker({ child, config, command });
        const processFailure = new Promise((resolve, reject) => {
            child.once('error', reject);
            child.once('exit', (code, signal) => {
                reject(new Error(`Firebase emulator process exited during startup with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}. Logs: ${sessionDir}`));
            });
        });
        processFailure.catch(() => {});
        if (typeof onSpawn === 'function') await onSpawn({ child, processTracker, command, lock });
        await Promise.race([
            processFailure,
            Promise.all([
                waitForHttp(`http://${config.auth.host}:${config.auth.port}/emulator/v1/projects/${config.projectId}/config`, { timeoutMs: 90000 }),
        waitForHttp(`http://${config.firestore.host}:${config.firestore.port}/`, { timeoutMs: 90000 }),
                waitForHttp(`http://${config.storage.host}:${config.storage.port}/`, { timeoutMs: 90000 })
            ])
        ]);
    } catch (error) {
        if (!lockReleased) {
            try {
                await stopIsolatedEmulators(child, stdout, stderr, config, { lock, processTracker });
            } catch (cleanupError) {
                error.message = `${error.message} Cleanup failed: ${cleanupError.message}`;
                error.cleanupError = cleanupError;
            }
        }
        throw error;
    }
    return {
        child,
        command,
        sessionDir,
        stdoutPath: path.join(sessionDir, 'firebase.stdout.log'),
        stderrPath: path.join(sessionDir, 'firebase.stderr.log'),
        lockPath: lock.lockPath,
        ownerPid: lock.ownerPid,
        processTracker,
        stop: () => stopIsolatedEmulators(child, stdout, stderr, config, { lock, processTracker })
    };
}

function waitForChildExit(child, timeoutMs = 10000) {
    if (!child || child.exitCode !== null) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Timed out waiting for owned Firebase emulator process ${child.pid || '(unknown)'} to exit.`)), timeoutMs);
        child.once('exit', () => {
            clearTimeout(timeout);
            resolve();
        });
    });
}

async function waitForPortsReleased(config, timeoutMs = 10000) {
    const endpoints = [config.auth, config.firestore, { host: config.firestore.host, port: config.firestore.websocketPort }, config.storage];
    const deadline = Date.now() + timeoutMs;
    let available;
    do {
        available = await Promise.all(endpoints.map((endpoint) => isPortAvailable(endpoint.host, endpoint.port)));
        if (available.every(Boolean)) return;
        if (Date.now() >= deadline) {
            const occupied = endpoints.filter((_, index) => !available[index]).map((endpoint) => `${endpoint.host}:${endpoint.port}`);
            throw new Error(`Owned Firebase emulator ports were not released: ${occupied.join(', ')}.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    const occupied = endpoints.filter((_, index) => !available[index]).map((endpoint) => `${endpoint.host}:${endpoint.port}`);
    throw new Error(`Owned Firebase emulator ports were not released: ${occupied.join(', ')}.`);
}

async function stopIsolatedEmulators(child, stdout, stderr, config, {
    portTimeoutMs = 10000,
    lock = null,
    processTracker = null,
    terminate = (pid) => terminateProcessTree(pid),
    processAlive = isProcessAlive
} = {}) {
    if (!config) throw new Error('Emulator config is required to verify owned port cleanup.');
    assertSafeEmulatorConfig(config);
    if (processTracker) processTracker.discover();
    if (child && child.exitCode === null && child.pid) {
        if (process.platform === 'win32') {
            const killResult = terminate(child.pid);
            if (killResult?.error && processAlive(child.pid)) throw new Error(`Failed to terminate owned emulator process: ${killResult.error.message}`);
            if (killResult?.status !== 0 && processAlive(child.pid)) {
                const detail = (killResult.stderr || killResult.stdout || '').trim();
                throw new Error(`taskkill failed with exit ${killResult.status}${detail ? `: ${detail}` : '.'}`);
            }
        } else {
            if (!child.kill('SIGTERM') && child.exitCode === null) throw new Error('Failed to signal owned Firebase emulator process.');
        }
        await waitForChildExit(child);
    } else if (child && processTracker) {
        terminateOwnedDescendants(processTracker, { terminate, processAlive });
    }
    await Promise.all([
        new Promise((resolve) => stdout ? stdout.end(resolve) : resolve()),
        new Promise((resolve) => stderr ? stderr.end(resolve) : resolve())
    ]);
    await waitForPortsReleased(config, portTimeoutMs);
    if (lock) releaseEmulatorLock(lock);
    return { stopped: true };
}

module.exports = {
    ensureDirectory,
    createLockToken,
    emulatorLockPath,
    acquireEmulatorLock,
    releaseEmulatorLock,
    resolveFirebaseCommand,
    isPortAvailable,
    assertPortsAvailable,
    waitForHttp,
    emulatorCommand,
    writeRuntimeFirebaseConfig,
    startIsolatedEmulators,
    stopIsolatedEmulators,
    waitForChildExit,
    waitForPortsReleased,
    parseWindowsProcessSnapshot,
    listWindowsProcesses,
    isExpectedEmulatorProcess,
    findDescendantProcesses,
    createProcessTracker,
    terminateProcessTree,
    terminateOwnedDescendants
};
