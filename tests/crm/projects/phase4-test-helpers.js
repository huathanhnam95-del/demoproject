'use strict';

const assert = require('assert');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const {
    DEMO_PROJECT_ID,
    getEmulatorConfig
} = require('../../../scripts/crm/projects/emulator-config');
const {
    initializeFixtureApp,
    seedFixtures
} = require('../../../scripts/crm/projects/seed-fixtures');
const createProjectsRouter = require('../../../functions/src/routes/crm/projects');
const {
    PROJECT_COLLECTIONS,
    createProjectsAccessService,
    memberDocumentId
} = require('../../../functions/src/crm/projects/access-service');
const {
    PROJECT_OPERATION_COLLECTION,
    PROJECT_EVENT_COLLECTION
} = require('../../../functions/src/crm/projects/domain/storage');

const PASSWORD = 'Phase0-only-password!123';
const USERS = Object.freeze({
    owner: 'teacher@demo.crm-projects.test',
    editor: 'staff-editor@demo.crm-projects.test',
    viewer: 'viewer@demo.crm-projects.test',
    unauthorized: 'unauthorized@demo.crm-projects.test',
    suspended: 'suspended@demo.crm-projects.test'
});
const UID_BY_ROLE = Object.freeze({
    owner: 'crm-projects-teacher',
    editor: 'crm-projects-staff-editor',
    viewer: 'crm-projects-viewer',
    unauthorized: 'crm-projects-unauthorized',
    suspended: 'crm-projects-suspended'
});

function assertDedicatedEmulators(env = process.env) {
    assert.strictEqual(env.CRM_PROJECTS_EMULATOR_READY, '1', 'Phase4 checks require the isolated CRM Projects emulators.');
    const config = getEmulatorConfig(env);
    assert.strictEqual(config.projectId, DEMO_PROJECT_ID);
    assert.ok(env.FIREBASE_AUTH_EMULATOR_HOST && env.FIRESTORE_EMULATOR_HOST);
    assert.ok(env.FIREBASE_STORAGE_EMULATOR_HOST, 'Phase4 attachment checks require the isolated Storage emulator.');
    const storageMatch = String(env.FIREBASE_STORAGE_EMULATOR_HOST).match(/^(?:https?:\/\/)?([^:]+):(\d+)$/i);
    assert.ok(storageMatch, 'FIREBASE_STORAGE_EMULATOR_HOST must be a host:port endpoint.');
    assert.ok(['127.0.0.1', 'localhost', '::1'].includes(storageMatch[1]), 'Storage emulator must be loopback.');
    return config;
}

function emulatorUrl(endpoint, pathname) {
    return `http://${endpoint}/${String(pathname || '').replace(/^\//, '')}`;
}

