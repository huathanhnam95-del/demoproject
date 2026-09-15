'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '../..');
const config = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/bel-demo/online-emulators.json'), 'utf8'));

function safeEnvironment(source = process.env, ports = config) {
    const projectId = String(source.FIREBASE_PROJECT_ID || config.projectId).trim();
    const databaseInstance = `${projectId}-default-rtdb`;
    if (projectId !== config.projectId) throw new Error(`Refusing emulator orchestration for non-demo project: ${projectId}`);
    if (source.GOOGLE_APPLICATION_CREDENTIALS || source.FIREBASE_SERVICE_ACCOUNT) throw new Error('Refusing emulator orchestration with production credentials.');
    return {
        ...source,
        FIREBASE_PROJECT_ID: projectId,
        GCLOUD_PROJECT: projectId,
        FIREBASE_AUTH_EMULATOR_HOST: `${ports.auth.host}:${ports.auth.port}`,
        FIRESTORE_EMULATOR_HOST: `${ports.firestore.host}:${ports.firestore.port}`,
        FIREBASE_DATABASE_EMULATOR_HOST: `${ports.database.host}:${ports.database.port}`,
        FIREBASE_DATABASE_URL: `http://${ports.database.host}:${ports.database.port}?ns=${databaseInstance}`,
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
    value.database = { ...(value.database || {}), instance: `${config.projectId}-default-rtdb`, rules: path.join(repo, 'database.rules.json') };
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

function windowsFirebaseCleanupScript(temporaryConfig) {
    const escapedConfig = path.resolve(temporaryConfig).replace(/'/g, "''");
    return [
        `$config = [System.IO.Path]::GetFullPath('${escapedConfig}')`,
        '$targets = @(Get-CimInstance Win32_Process | Where-Object {',
        "    $_.Name -eq 'node.exe' -and $_.CommandLine -and",
        '    $_.CommandLine.Contains($config) -and',
        "    $_.CommandLine.Contains('firebase.js') -and",
        "    $_.CommandLine.Contains('emulators:start')",
        '})',
        'foreach ($target in $targets) { & taskkill /PID $target.ProcessId /T /F | Out-Null }'
    ].join('\n');
}

function stopWindowsFirebaseByConfig(temporaryConfig) {
    const encoded = Buffer.from(windowsFirebaseCleanupScript(temporaryConfig), 'utf16le').toString('base64');
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { stdio: 'ignore' });
}

function ensureFunctionDependencies() {
    const packageEntry = path.join(repo, 'functions', 'node_modules', 'firebase-functions', 'package.json');
    if (fs.existsSync(packageEntry)) return;
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    execFileSync(npm, ['ci', '--omit=dev'], { cwd: path.join(repo, 'functions'), stdio: 'inherit' });
}

async function waitFor(url, timeoutMs = 60000, accept = status => status >= 100 && status < 600) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url);
            // A readiness probe only needs a live HTTP listener. Emulator
            // gateways legitimately return 403/501 for an un-authenticated
            // root request, so do not mistake that for a startup failure.
            if (accept(response.status)) return response.status;
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
    // CLI debug logs follow cwd; keep them in the evidence directory. The
    // explicit config remains beside firebase.json for source resolution.
    const child = spawn(executable, ['emulators:start', '--only', 'auth,firestore,database,functions,storage', '--project', config.projectId, '--config', process.platform === 'win32' ? `"${temporaryConfig}"` : temporaryConfig, '--non-interactive'], { cwd: evidenceDir ? path.resolve(evidenceDir) : repo, env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: process.platform === 'win32' });
    let logClosed = false;
    let readyResolve;
    const readySignal = new Promise(resolve => { readyResolve = resolve; });
    const record = chunk => {
        if (String(chunk).includes('All emulators ready')) readyResolve();
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
        const childRunning = child.exitCode === null && !child.killed;
        if (process.platform === 'win32') {
            // The .cmd shell can exit before the long-lived Firebase Node CLI.
            // Kill both the still-attached tree and any exact config-bound
            // launcher so a failed rehearsal cannot orphan emulator JVMs.
            if (childRunning && child.pid) {
                try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) { try { child.kill('SIGTERM'); } catch (_) {} }
            }
            try { stopWindowsFirebaseByConfig(temporaryConfig); } catch (_) { if (childRunning) try { child.kill('SIGTERM'); } catch (_) {} }
        } else if (childRunning) child.kill('SIGTERM');
        if (childRunning) await new Promise(resolve => { const timer = setTimeout(resolve, 3000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
        try { fs.unlinkSync(temporaryConfig); } catch (_) {}
        if (log && !logClosed) { logClosed = true; try { fs.closeSync(log); } catch (_) {} }
    };
    try {
        await Promise.race([Promise.all([
            waitFor(`http://${ports.auth.host}:${ports.auth.port}`),
            waitFor(`http://${ports.firestore.host}:${ports.firestore.port}`),
            waitFor(`http://${ports.storage.host}:${ports.storage.port}`),
            waitFor(`http://${ports.database.host}:${ports.database.port}`),
            waitFor(`http://${ports.functions.host}:${ports.functions.port}/${config.projectId}/us-central1/api/config`),
            readySignal
        ]), childFailure]);
        // The CLI can initialize a fallback namespace in a demo project.
        // Explicitly install the repository rules into the exact namespace
        // used by the app before admitting any test clients.
        const databaseBase = `http://${ports.database.host}:${ports.database.port}`;
        const namespace = `${config.projectId}-default-rtdb`;
        const rules = fs.readFileSync(path.join(repo, 'database.rules.json'), 'utf8');
        const rulesUrl = `${databaseBase}/.settings/rules.json?ns=${namespace}`;
        const installed = await fetch(rulesUrl, { method: 'PUT', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: rules });
        if (!installed.ok) throw new Error(`RTDB emulator rules installation failed (${installed.status}).`);
        const actual = await fetch(rulesUrl, { headers: { Authorization: 'Bearer owner' } }).then(response => response.json());
        if (JSON.stringify(actual) !== JSON.stringify(JSON.parse(rules))) throw new Error('RTDB emulator rules do not match the repository.');
        const denial = await fetch(`${databaseBase}/presentationRooms.json?ns=${namespace}`);
        if (![401, 403].includes(denial.status)) throw new Error('RTDB emulator must deny direct anonymous room reads.');
        if (evidenceDir) fs.writeFileSync(path.join(evidenceDir, 'database-rules-installed.json'), JSON.stringify({ namespace, sha256: require('node:crypto').createHash('sha256').update(rules).digest('hex'), anonymousStatus: denial.status }, null, 2));
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

module.exports = { config, safeEnvironment, startOnlineEmulators, temporaryFirebaseConfig, waitFor, windowsFirebaseCleanupScript };
