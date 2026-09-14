'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '../..');
const config = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/bel-demo/online-emulators.json'), 'utf8'));

function safeEnvironment(source = process.env, ports = config) {
    const projectId = String(source.FIREBASE_PROJECT_ID || config.projectId).trim();
    if (projectId !== config.projectId) throw new Error(`Refusing emulator orchestration for non-demo project: ${projectId}`);
    if (source.GOOGLE_APPLICATION_CREDENTIALS || source.FIREBASE_SERVICE_ACCOUNT) throw new Error('Refusing emulator orchestration with production credentials.');
    return {
        ...source,
        FIREBASE_PROJECT_ID: projectId,
        GCLOUD_PROJECT: projectId,
        FIREBASE_AUTH_EMULATOR_HOST: `${ports.auth.host}:${ports.auth.port}`,
        FIRESTORE_EMULATOR_HOST: `${ports.firestore.host}:${ports.firestore.port}`,
        FIREBASE_DATABASE_EMULATOR_HOST: `${ports.database.host}:${ports.database.port}`,
        FIREBASE_DATABASE_URL: `http://${ports.database.host}:${ports.database.port}?ns=${projectId}`,
        STORAGE_EMULATOR_HOST: `${ports.storage.host}:${ports.storage.port}`,
        PRESENTATION_DEMO_ONLINE_ENABLED: '1',
        PRESENTATION_DEMO_DURABLE_READY: '1',
        PRESENTATION_DEMO_DEV_AUTH: '0'
    };
}

function freePort(host, preferred) {
    return new Promise(resolve => {
        const probe = net.createServer();
        probe.once('error', () => resolve(null));
        probe.listen(preferred, host, () => {
            const port = probe.address().port;
            probe.close(() => resolve(port));
        });
    });
}

async function resolvePorts() {
    const ports = {};
    for (const name of ['auth', 'firestore', 'database', 'functions', 'storage']) {
        const preferred = config[name];
        let port = await freePort(preferred.host, preferred.port);
        if (!port) {
            for (let candidate = preferred.port + 1; candidate < preferred.port + 100; candidate += 1) {
                port = await freePort(preferred.host, candidate);
                if (port) break;
            }
        }
        if (!port) throw new Error(`No free port available for ${name}.`);
        ports[name] = { host: preferred.host, port };
    }
    return ports;
}

function temporaryFirebaseConfig(ports) {
    const value = JSON.parse(fs.readFileSync(path.join(repo, 'firebase.json'), 'utf8'));
    value.firestore = { ...(value.firestore || {}), rules: path.join(repo, 'firestore.rules'), indexes: path.join(repo, 'firestore.indexes.json') };
    value.database = { ...(value.database || {}), rules: path.join(repo, 'database.rules.json') };
    value.storage = { ...(value.storage || {}), rules: path.join(repo, 'storage.rules') };
    value.functions = (value.functions || []).map(item => ({ ...item, source: item.source || 'functions' }));
    for (const name of ['auth', 'firestore', 'database', 'functions', 'storage']) {
        value.emulators[name] = { ...(value.emulators[name] || {}), host: ports[name].host, port: ports[name].port };
    }
    value.emulators.ui = { ...(value.emulators.ui || {}), enabled: false };
    // Firebase resolves source/rules relative to the config directory. Keep
    // this generated config beside firebase.json so Windows drive paths are
    // not treated as relative strings by firebase-tools.
    const filename = path.join(repo, `.firebase-online-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(filename, JSON.stringify(value, null, 2));
    return filename;
}

function ensureFunctionDependencies() {
    const packageEntry = path.join(repo, 'functions', 'node_modules', 'firebase-functions', 'package.json');
    if (fs.existsSync(packageEntry)) return;
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    execFileSync(npm, ['ci', '--omit=dev'], { cwd: path.join(repo, 'functions'), stdio: 'inherit' });
}

async function waitFor(url, timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url);
            // A readiness probe only needs a live HTTP listener. Emulator
            // gateways legitimately return 403/501 for an un-authenticated
            // root request, so do not mistake that for a startup failure.
            if (response.status >= 100 && response.status < 600) return response.status;
        } catch (error) { lastError = error; }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Emulator did not become ready: ${url}${lastError ? ` (${lastError.message})` : ''}`);
}

