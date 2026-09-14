const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../../database.rules.json');
const { createMemoryRoomStores, createRoomService } = require('../../functions/src/crm/presentation-demo/room-service.cjs');
const { createConnectionService } = require('../../functions/src/crm/presentation-demo/connection-service.cjs');
const { createNotebookService } = require('../../functions/src/crm/presentation-demo/notes-service.cjs');
const { createArchiveService } = require('../../functions/src/crm/presentation-demo/archive-service.cjs');
const { createPdfService } = require('../../functions/src/crm/presentation-demo/pdf-service.cjs');
const { createPresentationDemoHandlers } = require('../../functions/src/routes/admin/presentation-demo.js');

test('RTDB rules fail closed and server-owned room collections are not client-writable', () => {
    assert.equal(rules.rules['.read'], false);
    assert.equal(rules.rules['.write'], false);
    assert.equal(rules.rules.presentationRooms['$roomId']['.write'], false);
});

test('unauthenticated handlers cannot create or join a room', async () => {
    const stores = createMemoryRoomStores();
    const roomService = createRoomService({ stores, idFactory: () => 'room-secure', codeFactory: () => 'ABCD23' });
    const notes = createNotebookService({ roomService });
    const archives = createArchiveService({ roomService, notesService: notes, stores });
    const connections = createConnectionService({ roomService });
    const handlers = createPresentationDemoHandlers({ roomService, connections, notes, archives, pdf: createPdfService({ archives }) });
    const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await handlers.create({ body: {} }, res);
    assert.equal(res.statusCode, 401);
    await handlers.join({ body: { code: 'ABCD23' } }, res);
    assert.equal(res.statusCode, 401);
});
