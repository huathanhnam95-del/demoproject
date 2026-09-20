'use strict';

const assert = require('assert');
const express = require('express');
const http = require('http');
const { DEMO_PROJECT_ID, getEmulatorConfig } = require('../../../scripts/crm/projects/emulator-config');
const { initializeFixtureApp, seedFixtures } = require('../../../scripts/crm/projects/seed-fixtures');
const createProjectsRouter = require('../../../functions/src/routes/crm/projects');
const {
    PROJECT_COLLECTIONS,
    createProjectsAccessService,
    memberDocumentId
} = require('../../../functions/src/crm/projects/access-service');
const {
    PROJECT_OPERATION_COLLECTION,
    PROJECT_EVENT_COLLECTION,
    PROJECT_CURSOR_COLLECTION
} = require('../../../functions/src/crm/projects/domain/storage');
const { compareSiblings } = require('../../../functions/src/crm/projects/domain/ordering');

const PASSWORD = 'Phase0-only-password!123';
const PROJECT_ID = 'phase2-domain-demo';

function emulatorUrl(endpoint, pathname) { return `http://${endpoint}/${String(pathname || '').replace(/^\//, '')}`; }

async function signIn(email, password = PASSWORD) {
    const response = await fetch(emulatorUrl(process.env.FIREBASE_AUTH_EMULATOR_HOST, '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key'), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`Auth emulator sign-in failed: ${JSON.stringify(body)}`);
    return body.idToken;
}

async function request(server, path, token, options = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        ...options,
        headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch (_) { body = { raw: text }; }
    return { status: response.status, body };
}

async function directClientWrite(path, token) {
    const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${DEMO_PROJECT_ID}/databases/(default)/documents/${path}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ fields: { title: { stringValue: 'client write' } } })
    });
    return response;
}

async function directClientRead(path, token) {
    return fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${DEMO_PROJECT_ID}/databases/(default)/documents/${path}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
    });
}

function jsonHeaders() { return { 'content-type': 'application/json' }; }

function makeBarrierDb(db, beforeTransaction) {
    let armed = true;
    return {
        collection: (...args) => db.collection(...args),
        runTransaction: async (callback, options) => {
            if (armed) {
                armed = false;
                await beforeTransaction();
            }
            return db.runTransaction(callback, options);
        }
    };
}

function makeTrackingDb(db, tracker) {
    return {
        collection: (...args) => db.collection(...args),
        runTransaction: async (callback, options) => db.runTransaction(async (transaction) => {
            const tracked = new Proxy(transaction, {
                get(target, property) {
                    if (property !== 'get') return Reflect.get(target, property, target);
                    return async (reference) => {
                        const path = String(reference?.path || '');
                        if (/\/tasks$/.test(path)) tracker.taskCollectionReads += 1;
                        return target.get(reference);
                    };
                }
            });
            return callback(tracked);
        }, options)
    };
}

async function startRouterServer({ db, auth, accessService }) {
    const api = express();
    api.use(express.json());
    api.use('/api/projects', createProjectsRouter({ db, auth, accessService }));
    const server = http.createServer(api);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return server;
}

async function createProjectWithSections(server, token, projectId, sectionIds) {
    let response = await request(server, '/api/projects/', token, {
        method: 'POST', headers: jsonHeaders(),
        body: JSON.stringify({ operationId: `create-${projectId}`, projectId, name: projectId })
    });
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    const sections = [];
    let structureRevision = response.body.project.structureRevision;
    for (const sectionId of sectionIds) {
        response = await request(server, `/api/projects/${projectId}/sections`, token, {
            method: 'POST', headers: jsonHeaders(),
            body: JSON.stringify({ operationId: `create-${projectId}-${sectionId}`, sectionId, title: sectionId, expectedStructureRevision: structureRevision })
        });
        assert.strictEqual(response.status, 200, JSON.stringify(response.body));
        sections.push(response.body.section);
        structureRevision = response.body.structureRevision;
    }
    return { projectId, sections, structureRevision };
}

async function createTask(server, token, projectId, payload) {
    const response = await request(server, `/api/projects/${projectId}/tasks`, token, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify(payload)
    });
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    return response.body.task;
}

async function seedDenseSiblings(db, projectId, sectionId, ownerUid, prefix, count = 650) {
    let batch = db.batch();
    const denominator = '1000000000000000000000000000000';
    for (let index = 0; index < count; index += 1) {
        batch.set(db.collection(PROJECT_COLLECTIONS.projects).doc(projectId).collection('tasks').doc(`${prefix}-${index}`), {
            projectId, parentTaskId: null, sectionId, title: `${prefix} ${index}`, status: 'not_started',
            ownerUid, assigneeUids: [], values: {}, lifecycle: 'active', rank: `${index}/${denominator}`,
            revision: 1, updatedAt: '2026-01-01T00:00:00.000Z'
        });
        if ((index + 1) % 450 === 0) { await batch.commit(); batch = db.batch(); }
    }
    if (count % 450 !== 0) await batch.commit();
}

