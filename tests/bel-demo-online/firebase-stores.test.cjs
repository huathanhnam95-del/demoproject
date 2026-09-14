const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { getApps } = require('firebase-admin/app');

const emulatorSelected = !!process.env.FIRESTORE_EMULATOR_HOST && !!process.env.FIREBASE_DATABASE_EMULATOR_HOST;

test.after(async () => {
    if (!emulatorSelected) return;
    const firebase = require('../../functions/src/utils/firebase_admin_init');
    await firebase.db.terminate().catch(() => {});
    for (const app of getApps()) await app.delete().catch(() => {});
});

test('two durable service instances share membership, runtime, notes, and archive state', { skip: !emulatorSelected }, async () => {
    const firebase = require('../../functions/src/utils/firebase_admin_init');
    const { createFirebasePresentationDemoServices } = require('../../functions/src/crm/presentation-demo/firebase-stores.cjs');
    const { createConnectionService } = require('../../functions/src/crm/presentation-demo/connection-service.cjs');
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const digest = crypto.createHash('sha256').update(suffix).digest();
    const code = Array.from({ length: 6 }, (_, index) => alphabet[digest[index] % alphabet.length]).join('');
    const admin = { uid: `admin-${suffix}`, email: `admin-${suffix}@example.com`, accountStatus: 'active', isAdmin: true, isTeacher: true };
    const participants = [1, 2, 3].map(index => ({ uid: `participant-${index}-${suffix}`, email: `p${index}-${suffix}@example.com`, accountStatus: 'active', isTeacher: true }));
    const first = createFirebasePresentationDemoServices({ db: firebase.db, rtdb: firebase.getDatabase(), idFactory: () => `room-${suffix}`, codeFactory: () => code, ticketFactory: () => `ticket-admin-${suffix}` });
    const second = createFirebasePresentationDemoServices({ db: firebase.db, rtdb: firebase.getDatabase(), ticketFactory: () => `ticket-participant-${suffix}` });
    const room = await first.roomService.createOrResume(admin, { operationId: `create-${suffix}` });
    for (const participant of participants) await second.roomService.join(participant, room.code);
    const presenterConnection = createConnectionService({ roomService: first.roomService, clock: () => Date.now() });
    const presenter = await presenterConnection.open(admin, await first.roomService.issueTicket(admin, room.roomId));
    const participantConnection = createConnectionService({ roomService: second.roomService, clock: () => Date.now() });
    const participant = await participantConnection.open(participants[0], await second.roomService.issueTicket(participants[0], room.roomId));
    await participantConnection.input(participant, { type: 'move', seq: 1, dx: 1, dy: 0 });
    await second.notes.savePage(participants[0], room.roomId, participants[0].uid, { pageId: 'one', title: 'Tiếng Việt', body: 'hợp tác', expectedVersion: 0 });
    const shared = await first.roomService.getRoom(room.roomId);
    assert.equal(shared.slots.p1.uid, participants[0].uid);
    assert.equal(shared.slots.p1.position.x > 0, true);
    assert.equal((await firebase.getDatabase().ref(`presentationRooms/${room.roomId}`).get()).exists(), true);
    await first.roomService.end(admin, room.roomId);
    const archived = await second.archives.archiveRoom(room.roomId);
    assert.equal(archived.status, 'archived');
    assert.equal((await first.archives.readArchive(participants[0], room.roomId)).notebooks[participants[0].uid].pages[0].body, 'hợp tác');
});

