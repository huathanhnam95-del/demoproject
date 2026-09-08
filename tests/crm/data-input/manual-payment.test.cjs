'use strict';

const assert = require('assert');
const express = require('express');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const registerFinanceRoutes = require('../../../functions/src/routes/admin/finance');
const createCrmRouter = require('../../../functions/src/routes/admin/create-crm-router');
const financeWrite = require('../../../functions/src/crm/finance-write-service');
const {
    CRM_COMMISSIONS,
    CRM_INVOICES,
    CRM_PAYMENTS,
    CRM_STUDENTS,
    CRM_ENROLLMENTS,
    USERS
} = require('../../../functions/src/crm/collections');
const {
    buildRes,
    createFakeDb,
    createReq,
    getRouteHandlers,
    invokeHandlers
} = require('../../crm/route-test-helpers');

const ROOT = path.resolve(__dirname, '../../..');

function fixture(overrides = {}) {
    return {
        [`${USERS}/admin-1`]: { isAdmin: true, email: 'admin@example.test' },
        [`${CRM_STUDENTS}/student-1`]: { name: 'Student One' },
        [`${CRM_INVOICES}/invoice-1`]: {
            studentId: 'student-1',
            currency: 'USD',
            amount: 100,
            netAmount: 100,
            paidAmount: 0,
            outstandingAmount: 100,
            status: 'open',
            commissionSplits: { counselor: { actorUid: 'counselor-1', amount: 10 } }
        },
        ...overrides
    };
}

function makeRouter(db, authState = {}) {
    const paymentAuth = {
        async getUser(uid) {
            const account = authState[uid] || {};
            return {
                disabled: account.disabled ?? false,
                tokensValidAfterTime: account.tokensValidAfterTime || '1970-01-01T00:00:00Z'
            };
        }
    };
    const router = express.Router();
    registerFinanceRoutes(router, {
        db,
        paymentAuth,
        requireAdminHandlers: [],
        serverTimestamp: () => 'SERVER_TS',
        writeAuditLog: async () => {},
        sendSuccess: (res, payload, message) => res.status(200).json({ success: true, message, ...payload }),
        sendError: (res, status, error, message, details) => res.status(status).json({ success: false, error, message, details })
    });
    return router;
}

function makeComposedRouter(db, authState = {}) {
    const paymentAuth = {
        async getUser(uid) {
            const account = authState[uid] || {};
            return {
                disabled: account.disabled ?? false,
                tokensValidAfterTime: account.tokensValidAfterTime || '1970-01-01T00:00:00Z'
            };
        }
    };
    const passThrough = (_req, _res, next) => next();
    return createCrmRouter({
        db,
        authMiddleware: passThrough,
        adminMiddleware: passThrough,
        admin: { auth: () => paymentAuth },
        serverTimestamp: () => 'SERVER_TS',
        writeAuditLog: async () => {},
        sendSuccess: (res, payload, message) => res.status(200).json({ success: true, message, ...payload }),
        sendError: (res, status, error, message, details) => res.status(status).json({ success: false, error, message, details }),
        identity: {
            generateClassCode: () => {},
            lookupUserByEmail: async () => null,
            forceLinkProfile: async () => null
        }
    });
}

async function postPayment(router, body, uid = 'admin-1') {
    const req = createReq({ body });
    req.user = { uid, email: `${uid}@example.test`, auth_time: 1000 };
    const res = buildRes();
    await invokeHandlers(getRouteHandlers(router, '/payments', 'post'), req, res);
    return res;
}

function paymentBody(overrides = {}) {
    return {
        operationId: 'payment-attempt-1',
        invoiceId: 'invoice-1',
        studentId: 'student-1',
        amount: 25,
        method: 'bank-transfer',
        paymentDate: '2026-09-08T10:00:00.000Z',
        ...overrides
    };
}