async function runHierarchyAndOrderingMatrix({ db, server, ownerToken, ownerIdentity }) {
    const hierarchy = await createProjectWithSections(server, ownerToken, 'phase2-hierarchy', ['hierarchy-one', 'hierarchy-two']);
    let structureRevision = hierarchy.structureRevision;
    const rootA = await createTask(server, ownerToken, hierarchy.projectId, {
        operationId: 'hierarchy-root-a', taskId: 'hierarchy-root-a', sectionId: hierarchy.sections[0].id,
        ownerUid: null, title: 'Root A', expectedStructureRevision: structureRevision
    });
    structureRevision += 1;
    const rootB = await createTask(server, ownerToken, hierarchy.projectId, {
        operationId: 'hierarchy-root-b', taskId: 'hierarchy-root-b', sectionId: hierarchy.sections[0].id,
        ownerUid: null, title: 'Root B', expectedStructureRevision: structureRevision
    });
    structureRevision += 1;
    const rootC = await createTask(server, ownerToken, hierarchy.projectId, {
        operationId: 'hierarchy-root-c', taskId: 'hierarchy-root-c', sectionId: hierarchy.sections[0].id,
        ownerUid: null, title: 'Root C', expectedStructureRevision: structureRevision
    });
    structureRevision += 1;
    await createTask(server, ownerToken, hierarchy.projectId, {
        operationId: 'hierarchy-a-child', taskId: 'hierarchy-a-child', parentTaskId: rootA.id,
        ownerUid: null, title: 'A child', expectedStructureRevision: structureRevision
    });
    structureRevision += 1;
    await createTask(server, ownerToken, hierarchy.projectId, {
        operationId: 'hierarchy-a-grandchild', taskId: 'hierarchy-a-grandchild', parentTaskId: 'hierarchy-a-child',
        ownerUid: null, title: 'A grandchild', expectedStructureRevision: structureRevision
    });
    structureRevision += 1;
    await createTask(server, ownerToken, hierarchy.projectId, {
        operationId: 'hierarchy-c-child', taskId: 'hierarchy-c-child', parentTaskId: rootC.id,
        ownerUid: null, title: 'C child', expectedStructureRevision: structureRevision
    });
    structureRevision += 1;

    const competing = await Promise.all([
        request(server, `/api/projects/${hierarchy.projectId}/tasks/${rootC.id}/move`, ownerToken, {
            method: 'POST', headers: jsonHeaders(), body: JSON.stringify({
                operationId: 'hierarchy-move-c-under-a', expectedRevision: rootC.revision,
                expectedStructureRevision: structureRevision, parentTaskId: rootA.id, index: 0
            })
        }),
        request(server, `/api/projects/${hierarchy.projectId}/tasks/${rootC.id}/move`, ownerToken, {
            method: 'POST', headers: jsonHeaders(), body: JSON.stringify({
                operationId: 'hierarchy-move-c-under-b', expectedRevision: rootC.revision,
                expectedStructureRevision: structureRevision, parentTaskId: rootB.id, index: 0
            })
        })
    ]);
    assert.deepStrictEqual(competing.map((item) => item.status).sort(), [200, 409], 'competing reparent transactions must have one winner');
    const winningMove = competing.find((item) => item.status === 200).body;
    const winningParent = winningMove.task.parentTaskId;
    const otherParent = winningParent === rootA.id ? rootB.id : rootA.id;
    const inverseMove = await request(server, `/api/projects/${hierarchy.projectId}/tasks/${rootC.id}/move`, ownerToken, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({
            operationId: 'hierarchy-inverse-move', expectedRevision: winningMove.task.revision,
            expectedStructureRevision: winningMove.structureRevision, parentTaskId: otherParent, index: 0
        })
    });
    assert.strictEqual(inverseMove.status, 200, JSON.stringify(inverseMove.body));
    structureRevision = inverseMove.body.structureRevision;
    const hierarchyQuery = await request(server, `/api/projects/${hierarchy.projectId}/tasks?pageSize=100`, ownerToken);
    assert.strictEqual(hierarchyQuery.status, 200, JSON.stringify(hierarchyQuery.body));
    const hierarchyRows = new Map(hierarchyQuery.body.tasks.map((task) => [task.id, task]));
    assert.strictEqual(hierarchyRows.size, 6, 'competing moves must not orphan or duplicate hierarchy records');
    assert.strictEqual(hierarchyRows.get('hierarchy-c-child').parentTaskId, rootC.id, 'reparenting a parent retains its child');
    assert.strictEqual(hierarchyRows.get(rootC.id).parentTaskId, otherParent, 'the successful inverse move must win its own structure revision');

    const cycleA = await createTask(server, ownerToken, hierarchy.projectId, {
        operationId: 'hierarchy-cycle-a-create', taskId: 'hierarchy-cycle-a', sectionId: hierarchy.sections[0].id,
        ownerUid: null, title: 'Cycle A', expectedStructureRevision: structureRevision
    });
    structureRevision += 1;
    const cycleB = await createTask(server, ownerToken, hierarchy.projectId, {
        operationId: 'hierarchy-cycle-b-create', taskId: 'hierarchy-cycle-b', sectionId: hierarchy.sections[0].id,
        ownerUid: null, title: 'Cycle B', expectedStructureRevision: structureRevision
    });
    structureRevision += 1;
    const cyclicCompeting = await Promise.all([
        request(server, `/api/projects/${hierarchy.projectId}/tasks/${cycleA.id}/move`, ownerToken, {
            method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ operationId: 'hierarchy-cycle-a-move', expectedRevision: cycleA.revision, expectedStructureRevision: structureRevision, parentTaskId: cycleB.id, index: 0 })
        }),
        request(server, `/api/projects/${hierarchy.projectId}/tasks/${cycleB.id}/move`, ownerToken, {
            method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ operationId: 'hierarchy-cycle-b-move', expectedRevision: cycleB.revision, expectedStructureRevision: structureRevision, parentTaskId: cycleA.id, index: 0 })
        })
    ]);
    assert.deepStrictEqual(cyclicCompeting.map((item) => item.status).sort(), [200, 409], 'competing inverse parent moves must reject the losing cycle');
    structureRevision = cyclicCompeting.find((item) => item.status === 200).body.structureRevision;
    const cyclicRowsResponse = await request(server, `/api/projects/${hierarchy.projectId}/tasks?pageSize=100`, ownerToken);
    assert.strictEqual(cyclicRowsResponse.status, 200);
    const cyclicRows = new Map(cyclicRowsResponse.body.tasks.map((task) => [task.id, task]));
    assert.ok(
        (cyclicRows.get(cycleA.id).parentTaskId === cycleB.id) !== (cyclicRows.get(cycleB.id).parentTaskId === cycleA.id),
        'exactly one inverse parent relation may commit'
    );
    assert.ok(!(cyclicRows.get(cycleA.id).parentTaskId === cycleB.id && cyclicRows.get(cycleB.id).parentTaskId === cycleA.id), 'inverse moves must leave an acyclic hierarchy');

    const cycle = await request(server, `/api/projects/${hierarchy.projectId}/tasks/${rootC.id}/move`, ownerToken, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({
            operationId: 'hierarchy-cycle', expectedRevision: inverseMove.body.task.revision,
            expectedStructureRevision: structureRevision, parentTaskId: 'hierarchy-c-child', index: 0
        })
    });
    assert.strictEqual(cycle.status, 409, 'a task cannot be moved below its own descendant');
    const deepCycle = await request(server, `/api/projects/${hierarchy.projectId}/tasks/${rootA.id}/move`, ownerToken, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({
            operationId: 'hierarchy-deep-cycle', expectedRevision: rootA.revision,
            expectedStructureRevision: structureRevision, parentTaskId: 'hierarchy-a-grandchild', index: 0
        })
    });
    assert.strictEqual(deepCycle.status, 409, 'a root-to-deep-descendant move must be rejected');

    const dense = await createProjectWithSections(server, ownerToken, 'phase2-dense-order', ['dense-one', 'dense-two']);
    await seedDenseSiblings(db, dense.projectId, dense.sections[0].id, ownerIdentity.uid, 'dense');
    let batch = db.batch();
    for (let index = 0; index < 3; index += 1) {
        batch.set(db.collection(PROJECT_COLLECTIONS.projects).doc(dense.projectId).collection('tasks').doc(`other-${index}`), {
            projectId: dense.projectId, parentTaskId: null, sectionId: dense.sections[1].id, title: `Other ${index}`,
            status: 'not_started', ownerUid: ownerIdentity.uid, assigneeUids: [], values: {}, lifecycle: 'active',
            rank: `${index}/1`, revision: 1, updatedAt: '2026-01-01T00:00:00.000Z'
        });
    }
    await batch.commit();
    const denseTasks = db.collection(PROJECT_COLLECTIONS.projects).doc(dense.projectId).collection('tasks');
    const beforeDenseSnapshot = await denseTasks.get();
    const beforeDense = new Map(beforeDenseSnapshot.docs.map((doc) => [doc.id, doc.data()]));
    const denseMove = await request(server, `/api/projects/${dense.projectId}/tasks/other-1/move`, ownerToken, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({
            operationId: 'dense-move', expectedRevision: 1, expectedStructureRevision: dense.structureRevision,
            sectionId: dense.sections[0].id, index: 325
        })
    });
    assert.strictEqual(denseMove.status, 200, JSON.stringify(denseMove.body));
    const denseOperation = await db.collection(PROJECT_OPERATION_COLLECTION).doc('dense-move').get();
    const denseEvent = await db.collection(PROJECT_EVENT_COLLECTION).doc('dense-move').get();
    assert.ok(denseOperation.exists && denseEvent.exists, 'dense move must persist one operation and one event');
    assert.ok((denseOperation.data().after?.rebalance || []).length <= 128, 'dense move must use bounded local rank rewrites');
    assert.ok((denseEvent.data().affectedIds || []).length <= 130, 'event affected IDs must include only the bounded structural window');
    const denseUndo = await request(server, `/api/projects/${dense.projectId}/operations/dense-move/undo`, ownerToken, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ operationId: 'dense-undo' })
    });
    assert.strictEqual(denseUndo.status, 200, JSON.stringify(denseUndo.body));
    const afterDenseSnapshot = await denseTasks.get();
    const afterDense = new Map(afterDenseSnapshot.docs.map((doc) => [doc.id, doc.data()]));
    const beforeOrder = beforeDenseSnapshot.docs.map((doc) => ({ id: doc.id, rank: beforeDense.get(doc.id).rank })).sort(compareSiblings).map((row) => row.id);
    const afterOrder = afterDenseSnapshot.docs.map((doc) => ({ id: doc.id, rank: afterDense.get(doc.id).rank })).sort(compareSiblings).map((row) => row.id);
    assert.deepStrictEqual(afterOrder, beforeOrder, 'move plus immediate undo must restore every sibling relative order');
    for (const [id, before] of beforeDense.entries()) {
        assert.strictEqual(afterDense.get(id).rank, before.rank, `undo must restore the original rank for ${id}`);
        const expectedRevision = id === 'other-1' || (denseOperation.data().after?.rebalance || []).some((entry) => entry.id === id)
            ? Number(before.revision) + 2 : Number(before.revision);
        assert.strictEqual(Number(afterDense.get(id).revision), expectedRevision, `undo revision accounting must be complete for ${id}`);
    }
    const undoOperation = await db.collection(PROJECT_OPERATION_COLLECTION).doc('dense-undo').get();
    assert.deepStrictEqual(Object.keys(undoOperation.data().beforeRevisions).sort(), Object.keys(denseOperation.data().afterRevisions).sort(), 'undo must record every affected sibling revision');
    const denseLifecycleMove = await request(server, `/api/projects/${dense.projectId}/tasks/other-1/move`, ownerToken, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({
            operationId: 'dense-lifecycle-move', expectedRevision: afterDense.get('other-1').revision,
            expectedStructureRevision: denseUndo.body.structureRevision, sectionId: dense.sections[0].id, index: 325
        })
    });
    assert.strictEqual(denseLifecycleMove.status, 200, JSON.stringify(denseLifecycleMove.body));
    const denseSectionRef = db.collection(PROJECT_COLLECTIONS.projects).doc(dense.projectId).collection('sections').doc(dense.sections[0].id);
    const denseSectionBeforeArchive = (await denseSectionRef.get()).data();
    await denseSectionRef.set({ lifecycle: 'archived' }, { merge: true });
    const lifecycleUndo = await request(server, `/api/projects/${dense.projectId}/operations/dense-lifecycle-move/undo`, ownerToken, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ operationId: 'dense-lifecycle-undo' })
    });
    assert.strictEqual(lifecycleUndo.status, 409, 'Undo must reject an archived original destination section');
    assert.strictEqual((await db.collection(PROJECT_OPERATION_COLLECTION).doc('dense-lifecycle-undo').get()).exists, false, 'failed lifecycle Undo must not create history');
    await denseSectionRef.set(denseSectionBeforeArchive);

    const staleEdit = await request(server, `/api/projects/${hierarchy.projectId}/tasks/${rootC.id}`, ownerToken, {
        method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ operationId: 'hierarchy-later-edit', expectedRevision: inverseMove.body.task.revision, title: 'Edited after move' })
    });
    assert.strictEqual(staleEdit.status, 200);
    const staleUndo = await request(server, `/api/projects/${hierarchy.projectId}/operations/hierarchy-inverse-move/undo`, ownerToken, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ operationId: 'hierarchy-stale-undo-edit' })
    });
    assert.strictEqual(staleUndo.status, 409, 'Undo must reject a later task edit');

    const structureMove = await request(server, `/api/projects/${hierarchy.projectId}/tasks/${rootB.id}/move`, ownerToken, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({
            operationId: 'hierarchy-structure-move', expectedRevision: rootB.revision,
            expectedStructureRevision: structureRevision, sectionId: hierarchy.sections[1].id, index: 0
        })
    });
    assert.strictEqual(structureMove.status, 200, JSON.stringify(structureMove.body));
    const laterStructure = await createTask(server, ownerToken, hierarchy.projectId, {
        operationId: 'hierarchy-later-structure', taskId: 'hierarchy-later-structure', sectionId: hierarchy.sections[1].id,
        ownerUid: null, title: 'Later structure', expectedStructureRevision: structureMove.body.structureRevision
    });
    assert.ok(laterStructure);
    const staleStructureUndo = await request(server, `/api/projects/${hierarchy.projectId}/operations/hierarchy-structure-move/undo`, ownerToken, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ operationId: 'hierarchy-stale-undo-structure' })
    });
    assert.strictEqual(staleStructureUndo.status, 409, 'Undo must reject a later structure change');
}

