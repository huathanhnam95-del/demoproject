'use strict';
const { createHash } = require('crypto');
const C = require('../collections');
const W = require('../workflow-write-service');
const { buildLeadCreateData, buildLeadPatchData } = require('../lead-service');
const { allocateNextCrmId, normalizeCrmId, isValidCrmId } = require('../business-id-service');
const finance = require('../finance-write-service');
const { createEntranceTest } = require('../entrance-test-write-service');
const { createTransactionWorkspace } = require('./transaction-workspace');
const { inspectDraft } = require('./draft-service');
function fail(code, message, status = 400) { throw Object.assign(new Error(message), { code, status }); }

async function prepareCommands({ db, transaction, draft, identity, nowMs, testTokens = {}, publicOrigin }) {
    if (!identity?.uid || identity.uid !== draft.actorUid) fail('FORBIDDEN', 'Draft owner does not match the current operator.', 403);
    if (!Number.isFinite(nowMs) || nowMs >= draft.expiresAtMs || !['draft', 'review'].includes(draft.status)) fail('DRAFT_UNAVAILABLE', 'Draft is expired or unavailable.', 409);
    const inspection = inspectDraft(draft);
    if (!inspection.readyForPreview) {
        const issues = [...inspection.questions, ...inspection.errors];
        if (!draft.actions.length) issues.push({ code: 'EMPTY_DRAFT' });
        throw Object.assign(new Error('Correct the listed draft fields before reviewing.'), { code: 'DRAFT_INCOMPLETE', status: 422, details: { issues: issues.slice(0, 200) } });
    }
    const workspace = createTransactionWorkspace({ db, transaction, seed: JSON.stringify([draft.draftId, draft.actorUid, draft.revision]) });
    const context = { user: identity, nowMs, serverTimestamp: () => new Date(nowMs), publicOrigin };
    const results = {};
    function resolve(value) {
        if (Array.isArray(value)) return value.map(resolve);
        if (!value || typeof value !== 'object') return value;
        if (Object.hasOwn(value, '$ref')) {
            const [actionId, field] = value.$ref.split('.');
            if (!Object.hasOwn(results, actionId) || !Object.hasOwn(results[actionId], field)) fail('INVALID_REFERENCE', 'Draft reference is unresolved.');
            return results[actionId][field];
        }
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolve(child)]));
    }
    for (const actionId of inspection.executionOrder) {
        if (['__proto__', 'constructor', 'prototype'].includes(actionId)) fail('INVALID_ACTION', 'Reserved action identity.');
        const action = draft.actions.find(item => item.actionId === actionId), values = resolve(action.values);
        results[actionId] = await workspace.execute(async stagedDb => {
            if (values.agentSourceId !== undefined && values.agentSourceId !== null && values.agentSourceId !== '') {
                const sourceId = values.agentSourceId;
                if (typeof sourceId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(sourceId)) fail('AGENT_SOURCE_UNAVAILABLE', 'Choose an available agent source.', 422);
                await stagedDb.runTransaction(async tx => {
                    const prior = action.kind === 'updateLead' ? [C.CRM_LEADS, values.leadId] : action.kind === 'updateStudent' ? [C.CRM_STUDENTS, values.studentId] : null;
                    if (prior) {
                        const existing = await tx.get(stagedDb.collection(prior[0]).doc(prior[1]));
                        if (existing.exists && existing.data()?.agentSourceId === sourceId) return;
                    }
                    const snapshot = await tx.get(stagedDb.collection(C.CRM_AGENT_SOURCES).doc(sourceId));
                    const source = snapshot.data() || {};
                    if (!snapshot.exists || source.deletedAt || (source.status || 'active') !== 'active') fail('AGENT_SOURCE_UNAVAILABLE', 'The selected agent source is no longer active. Choose an active source and review again.', 422);
                });
            }
            if (['createEnrollment', 'seedClassSchedule'].includes(action.kind)) {
                await stagedDb.runTransaction(async tx => {
                    let teacherUid = values.teacherUid;
                    if (teacherUid !== undefined && teacherUid !== null && teacherUid !== ''
                        && (typeof teacherUid !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(teacherUid) || teacherUid === 'all')) {
                        fail('TEACHER_UNAVAILABLE', 'Choose one available teacher or clear the teacher selection.', 422);
                    }
                    if (values.classId) {
                        const classroom = await tx.get(stagedDb.collection(C.CRM_CLASSROOMS).doc(values.classId));
                        if (!classroom.exists) fail('CLASSROOM_NOT_FOUND', 'Classroom not found.', 404);
                        const inherited = classroom.data()?.primaryTeacherUid || null;
                        if (action.kind === 'createEnrollment' && teacherUid && teacherUid !== inherited) {
                            fail('TEACHER_CLASS_MISMATCH', 'The selected teacher does not match this class. Clear the teacher selection or choose the matching class.', 422);
                        }
                        if (action.kind === 'seedClassSchedule' && !teacherUid) teacherUid = inherited;
                    }
                    if (!teacherUid) return;
                    if (typeof teacherUid !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(teacherUid) || teacherUid === 'all') {
                        fail('TEACHER_UNAVAILABLE', 'The class teacher is unavailable. Select an available teacher.', 422);
                    }
                    const teacher = await tx.get(stagedDb.collection(C.USERS).doc(teacherUid));
                    const account = teacher.data() || {};
                    if (!teacher.exists || account.deletedAt || account.disabled === true || !(account.isTeacher === true || account.crmRole === 'teacher')) {
                        fail('TEACHER_UNAVAILABLE', 'The selected teacher is no longer available. Choose an available teacher and review again.', 422);
                    }
                });
            }
            switch (action.kind) {
                case 'createLead': {
                    const lead = buildLeadCreateData(values, context);
                    const allocation = await allocateNextCrmId(stagedDb, context);
                    lead.crmId = allocation.crmId;
                    const ref = stagedDb.collection(C.CRM_LEADS).doc();
                    await stagedDb.runTransaction(tx => tx.set(ref, lead));
                    return { leadId: ref.id };
                }
                case 'updateLead':
                    return stagedDb.runTransaction(async tx => {
                        const ref = stagedDb.collection(C.CRM_LEADS).doc(values.leadId), snapshot = await tx.get(ref);
                        if (!snapshot.exists) fail('LEAD_NOT_FOUND', 'Lead not found.', 404);
                        tx.set(ref, buildLeadPatchData(snapshot.data(), values, context), { merge: true });
                        return { leadId: ref.id };
                    });
                case 'createStudent': return W.saveStudent(stagedDb, null, values, context);
                case 'updateStudent': return W.saveStudent(stagedDb, values.studentId, values, context);
                case 'convertLead': return { leadId: values.leadId, ...await W.convertLead(stagedDb, values.leadId, context) };
                case 'createEnrollment': {
                    const result = await W.createEnrollment(stagedDb, values, context);
                    return { ...result, classId: result.enrollment.classId };
                }
                case 'seedClassSchedule': {
                    const seedBatchId = createHash('sha256').update(JSON.stringify([draft.draftId, draft.revision, actionId])).digest('hex');
                    return { classId: values.classId, ...await W.seedClassSchedule(stagedDb, values.classId, { ...values, seedBatchId }, context) };
                }
                case 'createInvoice': return finance.createInvoice(stagedDb, { ...values, discountAmount: values.discount }, context);
                case 'recordPayment': return finance.recordPayment(stagedDb, { ...values, paymentDate: values.paidAt }, context);
                case 'createEntranceTest': return createEntranceTest(stagedDb, values, { ...context, deliveryToken: testTokens[actionId] });
                default: fail('INVALID_ACTION', 'Unsupported CRM action.');
            }
        });
        await workspace.execute(stagedDb => stagedDb.runTransaction(tx => {
            tx.set(stagedDb.collection(C.CRM_AUDIT_LOGS).doc(), {
                action: `data_input.${action.kind}`, actorUid: identity.uid, draftId: draft.draftId,
                revision: draft.revision, actionId, createdAt: new Date(nowMs)
            });
        }));
    }
    // Resolve navigation from the staged canonical record, never from proposed URLs
    // or database IDs. These reads are part of the review's stale-record checks.
    for (const result of Object.values(results)) {
        if (!result.studentId) continue;
        const student = await workspace.execute(stagedDb => stagedDb.runTransaction(tx => tx.get(stagedDb.collection(C.CRM_STUDENTS).doc(result.studentId))));
        const crmId = normalizeCrmId(student.data()?.crmId);
        if (student.exists && isValidCrmId(crmId)) result.studentLink = `/crm-admin#students/${crmId}`;
    }
    return { results, plan: await workspace.prepare(), flush: () => workspace.flush() };
}

module.exports = { prepareCommands };
