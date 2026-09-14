const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const emulatorSelected = !!process.env.FIRESTORE_EMULATOR_HOST && !!process.env.FIREBASE_DATABASE_EMULATOR_HOST;

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