async function runReplayAndFenceMatrix({ db, auth, server, ownerToken, editorToken, ownerIdentity, accessService }) {
    const race = await createProjectWithSections(server, ownerToken, 'phase2-replay-fence', ['race-section']);
    await accessService.addOrUpdateMember(ownerIdentity, race.projectId, 'crm-projects-staff-editor', { role: 'Editor' });
    const concurrentBody = {
        operationId: 'phase2-same-operation', taskId: 'phase2-same-operation', sectionId: race.sections[0].id,
        title: 'Same operation', expectedStructureRevision: race.structureRevision
    };
    const concurrentResponses = await Promise.all([
        request(server, `/api/projects/${race.projectId}/tasks`, ownerToken, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(concurrentBody) }),
        request(server, `/api/projects/${race.projectId}/tasks`, ownerToken, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(concurrentBody) })
    ]);
    assert.deepStrictEqual(concurrentResponses.map((item) => item.status).sort(), [200, 200]);
    const operations = await db.collection(PROJECT_OPERATION_COLLECTION).where('operationId', '==', concurrentBody.operationId).get();
    const events = await db.collection(PROJECT_EVENT_COLLECTION).where('operationId', '==', concurrentBody.operationId).get();
    assert.strictEqual(operations.size, 1, 'concurrent exact retries must persist exactly one operation');
    assert.strictEqual(events.size, 1, 'concurrent exact retries must persist exactly one event');
    for (const changed of [
        { ...concurrentBody, title: 'Changed payload' },
        { ...concurrentBody, index: 0 },
        { ...concurrentBody, expectedStructureRevision: race.structureRevision + 1 }
    ]) {
        const conflict = await request(server, `/api/projects/${race.projectId}/tasks`, ownerToken, {
            method: 'POST', headers: jsonHeaders(), body: JSON.stringify(changed)
        });
        assert.strictEqual(conflict.status, 409, 'same operation ID changed payload/index/precondition must conflict');
    }
    const actorConflict = await request(server, `/api/projects/${race.projectId}/tasks`, editorToken, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify(concurrentBody)
    });
    assert.strictEqual(actorConflict.status, 409, 'same operation ID cannot be replayed by another actor');

    const raceProjectRef = db.collection(PROJECT_COLLECTIONS.projects).doc(race.projectId);
    const raceMemberRef = db.collection(PROJECT_COLLECTIONS.members).doc(memberDocumentId(race.projectId, ownerIdentity.uid));
    const raceMemberBefore = (await raceMemberRef.get()).data();
    const raceProjectBefore = (await raceProjectRef.get()).data();
    const fencedTaskRef = raceProjectRef.collection('tasks').doc('membership-fenced-task');
    let barrierServer;
    try {
        const barrierDb = makeBarrierDb(db, async () => raceMemberRef.set({ ...raceMemberBefore, active: false }, { merge: true }));
        const barrierAccess = createProjectsAccessService({ db: barrierDb, auth });
        barrierServer = await startRouterServer({ db: barrierDb, auth, accessService: barrierAccess });
        const denied = await request(barrierServer, `/api/projects/${race.projectId}/tasks`, ownerToken, {
            method: 'POST', headers: jsonHeaders(), body: JSON.stringify({
                operationId: 'membership-fenced', taskId: 'membership-fenced-task', sectionId: race.sections[0].id,
                title: 'Must not commit', expectedStructureRevision: raceProjectBefore.structureRevision
            })
        });
        assert.strictEqual(denied.status, 404, 'membership revoked after request authentication must fail at the transaction fence');
        assert.strictEqual((await fencedTaskRef.get()).exists, false);
        assert.strictEqual((await db.collection(PROJECT_OPERATION_COLLECTION).doc('membership-fenced').get()).exists, false);
        assert.strictEqual((await db.collection(PROJECT_EVENT_COLLECTION).doc('membership-fenced').get()).exists, false);
        assert.deepStrictEqual((await raceProjectRef.get()).data(), raceProjectBefore, 'fenced membership denial must not advance project structure');
    } finally {
        if (barrierServer) await new Promise((resolve) => barrierServer.close(resolve));
        await raceMemberRef.set(raceMemberBefore);
    }

    const workforceRef = db.collection(PROJECT_COLLECTIONS.workforce).doc(ownerIdentity.uid);
    const workforceBefore = (await workforceRef.get()).data();
    barrierServer = null;
    try {
        const barrierDb = makeBarrierDb(db, async () => workforceRef.set({ ...workforceBefore, moduleGrants: { ...(workforceBefore.moduleGrants || {}), projects: false } }, { merge: true }));
        const barrierAccess = createProjectsAccessService({ db: barrierDb, auth });
        barrierServer = await startRouterServer({ db: barrierDb, auth, accessService: barrierAccess });
        const denied = await request(barrierServer, `/api/projects/${race.projectId}/tasks`, ownerToken, {
            method: 'POST', headers: jsonHeaders(), body: JSON.stringify({
                operationId: 'module-fenced', taskId: 'module-fenced-task', sectionId: race.sections[0].id,
                title: 'Must not commit', expectedStructureRevision: raceProjectBefore.structureRevision
            })
        });
        assert.strictEqual(denied.status, 403, 'module grant revoked after request authentication must fail at the transaction fence');
        assert.strictEqual((await raceProjectRef.collection('tasks').doc('module-fenced-task').get()).exists, false);
        assert.strictEqual((await db.collection(PROJECT_OPERATION_COLLECTION).doc('module-fenced').get()).exists, false);
        assert.strictEqual((await db.collection(PROJECT_EVENT_COLLECTION).doc('module-fenced').get()).exists, false);
    } finally {
        if (barrierServer) await new Promise((resolve) => barrierServer.close(resolve));
        await workforceRef.set(workforceBefore);
    }

    const replayProjectId = 'phase2-creation-replay';
    const replayBody = { operationId: 'phase2-creation-replay', projectId: replayProjectId, name: 'Creation replay' };
    let replay = await request(server, '/api/projects/', ownerToken, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(replayBody) });
    assert.strictEqual(replay.status, 200, JSON.stringify(replay.body));
    await accessService.addOrUpdateMember(ownerIdentity, replayProjectId, 'crm-projects-staff-editor', { role: 'Editor' });
    const editorIdentity = await accessService.authenticateToken(editorToken);
    await accessService.transferOwner(ownerIdentity, replayProjectId, editorIdentity.uid);
    replay = await request(server, '/api/projects/', ownerToken, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(replayBody) });
    assert.strictEqual(replay.status, 403, 'creation replay must recheck current Owner membership');
    assert.strictEqual((await db.collection(PROJECT_OPERATION_COLLECTION).doc(replayBody.operationId).get()).exists, true);
    assert.strictEqual((await db.collection(PROJECT_EVENT_COLLECTION).doc(replayBody.operationId).get()).exists, true);
}