async function startOnlineEmulators({ evidenceDir = null } = {}) {
    ensureFunctionDependencies();
    const ports = await resolvePorts();
    const environment = safeEnvironment(process.env, ports);
    const temporaryConfig = temporaryFirebaseConfig(ports);
    const logPath = evidenceDir ? path.join(path.resolve(evidenceDir), 'firebase-emulators.log') : null;
    if (logPath) fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const log = logPath ? fs.openSync(logPath, 'w') : null;
    const executable = process.platform === 'win32' ? 'firebase.cmd' : 'firebase';
    const child = spawn(executable, ['emulators:start', '--only', 'auth,firestore,database,functions,storage', '--project', config.projectId, '--config', process.platform === 'win32' ? `"${temporaryConfig}"` : temporaryConfig, '--non-interactive'], { cwd: repo, env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: process.platform === 'win32' });
    let logClosed = false;
    const record = chunk => {
        if (log && !logClosed) {
            try { fs.writeSync(log, chunk); } catch (_) { logClosed = true; }
        } else if (!log) process.stdout.write(chunk);
    };
    child.stdout.on('data', record);
    child.stderr.on('data', record);
    const childFailure = new Promise((_, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => {
            if (code !== null && code !== 0) reject(new Error(`firebase emulators exited with code ${code}${signal ? ` (${signal})` : ''}.`));
        });
    });
    const stop = async () => {
        if (child.exitCode !== null || child.killed) { try { fs.unlinkSync(temporaryConfig); } catch (_) {} if (log && !logClosed) { logClosed = true; try { fs.closeSync(log); } catch (_) {} } return; }
        if (process.platform === 'win32' && child.pid) {
            // firebase.cmd is launched through a shell on Windows; terminate
            // the shell tree before its wrapper exits and orphan the Node CLI.
            try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) { try { child.kill('SIGTERM'); } catch (_) {} }
        } else child.kill('SIGTERM');
        await new Promise(resolve => { const timer = setTimeout(resolve, 3000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
        try { fs.unlinkSync(temporaryConfig); } catch (_) {}
        if (log && !logClosed) { logClosed = true; try { fs.closeSync(log); } catch (_) {} }
    };
    try {
        await Promise.race([Promise.all([
            waitFor(`http://${ports.auth.host}:${ports.auth.port}`),
            waitFor(`http://${ports.firestore.host}:${ports.firestore.port}`),
            waitFor(`http://${ports.database.host}:${ports.database.port}/.settings/rules.json?ns=${config.projectId}`),
            waitFor(`http://${ports.storage.host}:${ports.storage.port}`),
            waitFor(`http://${ports.functions.host}:${ports.functions.port}/${config.projectId}/us-central1/api/config`)
        ]), childFailure]);
        return { child, stop, environment, projectId: config.projectId, ports, logPath, temporaryConfig };
    } catch (error) {
        await stop();
        throw error;
    }
}

async function main() {
    const index = process.argv.indexOf('--evidence');
    const evidenceDir = index >= 0 ? process.argv[index + 1] : null;
    if (!evidenceDir) throw new Error('Usage: node scripts/bel-demo/start-online-emulators.cjs --evidence <external-dir>');
    const running = await startOnlineEmulators({ evidenceDir });
    console.log(JSON.stringify({ projectId: running.projectId, ports: running.ports, logPath: running.logPath }, null, 2));
    process.on('SIGINT', async () => { await running.stop(); process.exit(0); });
    process.on('SIGTERM', async () => { await running.stop(); process.exit(0); });
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { config, safeEnvironment, startOnlineEmulators, temporaryFirebaseConfig, waitFor };
