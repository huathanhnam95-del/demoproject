'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Readable } = require('node:stream'), { createHash } = require('node:crypto');
const { createPaymentEvidenceStorage } = require('../../../functions/src/crm/payment-evidence-storage');
const registerRoutes = require('../../../functions/src/routes/admin/payment-evidence');
const { fixture } = require('./transaction-fixture.cjs');
test('followup HTTP revalidates staff and denies revoked or unauthenticated evidence requests', async () => {
    const f = fixture({ 'users/staff': { isAdmin: true, role: 'admin' }, 'crmStudents/s1': { paymentFollowupRequired: { version: 1, source: 'lead_conversion' } } });
    f.db.runTransaction = work => work(fixture(Object.fromEntries(f.rows)).transaction);
    let disabled = false; const routes = new Map();
    const router = { get: (path, ...handlers) => routes.set(`get ${path}`, handlers.at(-1)), put: (path, ...handlers) => routes.set(`put ${path}`, handlers.at(-1)) };
    registerRoutes(router, { db: f.db, paymentEvidenceAuth: { verifyIdToken: async () => ({ uid: 'staff', auth_time: 1000 }), getUser: async () => ({ disabled, tokensValidAfterTime: '1970-01-01T00:00:00Z' }) },
        sendSuccess: (_, data) => ({ status: 200, data }), sendError: (_, status, code) => ({ status, code }) });
    const req = { params: { studentId: 's1', paymentId: 'p1' }, headers: { authorization: 'Bearer test' } };
    const get = routes.get('get /students/:studentId/payment-followup');
    assert.equal((await get(req, {})).data.paymentStatus, 'not_recorded');
    disabled = true;
    assert.equal((await get(req, {})).status, 403);
    assert.equal((await routes.get('put /payments/:paymentId/evidence')(req, {})).status, 403);
    assert.equal((await get({ ...req, headers: {} }, {})).status, 401);
    assert.equal(f.rows.size, 2);
});
test('private evidence uses immutable payment/hash paths and verifies bytes on retry/read', async () => {
    const objects = new Map(); let saves = 0;
    const bucket = { file(path) { return {
        async getMetadata() { if (!objects.has(path)) throw Object.assign(Error('missing'), { code: 404 }); return [objects.get(path).metadata]; },
        async save(bytes, options) { assert.equal(options.preconditionOpts.ifGenerationMatch, 0); saves++; objects.set(path, { bytes, metadata: { ...options.metadata, generation: '1', size: String(bytes.length) } }); },
        createReadStream() { return Readable.from([objects.get(path).bytes]); }
    }; } };
    const bytes = Buffer.from('normalized test bytes'), sha256 = createHash('sha256').update(bytes).digest('hex');
    const path = `crmPaymentEvidence/p1/${sha256}.png`, storage = createPaymentEvidenceStorage({ bucket });
    await storage.put(path, bytes); await storage.put(path, bytes);
    assert.equal(saves, 1); assert.deepEqual(await storage.read(path), bytes);
    objects.get(path).bytes = Buffer.from('corrupt');
    await assert.rejects(storage.read(path), error => error.code === 'EVIDENCE_INTEGRITY');
    await assert.rejects(storage.put('../foreign', bytes), error => error.code === 'INVALID_EVIDENCE_PATH');
    const expanded = Buffer.alloc(5 * 1024 * 1024, 7), expandedHash = createHash('sha256').update(expanded).digest('hex');
    const expandedPath = `crmPaymentEvidence/p2/${expandedHash}.png`;
    await storage.put(expandedPath, expanded);
    assert.equal((await storage.read(expandedPath)).length, expanded.length);
});