async function runTypedValuesAndProtectionMatrix({ db, server, ownerToken, viewerToken, editorToken, adminToken, ownerIdentity, accessService }) {
    const typed = await createProjectWithSections(server, ownerToken, 'phase2-typed-values', ['typed-section']);
    await accessService.addOrUpdateMember(ownerIdentity, typed.projectId, 'crm-projects-staff-editor', { role: 'Editor' });
    await accessService.addOrUpdateMember(ownerIdentity, typed.projectId, 'crm-projects-viewer', { role: 'Viewer' });
    const columnDefinitions = [
        ['notes', { type: 'text', label: 'Notes' }],
        ['estimate', { type: 'number', label: 'Estimate' }],
        ['due', { type: 'date', label: 'Due' }],
        ['people', { type: 'people', label: 'People' }],
        ['state', { type: 'status', label: 'State' }],
        ['priority', { type: 'priority', label: 'Priority' }],
        ['stage', { type: 'dropdown', label: 'Stage', options: [{ key: 'todo', label: 'To do' }, { key: 'done', label: 'Done' }] }],
        ['legacy', { type: 'text', label: 'Legacy' }]
    ];
    let schemaRevision = 0;
    for (const [columnId, definition] of columnDefinitions) {
        const response = await request(server, `/api/projects/${typed.projectId}/columns`, ownerToken, {
            method: 'POST', headers: jsonHeaders(), body: JSON.stringify({
                operationId: `typed-column-${columnId}`, columnId, ...definition, expectedSchemaRevision: schemaRevision
            })
        });
        assert.strictEqual(response.status, 200, JSON.stringify(response.body));
        schemaRevision = response.body.schemaRevision;
    }
    const typedTask = await createTask(server, ownerToken, typed.projectId, {
        operationId: 'typed-root', taskId: 'typed-root', sectionId: typed.sections[0].id, ownerUid: null,
        assigneeUids: ['crm-projects-staff-editor'], title: 'Typed root', expectedStructureRevision: typed.structureRevision,
        values: {
            notes: 'initial', estimate: 3.5, due: '2026-09-21', people: ['crm-projects-staff-editor'],
            state: 'in_progress', priority: 'high', stage: 'todo', legacy: 'retain me'
        }
    });
    assert.strictEqual(typedTask.ownerUid, null, 'an explicitly unassigned task must persist a null owner');
    const oldRevision = typedTask.revision;
    let response = await request(server, `/api/projects/${typed.projectId}/columns/legacy/replace`, ownerToken, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({
            operationId: 'typed-replace-legacy', newColumnId: 'legacy-v2', type: 'text', label: 'Legacy v2', expectedRevision: 1,
            expectedSchemaRevision: (await db.collection(PROJECT_COLLECTIONS.projects).doc(typed.projectId).get()).data().schemaRevision
        })
    });
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    assert.strictEqual(response.body.archivedColumn.lifecycle, 'archived');
    assert.strictEqual(response.body.column.id, 'legacy-v2');

    const currentTypedProject = (await db.collection(PROJECT_COLLECTIONS.projects).doc(typed.projectId).get()).data();
    response = await request(server, `/api/projects/${typed.projectId}/sections`, ownerToken, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({
            operationId: 'typed-section-two', sectionId: 'typed-section-two', title: 'Typed section two',
            expectedStructureRevision: currentTypedProject.structureRevision
        })
    });
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    const typedSectionTwo = response.body.section;
    response = await request(server, `/api/projects/${typed.projectId}/sections/${typedSectionTwo.id}/move`, ownerToken, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({
            operationId: 'typed-section-move', index: 0, expectedRevision: typedSectionTwo.revision,
            expectedStructureRevision: response.body.structureRevision
        })
    });
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    const notesBeforeMove = (await db.collection(PROJECT_COLLECTIONS.projects).doc(typed.projectId).collection('columns').doc('notes').get()).data();
    const projectAfterSectionMove = (await db.collection(PROJECT_COLLECTIONS.projects).doc(typed.projectId).get()).data();
    response = await request(server, `/api/projects/${typed.projectId}/columns/notes/move`, ownerToken, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({
            operationId: 'typed-column-move', index: 7, expectedRevision: notesBeforeMove.revision,
            expectedSchemaRevision: projectAfterSectionMove.schemaRevision
        })
    });
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    const legacyReplacementBeforeArchive = (await db.collection(PROJECT_COLLECTIONS.projects).doc(typed.projectId).collection('columns').doc('legacy-v2').get()).data();
    const projectAfterColumnMove = (await db.collection(PROJECT_COLLECTIONS.projects).doc(typed.projectId).get()).data();
    response = await request(server, `/api/projects/${typed.projectId}/columns/legacy-v2/archive`, ownerToken, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({
            operationId: 'typed-column-archive', expectedRevision: legacyReplacementBeforeArchive.revision,
            expectedSchemaRevision: projectAfterColumnMove.schemaRevision
        })
    });
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));

    response = await request(server, `/api/projects/${typed.projectId}/sections`, ownerToken, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ operationId: 'typed-missing-section-structure', sectionId: 'typed-missing-section-structure', title: 'Missing structure' })
    });
    assert.strictEqual(response.status, 400);
    response = await request(server, `/api/projects/${typed.projectId}/columns`, ownerToken, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ operationId: 'typed-missing-column-schema', columnId: 'typed-missing-column-schema', type: 'text', label: 'Missing schema' })
    });
    assert.strictEqual(response.status, 400);
    response = await request(server, `/api/projects/${typed.projectId}/tasks`, ownerToken, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ operationId: 'typed-missing-task-structure', taskId: 'typed-missing-task-structure', sectionId: typed.sections[0].id, ownerUid: null, title: 'Missing structure' })
    });
    assert.strictEqual(response.status, 400);

    const movedSection = (await db.collection(PROJECT_COLLECTIONS.projects).doc(typed.projectId).collection('sections').doc(typedSectionTwo.id).get()).data();
    const movedProject = (await db.collection(PROJECT_COLLECTIONS.projects).doc(typed.projectId).get()).data();
    response = await request(server, `/api/projects/${typed.projectId}/sections/${typedSectionTwo.id}/move`, ownerToken, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ operationId: 'typed-section-move-bool-index', index: true, expectedRevision: movedSection.revision, expectedStructureRevision: movedProject.structureRevision })
    });
    assert.strictEqual(response.status, 400);
    response = await request(server, `/api/projects/${typed.projectId}/sections/${typedSectionTwo.id}/move`, ownerToken, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ operationId: 'typed-section-move-string-index', index: '0', expectedRevision: movedSection.revision, expectedStructureRevision: movedProject.structureRevision })
    });
    assert.strictEqual(response.status, 400);

    const archivedSourceTask = await createTask(server, ownerToken, typed.projectId, {
        operationId: 'typed-archived-source-task', taskId: 'typed-archived-source-task', sectionId: typed.sections[0].id,
        ownerUid: null, title: 'Archived source task', expectedStructureRevision: (await db.collection(PROJECT_COLLECTIONS.projects).doc(typed.projectId).get()).data().structureRevision
    });
    const sourceSectionRef = db.collection(PROJECT_COLLECTIONS.projects).doc(typed.projectId).collection('sections').doc(typed.sections[0].id);
    const sourceSectionBeforeArchive = (await sourceSectionRef.get()).data();
    await sourceSectionRef.set({ lifecycle: 'archived' }, { merge: true });
    const archivedSourceMove = await request(server, `/api/projects/${typed.projectId}/tasks/${archivedSourceTask.id}/move`, ownerToken, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({
            operationId: 'typed-archived-source-move', expectedRevision: archivedSourceTask.revision,
            expectedStructureRevision: (await db.collection(PROJECT_COLLECTIONS.projects).doc(typed.projectId).get()).data().structureRevision,
            sectionId: typedSectionTwo.id, index: 0
        })
    });
    assert.strictEqual(archivedSourceMove.status, 409, 'a task in an archived source section must not be moved');
    await sourceSectionRef.set(sourceSectionBeforeArchive);

    const foreign = await createProjectWithSections(server, ownerToken, 'phase2-foreign-parent', ['foreign-section']);
    await createTask(server, ownerToken, foreign.projectId, {
        operationId: 'foreign-real-parent', taskId: 'foreign-real-parent', sectionId: foreign.sections[0].id,
        ownerUid: null, title: 'Foreign real parent', expectedStructureRevision: foreign.structureRevision
    });
    response = await request(server, `/api/projects/${typed.projectId}/tasks`, ownerToken, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({
            operationId: 'typed-cross-project-parent', taskId: 'typed-cross-project-parent', parentTaskId: 'foreign-real-parent',
            ownerUid: null, title: 'Cross project parent', expectedStructureRevision: (await db.collection(PROJECT_COLLECTIONS.projects).doc(typed.projectId).get()).data().structureRevision
        })
    });
    assert.strictEqual(response.status, 409, 'an existing parent in another project must be rejected');

    const afterReplaceRevision = oldRevision;
    response = await request(server, `/api/projects/${typed.projectId}/tasks/${typedTask.id}`, ownerToken, {
        method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({
            operationId: 'typed-merge-values', expectedRevision: afterReplaceRevision, title: 'Typed root edited', values: { notes: 'updated' }
        })
    });
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    assert.strictEqual(response.body.task.values.notes, 'updated');
    assert.strictEqual(response.body.task.values.estimate, 3.5);
    assert.strictEqual(response.body.task.values.due, '2026-09-21');
    assert.strictEqual(response.body.task.values.legacy, 'retain me', 'archived column values must survive ordinary value merges');

    for (const [suffix, values] of [
        ['bad-number', { estimate: '3.5' }],
        ['bad-date', { due: '2026-02-31' }],
        ['bad-status', { state: 'paused' }],
        ['bad-priority', { priority: 'critical' }],
        ['bad-option', { stage: 'unknown' }],
        ['unknown-column', { unknown: 'value' }]
    ]) {
        response = await request(server, `/api/projects/${typed.projectId}/tasks`, ownerToken, {
            method: 'POST', headers: jsonHeaders(), body: JSON.stringify({
                operationId: `typed-invalid-${suffix}`, taskId: `typed-invalid-${suffix}`, sectionId: typed.sections[0].id,
                ownerUid: null, title: `Invalid ${suffix}`, values, expectedStructureRevision: typed.structureRevision
            })
        });
        assert.strictEqual(response.status, 400, `invalid typed value ${suffix} must be rejected`);
    }

    const activeEditorMemberRef = db.collection(PROJECT_COLLECTIONS.members).doc(memberDocumentId(typed.projectId, 'crm-projects-staff-editor'));
    const activeEditorMember = (await activeEditorMemberRef.get()).data();
    await accessService.removeMember(ownerIdentity, typed.projectId, 'crm-projects-staff-editor');
    response = await request(server, `/api/projects/${typed.projectId}/tasks/${typedTask.id}`, ownerToken, {
        method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({
            operationId: 'typed-retain-inactive-assignment', expectedRevision: response.body?.task?.revision || oldRevision + 1,
            title: 'Retain inactive assignment', dueDate: '2026-09-30'
        })
    });
    if (response.status === 409 && response.body?.code === 'STALE_REVISION') {
        const current = (await db.collection(PROJECT_COLLECTIONS.projects).doc(typed.projectId).collection('tasks').doc(typedTask.id).get()).data();
        response = await request(server, `/api/projects/${typed.projectId}/tasks/${typedTask.id}`, ownerToken, {
            method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ operationId: 'typed-retain-inactive-assignment-retry', expectedRevision: current.revision, title: 'Retain inactive assignment', dueDate: '2026-09-30' })
        });
    }
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    assert.strictEqual(response.body.task.assigneeUids[0], 'crm-projects-staff-editor');
    const retainedTask = response.body.task;
    response = await request(server, `/api/projects/${typed.projectId}/tasks/${typedTask.id}`, ownerToken, {
        method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({
            operationId: 'typed-resubmit-inactive-owner', expectedRevision: retainedTask.revision, ownerUid: 'crm-projects-staff-editor', assigneeUids: []
        })
    });
    assert.strictEqual(response.status, 403, `resubmitting an inactive accountable assignment must fail: ${JSON.stringify(response.body)}`);
    response = await request(server, `/api/projects/${typed.projectId}/tasks/${typedTask.id}`, ownerToken, {
        method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({
            operationId: 'typed-owner-assignee-overlap', expectedRevision: retainedTask.revision,
            ownerUid: 'crm-projects-staff-editor', assigneeUids: ['crm-projects-staff-editor']
        })
    });
    assert.strictEqual(response.status, 400, 'owner and additional assignee overlap must remain a distinct validation error');
    response = await request(server, `/api/projects/${typed.projectId}/tasks/${typedTask.id}`, ownerToken, {
        method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({
            operationId: 'typed-resubmit-inactive-people', expectedRevision: retainedTask.revision,
            values: { people: ['crm-projects-staff-editor'] }
        })
    });
    assert.strictEqual(response.status, 403, 'resubmitting an inactive people value must fail');
    await activeEditorMemberRef.set(activeEditorMember);

    const forgedMember = { projectId: typed.projectId, uid: 'forged-target', role: 'Owner', active: true, revision: 99 };
    await activeEditorMemberRef.set(forgedMember);
    response = await request(server, `/api/projects/${typed.projectId}/tasks`, ownerToken, {
        method: 'POST', headers: jsonHeaders(), body: JSON.stringify({
            operationId: 'typed-forged-membership', taskId: 'typed-forged-membership', sectionId: typed.sections[0].id,
            ownerUid: 'crm-projects-staff-editor', title: 'Forged target', expectedStructureRevision: typed.structureRevision
        })
    });
    assert.strictEqual(response.status, 403, 'a forged membership tuple must not make an assignment target eligible');
    await activeEditorMemberRef.set(activeEditorMember);

    for (const [kind, body] of [
        ['missing-task-revision', { operationId: 'typed-missing-task-revision', title: 'Missing revision' }],
        ['boolean-task-revision', { operationId: 'typed-boolean-task-revision', expectedRevision: true, title: 'Boolean revision' }],
        ['string-task-revision', { operationId: 'typed-string-task-revision', expectedRevision: String(response.body?.task?.revision || oldRevision + 1), title: 'String revision' }]
    ]) {
        const current = (await db.collection(PROJECT_COLLECTIONS.projects).doc(typed.projectId).collection('tasks').doc(typedTask.id).get()).data();
        const invalid = await request(server, `/api/projects/${typed.projectId}/tasks/${typedTask.id}`, ownerToken, {
            method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ ...body, expectedRevision: body.expectedRevision === undefined ? undefined : body.expectedRevision })
        });
        assert.strictEqual(invalid.status, 400, `${kind} must be rejected`);
        assert.ok(current.revision >= 1);
    }
    const staleCurrent = (await db.collection(PROJECT_COLLECTIONS.projects).doc(typed.projectId).collection('tasks').doc(typedTask.id).get()).data();
    response = await request(server, `/api/projects/${typed.projectId}/tasks/${typedTask.id}`, ownerToken, {
        method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ operationId: 'typed-current-edit', expectedRevision: staleCurrent.revision, title: 'Current edit' })
    });
    assert.strictEqual(response.status, 200);
    const stale = await request(server, `/api/projects/${typed.projectId}/tasks/${typedTask.id}`, ownerToken, {
        method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ operationId: 'typed-stale-edit', expectedRevision: staleCurrent.revision, title: 'Stale edit' })
    });
    assert.strictEqual(stale.status, 409);

    for (const reserved of ['.', '..', '__reserved__']) {
        const invalidColumn = await request(server, `/api/projects/${typed.projectId}/columns`, ownerToken, {
            method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ operationId: `reserved-column-${reserved}`, columnId: reserved, type: 'text', label: 'Reserved', expectedSchemaRevision: schemaRevision })
        });
        assert.strictEqual(invalidColumn.status, 400, `reserved provider column ID ${reserved} must be rejected`);
        const invalidTask = await request(server, `/api/projects/${typed.projectId}/tasks`, ownerToken, {
            method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ operationId: `reserved-task-${reserved}`, taskId: reserved, sectionId: typed.sections[0].id, ownerUid: null, title: 'Reserved', expectedStructureRevision: typed.structureRevision })
        });
        assert.strictEqual(invalidTask.status, 400, `reserved provider task ID ${reserved} must be rejected`);
    }

    const typedProjectBeforeCursor = (await db.collection(PROJECT_COLLECTIONS.projects).doc(typed.projectId).get()).data();
    const cursorSeed = await createTask(server, ownerToken, typed.projectId, {
        operationId: 'typed-cursor-seed', taskId: 'typed-cursor-seed', sectionId: typed.sections[0].id,
        ownerUid: null, title: 'Cursor seed', expectedStructureRevision: typedProjectBeforeCursor.structureRevision
    });
    assert.ok(cursorSeed);
    const cursorResponse = await request(server, `/api/projects/${typed.projectId}/tasks?pageSize=1`, ownerToken);
    assert.strictEqual(cursorResponse.status, 200);
    assert.ok(cursorResponse.body.nextCursor);
    const protectedPaths = [
        `crmProjects/${typed.projectId}/sections/${typed.sections[0].id}`,
        `crmProjects/${typed.projectId}/columns/notes`,
        `crmProjects/${typed.projectId}/tasks/${typedTask.id}`,
        `${PROJECT_OPERATION_COLLECTION}/phase2-same-operation`,
        `${PROJECT_EVENT_COLLECTION}/phase2-same-operation`,
        `${PROJECT_CURSOR_COLLECTION}/${cursorResponse.body.nextCursor}`
    ];
    for (const token of [ownerToken, editorToken, viewerToken, adminToken]) {
        for (const path of protectedPaths) {
            assert.strictEqual((await directClientRead(path, token)).status, 403, `direct read must be denied for ${path}`);
            assert.strictEqual((await directClientWrite(path, token)).status, 403, `direct write must be denied for ${path}`);
        }
    }

    const projectDoc = db.collection(PROJECT_COLLECTIONS.projects).doc(typed.projectId);
    const sectionDoc = projectDoc.collection('sections').doc(typed.sections[0].id);
    const notesDoc = projectDoc.collection('columns').doc('notes');
    response = await request(server, `/api/projects/${typed.projectId}`, ownerToken, { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ operationId: 'typed-project-metadata', expectedRevision: (await projectDoc.get()).data().revision, name: 'Typed project renamed' }) });
    assert.strictEqual(response.status, 200);
    response = await request(server, `/api/projects/${typed.projectId}/sections/${typed.sections[0].id}`, ownerToken, { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ operationId: 'typed-section-metadata', expectedRevision: (await sectionDoc.get()).data().revision, expectedStructureRevision: (await projectDoc.get()).data().structureRevision, title: 'Typed section renamed' }) });
    assert.strictEqual(response.status, 200);
    response = await request(server, `/api/projects/${typed.projectId}/columns/notes`, ownerToken, { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ operationId: 'typed-column-metadata', expectedRevision: (await notesDoc.get()).data().revision, expectedSchemaRevision: (await projectDoc.get()).data().schemaRevision, label: 'Notes renamed' }) });
    assert.strictEqual(response.status, 200);

    // Metadata and schema commands are Owner-only even when the request has
    // otherwise valid payload and current revision fences. Exercise actual
    // Editor/Viewer members plus a real nonmember administrator, and prove a
    // denial leaves both the target records and audit records untouched.
    await accessService.addOrUpdateMember(ownerIdentity, typed.projectId, 'crm-projects-staff-editor', { role: 'Editor' });
    await accessService.addOrUpdateMember(ownerIdentity, typed.projectId, 'crm-projects-viewer', { role: 'Viewer' });
    const metadataRoles = [
        ['editor', editorToken, 403],
        ['viewer', viewerToken, 403],
        ['admin-nonmember', adminToken, 404]
    ];
    const metadataRoutes = [
        ['project', (state, operationId) => ({
            path: `/api/projects/${typed.projectId}`,
            body: { operationId, expectedRevision: state.project.revision, name: `${operationId} denied` },
            target: 'project'
        })],
        ['section', (state, operationId) => ({
            path: `/api/projects/${typed.projectId}/sections/${typed.sections[0].id}`,
            body: { operationId, expectedRevision: state.section.revision, expectedStructureRevision: state.project.structureRevision, title: `${operationId} denied` },
            target: 'section'
        })],
        ['column', (state, operationId) => ({
            path: `/api/projects/${typed.projectId}/columns/notes`,
            body: { operationId, expectedRevision: state.column.revision, expectedSchemaRevision: state.project.schemaRevision, label: `${operationId} denied` },
            target: 'column'
        })]
    ];
    for (const [roleName, token, expectedStatus] of metadataRoles) {
        for (const [routeName, makeRoute] of metadataRoutes) {
            const operationId = `typed-denied-${roleName}-${routeName}`;
            const before = {
                project: (await projectDoc.get()).data(),
                section: (await sectionDoc.get()).data(),
                column: (await notesDoc.get()).data()
            };
            const route = makeRoute(before, operationId);
            response = await request(server, route.path, token, { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify(route.body) });
            assert.strictEqual(response.status, expectedStatus, `${roleName} ${routeName} metadata/schema denial must be ${expectedStatus}: ${JSON.stringify(response.body)}`);
            assert.strictEqual((await db.collection(PROJECT_OPERATION_COLLECTION).doc(operationId).get()).exists, false, `${operationId} must not persist an operation`);
            assert.strictEqual((await db.collection(PROJECT_EVENT_COLLECTION).doc(operationId).get()).exists, false, `${operationId} must not persist an event`);
            assert.deepStrictEqual((await projectDoc.get()).data(), before.project, `${operationId} must not mutate the project`);
            assert.deepStrictEqual((await sectionDoc.get()).data(), before.section, `${operationId} must not mutate the section`);
            assert.deepStrictEqual((await notesDoc.get()).data(), before.column, `${operationId} must not mutate the column`);
        }
    }
    response = await request(server, `/api/projects/${typed.projectId}/sections/${typed.sections[0].id}`, ownerToken, { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ operationId: 'typed-section-missing-structure', expectedRevision: (await sectionDoc.get()).data().revision, title: 'Missing structure' }) });
    assert.strictEqual(response.status, 200, 'non-structural section edits do not require or advance the structure revision');
    assert.strictEqual(response.body.structureRevision, (await projectDoc.get()).data().structureRevision);
    response = await request(server, `/api/projects/${typed.projectId}/columns/notes`, ownerToken, { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ operationId: 'typed-column-missing-schema', expectedRevision: (await notesDoc.get()).data().revision, label: 'Missing schema' }) });
    assert.strictEqual(response.status, 400);

    const viewerDenied = await request(server, `/api/projects/${typed.projectId}/tasks`, viewerToken);
    assert.strictEqual(viewerDenied.status, 200, 'a Viewer member retains read access');
    const viewerWrite = await request(server, `/api/projects/${typed.projectId}/tasks/${typedTask.id}`, viewerToken, { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ operationId: 'typed-viewer-write', expectedRevision: staleCurrent.revision + 1, title: 'Denied viewer edit' }) });
    assert.strictEqual(viewerWrite.status, 403);
    const editorWrite = await request(server, `/api/projects/${typed.projectId}/tasks/${typedTask.id}`, editorToken, { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ operationId: 'typed-editor-write', expectedRevision: staleCurrent.revision + 1, title: 'Editor edit' }) });
    assert.strictEqual(editorWrite.status, 200, JSON.stringify(editorWrite.body));
    const adminDenied = await request(server, `/api/projects/${typed.projectId}/tasks`, adminToken);
    assert.strictEqual(adminDenied.status, 404, 'an administrator without project membership remains denied');
}

