'use strict';
const assert = require('node:assert/strict');
const h = require('./phase6-test-helpers');
const { createProjectsRecoveryService } = require('../../../functions/src/crm/projects/recovery-service');
const { createProjectsDraftService } = require('../../../functions/src/crm/projects/voice/draft-service');
const { createVoiceSessionService } = require('../../../functions/src/ai-assistance/voice/session-service');
const { operationRef, eventRef, projectRef } = require('../../../functions/src/crm/projects/domain/storage');
async function main() {
    const suite = await h.bootSuite(), results = [];
    try {
        const c = await h.project(suite, `creation-drafts-${Date.now()}`), identity = { uid: c.uids.owner }, now = () => suite.now().getTime();
        const recovery = createProjectsRecoveryService({ ...suite });
        const service = createProjectsDraftService({ ...suite, recoveryService: recovery, now, engineeringMode: true });
        const voice = createVoiceSessionService({ db: suite.db, runTransaction: work => suite.db.runTransaction(work), now, featureAdapters: { projects: service.voiceAdapter }, engineeringMode: true });
        const confirmed = async (action, scope = c.projectId) => {
            const draft = (await service.createFromProposal(identity, scope, { requestId: c.op('draft'), actions: [action] })).draft;
            const preview = await service.preview(identity, draft.draftId, { expectedRevision: 0, requestId: c.op('preview') });
            const hints = typeof scope === 'string' ? { projectId: scope, filters: { sectionId: 's1' } } : scope;
            const prepared = await voice.prepare({ actorUid: identity.uid, feature: 'projects', requestId: c.op('voice'), contextHints: { ...hints, draftId: draft.draftId, previewId: preview.previewId } });
            const owner = { actorUid: identity.uid, feature: 'projects', sessionId: prepared.sessionId };
            const claim = await voice.claim({ ...owner, ticket: prepared.ticket, connectionId: c.op('connection') });
            const channel = voice.providerChannel({ ...owner, epoch: claim.epoch });
            await channel.beginUtterance({ utteranceId: 'confirm', eventId: 'begin', source: 'user_audio' });
            const proof = await channel.finalizeUtterance({ utteranceId: 'confirm', eventId: 'final', source: 'user_audio', text: 'I confirm these changes.', final: true, audioEvidence: { audioDigest: 'd'.repeat(64), durationMs: 1000 } });
            assert.ok(proof.attestationId); const input = { previewId: preview.previewId, attestationId: proof.attestationId };
            return { draft, preview, input, apply: () => service.apply(identity, draft.draftId, input) };
        };
        await h.caseRun('new-project preview writes no project; spoken proof applies once and Undo archives', async () => {
            const f = await confirmed({ kind: 'create_project', project: { name: 'Spoken project candidate', description: 'Emulator only' } }, { mode: 'create_project' });
            assert.equal((await projectRef(suite.db, f.preview.projectId).get()).exists, false);
            const result = await f.apply(); assert.equal(result.project.name, 'Spoken project candidate'); assert.deepEqual(await f.apply(), result);
            assert.equal((await operationRef(suite.db, f.preview.operationId).get()).data().origin, 'ai'); assert.equal((await eventRef(suite.db, f.preview.operationId).get()).exists, true);
            await recovery.undoOperation(identity, f.preview.projectId, f.preview.operationId, { operationId: c.op('undo') });
            assert.equal((await projectRef(suite.db, f.preview.projectId).get()).data().lifecycle, 'archived');
        }, results);
        await h.caseRun('task creation previews all fields, commits once, and Undo preserves archived history', async () => {
            const f = await confirmed({ kind: 'create_task', task: { title: 'Spoken task candidate', ownerUid: identity.uid, status: 'in_progress', dueDate: '2026-09-15' }, sectionId: 's1' });
            const taskId = f.preview.impact.task.id; assert.equal((await suite.db.collection('crmProjects').doc(c.projectId).collection('tasks').doc(taskId).get()).exists, false);
            assert.equal(f.preview.impact.task.dueDate, '2026-09-15'); const result = await f.apply(); assert.equal(result.task.ownerUid, identity.uid); assert.deepEqual(await f.apply(), result);
            await recovery.undoOperation(identity, c.projectId, f.preview.operationId, { operationId: c.op('undo') }); assert.equal((await c.taskData(taskId)).lifecycle, 'archived');
        }, results);
        await h.caseRun('project metadata edit replay still requires current Owner', async () => {
            const f = await confirmed({ kind: 'update_project', patch: { name: 'Renamed by confirmed draft' } }); const result = await f.apply(); assert.equal(result.project.name, 'Renamed by confirmed draft');
            const member = c.memberRef('owner'), saved = (await member.get()).data();
            try { await member.update({ role: 'Editor' }); await assert.rejects(f.apply()); } finally { await member.set(saved); }
            assert.deepEqual(await f.apply(), result);
        }, results);
    } finally { suite.server.closeAllConnections?.(); await suite.close(); }
    h.finish(results);
}
main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
