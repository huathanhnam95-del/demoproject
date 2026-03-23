const assert = require('assert');

const {
    WORKFLOW_REVIEW_CHECKS,
    MANUAL_REVIEW_AREAS,
    summarizeResults,
    formatMarkdownReport
} = require('../../scripts/crm/workflow-review-baseline-lib');

assert(Array.isArray(WORKFLOW_REVIEW_CHECKS), 'WORKFLOW_REVIEW_CHECKS should be an array.');
assert(WORKFLOW_REVIEW_CHECKS.length >= 10, 'Expected a non-trivial baseline check list.');
assert(
    WORKFLOW_REVIEW_CHECKS.some((check) => check.id === 'collection-contracts' && check.reviewArea === 'cross-cutting-contracts'),
    'Expected collection contract coverage in the baseline checks.'
);
assert(
    WORKFLOW_REVIEW_CHECKS.some((check) => check.id === 'smoke-lead-pipeline' && check.reviewArea === 'lead-and-conversion'),
    'Expected lead pipeline smoke coverage in the baseline checks.'
);
assert(
    WORKFLOW_REVIEW_CHECKS.some((check) => check.id === 'smoke-classroom-admin' && check.reviewArea === 'classroom-and-schedule'),
    'Expected classroom smoke coverage in the baseline checks.'
);
assert(
    WORKFLOW_REVIEW_CHECKS.some((check) => check.id === 'smoke-attendance' && check.reviewArea === 'attendance-and-delivery'),
    'Expected attendance smoke coverage in the baseline checks.'
);

assert(Array.isArray(MANUAL_REVIEW_AREAS), 'MANUAL_REVIEW_AREAS should be an array.');
assert(
    MANUAL_REVIEW_AREAS.some((area) => area.area === 'class-hosting-live-delivery'),
    'Expected live class hosting to be tracked as a manual review area.'
);
assert(
    MANUAL_REVIEW_AREAS.some((area) => area.area === 'homework-return-revision'),
    'Expected homework return/revision to be tracked as a manual review area.'
);

const summary = summarizeResults([
    { id: 'collection-contracts', label: 'Collection contracts', reviewArea: 'cross-cutting-contracts', exitCode: 1 },
    { id: 'smoke-lead-pipeline', label: 'Lead pipeline smoke', reviewArea: 'lead-and-conversion', exitCode: 0 },
    { id: 'smoke-attendance', label: 'Attendance smoke', reviewArea: 'attendance-and-delivery', exitCode: 0 },
    { id: 'smoke-classroom-admin', label: 'Classroom smoke', reviewArea: 'classroom-and-schedule', exitCode: 0 }
]);

assert.deepStrictEqual(summary.totals, {
    total: 4,
    passed: 3,
    failed: 1
});
assert.deepStrictEqual(summary.byArea['cross-cutting-contracts'], {
    total: 1,
    passed: 0,
    failed: 1
});
assert.deepStrictEqual(summary.byArea['lead-and-conversion'], {
    total: 1,
    passed: 1,
    failed: 0
});

const report = formatMarkdownReport({
    generatedAt: '2026-03-16T12:00:00.000Z',
    summary,
    results: [
        { id: 'collection-contracts', label: 'Collection contracts', reviewArea: 'cross-cutting-contracts', exitCode: 1, command: 'node tests/crm/collection-contracts.test.js' },
        { id: 'smoke-lead-pipeline', label: 'Lead pipeline smoke', reviewArea: 'lead-and-conversion', exitCode: 0, command: 'node scripts/crm/smoke-lead-pipeline.js' }
    ],
    manualAreas: MANUAL_REVIEW_AREAS
});

assert(report.includes('# CRM Workflow Review Baseline'), 'Report should include the expected heading.');
assert(report.includes('cross-cutting-contracts'), 'Report should include the failing area.');
assert(report.includes('class-hosting-live-delivery'), 'Report should include manual review areas.');
assert(report.includes('node tests/crm/collection-contracts.test.js'), 'Report should include the executed command.');

process.stdout.write('workflow review baseline lib passed\n');