async function signIn(email, password = PASSWORD) {
    const response = await fetch(emulatorUrl(process.env.FIREBASE_AUTH_EMULATOR_HOST, '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`Auth emulator sign-in failed: ${JSON.stringify(body)}`);
    return body.idToken;
}

function parseBody(text) {
    try { return JSON.parse(text); } catch (_) { return { raw: text }; }
}

async function request(server, requestPath, token, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${requestPath}`, {
        ...options,
        headers
    });
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const disposition = String(response.headers.get('content-disposition') || '').toLowerCase();
    const isAttachmentDownload = /\/attachments\/[^/]+\/download(?:\?|$)/.test(requestPath);
    if (isAttachmentDownload || contentType.includes('application/octet-stream') || contentType.startsWith('image/') || contentType.includes('application/pdf') || disposition.includes('attachment')) {
        return { status: response.status, headers: response.headers, bytes: Buffer.from(await response.arrayBuffer()) };
    }
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: parseBody(text) };
}

function jsonHeaders() { return { 'content-type': 'application/json' }; }

async function jsonRequest(server, requestPath, token, method, payload) {
    return request(server, requestPath, token, {
        method,
        headers: jsonHeaders(),
        body: JSON.stringify(payload || {})
    });
}

function expectStatus(response, status, message = '') {
    assert.strictEqual(response.status, status, `${message} ${JSON.stringify(response.body || {})}`.trim());
    return response.body || {};
}

function responseRecord(body, key) {
    if (body && body[key]) return body[key];
    if (body && body.result && body.result[key]) return body.result[key];
    return body?.result || body;
}

async function deleteDocs(snapshot, batchFactory) {
    let batch = batchFactory();
    let count = 0;
    for (const document of snapshot.docs || []) {
        batch.delete(document.ref);
        count += 1;
        if (count === 400) {
            await batch.commit();
            batch = batchFactory();
            count = 0;
        }
    }
    if (count) await batch.commit();
}

async function clearProject(db, projectId, bucket = null) {
    const projectRef = db.collection(PROJECT_COLLECTIONS.projects).doc(projectId);
    for (const collection of await projectRef.listCollections()) {
        await deleteDocs(await collection.get(), () => db.batch());
    }
    await projectRef.delete();
    for (const collectionName of [
        PROJECT_COLLECTIONS.members,
        PROJECT_OPERATION_COLLECTION,
        PROJECT_EVENT_COLLECTION
    ]) {
        const query = db.collection(collectionName).where('projectId', '==', projectId);
        await deleteDocs(await query.get(), () => db.batch());
    }
    if (bucket && typeof bucket.getFiles === 'function') {
        const [files] = await bucket.getFiles({ prefix: `crm-projects/${projectId}/` });
        await Promise.all((files || []).map((file) => file.delete()));
    }
}

async function bootPhase4({ projectId, seed = true } = {}) {
    const config = assertDedicatedEmulators();
    const app = initializeFixtureApp(config);
    if (seed) await seedFixtures({ config, app });
    const db = app.firestore();
    const auth = app.auth();
    const accessService = createProjectsAccessService({ db, auth });
    const api = express();
    // Functions may expose a pre-consumed multipart buffer. The default path
    // remains a normal stream; the opt-in header exercises the rawBody parser
    // without changing ordinary request behavior.
    api.use('/api/projects', (req, res, next) => {
        if (req.headers['x-phase4-raw-body'] !== '1') return next();
        return express.raw({ type: 'multipart/form-data', limit: '10mb' })(req, res, (error) => {
            if (error) return next(error);
            req.rawBody = req.body;
            delete req.body;
            return next();
        });
    });
    const bucket = app.storage().bucket(`${DEMO_PROJECT_ID}.appspot.com`);
    await clearProject(db, projectId, bucket);
    api.use('/api/projects', express.json({ limit: '1mb' }), createProjectsRouter({
        db,
        auth,
        accessService,
        storageBucket: bucket,
        getStorageBucket: async () => bucket
    }));
    const server = http.createServer(api);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
        config,
        api,
        app,
        db,
        auth,
        bucket,
        server,
        projectId,
        ownerUid: UID_BY_ROLE.owner,
        users: USERS,
        uids: UID_BY_ROLE,
        async token(role) { return signIn(USERS[role] || role); },
        async close() {
            await new Promise((resolve) => server.close(resolve));
            await app.delete();
        }
    };
}

async function createProject(context, name = context.projectId) {
    const token = await context.token('owner');
    const body = expectStatus(await jsonRequest(context.server, '/api/projects/', token, 'POST', {
        operationId: `phase4-create-${context.projectId}`,
        projectId: context.projectId,
        name
    }), 200, 'project create');
    return responseRecord(body, 'project');
}

async function addMember(context, role, memberRole) {
    const ownerToken = await context.token('owner');
    const body = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/members`, ownerToken, 'POST', {
        operationId: `phase4-member-${role}-${context.projectId}`,
        uid: context.uids[role],
        role: memberRole
    }), 200, `add ${role}`);
    return responseRecord(body, 'member');
}

async function createSection(context, sectionId, title = sectionId, expectedStructureRevision) {
    const token = await context.token('owner');
    const payload = {
        operationId: `phase4-section-${context.projectId}-${sectionId}`,
        sectionId,
        title
    };
    if (Number.isSafeInteger(expectedStructureRevision)) payload.expectedStructureRevision = expectedStructureRevision;
    const body = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/sections`, token, 'POST', payload), 200, `section ${sectionId}`);
    return responseRecord(body, 'section');
}

async function createColumn(context, columnId, column) {
    const token = await context.token('owner');
    const body = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/columns`, token, 'POST', {
        operationId: `phase4-column-${context.projectId}-${columnId}`,
        columnId,
        index: 0,
        expectedSchemaRevision: column.expectedSchemaRevision || 0,
        ...column
    }), 200, `column ${columnId}`);
    return responseRecord(body, 'column');
}

