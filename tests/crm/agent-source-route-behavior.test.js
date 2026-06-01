const assert = require('assert');
const express = require('express');

const registerAgentSourceRoutes = require('../../functions/src/routes/admin/agent-sources');
const {
    CRM_AGENT_SOURCES,
    CRM_INVOICES
} = require('../../functions/src/crm/collections');
const { callRoute, createFakeDb } = require('./route-test-helpers');

function createAgentSourceRouter(db) {
    const router = express.Router();
    registerAgentSourceRoutes(router, {
        db,
        requireAdminHandlers: [],
        serverTimestamp: () => 'SERVER_TS',
        writeAuditLog: async () => {},
        sendSuccess: (res, payload, message) => res.status(200).json({ success: true, message, ...payload }),
        sendError: (res, status, error, message, details) => res.status(status).json({ success: false, error, message, details })
    });
    return router;
}

async function testAgentReportKeepsInvoiceHistoricalRateBeforeCurrentAgentRate() {
    const db = createFakeDb({
        [`${CRM_AGENT_SOURCES}/agent-1`]: {
            name: 'Agent One',
            status: 'active',
            courseRates: { 'course-1': 2000 },
            createdAt: '2026-05-01T00:00:00.000Z'
        },
        [`${CRM_INVOICES}/invoice-1`]: {
            invoiceId: 'invoice-1',
            studentId: 'student-1',
            agentSourceId: 'agent-1',
            courseId: 'course-1',
            status: 'paid',
            paidAt: '2026-05-15T00:00:00.000Z',
            currency: 'VND',
            netAmount: 1000000,
            agentCommissionBps: 1000
        }
    });
    const router = createAgentSourceRouter(db);

    const res = await callRoute(router, '/agent-sources/report', 'get', {
        query: { month: '2026-05', format: 'json' }
    });

    assert.strictEqual(res._status, 200);
    assert.strictEqual(res._json.rows.length, 1);
    assert.strictEqual(res._json.rows[0].rateBps, 1000);
    assert.strictEqual(res._json.rows[0].commissionAmount, 100000);
}

(async () => {
    await testAgentReportKeepsInvoiceHistoricalRateBeforeCurrentAgentRate();
    process.stdout.write('agent source route behavior passed\n');
})().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
});
