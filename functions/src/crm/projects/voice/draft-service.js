'use strict';
const { createDraftStore } = require('../../../ai-assistance/drafts/draft-store');
const { createVoiceConfirmationService } = require('../../../ai-assistance/voice/confirmation-service');
const { strict, reject, digest, deepFreeze } = require('../../../ai-assistance/accounting/money-pricing');
const { createProjectsVoiceContextAdapter, normalizeContextHints } = require('./context-adapter');
const { assertStaffIdentity } = require('../budget-service');
const { isProjectsFeatureEnabled } = require('../feature-config');
const { id, uid, validateTaskPatch, validateTaskInput, validateProjectInput } = require('../domain/validation');
const { projectCollection, projectRef } = require('../domain/storage');
const { runTransactionWithClosedRetry } = require('../domain/transaction-retry');
const PROJECT_AI_PREVIEWS = 'crmProjectAiPreviews';
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function revision(value) { if (!Number.isSafeInteger(value) || value < 0) reject('INVALID_REVISION', 'A current nonnegative revision is required.'); return value; }
function createProjectsDraftService({ db, accessService, commandService, recoveryService, now = Date.now, engineeringMode = false, taskLinksService = null } = {}) {
    if (!db || typeof commandService?.runCommand !== 'function' || typeof recoveryService?.prepareFieldBatch !== 'function' || typeof recoveryService?.prepareMoveBatch !== 'function') throw TypeError('Projects drafts require the canonical command service and batch preparers.');
    const runTransaction = work => runTransactionWithClosedRetry(db, work);
    const time = () => { const value = Number(now()); if (!Number.isSafeInteger(value)) reject('INVALID_TIME', 'Invalid Projects draft clock.'); return value; };
    const previewRef = previewId => db.collection(PROJECT_AI_PREVIEWS).doc(id(previewId, 'preview ID'));
    async function authorize({ tx, actorUid, scope }) {
        if (!isProjectsFeatureEnabled('projects')) reject('PROJECTS_DISABLED', 'Projects is not enabled.', 404);
        if (scope.mode === 'create_project') { const identity = assertStaffIdentity(await accessService.assertTransactionEligible(tx, uid(actorUid))); return identity.uid === actorUid; }
        const access = await accessService.assertTransactionContentAccess(tx, uid(actorUid), id(scope.projectId), { write: true, roles: ['Owner', 'Editor'] });
        assertStaffIdentity(access.identity); if (access.identity.uid !== actorUid || (access.project.data.lifecycle || 'active') !== 'active') reject('DRAFT_FORBIDDEN', 'Current active Projects write access is required.', 403); return true;
    }
    function normalizeActions(actions) {
        if (!Array.isArray(actions) || !actions.length || actions.length > 20) reject('INVALID_ACTIONS', 'Projects drafts require 1 through 20 actions.');
        const normalized = actions.map(action => {
            if (action.kind === 'create_project') { strict(action, ['actionId', 'kind', 'project']); strict(action.project, ['name', 'description']); return { actionId: id(action.actionId), kind: action.kind, project: validateProjectInput(action.project) }; }
            if (action.kind === 'update_project') { strict(action, ['actionId', 'kind', 'patch']); strict(action.patch, ['name', 'description']); if (!Object.keys(action.patch).length) reject('INVALID_ACTIONS', 'Project changes are empty.'); const checked = validateProjectInput({ name: 'Current project', ...action.patch }); return { actionId: id(action.actionId), kind: action.kind, patch: Object.fromEntries(Object.keys(action.patch).map(key => [key, checked[key]])) }; }
            if (action.kind === 'create_task') { strict(action, ['actionId', 'kind', 'task', 'sectionId', 'parentTaskId']); strict(action.task, ['title', 'status', 'ownerUid', 'assigneeUids', 'startDate', 'dueDate', 'values']); if (!!action.sectionId === !!action.parentTaskId) reject('INVALID_ACTIONS', 'Choose one task creation destination.'); return { actionId: id(action.actionId), kind: action.kind, task: validateTaskInput(action.task), ...(action.parentTaskId ? { parentTaskId: id(action.parentTaskId) } : { sectionId: id(action.sectionId) }) }; }
            if (action.kind === 'field_update') { strict(action, ['actionId', 'kind', 'taskId', 'patch']); const patch = validateTaskPatch(action.patch); if (patch.lifecycle !== undefined) reject('LIFECYCLE_COMMAND_REQUIRED', 'Draft field updates cannot change lifecycle.'); return { actionId: id(action.actionId), kind: action.kind, taskId: id(action.taskId), patch }; }
            if (action.kind === 'move_task') { strict(action, ['actionId', 'kind', 'taskId', 'parentTaskId']); return { actionId: id(action.actionId), kind: action.kind, taskId: id(action.taskId), parentTaskId: id(action.parentTaskId) }; }
            reject('UNSUPPORTED_DRAFT_ACTION', 'Unsupported Projects draft action.');
        });
        if (new Set(normalized.map(a => a.kind)).size !== 1 || new Set(normalized.map(a => a.taskId)).size !== normalized.length) reject('INVALID_ACTIONS', 'Drafts require homogeneous actions on distinct tasks.');
        if (normalized[0].kind === 'move_task' && new Set(normalized.map(a => a.parentTaskId)).size !== 1) reject('INVALID_ACTIONS', 'Move drafts require one existing destination parent.');
        return normalized;
    }
    const store = createDraftStore({ db, runTransaction, now: time, featureAdapters: { projects: { authorize, normalizeActions, normalizeScope(value) { if (value?.mode === 'create_project') { strict(value, ['mode']); return { mode: 'create_project' }; } strict(value, ['projectId']); return { projectId: id(value.projectId) }; } } } });
    const identityFor = (identity, draftId) => ({ actorUid: uid(identity?.uid), feature: 'projects', draftId: id(draftId) });
    async function task(tx, projectId, taskId) { const snap = await tx.get(projectCollection(db, projectId, 'tasks').doc(taskId)); const row = snap.exists ? snap.data() : null; if (!row || row.projectId !== projectId) reject('TASK_NOT_FOUND', 'Draft task is unavailable in this project.', 404); return row; }
    async function prepareBatch(transaction, draft, saved = null) {
        const projectId = draft.scope.projectId, actorUid = draft.actorUid;
        const action = draft.actions[0];
        if (['create_project', 'create_task', 'update_project'].includes(action.kind)) {
            if (draft.actions.length !== 1 || (action.kind === 'create_project') !== (draft.scope.mode === 'create_project')) reject('INVALID_ACTIONS', 'Creation scope and action must match.');
            let batch = saved;
            if (!batch) {
                const operationId = `draft-${digest([actorUid, action.actionId])}`;
                if (action.kind === 'create_project') batch = { kind: action.kind, payload: { operationId, ...action.project } };
                else {
                    const project = await transaction.get(projectRef(db, projectId)); if (!project.exists) reject('PROJECT_NOT_FOUND', 'Project is unavailable.', 404);
                    batch = { kind: action.kind, payload: action.kind === 'create_task' ? { operationId, ...action.task, ...(action.parentTaskId ? { parentTaskId: action.parentTaskId } : { sectionId: action.sectionId }), expectedStructureRevision: revision(project.data().structureRevision ?? 0) } : { operationId, ...action.patch, expectedRevision: revision(project.data().revision ?? 0) } };
                }
            }
            const method = { create_project: 'prepareCreateProject', create_task: 'prepareCreateTask', update_project: 'prepareUpdateProject' }[action.kind];
            const prepared = await commandService[method]({ transaction, actorUid, projectId, payload: batch.payload });
            return { ...prepared, batchInput: copy(batch) };
        }
        if (draft.scope.mode === 'create_project') reject('INVALID_ACTIONS', 'New project scope requires a project creation action.');
        let batch = saved;
        if (!batch) {
            const changes = [];
            for (const action of draft.actions) { const row = await task(transaction, projectId, action.taskId); changes.push({ taskId: action.taskId, expectedRevision: revision(row.revision ?? 0), ...(action.kind === 'field_update' ? { patch: action.patch } : {}) }); }
            if (draft.actions[0].kind === 'field_update') batch = { kind: 'field_update', changes };
            else {
                const parentTaskId = draft.actions[0].parentTaskId, parent = await task(transaction, projectId, parentTaskId), project = await transaction.get(projectRef(db, projectId));
                if (!project.exists) reject('PROJECT_NOT_FOUND', 'Project is unavailable.', 404);
                const siblings = await transaction.get(projectCollection(db, projectId, 'tasks').where('parentTaskId', '==', parentTaskId).limit(501));
                if (siblings.docs.length > 500) reject('CONTEXT_LIMIT', 'Move destination exceeds the bounded child count.');
                const moved = new Set(changes.map(change => change.taskId)); const index = siblings.docs.filter(doc => !moved.has(doc.id) && (doc.data().lifecycle || 'active') === 'active').length;
                batch = { kind: 'move_task', moves: changes, destination: { parentTaskId, expectedParentRevision: revision(parent.revision ?? 0), index }, expectedStructureRevision: revision(project.data().structureRevision ?? 0) };
            }
        }
        const prepared = batch.kind === 'field_update'
            ? await recoveryService.prepareFieldBatch({ transaction, actorUid, projectId, changes: batch.changes })
            : await recoveryService.prepareMoveBatch({ transaction, actorUid, projectId, moves: batch.moves, destination: batch.destination, expectedStructureRevision: batch.expectedStructureRevision });
        if (typeof prepared.fenceDigest !== 'string' || typeof prepared.flush !== 'function') reject('PREVIEW_INTEGRITY', 'Batch preparer contract is incomplete.', 409);
        return { ...prepared, batchInput: copy(batch) };
    }
    async function savedPreview(tx, draft, previewId) {
        const snap = await tx.get(previewRef(previewId)), row = snap.exists ? snap.data() : null;
        if (!row || row.actorUid !== draft.actorUid || row.draftId !== draft.draftId || digest(row.scope || { projectId: row.projectId }) !== digest(draft.scope)) reject('PREVIEW_NOT_FOUND', 'Projects preview not found.', 404);
        if (row.previewId !== previewId || row.feature !== 'projects' || row.operationId !== `ai-${digest(['apply', previewId])}`) reject('PREVIEW_INTEGRITY', 'Saved preview identity is invalid.', 409);
        return row;
    }
    const baseVoice = createProjectsVoiceContextAdapter({ db, accessService, now: time, taskLinksService });
    const voiceAdapter = Object.freeze({
        authorize: baseVoice.authorize,
        async resolveContext({ tx, actorUid, contextHints = {} }) {
            strict(contextHints, ['mode', 'projectId', 'view', 'selectedTaskIds', 'filters', 'draftId', 'previewId']);
            const { draftId, previewId, ...planningHints } = contextHints; const hints = normalizeContextHints(planningHints);
            const base = await baseVoice.resolveContext({ tx, actorUid, contextHints: hints });
            if (!draftId) { if (previewId) reject('INVALID_CONTEXT_HINTS', 'Preview requires its draft reference.'); return base; }
            const draft = await store.prepareCurrent(tx, { actorUid, feature: 'projects', draftId });
            if (draft.scope.projectId !== hints.projectId || draft.scope.mode !== hints.mode) reject('DRAFT_NOT_FOUND', 'Draft belongs to another project.', 404);
            let preview = null, binding = null;
            if (previewId) {
                preview = await savedPreview(tx, draft, id(previewId));
                if (draft.status === 'active' && !draft.expired && draft.revision === preview.revision && draft.draftDigest === preview.draftDigest && preview.expiresAtMs > time()) {
                    // Revalidate the complete domain fence before speech can
                    // authorize it. Only command execute may flush this batch.
                    try {
                        const current = await prepareBatch(tx, draft, preview.batchInput);
                        if (current.fenceDigest === preview.fenceDigest) binding = preview.binding;
                    } catch (error) {
                        const stale = new Set(['STALE_REVISION', 'STALE_STRUCTURE_REVISION', 'STALE_ANCESTOR_REVISION', 'TASK_NOT_FOUND', 'TASK_LIFECYCLE_FORBIDDEN', 'PROJECT_LIFECYCLE_FORBIDDEN', 'INVALID_PARENT_REFERENCE', 'INVALID_SECTION_REFERENCE', 'OVERLAPPING_MOVE_ROOTS', 'TASK_CYCLE', 'EMPTY_BATCH', 'INVALID_INDEX']);
                        // Caller/assignee authority failures and unexpected
                        // validation failures must retain their explicit denial.
                        if (error.status === 403 || !stale.has(error.code)) throw error;
                    }
                }
            }
            const context = { ...base.context, draft: { draftId: draft.draftId, revision: draft.revision, draftDigest: draft.draftDigest, status: draft.status, actions: draft.actions }, preview: preview ? { previewId: preview.previewId, current: !!binding, impact: preview.impact } : null };
            if (Buffer.byteLength(JSON.stringify(context)) > 32768) reject('CONTEXT_LIMIT', 'Draft voice context exceeds its byte limit.');
            return { summary: `${base.summary} Draft actions: ${draft.actions.length}. ${binding ? 'Current exact preview ready for confirmation.' : 'No current executable preview.'}`, context, previewBinding: binding };
        },
        confirm({ text }) { const normalized = typeof text === 'string' ? text.trim().toLowerCase().replace(/[.,!?]+$/u, '') : ''; return ['i confirm these changes', 'confirm this preview'].includes(normalized); }
    });
    const confirmation = createVoiceConfirmationService({ db, runTransaction, now: time, featureAdapters: { projects: voiceAdapter }, engineeringMode });
    return Object.freeze({
        voiceAdapter,
        createFromProposal(identity, projectId, input) { strict(input, ['requestId', 'actions']); return store.create({ actorUid: uid(identity?.uid), feature: 'projects', requestId: input.requestId, scope: projectId?.mode === 'create_project' ? { mode: 'create_project' } : { projectId: id(projectId) }, actions: input.actions }); },
        correct(identity, draftId, input) { strict(input, ['expectedRevision', 'actionId', 'patch', 'requestId']); return store.correct({ ...identityFor(identity, draftId), ...input }); },
        decline(identity, draftId, input) { strict(input, ['expectedRevision', 'requestId']); return store.decline({ ...identityFor(identity, draftId), ...input }); },
        read(identity, draftId) { return store.read(identityFor(identity, draftId)); },
        async preview(identity, draftId, input) {
            strict(input, ['expectedRevision', 'requestId']); revision(input.expectedRevision); id(input.requestId, 'request ID');
            return runTransaction(async tx => {
                const draft = await store.prepareCurrent(tx, { ...identityFor(identity, draftId), expectedRevision: input.expectedRevision });
                if (draft.status !== 'active' || draft.expired) reject('DRAFT_UNAVAILABLE', 'A current active draft is required.', 409);
                const previewId = digest([draft.actorUid, draft.draftId, input.requestId]), ref = previewRef(previewId), previous = await tx.get(ref), prepared = await prepareBatch(tx, draft);
                if (previous.exists) { const saved = previous.data(); if (saved.draftDigest !== draft.draftDigest || saved.fenceDigest !== prepared.fenceDigest || saved.revision !== draft.revision) reject('PREVIEW_REQUEST_CONFLICT', 'Preview request is bound to different revisions or fences.', 409); return deepFreeze({ ...copy(saved), replayed: true, expired: saved.expiresAtMs <= time() }); }
                const expiresAtMs = Math.min(draft.expiresAtMs, time() + 5 * 60000), binding = { actorUid: draft.actorUid, feature: 'projects', draftId: draft.draftId, previewId, revision: draft.revision, draftDigest: draft.draftDigest, ...(draft.scope.projectId ? { projectId: draft.scope.projectId } : {}), expiresAtMs };
                const saved = { previewId, actorUid: draft.actorUid, feature: 'projects', scope: copy(draft.scope), projectId: draft.scope.projectId || prepared.preview.projectId || prepared.preview.project?.id, draftId: draft.draftId, revision: draft.revision, draftDigest: draft.draftDigest, actions: copy(draft.actions), batchInput: prepared.batchInput, fenceDigest: prepared.fenceDigest, impact: copy(prepared.preview), binding, operationId: `ai-${digest(['apply', previewId])}`, expiresAtMs };
                if (Buffer.byteLength(JSON.stringify(saved)) > 65536) reject('PREVIEW_LIMIT', 'Preview exceeds its byte limit.'); tx.create(ref, saved); return deepFreeze({ ...copy(saved), replayed: false, expired: false });
            });
        },
        async apply(identity, draftId, input) {
            strict(input, ['previewId', 'attestationId']); id(input.previewId); id(input.attestationId);
            const who = identityFor(identity, draftId);
            const initial = await runTransaction(async tx => { const draft = await store.prepareCurrent(tx, who); return savedPreview(tx, draft, input.previewId); });
            return commandService.runCommand({ actorUid: who.actorUid, command: 'applyAiDraft', projectId: initial.projectId, creation: initial.scope?.mode === 'create_project', targetId: who.draftId, operationId: initial.operationId, payload: { draftId: who.draftId, previewId: input.previewId, attestationId: input.attestationId }, access: initial.actions[0].kind === 'update_project' ? { owner: true, roles: ['Owner'] } : { write: true, roles: ['Owner', 'Editor'] },
                prepareAuthorization: async ({ transaction }) => {
                    const draft = await store.prepareCurrent(transaction, who), preview = await savedPreview(transaction, draft, input.previewId);
                    if (digest(preview) !== digest(initial)) reject('PREVIEW_INTEGRITY', 'Immutable preview changed.', 409);
                    const proof = await confirmation.prepareConsumption(transaction, { actorUid: who.actorUid, feature: 'projects', attestationId: input.attestationId, binding: preview.binding, receiptId: preview.operationId });
                    if (proof.replayed) { if (draft.status !== 'committed' || draft.receiptId !== preview.operationId) reject('DRAFT_COMMIT_CONFLICT', 'Consumed confirmation has no matching committed draft.', 409); }
                    else if (draft.status !== 'active' || draft.expired || preview.expiresAtMs <= time() || draft.revision !== preview.revision || draft.draftDigest !== preview.draftDigest) reject('STALE_PREVIEW', 'Preview no longer matches the current draft.', 409);
                    return { replayed: proof.replayed, consume() { proof.consume(); store.stageCommitted(transaction, { draft, receiptId: preview.operationId }); } };
                },
                execute: async ({ transaction }) => { const draft = { actorUid: who.actorUid, scope: initial.scope || { projectId: initial.projectId }, actions: initial.actions }; const prepared = await prepareBatch(transaction, draft, initial.batchInput); if (prepared.fenceDigest !== initial.fenceDigest) reject('PREVIEW_FENCE_CHANGED', 'Project data changed after preview.', 409); return { ...prepared.flush(), origin: 'ai' }; }
            });
        }
    });
}
module.exports = { createProjectsDraftService, PROJECT_AI_PREVIEWS };