function count(db, collection) {
    return [...db.docs.keys()].filter((key) => key.startsWith(`${collection}/`) && !key.slice(collection.length + 1).includes('/')).length;
}

async function clientController({ uid = 'admin-1', request, failPayment = true, paymentGate, confirmNewIntent = false } = {}) {
    const source = fs.readFileSync(path.join(ROOT, 'public', 'js', 'crm', 'student-finance.js'), 'utf8');
    const calls = [];
    const state = {
        uid,
        failPayment,
        modal: {
            studentId: 'student-1',
            studentSessionKey: 1,
            selectedInvoiceId: 'invoice-1',
            financeEnrollments: []
        },
        elements: {
            inputPaymentAmount: { value: '25' },
            inputPaymentMethod: { value: 'bank-transfer' }
        }
    };
    const apiFetchJson = async (url, options = {}) => {
        calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
        if (url === '/api/admin/payments' && state.failPayment) {
            state.failPayment = false;
            throw new Error('connection lost');
        }
        if (url === '/api/admin/payments' && paymentGate) await paymentGate();
        if (request) return request(url, options, state);
        if (url === '/api/admin/payments') return { paymentId: 'payment-1' };
        if (url.includes('/payment-followup')) return { required: false, payments: [], requiredActions: [] };
        if (url.includes('/finance/summary')) return { invoices: [], currencyTotals: [] };
        return {};
    };
    const context = {
        window: {
            firebase: { auth: () => ({ currentUser: { uid: state.uid } }) },
            confirm: () => confirmNewIntent,
            CrmFinance: {
                buildPaymentPayload: () => ({ amount: Number(state.elements.inputPaymentAmount.value), method: state.elements.inputPaymentMethod.value, currency: 'USD' })
            }
        },
        document: {},
        console,
        URL,
        setTimeout,
        clearTimeout
    };
    vm.runInNewContext(source, context, { filename: 'student-finance.js' });
    const controller = context.window.CrmStudentFinance.createController({
        apiFetchJson,
        elements: state.elements,
        modalState: state.modal,
        isActiveStudentSession: () => true,
        getCurrentStudentProfile: () => ({ name: 'Student One' }),
        renderStudentSchedulePrompt: () => {},
        refreshDashboard: async () => {},
        showToast: () => {},
        escapeHtml: (value) => String(value),
        getAdminCapabilities: () => ({})
    });
    return { controller, state, calls };
}

async function testSameOperationReplaysSavedResultAndDoesNotDuplicatePayment() {
    const db = createFakeDb(fixture());
    const router = makeRouter(db);
    const first = await postPayment(router, paymentBody());
    const replay = await postPayment(router, paymentBody());
    assert.equal(first._status, 200);
    assert.equal(replay._status, 200);
    assert.deepEqual(replay._json, first._json);
    assert.equal(count(db, CRM_PAYMENTS), 1);
    assert.equal(count(db, CRM_COMMISSIONS), 1);
}

async function testConcurrentSameOperationReturnsOneReceipt() {
    const db = createFakeDb(fixture());
    const router = makeRouter(db);
    const [a, b] = await Promise.all([
        postPayment(router, paymentBody({ operationId: 'payment-concurrent-1' })),
        postPayment(router, paymentBody({ operationId: 'payment-concurrent-1' }))
    ]);
    assert.equal(a._status, 200);
    assert.equal(b._status, 200);
    assert.deepEqual(a._json, b._json);
    assert.equal(count(db, CRM_PAYMENTS), 1);
}

async function testComposedRouterInjectsCurrentPaymentAuth() {
    const db = createFakeDb(fixture());
    const authState = {};
    const router = makeComposedRouter(db, authState);
    assert.equal((await postPayment(router, paymentBody()))._status, 200);
    authState['admin-1'] = { disabled: true };
    assert.equal((await postPayment(router, paymentBody()))._status, 403);
    assert.equal(count(db, CRM_PAYMENTS), 1);
}