async function createTask(context, taskId, payload = {}) {
    const token = await context.token('owner');
    const projectSnapshot = await context.db.collection(PROJECT_COLLECTIONS.projects).doc(context.projectId).get();
    const expectedStructureRevision = payload.expectedStructureRevision === undefined
        ? Number(projectSnapshot.data()?.structureRevision || 0)
        : payload.expectedStructureRevision;
    const body = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks`, token, 'POST', {
        operationId: `phase4-task-${context.projectId}-${taskId}`,
        taskId,
        title: taskId,
        ...payload,
        expectedStructureRevision
    }), 200, `task ${taskId}`);
    return responseRecord(body, 'task');
}

async function createDeepFixture(context, { depth = 5, sectionId = 'phase4-section', includeColumn = true, taskPrefix = 'phase4-task' } = {}) {
    await createProject(context);
    await addMember(context, 'editor', 'Editor');
    await addMember(context, 'viewer', 'Viewer');
    const section = await createSection(context, sectionId, 'Phase4 section', 0);
    let parentTaskId = null;
    const tasks = [];
    if (includeColumn) await createColumn(context, 'phase4-stage', { type: 'status', label: 'Stage' });
    for (let index = 0; index < depth; index += 1) {
        const taskId = `${taskPrefix}-${index}`;
        const task = await createTask(context, taskId, {
            parentTaskId,
            sectionId: parentTaskId ? undefined : section.id,
            ownerUid: context.uids.owner,
            assigneeUids: index === 0 ? [context.uids.editor] : [],
            status: index === depth - 1 ? 'in_progress' : 'not_started',
            values: includeColumn ? { 'phase4-stage': index === depth - 1 ? 'in_progress' : 'not_started' } : {},
        });
        tasks.push(task);
        parentTaskId = task.id;
    }
    return { section, tasks, leaf: tasks[tasks.length - 1] };
}

function stableJson(value) {
    if (value === undefined) return undefined;
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(stableJson);
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
}

function stripMutableRecord(value, { lifecycle = false } = {}) {
    const copy = JSON.parse(JSON.stringify(value || {}));
    for (const key of ['createdAt', 'updatedAt', 'updatedBy']) delete copy[key];
    if (lifecycle) {
        delete copy.lifecycle;
        delete copy.lifecycleOrigin;
    }
    for (const key of ['revision', 'structureRevision', 'schemaRevision', 'contentRevision', 'membershipRevision']) delete copy[key];
    return stableJson(copy);
}

async function snapshotProject(context, { includeOperations = true } = {}) {
    const projectRef = context.db.collection(PROJECT_COLLECTIONS.projects).doc(context.projectId);
    const projectSnapshot = await projectRef.get();
    const result = {
        project: projectSnapshot.exists ? { id: projectSnapshot.id, data: projectSnapshot.data() } : null,
        subcollections: {},
        members: [],
        operations: [],
        events: []
    };
    for (const collection of await projectRef.listCollections()) {
        const rows = await collection.get();
        result.subcollections[collection.id] = rows.docs.map((doc) => ({ id: doc.id, data: doc.data() })).sort((a, b) => a.id.localeCompare(b.id));
    }
    for (const collectionName of [PROJECT_COLLECTIONS.members]) {
        const rows = await context.db.collection(collectionName).where('projectId', '==', context.projectId).get();
        result.members = rows.docs.map((doc) => ({ id: doc.id, data: doc.data() })).sort((a, b) => a.id.localeCompare(b.id));
    }
    if (includeOperations) {
        for (const [key, collectionName] of [['operations', PROJECT_OPERATION_COLLECTION], ['events', PROJECT_EVENT_COLLECTION]]) {
            const rows = await context.db.collection(collectionName).where('projectId', '==', context.projectId).get();
            result[key] = rows.docs.map((doc) => ({ id: doc.id, data: doc.data() })).sort((a, b) => a.id.localeCompare(b.id));
        }
    }
    return result;
}

function retainedContentSnapshot(snapshot) {
    const projectData = snapshot.project ? JSON.parse(JSON.stringify(snapshot.project.data || {})) : null;
    if (projectData) {
        // Project recovery is allowed to advance the project's own lifecycle,
        // revision and audit fields. Every other project field, including
        // createdAt, ownerUid, membershipRevision and schemaRevision, remains
        // part of the persisted-content comparison.
        for (const key of ['lifecycle', 'lifecycleOrigin', 'revision', 'structureRevision', 'contentRevision', 'updatedAt', 'updatedBy']) {
            delete projectData[key];
        }
    }
    const normalized = {
        project: snapshot.project ? { id: snapshot.project.id, data: stableJson(projectData) } : null,
        members: snapshot.members.map((row) => ({ id: row.id, data: stableJson(row.data) })),
        subcollections: {},
        operations: snapshot.operations.map((row) => ({ id: row.id, data: stableJson(row.data) })),
        events: snapshot.events.map((row) => ({ id: row.id, data: stableJson(row.data) }))
    };
    for (const [name, rows] of Object.entries(snapshot.subcollections)) {
        normalized.subcollections[name] = rows.map((row) => ({
            id: row.id,
            // Descendants are compared byte-for-byte at the field level. A
            // parent lifecycle operation must not rewrite child timestamps,
            // revisions, lifecycle, custom values, discussion rows or files.
            data: stableJson(row.data)
        }));
    }
    return stableJson(normalized);
}

async function directFirestoreRequest(pathname, token, method = 'GET', body) {
    const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${DEMO_PROJECT_ID}/databases/(default)/documents/${pathname}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return response;
}

async function directStorageRequest(objectPath, token) {
    const encodedPath = encodeURIComponent(String(objectPath || ''));
    return fetch(`http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${DEMO_PROJECT_ID}.appspot.com/o/${encodedPath}?alt=media`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
}

async function uploadMultipart(context, token, taskId, messageId, {
    operationId,
    attachmentId,
    expectedMessageRevision,
    rawBody = false,
    filename = 'phase4.txt',
    contentType = 'text/plain',
    bytes = Buffer.from('phase4-private-bytes\n', 'utf8')
} = {}) {
    const form = new FormData();
    form.set('operationId', operationId || `phase4-attachment-${crypto.randomUUID()}`);
    if (attachmentId) form.set('attachmentId', attachmentId);
    if (expectedMessageRevision !== undefined) form.set('expectedMessageRevision', String(expectedMessageRevision));
    form.set('file', new Blob([bytes], { type: contentType }), filename);
    return request(context.server, `/api/projects/${context.projectId}/tasks/${taskId}/discussion/messages/${messageId}/attachments`, token, {
        method: 'POST',
        ...(rawBody ? { headers: { 'x-phase4-raw-body': '1' } } : {}),
        body: form
    });
}

async function readAllMessages(context, token, taskId, pageSize = 50) {
    const messages = [];
    let cursor = '';
    do {
        const suffix = new URLSearchParams({ pageSize: String(pageSize) });
        if (cursor) suffix.set('cursor', cursor);
        const response = await request(context.server, `/api/projects/${context.projectId}/tasks/${taskId}/discussion?${suffix}`, token);
        expectStatus(response, 200, 'discussion page');
        messages.push(...(response.body.messages || []));
        cursor = response.body.nextCursor || '';
        if (messages.length > 10000) throw new Error('discussion pagination did not converge');
    } while (cursor);
    return messages;
}

module.exports = {
    PASSWORD,
    USERS,
    UID_BY_ROLE,
    DEMO_PROJECT_ID,
    assertDedicatedEmulators,
    signIn,
    request,
    jsonRequest,
    jsonHeaders,
    expectStatus,
    responseRecord,
    bootPhase4,
    clearProject,
    initializeFixtureApp,
    createProject,
    addMember,
    createSection,
    createColumn,
    createTask,
    createDeepFixture,
    snapshotProject,
    retainedContentSnapshot,
    stripMutableRecord,
    directFirestoreRequest,
    directStorageRequest,
    uploadMultipart,
    readAllMessages
};
