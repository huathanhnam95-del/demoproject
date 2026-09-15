'use strict';

const assert = require('assert');
const {
    bootPhase4,
    request,
    jsonRequest,
    expectStatus,
    responseRecord,
    createDeepFixture,
    createSection,
    snapshotProject,
    retainedContentSnapshot,
    uploadMultipart,
    directFirestoreRequest,
    directStorageRequest,
    UID_BY_ROLE,
    initializeFixtureApp
} = require('./phase4-test-helpers');
const { runAttachmentFaultCases } = require('./phase4-attachment-fault-cases');
const { PROJECT_COLLECTIONS } = require('../../../functions/src/crm/projects/access-service');
const { shardFor } = require('../../../functions/src/crm/projects/change-feed-service');
const { archiveRecords, purgeExpiredRecycleEntries } = require('../../../functions/src/crm/recycle-bin-service');
const { resolveTaskState } = require('../../../functions/src/crm/projects/domain/hierarchy');

function taskRef(context, taskId) {
    return context.db.collection(PROJECT_COLLECTIONS.projects).doc(context.projectId).collection('tasks').doc(taskId);
}

async function taskData(context, taskId) {
    const snapshot = await taskRef(context, taskId).get();
    assert.ok(snapshot.exists, `missing persisted task ${taskId}`);
    return { id: snapshot.id, ...snapshot.data() };
}

function changeHeadSequences(snapshot) {
    return new Map((snapshot.subcollections.changeHeads || []).map(({ id, data }) => [id, data.sequence]));
}

