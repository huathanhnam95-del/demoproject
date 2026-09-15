const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const connectionServices = [];
const { createConnectionService: makeConnectionService } = require('../../functions/src/crm/presentation-demo/connection-service.cjs');
function createConnectionService(options) { const service = makeConnectionService({ ...options, autoStart: false }); connectionServices.push(service); return service; }

const emulatorSelected = !!process.env.FIRESTORE_EMULATOR_HOST && !!process.env.FIREBASE_DATABASE_EMULATOR_HOST;

test('direct anonymous and authenticated clients cannot read or write live and private stores', { skip: !emulatorSelected }, async () => {
    const project = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
    assert.match(project, /^demo-/);
    const auth = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-bel-online`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
    assert.equal(auth.status, 200);
    const token = (await auth.json()).idToken;
    const { COLLECTIONS } = require('../../functions/src/crm/presentation-demo/firebase-stores.cjs');
    for (const authorization of [null, `Bearer ${token}`]) {
        const headers = { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) };
        for (const collection of Object.values(COLLECTIONS)) {
            const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${project}/databases/(default)/documents/${collection}/rules-probe`;
            for (const method of ['GET', 'PATCH']) {
                const response = await fetch(url, { method, headers, ...(method === 'PATCH' ? { body: JSON.stringify({ fields: { probe: { booleanValue: true } } }) } : {}) });
                assert.equal(response.status, 403, `${collection} ${method} must deny ${authorization ? 'authenticated' : 'anonymous'} clients`);
            }
        }
        for (const root of ['presentationRooms', 'presentationReceipts', 'presentationRoomOutbox']) {
            // RTDB REST uses auth= for a Firebase ID token. Its emulator treats
            // Bearer headers as service-account access, which bypasses rules.
            // This disposable emulator token is never logged or persisted.
            const url = `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}/${root}/rules-probe.json?ns=${project}-default-rtdb${authorization ? '&auth=' + encodeURIComponent(token) : ''}`;
            for (const method of ['GET', 'PUT']) {
                const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'PUT' ? { body: '{"probe":true}' } : {}) });
                assert.ok([401, 403].includes(response.status), `${root} ${method} returned ${response.status}`);
            }
        }
    }
});

test.after(async () => {
    if (!emulatorSelected) return;
    const firebase = require('../../functions/src/utils/firebase_admin_init');
    for (const service of connectionServices) { console.log('Authority metrics:', JSON.stringify(service.authority.metrics)); await service.shutdown(); }
    firebase.getDatabase().goOffline();
    await firebase.db.terminate();
    // Use the same SDK instance that owns these apps. The repository root
    // and functions package can resolve different firebase-admin copies.
    for (const app of firebase.admin.apps) await app.delete();
});