async function runCanonicalPathCollisionMatrix({ db, server, ownerToken, ownerIdentity }) {
    const collisionId = 'phase2-path-collision';
    const projectCreateOperationId = 'path-collision-create-project';
    const taskCreateOperationId = 'path-collision-create-task';
    let response = await request(server, '/api/projects/', ownerToken, {
        method: 'POST', headers: jsonHeaders(),
        body: JSON.stringify({ operationId: projectCreateOperationId, projectId: collisionId, name: 'Path collision project' })
    });
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    const projectPath = `crmProjects/${collisionId}`;
    const memberPath = `crmProjectMembers/${memberDocumentId(collisionId, ownerIdentity.uid)}`;
    const projectOperation = (await db.collection(PROJECT_OPERATION_COLLECTION).doc(projectCreateOperationId).get()).data();
    const projectEvent = (await db.collection(PROJECT_EVENT_COLLECTION).doc(projectCreateOperationId).get()).data();
    for (const record of [projectOperation, projectEvent]) {
        assert.ok(record.affectedPaths.includes(projectPath), 'project create must retain the canonical project path');
        assert.ok(record.affectedPaths.includes(memberPath), 'project create must retain the canonical Owner membership path');
        assert.deepStrictEqual(record.afterRevisions[projectPath], { revision: 1, structureRevision: 0, schemaRevision: 0 }, 'project path must retain project revision dimensions');
        assert.strictEqual(record.afterRevisions[memberPath], 1, 'Owner membership path must retain its scalar revision');
    }

    response = await request(server, `/api/projects/${collisionId}/sections`, ownerToken, {
        method: 'POST', headers: jsonHeaders(),
        body: JSON.stringify({ operationId: 'path-collision-create-section', sectionId: 'path-collision-section', title: 'Path collision section', expectedStructureRevision: 0 })
    });
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    const projectBeforeTask = (await db.collection(PROJECT_COLLECTIONS.projects).doc(collisionId).get()).data();
    await createTask(server, ownerToken, collisionId, {
        operationId: taskCreateOperationId, taskId: collisionId, sectionId: 'path-collision-section',
        ownerUid: null, title: 'Task shares project ID', expectedStructureRevision: projectBeforeTask.structureRevision
    });
    const taskPath = `${projectPath}/tasks/${collisionId}`;
    const expectedProjectAfterTask = {
        revision: projectBeforeTask.revision,
        structureRevision: projectBeforeTask.structureRevision + 1,
        schemaRevision: projectBeforeTask.schemaRevision
    };
    const taskOperation = (await db.collection(PROJECT_OPERATION_COLLECTION).doc(taskCreateOperationId).get()).data();
    const taskEvent = (await db.collection(PROJECT_EVENT_COLLECTION).doc(taskCreateOperationId).get()).data();
    for (const record of [taskOperation, taskEvent]) {
        assert.ok(record.affectedPaths.includes(projectPath), 'task create must retain the canonical project path');
        assert.ok(record.affectedPaths.includes(taskPath), 'task create must retain the canonical task path when IDs collide');
        assert.strictEqual(Object.prototype.hasOwnProperty.call(record.afterRevisions, collisionId), false, 'operation/event revision maps must not collapse to a bare colliding ID');
        assert.deepStrictEqual(record.beforeRevisions[projectPath], {
            revision: projectBeforeTask.revision,
            structureRevision: projectBeforeTask.structureRevision,
            schemaRevision: projectBeforeTask.schemaRevision
        });
        assert.deepStrictEqual(record.afterRevisions[projectPath], expectedProjectAfterTask, 'project path must retain structure revision dimensions');
        assert.strictEqual(record.beforeRevisions[taskPath], null, 'new task path must have a null before revision');
        assert.strictEqual(record.afterRevisions[taskPath], 1, 'task path must retain its scalar revision');
    }
}

