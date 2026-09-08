'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createDraft } = require('../../../functions/src/crm/data-input/draft-service');
const { createAttachmentService } = require('../../../functions/src/crm/data-input/attachment-service');
function fixture() {
    const state = { now: 1800000000000, allowed: true, decodes: 0, puts: 0 }, rows = new Map(), objects = new Map();
    const reference = path => ({ path, collection: name => collection(`${path}/${name}`) });
    const collection = path => ({ doc: id => reference(`${path}/${id}`) });
    let queue = Promise.resolve();
    const db = { collection, runTransaction(fn) {
        const work = queue.then(async () => { const staged = new Map(); const result = await fn({ get: async ref => ({ exists: rows.has(ref.path), data: () => structuredClone(rows.get(ref.path)) }), set: (ref, value) => staged.set(ref.path, structuredClone(value)) }); for (const [key, value] of staged) rows.set(key, value); return result; });
        queue = work.catch(() => {}); return work;
    } };
    rows.set('crmDataInputDrafts/d1', createDraft({ actorUid: 'staff1', draftId: 'd1', now: state.now }));
    const storage = {
        async putIfAbsent(path, bytes) { state.puts++; if (state.beforePut) await state.beforePut(); if (objects.has(path)) assert.deepEqual(objects.get(path), bytes); else objects.set(path, Buffer.from(bytes)); if (state.losePut) throw Error('Lost acknowledgement'); },
        async read(path) { return Buffer.from(objects.get(path)); }, async delete(path) { objects.delete(path); }
    };
    const normalize = async ({ bytes, mimeType }) => { state.decodes++; const sha256 = createHash('sha256').update(bytes).digest('hex'); return { bytes, mimeType: 'image/png', width: 1, height: 1, sha256, sourceSha256: sha256, sourceMimeType: mimeType }; };
    const options = { db, storage, normalize, authorize: async ({ actorUid, tx }) => { assert.ok(tx); return state.allowed && ['staff1', 'staff2'].includes(actorUid); }, now: () => state.now };
    return { state, rows, objects, options, service: createAttachmentService(options) };
}
const input = { actorUid: 'staff1', draftId: 'd1', attachmentId: 'a1', expectedRevision: 0, bytes: Buffer.from('fixture pixels'), mimeType: 'image/png' };
test('owned upload advances revision, clears review, and replays immutable identity without another decode', async () => {
    const f = fixture(); f.rows.get('crmDataInputDrafts/d1').preview = { token: 'old' };
    const result = await f.service.upload(input);
    assert.equal(result.attachment.status, 'ready'); assert.equal(result.draft.preview, null);
    assert.equal(result.draft.revision, 2); assert.equal(result.attachment.objectPath, undefined);
    const replay = await createAttachmentService(f.options).upload(input);
    assert.deepEqual(replay, result); assert.equal(f.state.decodes, 1); assert.equal(f.objects.size, 1);
    assert.deepEqual((await f.service.read(input)).bytes, input.bytes);
    await assert.rejects(f.service.upload({ ...input, bytes: Buffer.from('different') }), error => error.code === 'ATTACHMENT_CONFLICT');
});
test('uncertain storage acknowledgement remains retryable without allocating another attachment', async () => {
    const f = fixture(); f.state.losePut = true;
    await assert.rejects(f.service.upload(input), error => error.code === 'ATTACHMENT_UNCERTAIN');
    assert.equal((await f.service.list(input)).attachments[0].status, 'uploading');
    assert.equal(f.objects.size, 1);
    f.state.losePut = false;
    assert.equal((await f.service.upload(input)).attachment.status, 'ready');
    assert.equal(f.rows.get('crmDataInputDrafts/d1').attachmentIds.length, 1);
});
test('ownership and expiry are checked before decoding and before serving retained bytes', async () => {
    const f = fixture();
    await assert.rejects(f.service.upload({ ...input, actorUid: 'staff2' }), error => error.status === 404);
    assert.equal(f.state.decodes, 0); assert.equal(f.objects.size, 0);
    await f.service.upload(input); f.state.now += 86400000;
    await assert.rejects(f.service.read(input), error => error.code === 'ATTACHMENT_UNAVAILABLE');
    assert.equal((await f.service.list(input)).attachments[0].status, 'expired');
    await f.service.remove(input); assert.equal(f.objects.size, 0);
});
test('deletion racing an in-flight upload cannot resurrect an attachment', async () => {
    const f = fixture(); let release;
    f.state.beforePut = () => new Promise(resolve => { release = resolve; });
    const uploading = f.service.upload(input);
    while (!release) await new Promise(resolve => setImmediate(resolve));
    await f.service.remove(input); release();
    await assert.rejects(uploading, error => error.code === 'ATTACHMENT_UNAVAILABLE');
    assert.equal(f.objects.size, 0);
    assert.equal((await f.service.list(input)).attachments[0].status, 'deleted');
    await assert.rejects(f.service.upload(input), error => error.code === 'ATTACHMENT_UNAVAILABLE');
});
test('attachment count is bounded before decoding and retained bytes are verified before disclosure', async () => {
    const f = fixture();
    for (let index = 0; index < 5; index++) await f.service.upload({ ...input, attachmentId: `a${index}`, expectedRevision: index * 2 });
    await assert.rejects(f.service.upload({ ...input, attachmentId: 'a6', expectedRevision: 10 }), error => error.code === 'ATTACHMENT_LIMIT');
    assert.equal(f.state.decodes, 5); assert.equal(f.objects.size, 5);
    const key = [...f.objects.keys()][1]; f.objects.set(key, Buffer.from('corrupted'));
    await assert.rejects(f.service.read(input), error => error.code === 'ATTACHMENT_INTEGRITY');
});
test('revocation during storage read prevents image disclosure', async () => {
    const f = fixture(); await f.service.upload(input);
    const originalRead = f.options.storage.read;
    f.options.storage.read = async (...args) => { const bytes = await originalRead(...args); f.state.allowed = false; return bytes; };
    await assert.rejects(f.service.read(input), error => error.code === 'FORBIDDEN');
    await assert.rejects(f.service.remove(input), error => error.code === 'FORBIDDEN');
    assert.equal(f.objects.size, 1);
});
test('decode concurrency is bounded across service instances before any storage write', async () => {
    const first = fixture(), second = fixture(), third = fixture(), releases = [];
    for (const f of [first, second]) {
        const original = f.options.normalize;
        f.options.normalize = async value => { await new Promise(resolve => releases.push(resolve)); return original(value); };
        f.service = createAttachmentService(f.options);
    }
    const pending = [first.service.upload(input), second.service.upload(input)];
    while (releases.length < 2) await new Promise(resolve => setImmediate(resolve));
    try {
        await assert.rejects(third.service.upload(input), error => error.code === 'IMAGE_BUSY' && error.status === 429);
        assert.equal(third.state.decodes, 0); assert.equal(third.state.puts, 0);
    } finally { releases.forEach(resolve => resolve()); await Promise.all(pending); }
});