test('two durable service instances share membership, runtime, notes, and archive state', { skip: !emulatorSelected }, async () => {
    const firebase = require('../../functions/src/utils/firebase_admin_init');
    const { createFirebasePresentationDemoServices } = require('../../functions/src/crm/presentation-demo/firebase-stores.cjs');
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

test('End drains accepted durable note effects after a simulated worker loss', { skip: !emulatorSelected }, async () => {
    const firebase = require('../../functions/src/utils/firebase_admin_init');
    const { createFirebasePresentationDemoServices } = require('../../functions/src/crm/presentation-demo/firebase-stores.cjs');
    const suffix = crypto.randomUUID(), admin = { uid: 'end-' + suffix, accountStatus: 'active', isAdmin: true };
    const p1 = { uid: 'note-' + suffix, accountStatus: 'active', isTeacher: true };
    const first = createFirebasePresentationDemoServices({ db: firebase.db, rtdb: firebase.getDatabase(), codeFactory: () => 'TUVW23' });
    const room = await first.roomService.createOrResume(admin);
    await first.roomService.join(p1, room.roomId);
    const page = { operationId: 'lost-worker-save', pageId: 'queued', title: 'Accepted before End', body: 'hợp tác survives a worker loss', expectedVersion: 0 };
    const accepted = await first.notes.stageNote(p1, room.roomId, p1.uid, page);
    assert.equal(accepted.accepted, true);
    assert.equal((await first.notes.readNotebook(p1, room.roomId)).pages.length, 0);
    const liveBefore = (await firebase.getDatabase().ref(`presentationRooms/${room.roomId}`).get()).val();
    assert.equal(Object.keys(liveBefore._effects).length, 1);
    assert.doesNotMatch(JSON.stringify(liveBefore), /survives a worker loss/);
    const replacement = createFirebasePresentationDemoServices({ db: firebase.db, rtdb: firebase.getDatabase() });
    await replacement.roomService.end(admin, room.roomId);
    await replacement.archives.archiveRoom(room.roomId);
    const archive = await replacement.archives.readArchive(p1, room.roomId);
    assert.equal(archive.notebooks[p1.uid].pages[0].body, page.body);
    const replay = await replacement.notes.savePage(p1, room.roomId, p1.uid, page);
    assert.equal(replay.version, 1);
    await assert.rejects(replacement.notes.savePage(p1, room.roomId, p1.uid, { ...page, operationId: 'too-late', expectedVersion: 1 }), { code: 'ROOM_ENDED' });
    const liveAfter = (await firebase.getDatabase().ref(`presentationRooms/${room.roomId}`).get()).val();
    assert.equal(Object.keys(liveAfter._effects || {}).length, 0);
});

test('expiry scanning resumes past a full page of retained terminal rooms', { skip: !emulatorSelected }, async () => {
    const firebase = require('../../functions/src/utils/firebase_admin_init');
    const { createFirebasePresentationDemoServices, COLLECTIONS } = require('../../functions/src/crm/presentation-demo/firebase-stores.cjs');
    let now = 1000;
    const service = createFirebasePresentationDemoServices({ db: firebase.db, rtdb: firebase.getDatabase(), clock: () => now });
    const room = await service.roomService.createOrResume({ uid: 'expiry-' + crypto.randomUUID(), accountStatus: 'active', isAdmin: true });
    const batch = firebase.db.batch();
    for (let index = 0; index < 100; index++) batch.set(firebase.db.collection(COLLECTIONS.rooms).doc('expiry-retained-' + index), { lifecycle: 'ended', expiresAt: index });
    await batch.commit(); now = room.expiresAt + 1;
    assert.deepEqual(await service.roomService.expireDue(), []);
    const expired = await service.roomService.expireDue();
    assert.equal(expired.length, 1); assert.equal(expired[0].roomId, room.roomId); assert.equal(expired[0].lifecycle, 'ended');
});

test('durable CAS rejects equal-revision loss, fences stale generations, stores 21 full pages, and preserves demotion privacy', { skip: !emulatorSelected }, async () => {
    const firebase = require('../../functions/src/utils/firebase_admin_init');
    const { createFirebasePresentationDemoServices } = require('../../functions/src/crm/presentation-demo/firebase-stores.cjs');
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
    await Promise.all([firstConnections.authority.drain(), secondConnections.authority.drain()]);
    const baseline = await first.roomService.getRoom(room.roomId);
    const runtimeA = new AuthoritativeRuntime(baseline); const runtimeB = new AuthoritativeRuntime(baseline);
    runtimeA.command('p1', baseline.slots.p1.connectionGeneration, { type: 'move', seq: 1, dx: 1, dy: 0 });
    runtimeB.command('p2', baseline.slots.p2.connectionGeneration, { type: 'move', seq: 1, dx: 1, dy: 0 });
    const fences = Object.fromEntries(Object.entries(baseline.slots).map(([slotId, slot]) => [slotId, slot.connectionGeneration]));
    const writes = await Promise.allSettled([
        first.roomService.syncRuntimeState(room.roomId, runtimeA.rawState(), { expectedRevision: baseline.revision, expectedGenerations: fences }),
        second.roomService.syncRuntimeState(room.roomId, runtimeB.rawState(), { expectedRevision: baseline.revision, expectedGenerations: fences })
    ]);
    assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1, JSON.stringify(writes.map(result => ({ status: result.status, code: result.reason?.code, message: result.reason?.message }))));
    assert.equal(writes.filter(result => result.status === 'rejected' && result.reason.code === 'RUNTIME_REVISION_CONFLICT').length, 1);
    const afterCas = await first.roomService.getRoom(room.roomId);
    assert.equal(afterCas.revision, baseline.revision + 1);
    assert.equal(afterCas.lastInputSeq.p1 + afterCas.lastInputSeq.p2, 1, 'exactly one movement intention survives the CAS race');

    const stale = new AuthoritativeRuntime(afterCas); const staleBase = stale.rawState();
    const replacement = createConnectionService({ roomService: second.roomService });
    await replacement.open(p1, await second.roomService.issueTicket(p1, room.roomId), { replaceExisting: true });
    stale.command('p1', afterCas.slots.p1.connectionGeneration, { type: 'move', seq: 2, dx: 1, dy: 0 });
    await assert.rejects(first.roomService.syncRuntimeState(room.roomId, stale.rawState(), { expectedRevision: staleBase.revision, expectedGenerations: Object.fromEntries(Object.entries(staleBase.slots).map(([slotId, slot]) => [slotId, slot.connectionGeneration])) }), error => ['RUNTIME_REVISION_CONFLICT', 'RUNTIME_GENERATION_CONFLICT'].includes(error.code));

    const body = 'x'.repeat(50000);
    const notes = second.notes;
    for (let index = 1; index <= 21; index += 1) await notes.savePage(p1, room.roomId, p1.uid, { pageId: `page-${index}`, title: `Page ${index}`, body, expectedVersion: 0 });
    assert.equal((await notes.readNotebook(p1, room.roomId, p1.uid)).pages.length, 21);
    const replayPage = { operationId: 'durable-save-replay', pageId: 'page-2', title: 'Page 2', body, expectedVersion: 1 };
    const savedOnce = await notes.savePage(p1, room.roomId, p1.uid, replayPage);
    assert.deepEqual(await notes.savePage(p1, room.roomId, p1.uid, replayPage), savedOnce);
    const exportSnapshot = await notes.snapshotNotebooks(admin, room.roomId, [p1.uid, p2.uid]);
    assert.equal(exportSnapshot.notebooks[p1.uid].notebookRevision, 22);
    await notes.deletePage(p1, room.roomId, p1.uid, { pageId: 'page-1', expectedVersion: 1 });
    await assert.rejects(notes.savePage(p1, room.roomId, p1.uid, { pageId: 'page-1', title: 'stale', body, expectedVersion: 1 }), error => error.code === 'NOTE_CONFLICT');
    await first.roomService.end(admin, room.roomId);
    assert.deepEqual(await notes.savePage(p1, room.roomId, p1.uid, replayPage), savedOnce, 'a committed save can be acknowledged after End');
    await first.archives.archiveRoom(admin, room.roomId);
    const ownArchive = await second.archives.readArchive(p1, room.roomId);
    assert.equal(ownArchive.notebooks[p1.uid].pages.length, 20);
    await assert.rejects(second.archives.readArchive({ ...admin, isAdmin: false }, room.roomId), error => error.code === 'PRESENTER_ONLY');
});
