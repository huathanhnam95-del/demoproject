'use strict';
const assert = require('node:assert/strict');
const h = require('./phase9-test-helpers');
const { nextThursday } = require('../../../functions/src/crm/projects/voice/proposal-service');
const createRouter = require('../../../functions/src/routes/crm/projects');
async function main() {
    const f = await h.boot('gemini-context-api'), { suite, c } = f, results = [];
    const input = (purpose, selectedTaskIds = ['one'], extra = {}) => ({ requestId: c.op('proposal'), purpose, contextHints: { projectId: c.projectId, view: 'board', selectedTaskIds }, instruction: 'Engineering acceptance proposal.', ...extra });
    const propose = async (request, role = 'owner') => h.expectStatus(await f.api('/ai/proposals', role, 'POST', request), 200);
    async function proof(draft, preview) {
        const owner = { actorUid: c.uids.owner, feature: 'projects' };
        const prepared = await f.sessionService.prepare({ ...owner, requestId: c.op('voice'), contextHints: { projectId: c.projectId, selectedTaskIds: ['one'], draftId: draft.draftId, previewId: preview.previewId } });
        const claimed = await f.sessionService.claim({ ...owner, sessionId: prepared.sessionId, ticket: prepared.ticket, connectionId: c.op('connection') });
        const channel = f.sessionService.providerChannel({ ...owner, sessionId: prepared.sessionId, epoch: claimed.epoch });
        await channel.beginUtterance({ utteranceId: 'confirmation', eventId: 'begin', source: 'user_audio' });
        return channel.finalizeUtterance({ utteranceId: 'confirmation', eventId: 'final', source: 'user_audio', final: true, text: 'I confirm these changes.', audioEvidence: { audioDigest: 'a'.repeat(64), durationMs: 1000 } });
    }
    try {
        await h.caseRun('actual proposal route creates three selected move actions with stable server IDs and exact replay', async () => {
            f.setOutput({ kind: 'task_draft', actions: ['one', 'two', 'three'].map(taskId => ({ kind: 'move_task', taskId, parentTaskId: 'parent' })) });
            const request = input('task_draft', ['one', 'two', 'three']); const before = f.generationCalls.length;
            const created = await propose(request); assert.equal(created.draft.actions.length, 3); created.draft.actions.forEach(action => assert.match(action.actionId, /^action-[a-f0-9]{24}$/));
            const replay = await propose(request); assert.equal(replay.replayed, true); assert.deepEqual(replay.draft.actions, created.draft.actions); assert.equal(f.generationCalls.length, before + 1);
            assert.equal((await c.taskData('one')).parentTaskId, null);
        }, results);
        await h.caseRun('current Mai assignment and Vietnam Thursday preview/provider proof/apply update only confirmed tasks', async () => {
            const profile = suite.db.collection('users').doc(c.uids.editor), original = (await profile.get()).data();
            try {
                await profile.update({ displayName: 'Mai' });
                const untouched = await c.taskData('two');
                f.setOutput({ kind: 'task_draft', actions: [{ kind: 'field_update', taskId: 'one', patch: {}, assigneeName: 'Mai', dueDateExpression: 'next Thursday' }] });
                const created = await propose(input('task_draft')); assert.equal(created.draft.actions[0].patch.ownerUid, c.uids.editor); assert.equal(created.draft.actions[0].patch.dueDate, nextThursday(Date.now())); assert.match(created.notices.join(' '), /Accountable owner/);
                const preview = h.expectStatus(await f.api(`/ai/drafts/${created.draft.draftId}/preview`, 'owner', 'POST', { expectedRevision: created.draft.revision, requestId: c.op('preview') }), 200);
                const attestation = await proof(created.draft, preview); assert.ok(attestation.attestationId);
                h.expectStatus(await f.api(`/ai/drafts/${created.draft.draftId}/apply`, 'owner', 'POST', { previewId: preview.previewId, attestationId: attestation.attestationId }), 200);
                assert.equal((await c.taskData('one')).ownerUid, c.uids.editor); assert.equal((await c.taskData('one')).dueDate, nextThursday(Date.now())); assert.deepEqual(await c.taskData('two'), untouched);
            } finally { await profile.set(original); }
        }, results);
        await h.caseRun('second-action correction preserves first action and both stable identities', async () => {
            f.setOutput({ kind: 'task_draft', actions: ['two', 'three'].map(taskId => ({ kind: 'field_update', taskId, patch: { title: `Draft ${taskId}` } })) });
            const created = await propose(input('task_draft', ['two', 'three'])); f.setOutput({ kind: 'correction', patch: { patch: { title: 'Corrected second' } } });
            const correction = await propose(input('task_correction', ['two', 'three'], { draftId: created.draft.draftId, actionId: created.draft.actions[1].actionId, expectedRevision: created.draft.revision }));
            assert.deepEqual(correction.draft.actions[0], created.draft.actions[0]); assert.equal(correction.draft.actions[1].actionId, created.draft.actions[1].actionId); assert.equal(correction.draft.actions[1].patch.title, 'Corrected second');
        }, results);
        await h.caseRun('automation proposal is validated editor content only; Owner permitted and Editor rejected', async () => {
            const before = (await c.rows('rules')).length;
            f.setOutput({ kind: 'automation_draft', definition: { schemaVersion: 1, trigger: { type: 'status_changed', from: 'not_started', to: 'blocked' }, steps: [{ nodeId: 'notify_owner', type: 'notify', payload: { message: 'Review blocked task', recipients: 'task_owner' } }] } });
            const result = await propose(input('automation_draft')); assert.equal(result.kind, 'automation_draft'); assert.equal(result.requiresEditorReview, true); assert.equal((await c.rows('rules')).length, before);
            const count = f.generationCalls.length; h.expectStatus(await f.api('/ai/proposals', 'editor', 'POST', input('automation_draft')), 403); assert.equal(f.generationCalls.length, count);
        }, results);
        await h.caseRun('forged actions, proof, UID, unauthenticated and disabled/native paths fail closed', async () => {
            const count = f.generationCalls.length;
            for (const extra of [{ actions: [] }, { actorUid: c.uids.editor }, { attestationId: 'forged' }]) h.expectStatus(await f.api('/ai/proposals', 'owner', 'POST', input('task_draft', ['one'], extra)), 400);
            h.expectStatus(await f.api('/ai/proposals', null, 'POST', input('planning')), 401);
            h.expectStatus(await f.api('/ai/drafts/forged/apply', 'owner', 'POST', { actions: [], source: 'user_audio' }), 400);
            const old = process.env.CRM_PROJECTS_ENABLED; process.env.CRM_PROJECTS_ENABLED = '0'; try { h.expectStatus(await f.api('/ai/config'), 404); } finally { process.env.CRM_PROJECTS_ENABLED = old; }
            f.expressApp.use('/native', createRouter({ ...f.deps, projectsVoiceEngineeringMode: false })); const token = await suite.token('owner');
            const response = await h.jsonRequest(f.server, '/native/ai/proposals', token, 'POST', input('planning')); h.expectStatus(response, 409); assert.equal(response.body.error, 'PAID_DISPATCH_DISABLED'); assert.equal(f.generationCalls.length, count);
        }, results);
        await h.caseRun('authenticated owner cannot directly read or write AI drafts, revisions, requests, previews or proposals', async () => {
            const token = await suite.token('owner');
            for (const collection of ['crmAiDrafts', 'crmAiDraftRevisions', 'crmAiDraftRequests', 'crmProjectAiPreviews', 'crmProjectAiProposals']) {
                const rows = await suite.db.collection(collection).limit(1).get(); const id = rows.docs[0]?.id || 'denied-record';
                assert.equal((await h.directFirestoreRequest(`${collection}/${id}`, token)).status, 403, `${collection} read`);
                assert.equal((await h.directFirestoreRequest(`${collection}/${id}`, token, 'PATCH', { fields: { forged: { booleanValue: true } } })).status, 403, `${collection} write`);
            }
        }, results);
        await h.caseRun('directory change during generation rejects stale name resolution without a new draft', async () => {
            const profile = suite.db.collection('users').doc(c.uids.editor), original = (await profile.get()).data(); const before = await suite.db.collection('crmAiDrafts').where('actorUid', '==', c.uids.owner).get();
            try {
                await profile.update({ displayName: 'Mai' }); f.setOutput(async () => { await profile.update({ displayName: 'Renamed member' }); return { kind: 'task_draft', actions: [{ kind: 'field_update', taskId: 'one', assigneeName: 'Mai' }] }; });
                const response = await f.api('/ai/proposals', 'owner', 'POST', input('task_draft')); h.expectStatus(response, 409); assert.equal(response.body.error, 'CONTEXT_CHANGED');
                assert.equal((await suite.db.collection('crmAiDrafts').where('actorUid', '==', c.uids.owner).get()).size, before.size);
            } finally { await profile.set(original); }
        }, results);
    } finally { await f.close(); }
    h.finish(results);
}
main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
