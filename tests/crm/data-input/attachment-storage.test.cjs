'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { createAttachmentStorage } = require('../../../functions/src/crm/data-input/attachment-storage');
const objectPath = `crm-data-input/${'a'.repeat(64)}/${'b'.repeat(64)}/${'c'.repeat(64)}.png`;
const bytes = Buffer.from('normalized fixture image');
const sha256 = createHash('sha256').update(bytes).digest('hex');
function fixture(readTimeoutMs = 10000) {
    const state = { row: null, files: [], saves: [], deletes: [], now: 1800000000000 };
    const bucket = { async getFiles(options) { state.listOptions = options; return [state.listed || [], state.nextQuery || null]; }, file(path, options = {}) {
        state.files.push({ path, options });
        return {
            async save(data, config) { state.saves.push(config); if (state.raceOnSave && !state.row) state.row = { bytes: Buffer.from(data), metadata: { ...config.metadata, size: String(data.length), generation: '42' } }; if (state.row) throw Object.assign(Error('Exists'), { code: 412 }); state.row = { bytes: Buffer.from(data), metadata: { ...config.metadata, size: String(data.length), generation: '42' } }; },
            async getMetadata() { if (!state.row) throw Object.assign(Error('Missing'), { code: 404 }); return [structuredClone(state.row.metadata)]; },
            createReadStream() { assert.equal(options.generation, '42'); return state.hangRead ? new Readable({ read() {} }) : Readable.from([state.row.bytes]); },
            async delete(config) { state.deletes.push(config); if (state.replaceOnDelete) throw Object.assign(Error('Changed'), { code: 412 }); state.row = null; }
        };
    } };
    return { state, storage: createAttachmentStorage({ bucket, now: () => state.now, readTimeoutMs }) };
}
test('upload is create-only, private, and exact-content retries reuse the immutable object', async () => {
    const f = fixture(), metadata = { sha256, expiresAtMs: f.state.now + 1000 };
    await f.storage.putIfAbsent(objectPath, bytes, metadata);
    assert.equal(f.state.saves[0].preconditionOpts.ifGenerationMatch, 0);
    assert.equal(f.state.saves[0].metadata.cacheControl, 'private, no-store');
    assert.equal(f.state.saves[0].metadata.metadata.firebaseStorageDownloadTokens, undefined);
    await f.storage.putIfAbsent(objectPath, bytes, metadata);
    assert.deepEqual(await f.storage.read(objectPath, 1024), bytes);
    f.state.row.bytes = Buffer.from('altered content');
    await assert.rejects(f.storage.putIfAbsent(objectPath, bytes, metadata), error => error.code === 'ATTACHMENT_INTEGRITY');
});

test('expiry sweep is paginated, metadata-only, and deletes only expired managed generations', async () => {
    const f = fixture(); await f.storage.putIfAbsent(objectPath, bytes, { sha256, expiresAtMs: f.state.now + 1000 });
    f.state.listed = [{ name: objectPath }, { name: 'crm-data-input/unmanaged.png' }];
    f.state.nextQuery = { pageToken: 'next-page', prefix: 'UNTRUSTED' };
    let result = await f.storage.sweepExpired({ pageToken: 'prior-page', limit: 2 });
    assert.deepEqual(f.state.listOptions, { prefix: 'crm-data-input/', autoPaginate: false, maxResults: 2, pageToken: 'prior-page' });
    assert.deepEqual(result, { scanned: 2, deleted: 0, retained: 1, skipped: 1, conflicted: 0, nextPageToken: 'next-page' });
    f.state.now += 1000;
    result = await f.storage.sweepExpired({ limit: 2 });
    assert.equal(result.deleted, 1); assert.equal(f.state.row, null);
    assert.equal(f.state.deletes[0].ifGenerationMatch, '42');
    assert.ok(f.state.files.every(entry => !entry.options.generation), 'sweep does not download image bytes');
});

test('expiry sweep preserves unmanaged metadata and replacement generations, and rejects unbounded scans', async () => {
    const f = fixture(); await f.storage.putIfAbsent(objectPath, bytes, { sha256, expiresAtMs: f.state.now + 1000 });
    f.state.listed = [{ name: objectPath }]; f.state.now += 1000;
    f.state.replaceOnDelete = true;
    assert.equal((await f.storage.sweepExpired()).conflicted, 1); assert.ok(f.state.row);
    delete f.state.row.metadata.metadata.crmDataInput;
    assert.equal((await f.storage.sweepExpired()).skipped, 1); assert.equal(f.state.deletes.length, 1);
    for (const options of [{ limit: 0 }, { limit: 101 }, { pageToken: {} }, { pageToken: 'x'.repeat(8193) }]) {
        await assert.rejects(f.storage.sweepExpired(options), error => error.code === 'INVALID_SWEEP');
    }
});
test('unmanaged paths and oversized or expired metadata are rejected before exposing bytes', async () => {
    const f = fixture();
    await assert.rejects(f.storage.putIfAbsent('../other/image', bytes, { sha256, expiresAtMs: f.state.now + 1000 }), error => error.code === 'INVALID_STORAGE_PATH');
    assert.equal(f.state.files.length, 0);
    await f.storage.putIfAbsent(objectPath, bytes, { sha256, expiresAtMs: f.state.now + 1000 });
    await assert.rejects(f.storage.read(objectPath, 2), error => error.code === 'ATTACHMENT_SIZE');
    f.state.now += 1000;
    await assert.rejects(f.storage.read(objectPath, 1024), error => error.code === 'ATTACHMENT_EXPIRED');
    await f.storage.delete(objectPath); assert.equal(f.state.row, null);
});
test('deletion targets the observed generation and never removes a replacement', async () => {
    const f = fixture(); await f.storage.putIfAbsent(objectPath, bytes, { sha256, expiresAtMs: f.state.now + 1000 });
    f.state.replaceOnDelete = true;
    await assert.rejects(f.storage.delete(objectPath), error => error.code === 'ATTACHMENT_STORAGE_CONFLICT');
    assert.equal(f.state.deletes[0].ifGenerationMatch, '42'); assert.ok(f.state.row);
    f.state.replaceOnDelete = false; await f.storage.delete(objectPath); await f.storage.delete(objectPath);
    assert.equal(f.state.deletes.length, 2);
});
test('a concurrent create conflict is verified as an immutable replay', async () => {
    const f = fixture(); f.state.raceOnSave = true;
    await f.storage.putIfAbsent(objectPath, bytes, { sha256, expiresAtMs: f.state.now + 1000 });
    assert.equal(f.state.saves.length, 1); assert.deepEqual(await f.storage.read(objectPath, 1024), bytes);
});
test('stream byte limits and deadlines apply even when object metadata is misleading', async () => {
    const f = fixture(10); await f.storage.putIfAbsent(objectPath, bytes, { sha256, expiresAtMs: f.state.now + 1000 });
    f.state.row.metadata.size = '1'; f.state.row.bytes = Buffer.alloc(2000);
    await assert.rejects(f.storage.read(objectPath, 1024), error => error.code === 'ATTACHMENT_SIZE');
    f.state.hangRead = true;
    await assert.rejects(f.storage.read(objectPath, 1024), error => error.code === 'ATTACHMENT_TIMEOUT');
});
