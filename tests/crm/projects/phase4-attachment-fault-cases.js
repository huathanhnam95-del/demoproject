'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { createProjectsAccessService, PROJECT_COLLECTIONS, memberDocumentId } = require('../../../functions/src/crm/projects/access-service');
const { createProjectsCommandService } = require('../../../functions/src/crm/projects/domain/command-service');
const { projectCollection } = require('../../../functions/src/crm/projects/domain/storage');
const { createProjectsAttachmentService, objectPath } = require('../../../functions/src/crm/projects/attachment-service');
const { createTask, jsonRequest, request, expectStatus, directStorageRequest, readAllMessages } = require('./phase4-test-helpers');

// Run with an existing active project and Editor fixture, before the parent
// suite suspends users. Only this helper's object paths receive Storage faults.
async function runAttachmentFaultCases(context) {
    const { db, auth, bucket, projectId, uids, server } = context;
    const prefix = `p4-fault-${crypto.randomUUID()}`;
    const taskId = `${prefix}-task`;
    const sections = await projectCollection(db, projectId, 'sections').where('lifecycle', '==', 'active').limit(1).get();
    assert.strictEqual(sections.size, 1, 'Fault cases require an existing active fixture section.');
    await createTask(context, taskId, { sectionId: sections.docs[0].id });
    const editorToken = await context.token('editor');
    const ownerToken = await context.token('owner');
    const accessService = createProjectsAccessService({ db, auth });
    const commandService = createProjectsCommandService({ db, accessService });
    const memberRef = db.collection(PROJECT_COLLECTIONS.members).doc(memberDocumentId(projectId, uids.editor));
    const memberSnapshot = await memberRef.get();
    assert.ok(memberSnapshot.exists, 'Fault cases require an active Editor membership.');
    const results = [];

    for (const kind of ['before-save', 'after-save', 'revoke-before-finalize']) {
        const messageId = `${prefix}-${kind}`;
        const attachmentId = `${messageId}-file`;
        expectStatus(await jsonRequest(server, `/api/projects/${projectId}/tasks/${taskId}/discussion/messages`, editorToken, 'POST', {
            operationId: `${messageId}-create`, messageId, body: `Attachment fault: ${kind}`
        }), 200, `${kind}: create own message`);
        const messageRef = projectCollection(db, projectId, 'discussions').doc(messageId);
        const attachmentRef = projectCollection(db, projectId, 'attachments').doc(attachmentId);
        const initial = (await messageRef.get()).data();
        assert.strictEqual(initial.revision, 1);
        assert.deepStrictEqual(initial.attachmentIds, []);
        const bytes = Buffer.from(`Private attachment fault fixture ${messageId}\n`, 'utf8');
        const hash = crypto.createHash('sha256').update(bytes).digest('hex');
        const path = objectPath(projectId, taskId, attachmentId);
        const realObject = bucket.file(path);
        const payload = { operationId: `${messageId}-upload`, attachmentId, expectedMessageRevision: initial.revision };
        const file = { buffer: bytes, mimetype: 'text/plain', originalname: `${kind}.txt` };
        const injected = new Error(`Injected ${kind} interruption`);
        let saveCalls = 0;
        let realSaves = 0;
        let fingerprintFailures = 0;
        let revoked = false;
        const wrappedObject = {
            exists: (...args) => realObject.exists(...args),
            download: (...args) => realObject.download(...args),
            async getMetadata(...args) {
                // A save-then-throw alone is recovered internally. Interrupt
                // its recovery fingerprint read to leave actual stored bytes
                // and a pending reservation before finalization is entered.
                if (kind === 'after-save' && fingerprintFailures === 0) {
                    fingerprintFailures += 1;
                    throw injected;
                }
                return realObject.getMetadata(...args);
            },
            async save(...args) {
                saveCalls += 1;
                assert.strictEqual((await attachmentRef.get()).data().status, 'pending', 'Reservation precedes Storage write.');
                if (kind === 'before-save' && saveCalls === 1) throw injected;
                await realObject.save(...args);
                realSaves += 1;
                if (kind === 'after-save' && saveCalls === 1) throw injected;
                if (kind === 'revoke-before-finalize') {
                    await memberRef.delete();
                    revoked = true;
                }
            }
        };
        const service = createProjectsAttachmentService({
            db, accessService, commandService,
            getStorageBucket: async () => ({ file: (requestedPath) => requestedPath === path ? wrappedObject : bucket.file(requestedPath) })
        });
        const upload = () => service.uploadAttachment({ uid: uids.editor }, projectId, taskId, messageId, file, payload);
        const downloadPath = `/api/projects/${projectId}/tasks/${taskId}/discussion/messages/${messageId}/attachments/${attachmentId}/download`;
        try {
            await assert.rejects(upload, (error) => kind === 'revoke-before-finalize'
                ? error.code === 'PROJECT_NOT_FOUND'
                : error === injected);
            const pending = (await attachmentRef.get()).data();
            assert.strictEqual(pending.status, 'pending');
            assert.strictEqual(pending.revision, 1);
            assert.strictEqual(pending.bytesSha256, hash);
            assert.strictEqual(pending.operationId, payload.operationId);
            assert.strictEqual(pending.expectedMessageRevision, initial.revision);
            assert.strictEqual(pending.readyAt, undefined);
            assert.deepStrictEqual((await messageRef.get()).data(), initial, 'Interrupted upload must not change message.');
            const listed = (await readAllMessages(context, ownerToken, taskId)).find((row) => row.id === messageId);
            assert.ok(listed);
            assert.deepStrictEqual(listed.attachmentIds, []);
            expectStatus(await request(server, downloadPath, ownerToken), 404, 'Pending file unavailable even to owner');
            const [exists] = await realObject.exists();
            assert.strictEqual(exists, kind !== 'before-save');
            let generation;
            if (exists) {
                assert.deepStrictEqual((await realObject.download())[0], bytes);
                generation = String((await realObject.getMetadata())[0].generation);
                assert.ok(generation && generation !== 'undefined');
                for (const token of [undefined, editorToken, ownerToken]) {
                    const response = await directStorageRequest(path, token);
                    assert.strictEqual(response.status, 403, 'Firebase Rules must deny direct private bytes.');
                    await response.arrayBuffer();
                }
            }
            if (kind === 'revoke-before-finalize') {
                assert.strictEqual(revoked, true);
                assert.strictEqual((await memberRef.get()).exists, false);
                expectStatus(await request(server, downloadPath, editorToken), 404, 'Removed member cannot download pending file');
                await memberRef.set(memberSnapshot.data());
                revoked = false;
            }
            await upload();
            const ready = (await attachmentRef.get()).data();
            assert.strictEqual(ready.status, 'ready');
            assert.strictEqual(ready.revision, 2);
            assert.strictEqual(ready.bytesSha256, hash);
            assert.strictEqual(ready.operationId, payload.operationId);
            const message = (await messageRef.get()).data();
            assert.strictEqual(message.revision, initial.revision + 1);
            assert.deepStrictEqual(message.attachmentIds, [attachmentId]);
            assert.deepStrictEqual((await realObject.download())[0], bytes);
            const metadata = (await realObject.getMetadata())[0];
            assert.strictEqual(metadata.metadata.bytesSha256, hash);
            if (generation) assert.strictEqual(String(metadata.generation), generation, 'Retry must retain original object generation.');
            generation = String(metadata.generation);
            await upload();
            assert.deepStrictEqual((await attachmentRef.get()).data(), ready, 'Ready retry must not rewrite attachment.');
            assert.deepStrictEqual((await messageRef.get()).data(), message, 'Ready retry must not advance message twice.');
            assert.strictEqual(String((await realObject.getMetadata())[0].generation), generation);
            assert.strictEqual(realSaves, 1);
            assert.strictEqual(saveCalls, kind === 'before-save' ? 2 : 1);
            if (kind === 'after-save') assert.strictEqual(fingerprintFailures, 1);
            const downloaded = await request(server, downloadPath, editorToken);
            expectStatus(downloaded, 200, 'Exact retry made authorized download available');
            assert.deepStrictEqual(downloaded.bytes, bytes);
            results.push({ kind, attachmentId, generation, bytesSha256: hash });
        } finally {
            if (revoked) await memberRef.set(memberSnapshot.data());
        }
    }
    return { taskId, cases: results };
}

module.exports = { runAttachmentFaultCases };
