'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');
const createProjectsRouter = require('../../../functions/src/routes/crm/projects');
const { createProjectsAccessService, PROJECT_COLLECTIONS, memberDocumentId } = require('../../../functions/src/crm/projects/access-service');
const { PROJECT_OPERATION_COLLECTION, PROJECT_EVENT_COLLECTION } = require('../../../functions/src/crm/projects/domain/storage');
const { bootPhase5, task, jsonRequest, expectStatus, caseRun, finish } = require('./phase5-test-helpers');

function closed() { return Object.assign(new Error('3 INVALID_ARGUMENT: Transaction is invalid or closed.'), { code: 3, details: 'Transaction is invalid or closed.' }); }

// Faults surround real emulator transactions. No task/operation/event writes are
// mocked, and no HTTP parameter can enable these faults in the product router.
async function faultServer(context, { stage, afterFailure = async () => {}, repeat = false }) {
    let calls = 0;
    const faultDb = {
        collection: (...args) => context.db.collection(...args),
        async runTransaction(callback, options) {
            const inject = ++calls === 1 || repeat;
            if (!inject) return context.db.runTransaction(callback, options);
            if (stage === 'after-commit') {
                await context.db.runTransaction(callback, options);
            } else if (stage === 'after-callback') {
                let staged = false;
                try {
                    await context.db.runTransaction(async transaction => { await callback(transaction); staged = true; throw closed(); }, options);
                    assert.fail('faulted transaction unexpectedly committed');
                } catch (error) {
                    if (!staged || error.code !== 3 || error.details !== 'Transaction is invalid or closed.') throw error;
                }
            }
            await afterFailure(calls);
            throw closed();
        }
    };
    const api = express(); api.use(express.json());
    api.use('/api/projects', createProjectsRouter({ db: faultDb, auth: context.auth, accessService: createProjectsAccessService({ db: faultDb, auth: context.auth }) }));
    const server = http.createServer(api);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { server, calls: () => calls, close: () => new Promise(resolve => server.close(resolve)) };
}

async function effectRecords(context, operationId, taskId) {
    const [operation, event, taskSnapshot] = await Promise.all([
        context.db.collection(PROJECT_OPERATION_COLLECTION).doc(operationId).get(),
        context.db.collection(PROJECT_EVENT_COLLECTION).doc(operationId).get(),
        context.taskRef(taskId).get()
    ]);
    return { operation, event, task: taskSnapshot };
}

async function main() {
    const c = await bootPhase5('phase5-transaction-retry'); const results = [];
    const ownerToken = await c.token('owner');
    async function createWithFault(name, faultOptions, status, verify) {
        const beforeProject = await c.revision();
        const payload = { operationId: `retry-${name}`, taskId: `task-${name}`, sectionId: 's1', title: `Retry ${name}`, expectedStructureRevision: beforeProject.structureRevision };
        const fault = await faultServer(c, faultOptions);
        try {
            const response = await jsonRequest(fault.server, `/api/projects/${c.projectId}/tasks`, ownerToken, 'POST', payload);
            expectStatus(response, status, name);
            assert.equal(fault.calls(), 2, `${name}: exactly two fresh outer attempts`);
            await verify({ payload, response, beforeProject, records: await effectRecords(c, payload.operationId, payload.taskId) });
        } finally { await fault.close(); }
    }
    async function assertOne({ payload, response, beforeProject, records }) {
        assert.equal(records.task.exists, true); assert.equal(records.task.data().revision, 1);
        assert.equal(records.operation.exists, true); assert.equal(records.event.exists, true);
        assert.equal(records.operation.data().actorUid, c.uids.owner);
        assert.equal(records.operation.data().operationId, payload.operationId);
        assert.equal(records.event.data().operationId, payload.operationId);
        assert.deepEqual(response.body.task, records.operation.data().result.task);
        assert.equal((await c.revision()).structureRevision, beforeProject.structureRevision + 1);
        for (const collection of [PROJECT_OPERATION_COLLECTION, PROJECT_EVENT_COLLECTION]) {
            const rows = await c.db.collection(collection).where('operationId', '==', payload.operationId).get();
            assert.equal(rows.size, 1);
        }
    }
    try {
        await caseRun('closed transaction before callback retries one canonical effect', () => createWithFault('before', { stage: 'before-callback' }, 200, assertOne), results);
        await caseRun('staged writes rollback before fresh transaction commits once', () => createWithFault('rollback', { stage: 'after-callback' }, 200, assertOne), results);
        await caseRun('unknown acknowledgement after real commit replays one immutable effect', () => createWithFault('committed', { stage: 'after-commit' }, 200, assertOne), results);
        await caseRun('revocation after real commit denies retry before immutable operation replay', async () => {
            const memberRef = c.db.collection(PROJECT_COLLECTIONS.members).doc(memberDocumentId(c.projectId, c.uids.owner));
            const memberBefore = (await memberRef.get()).data();
            try {
                await createWithFault('revoked', { stage: 'after-commit', afterFailure: () => memberRef.update({ active: false }) }, 404, async ({ beforeProject, records }) => {
                    assert.equal(records.task.exists, true); assert.equal(records.task.data().revision, 1);
                    assert.equal(records.operation.exists, true); assert.equal(records.event.exists, true);
                    assert.equal((await c.revision()).structureRevision, beforeProject.structureRevision + 1);
                });
            } finally { await memberRef.set(memberBefore); }
        }, results);
        await caseRun('fresh retry preserves structural precondition after concurrent canonical change', async () => {
            await createWithFault('structure', { stage: 'after-callback', afterFailure: () => task(c, 'concurrent-structure-change') }, 409, async ({ response, beforeProject, records }) => {
                assert.equal(response.body.error, 'STALE_STRUCTURE_REVISION');
                assert.equal(records.task.exists, false); assert.equal(records.operation.exists, false); assert.equal(records.event.exists, false);
                assert.equal((await c.revision()).structureRevision, beforeProject.structureRevision + 1);
                assert.equal((await c.data('concurrent-structure-change')).revision, 1);
            });
        }, results);
        await caseRun('two closed transaction failures fail without leaking staged result or writes', () => createWithFault('exhausted', { stage: 'after-callback', repeat: true }, 500, async ({ response, beforeProject, records }) => {
            assert.equal(response.body.success, false); assert.equal(response.body.task, undefined);
            assert.equal(records.task.exists, false); assert.equal(records.operation.exists, false); assert.equal(records.event.exists, false);
            assert.deepEqual(await c.revision(), beforeProject);
        }), results);
    } finally { await c.close(); }
    finish(results);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
