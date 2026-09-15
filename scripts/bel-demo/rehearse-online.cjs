'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
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
    for (const account of accounts.participants) await ensureUser(auth, db, account, { isAdmin: false, isTeacher: true, crmRole: 'teacher', moduleGrants: {} });
    await ensureUser(auth, db, accounts.outsider, { isAdmin: false, isTeacher: true, crmRole: 'teacher', moduleGrants: {} });
  } finally {
    const closing = app.delete().catch(() => {});
    await Promise.race([closing, new Promise(resolve => setTimeout(resolve, 3000))]);
  }
  return accounts;
}

function backendEnvironment(running, port, allowedOrigins = []) {
  return { ...running.environment, NODE_ENV: 'development', PORT: String(port), PRESENTATION_DEMO_DEV_AUTH: '0', PRESENTATION_DEMO_ONLINE_ENABLED: '1', PRESENTATION_DEMO_DURABLE_READY: '1', PRESENTATION_DEMO_ALLOWED_ORIGINS: allowedOrigins.join(',') };
}

async function waitFor(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.status >= 100 && response.status < 600) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Backend did not become ready: ${url}`);
}

async function startBackend(running, evidenceDir, label, { port = null, allowedOrigins = [] } = {}) {
  port ||= await freePort();
  const logPath = path.join(evidenceDir, `${label}.log`);
  const log = fs.createWriteStream(logPath, { flags: 'w' });
  const child = spawn(process.execPath, [path.join(repo, 'backend/presentation-demo/server.cjs')], { cwd: repo, env: backendEnvironment(running, port, allowedOrigins), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
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

async function apiJson(backend, method, pathname, token, body = undefined) {
  const options = { method, headers: { Authorization: `Bearer ${token}` } };
  if (body !== undefined) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
  options.signal = AbortSignal.timeout(20000);
  const response = await fetch(`${backend.baseUrl}${pathname}`, options);
  const parsed = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body: parsed };
}

function requireApi(result, label) {
  if (!result.ok || result.body?.success === false) throw new Error(`${label} failed with ${result.status}: ${result.body?.error?.code || result.body?.error?.message || 'unknown error'}`);
  return result.body.data;
}

async function runMixedGatewayProbe(backends, accounts, running) {
  const [primary, secondary] = backends;
  const identities = [accounts.presenter, ...accounts.participants];
  const tokens = Object.fromEntries(await Promise.all(identities.map(async account => [account.uid, await signInToken(account, running)])));
  const gatewayFor = uid => uid === accounts.presenter.uid || uid === accounts.participants[0].uid ? primary : secondary;
  const create = requireApi(await apiJson(primary, 'POST', '/api/presentation-demo/rooms', tokens[accounts.presenter.uid], { operationId: crypto.randomUUID() }), 'mixed-gateway create');
  const roomId = create.roomId;
  console.log(`mixed-gateway: room ${roomId} created`);
  for (const account of accounts.participants) { requireApi(await apiJson(gatewayFor(account.uid), 'POST', '/api/presentation-demo/join', tokens[account.uid], { code: create.code, operationId: crypto.randomUUID() }), `mixed-gateway join ${account.uid}`); console.log(`mixed-gateway: ${account.uid} joined`); }
  const tickets = {};
  for (const account of identities) tickets[account.uid] = requireApi(await apiJson(gatewayFor(account.uid), 'POST', `/api/presentation-demo/rooms/${encodeURIComponent(roomId)}/ticket`, tokens[account.uid]), `mixed-gateway ticket ${account.uid}`);
  const connections = {};
  for (const account of identities) { connections[account.uid] = requireApi(await apiJson(gatewayFor(account.uid), 'POST', '/api/presentation-demo/connect', tokens[account.uid], { ticket: tickets[account.uid].ticket }), `mixed-gateway connect ${account.uid}`); console.log(`mixed-gateway: ${account.uid} connected`); }
  for (const account of identities) requireApi(await apiJson(gatewayFor(account.uid), 'POST', `/api/presentation-demo/rooms/${encodeURIComponent(roomId)}/bootstrap`, tokens[account.uid], {}), `mixed-gateway bootstrap ${account.uid}`);
  console.log('mixed-gateway: all seats bootstrapped');

  const p1 = accounts.participants[0]; const p2 = accounts.participants[1];
  const noteBody = 'ế'.repeat(50000);
  const validNote = await apiJson(primary, 'PUT', `/api/presentation-demo/rooms/${encodeURIComponent(roomId)}/notes/${encodeURIComponent(p1.uid)}`, tokens[p1.uid], { pageId: 'unicode', title: 'Vietnamese note', body: noteBody, expectedVersion: 0 });
  const oversizedNote = await apiJson(primary, 'PUT', `/api/presentation-demo/rooms/${encodeURIComponent(roomId)}/notes/${encodeURIComponent(p1.uid)}`, tokens[p1.uid], { pageId: 'oversized', title: 'Too large', body: 'ế'.repeat(50001), expectedVersion: 0 });
  if (!validNote.ok || validNote.status === 413) throw new Error(`Valid Vietnamese note was rejected with ${validNote.status}.`);
  if (oversizedNote.status === 413 || oversizedNote.body?.error?.code !== 'NOTE_INVALID') throw new Error(`Oversized Vietnamese note was not rejected by the note contract: ${oversizedNote.status}/${oversizedNote.body?.error?.code}`);
  console.log(`mixed-gateway: note sizes passed (${validNote.status}/${oversizedNote.status})`);

  const concurrent = await Promise.all([
    apiJson(primary, 'POST', '/api/presentation-demo/input', tokens[p1.uid], { connectionId: connections[p1.uid].connectionId, command: { type: 'move', seq: 1, dx: 1, dy: 0 } }),
    apiJson(secondary, 'POST', '/api/presentation-demo/input', tokens[p2.uid], { connectionId: connections[p2.uid].connectionId, command: { type: 'move', seq: 1, dx: 1, dy: 0 } })
  ]);
  if (concurrent.some(result => !result.ok || result.body?.success === false)) throw new Error(`Mixed-gateway concurrent input failed: ${JSON.stringify(concurrent)}`);
  const concurrentHeartbeats = await Promise.all([
    apiJson(primary, 'POST', '/api/presentation-demo/heartbeat', tokens[p1.uid], { connectionId: connections[p1.uid].connectionId }),
    apiJson(secondary, 'POST', '/api/presentation-demo/heartbeat', tokens[p2.uid], { connectionId: connections[p2.uid].connectionId })
  ]);
  if (concurrentHeartbeats.some(result => !result.ok || result.body?.error?.code === 'OWNER_LEASE_HELD')) throw new Error(`Mixed-gateway heartbeat failed: ${JSON.stringify(concurrentHeartbeats)}`);
  console.log('mixed-gateway: concurrent input and heartbeats passed');
  const replayCommand = { type: 'move', seq: 2, dx: 1, dy: 0 };
  const firstReplay = await apiJson(secondary, 'POST', '/api/presentation-demo/input', tokens[p2.uid], { connectionId: connections[p2.uid].connectionId, commandId: 'durable-replay-check', command: replayCommand });
  const sameReplay = await apiJson(secondary, 'POST', '/api/presentation-demo/input', tokens[p2.uid], { connectionId: connections[p2.uid].connectionId, commandId: 'durable-replay-check', command: replayCommand });
  const changedReplay = await apiJson(secondary, 'POST', '/api/presentation-demo/input', tokens[p2.uid], { connectionId: connections[p2.uid].connectionId, commandId: 'durable-replay-check', command: { type: 'move', seq: 2, dx: 0, dy: 1 } });
  if (!firstReplay.ok || !sameReplay.ok || changedReplay.body?.error?.code !== 'COMMAND_RECEIPT_CONFLICT') throw new Error(`Durable replay binding failed: ${JSON.stringify([firstReplay, sameReplay, changedReplay])}`);
  console.log('mixed-gateway: durable replay binding passed');

  const replacementTicket = requireApi(await apiJson(secondary, 'POST', `/api/presentation-demo/rooms/${encodeURIComponent(roomId)}/ticket`, tokens[p2.uid]), 'mixed-gateway replacement ticket');
  const replacement = requireApi(await apiJson(secondary, 'POST', '/api/presentation-demo/connect', tokens[p2.uid], { ticket: replacementTicket.ticket, replaceExisting: true }), 'mixed-gateway replacement connect');
  const supersededReplay = await apiJson(secondary, 'POST', '/api/presentation-demo/input', tokens[p2.uid], { connectionId: connections[p2.uid].connectionId, commandId: 'durable-replay-check', command: replayCommand });
  if (supersededReplay.body?.error?.code !== 'STALE_CONNECTION') throw new Error(`Superseded generation was accepted: ${JSON.stringify(supersededReplay)}`);
  const afterReplacementHeartbeat = await apiJson(primary, 'POST', '/api/presentation-demo/heartbeat', tokens[p1.uid], { connectionId: connections[p1.uid].connectionId });
  if (!afterReplacementHeartbeat.ok || afterReplacementHeartbeat.body?.error?.code === 'OWNER_LEASE_HELD') throw new Error(`Owner was stolen by a reconnect: ${JSON.stringify(afterReplacementHeartbeat)}`);
  console.log('mixed-gateway: replacement and surviving owner heartbeat passed');
  const terminal = requireApi(await apiJson(primary, 'POST', `/api/presentation-demo/rooms/${encodeURIComponent(roomId)}/end`, tokens[accounts.presenter.uid], { reason: 'mixed-gateway-probe' }), 'mixed-gateway end');
  const history = await apiJson(primary, 'GET', '/api/presentation-demo/rooms', tokens[p1.uid]);
  const archive = requireApi(await apiJson(primary, 'GET', `/api/presentation-demo/rooms/${encodeURIComponent(roomId)}/archive`, tokens[p1.uid]), 'mixed-gateway archive read');
  const archivePages = archive.notebooks?.[p1.uid]?.pages || [];
  if (!history.ok || history.body?.success === false) throw new Error(`Active teacher history read failed with ${history.status}.`);
  if (!archivePages.some(page => page.id === 'unicode' && page.body === noteBody)) throw new Error('Archive did not retain the readable Vietnamese note.');
  return {
    roomId,
    gateways: { primary: primary.baseUrl, secondary: secondary.baseUrl, p1: primary.baseUrl, p2: secondary.baseUrl },
    concurrentInput: concurrent.map(result => result.status),
    concurrentHeartbeats: concurrentHeartbeats.map(result => result.status),
    replacement: { seat: replacement.seatId, generation: replacement.generation, survivingHeartbeat: afterReplacementHeartbeat.status, supersededReplay: supersededReplay.status },
    durableReplay: { first: firstReplay.status, samePayload: sameReplay.status, changedPayload: changedReplay.status, changedCode: changedReplay.body?.error?.code },
    ownerLeaseErrors: [...concurrent, ...concurrentHeartbeats, afterReplacementHeartbeat].filter(result => result.body?.error?.code === 'OWNER_LEASE_HELD').length,
    validVietnameseNote: { status: validNote.status, utf8Bytes: Buffer.byteLength(noteBody, 'utf8') },
    oversizedVietnameseNote: { status: oversizedNote.status, code: oversizedNote.body?.error?.code },
    teacherHistory: { status: history.status, rooms: history.body?.data?.length || 0 },
    archive: { status: 200, readablePageCount: archivePages.length, terminalLifecycle: terminal.lifecycle }
  };
}

function writeAccountsFile(evidenceDir, accounts) {
  const filename = path.join(evidenceDir, `.accounts-${process.pid}.json`);
  fs.writeFileSync(filename, JSON.stringify(accounts, null, 2));
  return filename;
}

function runBrowser(baseUrl, evidenceDir, accounts, { failoverUrl = null, signalPath = null } = {}) {
  const accountFile = writeAccountsFile(evidenceDir, accounts);
  const logPath = path.join(evidenceDir, 'browser-rehearsal.log');
  fs.writeFileSync(logPath, '');
  const args = [path.join(repo, 'tests/browser/bel-demo-online/rehearsal.py'), '--channel', 'chrome', '--base-url', baseUrl, '--accounts-file', accountFile, '--evidence', evidenceDir];
  if (failoverUrl) args.push('--failover-url', failoverUrl);
  if (signalPath) args.push('--failover-signal', signalPath);
  const child = spawn('python', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, PYTHONUNBUFFERED: '1' }, windowsHide: true });
  const run = new Promise((resolve, reject) => {
    const record = chunk => { try { fs.appendFileSync(logPath, String(chunk)); } catch (_) {} };
    child.stdout.on('data', record);
    child.stderr.on('data', record);
    child.once('exit', code => {
      try { fs.rmSync(accountFile, { force: true }); } catch (_) {}
      if (code !== 0) return reject(new Error(`Authenticated Chrome rehearsal failed with exit ${code}; see ${logPath}.`));
      try { return resolve(JSON.parse(fs.readFileSync(path.join(evidenceDir, 'rehearsal.json'), 'utf8'))); }
      catch (error) { return reject(error); }
    });
    child.once('error', error => { try { fs.rmSync(accountFile, { force: true }); } catch (_) {} reject(error); });
  });
  run.child = child;
  run.stop = () => { try { child.kill(); } catch (_) {} };
  return run;
}

async function waitForFile(filename, timeoutMs = 1800000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filename)) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Browser rehearsal did not reach failover checkpoint: ${filename}`);
}