test('durable CAS rejects equal-revision loss, fences stale generations, stores 21 full pages, and preserves demotion privacy', { skip: !emulatorSelected }, async () => {
    const firebase = require('../../functions/src/utils/firebase_admin_init');
    const { createFirebasePresentationDemoServices } = require('../../functions/src/crm/presentation-demo/firebase-stores.cjs');
    const { createConnectionService } = require('../../functions/src/crm/presentation-demo/connection-service.cjs');
    const { AuthoritativeRuntime } = require('../../functions/src/crm/presentation-demo/runtime.cjs');
    const suffix = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const admin = { uid: `admin-${suffix}`, email: `admin-${suffix}@example.com`, accountStatus: 'active', isAdmin: true, isTeacher: true };
    const p1 = { uid: `p1-${suffix}`, email: `p1-${suffix}@example.com`, accountStatus: 'active', isTeacher: true };
    const p2 = { uid: `p2-${suffix}`, email: `p2-${suffix}@example.com`, accountStatus: 'active', isTeacher: true };
    const p3 = { uid: `p3-${suffix}`, email: `p3-${suffix}@example.com`, accountStatus: 'active', isTeacher: true };
    let codeIndex = 0;
    const first = createFirebasePresentationDemoServices({ db: firebase.db, rtdb: firebase.getDatabase(), idFactory: () => `room-${suffix}`, codeFactory: () => ['EFGH23', 'JKLM23'][codeIndex++ % 2], ticketFactory: () => `ticket-a-${suffix}-${Math.random()}` });
    const second = createFirebasePresentationDemoServices({ db: firebase.db, rtdb: firebase.getDatabase(), ticketFactory: () => `ticket-b-${suffix}-${Math.random()}` });
    const room = await first.roomService.createOrResume(admin, { operationId: `create-${suffix}` });
    await first.roomService.join(p1, room.roomId); await second.roomService.join(p2, room.roomId); await first.roomService.join(p3, room.roomId);
    const firstConnections = createConnectionService({ roomService: first.roomService });
    const secondConnections = createConnectionService({ roomService: second.roomService });
    await firstConnections.open(p1, await first.roomService.issueTicket(p1, room.roomId));
    await secondConnections.open(p2, await second.roomService.issueTicket(p2, room.roomId));
    const baseline = await first.roomService.getRoom(room.roomId);
    const runtimeA = new AuthoritativeRuntime(baseline); const runtimeB = new AuthoritativeRuntime(baseline);
    runtimeA.command('p1', baseline.slots.p1.connectionGeneration, { type: 'move', seq: 1, dx: 1, dy: 0 });
    runtimeB.command('p2', baseline.slots.p2.connectionGeneration, { type: 'move', seq: 1, dx: 1, dy: 0 });
    const fences = Object.fromEntries(Object.entries(baseline.slots).map(([slotId, slot]) => [slotId, slot.connectionGeneration]));
    const writes = await Promise.allSettled([
        first.roomService.syncRuntimeState(room.roomId, runtimeA.rawState(), { expectedRevision: baseline.revision, expectedGenerations: fences }),
        second.roomService.syncRuntimeState(room.roomId, runtimeB.rawState(), { expectedRevision: baseline.revision, expectedGenerations: fences })
    ]);
    assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(writes.filter(result => result.status === 'rejected' && result.reason.code === 'RUNTIME_REVISION_CONFLICT').length, 1);
    const afterCas = await first.roomService.getRoom(room.roomId);
    assert.equal(afterCas.revision, baseline.revision + 1);
    assert.equal(afterCas.slots.p1.position.x > baseline.slots.p1.position.x || afterCas.slots.p2.position.x > baseline.slots.p2.position.x, true);

    const stale = new AuthoritativeRuntime(afterCas); const staleBase = stale.rawState();
    const replacement = createConnectionService({ roomService: second.roomService });
    await replacement.open(p1, await second.roomService.issueTicket(p1, room.roomId), { replaceExisting: true });
    stale.command('p1', afterCas.slots.p1.connectionGeneration, { type: 'move', seq: 2, dx: 1, dy: 0 });
    await assert.rejects(first.roomService.syncRuntimeState(room.roomId, stale.rawState(), { expectedRevision: staleBase.revision, expectedGenerations: Object.fromEntries(Object.entries(staleBase.slots).map(([slotId, slot]) => [slotId, slot.connectionGeneration])) }), error => ['RUNTIME_REVISION_CONFLICT', 'RUNTIME_GENERATION_CONFLICT'].includes(error.code));

    const body = 'x'.repeat(50000);
    const notes = second.notes;
    for (let index = 1; index <= 21; index += 1) await notes.savePage(p1, room.roomId, p1.uid, { pageId: `page-${index}`, title: `Page ${index}`, body, expectedVersion: 0 });
    assert.equal((await notes.readNotebook(p1, room.roomId, p1.uid)).pages.length, 21);
    await notes.deletePage(p1, room.roomId, p1.uid, { pageId: 'page-1', expectedVersion: 1 });
    await assert.rejects(notes.savePage(p1, room.roomId, p1.uid, { pageId: 'page-1', title: 'stale', body, expectedVersion: 1 }), error => error.code === 'NOTE_CONFLICT');
    await first.roomService.end(admin, room.roomId);
    await first.archives.archiveRoom(admin, room.roomId);
    const ownArchive = await second.archives.readArchive(p1, room.roomId);
    assert.equal(ownArchive.notebooks[p1.uid].pages.length, 20);
    await assert.rejects(second.archives.readArchive({ ...admin, isAdmin: false }, room.roomId), error => error.code === 'PRESENTER_ONLY');
});