async function runQueryAndCursorMatrix({ db, auth, server, ownerToken, viewerToken, ownerIdentity, accessService }) {
    const projectRef = db.collection(PROJECT_COLLECTIONS.projects).doc(PROJECT_ID);
    const sectionRef = projectRef.collection('sections').doc('section-a');
    await projectRef.set({ lifecycle: 'active' }, { merge: true });
    await sectionRef.set({ lifecycle: 'active' }, { merge: true });
    await projectRef.collection('tasks').doc('filter-parent').set({
        projectId: PROJECT_ID, parentTaskId: null, sectionId: 'section-a', title: 'Filter parent', status: 'not_started',
        ownerUid: ownerIdentity.uid, assigneeUids: [], values: {}, lifecycle: 'active', rank: '10000/1', revision: 1, updatedAt: '2026-01-01T00:00:00.000Z'
    });
    await projectRef.collection('tasks').doc('filter-child').set({
        projectId: PROJECT_ID, parentTaskId: 'filter-parent', title: 'Filter child', status: 'done', ownerUid: ownerIdentity.uid,
        assigneeUids: [], values: {}, lifecycle: 'active', rank: '10001/1', revision: 1, updatedAt: '2026-01-01T00:00:00.000Z'
    });
    await projectRef.collection('tasks').doc('filter-grandchild').set({
        projectId: PROJECT_ID, parentTaskId: 'filter-child', title: 'Filter grandchild', status: 'done', ownerUid: ownerIdentity.uid,
        assigneeUids: [], values: {}, lifecycle: 'active', rank: '10002/1', revision: 1, updatedAt: '2026-01-01T00:00:00.000Z'
    });
    let response = await request(server, `/api/projects/${PROJECT_ID}/tasks?title=Filter%20parent&status=not_started&pageSize=20`, ownerToken);
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    assert.strictEqual(response.body.matchingTaskCount, 1);
    assert.strictEqual(response.body.aggregates.activeLeafTaskCount, 0, 'a filtered child must still prevent its parent from counting as a leaf');
    response = await request(server, `/api/projects/${PROJECT_ID}/tasks?parentTaskId=filter-parent&parentScope=direct&pageSize=20`, ownerToken);
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(response.body.tasks.map((task) => task.id), ['filter-child']);
    response = await request(server, `/api/projects/${PROJECT_ID}/tasks?parentTaskId=filter-parent&parentScope=descendants&pageSize=20`, ownerToken);
    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(new Set(response.body.tasks.map((task) => task.id)), new Set(['filter-parent', 'filter-child', 'filter-grandchild']));
    response = await request(server, `/api/projects/${PROJECT_ID}/tasks?parentScope=root&pageSize=200`, ownerToken);
    assert.strictEqual(response.status, 200);
    assert.ok(response.body.tasks.every((task) => !task.parentTaskId), 'root branch filtering must exclude every descendant');

    // Restore the beyond-500 sentinel after the initial cursor mutation check.
    await projectRef.collection('tasks').doc('bulk-649').set({ title: 'Beyond 500 match', updatedAt: '2026-01-01T00:00:00.000Z' }, { merge: true });
    response = await request(server, `/api/projects/${PROJECT_ID}/tasks?title=Beyond%20500&pageSize=1`, ownerToken);
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    assert.strictEqual(response.body.matchingTaskCount, 1);
    assert.strictEqual(response.body.tasks[0].id, 'bulk-649', 'a title match beyond the first 500 records must be returned');

    let cursor = null;
    const allIds = [];
    let matchingTaskCount = null;
    do {
        const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
        response = await request(server, `/api/projects/${PROJECT_ID}/tasks?pageSize=100${suffix}`, ownerToken);
        assert.strictEqual(response.status, 200, JSON.stringify(response.body));
        if (matchingTaskCount === null) matchingTaskCount = response.body.matchingTaskCount;
        assert.strictEqual(response.body.matchingTaskCount, matchingTaskCount);
        allIds.push(...response.body.tasks.map((task) => task.id));
        cursor = response.body.nextCursor;
    } while (cursor);
    assert.strictEqual(new Set(allIds).size, allIds.length, 'cursor walking must not duplicate tasks');
    assert.strictEqual(allIds.length, matchingTaskCount, 'cursor walking must return the complete matching set');

    const cursorStart = await request(server, `/api/projects/${PROJECT_ID}/tasks?pageSize=1`, ownerToken);
    assert.strictEqual(cursorStart.status, 200);
    const savedCursor = cursorStart.body.nextCursor;
    assert.ok(savedCursor);
    response = await request(server, `/api/projects/${PROJECT_ID}/tasks?pageSize=1&cursor=bad`, ownerToken);
    assert.strictEqual(response.status, 400, 'malformed cursors must be rejected');
    response = await request(server, `/api/projects/${PROJECT_ID}/tasks?pageSize=1&title=Filter&cursor=${encodeURIComponent(savedCursor)}`, ownerToken);
    assert.strictEqual(response.status, 400, 'a cursor must be bound to the complete original filter');
    response = await request(server, `/api/projects/${PROJECT_ID}/tasks?pageSize=1&cursor=${encodeURIComponent(savedCursor)}`, viewerToken);
    assert.strictEqual(response.status, 400, 'a cursor must be bound to its creating actor');

    const other = await createProjectWithSections(server, ownerToken, 'phase2-cursor-other', ['other-section']);
    await createTask(server, ownerToken, other.projectId, {
        operationId: 'cursor-other-task', taskId: 'cursor-other-task', sectionId: other.sections[0].id,
        ownerUid: null, title: 'Other cursor task', expectedStructureRevision: other.structureRevision
    });
    response = await request(server, `/api/projects/${other.projectId}/tasks?pageSize=1&cursor=${encodeURIComponent(savedCursor)}`, ownerToken);
    assert.strictEqual(response.status, 400, 'a cursor must be bound to its project and query');
    await db.collection(PROJECT_CURSOR_COLLECTION).doc(savedCursor).set({ expiresAt: '2000-01-01T00:00:00.000Z' }, { merge: true });
    response = await request(server, `/api/projects/${PROJECT_ID}/tasks?pageSize=1&cursor=${encodeURIComponent(savedCursor)}`, ownerToken);
    assert.strictEqual(response.status, 409, 'expired cursors must be rejected');

    const precisionStart = await request(server, `/api/projects/${PROJECT_ID}/tasks?pageSize=1`, ownerToken);
    assert.strictEqual(precisionStart.status, 200);
    const precisionCursor = precisionStart.body.nextCursor;
    const precisionId = precisionStart.body.tasks[0].id;
    const precisionRef = projectRef.collection('tasks').doc(precisionId);
    const beforePrecision = await precisionRef.get();
    await precisionRef.set({ title: `${beforePrecision.data().title} changed`, updatedAt: beforePrecision.data().updatedAt }, { merge: true });
    const afterPrecision = await precisionRef.get();
    const beforeUpdateTime = beforePrecision.updateTime;
    const afterUpdateTime = afterPrecision.updateTime;
    assert.ok(beforeUpdateTime && afterUpdateTime, 'Firestore updateTime must be available for cursor binding');
    assert.ok(String(beforeUpdateTime.nanoseconds ?? beforeUpdateTime._nanoseconds) !== String(afterUpdateTime.nanoseconds ?? afterUpdateTime._nanoseconds)
        || String(beforeUpdateTime.seconds ?? beforeUpdateTime._seconds) !== String(afterUpdateTime.seconds ?? afterUpdateTime._seconds), 'the mutation must change persisted updateTime even within one application millisecond');
    response = await request(server, `/api/projects/${PROJECT_ID}/tasks?pageSize=1&cursor=${encodeURIComponent(precisionCursor)}`, ownerToken);
    assert.strictEqual(response.status, 409, 'full-precision updateTime must invalidate a continuation');

    const lifecycle = await createProjectWithSections(server, ownerToken, 'phase2-lifecycle', ['lifecycle-section']);
    const lifecycleRef = db.collection(PROJECT_COLLECTIONS.projects).doc(lifecycle.projectId);
    const lifecycleTasks = lifecycleRef.collection('tasks');
    await lifecycleTasks.doc('lifecycle-active').set({ projectId: lifecycle.projectId, parentTaskId: null, sectionId: lifecycle.sections[0].id, title: 'Active', status: 'not_started', ownerUid: ownerIdentity.uid, assigneeUids: [], values: {}, lifecycle: 'active', rank: '0/1', revision: 1, updatedAt: '2026-01-01T00:00:00.000Z' });
    await lifecycleTasks.doc('lifecycle-archived').set({ projectId: lifecycle.projectId, parentTaskId: null, sectionId: lifecycle.sections[0].id, title: 'Archived', status: 'not_started', ownerUid: ownerIdentity.uid, assigneeUids: [], values: {}, lifecycle: 'archived', rank: '1/1', revision: 1, updatedAt: '2026-01-01T00:00:00.000Z' });
    await lifecycleTasks.doc('lifecycle-trashed').set({ projectId: lifecycle.projectId, parentTaskId: null, sectionId: lifecycle.sections[0].id, title: 'Trashed', status: 'not_started', ownerUid: ownerIdentity.uid, assigneeUids: [], values: {}, lifecycle: 'trashed', rank: '2/1', revision: 1, updatedAt: '2026-01-01T00:00:00.000Z' });
    response = await request(server, `/api/projects/${lifecycle.projectId}/tasks?lifecycle=archived&pageSize=20`, ownerToken);
    assert.strictEqual(response.status, 200);
    assert.ok(response.body.tasks.some((task) => task.id === 'lifecycle-archived'));
    response = await request(server, `/api/projects/${lifecycle.projectId}/tasks?lifecycle=trashed&pageSize=20`, ownerToken);
    assert.strictEqual(response.status, 200);
    assert.ok(response.body.tasks.some((task) => task.id === 'lifecycle-trashed'));
    await lifecycleRef.collection('sections').doc(lifecycle.sections[0].id).set({ lifecycle: 'archived' }, { merge: true });
    response = await request(server, `/api/projects/${lifecycle.projectId}/tasks?lifecycle=archived&pageSize=20`, ownerToken);
    assert.strictEqual(response.status, 200);
    assert.ok(response.body.tasks.some((task) => task.id === 'lifecycle-active' && task.effectiveLifecycle === 'archived'));
    await lifecycleRef.set({ lifecycle: 'trashed' }, { merge: true });
    response = await request(server, `/api/projects/${lifecycle.projectId}/tasks?lifecycle=trashed&pageSize=20`, ownerToken);
    assert.strictEqual(response.status, 200);
    assert.ok(response.body.tasks.every((task) => task.effectiveLifecycle === 'trashed'), 'trashed project state must dominate archived task/section state');
    await lifecycleTasks.doc('lifecycle-orphan').set({ projectId: lifecycle.projectId, parentTaskId: 'missing-ancestor', title: 'Orphan', status: 'not_started', ownerUid: ownerIdentity.uid, assigneeUids: [], values: {}, lifecycle: 'active', rank: '3/1', revision: 1, updatedAt: '2026-01-01T00:00:00.000Z' });
    response = await request(server, `/api/projects/${lifecycle.projectId}/tasks?lifecycle=trashed&pageSize=20`, ownerToken);
    assert.strictEqual(response.status, 409, 'invalid ancestor references must fail the coherent query');

    const tracker = { taskCollectionReads: 0 };
    const trackingDb = makeTrackingDb(db, tracker);
    const trackingAccess = createProjectsAccessService({ db: trackingDb, auth });
    const trackingServer = await startRouterServer({ db: trackingDb, auth, accessService: trackingAccess });
    try {
        const rootRef = projectRef.collection('tasks').doc('root-task');
        const projectBeforeEdit = (await projectRef.get()).data();
        const taskBeforeEdit = (await rootRef.get()).data();
        response = await request(trackingServer, `/api/projects/${PROJECT_ID}/tasks/root-task`, ownerToken, {
            method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ operationId: 'ordinary-cell-edit-scope', expectedRevision: taskBeforeEdit.revision, title: 'Ordinary scoped edit' })
        });
        assert.strictEqual(response.status, 200, JSON.stringify(response.body));
        assert.strictEqual(tracker.taskCollectionReads, 0, 'ordinary cell edits must not read the entire task collection');
        const projectAfterEdit = (await projectRef.get()).data();
        assert.strictEqual(projectAfterEdit.structureRevision, projectBeforeEdit.structureRevision, 'ordinary cell edits must not increment structureRevision');
        assert.strictEqual(projectAfterEdit.contentRevision || 0, projectBeforeEdit.contentRevision || 0, 'ordinary cell edits must not increment global contentRevision');
    } finally {
        await new Promise((resolve) => trackingServer.close(resolve));
    }

}

