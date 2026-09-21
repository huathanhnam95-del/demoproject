const test = require('node:test');
const assert = require('node:assert/strict');

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'demo-bel-security';
const bucket = `${projectId}.appspot.com`;

function firestoreValue(value) {
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (value instanceof Date) return { timestampValue: value.toISOString() };
    throw new Error(`Unsupported Firestore test value: ${value}`);
}

async function writeDocument(path, data, token = 'owner') {
    const fields = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, firestoreValue(value)]));
    return fetch(`http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/${path}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ fields })
    });
}

async function createUser(email) {
    const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'test-password-123', returnSecureToken: true })
    });
    const payload = await response.text();
    assert.equal(response.status, 200, payload);
    return JSON.parse(payload);
}

async function uploadObject(name, token, content = 'mock-webm-audio') {
    const boundary = `bel-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify({ name, contentType: 'audio/webm' })}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Type: audio/webm\r\n\r\n`),
        Buffer.from(content),
        Buffer.from(`\r\n--${boundary}--`)
    ]);
    return fetch(`http://${storageHost}/v0/b/${bucket}/o?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${token}`,
            'content-type': `multipart/related; boundary=${boundary}`,
            'x-goog-upload-protocol': 'multipart'
        },
        body
    });
}

if (!firestoreHost || !storageHost || !authHost) {
    test('submission rules emulator environment', { skip: 'Run with Firebase Auth, Firestore, and Storage emulators.' }, () => {});
} else {
    test('submission documents deny browser mutation and upload slots enforce owner, expiry, and immutability', async () => {
        const owner = await createUser('submission-owner@example.test');
        const attacker = await createUser('submission-attacker@example.test');
        const classId = 'class-1';
        const workId = 'work-1';
        const validSlot = 'slot-valid.webm';
        const validPath = `uploads/${classId}/${workId}/${owner.localId}/${validSlot}`;

        assert.equal((await writeDocument(`crmClassrooms/${classId}`, { name: 'Class 1' })).status, 200);
        assert.equal((await writeDocument(`crmSubmissionUploadSlots/${validSlot}`, {
            classId,
            workId,
            studentUid: owner.localId,
            storagePath: validPath,
            status: 'prepared',
            expiresAt: new Date(Date.now() + 5 * 60 * 1000)
        })).status, 200);

        const forgedSubmission = await writeDocument('crmSubmissions/forged-client-doc', {
            classId,
            workId,
            studentUid: owner.localId,
            status: 'turned-in'
        }, owner.idToken);
        assert.equal(forgedSubmission.status, 403, 'student browser must not create a submission document');

        const validUpload = await uploadObject(validPath, owner.idToken);
        const validUploadBody = await validUpload.text();
        assert.equal(validUpload.status, 200, `server-prepared slot should authorize the owner without duplicating membership checks: ${validUploadBody}`);

        const overwrite = await uploadObject(validPath, owner.idToken, 'replacement-audio');
        assert.equal(overwrite.status, 403, 'an existing recording must be immutable');

        const attackerUpload = await uploadObject(validPath, attacker.idToken);
        assert.equal(attackerUpload.status, 403, 'another user must not use the owner upload slot');

        const forgedPath = `uploads/${classId}/${workId}/${owner.localId}/missing-slot.webm`;
        const forgedUpload = await uploadObject(forgedPath, owner.idToken);
        assert.equal(forgedUpload.status, 403, 'an unprepared path must be denied');

        const expiredSlot = 'slot-expired.webm';
        const expiredPath = `uploads/${classId}/${workId}/${owner.localId}/${expiredSlot}`;
        assert.equal((await writeDocument(`crmSubmissionUploadSlots/${expiredSlot}`, {
            classId,
            workId,
            studentUid: owner.localId,
            storagePath: expiredPath,
            status: 'prepared',
            expiresAt: new Date(Date.now() - 60 * 1000)
        })).status, 200);
        assert.equal((await uploadObject(expiredPath, owner.idToken)).status, 403, 'expired upload slot must be denied');

        const consumedSlot = 'slot-consumed.webm';
        const consumedPath = `uploads/${classId}/${workId}/${owner.localId}/${consumedSlot}`;
        assert.equal((await writeDocument(`crmSubmissionUploadSlots/${consumedSlot}`, {
            classId,
            workId,
            studentUid: owner.localId,
            storagePath: consumedPath,
            status: 'consumed',
            expiresAt: new Date(Date.now() + 5 * 60 * 1000)
        })).status, 200);
        assert.equal((await uploadObject(consumedPath, owner.idToken)).status, 403, 'consumed upload slot must be denied');
    });
}
