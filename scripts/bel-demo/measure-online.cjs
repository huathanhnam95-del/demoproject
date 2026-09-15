'use strict';

// Local, authenticated load measurement. No production project or credential
// environment is accepted. Reports contain counters, never tokens or notes.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const WebSocket = require('../../functions/node_modules/ws');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { startOnlineEmulators } = require('./start-online-emulators.cjs');
const { assertSafeEnvironment, seedAccounts, startBackend, stopBackend, signInToken, apiJson } = require('./rehearse-online.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const percentile = (values, quantile) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] || 0; };

function wireObserver(counts) {
  let buffer = Buffer.alloc(0), upgraded = false, bypass = false, pieces = [], expected = 0;
  function application(payload) {
    const value = payload.toString('utf8');
    if (/^\d+$/.test(value)) { expected = Number(value); pieces = []; return; }
    if (expected) { pieces.push(value); if (pieces.length < expected) return; expected = 0; return application(Buffer.from(pieces.join(''))); }
    try { const message = JSON.parse(value); const action = message.t === 'd' && message.d?.a; if (action) counts[action] = (counts[action] || 0) + 1; } catch (_) { /* handshake or protocol keepalive */ }
  }
  const receiver = new WebSocket.Receiver({ isServer: true, maxPayload: 10 * 1024 * 1024 });
  receiver.on('message', application);
  receiver.on('error', error => {
    counts.observerErrors = (counts.observerErrors || 0) + 1;
    const key = 'observerError:' + (error.code || 'INVALID_FRAME'); counts[key] = (counts[key] || 0) + 1;
    bypass = true;
  });
  return chunk => {
    if (bypass) return;
    if (!upgraded) {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf('\r\n\r\n'); if (end < 0) return;
      const headers = buffer.subarray(0, end).toString('ascii');
      if (!/upgrade:\s*websocket/i.test(headers)) { bypass = true; counts.httpConnections = (counts.httpConnections || 0) + 1; buffer = Buffer.alloc(0); return; }
      upgraded = true; receiver.write(Buffer.from(buffer.subarray(end + 4))); buffer = Buffer.alloc(0);
    } else {
      // ws can unmask its input in place. The forwarding socket must retain
      // the original bytes, so the observer always receives its own copy.
      receiver.write(Buffer.from(chunk));
    }
  };
}

async function databaseProxy(target) {
  const metrics = { uploadBytes: 0, downloadBytes: 0, actions: {} }, sockets = new Set();
  const server = net.createServer(client => {
    const upstream = net.connect(target.port, target.host); sockets.add(client); sockets.add(upstream);
    const observe = wireObserver(metrics.actions);
    client.on('data', bytes => { metrics.uploadBytes += bytes.length; observe(bytes); });
    upstream.on('data', bytes => { metrics.downloadBytes += bytes.length; });
    client.pipe(upstream); upstream.pipe(client);
    for (const socket of [client, upstream]) socket.on('error', () => { client.destroy(); upstream.destroy(); }).on('close', () => sockets.delete(socket));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { metrics, port: server.address().port, close: async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); } };
}

class Client {
  constructor(account, token, backend, roomId, metrics) { Object.assign(this, { account, token, backend, roomId, metrics, sequence: 0, inputSequence: 0, pending: new Map(), snapshot: null, receivedAt: 0 }); }
  async connect(replaceExisting = false) {
    const ticket = await apiJson(this.backend, 'POST', `/api/presentation-demo/rooms/${this.roomId}/ticket`, this.token, {});
    if (!ticket.ok) throw Error('Ticket rejected: ' + ticket.status);
    this.socket = new WebSocket(this.backend.baseUrl.replace('http:', 'ws:') + '/api/presentation-demo/ws', ['bearer.' + this.token], { origin: this.backend.baseUrl });
    const socket = this.socket;
    this.socket.on('message', raw => {
      if (socket !== this.socket) return;
      this.metrics.socketDownloadBytes += raw.length;
      const message = JSON.parse(raw), value = message.data;
      if (value.snapshot) {
        if (value.snapshot.roomId !== this.roomId) { this.metrics.failures.push({ code: 'CROSS_ROOM_SNAPSHOT' }); socket.terminate(); return; }
        this.snapshot = value.snapshot; this.receivedAt = Date.now();
        this.metrics.maxPublicBytes = Math.max(this.metrics.maxPublicBytes, Buffer.byteLength(JSON.stringify(value.snapshot)));
        if (value.snapshot.gameplay?.tickAt) this.metrics.snapshotAges.push(Math.max(0, Date.now() - value.snapshot.gameplay.tickAt));
      }
      const pending = this.pending.get(value.requestId);
      if (pending) { this.pending.delete(value.requestId); message.type === 'error' ? pending.reject(Object.assign(Error(value.message), { code: value.code })) : pending.resolve(value); }
    });
    this.socket.on('close', () => { if (socket !== this.socket) return; for (const pending of this.pending.values()) pending.reject(Object.assign(Error('Socket closed'), { code: 'SOCKET_CLOSED' })); this.pending.clear(); });
    await new Promise((resolve, reject) => { this.socket.once('open', resolve); this.socket.once('error', reject); });
    const result = await this.request('connect', { ticket: ticket.body.data.ticket, replaceExisting, protocolVersion: 2, contentVersion: 'bel-working-as-equals-1' });
    this.connection = result; this.sequence = result.snapshot.acceptedSequence.command; this.inputSequence = result.snapshot.acceptedSequence.input;
    return result;
  }
  request(type, payload = {}, id = crypto.randomUUID()) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('Timed out: ' + type)); }, 22000);
      this.pending.set(id, { resolve: value => { clearTimeout(timer); if (type === 'input') this.metrics.commandLatencies.push(Date.now() - start); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      const text = JSON.stringify({ type, requestId: id, ...payload }); this.metrics.socketUploadBytes += Buffer.byteLength(text); this.socket.send(text);
    });
  }
  command(type, values) { const command = { type, seq: type === 'move' ? ++this.inputSequence : ++this.sequence, ...values }; return this.request('input', { command }); }
  close() { this.socket?.terminate(); }
}

