'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { startOnlineEmulators } = require('./start-online-emulators.cjs');

const repo = path.resolve(__dirname, '../..');
const config = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/bel-demo/online-emulators.json'), 'utf8'));
const credentialsPath = 'C:\\Cursor AI\\.local\\browser-test-credentials.md';

function assertSafeEnvironment(environment = process.env) {
  const project = String(environment.FIREBASE_PROJECT_ID || '').trim();
  if (project && project !== config.projectId) throw new Error(`Refusing rehearsal for non-demo project: ${project}`);
  if (environment.GOOGLE_APPLICATION_CREDENTIALS || environment.FIREBASE_SERVICE_ACCOUNT) throw new Error('Refusing rehearsal with production credential environment variables.');
}

function freePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const value = server.address().port;
      server.close(() => resolve(value));
    });
  });
}

function readAdminCredential() {
  const source = fs.readFileSync(credentialsPath, 'utf8');
  const email = source.match(/Username:\s*`([^`]+)`/i)?.[1] || source.match(/Username:\s*([^\s]+)/i)?.[1];
  const password = source.match(/Password:\s*`([^`]+)`/i)?.[1] || source.match(/Password:\s*([^\s]+)/i)?.[1];
  if (!email || !password || password === '[REDACTED]') throw new Error(`Could not load the local browser credential file: ${credentialsPath}`);
  return { email, password };
}

async function ensureUser(auth, db, account, profile) {
  try { await auth.getUser(account.uid); await auth.updateUser({ uid: account.uid, email: account.email, password: account.password, disabled: false, emailVerified: true }); }
  catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    await auth.createUser({ uid: account.uid, email: account.email, password: account.password, disabled: false, emailVerified: true });
  }
  await db.collection('users').doc(account.uid).set({ ...profile, uid: account.uid, email: account.email, accountStatus: 'active' }, { merge: true });
  await db.collection('crmWorkforceAccounts').doc(account.uid).set({ status: 'active', moduleGrants: { projects: true }, ...profile }, { merge: true });
}

