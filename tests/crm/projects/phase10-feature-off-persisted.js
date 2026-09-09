'use strict';
// Root executes this acceptance file only through the dedicated demo emulator runner.
const assert = require('node:assert/strict');
const h = require('./phase9-test-helpers');
const { AI_ASSISTANCE_COLLECTIONS, AI_DRAFT_COLLECTIONS, AI_VOICE_COLLECTIONS } = require('../../../functions/src/ai-assistance/collections');
async function main() {
    const f = await h.boot('phase10-feature-off'), { suite, c } = f, results = [];
    const flags = ['CRM_PROJECTS_ENABLED', 'CRM_PROJECTS_AUTOMATIONS_ENABLED'];
    const originalFlags = Object.fromEntries(flags.map(key => [key, process.env[key]]));
    const restoreFlags = () => { for (const [key, value] of Object.entries(originalFlags)) if (value === undefined) delete process.env[key]; else process.env[key] = value; };
    async function snapshot() {
        const collections = [...new Set(['crmProjectOperations', 'crmProjectEvents', 'crmProjectAiPreviews', 'crmProjectAiProposals', ...Object.values(AI_ASSISTANCE_COLLECTIONS), ...Object.values(AI_DRAFT_COLLECTIONS), ...Object.values(AI_VOICE_COLLECTIONS), ...Object.values(h.COLLECTIONS)])];
        const documents = new Map();
        const project = await c.projectRef.get(); documents.set(project.ref.path, project.data());
        // Include the project membership fence in the persisted baseline as
        // well as content and feed state. Disabled requests must not be able
        // to alter any project-scoped record, even when the caller has an
        // otherwise valid account.
        collections.push('crmProjectMembers');
        for (const child of ['tasks', 'sections', 'columns', 'discussions', 'changeHeads']) collections.push(`${c.projectRef.path}/${child}`);
        for (const collection of collections) {
            const rows = await suite.db.collection(collection).get();
            for (const row of rows.docs) documents.set(row.ref.path, row.data());
        }
        return [...documents].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    }
    try {
        const operationId = await c.edit('one', { title: 'Feature-off retained task' });
        const taskBefore = h.expectStatus(await f.api(`/${c.projectId}/tasks/one`), 200).task;
        f.setOutput({ kind: 'task_draft', actions: [{ kind: 'field_update', taskId: 'one', patch: { title: 'Unapplied saved draft title' } }] });
        const proposalInput = { requestId: c.op('saved-proposal'), purpose: 'task_draft', contextHints: { projectId: c.projectId, selectedTaskIds: ['one'], view: 'board' }, instruction: 'Prepare a draft; preserve until confirmed.' };
        const proposal = h.expectStatus(await f.api('/ai/proposals', 'owner', 'POST', proposalInput), 200), draft = proposal.draft;
        const preview = h.expectStatus(await f.api(`/ai/drafts/${draft.draftId}/preview`, 'owner', 'POST', { requestId: c.op('preview'), expectedRevision: draft.revision }), 200);
        const voice = { actorUid: c.uids.owner, feature: 'projects' };
        const prepared = await f.sessionService.prepare({ ...voice, requestId: c.op('voice'), contextHints: { projectId: c.projectId, selectedTaskIds: ['one'], draftId: draft.draftId, previewId: preview.previewId } });
        const claimed = await f.sessionService.claim({ ...voice, sessionId: prepared.sessionId, ticket: prepared.ticket, connectionId: c.op('connection') });
        const channel = f.sessionService.providerChannel({ ...voice, sessionId: prepared.sessionId, epoch: claimed.epoch });
        await channel.beginUtterance({ utteranceId: 'confirm', eventId: 'begin', source: 'user_audio' });
        const proof = await channel.finalizeUtterance({ utteranceId: 'confirm', eventId: 'final', source: 'user_audio', text: 'I confirm these changes.', final: true, audioEvidence: { audioDigest: 'f'.repeat(64), durationMs: 1000 } });
        assert.ok(proof.attestationId, 'a genuine engineering attestation makes disabled apply meaningful');
        assert.equal((await suite.db.collection('crmProjectOperations').doc(operationId).get()).exists, true);
        assert.equal((await suite.db.collection('crmProjectEvents').doc(operationId).get()).exists, true);
        assert.equal(f.generationCalls.length, 1);
        const before = await snapshot(), serializedBefore = JSON.stringify(before), dispatches = f.generationCalls.length;
        assert.ok(before.some(([key, value]) => key.startsWith(c.projectRef.path + '/changeHeads/') && value.sequence > 0), 'Feature-off snapshot must include actual nonempty committed change heads');
        const token = await suite.token('owner');
        for (const key of flags) process.env[key] = '0';
        try {
            await h.caseRun('feature-off denies authenticated reads and all mutation/proposal/apply routes without writes or dispatch', async () => {
                const requests = [
                    ['GET', '/' + c.projectId + '/changes'], ['POST', '/' + c.projectId + '/changes/hydrate', { taskIds: ['one'], messageIds: [] }],

                    ['GET', `/${c.projectId}/tasks/one`], ['GET', `/${c.projectId}`], ['GET', `/ai/drafts/${draft.draftId}`], ['GET', '/ai/config'], ['GET', '/budget'],
                    ['PATCH', `/${c.projectId}/tasks/one`, { operationId: c.op('denied-edit'), expectedRevision: taskBefore.revision, title: 'Must not persist' }],
                    ['POST', '/ai/proposals', { ...proposalInput, requestId: c.op('denied-proposal') }],
                    ['POST', `/ai/drafts/${draft.draftId}/correct`, { requestId: c.op('denied-correct'), expectedRevision: draft.revision, actionId: draft.actions[0].actionId, patch: { patch: { title: 'Must not persist' } } }],
                    ['POST', `/ai/drafts/${draft.draftId}/decline`, { requestId: c.op('denied-decline'), expectedRevision: draft.revision }],
                    ['POST', `/ai/drafts/${draft.draftId}/preview`, { requestId: c.op('denied-preview'), expectedRevision: draft.revision }],
                    ['POST', `/ai/drafts/${draft.draftId}/apply`, { previewId: preview.previewId, attestationId: proof.attestationId }]
                ];
                for (const [method, path, body] of requests) {
                    const response = method === 'GET' ? await h.request(f.server, `/api/projects${path}`, token) : await h.jsonRequest(f.server, `/api/projects${path}`, token, method, body);
                    h.expectStatus(response, 404, `${method} ${path}`); assert.equal(response.body.error, 'PROJECTS_DISABLED');
                }
                assert.equal(f.generationCalls.length, dispatches); const after = await snapshot(); assert.deepEqual(after, before); assert.equal(JSON.stringify(after), serializedBefore);
            }, results);
            await h.caseRun('disabled automation processor performs no event/run/due effects or worker writes', async () => {
                const processor = suite.processor('phase10-feature-off');
                assert.deepEqual(await processor.processEvent(operationId), { paused: true });
                assert.deepEqual(await processor.processBatch(), { paused: true });
                assert.equal(f.generationCalls.length, dispatches); assert.deepEqual(await snapshot(), before);
            }, results);
        } finally { restoreFlags(); }
        await h.caseRun('re-enabling restores authorized access to the same unchanged task, saved draft and preview', async () => {
            const taskAfter = h.expectStatus(await f.api(`/${c.projectId}/tasks/one`), 200).task;
            const draftResponse = h.expectStatus(await f.api(`/ai/drafts/${draft.draftId}`), 200), restored = draftResponse.draft || draftResponse;
            assert.deepEqual(taskAfter, taskBefore); assert.equal(restored.draftId, draft.draftId); assert.equal(restored.revision, draft.revision); assert.equal(restored.status, 'active'); assert.deepEqual(restored.actions, draft.actions);
            const persistedPreview = await suite.db.collection('crmProjectAiPreviews').doc(preview.previewId).get(); assert.equal(persistedPreview.exists, true); assert.equal(persistedPreview.data().draftId, draft.draftId);
            assert.equal(f.generationCalls.length, dispatches); assert.deepEqual(await snapshot(), before);
        }, results);
    } finally { restoreFlags(); await f.close(); }
    h.finish(results);
}
main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
