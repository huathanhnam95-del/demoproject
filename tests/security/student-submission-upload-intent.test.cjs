const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const createStudentClassroomsRouter = require('../../functions/src/routes/student/classrooms');
const { buildHomeworkSubmissionDocId } = require('../../functions/src/crm/homework-service');

function createFakeDb(seed = {}) {
    const records = new Map(Object.entries(seed));

    function snapshot(path) {
        const value = records.get(path);
        return {
            id: path.split('/').pop(),
            exists: value !== undefined,
            data: () => value,
            ref: documentRef(path)
        };
    }

    function documentRef(path) {
        return {
            id: path.split('/').pop(),
            path,
            async get() { return snapshot(path); },
            async set(value, options = {}) {
                records.set(path, options.merge ? { ...(records.get(path) || {}), ...value } : { ...value });
            },
            async update(value) {
                if (!records.has(path)) throw new Error(`Missing document: ${path}`);
                records.set(path, { ...records.get(path), ...value });
            },
            collection(name) { return collectionRef(`${path}/${name}`); }
        };
    }

    function collectionRef(path) {
        const filters = [];
        let limitCount = Infinity;
        const api = {
            doc(id) { return documentRef(`${path}/${id}`); },
            where(field, op, value) {
                filters.push({ field, op, value });
                return api;
            },
            limit(value) { limitCount = value; return api; },
            async get() {
                const prefix = `${path}/`;
                const docs = [];
                for (const key of records.keys()) {
                    if (!key.startsWith(prefix) || key.slice(prefix.length).includes('/')) continue;
                    const snap = snapshot(key);
                    const data = snap.data() || {};
                    const matches = filters.every(({ field, op, value }) => {
                        if (op === '==') return data[field] === value;
                        if (op === 'array-contains') return Array.isArray(data[field]) && data[field].includes(value);
                        if (op === 'in') return Array.isArray(value) && value.includes(data[field]);
                        throw new Error(`Unsupported fake query operator: ${op}`);
                    });
                    if (matches) docs.push(snap);
                    if (docs.length >= limitCount) break;
                }
                return { docs, empty: docs.length === 0 };
            }
        };
        return api;
    }

    return {
        records,
        collection: collectionRef,
        async runTransaction(work) {
            return work({
                get: (ref) => ref.get(),
                set: (ref, value, options) => ref.set(value, options),
                update: (ref, value) => ref.update(value)
            });
        }
    };
}

async function startFixture({ db, user }) {
    const app = express();
    app.use(express.json());
    const authMiddleware = (req, _res, next) => { req.user = user; next(); };
    app.use('/api/student', createStudentClassroomsRouter({
        db,
        authMiddleware,
        serverTimestamp: () => new Date('2026-09-20T10:00:00.000Z')
    }));
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((resolve) => server.close(resolve))
    };
}

test('student audio uses a server-prepared slot that is consumed idempotently', async (t) => {
    const classId = 'class-1';
    const workId = 'work-1';
    const uid = 'student-1';
    const db = createFakeDb({
        [`crmClassrooms/${classId}`]: { name: 'Class 1' },
        [`crmClassrooms/${classId}/classwork/${workId}`]: { title: 'Read aloud' },
        [`crmClassrooms/${classId}/members/${uid}`]: { role: 'student' }
    });
    const fixture = await startFixture({ db, user: { uid, email: 'student@example.test' } });
    t.after(fixture.close);

    const prepareResponse = await fetch(`${fixture.baseUrl}/api/student/classrooms/${classId}/classwork/${workId}/submissions/upload-intent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
    });
    assert.equal(prepareResponse.status, 200);
    const prepared = await prepareResponse.json();
    assert.equal(prepared.success, true);
    assert.match(prepared.uploadIntentId, /^[0-9a-f-]+\.webm$/);
    assert.equal(prepared.storagePath, `uploads/${classId}/${workId}/${uid}/${prepared.uploadIntentId}`);

    const body = {
        uploadIntentId: prepared.uploadIntentId,
        audio: {
            storagePath: prepared.storagePath,
            bucketName: 'test-bucket',
            filename: prepared.uploadIntentId
        }
    };
    const submit = () => fetch(`${fixture.baseUrl}/api/student/classrooms/${classId}/classwork/${workId}/submissions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });

    const firstResponse = await submit();
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json();
    const submissionId = buildHomeworkSubmissionDocId({ classId, workId, studentUid: uid });
    assert.equal(first.submissionId, submissionId);
    assert.equal(db.records.get(`crmSubmissions/${submissionId}`).revisionCount, 1);
    assert.equal(db.records.get(`crmSubmissionUploadSlots/${prepared.uploadIntentId}`).status, 'consumed');

    const retryResponse = await submit();
    assert.equal(retryResponse.status, 200, 'retrying a lost response should be idempotent');
    assert.equal(db.records.get(`crmSubmissions/${submissionId}`).revisionCount, 1);
});

test('student submission rejects an unprepared audio path', async (t) => {
    const classId = 'class-1';
    const workId = 'work-1';
    const uid = 'student-1';
    const db = createFakeDb({
        [`crmClassrooms/${classId}`]: { name: 'Class 1' },
        [`crmClassrooms/${classId}/classwork/${workId}`]: { title: 'Read aloud' },
        [`crmClassrooms/${classId}/members/${uid}`]: { role: 'student' }
    });
    const fixture = await startFixture({ db, user: { uid } });
    t.after(fixture.close);

    const response = await fetch(`${fixture.baseUrl}/api/student/classrooms/${classId}/classwork/${workId}/submissions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            uploadIntentId: 'forged.webm',
            audio: { storagePath: `uploads/${classId}/${workId}/${uid}/forged.webm`, filename: 'forged.webm' }
        })
    });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.error, 'INVALID_UPLOAD_INTENT');
    assert.equal(db.records.has(`crmSubmissions/${buildHomeworkSubmissionDocId({ classId, workId, studentUid: uid })}`), false);
});
