'use strict';

const assert = require('assert');
const {
    bootPhase4,
    request,
    jsonRequest,
    expectStatus,
    responseRecord,
    createDeepFixture,
    createProject,
    clearProject,
    createSection,
    createTask,
    readAllMessages
} = require('./phase4-test-helpers');

async function main() {
    const context = await bootPhase4({ projectId: 'phase4-api-contract' });
    try {
        // Option B caps persisted ancestry at five levels; this fixture exercises
        // the deepest valid discussion target rather than an invalid sixth level.
        const fixture = await createDeepFixture(context, { depth: 5 });
        const ownerToken = await context.token('owner');
        const editorToken = await context.token('editor');
        const viewerToken = await context.token('viewer');
        const unauthorizedToken = await context.token('unauthorized');
        const task = fixture.leaf;
        const foreignTask = await createTask(context, 'phase4-foreign-task', { sectionId: fixture.section.id });

        // All-depth discussion target, multiline body and explicit member mention.
        let body = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${task.id}/discussion/messages`, editorToken, 'POST', {
            operationId: 'phase4-api-message-one',
            messageId: 'phase4-api-message-one',
            body: 'First line\nSecond line\r\nThird line',
            mentions: [context.uids.viewer]
        }), 200, 'create all-depth message');
        const message = responseRecord(body, 'message');
        assert.strictEqual(message.taskId, task.id);
        assert.deepStrictEqual(message.mentions, [context.uids.viewer]);
        const largeBody = `valid-20k-boundary-${'x'.repeat(12000)}`;
        const largeMessageBody = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${task.id}/discussion/messages`, editorToken, 'POST', {
            operationId: 'phase4-api-large-message',
            messageId: 'phase4-api-large-message',
            body: largeBody
        }), 200, 'valid message above legacy 10kb parser limit');
        const largeMessage = responseRecord(largeMessageBody, 'message');
        assert.strictEqual(largeMessage.body, largeBody);
        const overMessageLimit = await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${task.id}/discussion/messages`, editorToken, 'POST', {
            operationId: 'phase4-api-over-message-limit', body: 'y'.repeat(20001)
        });
        assert.ok([400, 413].includes(overMessageLimit.status));

        // Replies are task-bound: the same stable message cannot be replayed under another task.
        body = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${task.id}/discussion/messages/${message.id}/replies`, ownerToken, 'POST', {
            operationId: 'phase4-api-reply-one',
            body: 'Owner reply'
        }), 200, 'create reply');
        const reply = responseRecord(body, 'message');
        assert.strictEqual(reply.parentMessageId, message.id);
        const foreignReply = await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${foreignTask.id}/discussion/messages/${message.id}/replies`, ownerToken, 'POST', {
            operationId: 'phase4-api-foreign-reply',
            body: 'Must not cross task boundaries'
        });
        assert.ok([400, 404, 409].includes(foreignReply.status), `foreign reply must be rejected: ${JSON.stringify(foreignReply.body)}`);

        const foreignMention = await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${task.id}/discussion/messages`, editorToken, 'POST', {
            operationId: 'phase4-api-foreign-mention',
            body: 'Invalid mention target',
            mentions: [context.uids.unauthorized]
        });
        assert.ok([400, 403].includes(foreignMention.status), `foreign mention must be rejected: ${JSON.stringify(foreignMention.body)}`);
        const viewerWrite = await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${task.id}/discussion/messages`, viewerToken, 'POST', {
            operationId: 'phase4-api-viewer-write', body: 'Viewer cannot write'
        });
        assert.strictEqual(viewerWrite.status, 403);
        const unauthorizedRead = await request(context.server, `/api/projects/${context.projectId}/tasks/${task.id}/discussion`, unauthorizedToken);
        assert.ok([403, 404].includes(unauthorizedRead.status));

        // Author-only edit, safe integer revision fence and Owner-only moderation.
        body = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${task.id}/discussion/messages/${message.id}`, editorToken, 'PATCH', {
            operationId: 'phase4-api-message-edit',
            expectedRevision: message.revision,
            body: 'Edited first line\nEdited second line',
            mentions: [context.uids.viewer]
        }), 200, 'author edit');
        const editedMessage = responseRecord(body, 'message');
        assert.strictEqual(editedMessage.revision, message.revision + 1);
        const editorEditingOwnerMessage = await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${task.id}/discussion/messages/${reply.id}`, editorToken, 'PATCH', {
            operationId: 'phase4-api-editor-edit-owner', expectedRevision: reply.revision, body: 'Cross-author edit'
        });
        assert.strictEqual(editorEditingOwnerMessage.status, 403);
        const staleEdit = await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${task.id}/discussion/messages/${message.id}`, editorToken, 'PATCH', {
            operationId: 'phase4-api-message-stale-edit', expectedRevision: message.revision, body: 'Stale edit'
        });
        assert.strictEqual(staleEdit.status, 409);

        const editorModeration = await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${task.id}/discussion/messages/${message.id}/moderate`, editorToken, 'POST', {
            operationId: 'phase4-api-editor-moderation', expectedRevision: editedMessage.revision, action: 'hide', reason: 'Editor cannot moderate'
        });
        assert.strictEqual(editorModeration.status, 403);
        body = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${task.id}/discussion/messages/${message.id}/moderate`, ownerToken, 'POST', {
            operationId: 'phase4-api-owner-moderation', expectedRevision: editedMessage.revision, action: 'hide', reason: 'Owner moderation contract'
        }), 200, 'owner moderation');
        const hidden = responseRecord(body, 'message');
        assert.strictEqual(hidden.moderationState, 'hidden');
        const viewerPage = expectStatus(await request(context.server, `/api/projects/${context.projectId}/tasks/${task.id}/discussion`, viewerToken), 200, 'viewer redaction').messages;
        const viewerHidden = viewerPage.find((entry) => entry.id === message.id);
        assert.strictEqual(viewerHidden.body, null);
        assert.deepStrictEqual(viewerHidden.mentions, []);
        assert.strictEqual(viewerHidden.redacted, true);
        const viewerHistory = expectStatus(await request(context.server, `/api/projects/${context.projectId}/tasks/${task.id}/discussion/messages/${message.id}/history`, viewerToken), 200, 'viewer history redaction');
        assert.ok((viewerHistory.history || []).length >= 2);
        assert.ok((viewerHistory.history || []).every((entry) => entry.snapshot === undefined && entry.body === undefined && entry.mentions === undefined));
        const ownerHistory = expectStatus(await request(context.server, `/api/projects/${context.projectId}/tasks/${task.id}/discussion/messages/${message.id}/history`, ownerToken), 200, 'owner history visibility');
        assert.ok((ownerHistory.history || []).some((entry) => entry.body?.includes('First line')));

        // A later Owner-moderated message supplies a unique sentinel. Editors and
        // Viewers may see the operation but never the retained body/snapshot,
        // including nested result/inverse fields.
        const sentinelBody = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${task.id}/discussion/messages`, ownerToken, 'POST', {
            operationId: 'phase4-api-hidden-sentinel-create',
            messageId: 'phase4-api-hidden-sentinel',
            body: 'PHASE4_UNREDACTED_SENTINEL_7f3a1b'
        }), 200, 'create hidden sentinel');
        const sentinel = responseRecord(sentinelBody, 'message');
        expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${task.id}/discussion/messages/${sentinel.id}/moderate`, ownerToken, 'POST', {
            operationId: 'phase4-api-hidden-sentinel-hide', expectedRevision: sentinel.revision, action: 'hide', reason: 'redaction sentinel'
        }), 200, 'hide sentinel');
        for (const token of [editorToken, viewerToken]) {
            const hiddenHistory = await request(context.server, `/api/projects/${context.projectId}/tasks/${task.id}/discussion/messages/${sentinel.id}/history`, token);
            expectStatus(hiddenHistory, 200, 'redacted sentinel history');
            assert.ok(!JSON.stringify(hiddenHistory.body).includes('PHASE4_UNREDACTED_SENTINEL_7f3a1b'));
        }

        // Message history uses the same cursor contract as the discussion list.
        // Build more than two pages, then tie every timestamp so an ID tie-break
        // is required to return each immutable history row exactly once.
        const historyMessageBody = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${task.id}/discussion/messages`, editorToken, 'POST', {
            operationId: 'phase4-api-history-message-create',
            messageId: 'phase4-api-history-message',
            body: 'History pagination seed'
        }), 200, 'create history pagination message');
        const historyMessage = responseRecord(historyMessageBody, 'message');
        let historyRevision = historyMessage.revision;
        for (let index = 0; index < 105; index += 1) {
            const editedHistory = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${task.id}/discussion/messages/${historyMessage.id}`, editorToken, 'PATCH', {
                operationId: `phase4-api-history-edit-${index}`,
                expectedRevision: historyRevision,
                body: `History revision ${index}`
            }), 200, `history edit ${index}`);
            historyRevision = responseRecord(editedHistory, 'message').revision;
        }
        const historyRows = await context.db.collection('crmProjects').doc(context.projectId).collection('discussionHistory')
            .where('messageId', '==', historyMessage.id).get();
        const expectedMessageHistoryIds = new Set(historyRows.docs.map((doc) => doc.id));
        assert.strictEqual(expectedMessageHistoryIds.size, 105);
        const historyTieTimestamp = '2026-09-07T00:00:00.500Z';
        const historyTieBatch = context.db.batch();
        historyRows.docs.forEach((doc) => historyTieBatch.set(doc.ref, { createdAt: historyTieTimestamp }, { merge: true }));
        await historyTieBatch.commit();
        const pagedMessageHistory = [];
        let messageHistoryCursor = '';
        do {
            const suffix = new URLSearchParams({ pageSize: '3' });
            if (messageHistoryCursor) suffix.set('cursor', messageHistoryCursor);
            const historyPage = expectStatus(await request(context.server, `/api/projects/${context.projectId}/tasks/${task.id}/discussion/messages/${historyMessage.id}/history?${suffix}`, ownerToken), 200, 'message history continuation');
            pagedMessageHistory.push(...(historyPage.history || []));
            messageHistoryCursor = historyPage.nextCursor || '';
            if (pagedMessageHistory.length > 10000) throw new Error('message history pagination did not converge');
        } while (messageHistoryCursor);
        const actualMessageHistoryIds = new Set(pagedMessageHistory.map((entry) => entry.id));
        assert.strictEqual(pagedMessageHistory.length, expectedMessageHistoryIds.size, 'message history pagination must return every immutable row.');
        assert.strictEqual(actualMessageHistoryIds.size, pagedMessageHistory.length, 'message history pagination must not duplicate rows.');
        assert.deepStrictEqual([...actualMessageHistoryIds].sort(), [...expectedMessageHistoryIds].sort(), 'message history pagination must not omit or invent row IDs.');

        // Cursor pagination must carry every row and not confuse same-timestamp IDs.
        for (let index = 0; index < 105; index += 1) {
            await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${task.id}/discussion/messages`, editorToken, 'POST', {
                operationId: `phase4-api-page-${index}`,
                messageId: `phase4-api-page-${index}`,
                body: `page ${index}`
            }).then((response) => expectStatus(response, 200, `pagination message ${index}`));
        }
        const discussionTieTimestamp = '2026-09-07T00:00:00.000Z';
        const discussionRows = await context.db.collection('crmProjects').doc(context.projectId).collection('discussions').get();
        const discussionTieBatch = context.db.batch();
        discussionRows.docs.forEach((doc) => discussionTieBatch.set(doc.ref, { createdAt: discussionTieTimestamp }, { merge: true }));
        await discussionTieBatch.commit();
        const paged = await readAllMessages(context, viewerToken, task.id, 3);
        const expectedDiscussionIds = new Set([
            message.id,
            reply.id,
            largeMessage.id,
            sentinel.id,
            historyMessage.id,
            ...Array.from({ length: 105 }, (_, index) => `phase4-api-page-${index}`)
        ]);
        const actualDiscussionIds = new Set(paged.map((entry) => entry.id));
        assert.strictEqual(paged.length, expectedDiscussionIds.size, 'discussion pagination must return exactly every seeded/created row.');
        assert.strictEqual(actualDiscussionIds.size, paged.length, 'discussion pagination must not duplicate rows.');
        assert.deepStrictEqual([...actualDiscussionIds].sort(), [...expectedDiscussionIds].sort(), 'discussion pagination must not omit or invent row IDs.');

        const discussionPath = `/api/projects/${context.projectId}/tasks/${task.id}/discussion`;
        assert.deepStrictEqual(paged.map(row => row.id), [...expectedDiscussionIds].sort(), 'default ordering must remain ascending with an ID tie-break.');
        const descending = [];
        let descendingCursor = '';
        let firstDescendingCursor = '';
        do {
            const query = new URLSearchParams({ pageSize: '3', order: 'desc' });
            if (descendingCursor) query.set('cursor', descendingCursor);
            const page = expectStatus(await request(context.server, `${discussionPath}?${query}`, viewerToken), 200, 'descending discussion continuation');
            descending.push(...page.messages);
            descendingCursor = page.nextCursor || '';
            firstDescendingCursor ||= descendingCursor;
            assert.ok(descending.length <= expectedDiscussionIds.size, 'descending cursor must converge without duplicates');
        } while (descendingCursor);
        assert.deepStrictEqual(descending.map(row => row.id), [...expectedDiscussionIds].sort().reverse(), 'descending pages must include every tied timestamp exactly once in reverse ID order.');
        const ascendingPage = expectStatus(await request(context.server, `${discussionPath}?pageSize=3`, viewerToken), 200, 'legacy ascending cursor');
        const legacyCursorData = JSON.parse(Buffer.from(ascendingPage.nextCursor, 'base64url').toString('utf8'));
        assert.strictEqual(legacyCursorData.order, undefined, 'default cursor wire format stays compatible');
        const explicitAscending = expectStatus(await request(context.server, `${discussionPath}?pageSize=3&order=asc&cursor=${encodeURIComponent(ascendingPage.nextCursor)}`, viewerToken), 200, 'explicit ascending accepts legacy cursor');
        assert.deepStrictEqual(explicitAscending.messages.map(row => row.id), paged.slice(3, 6).map(row => row.id));
        for (const query of [
            'order=DESC', 'order=', 'order=desc&order=asc',
            `order=desc&cursor=${encodeURIComponent(ascendingPage.nextCursor)}`,
            `cursor=${encodeURIComponent(firstDescendingCursor)}`,
            `order=asc&cursor=${encodeURIComponent(firstDescendingCursor)}`,
            `order=desc&cursor=${Buffer.from(JSON.stringify({ ...legacyCursorData, order: 'sideways' })).toString('base64url')}`
        ]) {
            assert.strictEqual((await request(context.server, `${discussionPath}?${query}`, viewerToken)).status, 400, `invalid order/cursor mode must fail: ${query}`);
        }

        // Recovery catalog and preview are readable by every project member,
        // while mutation eligibility and ancestor-chain requirements remain
        // role-scoped and carry the exact current revision fences.
        const ownerTaskCatalog = expectStatus(await request(context.server, `/api/projects/${context.projectId}/recovery?lifecycle=active&targetType=task&limit=2`, ownerToken), 200, 'Owner active task recovery catalog');
        assert.ok(ownerTaskCatalog.entries.length >= 2);
        assert.ok(ownerTaskCatalog.entries.every((entry) => entry.targetType === 'task' && entry.localLifecycle === 'active' && Array.isArray(entry.ancestorPaths)));
        assert.ok(ownerTaskCatalog.entries.every((entry) => entry.allowedActions.archive && entry.allowedActions.trash && !entry.allowedActions.restore));
        assert.ok(Number.isSafeInteger(ownerTaskCatalog.revision.revision) && Number.isSafeInteger(ownerTaskCatalog.revision.structureRevision));
        const viewerTaskCatalog = expectStatus(await request(context.server, `/api/projects/${context.projectId}/recovery?lifecycle=active&targetType=task&limit=2`, viewerToken), 200, 'Viewer active task recovery catalog');
        assert.ok(viewerTaskCatalog.entries.every((entry) => Object.values(entry.allowedActions).every((allowed) => allowed === false)), 'Viewer catalog must expose records without mutation permissions.');
        const editorTaskCatalog = expectStatus(await request(context.server, `/api/projects/${context.projectId}/recovery?lifecycle=active&targetType=task&limit=2`, editorToken), 200, 'Editor active task recovery catalog');
        assert.ok(editorTaskCatalog.entries.every((entry) => entry.allowedActions.archive && entry.allowedActions.trash), 'Editor may recover active task records.');
        const editorSectionPreview = expectStatus(await request(context.server, `/api/projects/${context.projectId}/recovery/preview?targetType=section&targetId=${encodeURIComponent(fixture.section.id)}&action=archive`, editorToken), 200, 'Editor section preview');
        assert.strictEqual(editorSectionPreview.allowed, false);
        assert.strictEqual(editorSectionPreview.requiresOwner, true);
        const editorTaskPreview = expectStatus(await request(context.server, `/api/projects/${context.projectId}/recovery/preview?targetType=task&targetId=${encodeURIComponent(task.id)}&action=archive`, editorToken), 200, 'Editor task preview');
        assert.strictEqual(editorTaskPreview.allowed, true);
        assert.strictEqual(editorTaskPreview.expectedRevision, task.revision);
        assert.strictEqual(editorTaskPreview.expectedStructureRevision, ownerTaskCatalog.revision.structureRevision);
        assert.strictEqual(editorTaskPreview.affected[0].path, `crmProjects/${context.projectId}/tasks/${task.id}`);
        const viewerProjectPreview = expectStatus(await request(context.server, `/api/projects/${context.projectId}/recovery/preview?targetType=project&targetId=${encodeURIComponent(context.projectId)}&action=archive`, viewerToken), 200, 'Viewer project preview');
        assert.strictEqual(viewerProjectPreview.allowed, false);
        assert.strictEqual(viewerProjectPreview.requiresOwner, true);
        const ownerProjectPreview = expectStatus(await request(context.server, `/api/projects/${context.projectId}/recovery/preview?targetType=project&targetId=${encodeURIComponent(context.projectId)}&action=archive`, ownerToken), 200, 'Owner project preview');
        assert.strictEqual(ownerProjectPreview.allowed, true);
        assert.strictEqual(ownerProjectPreview.affected[0].path, `crmProjects/${context.projectId}`);
        const catalogCursorPage = expectStatus(await request(context.server, `/api/projects/${context.projectId}/recovery?lifecycle=active&targetType=task&limit=1`, ownerToken), 200, 'Recovery cursor seed');
        assert.ok(catalogCursorPage.nextCursor, 'Recovery catalog must issue a cursor for continuation.');
        const actorMismatchCursor = await request(context.server, `/api/projects/${context.projectId}/recovery?lifecycle=active&targetType=task&limit=1&cursor=${encodeURIComponent(catalogCursorPage.nextCursor)}`, viewerToken);
        assert.strictEqual(actorMismatchCursor.status, 400, 'Recovery cursor must be bound to the requesting actor.');
        const queryMismatchCursor = await request(context.server, `/api/projects/${context.projectId}/recovery?lifecycle=active&targetType=section&limit=1&cursor=${encodeURIComponent(catalogCursorPage.nextCursor)}`, ownerToken);
        assert.strictEqual(queryMismatchCursor.status, 400, 'Recovery cursor must be bound to its catalog query.');
        const foreignProjectId = 'phase4-api-cursor-foreign';
        await clearProject(context.db, foreignProjectId, context.bucket);
        await createProject({ ...context, projectId: foreignProjectId }, 'Phase4 cursor foreign project');
        const projectMismatchCursor = await request(context.server, `/api/projects/${foreignProjectId}/recovery?lifecycle=active&targetType=task&limit=1&cursor=${encodeURIComponent(catalogCursorPage.nextCursor)}`, ownerToken);
        assert.strictEqual(projectMismatchCursor.status, 400, 'Recovery cursor must be bound to its project.');

        // Lifecycle is inherited through the deep tree, while restore-chain is Owner-only.
        const projectBeforeArchive = expectStatus(await request(context.server, `/api/projects/${context.projectId}`, ownerToken), 200, 'project read').project;
        body = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/trash`, ownerToken, 'POST', {
            operationId: 'phase4-api-project-trash', expectedRevision: projectBeforeArchive.revision,
            expectedStructureRevision: projectBeforeArchive.structureRevision
        }), 200, 'project trash');
        const editorRestore = await jsonRequest(context.server, `/api/projects/${context.projectId}/restore`, editorToken, 'POST', {
            operationId: 'phase4-api-editor-restore-chain', expectedRevision: projectBeforeArchive.revision + 1,
            expectedStructureRevision: projectBeforeArchive.structureRevision + 1, restoreChain: true
        });
        assert.strictEqual(editorRestore.status, 403);
        body = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/restore`, ownerToken, 'POST', {
            operationId: 'phase4-api-project-restore', expectedRevision: projectBeforeArchive.revision + 1,
            expectedStructureRevision: projectBeforeArchive.structureRevision + 1, restoreChain: true
        }), 200, 'project restore chain');
        const projectBeforeArchiveCatalog = expectStatus(await request(context.server, `/api/projects/${context.projectId}`, ownerToken), 200, 'project before archive catalog').project;
        expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/archive`, ownerToken, 'POST', {
            operationId: 'phase4-api-project-archive-catalog', expectedRevision: projectBeforeArchiveCatalog.revision,
            expectedStructureRevision: projectBeforeArchiveCatalog.structureRevision
        }), 200, 'project archive for recovery catalog');
        const archivedProjectCatalog = expectStatus(await request(context.server, `/api/projects/${context.projectId}/recovery?lifecycle=archived&targetType=project&limit=1`, viewerToken), 200, 'archived project recovery catalog');
        assert.strictEqual(archivedProjectCatalog.entries.length, 1);
        assert.strictEqual(archivedProjectCatalog.entries[0].targetId, context.projectId);
        assert.strictEqual(archivedProjectCatalog.entries[0].localLifecycle, 'archived');
        const archivedProjectPreview = expectStatus(await request(context.server, `/api/projects/${context.projectId}/recovery/preview?targetType=project&targetId=${encodeURIComponent(context.projectId)}&action=restore`, viewerToken), 200, 'archived project restore preview');
        assert.strictEqual(archivedProjectPreview.allowed, false);
        assert.strictEqual(archivedProjectPreview.requiresOwner, true);
        const archivedProjectData = expectStatus(await request(context.server, `/api/projects/${context.projectId}`, ownerToken), 200, 'archived project fences').project;
        expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/restore`, ownerToken, 'POST', {
            operationId: 'phase4-api-project-restore-catalog', expectedRevision: archivedProjectData.revision,
            expectedStructureRevision: archivedProjectData.structureRevision, restoreChain: true
        }), 200, 'project restore after catalog');

        // Ordinary Undo is revision-fenced and emits a new operation.
        const currentTaskSnapshot = await context.db.collection('crmProjects').doc(context.projectId).collection('tasks').doc(task.id).get();
        const currentTask = currentTaskSnapshot.data();
        body = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${task.id}`, editorToken, 'PATCH', {
            operationId: 'phase4-api-task-title-update', expectedRevision: currentTask.revision, title: 'Undo me', dueDate: '2026-10-01'
        }), 200, 'task update');
        const changedTask = responseRecord(body, 'task');
        body = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/operations/phase4-api-task-title-update/undo`, editorToken, 'POST', {
            operationId: 'phase4-api-task-title-undo'
        }), 200, 'task undo');
        assert.ok(body.result || body.undone || body.operationId, 'Undo must return a compensating operation result.');
        const afterUndo = (await context.db.collection('crmProjects').doc(context.projectId).collection('tasks').doc(task.id).get()).data();
        assert.strictEqual(afterUndo.title, currentTask.title);
        assert.ok(afterUndo.revision > changedTask.revision - 1, 'Undo must advance the task revision.');
        const laterUpdate = await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${task.id}`, editorToken, 'PATCH', {
            operationId: 'phase4-api-task-later-update', expectedRevision: afterUndo.revision, title: 'Later edit'
        });
        expectStatus(laterUpdate, 200, 'later task update');
        const conflictedUndo = await jsonRequest(context.server, `/api/projects/${context.projectId}/operations/phase4-api-task-title-update/undo`, editorToken, 'POST', {
            operationId: 'phase4-api-task-title-undo-conflict'
        });
        assert.strictEqual(conflictedUndo.status, 409);

        // Ordinary field Undo also restores assignments and dates while
        // preserving the newer task revision fence.
        const taskAfterLaterEdit = (await context.db.collection('crmProjects').doc(context.projectId).collection('tasks').doc(task.id).get()).data();
        const assignmentUpdate = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${task.id}`, editorToken, 'PATCH', {
            operationId: 'phase4-api-task-assignment-date-update',
            expectedRevision: taskAfterLaterEdit.revision,
            assigneeUids: [context.uids.viewer],
            startDate: '2026-09-02',
            dueDate: '2026-09-03'
        }), 200, 'assignment and date update');
        const changedAssignment = responseRecord(assignmentUpdate, 'task');
        const assignmentUndo = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/operations/phase4-api-task-assignment-date-update/undo`, editorToken, 'POST', {
            operationId: 'phase4-api-task-assignment-date-undo'
        }), 200, 'assignment and date undo');
        assert.ok(assignmentUndo.result || assignmentUndo.undone || assignmentUndo.operationId);
        const afterAssignmentUndo = (await context.db.collection('crmProjects').doc(context.projectId).collection('tasks').doc(task.id).get()).data();
        assert.deepStrictEqual(afterAssignmentUndo.assigneeUids, taskAfterLaterEdit.assigneeUids);
        assert.strictEqual(afterAssignmentUndo.startDate, taskAfterLaterEdit.startDate);
        assert.strictEqual(afterAssignmentUndo.dueDate, taskAfterLaterEdit.dueDate);
        assert.ok(afterAssignmentUndo.revision > changedAssignment.revision);

        // Structural Move Undo is routed through the same recovery endpoint and
        // must restore parent ancestry, section placement and the structure fence.
        const projectBeforeMove = (await context.db.collection('crmProjects').doc(context.projectId).get()).data();
        const moveDestination = await createSection(context, 'phase4-api-move-destination', 'Move destination', projectBeforeMove.structureRevision);
        const taskBeforeMove = (await context.db.collection('crmProjects').doc(context.projectId).collection('tasks').doc(task.id).get()).data();
        const movedTask = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/${task.id}/move`, editorToken, 'POST', {
            operationId: 'phase4-api-task-move',
            expectedRevision: taskBeforeMove.revision,
            expectedStructureRevision: projectBeforeMove.structureRevision + 1,
            parentTaskId: null,
            sectionId: moveDestination.id,
            index: 0
        }), 200, 'task move');
        assert.strictEqual(responseRecord(movedTask, 'task').sectionId, moveDestination.id);
        const moveUndo = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/operations/phase4-api-task-move/undo`, editorToken, 'POST', {
            operationId: 'phase4-api-task-move-undo'
        }), 200, 'task move undo');
        const afterMoveUndo = (await context.db.collection('crmProjects').doc(context.projectId).collection('tasks').doc(task.id).get()).data();
        assert.strictEqual(afterMoveUndo.parentTaskId, taskBeforeMove.parentTaskId);
        assert.strictEqual(afterMoveUndo.sectionId, taskBeforeMove.sectionId);
        const projectAfterMoveUndo = (await context.db.collection('crmProjects').doc(context.projectId).get()).data();
        assert.ok(projectAfterMoveUndo.structureRevision > projectBeforeMove.structureRevision + 1);

        // Bulk accepts one bounded logical operation, rejects duplicate IDs before writes,
        // rejects oversized requests, validates people values, and retries idempotently.
        const bulkTargets = fixture.tasks.slice(0, 2);
        const bulkPeopleTask = (await context.db.collection('crmProjects').doc(context.projectId).collection('tasks').doc(bulkTargets[0].id).get()).data();
        const validBulkPeople = await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/bulk`, editorToken, 'POST', {
            operationId: 'phase4-api-bulk-valid-people',
            changes: [{ taskId: bulkTargets[0].id, expectedRevision: bulkPeopleTask.revision, patch: { assigneeUids: [context.uids.viewer] } }]
        });
        const validBulkPeopleBody = expectStatus(validBulkPeople, 200, 'bulk valid current member assignment');
        const validBulkPeopleResult = validBulkPeopleBody.result || validBulkPeopleBody;
        assert.strictEqual(validBulkPeopleResult.updated?.[0]?.taskId, bulkTargets[0].id);
        const afterBulkPeopleTask = (await context.db.collection('crmProjects').doc(context.projectId).collection('tasks').doc(bulkTargets[0].id).get()).data();
        assert.deepStrictEqual(afterBulkPeopleTask.assigneeUids, [context.uids.viewer]);
        const bulkTargetsCurrent = await Promise.all(bulkTargets.map(async (entry) => {
            const snapshot = await context.db.collection('crmProjects').doc(context.projectId).collection('tasks').doc(entry.id).get();
            return { id: snapshot.id, ...snapshot.data() };
        }));
        assert.deepStrictEqual(bulkTargetsCurrent.map((entry) => entry.id), bulkTargets.map((entry) => entry.id));
        const duplicateBulk = await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/bulk`, editorToken, 'POST', {
            operationId: 'phase4-api-bulk-duplicate',
            changes: [
                { taskId: bulkTargetsCurrent[0].id, expectedRevision: bulkTargetsCurrent[0].revision, patch: { title: 'one' } },
                { taskId: bulkTargetsCurrent[0].id, expectedRevision: bulkTargetsCurrent[0].revision, patch: { title: 'two' } }
            ]
        });
        assert.strictEqual(duplicateBulk.status, 400);
        const oversizedBulk = await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/bulk`, editorToken, 'POST', {
            operationId: 'phase4-api-bulk-oversize',
            changes: Array.from({ length: 101 }, (_, index) => ({ taskId: `missing-${index}`, expectedRevision: 1, patch: { title: 'x' } }))
        });
        assert.strictEqual(oversizedBulk.status, 413);
        const invalidPeople = await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/bulk`, editorToken, 'POST', {
            operationId: 'phase4-api-bulk-people',
            changes: [{ taskId: bulkTargetsCurrent[0].id, expectedRevision: bulkTargetsCurrent[0].revision, patch: { assigneeUids: [context.uids.unauthorized] } }]
        });
        assert.ok([400, 403].includes(invalidPeople.status));
        const bulkPayload = {
            operationId: 'phase4-api-bulk-once',
            changes: bulkTargetsCurrent.map((entry, index) => ({ taskId: entry.id, expectedRevision: entry.revision, patch: { title: `bulk-${index}` } }))
        };
        const bulkResult = await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/bulk`, editorToken, 'POST', bulkPayload);
        expectStatus(bulkResult, 200, 'bulk update');
        const bulkRetry = await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/bulk`, editorToken, 'POST', bulkPayload);
        assert.deepStrictEqual(bulkRetry.body, bulkResult.body, 'retrying the same bulk operation must return the exact committed response.');
        const bulkConflict = await jsonRequest(context.server, `/api/projects/${context.projectId}/tasks/bulk`, editorToken, 'POST', {
            ...bulkPayload,
            changes: bulkPayload.changes.map((entry) => ({ ...entry, patch: { title: 'different payload' } }))
        });
        assert.strictEqual(bulkConflict.status, 409);

        const operationHistoryTieTimestamp = '2026-09-07T00:00:01.000Z';
        const operationRows = await context.db.collection('crmProjectOperations').where('projectId', '==', context.projectId).get();
        const operationTieBatch = context.db.batch();
        operationRows.docs.forEach((doc) => operationTieBatch.set(doc.ref, { createdAt: operationHistoryTieTimestamp }, { merge: true }));
        await operationTieBatch.commit();
        const history = expectStatus(await request(context.server, `/api/projects/${context.projectId}/history?limit=2`, viewerToken), 200, 'history read');
        assert.ok(Array.isArray(history.operations));
        assert.ok(history.operations.every((operation) => !JSON.stringify(operation).includes('First line')),
            'history visible to Editor/Viewer must not leak raw discussion snapshots.');
        const allHistory = [];
        let historyCursor = '';
        do {
            const suffix = new URLSearchParams({ limit: '40' });
            if (historyCursor) suffix.set('cursor', historyCursor);
            const page = expectStatus(await request(context.server, `/api/projects/${context.projectId}/history?${suffix}`, viewerToken), 200, 'history continuation');
            allHistory.push(...(page.operations || []));
            historyCursor = page.nextCursor || '';
            if (allHistory.length > 10000) throw new Error('history pagination did not converge');
        } while (historyCursor);
        const persistedOperationCount = (await context.db.collection('crmProjectOperations').where('projectId', '==', context.projectId).get()).size;
        assert.strictEqual(allHistory.length, persistedOperationCount, 'history continuation must return every persisted operation, not only the first bounded window.');
        assert.ok(allHistory.length > 100, `history continuation must return more than three pages, got ${allHistory.length}`);
        assert.strictEqual(new Set(allHistory.map((operation) => operation.operationId || operation.id)).size, allHistory.length);
        assert.ok(!JSON.stringify(allHistory).includes('PHASE4_UNREDACTED_SENTINEL_7f3a1b'));
        for (const historyToken of [editorToken, viewerToken]) {
            const firstPage = expectStatus(await request(context.server, `/api/projects/${context.projectId}/history?limit=100`, historyToken), 200, 'role history redaction page');
            assert.ok(!JSON.stringify(firstPage).includes('PHASE4_UNREDACTED_SENTINEL_7f3a1b'));
        }
        const malformedCursor = await request(context.server, `/api/projects/${context.projectId}/history?cursor=not-a-real-cursor`, viewerToken);
        assert.strictEqual(malformedCursor.status, 400);

        // Undo must compensate the project metadata operation without restoring
        // ownership metadata that changed after the operation. Transfer Owner
        // through the access route, then invoke Undo as the new Owner.
        const beforeOwnershipUndo = expectStatus(await request(context.server, `/api/projects/${context.projectId}`, ownerToken), 200, 'project before ownership undo').project;
        const projectUpdate = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}`, ownerToken, 'PATCH', {
            operationId: 'phase4-api-project-description-undo',
            expectedRevision: beforeOwnershipUndo.revision,
            description: 'Undo this metadata change'
        }), 200, 'project metadata update before owner transfer');
        const changedProject = responseRecord(projectUpdate, 'project');
        const transfer = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/owner-transfer`, ownerToken, 'POST', {
            targetUid: context.uids.editor
        }), 200, 'owner transfer before project undo');
        assert.strictEqual(responseRecord(transfer, 'transfer').ownerUid, context.uids.editor);
        const afterTransfer = expectStatus(await request(context.server, `/api/projects/${context.projectId}`, editorToken), 200, 'new Owner project read');
        const membershipRevisionAfterTransfer = afterTransfer.project.membershipRevision;
        const membersAfterTransfer = expectStatus(await request(context.server, `/api/projects/${context.projectId}/members`, editorToken), 200, 'members after owner transfer').members;
        const editorMemberAfterTransfer = membersAfterTransfer.find((member) => member.uid === context.uids.editor);
        const ownerMemberAfterTransfer = membersAfterTransfer.find((member) => member.uid === context.uids.owner);
        assert.strictEqual(editorMemberAfterTransfer?.role, 'Owner');
        assert.strictEqual(ownerMemberAfterTransfer?.role, 'Editor');

        const ownershipUndo = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/operations/phase4-api-project-description-undo/undo`, editorToken, 'POST', {
            operationId: 'phase4-api-project-description-undo-compensate'
        }), 200, 'new Owner undo after ownership transfer');
        assert.ok(ownershipUndo.result || ownershipUndo.undone || ownershipUndo.operationId, 'ownership-preserving Undo must return a compensating operation.');
        const afterOwnershipUndo = expectStatus(await request(context.server, `/api/projects/${context.projectId}`, editorToken), 200, 'project after ownership-preserving undo');
        assert.strictEqual(afterOwnershipUndo.project.description, beforeOwnershipUndo.description);
        assert.notStrictEqual(afterOwnershipUndo.project.description, changedProject.description);
        assert.strictEqual(afterOwnershipUndo.project.ownerUid, context.uids.editor, 'Undo must preserve the new Owner.');
        assert.strictEqual(afterOwnershipUndo.project.membershipRevision, membershipRevisionAfterTransfer, 'Undo must preserve the post-transfer membership revision.');
        assert.ok(afterOwnershipUndo.project.revision > afterTransfer.project.revision, 'Undo must advance the project revision.');
        assert.strictEqual(afterOwnershipUndo.project.structureRevision, afterTransfer.project.structureRevision, 'Undo must preserve the latest structure counter.');
        assert.strictEqual(afterOwnershipUndo.project.contentRevision, afterTransfer.project.contentRevision, 'Undo must preserve the latest content counter.');
        const membersAfterOwnershipUndo = expectStatus(await request(context.server, `/api/projects/${context.projectId}/members`, editorToken), 200, 'members after ownership-preserving undo').members;
        assert.strictEqual(membersAfterOwnershipUndo.find((member) => member.uid === context.uids.editor)?.role, 'Owner');
        assert.strictEqual(membersAfterOwnershipUndo.find((member) => member.uid === context.uids.owner)?.role, 'Editor');

        // Lifecycle Undo has the same cross-phase ownership boundary: archive
        // as the current Owner, transfer ownership, then compensate as the new
        // Owner without replaying the archived snapshot's old ownerUid.
        const beforeLifecycleUndo = afterOwnershipUndo.project;
        const archivedForUndo = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/archive`, editorToken, 'POST', {
            operationId: 'phase4-api-project-archive-undo-transfer',
            expectedRevision: beforeLifecycleUndo.revision,
            expectedStructureRevision: beforeLifecycleUndo.structureRevision
        }), 200, 'project archive before lifecycle ownership transfer');
        const lifecycleTransfer = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/owner-transfer`, editorToken, 'POST', {
            targetUid: context.uids.owner
        }), 200, 'owner transfer before lifecycle undo');
        assert.strictEqual(responseRecord(lifecycleTransfer, 'transfer').ownerUid, context.uids.owner);
        const afterLifecycleTransfer = expectStatus(await request(context.server, `/api/projects/${context.projectId}`, ownerToken), 200, 'new Owner lifecycle undo read');
        const lifecycleMembershipRevision = afterLifecycleTransfer.project.membershipRevision;
        const lifecycleUndo = expectStatus(await jsonRequest(context.server, `/api/projects/${context.projectId}/operations/phase4-api-project-archive-undo-transfer/undo`, ownerToken, 'POST', {
            operationId: 'phase4-api-project-archive-undo-transfer-compensate'
        }), 200, 'new Owner lifecycle undo');
        assert.ok(lifecycleUndo.result || lifecycleUndo.undone || lifecycleUndo.operationId, 'lifecycle Undo must return a compensating operation.');
        const afterLifecycleUndo = expectStatus(await request(context.server, `/api/projects/${context.projectId}`, ownerToken), 200, 'project after lifecycle ownership-preserving undo');
        assert.strictEqual(afterLifecycleUndo.project.lifecycle, 'active');
        assert.strictEqual(afterLifecycleUndo.project.ownerUid, context.uids.owner, 'lifecycle Undo must preserve the transferred Owner.');
        assert.strictEqual(afterLifecycleUndo.project.membershipRevision, lifecycleMembershipRevision);
        assert.ok(afterLifecycleUndo.project.revision > archivedForUndo.result?.targetRevision || afterLifecycleUndo.project.revision > afterLifecycleTransfer.project.revision);
        assert.ok(afterLifecycleUndo.project.structureRevision > afterLifecycleTransfer.project.structureRevision, 'lifecycle Undo must advance the structure counter.');
        process.stdout.write('crm projects Phase4 discussion/recovery API contract passed\n');
    } finally {
        await context.close();
    }
}

main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
