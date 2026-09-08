'use strict';
const assert = require('node:assert/strict');
const h = require('./phase6-test-helpers');
const { createProjectsRecoveryService } = require('../../../functions/src/crm/projects/recovery-service');
const { createProjectsDraftService } = require('../../../functions/src/crm/projects/voice/draft-service');
const { createVoiceSessionService } = require('../../../functions/src/ai-assistance/voice/session-service');
const { AI_VOICE_COLLECTIONS: V } = require('../../../functions/src/ai-assistance/collections');
const { operationRef, eventRef } = require('../../../functions/src/crm/projects/domain/storage');
async function main() {
    const suite = await h.bootSuite(), results = [];
    try {
        const c = await h.project(suite, 'ai-confirmed');
        for (const name of ['one', 'two', 'three', 'parent']) await c.task(name);
        await c.task('child', { parentTaskId: 'one', sectionId: null });
        const recovery = createProjectsRecoveryService({ ...suite });
        const now = () => suite.now().getTime();
        const service = createProjectsDraftService({ ...suite, recoveryService: recovery, now, engineeringMode: true });
        const identity = { uid: c.uids.owner };
        const voice = createVoiceSessionService({ db: suite.db, runTransaction: work => suite.db.runTransaction(work), now, featureAdapters: { projects: service.voiceAdapter }, engineeringMode: true });
        const proof = async (draft, preview) => {
            const prepared = await voice.prepare({ actorUid: identity.uid, feature: 'projects', requestId: c.op('voice'), contextHints: { projectId: c.projectId, draftId: draft.draftId, previewId: preview.previewId, selectedTaskIds: ['one', 'two', 'three'] } });
            const owner = { actorUid: identity.uid, feature: 'projects', sessionId: prepared.sessionId };
            const claim = await voice.claim({ ...owner, ticket: prepared.ticket, connectionId: c.op('connection') });
            const channel = voice.providerChannel({ ...owner, epoch: claim.epoch });
            await channel.beginUtterance({ utteranceId: 'confirm', eventId: 'begin', source: 'user_audio' });
            const result = await channel.finalizeUtterance({ utteranceId: 'confirm', eventId: 'final', source: 'user_audio', text: 'I confirm these changes.', final: true, audioEvidence: { audioDigest: 'c'.repeat(64), durationMs: 1000 } });
            assert.ok(result.attestationId); return { ...result, owner: { ...owner, epoch: claim.epoch } };
        };
        let moveDraft, movePreview, moveProof, moveResult;
        await h.caseRun('three actual domain roots move atomically with one receipt and semantic event', async () => {
            moveDraft = (await service.createFromProposal(identity, c.projectId, { requestId: c.op('draft'), actions: ['one', 'two', 'three'].map(taskId => ({ kind: 'move_task', taskId, parentTaskId: 'parent' })) })).draft;
            movePreview = await service.preview(identity, moveDraft.draftId, { expectedRevision: 0, requestId: c.op('preview') });
            assert.equal((await c.taskData('one')).parentTaskId, null);
            moveProof = await proof(moveDraft, movePreview);
            moveResult = await service.apply(identity, moveDraft.draftId, { previewId: movePreview.previewId, attestationId: moveProof.attestationId });
            for (const taskId of ['one', 'two', 'three']) assert.equal((await c.taskData(taskId)).parentTaskId, 'parent');
            assert.equal((await c.taskData('child')).parentTaskId, 'one');
            const op = (await operationRef(suite.db, movePreview.operationId).get()).data();
            assert.equal(op.origin, 'ai'); assert.equal(op.inverse.kind, 'bulkTaskMove');
            const event = (await eventRef(suite.db, movePreview.operationId).get()).data();
            assert.equal(event.origin, 'ai'); assert.ok(event.semantic);
            assert.equal((await service.read(identity, moveDraft.draftId)).status, 'committed');
            assert.equal((await suite.db.collection(V.attestations).doc(moveProof.attestationId).get()).data().consumedReceiptId, movePreview.operationId);
        }, results);
        await h.caseRun('closed expired confirmation replays same receipt and current membership is enforced', async () => {
            assert.ok(moveResult, 'prior atomic apply must pass');
            await voice.close(moveProof.owner); suite.advance(31 * 60000);
            const input = { previewId: movePreview.previewId, attestationId: moveProof.attestationId };
            const before = await c.taskData('one');
            assert.deepEqual(await service.apply(identity, moveDraft.draftId, input), moveResult);
            assert.deepEqual(await c.taskData('one'), before);
            const member = c.memberRef('owner'), saved = (await member.get()).data();
            try { await member.update({ active: false }); await assert.rejects(service.apply(identity, moveDraft.draftId, input)); }
            finally { await member.set(saved); }
        }, results);
        await h.caseRun('one Undo restores all three roots and preserves their descendants', async () => {
            assert.ok(moveResult, 'prior atomic apply must pass');
            await recovery.undoOperation(identity, c.projectId, movePreview.operationId, { operationId: c.op('undo') });
            for (const taskId of ['one', 'two', 'three']) assert.equal((await c.taskData(taskId)).parentTaskId, null);
            assert.equal((await c.taskData('child')).parentTaskId, 'one');
        }, results);
        await h.caseRun('second-action correction keeps other actions stable and all field effects commit together', async () => {
            const draft = (await service.createFromProposal(identity, c.projectId, { requestId: c.op('fields'), actions: ['one', 'two', 'three'].map(taskId => ({ kind: 'field_update', taskId, patch: { title: `Updated ${taskId}` } })) })).draft;
            const corrected = (await service.correct(identity, draft.draftId, { expectedRevision: 0, actionId: draft.actions[1].actionId, patch: { patch: { title: 'Corrected second' } }, requestId: c.op('correct') })).draft;
            assert.deepEqual(corrected.actions[0], draft.actions[0]); assert.deepEqual(corrected.actions[2], draft.actions[2]);
            assert.equal(corrected.actions[1].actionId, draft.actions[1].actionId);
            const preview = await service.preview(identity, draft.draftId, { expectedRevision: corrected.revision, requestId: c.op('preview-fields') }), attested = await proof(corrected, preview);
            await service.apply(identity, draft.draftId, { previewId: preview.previewId, attestationId: attested.attestationId });
            assert.equal((await c.taskData('one')).title, 'Updated one'); assert.equal((await c.taskData('two')).title, 'Corrected second'); assert.equal((await c.taskData('three')).title, 'Updated three');
        }, results);
        await h.caseRun('changed project fence rejects all effects and preserves unconsumed proof', async () => {
            const draft = (await service.createFromProposal(identity, c.projectId, { requestId: c.op('stale'), actions: ['one', 'two', 'three'].map(taskId => ({ kind: 'field_update', taskId, patch: { title: 'Must not apply' } })) })).draft;
            const preview = await service.preview(identity, draft.draftId, { expectedRevision: 0, requestId: c.op('stale-preview') }), attested = await proof(draft, preview);
            await c.projectRef.update({ acceptanceFence: 'changed' });
            await assert.rejects(service.apply(identity, draft.draftId, { previewId: preview.previewId, attestationId: attested.attestationId }));
            for (const taskId of ['one', 'two', 'three']) assert.notEqual((await c.taskData(taskId)).title, 'Must not apply');
            assert.equal((await service.read(identity, draft.draftId)).status, 'active');
            assert.equal((await suite.db.collection(V.attestations).doc(attested.attestationId).get()).data().consumedReceiptId, null);
            assert.equal((await operationRef(suite.db, preview.operationId).get()).exists, false);
        }, results);
    } finally { suite.server.closeAllConnections?.(); await suite.close(); }
    h.finish(results);
}
main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