async function main() {
    assert.strictEqual(process.env.CRM_PROJECTS_EMULATOR_READY, '1', 'Phase2 persisted checks require the isolated emulator runner.');
    process.env.CRM_PROJECTS_ENABLED = 'true';
    const config = getEmulatorConfig(process.env);
    const app = initializeFixtureApp(config);
    let server;
    try {
        await seedFixtures({ config, app });
        const auth = app.auth();
        const db = app.firestore();
        const accessService = createProjectsAccessService({ db, auth });
        const api = express();
        api.use(express.json());
        api.use('/api/projects', createProjectsRouter({ db, auth, accessService }));
        server = http.createServer(api);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const ownerToken = await signIn('teacher@demo.crm-projects.test');
        const viewerToken = await signIn('viewer@demo.crm-projects.test');
        const adminToken = await signIn('admin@demo.crm-projects.test');
        const ownerIdentity = await accessService.authenticateToken(ownerToken);

        let response = await request(server, '/api/projects/', ownerToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'create-project', projectId: PROJECT_ID, name: 'Phase2 domain' }) });
        assert.strictEqual(response.status, 200, JSON.stringify(response.body));
        assert.strictEqual(response.body.project.id, PROJECT_ID);
        const created = response.body.project;
        response = await request(server, '/api/projects/', ownerToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'create-project', projectId: PROJECT_ID, name: 'Phase2 domain' }) });
        assert.strictEqual(response.status, 200, 'createProject exact retry must return the original result');
        response = await request(server, '/api/projects/', ownerToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'create-project', projectId: PROJECT_ID, name: 'Changed project' }) });
        assert.strictEqual(response.status, 409, 'createProject changed payload must conflict');

        response = await request(server, `/api/projects/${PROJECT_ID}/sections`, ownerToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'create-section', sectionId: 'section-a', title: 'Backlog', expectedStructureRevision: created.structureRevision }) });
        assert.strictEqual(response.status, 200, JSON.stringify(response.body));
        const section = response.body.section;
        response = await request(server, `/api/projects/${PROJECT_ID}/columns`, ownerToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'create-column', columnId: 'priority', type: 'priority', label: 'Priority', expectedSchemaRevision: 0 }) });
        assert.strictEqual(response.status, 200, JSON.stringify(response.body));
        response = await request(server, `/api/projects/${PROJECT_ID}/columns`, ownerToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'reserved-column', columnId: '__proto__', type: 'text', label: 'Reserved', expectedSchemaRevision: 1 }) });
        assert.strictEqual(response.status, 400, 'reserved entity IDs must be rejected before Firestore serialization');
        response = await request(server, `/api/projects/${PROJECT_ID}/columns`, ownerToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'create-notes-column', columnId: 'notes', type: 'text', label: 'Notes', expectedSchemaRevision: 1 }) });
        assert.strictEqual(response.status, 200, JSON.stringify(response.body));
        response = await request(server, `/api/projects/${PROJECT_ID}/tasks`, ownerToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'reserved-value', taskId: 'reserved-value', sectionId: section.id, title: 'Reserved value', values: JSON.parse('{"__proto__":"must reject"}'), expectedStructureRevision: 1 }) });
        assert.strictEqual(response.status, 400, 'reserved value keys must be rejected before Firestore serialization');
        response = await request(server, `/api/projects/${PROJECT_ID}/tasks`, ownerToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'create-task', taskId: 'root-task', sectionId: section.id, title: 'Root', values: { priority: 'high' }, expectedStructureRevision: 1 }) });
        assert.strictEqual(response.status, 200, JSON.stringify(response.body));
        const rootTask = response.body.task;
        response = await request(server, `/api/projects/${PROJECT_ID}/tasks/${rootTask.id}`, ownerToken, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'edit-task', expectedRevision: rootTask.revision, title: 'Root edited' }) });
        assert.strictEqual(response.status, 200, JSON.stringify(response.body));
        const editedTask = response.body.task;
        response = await request(server, `/api/projects/${PROJECT_ID}/tasks/${rootTask.id}/move`, ownerToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'move-task', expectedRevision: editedTask.revision, expectedStructureRevision: 2, sectionId: section.id, index: 0 }) });
        assert.strictEqual(response.status, 200, JSON.stringify(response.body));
        response = await request(server, `/api/projects/${PROJECT_ID}/tasks?pageSize=10`, viewerToken);
        assert.strictEqual(response.status, 404, 'viewer is not an explicit member of the new project');
        await accessService.addOrUpdateMember(ownerIdentity, PROJECT_ID, 'crm-projects-viewer', { role: 'Viewer' });
        await accessService.addOrUpdateMember(ownerIdentity, PROJECT_ID, 'crm-projects-staff-editor', { role: 'Editor' });
        const editorToken = await signIn('staff-editor@demo.crm-projects.test');
        response = await request(server, `/api/projects/${PROJECT_ID}/tasks?pageSize=10`, viewerToken);
        assert.strictEqual(response.status, 200, JSON.stringify(response.body));
        assert.strictEqual(response.body.tasks[0].id, 'root-task');
        assert.strictEqual(response.body.aggregates.activeLeafTaskCount, 1);

        // Exact operation replay returns the original result, while changed
        // payload under the same operation ID conflicts.
        response = await request(server, `/api/projects/${PROJECT_ID}/sections`, ownerToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'create-section', sectionId: 'section-a', title: 'Backlog', expectedStructureRevision: 0 }) });
        assert.strictEqual(response.status, 200);
        response = await request(server, `/api/projects/${PROJECT_ID}/sections`, ownerToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'create-section', sectionId: 'section-a', title: 'Changed', expectedStructureRevision: 1 }) });
        assert.strictEqual(response.status, 409);

        const concurrentTaskBody = { operationId: 'same-op-task', taskId: 'same-op-task', sectionId: section.id, title: 'Concurrent retry', ownerUid: 'crm-projects-staff-editor', expectedStructureRevision: 3 };
        const concurrentResponses = await Promise.all([
            request(server, `/api/projects/${PROJECT_ID}/tasks`, ownerToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(concurrentTaskBody) }),
            request(server, `/api/projects/${PROJECT_ID}/tasks`, ownerToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(concurrentTaskBody) })
        ]);
        assert.deepStrictEqual(concurrentResponses.map((item) => item.status).sort(), [200, 200]);
        assert.strictEqual((await db.collection('crmProjectOperations').doc('same-op-task').get()).exists, true);
        assert.strictEqual((await db.collection('crmProjectEvents').doc('same-op-task').get()).exists, true);
        response = await request(server, `/api/projects/${PROJECT_ID}/tasks`, editorToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...concurrentTaskBody, title: 'Different actor payload' }) });
        assert.strictEqual(response.status, 409, 'same operation ID cannot be reused by another actor or payload');
        await accessService.removeMember(ownerIdentity, PROJECT_ID, 'crm-projects-staff-editor');
        response = await request(server, `/api/projects/${PROJECT_ID}/tasks`, editorToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(concurrentTaskBody) });
        assert.strictEqual(response.status, 404, 'revoked membership must block operation replay');

        // A depth-25 chain remains flat and addressable.
        let parentTaskId = rootTask.id;
        let structureRevision = 4;
        for (let depth = 1; depth <= 25; depth += 1) {
            response = await request(server, `/api/projects/${PROJECT_ID}/tasks`, ownerToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: `depth-${depth}`, taskId: `depth-${depth}`, parentTaskId, title: `Depth ${depth}`, expectedStructureRevision: structureRevision }) });
            assert.strictEqual(response.status, 200, JSON.stringify(response.body));
            parentTaskId = response.body.task.id;
            structureRevision += 1;
        }

        // Cross-project parent references and ancestry cycles are rejected at
        // the transaction boundary.
        response = await request(server, '/api/projects/', ownerToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'second-project', projectId: 'phase2-other-project', name: 'Other' }) });
        assert.strictEqual(response.status, 200);
        response = await request(server, `/api/projects/${PROJECT_ID}/tasks`, ownerToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'foreign-parent', parentTaskId: 'missing-other-project-task', title: 'Bad', expectedStructureRevision: structureRevision }) });
        assert.strictEqual(response.status, 409);
        response = await request(server, `/api/projects/${PROJECT_ID}/tasks/${rootTask.id}/move`, ownerToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'cycle', expectedRevision: editedTask.revision + 1, expectedStructureRevision: structureRevision, parentTaskId: rootTask.id }) });
        assert.strictEqual(response.status, 409);

        const denied = await directClientWrite(`crmProjects/${PROJECT_ID}/tasks/client-write`, viewerToken);
        assert.strictEqual(denied.status, 403);

        // Seed 650 flat records through the Admin SDK, then query/paginate the
        // canonical read model and reject a continuation after mutation.
        let batch = db.batch();
        for (let index = 0; index < 650; index += 1) {
            batch.set(db.collection(PROJECT_COLLECTIONS.projects).doc(PROJECT_ID).collection('tasks').doc(`bulk-${index}`), {
                projectId: PROJECT_ID, parentTaskId: null, sectionId: section.id, title: index === 649 ? 'Beyond 500 match' : `Bulk ${index}`,
                status: index % 2 ? 'done' : 'not_started', ownerUid: ownerIdentity.uid, assigneeUids: [], values: {}, lifecycle: 'active', rank: `${index}/1`, revision: 1, updatedAt: new Date().toISOString()
            });
            if ((index + 1) % 450 === 0) { await batch.commit(); batch = db.batch(); }
        }
        await batch.commit();
        response = await request(server, `/api/projects/${PROJECT_ID}/tasks?pageSize=100`, ownerToken);
        assert.strictEqual(response.status, 200, JSON.stringify(response.body));
        assert.strictEqual(response.body.matchingTaskCount, 677);
        assert.ok(response.body.nextCursor);
        await db.collection(PROJECT_COLLECTIONS.projects).doc(PROJECT_ID).collection('tasks').doc('bulk-649').set({ title: 'Changed after cursor' }, { merge: true });
        response = await request(server, `/api/projects/${PROJECT_ID}/tasks?pageSize=100&cursor=${encodeURIComponent(response.body.nextCursor)}`, ownerToken);
        assert.strictEqual(response.status, 409, 'snapshot cursor must reject a changed full snapshot');

        // Revoked membership cannot be used as a new assignment.
        await accessService.addOrUpdateMember(ownerIdentity, PROJECT_ID, 'crm-projects-staff-editor', { role: 'Editor' });
        await accessService.removeMember(ownerIdentity, PROJECT_ID, 'crm-projects-staff-editor');
        response = await request(server, `/api/projects/${PROJECT_ID}/tasks`, ownerToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'revoked-assignment', sectionId: section.id, ownerUid: 'crm-projects-staff-editor', title: 'Bad assignment', expectedStructureRevision: structureRevision }) });
        assert.strictEqual(response.status, 403);

        response = await request(server, `/api/projects/${PROJECT_ID}/columns/priority/replace`, ownerToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: 'replace-priority', newColumnId: 'priority-v2', type: 'dropdown', label: 'Priority v2', options: [{ key: 'urgent', label: 'Urgent' }], expectedRevision: 1, expectedSchemaRevision: (await db.collection(PROJECT_COLLECTIONS.projects).doc(PROJECT_ID).get()).data().schemaRevision }) });
        assert.strictEqual(response.status, 200, JSON.stringify(response.body));
        response = await request(server, `/api/projects/${PROJECT_ID}/tasks`, ownerToken);
        assert.strictEqual(response.status, 200);
        assert.ok(response.body.tasks.some((task) => task.values && Object.prototype.hasOwnProperty.call(task.values, 'priority')));

        await runHierarchyAndOrderingMatrix({ db, server, ownerToken, ownerIdentity });
        await runReplayAndFenceMatrix({ db, auth, server, ownerToken, editorToken, ownerIdentity, accessService });
        await runTypedValuesAndProtectionMatrix({ db, server, ownerToken, viewerToken, editorToken, adminToken, ownerIdentity, accessService });
        await runCanonicalPathCollisionMatrix({ db, server, ownerToken, ownerIdentity });
        await runQueryAndCursorMatrix({ db, auth, server, ownerToken, viewerToken, ownerIdentity, accessService });

        process.stdout.write('crm projects Phase2 persisted Auth + Firestore canonical domain matrix passed\n');
    } finally {
        if (server) await new Promise((resolve) => server.close(resolve));
        await app.delete();
    }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
