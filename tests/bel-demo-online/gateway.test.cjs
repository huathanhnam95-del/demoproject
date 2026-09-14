const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('../../functions/node_modules/ws');
const { createMemoryRoomStores, createRoomService } = require('../../functions/src/crm/presentation-demo/room-service.cjs');
const { createConnectionService } = require('../../functions/src/crm/presentation-demo/connection-service.cjs');
const { createNotebookService } = require('../../functions/src/crm/presentation-demo/notes-service.cjs');
const { createArchiveService } = require('../../functions/src/crm/presentation-demo/archive-service.cjs');
const { createPdfService } = require('../../functions/src/crm/presentation-demo/pdf-service.cjs');
const { createServer } = require('../../backend/presentation-demo/server.cjs');

test('authenticated WebSocket gateway returns public DTOs and reauthorizes each command', async () => {
    const admin = { uid: 'gateway-admin', email: 'gateway@example.com', accountStatus: 'active', isAdmin: true, isTeacher: true };
    const outsider = { uid: 'gateway-outsider', email: 'outsider@example.com', accountStatus: 'active', isTeacher: true };
    const stores = createMemoryRoomStores();
    const roomService = createRoomService({ stores, idFactory: () => 'room-gateway', codeFactory: () => 'ABCD23' });
    const notes = createNotebookService({ roomService });
    const archives = createArchiveService({ roomService, notesService: notes, stores });
    const server = createServer({
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
        ws.send(JSON.stringify({ type: 'connect', requestId: 'connect-1', ticket: ticket.ticket }));
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
