const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildDashboardSummary } = require('../../functions/src/crm/reporting-service');

function loadBrowserHelper(relativePath, globalName) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox.window[globalName];
}

const helper = loadBrowserHelper('public/js/crm/dashboard.js', 'CrmDashboard');

const summary = buildDashboardSummary({
    leads: [{ stage: 'won' }, { stage: 'new' }],
    students: [],
    enrollments: [{ classId: 'class-1', status: 'active' }],
    attendance: [{ studentId: 'student-1', atRisk: { isAtRisk: true } }],
    invoices: [{ courseId: 'course-1', netAmount: 1000, outstandingAmount: 200 }],
    payments: [{ amount: 800, courseId: 'course-1' }]
});

const cards = helper.buildSummaryCards(summary);

assert.strictEqual(cards.length >= 4, true);
assert.strictEqual(cards[0].value !== undefined, true);

console.log('dashboard smoke passed');