async function seedAccounts(running) {
  const adminCredential = readAdminCredential();
  const nonce = `${Date.now()}-${process.pid}`;
  const accounts = {
    mode: 'firebase-emulator',
    presenter: { uid: 'bel-admin-rehearsal', email: adminCredential.email, password: adminCredential.password },
    participants: [1, 2, 3].map(index => ({ uid: `bel-p${index}-rehearsal`, email: `bel-${nonce}-p${index}@example.test`, password: `BelOnline-${nonce}-${index}!` })),
    outsider: { uid: 'bel-outsider-rehearsal', email: `bel-${nonce}-outsider@example.test`, password: `BelOnline-${nonce}-outsider!` }
  };
  for (const key of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_DATABASE_EMULATOR_HOST', 'FIREBASE_DATABASE_URL', 'FIREBASE_PROJECT_ID', 'GCLOUD_PROJECT', 'STORAGE_EMULATOR_HOST']) process.env[key] = running.environment[key];
  const app = initializeApp({ projectId: running.projectId, databaseURL: running.environment.FIREBASE_DATABASE_URL }, `bel-rehearsal-${process.pid}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  try {
    await ensureUser(auth, db, accounts.presenter, { isAdmin: true, isTeacher: true, crmRole: 'teacher', moduleGrants: { projects: true } });
    for (const account of [...accounts.participants, accounts.outsider]) await ensureUser(auth, db, account, { isAdmin: false, isTeacher: true, crmRole: 'teacher', moduleGrants: { projects: true } });
  } finally {
    const closing = app.delete().catch(() => {});
    await Promise.race([closing, new Promise(resolve => setTimeout(resolve, 3000))]);
  }
  return accounts;
}

function backendEnvironment(running, port) {
  return { ...running.environment, NODE_ENV: 'development', PORT: String(port), PRESENTATION_DEMO_DEV_AUTH: '0', PRESENTATION_DEMO_ONLINE_ENABLED: '1', PRESENTATION_DEMO_DURABLE_READY: '1' };
}

async function waitFor(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.status >= 100 && response.status < 600) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Backend did not become ready: ${url}`);
}

async function startBackend(running, evidenceDir, label) {
  const port = await freePort();
  const logPath = path.join(evidenceDir, `${label}.log`);
  const log = fs.createWriteStream(logPath, { flags: 'w' });
  const child = spawn(process.execPath, [path.join(repo, 'backend/presentation-demo/server.cjs')], { cwd: repo, env: backendEnvironment(running, port), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.pipe(log); child.stderr.pipe(log);
  try { await waitFor(`http://127.0.0.1:${port}/healthz`); }
  catch (error) { await stopBackend({ child, log }); throw error; }
  return { child, log, port, baseUrl: `http://127.0.0.1:${port}`, logPath };
}

async function stopBackend(backend) {
  if (!backend || backend.child.exitCode !== null) { try { backend?.log?.end(); } catch (_) {} return; }
  backend.child.kill('SIGTERM');
  await new Promise(resolve => { const timer = setTimeout(resolve, 5000); backend.child.once('exit', () => { clearTimeout(timer); resolve(); }); });
  try { backend.log.end(); } catch (_) {}
}

async function signInToken(account, running) {
  const host = running.environment.FIREBASE_AUTH_EMULATOR_HOST;
  const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-bel-online`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: account.email, password: account.password, returnSecureToken: true }) });
  const body = await response.json();
  if (!response.ok || !body.idToken) throw new Error(`Auth emulator token exchange failed with ${response.status}.`);
  return body.idToken;
}

function writeAccountsFile(evidenceDir, accounts) {
  const filename = path.join(evidenceDir, `.accounts-${process.pid}.json`);
  fs.writeFileSync(filename, JSON.stringify(accounts, null, 2));
  return filename;
}

function runBrowser(baseUrl, evidenceDir, accounts) {
  const accountFile = writeAccountsFile(evidenceDir, accounts);
  try {
    const result = spawnSync('python', [path.join(repo, 'tests/browser/bel-demo-online/rehearsal.py'), '--channel', 'chrome', '--base-url', baseUrl, '--accounts-file', accountFile, '--evidence', evidenceDir], { cwd: repo, encoding: 'utf8', env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    fs.writeFileSync(path.join(evidenceDir, 'browser-rehearsal.log'), `${result.stdout || ''}${result.stderr || ''}`);
    if (result.status !== 0) throw new Error(`Authenticated Chrome rehearsal failed with exit ${result.status}; see ${path.join(evidenceDir, 'browser-rehearsal.log')}.`);
    return JSON.parse(fs.readFileSync(path.join(evidenceDir, 'rehearsal.json'), 'utf8'));
  } finally { try { fs.rmSync(accountFile, { force: true }); } catch (_) {} }
}

async function main() {
  assertSafeEnvironment();
  const args = new Set(process.argv.slice(2));
  if (!args.has('--emulators')) throw new Error('Usage: node scripts/bel-demo/rehearse-online.cjs --emulators --evidence <external-dir>');
  const evidenceIndex = process.argv.indexOf('--evidence');
  const evidenceDir = evidenceIndex >= 0 ? path.resolve(process.argv[evidenceIndex + 1]) : null;
  if (!evidenceDir) throw new Error('An external --evidence directory is required.');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const running = await startOnlineEmulators({ evidenceDir });
  const backends = [];
  try {
    const accounts = await seedAccounts(running);
    backends.push(await startBackend(running, evidenceDir, 'backend-primary'));
    backends.push(await startBackend(running, evidenceDir, 'backend-secondary'));
    const browser = runBrowser(backends[0].baseUrl, evidenceDir, accounts);
    const adminToken = await signInToken(accounts.presenter, running);
    const terminal = await fetch(`${backends[1].baseUrl}/api/presentation-demo/rooms/${encodeURIComponent(browser.roomId)}`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const archive = await fetch(`${backends[1].baseUrl}/api/presentation-demo/rooms/${encodeURIComponent(browser.roomId)}/archive`, { headers: { Authorization: `Bearer ${adminToken}` } });
    if (!terminal.ok || !archive.ok) throw new Error(`Secondary backend could not read the shared terminal room (${terminal.status}/${archive.status}).`);
    const terminalBody = await terminal.json();
    const archiveBody = await archive.json();
    await stopBackend(backends.shift());
    const failover = await fetch(`${backends[0].baseUrl}/healthz`);
    if (!failover.ok) throw new Error(`Secondary backend did not remain available after primary shutdown (${failover.status}).`);
    const result = { projectId: running.projectId, emulatorPorts: running.ports, backendPorts: backends.map(item => item.port), browser, failover: { secondaryHealth: await failover.json(), terminalLifecycle: terminalBody.data?.lifecycle, archiveStatus: archiveBody.data?.status, sharedArchiveChecksum: archiveBody.data?.checksum } };
    fs.writeFileSync(path.join(evidenceDir, 'online-rehearsal-summary.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    while (backends.length) await stopBackend(backends.pop());
    await running.stop();
  }
}

main().then(() => process.exit(0)).catch(error => { console.error(error.stack || error.message); process.exit(1); });

module.exports = { assertSafeEnvironment, readAdminCredential, seedAccounts, runBrowser };
