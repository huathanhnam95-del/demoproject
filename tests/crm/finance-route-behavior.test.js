const assert = require('assert');
const express = require('express');

const registerFinanceRoutes = require('../../functions/src/routes/admin/finance');
const {
    CRM_AGENT_SOURCES,
    CRM_COURSES,
    CRM_INVOICES,
    CRM_STUDENTS
} = require('../../functions/src/crm/collections');
const { callRoute, createFakeDb } = require('./route-test-helpers');

function createFinanceRouter(db) {
    const router = express.Router();
    registerFinanceRoutes(router, {
        db,
        requireAdminHandlers: [],
        serverTimestamp: () => 'SERVER_TS',
        writeAuditLog: async () => {},
        sendSuccess: (res, payload, message) => res.status(200).json({ success: true, message, ...payload }),
        sendError: (res, status, error, message, details) => res.status(status).json({ success: false, error, message, details })
    });
    return router;
}

async function testInvoiceCreationUsesAgentCustomRateBeforeCourseDefault() {
    const db = createFakeDb({
        [`${CRM_STUDENTS}/student-1`]: {
            name: 'Student One',
            agentSourceId: 'agent-1'
        },
        [`${CRM_COURSES}/course-1`]: {
            name: 'Course One',
            agentCommissionBps: 1000
        },
        [`${CRM_AGENT_SOURCES}/agent-1`]: {
            name: 'Agent One',
            courseRates: { 'course-1': '1500' }
        }
    });
    const router = createFinanceRouter(db);

    const res = await callRoute(router, '/invoices', 'post', {
        body: {
            studentId: 'student-1',
            courseId: 'course-1',
            amount: 1000000,
            dueDate: '2026-05-20'
        }
    });

    assert.strictEqual(res._status, 200);
    const invoiceKey = Array.from(db.docs.keys()).find((key) => key.startsWith(`${CRM_INVOICES}/`));
    assert(invoiceKey, 'Expected invoice to be written.');
    assert.strictEqual(db.docs.get(invoiceKey).agentCommissionBps, 1500);
}

(async () => {
    await testInvoiceCreationUsesAgentCustomRateBeforeCourseDefault();
    process.stdout.write('finance route behavior passed\n');
})().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
});
