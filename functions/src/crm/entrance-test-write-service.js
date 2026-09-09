'use strict';
const C = require('./collections');
const { formatCrmId } = require('./business-id-service');
const { buildLeadStageSyncPatch } = require('./lead-service');
const { TEST_VERSION, hashTokenToTestId } = require('../entrance-test/test36plus');
const { buildEntranceTestLinks } = require('./public-origin');
const clean = value => String(value || '').trim();
function fail(code, message, status = 400) { throw Object.assign(new Error(message), { code, status }); }

async function createEntranceTest(db, input, context) {
    const token = context.deliveryToken;
    if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{32,128}$/.test(token)) fail('TEST_IDENTITY_REQUIRED', 'A server-generated test identity is required.');
    if (!['entrance_test_36plus_v1', 'segmental_screening_v1'].includes(input.testType)) fail('INVALID_TEST_TYPE', 'Invalid test type.');
    const isLead = !!clean(input.leadId), targetId = clean(isLead ? input.leadId : input.studentId), testId = hashTokenToTestId(token);
    if (!targetId) fail('VALIDATION_ERROR', 'A lead or student is required.');
    return db.runTransaction(async tx => {
        const targetRef = db.collection(isLead ? C.CRM_LEADS : C.CRM_STUDENTS).doc(targetId), targetSnap = await tx.get(targetRef);
        if (!targetSnap.exists) fail('TARGET_NOT_FOUND', 'Lead or student not found.', 404);
        const target = targetSnap.data() || {}, leadId = isLead ? targetId : clean(target.leadId), studentId = isLead ? clean(target.studentId) : targetId;
        if (input.studentId && isLead && input.studentId !== studentId) fail('TEST_LINK_MISMATCH', 'Test student does not match the lead.');
        const leadRef = isLead ? targetRef : leadId ? db.collection(C.CRM_LEADS).doc(leadId) : null;
        const leadSnap = isLead ? targetSnap : leadRef ? await tx.get(leadRef) : null;
        const lead = leadSnap?.exists ? leadSnap.data() : null;
        const testRef = db.collection(C.ENTRANCE_TESTS).doc(testId);
        if ((await tx.get(testRef)).exists) fail('TEST_IDENTITY_CONFLICT', 'Test identity already exists.', 409);
        let crmId = clean(target.crmId || lead?.crmId), counterRef, nextIndex;
        if (!crmId) {
            counterRef = db.collection(C.CRM_COUNTERS).doc('crmId');
            const counter = await tx.get(counterRef), value = Number(counter.data()?.nextIndex);
            nextIndex = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
            crmId = formatCrmId(nextIndex);
        }
        if (counterRef) tx.set(counterRef, { nextIndex: nextIndex + 1, lastAllocatedCrmId: crmId, updatedAt: context.serverTimestamp() }, { merge: true });
        if (!clean(target.crmId)) tx.set(targetRef, { crmId, updatedAt: context.serverTimestamp(), updatedBy: context.user.uid }, { merge: true });
        if (lead) {
            const patch = buildLeadStageSyncPatch(lead, 'test_scheduled', context) || {};
            if (!clean(lead.crmId)) patch.crmId = crmId;
            if (Object.keys(patch).length) tx.set(leadRef, patch, { merge: true });
        }
        tx.set(testRef, { leadId: leadId || null, studentId: studentId || null, crmId, testType: input.testType,
            version: input.testType === 'segmental_screening_v1' ? input.testType : TEST_VERSION, status: 'created', deliveryToken: token,
            createdAt: context.serverTimestamp(), createdBy: context.user.uid, createdByEmail: context.user.email || null, startedAt: null, submittedAt: null });
        const links = buildEntranceTestLinks(null, { deliveryToken: token, testId }, { PUBLIC_BASE_URL: context.publicOrigin });
        return { testId, testLink: links.testLink, resultLink: links.resultLink };
    });
}
module.exports = { createEntranceTest };
