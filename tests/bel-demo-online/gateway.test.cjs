const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('../../functions/node_modules/ws');
const { createMemoryRoomStores, createRoomService } = require('../../functions/src/crm/presentation-demo/room-service.cjs');
const { createConnectionService } = require('../../functions/src/crm/presentation-demo/connection-service.cjs');
const { createNotebookService } = require('../../functions/src/crm/presentation-demo/notes-service.cjs');
const { createArchiveService } = require('../../functions/src/crm/presentation-demo/archive-service.cjs');
const { createPdfService } = require('../../functions/src/crm/presentation-demo/pdf-service.cjs');
const { createServer } = require('../../backend/presentation-demo/server.cjs');

test('gateway admits a timely ticket across lease wait, rejects missing and mismatched credentials without snapshots', { timeout: 9000 }, async () => {
    const { installWebSocketGateway } = require('../../backend/presentation-demo/gateway.cjs');
    const server = require('node:http').createServer();
    let enabled = true;
    let opens = 0;
    const gateway = installWebSocketGateway(server, {
        enabled: () => enabled,
        authenticate: async () => ({ uid: 'admission', accountStatus: 'active', isAdmin: true }),
        connections: {
            open: async () => { opens++; await new Promise(resolve => setTimeout(resolve, 5200)); return { roomId: 'admission', role: 'presenter', snapshot: { roomId: 'admission' } }; },
            subscribe: () => () => {}, close: async () => {}, validate: () => {}
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const sockets = [];
    async function socket() {
        const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/presentation-demo/ws`, ['bearer.token']);
        sockets.push(ws); const messages = []; ws.on('message', raw => messages.push(JSON.parse(raw)));
        const closed = new Promise(resolve => ws.once('close', code => resolve(code)));
        await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
        return { ws, messages, closed };
    }
    try {
        const [idle, mismatch, slow] = await Promise.all([socket(), socket(), socket()]);
        const packet = { type: 'connect', ticket: 'single-use-ticket', protocolVersion: 2, contentVersion: 'bel-working-as-equals-1', requestId: 'admission' };
        mismatch.ws.send(JSON.stringify({ ...packet, protocolVersion: 1 }));
        const connected = new Promise(resolve => slow.ws.on('message', raw => { const message = JSON.parse(raw); if (message.type === 'connected') resolve(message); }));
        slow.ws.send(JSON.stringify(packet));
        assert.equal(await mismatch.closed, 4401);
        assert.deepEqual(mismatch.messages.map(item => item.type), ['error']);
        assert.equal(mismatch.messages[0].data.code, 'PROTOCOL_MISMATCH');
        assert.equal(await idle.closed, 4401);
        assert.equal(idle.messages.length, 0);
        assert.equal((await connected).data.snapshot.roomId, 'admission');
        assert.equal(opens, 1);
        enabled = false;
        const rejected = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/presentation-demo/ws`, ['bearer.token']);
        rejected.on('error', () => {});
        const status = await new Promise(resolve => rejected.once('unexpected-response', (_req, response) => { resolve(response.statusCode); response.resume(); rejected.terminate(); }));
        assert.equal(status, 503);
        slow.ws.send(JSON.stringify({ type: 'heartbeat', requestId: 'disabled' }));
        assert.equal(await slow.closed, 4409);
        assert.equal(slow.messages.find(message => message.data?.requestId === 'disabled').data.code, 'FEATURE_DISABLED');
    } finally {
        for (const ws of sockets) ws.terminate(); await gateway.close();
        await new Promise(resolve => server.close(resolve));
    }
});

test('authenticated WebSocket gateway returns public DTOs and reauthorizes each command', async () => {
    const admin = { uid: 'gateway-admin', email: 'gateway@example.com', accountStatus: 'active', isAdmin: true, isTeacher: true };
    const outsider = { uid: 'gateway-outsider', email: 'outsider@example.com', accountStatus: 'active', isTeacher: true };
    const stores = createMemoryRoomStores();
    const roomService = createRoomService({ stores, idFactory: () => 'room-gateway', codeFactory: () => 'ABCD23' });
    const notes = createNotebookService({ roomService });
    const archives = createArchiveService({ roomService, notesService: notes, stores });
    const server = createServer({
        featureEnabled: () => true,
        services: { roomService, connections: createConnectionService({ roomService }), notes, archives, pdf: createPdfService({ archives }) },
        authMiddleware: (_req, _res, next) => next(),
        gatewayAuthenticate: async token => token === 'admin-token' ? admin : token === 'outsider-token' ? outsider : null
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const room = await roomService.createOrResume(admin);
        const ticket = await roomService.issueTicket(admin, room.roomId);
        const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/presentation-demo/ws`, ['bearer.admin-token']);
        const messages = [];
        ws.on('message', raw => messages.push(JSON.parse(raw.toString())));
        await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
        ws.send(JSON.stringify({ type: 'connect', requestId: 'connect-1', ticket: ticket.ticket, protocolVersion: 2, contentVersion: 'bel-working-as-equals-1' }));
        await new Promise(resolve => { const timer = setInterval(() => { if (messages.some(message => message.data?.requestId === 'connect-1')) { clearInterval(timer); resolve(); } }, 10); });
        const connection = messages.find(message => message.data?.requestId === 'connect-1').data;
        assert.equal(Object.hasOwn(connection, 'runtime'), false);
        assert.equal(connection.role, 'presenter');
        ws.send(JSON.stringify({ type: 'input', requestId: 'input-1', command: { type: 'slide', seq: 1, room: 'J', slide: 999 } }));
        await new Promise(resolve => { const timer = setInterval(() => { if (messages.some(message => message.data?.requestId === 'input-1')) { clearInterval(timer); resolve(); } }, 10); });
        const error = messages.find(message => message.data?.requestId === 'input-1');
        assert.equal(error.type, 'error');
        assert.equal(error.data.code, 'COMMAND_SLIDE_INVALID');
        ws.close();
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
    assert.equal(outsider.uid, 'gateway-outsider');
});
