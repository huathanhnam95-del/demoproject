const assert = require('assert');
const express = require('express');

const registerAgentSourceRoutes = require('../../functions/src/routes/admin/agent-sources');
const registerFinanceRoutes = require('../../functions/src/routes/admin/finance');
const {
    CRM_AGENT_SOURCES,
    CRM_COMMISSIONS,
    CRM_COURSES,
    CRM_INVOICES,
    CRM_STUDENTS
} = require('../../functions/src/crm/collections');
const { callRoute, createFakeDb } = require('./route-test-helpers');

function createRouter(db) {
    const router = express.Router();
    const deps = {
        db,
        requireAdminHandlers: [
            (req, _res, next) => {
                req.user = { uid: 'admin-1', email: 'admin@example.com' };
                next();
            }
        ],
        sendSuccess: (res, data, message) => res.status(200).json({ success: true, ...(message ? { message } : {}), ...data }),
        sendError: (res, status, error, message, details) => res.status(status).json({ success: false, error, message, ...(details ? { details } : {}) }),
        serverTimestamp: () => 'SERVER_TS',
        writeAuditLog: async () => {}
    };
    registerFinanceRoutes(router, deps);
    registerAgentSourceRoutes(router, deps);
    return router;
}

async function testInvoiceCreationUsesStoredAgentCourseRate() {
    const db = createFakeDb({
        [`${CRM_STUDENTS}/student-1`]: {
            name: 'Student One',
            agentSourceId: 'agent-1'
        },
        [`${CRM_COURSES}/course-1`]: {
            name: 'PTE Intensive',
            agentCommissionBps: 500
        },
        [`${CRM_AGENT_SOURCES}/agent-1`]: {
            name: 'Referral Team',
            status: 'active',
            courseRates: {
                'course-1': '1750'
            }
        }
    });

    const router = createRouter(db);
    const res = await callRoute(router, '/invoices', 'post', {
        body: {
            studentId: 'student-1',
            enrollmentId: 'enrollment-1',
            courseId: 'course-1',
            amount: 1000000,
            currency: 'VND'
        }
    });

    assert.strictEqual(res._status, 200);
    assert.strictEqual(res._json.success, true);

    const invoiceEntry = Array.from(db.docs.entries())
        .find(([key]) => key.startsWith(`${CRM_INVOICES}/`));
    assert(invoiceEntry, 'Expected invoice route to persist an invoice.');
    assert.strictEqual(invoiceEntry[1].agentSourceId, 'agent-1');
    assert.strictEqual(invoiceEntry[1].agentCommissionBps, 1750);
}

async function testReportFallsBackPastInvalidStoredRates() {
    const db = createFakeDb({
        [`${CRM_AGENT_SOURCES}/agent-2`]: {
            name: 'Legacy Agent',
            status: 'active',
            courseRates: {
                'course-2': 'invalid-rate'
            }
        },
        [`${CRM_STUDENTS}/student-2`]: {
            name: 'Student Two'
        },
        [`${CRM_COURSES}/course-2`]: {
            name: 'IELTS Evening'
        },
        [`${CRM_INVOICES}/invoice-2`]: {
            studentId: 'student-2',
            enrollmentId: 'enrollment-2',
            courseId: 'course-2',
            currency: 'VND',
            amount: 2000000,
            discountAmount: 0,
            netAmount: 2000000,
            paidAmount: 2000000,
            outstandingAmount: 0,
            status: 'paid',
            paidAt: '2026-05-12T08:00:00.000Z',
            agentSourceId: 'agent-2',
            agentCommissionBps: 1200
        },
        [`${CRM_COMMISSIONS}/commission-2`]: {
            invoiceId: 'invoice-2',
            role: 'agent_source',
            rateBps: 'not-a-rate',
            amount: null,
            currency: 'VND',
            status: 'pending'
        }
    });

    const router = createRouter(db);
    const res = await callRoute(router, '/agent-sources/report', 'get', {
        query: { month: '2026-05' }
    });

    assert.strictEqual(res._status, 200);
    assert.strictEqual(res._json.success, true);
    assert.strictEqual(res._json.rows.length, 1);
    assert.strictEqual(res._json.rows[0].rateBps, 1200);
    assert.strictEqual(res._json.rows[0].commissionAmount, 240000);
}

(async () => {
    await testInvoiceCreationUsesStoredAgentCourseRate();
    await testReportFallsBackPastInvalidStoredRates();
    process.stdout.write('agent course rates route behavior passed\n');
})().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exit(1);
});
