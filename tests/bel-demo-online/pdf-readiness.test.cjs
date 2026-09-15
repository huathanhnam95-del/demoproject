const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createMemoryRoomStores, createRoomService } = require('../../functions/src/crm/presentation-demo/room-service.cjs');
const { createConnectionService } = require('../../functions/src/crm/presentation-demo/connection-service.cjs');
const { createNotebookService } = require('../../functions/src/crm/presentation-demo/notes-service.cjs');
const { createArchiveService } = require('../../functions/src/crm/presentation-demo/archive-service.cjs');
const { createPdfService } = require('../../functions/src/crm/presentation-demo/pdf-service.cjs');
const { createPresentationDemoHandlers } = require('../../functions/src/routes/admin/presentation-demo.js');
const { fail } = require('../../functions/src/crm/presentation-demo/contracts.cjs');

function response() {
    return { statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; }, set(name, value) { this.headers[name] = value; return this; } };
}

test('a six-second terminal archive delay preserves export quota and both PDF scopes', { timeout: 20000 }, async () => {
    const previousWindow = globalThis.window;
    globalThis.window = { location: { origin: 'http://127.0.0.1', search: '' }, setTimeout, clearTimeout };
    const admin = { uid: 'admin', accountStatus: 'active', isAdmin: true, local: true };
    const p1 = { uid: 'p1', accountStatus: 'active', isAdmin: false, local: true };
    const p2 = { uid: 'p2', accountStatus: 'active', isAdmin: false, local: true };
    const stores = createMemoryRoomStores();
    const roomService = createRoomService({ stores, idFactory: () => 'pdf-readiness-room', codeFactory: () => 'ABCD23' });
    const room = await roomService.createOrResume(admin);
    await roomService.join(p1, room.code);
    await roomService.join(p2, room.code);
    const notes = createNotebookService({ roomService });
    await notes.savePage(p1, room.roomId, 'p1', { pageId: 'p1-note', title: 'P1', body: 'P1 retained Vietnamese: hợp tác.', expectedVersion: 0 });
    await notes.savePage(p2, room.roomId, 'p2', { pageId: 'p2-note', title: 'P2', body: 'P2 private marker.', expectedVersion: 0 });
    const archives = createArchiveService({ roomService, notesService: notes, stores });
    let archiveStartedAt = 0, archiveCompletedAt = 0, releaseStarted;
    const archiveStarted = new Promise(resolve => { releaseStarted = resolve; });
    const delayedArchives = {
        readArchive: (...args) => archives.readArchive(...args),
        async archiveRoom(...args) {
            archiveStartedAt = Date.now(); releaseStarted();
            await new Promise(resolve => setTimeout(resolve, 6100));
            const result = await archives.archiveRoom(...args);
            archiveCompletedAt = Date.now();
            return result;
        }
    };
    const quota = new Map();
    roomService.throttle = async (identity, scope, maximum) => {
        const key = `${identity.uid}:${scope}`, count = quota.get(key) || 0;
        if (count >= maximum) fail('RATE_LIMITED', 'Please wait a minute before trying again.');
        quota.set(key, count + 1);
    };
    const pdf = createPdfService({ archives: delayedArchives, roomService, notesService: notes });
    const handlers = createPresentationDemoHandlers({ roomService, connections: createConnectionService({ roomService }), notes, archives: delayedArchives, pdf, resolveIdentity: req => req.user });
    const { PresentationTransport } = await import('../../public/js/presentation-demo/transport.mjs');
    const readinessChecks = new Map();
    const bridge = identity => async path => {
        const result = response();
        if (path.endsWith('/export.pdf')) {
            readinessChecks.set(identity.uid, (readinessChecks.get(identity.uid) || 0) + 1);
            await handlers.exportPdf({ user: identity, params: { roomId: room.roomId }, query: {} }, result);
        }
        else await handlers.room({ user: identity, params: { roomId: room.roomId } }, result);
        if (result.statusCode >= 400 || result.body?.success === false) throw Object.assign(new Error(result.body?.error?.message || 'request failed'), { code: result.body?.error?.code, status: result.statusCode });
        return Buffer.isBuffer(result.body) ? new Blob([result.body], { type: 'application/pdf' }) : result.body.data;
    };
    const presenterTransport = new PresentationTransport(admin);
    const participantTransport = new PresentationTransport(p1);
    presenterTransport.request = bridge(admin);
    participantTransport.request = bridge(p1);
    let endSettled = false;
    const endResponse = response();
    const endPromise = handlers.end({ user: admin, params: { roomId: room.roomId }, body: { reason: 'test' } }, endResponse).finally(() => { endSettled = true; });
    try {
        await archiveStarted;
        assert.equal((await roomService.getRoom(room.roomId)).lifecycle, 'ended');
        const settle = promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
        const presenterExport = settle(presenterTransport.exportPdf(room.roomId));
        const participantExport = settle(participantTransport.exportPdf(room.roomId));
        await new Promise(resolve => setTimeout(resolve, 1000));
        assert.equal(endSettled, false, 'End remains in flight while the archive is delayed');
        assert.equal(quota.get('admin:export') || 0, 0, 'pending presenter checks consume no completed-export quota');
        assert.equal(quota.get('p1:export') || 0, 0, 'pending participant checks consume no completed-export quota');
        const [presenterResult, participantResult] = await Promise.all([presenterExport, participantExport]);
        assert.equal(presenterResult.ok, true, presenterResult.error?.message);
        assert.equal(participantResult.ok, true, participantResult.error?.message);
        const presenterBlob = presenterResult.value, participantBlob = participantResult.value;
        await endPromise;
        assert.ok(archiveCompletedAt - archiveStartedAt >= 6000, 'archive completion was delayed for at least six seconds');
        assert.equal(endResponse.body.data.archiveStatus, 'archived');
        const presenterPdf = Buffer.from(await presenterBlob.arrayBuffer()).toString('utf8');
        const participantPdf = Buffer.from(await participantBlob.arrayBuffer()).toString('utf8');
        assert.match(presenterPdf, /^%PDF-/);
        assert.match(participantPdf, /^%PDF-/);
        assert.match(presenterPdf, /P1 retained Vietnamese/);
        assert.match(presenterPdf, /P2 private marker/);
        assert.match(participantPdf, /P1 retained Vietnamese/);
        assert.doesNotMatch(participantPdf, /P2 private marker/);
        assert.equal(quota.get('admin:export'), 1);
        assert.equal(quota.get('p1:export'), 1);
        assert.ok(readinessChecks.get('admin') <= 12, 'presenter readiness polling remains bounded');
        assert.ok(readinessChecks.get('p1') <= 12, 'participant readiness polling remains bounded');

        for (let completed = 1; completed < 6; completed += 1) {
            const allowed = response();
            await handlers.exportPdf({ user: admin, params: { roomId: room.roomId }, query: {} }, allowed);
            assert.equal(allowed.statusCode, 200);
        }
        const limited = response();
        await handlers.exportPdf({ user: admin, params: { roomId: room.roomId }, query: {} }, limited);
        assert.equal(limited.statusCode, 429);
        assert.equal(limited.body.error.code, 'RATE_LIMITED');
        assert.equal(quota.get('admin:export'), 6);
    } finally {
        await endPromise.catch(() => {});
        if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    }
});

test('terminal UI distinguishes pending archive readiness for every room member', () => {
    const source = fs.readFileSync('public/js/presentation-demo/app.mjs', 'utf8');
    assert.match(source, /function archivePending\(/);
    assert.match(source, /archiveStatus !== 'archived'/);
    assert.match(source, /Finalizing saved notes/);
    assert.match(source, /PDF will download when ready/);
});