async function testChangedPayloadAndOtherOwnerAreConflicts() {
    const db = createFakeDb(fixture({ [`${USERS}/admin-2`]: { isAdmin: true } }));
    const router = makeRouter(db);
    const initial = paymentBody({ amount: 25.1 });
    assert.equal((await postPayment(router, initial))._status, 200);
    const changed = await postPayment(router, paymentBody({ amount: 25.2 }));
    const otherOwner = await postPayment(router, initial, 'admin-2');
    assert.equal(changed._status, 409);
    assert.equal(otherOwner._status, 403);
    assert.equal(count(db, CRM_PAYMENTS), 1);
}

async function testDistinctOperationIdsPermitIdenticalIntentionalPayments() {
    const db = createFakeDb(fixture());
    const router = makeRouter(db);
    const first = await postPayment(router, paymentBody({ operationId: 'payment-distinct-1' }));
    const second = await postPayment(router, paymentBody({ operationId: 'payment-distinct-2' }));
    assert.equal(first._status, 200);
    assert.equal(second._status, 200);
    assert.equal(count(db, CRM_PAYMENTS), 2);
    assert.equal(db.docs.get(`${CRM_INVOICES}/invoice-1`).paidAmount, 50);
}

async function testAtomicValidationFailureLeavesFinancialCollectionsUnchanged() {
    const db = createFakeDb(fixture({
        [`${CRM_ENROLLMENTS}/enrollment-1`]: { studentId: 'student-1', classId: 'missing-class' }
    }));
    db.docs.get(`${CRM_INVOICES}/invoice-1`).enrollmentId = 'enrollment-1';
    const router = makeRouter(db);
    const result = await postPayment(router, paymentBody({ amount: 100, enrollmentId: 'enrollment-1' }));
    assert.equal(result._status, 404);
    assert.equal(count(db, CRM_PAYMENTS), 0);
    assert.equal(count(db, CRM_COMMISSIONS), 0);
    assert.equal(db.docs.get(`${CRM_INVOICES}/invoice-1`).paidAmount, 0);
}

async function testRevokedAdminCannotReplaySavedOperation() {
    const db = createFakeDb(fixture());
    const authState = {};
    const router = makeRouter(db, authState);
    assert.equal((await postPayment(router, paymentBody()))._status, 200);
    db.docs.set(`${USERS}/admin-1`, { isAdmin: false });
    const replay = await postPayment(router, paymentBody());
    assert.equal(replay._status, 403);
    assert.equal(count(db, CRM_PAYMENTS), 1);

    db.docs.set(`${USERS}/admin-1`, { isAdmin: true });
    authState['admin-1'] = { disabled: true };
    const disabled = await postPayment(router, paymentBody());
    assert.equal(disabled._status, 403);

    authState['admin-1'] = { tokensValidAfterTime: '1970-01-01T00:20:00Z' };
    const revoked = await postPayment(router, paymentBody());
    assert.equal(revoked._status, 403);
    assert.equal(count(db, CRM_PAYMENTS), 1);
}

async function testCanonicalAiRecordPaymentDoesNotRequireManualReceipt() {
    const db = createFakeDb(fixture());
    const result = await financeWrite.recordPayment(db, {
        invoiceId: 'invoice-1', studentId: 'student-1', amount: 25, method: 'cash'
    }, { user: { uid: 'admin-1', email: 'admin@example.test' }, nowMs: 1000, serverTimestamp: () => 'AI_TS' });
    assert.ok(result.paymentId);
    assert.equal(count(db, CRM_PAYMENTS), 1);
    assert.equal(count(db, 'crmPaymentOperations'), 0);
}

async function testMissingOperationIdHasExplicitLegacyOneShotPolicy() {
    const db = createFakeDb(fixture());
    const router = makeRouter(db);
    const body = paymentBody();
    delete body.operationId;
    assert.equal((await postPayment(router, body))._status, 200);
    assert.equal((await postPayment(router, body))._status, 200);
    assert.equal(count(db, CRM_PAYMENTS), 2);
}

