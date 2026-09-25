const assert = require('node:assert/strict');
const express = require('express');
const colors = require('../../functions/src/crm/scheduler-color-service');
const registerRoutes = require('../../functions/src/routes/teacher/scheduler-colors');
const { CRM_CLASSROOMS, CRM_SCHEDULED_SESSIONS } = require('../../functions/src/crm/collections');

// An isolated, serialized transactional store. Used by route tests and the Chrome fixture.
function createColorDb(initial = {}) {
    const docs = new Map(Object.entries(initial));
    let tail = Promise.resolve();
    return {
        docs,
        collection(collection) {
            return { doc(id) {
                const key = `${collection}/${id}`;
                return { id, key, async get() {
                    return { id, exists: docs.has(key), data: () => structuredClone(docs.get(key)) };
                } };
            } };
        },
        runTransaction(callback) {
            const run = tail.then(async () => {
                const writes = [];
                const value = await callback({ get: (ref) => ref.get(), set: (ref, data) => writes.push([ref.key, structuredClone(data)]) });
                for (const [key, data] of writes) docs.set(key, data);
                return value;
            });
            tail = run.catch(() => {});
            return run;
        }
    };
}
async function run() {
    const past = { sessionId: 'past', classId: 'a', teacherUid: 'teacher-a', scheduledStartAtUtc: '2026-09-01T02:00:00Z', sessionOutcome: 'completed' };
    const selected = { ...past, sessionId: 'selected', scheduledStartAtUtc: '2026-09-22T09:00:00+07:00' };
    const future = { ...past, sessionId: 'future', scheduledStartAtUtc: '2027-01-01T02:00:00Z' };
    const sameTime = { ...selected, sessionId: 'same-time', scheduledStartAtUtc: '2026-09-22T02:00:00Z' };
    let plan = colors.applyColor(null, selected, { color: '#d50000', scope: 'session', expectedRevision: 0 });
    assert.equal(colors.resolveColor(plan, selected), '#D50000');
    assert.equal(colors.resolveColor(plan, past), null);
    assert.equal(colors.resolveColor(plan, future), null);
    plan = colors.applyColor(plan, selected, { color: '#039BE5', scope: 'all', expectedRevision: 1 });
    for (const session of [past, selected, future]) assert.equal(colors.resolveColor(plan, session), '#039BE5');
    plan = colors.applyColor(plan, selected, { color: '#0B8043', scope: 'following', expectedRevision: 2 });
    assert.equal(colors.resolveColor(plan, past), '#039BE5');
    for (const session of [selected, sameTime, future]) assert.equal(colors.resolveColor(plan, session), '#0B8043');
    plan = colors.applyColor(plan, selected, { color: null, scope: 'session', expectedRevision: 3 });
    assert.equal(colors.resolveColor(plan, selected), null, 'Default reset must block older matching rules');
    assert.equal(colors.resolveColor(plan, future), '#0B8043');
    assert.equal(colors.resolveColor(null, { ...future, classId: 'other' }), null);
    assert.throws(() => colors.applyColor(plan, selected, { color: '#000000', scope: 'all', expectedRevision: 0 }), { code: 'COLOR_VERSION_MISMATCH' });
    assert.throws(() => colors.applyColor(plan, selected, { color: 'red', scope: 'all', expectedRevision: 4 }), { code: 'INVALID_COLOR' });
    assert.throws(() => colors.applyColor(plan, selected, { color: '#000000', scope: 'unknown', expectedRevision: 4 }), { code: 'INVALID_SCOPE' });
    assert.throws(() => colors.applyColor(plan, { sessionId: 'undated' }, { color: '#000000', scope: 'following', expectedRevision: 4 }), { code: 'INVALID_SESSION_TIME' });
    const book = colors.updateTag(null, { color: '#d50000', label: ' Nghỉ học ', expectedRevision: 0 });
    assert.equal(book.tags['#D50000'], 'Nghỉ học');
    assert.deepEqual(colors.updateTag(book, { color: '#D50000', label: '', expectedRevision: 1 }).tags, {});
    assert.throws(() => colors.updateTag(book, { color: '#D50000', label: 'x'.repeat(41), expectedRevision: 1 }), { code: 'INVALID_TAG' });
    assert.throws(() => colors.updateTag(book, { color: '#D50000', label: 'New', expectedRevision: 0 }), { code: 'COLOR_VERSION_MISMATCH' });

    const db = createColorDb({
        [`${CRM_CLASSROOMS}/a`]: { primaryTeacherUid: 'teacher-a' },
        [`${CRM_CLASSROOMS}/b`]: { primaryTeacherUid: 'teacher-b' },
        [`${CRM_SCHEDULED_SESSIONS}/past`]: past,
        [`${CRM_SCHEDULED_SESSIONS}/selected`]: selected,
        [`${CRM_SCHEDULED_SESSIONS}/foreign`]: { ...future, classId: 'b', teacherUid: 'teacher-b' }
    });
    const preserved = structuredClone([...db.docs.entries()]);
    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerRoutes(router, {
        db, serverTimestamp: () => 'test-time',
        requireTeacherHandlers: [(req, res, next) => {
            const uid = req.get('x-test-user');
            if (!uid) return res.status(401).json({ message: 'Sign in' });
            if (uid === 'student') return res.status(403).json({ message: 'Teacher only' });
            req.user = { uid }; req.teacherAccess = { isAdmin: uid === 'admin' }; next();
        }],
        sendSuccess: (res, data) => res.json({ success: true, ...data }),
        sendError: (res, status, code, message) => res.status(status).json({ code, message })
    });
    app.use(router);
    const server = await new Promise((resolve) => { const handle = app.listen(0, '127.0.0.1', () => resolve(handle)); });
    const post = async (url, body, user = 'teacher-a') => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(user ? { 'x-test-user': user } : {}) }, body: JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
    };
    try {
        const payload = { color: '#D50000', scope: 'all', expectedRevision: 0 };
        assert.equal((await post('/sessions/past/color', payload, null)).status, 401);
        assert.equal((await post('/sessions/past/color', payload, 'student')).status, 403);
        assert.equal((await post('/sessions/foreign/color', payload)).status, 403);
        assert.equal((await post('/sessions/missing/color', payload)).status, 404);
        const concurrent = await Promise.all([post('/sessions/past/color', payload), post('/sessions/selected/color', { ...payload, color: '#039BE5' })]);
        assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409], 'Exactly one concurrent writer succeeds');
        const loaded = await colors.loadColors(db, ['a', 'b']);
        assert.equal(loaded.colorPlans.a.revision, 1);
        assert.equal(loaded.colorPlans.b.revision, 0, 'Other class is unchanged');
        assert.equal(colors.resolveColor(loaded.colorPlans.a, future), '#D50000', 'Unseen and newly added sessions inherit');
        assert.equal((await post('/sessions/foreign/color', payload, 'admin')).status, 200);
        assert.equal((await post('/scheduler/color-tags', { color: '#D50000', label: 'Nghỉ học', expectedRevision: 0 })).status, 200);
        assert.equal((await colors.loadColors(db, ['b'])).colorTags.tags['#D50000'], 'Nghỉ học', 'Tags are shared across teacher workspaces');
        for (const [key, value] of preserved) assert.deepEqual(db.docs.get(key), value, `Booking data preserved: ${key}`);
        console.log('Scheduler colours: scope, defaults, shared tags, authorisation, concurrent writes, and booking preservation passed.');
    } finally { await new Promise((resolve) => server.close(resolve)); }
}
if (require.main === module) run().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { createColorDb };