async function main() {
  assertSafeEnvironment();
  const args = process.argv.slice(2), arg = name => args[args.indexOf(name) + 1];
  if (!args.includes('--evidence')) throw Error('--evidence <external directory> is required');
  const evidence = path.resolve(arg('--evidence')), repo = path.resolve(__dirname, '../..');
  if (evidence === repo || evidence.startsWith(repo + path.sep)) throw Error('Measurement evidence must be outside Git');
  const seconds = args.includes('--seconds') ? Number(arg('--seconds')) : args.includes('--minutes') ? Number(arg('--minutes')) * 60 : 1800;
  if (!(seconds >= 10 && seconds <= 3600)) throw Error('Duration must be 10–3600 seconds');
  fs.mkdirSync(evidence, { recursive: true });
  const running = await startOnlineEmulators({ evidenceDir: evidence });
  const backends = [], clients = []; let proxy;
  const metrics = { startedAt: new Date().toISOString(), durationSeconds: seconds, roomCount: 2, clientCount: 8, socketUploadBytes: 0, socketDownloadBytes: 0, maxPublicBytes: 0, maxHotBytes: 0, snapshotAges: [], commandLatencies: [], samples: [], failures: [], reconnectMs: [], failoverMs: null };
  try {
    const accounts = await seedAccounts(running);
    const app = initializeApp({ projectId: running.projectId }, 'bel-measure-' + process.pid);
    const db = getFirestore(app);
    await db.collection('users').doc(accounts.outsider.uid).update({ isAdmin: true });
    await db.terminate(); await deleteApp(app);
    proxy = await databaseProxy(running.ports.database);
    const environment = { ...running.environment, PRESENTATION_DEMO_METRICS: '1', FIREBASE_DATABASE_EMULATOR_HOST: '127.0.0.1:' + proxy.port, FIREBASE_DATABASE_URL: `http://127.0.0.1:${proxy.port}?ns=${running.projectId}-default-rtdb` };
    const measured = { ...running, environment };
    for (const name of ['measure-primary', 'measure-secondary']) backends.push(await startBackend(measured, evidence, name));
    const groups = [[accounts.presenter, ...accounts.participants], [accounts.outsider, ...accounts.participants]];
    const roomIds = [];
    for (const group of groups) {
      const token = await signInToken(group[0], running), created = await apiJson(backends[0], 'POST', '/api/presentation-demo/rooms', token, { operationId: crypto.randomUUID() });
      if (!created.ok) throw Error('Create rejected: ' + created.status);
      const room = created.body.data; roomIds.push(room.roomId);
      for (let index = 0; index < group.length; index++) {
        const account = group[index], actorToken = await signInToken(account, running), backend = backends[index % 2];
        if (index) { const joined = await apiJson(backend, 'POST', '/api/presentation-demo/join', actorToken, { code: room.code, operationId: crypto.randomUUID() }); if (!joined.ok) throw Error('Join rejected'); }
        const client = new Client(account, actorToken, backend, room.roomId, metrics); clients.push(client); await client.connect();
        await client.command('setReady', { ready: true, instance: client.snapshot.gameplay.players[client.connection.seatId].instance });
      }
    }
    // A profile in room A must remain absent in room B for the same account.
    await clients[1].command('profile', { name: 'Room A only', appearance: { hat: 'cap', glasses: true, shirt: 'blue' } });
    await sleep(300);
    if (clients[5].snapshot.slots.p1.displayName === 'Room A only') throw Error('Cross-room character leakage');
    metrics.twoRoomIsolation = true;
    for (const client of clients) {
      const started = Date.now(); client.close(); await sleep(50); await client.connect(true); metrics.reconnectMs.push(Date.now() - started);
    }
    async function sample(elapsed) {
      const value = { elapsed, backends: [] };
      for (const backend of backends) if (backend.child.exitCode === null && backend.child.signalCode === null) value.backends.push(await fetch(backend.baseUrl + '/local-measurements', { signal: AbortSignal.timeout(5000) }).then(response => response.json()));
      metrics.samples.push(value); return value;
    }
    const wireBefore = structuredClone(proxy.metrics), socketBefore = { uploadBytes: metrics.socketUploadBytes, downloadBytes: metrics.socketDownloadBytes };
    metrics.commandLatencies.length = 0; metrics.snapshotAges.length = 0;
    await sample(0);
    const measureStart = Date.now(); let lastHeartbeat = 0, lastSample = 0, failedOver = false;
    while (Date.now() - measureStart < seconds * 1000) {
      const now = Date.now(), elapsed = now - measureStart;
      if (seconds >= 120 && !failedOver && elapsed >= seconds * 500) {
        await sample(elapsed);
        const start = Date.now(); await stopBackend(backends[0]);
        for (const client of clients) { client.close(); client.backend = backends[1]; }
        await Promise.all(clients.map(client => client.connect(true)));
        metrics.failoverMs = Date.now() - start; failedOver = true;
      }
      const commands = clients.map(client => client.command('move', { dx: Math.floor(elapsed / 1500) % 2 ? 1 : -1, dy: 0 }));
      if (now - lastHeartbeat >= 5000) { lastHeartbeat = now; commands.push(...clients.map(client => client.request('heartbeat'))); }
      const results = await Promise.allSettled(commands);
      for (const result of results) if (result.status === 'rejected') metrics.failures.push({ at: elapsed, code: result.reason.code || result.reason.message });
      if (now - lastSample >= 5000) {
        lastSample = now;
        await sample(elapsed);
        for (const roomId of roomIds) {
          const state = await fetch(`http://${running.ports.database.host}:${running.ports.database.port}/presentationRooms/${roomId}.json?ns=${running.projectId}-default-rtdb`, { headers: { Authorization: 'Bearer owner' } }).then(response => response.json());
          metrics.maxHotBytes = Math.max(metrics.maxHotBytes, Buffer.byteLength(JSON.stringify(state)));
        }
        fs.writeFileSync(path.join(evidence, 'progress.json'), JSON.stringify({ elapsed, failures: metrics.failures, maxHotBytes: metrics.maxHotBytes, maxPublicBytes: metrics.maxPublicBytes, databaseActions: proxy.metrics.actions }));
        if (proxy.metrics.actions.observerErrors) throw Error('Database operation observation failed; retain this run as diagnostic evidence.');
      }
      await sleep(Math.max(0, 100 - (Date.now() - now)));
    }
    metrics.measuredDurationMs = Date.now() - measureStart;
    await sample(metrics.measuredDurationMs);
    metrics.measuredWire = { uploadBytes: proxy.metrics.uploadBytes - wireBefore.uploadBytes, downloadBytes: proxy.metrics.downloadBytes - wireBefore.downloadBytes, actions: Object.fromEntries(Object.entries(proxy.metrics.actions).map(([key, value]) => [key, value - (wireBefore.actions[key] || 0)])) };
    metrics.measuredSockets = { uploadBytes: metrics.socketUploadBytes - socketBefore.uploadBytes, downloadBytes: metrics.socketDownloadBytes - socketBefore.downloadBytes };
    metrics.sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    metrics.databaseWire = proxy.metrics;
    metrics.snapshotAgeP95Ms = percentile(metrics.snapshotAges, .95);
    metrics.commandP95Ms = percentile(metrics.commandLatencies, .95);
    metrics.reconnectP95Ms = percentile(metrics.reconnectMs, .95);
    metrics.snapshotCount = metrics.snapshotAges.length; metrics.commandCount = metrics.commandLatencies.length;
    metrics.pass = !metrics.failures.length && !proxy.metrics.actions.observerErrors && metrics.maxHotBytes <= 65536 && metrics.maxPublicBytes <= 16384 && metrics.snapshotAgeP95Ms <= 500 && metrics.commandP95Ms <= 500 && metrics.reconnectP95Ms <= 5000 && (metrics.failoverMs === null || metrics.failoverMs <= 20000);
    for (const client of clients.filter(client => client.connection.seatId === 'p0')) await apiJson(backends.at(-1), 'POST', `/api/presentation-demo/rooms/${client.roomId}/end`, client.token, { reason: 'measurement-complete' });
    console.log(JSON.stringify({ pass: metrics.pass, commandP95Ms: metrics.commandP95Ms, snapshotAgeP95Ms: metrics.snapshotAgeP95Ms, maxHotBytes: metrics.maxHotBytes, maxPublicBytes: metrics.maxPublicBytes }));
    if (!metrics.pass) process.exitCode = 1;
  } catch (error) {
    metrics.pass = false; metrics.failures.push({ code: error.code || 'MEASUREMENT_FAILED', message: error.message }); throw error;
  } finally {
    for (const client of clients) client.close();
    for (const backend of backends) await stopBackend(backend);
    if (proxy) { metrics.databaseWire = proxy.metrics; await proxy.close(); if (proxy.metrics.actions.observerErrors) { metrics.pass = false; process.exitCode = 1; } }
    await running.stop();
    metrics.endedAt = new Date().toISOString();
    const { snapshotAges, commandLatencies, ...report } = metrics;
    fs.writeFileSync(path.join(evidence, 'measurement.json'), JSON.stringify(report, null, 2));
  }
}

if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { wireObserver, percentile };
