const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryRoomStores, createRoomService } = require('../../functions/src/crm/presentation-demo/room-service.cjs');
const { createNotebookService } = require('../../functions/src/crm/presentation-demo/notes-service.cjs');
const { createArchiveService } = require('../../functions/src/crm/presentation-demo/archive-service.cjs');
const { createPdfService } = require('../../functions/src/crm/presentation-demo/pdf-service.cjs');

test('active PDF export uses a Unicode-capable embedded font and stable page layout', async () => {
    const admin = { uid: 'admin', accountStatus: 'active', isAdmin: true };
    const stores = createMemoryRoomStores();
    const roomService = createRoomService({ stores, idFactory: () => 'room-pdflayout', codeFactory: () => 'ABCD23' });
    const room = await roomService.createOrResume(admin);
    const notes = createNotebookService({ roomService });
    const archives = createArchiveService({ roomService, notesService: notes, stores });
    await notes.savePage(admin, room.roomId, 'p0', { pageId: 'unicode', title: 'Tiếng Việt', body: `${'dài hợp tác — '.repeat(700)}kết thúc`, expectedVersion: 0 });
    const pdf = await createPdfService({ archives, roomService, notesService: notes }).exportPdf(admin, room.roomId);
    const source = pdf.toString('latin1');
    assert.match(source, /\/Subtype \/Type0/);
    assert.match(source, /\/Encoding \/Identity-H/);
    assert.match(source, /\/FontFile2/);
    assert.match(source, /\/ToUnicode/);
    assert.ok((source.match(/\/Type \/Page\b/g) || []).length >= 2);
    assert.match(source, /BEL-EXPORT/);
});