async function testClientRetainsExactOperationAcrossLostAckAndIsolatesIdentity() {
    const f = await clientController();
    await assert.rejects(f.controller.recordPaymentForStudent(), /connection lost/);
    const first = f.calls.find((call) => call.url === '/api/admin/payments');
    await f.controller.recordPaymentForStudent();
    const paymentCalls = f.calls.filter((call) => call.url === '/api/admin/payments');
    assert.equal(paymentCalls.length, 2);
    assert.equal(paymentCalls[0].body.operationId, paymentCalls[1].body.operationId);
    assert.deepEqual(paymentCalls[0].body, paymentCalls[1].body);

    f.state.modal.studentId = 'student-2';
    f.state.modal.studentSessionKey = 2;
    f.state.elements.inputPaymentAmount.value = '25';
    await f.controller.recordPaymentForStudent();
    const third = f.calls.filter((call) => call.url === '/api/admin/payments')[2];
    assert.notEqual(third.body.operationId, first.body.operationId);
    assert.equal(third.body.studentId, 'student-2');
}

async function testClientRejectsEditedPayloadUntilExplicitNewIntent() {
    const f = await clientController();
    await assert.rejects(f.controller.recordPaymentForStudent(), /connection lost/);
    f.state.elements.inputPaymentAmount.value = '30';
    await assert.rejects(f.controller.recordPaymentForStudent(), /changed|new payment/i);
    assert.equal(f.calls.filter((call) => call.url === '/api/admin/payments').length, 1);
}

async function testClientStartsNewIntentOnlyAfterExplicitConfirmation() {
    const f = await clientController({ confirmNewIntent: true });
    await assert.rejects(f.controller.recordPaymentForStudent(), /connection lost/);
    f.state.elements.inputPaymentAmount.value = '30';
    await f.controller.recordPaymentForStudent();
    const paymentCalls = f.calls.filter((call) => call.url === '/api/admin/payments');
    assert.equal(paymentCalls.length, 2);
    assert.notEqual(paymentCalls[0].body.operationId, paymentCalls[1].body.operationId);
    assert.equal(paymentCalls[1].body.amount, 30);
}

async function testClientDoesNotClearNewIdentityAfterLateSuccess() {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const f = await clientController({ failPayment: false, paymentGate: () => gate });
    const firstRequest = f.controller.recordPaymentForStudent();
    await Promise.resolve();
    f.state.modal.studentId = 'student-2';
    f.state.modal.studentSessionKey = 2;
    f.state.elements.inputPaymentAmount.value = '30';
    release();
    await firstRequest;
    assert.equal(f.state.elements.inputPaymentAmount.value, '30');
    assert.equal(f.calls.filter((call) => call.url === '/api/admin/payments').length, 1);
}

(async () => {
    await testSameOperationReplaysSavedResultAndDoesNotDuplicatePayment();
    await testConcurrentSameOperationReturnsOneReceipt();
    await testComposedRouterInjectsCurrentPaymentAuth();
    await testChangedPayloadAndOtherOwnerAreConflicts();
    await testDistinctOperationIdsPermitIdenticalIntentionalPayments();
    await testAtomicValidationFailureLeavesFinancialCollectionsUnchanged();
    await testRevokedAdminCannotReplaySavedOperation();
    await testCanonicalAiRecordPaymentDoesNotRequireManualReceipt();
    await testMissingOperationIdHasExplicitLegacyOneShotPolicy();
    await testClientRetainsExactOperationAcrossLostAckAndIsolatesIdentity();
    await testClientRejectsEditedPayloadUntilExplicitNewIntent();
    await testClientStartsNewIntentOnlyAfterExplicitConfirmation();
    await testClientDoesNotClearNewIdentityAfterLateSuccess();
    process.stdout.write('manual payment tests passed\n');
})().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
});
