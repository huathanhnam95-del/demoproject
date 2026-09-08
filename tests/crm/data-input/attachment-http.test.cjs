'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { readImageUpload, withImageUpload } = require('../../../functions/src/crm/data-input/attachment-http');
const headers = { 'content-type': 'image/png', 'x-crm-draft-revision': '3' };
test('raw and streamed uploads preserve bytes and server-checked revision', async () => {
    for (const req of [{ headers, rawBody: Buffer.from('pixels') }, Object.assign(Readable.from([Buffer.from('pix'), Buffer.from('els')]), { headers })]) {
        const result = await readImageUpload(req);
        assert.equal(result.mimeType, 'image/png'); assert.equal(result.expectedRevision, 3); assert.equal(result.bytes.toString(), 'pixels');
    }
});
test('unsupported types, invalid revisions, oversized and interrupted bodies fail explicitly', async () => {
    for (const req of [{ headers: { ...headers, 'content-type': 'text/html' }, rawBody: Buffer.from('x') }, { headers: { ...headers, 'x-crm-draft-revision': 'NaN' }, rawBody: Buffer.from('x') }, { headers, rawBody: Buffer.alloc(4194305) }]) await assert.rejects(readImageUpload(req), error => error.status >= 400 && error.status < 500);
    const huge = Object.assign(Readable.from([Buffer.alloc(4194304), Buffer.from('x')]), { headers });
    await assert.rejects(readImageUpload(huge), error => error.status === 413);
    const stalled = Object.assign(new Readable({ read() {} }), { headers });
    await assert.rejects(readImageUpload(stalled, { timeoutMs: 10 }), error => error.code === 'IMAGE_UPLOAD_TIMEOUT');
});
test('upload slots bound the complete upload operation and are released on failure', async () => {
    const release = [];
    const held = [withImageUpload(() => new Promise(resolve => release.push(resolve))), withImageUpload(() => new Promise(resolve => release.push(resolve)))];
    await assert.rejects(withImageUpload(async () => {}), error => error.status === 429);
    release.forEach(resolve => resolve()); await Promise.all(held);
    await assert.rejects(withImageUpload(async () => { throw Error('failed'); }), /failed/);
    assert.equal(await withImageUpload(async () => 'done'), 'done');
});