function settleOutcome(promise) {
  return promise.then(
    value => ({ ok: true, value }),
    error => ({ ok: false, error })
  );
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
    const primaryPort = await freePort();
    const secondaryPort = await freePort();
    const allowedOrigins = [`http://127.0.0.1:${primaryPort}`, `http://127.0.0.1:${secondaryPort}`];
    backends.push(await startBackend(running, evidenceDir, 'backend-primary', { port: primaryPort, allowedOrigins }));
    backends.push(await startBackend(running, evidenceDir, 'backend-secondary', { port: secondaryPort, allowedOrigins }));
    const mixedGateway = await runMixedGatewayProbe(backends, accounts, running);
    const failoverSignal = path.join(evidenceDir, 'failover-ready.signal');
    try { fs.rmSync(failoverSignal, { force: true }); } catch (_) {}
    const browserPromise = runBrowser(backends[0].baseUrl, evidenceDir, accounts, { failoverUrl: backends[1].baseUrl, signalPath: failoverSignal });
    const browserOutcome = settleOutcome(browserPromise);
    let checkpoint;
    try {
      checkpoint = await Promise.race([
        waitForFile(failoverSignal).then(() => ({ type: 'signal' })),
        browserOutcome.then(outcome => ({ type: 'browser', outcome }))
      ]);
    } catch (error) { browserPromise.stop(); throw error; }
    if (checkpoint.type === 'browser') {
      if (!checkpoint.outcome.ok) throw checkpoint.outcome.error;
      throw new Error('Browser rehearsal completed without reaching the failover checkpoint.');
    }
    await stopBackend(backends.shift());
    const completedBrowser = await browserOutcome;
    if (!completedBrowser.ok) throw completedBrowser.error;
    const browser = completedBrowser.value;
    const adminToken = await signInToken(accounts.presenter, running);
    const survivingBackend = backends[0];
    const terminal = await fetch(`${survivingBackend.baseUrl}/api/presentation-demo/rooms/${encodeURIComponent(browser.roomId)}`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const archive = await fetch(`${survivingBackend.baseUrl}/api/presentation-demo/rooms/${encodeURIComponent(browser.roomId)}/archive`, { headers: { Authorization: `Bearer ${adminToken}` } });
    if (!terminal.ok || !archive.ok) throw new Error(`Secondary backend could not read the shared terminal room (${terminal.status}/${archive.status}).`);
    const terminalBody = await terminal.json();
    const archiveBody = await archive.json();
    const failover = await fetch(`${survivingBackend.baseUrl}/healthz`);
    if (!failover.ok) throw new Error(`Secondary backend did not remain available after primary shutdown (${failover.status}).`);
    const result = { projectId: running.projectId, emulatorPorts: running.ports, backendPorts: backends.map(item => item.port), mixedGateway, browser, failover: { secondaryHealth: await failover.json(), terminalLifecycle: terminalBody.data?.lifecycle, archiveStatus: archiveBody.data?.status, sharedArchiveChecksum: archiveBody.data?.checksum } };
    fs.writeFileSync(path.join(evidenceDir, 'online-rehearsal-summary.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    while (backends.length) await stopBackend(backends.pop());
    await running.stop();
  }
}

if (require.main === module) main().then(() => process.exit(0)).catch(error => { console.error(error.stack || error.message); process.exit(1); });

module.exports = { assertSafeEnvironment, readAdminCredential, seedAccounts, runBrowser, settleOutcome, startBackend, stopBackend, signInToken, apiJson };