async function main() {
    const context = await bootPhase4({ projectId: 'phase4-persisted-recovery' });
    try {
        // Option B caps persisted ancestry at five levels; retain the deepest
        // valid chain so recovery is tested at the supported boundary.
        const fixture = await createDeepFixture(context, { depth: 5 });
        const ownerToken = await context.token('owner');
        const editorToken = await context.token('editor');
        const viewerToken = await context.token('viewer');
        const unauthorizedToken = await context.token('unauthorized');
        const leaf = fixture.leaf;
        const root = fixture.tasks[0];
        const middle = fixture.tasks[3];

        // Put durable content at multiple depths before any lifecycle operation.
        const messageIds = [];
        for (const [index, task] of [[0, root], [1, middle], [2, leaf]]) {
            const response = await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${task.id}/discussion/messages`, editorToken, 'POST', {
                operationId: `phase4-persisted-message-${index}`,
                messageId: `phase4-persisted-message-${index}`,
                body: `Depth ${index} discussion\nretained across recovery`,
                mentions: [context.uids.viewer]
            });
            const body = expectStatus(response, 200, `message ${index}`);
            messageIds.push(responseRecord(body, 'message'));
        }
        const replyResponse = await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${middle.id}/discussion/messages/${messageIds[1].id}/replies`, ownerToken, 'POST', {
            operationId: 'phase4-persisted-reply', body: 'Retained nested reply'
        });
        expectStatus(replyResponse, 200, 'nested reply');

        // Only the original author may attach bytes. The request carries the exact
        // message revision used for the initial metadata finalization.
        const attachmentBytes = Buffer.from('phase4 immutable bytes\n', 'utf8');
        const attachmentResponse = await uploadMultipart(context, editorToken, leaf.id, messageIds[2].id, {
            operationId: 'phase4-persisted-attachment',
            attachmentId: 'phase4-persisted-attachment',
            expectedMessageRevision: messageIds[2].revision,
            bytes: attachmentBytes,
            filename: '../private-phase4.txt'
        });
        const attachmentBody = expectStatus(attachmentResponse, 200, 'private attachment upload');
        const attachment = responseRecord(attachmentBody, 'attachment');
        assert.strictEqual(attachment.status, 'ready');
        assert.strictEqual(attachment.size, attachmentBytes.length);
        const firstDownload = await request(context.server, `/api/projects/${context.projectId}/tasks/${leaf.id}/discussion/messages/${messageIds[2].id}/attachments/${attachment.id}/download`, ownerToken);
        expectStatus(firstDownload, 200, 'private attachment download');
        assert.deepStrictEqual(firstDownload.bytes, attachmentBytes);
        const directStorageDownload = await directStorageRequest(attachment.objectPath);
        assert.ok([401, 403, 404].includes(directStorageDownload.status), `direct Storage client read must be denied, got ${directStorageDownload.status}`);

        // Same operation + same bytes is an exact replay, while an identity conflict
        // cannot replace the immutable object or metadata.
        const retryResponse = await uploadMultipart(context, editorToken, leaf.id, messageIds[2].id, {
            operationId: 'phase4-persisted-attachment',
            attachmentId: 'phase4-persisted-attachment',
            expectedMessageRevision: messageIds[2].revision,
            bytes: attachmentBytes,
            filename: '../private-phase4.txt'
        });
        assert.deepStrictEqual(retryResponse.body, attachmentResponse.body, 'attachment retry must return the exact committed response.');
        const conflictingBytes = Buffer.from('must not overwrite the committed object', 'utf8');
        const conflictingUpload = await uploadMultipart(context, editorToken, leaf.id, messageIds[2].id, {
            operationId: 'phase4-persisted-attachment-conflict',
            attachmentId: 'phase4-persisted-attachment',
            expectedMessageRevision: messageIds[2].revision,
            bytes: conflictingBytes,
            filename: 'conflict.txt'
        });
        assert.strictEqual(conflictingUpload.status, 409);
        const unchangedDownload = await request(context.server, `/api/projects/${context.projectId}/tasks/${leaf.id}/discussion/messages/${messageIds[2].id}/attachments/${attachment.id}/download`, ownerToken);
        expectStatus(unchangedDownload, 200, 'unchanged attachment after conflict');
        assert.deepStrictEqual(unchangedDownload.bytes, attachmentBytes);

        // A committed upload can be retried with the exact original revision,
        // bytes and metadata after the message advances for another edit.
        const delayedAttachmentBytes = Buffer.from('phase4 delayed finalize bytes\n', 'utf8');
        const delayedAttachmentRequest = {
            operationId: 'phase4-persisted-delayed-attachment',
            attachmentId: 'phase4-persisted-delayed-attachment',
            expectedMessageRevision: messageIds[1].revision,
            bytes: delayedAttachmentBytes,
            filename: 'delayed.txt',
            contentType: 'text/plain'
        };
        const delayedAttachmentResponse = await uploadMultipart(context, editorToken, middle.id, messageIds[1].id, delayedAttachmentRequest);
        expectStatus(delayedAttachmentResponse, 200, 'delayed attachment initial commit');
        const middleEdit = await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${middle.id}/discussion/messages/${messageIds[1].id}`, editorToken, 'PATCH', {
            operationId: 'phase4-persisted-middle-edit-after-attachment',
            expectedRevision: messageIds[1].revision + 1,
            body: 'Retained nested message edited after attachment'
        });
        expectStatus(middleEdit, 200, 'message edit after attachment commit');
        const delayedAttachmentRetry = await uploadMultipart(context, editorToken, middle.id, messageIds[1].id, delayedAttachmentRequest);
        assert.deepStrictEqual(delayedAttachmentRetry.body, delayedAttachmentResponse.body, 'committed attachment retry must remain exact after message revision changes.');

        // Functions-style preconsumed multipart bytes must take the same bounded
        // authorization/finalization path as a normal multipart stream.
        const rawAttachmentBytes = Buffer.from('phase4 rawBody multipart bytes\n', 'utf8');
        const rawAttachmentResponse = await uploadMultipart(context, editorToken, root.id, messageIds[0].id, {
            operationId: 'phase4-persisted-rawbody-attachment',
            attachmentId: 'phase4-persisted-rawbody-attachment',
            expectedMessageRevision: messageIds[0].revision,
            bytes: rawAttachmentBytes,
            rawBody: true
        });
        const rawAttachment = responseRecord(expectStatus(rawAttachmentResponse, 200, 'rawBody attachment upload'), 'attachment');
        const rawDownload = await request(context.server, `/api/projects/${context.projectId}/tasks/${root.id}/discussion/messages/${messageIds[0].id}/attachments/${rawAttachment.id}/download`, ownerToken);
        expectStatus(rawDownload, 200, 'rawBody attachment download');
        assert.deepStrictEqual(rawDownload.bytes, rawAttachmentBytes);
        const malformedType = await uploadMultipart(context, editorToken, root.id, messageIds[0].id, {
            operationId: 'phase4-persisted-attachment-malformed-type',
            bytes: Buffer.from('not an allowed type', 'utf8'),
            contentType: 'application/octet-stream'
        });
        assert.ok([400, 415].includes(malformedType.status));
        const oversize = await uploadMultipart(context, editorToken, root.id, messageIds[0].id, {
            operationId: 'phase4-persisted-attachment-oversize',
            bytes: Buffer.alloc((10 * 1024 * 1024) + 1, 0x61)
        });
        assert.strictEqual(oversize.status, 413);

        // Owner moderation redacts body, mentions, history snapshots and bytes to
        // other members while preserving the original author's inspection rights.
        const hiddenResponse = await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${leaf.id}/discussion/messages/${messageIds[2].id}/moderate`, ownerToken, 'POST', {
            operationId: 'phase4-persisted-hide-message', expectedRevision: messageIds[2].revision + 1, action: 'hide', reason: 'Persisted redaction check'
        });
        const hiddenBody = expectStatus(hiddenResponse, 200, 'hide message');
        assert.strictEqual(responseRecord(hiddenBody, 'message').moderationState, 'hidden');
        const viewerDiscussion = expectStatus(await request(context.server, `/api/projects/${context.projectId}/tasks/${leaf.id}/discussion`, viewerToken), 200, 'viewer hidden message').messages;
        const redacted = viewerDiscussion.find((entry) => entry.id === messageIds[2].id);
        assert.strictEqual(redacted.body, null);
        assert.deepStrictEqual(redacted.mentions, []);
        assert.deepStrictEqual(redacted.attachmentIds, []);
        assert.strictEqual(redacted.redacted, true);
        const viewerHistory = expectStatus(await request(context.server, `/api/projects/${context.projectId}/tasks/${leaf.id}/discussion/messages/${messageIds[2].id}/history`, viewerToken), 200, 'viewer hidden history');
        assert.ok(viewerHistory.history.length > 0);
        assert.ok(viewerHistory.history.every((entry) => entry.snapshot === undefined && entry.body === undefined && entry.mentions === undefined && entry.attachmentIds === undefined));
        const hiddenDownload = await request(context.server, `/api/projects/${context.projectId}/tasks/${leaf.id}/discussion/messages/${messageIds[2].id}/attachments/${attachment.id}/download`, viewerToken);
        assert.ok([403, 404].includes(hiddenDownload.status), `hidden-message bytes must be denied to Viewer: ${hiddenDownload.status}`);
        const authorHiddenDownload = await request(context.server, `/api/projects/${context.projectId}/tasks/${leaf.id}/discussion/messages/${messageIds[2].id}/attachments/${attachment.id}/download`, editorToken);
        expectStatus(authorHiddenDownload, 200, 'original author can inspect own hidden attachment');
        assert.deepStrictEqual(authorHiddenDownload.bytes, attachmentBytes);

        // A foreign message/task cannot claim the existing attachment identity.
        const foreignAttach = await uploadMultipart(context, ownerToken, root.id, messageIds[2].id, {
            operationId: 'phase4-persisted-foreign-attachment',
            attachmentId: 'phase4-foreign-attachment',
            bytes: Buffer.from('foreign', 'utf8')
        });
        assert.ok([400, 404, 409].includes(foreignAttach.status));

        const attachmentFaultReport = await runAttachmentFaultCases(context);
        assert.deepStrictEqual(
            attachmentFaultReport.cases.map((entry) => entry.kind).sort(),
            ['after-save', 'before-save', 'revoke-before-finalize'],
            'attachment fault helper must exercise each approved interruption boundary exactly once.'
        );
        for (const entry of attachmentFaultReport.cases) {
            assert.ok(entry.attachmentId && entry.generation && /^[a-f0-9]{64}$/.test(entry.bytesSha256), 'attachment fault report must retain immutable identity evidence.');
        }

        // Remove the author from current project membership after bytes are ready:
        // the historical assignee and content remain, but current reads/downloads deny.
        const removedMembership = await jsonRequest(context.server, `/api/projects/${context.projectId}/members/${UID_BY_ROLE.editor}`, ownerToken, 'DELETE', {});
        expectStatus(removedMembership, 200, 'remove editor membership');
        assert.ok((await taskData(context, root.id)).assigneeUids.includes(UID_BY_ROLE.editor), 'inactive historical assignee must remain retained on the task.');
        const revokedDownload = await request(context.server, `/api/projects/${context.projectId}/tasks/${leaf.id}/discussion/messages/${messageIds[2].id}/attachments/${attachment.id}/download`, editorToken);
        assert.ok([401, 403, 404].includes(revokedDownload.status));
        const nonMemberDownload = await request(context.server, `/api/projects/${context.projectId}/tasks/${leaf.id}/discussion/messages/${messageIds[2].id}/attachments/${attachment.id}/download`, unauthorizedToken);
        assert.ok([401, 403, 404].includes(nonMemberDownload.status));

        // Pre-existing child lifecycle is retained when its parent/project recovers.
        const middleBeforeArchive = await taskData(context, middle.id);
        const structureBeforeChildArchive = (await context.db.collection(PROJECT_COLLECTIONS.projects).doc(context.projectId).get()).data().structureRevision;
        const archiveChild = await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${middle.id}/archive`, ownerToken, 'POST', {
            operationId: 'phase4-persisted-child-archive', expectedRevision: middleBeforeArchive.revision,
            expectedStructureRevision: structureBeforeChildArchive
        });
        expectStatus(archiveChild, 200, 'archive child before parent');
        const sectionCreateProject = (await context.db.collection(PROJECT_COLLECTIONS.projects).doc(context.projectId).get()).data();
        const standaloneSectionResponse = await jsonRequest(context.server, `/api/projects/${context.projectId}/sections`, ownerToken, 'POST', {
            operationId: 'phase4-persisted-standalone-section-create',
            sectionId: 'phase4-persisted-standalone-section',
            title: 'Retained archived section',
            expectedStructureRevision: sectionCreateProject.structureRevision
        });
        const standaloneSection = responseRecord(expectStatus(standaloneSectionResponse, 200, 'standalone section create'), 'section');
        const sectionBeforeArchive = (await context.db.collection(PROJECT_COLLECTIONS.projects).doc(context.projectId).collection('sections').doc(standaloneSection.id).get()).data();
        const structureBeforeSectionArchive = (await context.db.collection(PROJECT_COLLECTIONS.projects).doc(context.projectId).get()).data().structureRevision;
        const archiveSection = await jsonRequest(context.server, `/api/projects/${context.projectId}/sections/${standaloneSection.id}/archive`, ownerToken, 'POST', {
            operationId: 'phase4-persisted-standalone-section-archive',
            expectedRevision: sectionBeforeArchive.revision,
            expectedStructureRevision: structureBeforeSectionArchive
        });
        expectStatus(archiveSection, 200, 'archive standalone section before parent');
        const baseline = await snapshotProject(context, { includeOperations: false });
        const baselineRetained = retainedContentSnapshot(baseline);
        const baselineHeads = changeHeadSequences(baseline);
        const archiveHeadId = String(shardFor('phase4-persisted-project-archive'));
        const restoreHeadId = String(shardFor('phase4-persisted-project-restore'));
        for (const [headId, sequence] of baselineHeads) {
            assert.ok(Number.isSafeInteger(sequence) && sequence >= 0, `baseline change head ${headId} must have a non-negative safe-integer sequence.`);
        }
        const baselineArchiveSequence = baselineHeads.get(archiveHeadId) ?? 0;
        const baselineRestoreSequence = baselineHeads.get(restoreHeadId) ?? 0;
        const projectSnapshot = await context.db.collection(PROJECT_COLLECTIONS.projects).doc(context.projectId).get();
        const projectData = projectSnapshot.data();
        const archiveProject = await jsonRequest(context.server, `/api/projects/${context.projectId}/archive`, ownerToken, 'POST', {
            operationId: 'phase4-persisted-project-archive', expectedRevision: projectData.revision,
            expectedStructureRevision: projectData.structureRevision
        });
        expectStatus(archiveProject, 200, 'archive project subtree');
        const archived = await snapshotProject(context, { includeOperations: false });
        const archivedHeads = changeHeadSequences(archived);
        const expectedArchivedHeads = new Map(baselineHeads);
        expectedArchivedHeads.set(archiveHeadId, baselineArchiveSequence + 1);
        assert.deepStrictEqual(archivedHeads, expectedArchivedHeads, 'successful project archive must advance only its exact feed head by one.');
        assert.strictEqual(archived.project.data.lifecycle, 'archived', 'project archive must persist an archived lifecycle.');
        const archivedTasks = new Map(archived.subcollections.tasks.map((row) => [row.id, row]));
        const archivedSections = new Map((archived.subcollections.sections || []).map((row) => [row.id, row]));
        for (const row of archived.subcollections.tasks) {
            assert.strictEqual(resolveTaskState({ tasks: archivedTasks, taskId: row.id, projectLifecycle: archived.project.data.lifecycle, sections: archivedSections }).lifecycle, 'archived', `effective lifecycle for ${row.id} must be archived.`);
        }

        // Editor cannot restore an unavailable ancestor or enqueue Owner-only chain changes.
        const viewerRestore = await jsonRequest(context.server, `/api/projects/${context.projectId}/restore`, viewerToken, 'POST', {
            operationId: 'phase4-persisted-editor-restore-chain', expectedRevision: projectData.revision + 1,
            expectedStructureRevision: projectData.structureRevision + 1, restoreChain: true
        });
        assert.strictEqual(viewerRestore.status, 403);
        const afterDeniedRestore = await snapshotProject(context, { includeOperations: false });
        const afterDeniedRestoreHeads = changeHeadSequences(afterDeniedRestore);
        assert.deepStrictEqual(afterDeniedRestoreHeads, archivedHeads, 'denied restore must not advance any feed head.');
        const restoreProject = await jsonRequest(context.server, `/api/projects/${context.projectId}/restore`, ownerToken, 'POST', {
            operationId: 'phase4-persisted-project-restore', expectedRevision: projectData.revision + 1,
            expectedStructureRevision: projectData.structureRevision + 1, restoreChain: true
        });
        expectStatus(restoreProject, 200, 'restore project subtree');

        // Reload through a new Admin SDK app boundary and compare every retained
        // project record, custom value, discussion/history row and attachment metadata.
        const reloadedApp = initializeFixtureApp(context.config);
        const reloadedContext = { ...context, app: reloadedApp, db: reloadedApp.firestore() };
        const restored = await snapshotProject(reloadedContext, { includeOperations: false });
        await reloadedApp.delete();
        const restoredHeads = changeHeadSequences(restored);
        const archivedRestoreSequence = archivedHeads.get(restoreHeadId) ?? 0;
        const expectedArchivedRestoreSequence = restoreHeadId === archiveHeadId
            ? baselineRestoreSequence + 1
            : baselineRestoreSequence;
        assert.strictEqual(archivedRestoreSequence, expectedArchivedRestoreSequence, 'archive must advance the restore head only when both operations share a shard.');
        const expectedRestoredHeads = new Map(afterDeniedRestoreHeads);
        expectedRestoredHeads.set(restoreHeadId, archivedRestoreSequence + 1);
        assert.deepStrictEqual(restoredHeads, expectedRestoredHeads, 'successful project restore must advance only its exact feed head by one.');
        assert.deepStrictEqual(retainedContentSnapshot(restored), baselineRetained, 'recovery must retain all persisted content across reload-equivalent reads.');
        const restoredProject = await context.db.collection(PROJECT_COLLECTIONS.projects).doc(context.projectId).get();
        assert.strictEqual(restoredProject.data().lifecycle, 'active');
        assert.strictEqual((await taskData(context, middle.id)).lifecycle, 'archived', 'pre-existing child Archive must survive parent restore.');
        assert.ok((await taskData(context, root.id)).assigneeUids.includes(UID_BY_ROLE.editor), 'restore must preserve an inactive historical assignee without granting access.');
        for (const task of fixture.tasks.filter((entry) => entry.id !== middle.id)) {
            assert.strictEqual((await taskData(context, task.id)).lifecycle, 'active');
        }
        const afterRestoreDownload = await request(context.server, `/api/projects/${context.projectId}/tasks/${leaf.id}/discussion/messages/${messageIds[2].id}/attachments/${attachment.id}/download`, ownerToken);
        expectStatus(afterRestoreDownload, 200, 'attachment after restore');
        assert.deepStrictEqual(afterRestoreDownload.bytes, attachmentBytes);

        // Firestore rules and the application API both deny direct client protected-data writes.
        const directRead = await directFirestoreRequest(`crmProjects/${context.projectId}`, viewerToken);
        assert.ok([401, 403, 404].includes(directRead.status), `direct Firestore project read must be denied, got ${directRead.status}`);
        const directWrite = await directFirestoreRequest(`crmProjects/${context.projectId}`, viewerToken, 'PATCH', {
            fields: { name: { stringValue: 'client-forged-project' } }
        });
        assert.ok([401, 403, 404].includes(directWrite.status), `direct Firestore project write must be denied, got ${directWrite.status}`);
        assert.notStrictEqual((await context.db.collection(PROJECT_COLLECTIONS.projects).doc(context.projectId).get()).data().name, 'client-forged-project');

        // The legacy purge command removes only expired crmRecycleBin data. It must
        // leave project records, descendants and private bytes untouched.
        const legacyLeadId = 'phase4-expired-legacy-lead';
        await context.db.collection('crmLeads').doc(legacyLeadId).set({
            crmId: legacyLeadId, name: 'Expired legacy fixture', email: 'phase4-legacy@example.test', status: 'new'
        });
        const archivedLegacy = await archiveRecords(context.db, 'leads', [legacyLeadId], {
            now: new Date('2026-01-01T00:00:00.000Z'),
            sourcePanel: 'enquiry',
            user: { uid: UID_BY_ROLE.owner, email: 'teacher@demo.crm-projects.test' }
        });
        assert.strictEqual(archivedLegacy.recycleIds.length, 1);
        const legacyId = archivedLegacy.recycleIds[0];
        const purge = await purgeExpiredRecycleEntries(context.db, { now: new Date('2026-09-07T00:00:00.000Z') });
        assert.ok(purge.purgedIds.includes(legacyId));
        assert.strictEqual((await context.db.collection('crmRecycleBin').doc(legacyId).get()).exists, false);
        assert.strictEqual((await context.db.collection('crmLeads').doc(legacyLeadId).get()).exists, false);
        const afterPurge = await snapshotProject(context, { includeOperations: false });
        const afterPurgeHeads = changeHeadSequences(afterPurge);
        assert.deepStrictEqual(afterPurgeHeads, restoredHeads, 'legacy purge must leave all project feed heads unchanged.');
        assert.deepStrictEqual(retainedContentSnapshot(afterPurge), retainedContentSnapshot(restored), 'legacy purge must not remove project data or attachment metadata.');
        const postPurgeDownload = await request(context.server, `/api/projects/${context.projectId}/tasks/${leaf.id}/discussion/messages/${messageIds[2].id}/attachments/${attachment.id}/download`, ownerToken);
        expectStatus(postPurgeDownload, 200, 'attachment after legacy purge');
        assert.deepStrictEqual(postPurgeDownload.bytes, attachmentBytes);

        // An unavailable task ancestor requires an explicit restore-chain fence
        // for each canonical ancestor path. Missing ancestry evidence is a
        // client error; the complete path restores only the requested chain.
        const leafBeforeChainRestore = await taskData(context, leaf.id);
        const middleBeforeChainRestore = await taskData(context, middle.id);
        const projectBeforeChainRestore = (await context.db.collection(PROJECT_COLLECTIONS.projects).doc(context.projectId).get()).data();
        const missingAncestorFence = await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${leaf.id}/restore`, ownerToken, 'POST', {
            operationId: 'phase4-persisted-missing-ancestor-fence',
            expectedRevision: leafBeforeChainRestore.revision,
            expectedStructureRevision: projectBeforeChainRestore.structureRevision,
            restoreChain: true
        });
        assert.strictEqual(missingAncestorFence.status, 400);
        const validChainRestore = await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${leaf.id}/restore`, ownerToken, 'POST', {
            operationId: 'phase4-persisted-valid-ancestor-fence',
            expectedRevision: leafBeforeChainRestore.revision,
            expectedStructureRevision: projectBeforeChainRestore.structureRevision,
            restoreChain: true,
            expectedAncestorRevisions: {
                [`crmProjects/${context.projectId}/tasks/${middle.id}`]: middleBeforeChainRestore.revision
            }
        });
        expectStatus(validChainRestore, 200, 'valid task restore-chain fence');
        assert.strictEqual((await taskData(context, middle.id)).lifecycle, 'active');

        const destinationProjectBeforeCreate = (await context.db.collection(PROJECT_COLLECTIONS.projects).doc(context.projectId).get()).data();
        const destinationSection = await createSection(context, 'phase4-persisted-active-destination', 'Active restore destination', destinationProjectBeforeCreate.structureRevision);
        const middleBeforeDestinationArchive = await taskData(context, middle.id);
        const destinationArchiveProject = (await context.db.collection(PROJECT_COLLECTIONS.projects).doc(context.projectId).get()).data();
        expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${middle.id}/archive`, ownerToken, 'POST', {
            operationId: 'phase4-persisted-middle-archive-for-destination',
            expectedRevision: middleBeforeDestinationArchive.revision,
            expectedStructureRevision: destinationArchiveProject.structureRevision
        }), 200, 'archive ancestor before explicit destination restore');
        const leafBeforeDestinationRestore = await taskData(context, leaf.id);
        const destinationRestoreProject = (await context.db.collection(PROJECT_COLLECTIONS.projects).doc(context.projectId).get()).data();
        expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${leaf.id}/restore`, ownerToken, 'POST', {
            operationId: 'phase4-persisted-explicit-active-destination',
            expectedRevision: leafBeforeDestinationRestore.revision,
            expectedStructureRevision: destinationRestoreProject.structureRevision,
            destinationSectionId: destinationSection.id
        }), 200, 'restore task to explicit active destination');
        const destinationLeaf = await taskData(context, leaf.id);
        assert.strictEqual(destinationLeaf.parentTaskId, null);
        assert.strictEqual(destinationLeaf.sectionId, destinationSection.id);
        assert.strictEqual(destinationLeaf.lifecycle, 'active');
        assert.strictEqual((await taskData(context, middle.id)).lifecycle, 'archived', 'explicit destination restore must preserve the unavailable ancestor.');

        // A stale token remains denied after the workforce account is suspended,
        // even though its project membership row still exists historically.
        await context.db.collection('crmWorkforceAccounts').doc(UID_BY_ROLE.owner).set({ status: 'suspended', revision: 2 }, { merge: true });
        const suspendedRead = await request(context.server, `/api/projects/${context.projectId}/tasks/${leaf.id}/discussion`, ownerToken);
        assert.ok([401, 403, 404].includes(suspendedRead.status));
        process.stdout.write('crm projects Phase4 persisted recovery and private byte contract passed\n');
    } finally {
        await context.close();
    }
}

main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
