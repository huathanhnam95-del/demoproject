/* eslint-disable no-console */
const assert = require('assert');
const path = require('path');
const { parseArgs, runAuditOnPages } = require('../../scripts/crm/audit-book-text-revision');

async function runTests() {
    console.log('Testing book text audit tool and metric aggregations...');

    // 1. Argument parsing test
    const parsed = parseArgs(['node', 'audit.js', '--fixture', 'test.json', '--json', '--threshold-wer', '0.05', '--verbose']);
    assert.strictEqual(parsed.fixture, 'test.json');
    assert.strictEqual(parsed.json, true);
    assert.strictEqual(parsed.thresholdWer, 0.05);
    assert.strictEqual(parsed.verbose, true);

    // 2. Synthetic fixture audit comparison
    const corruptPage1 = 'ANeglectedSpeciasintheclassroomBasicsOfPronunciationTeaching';
    const cleanPage1 = 'A Neglected Species in the classroom Basics of Pronunciation Teaching';

    const corruptPage2 = 'jof ASTD itt Training IIMIWIN';
    const cleanPage2 = 'Journal of ASTD ITT Training Innovation';

    const audit = runAuditOnPages(
        [corruptPage1, corruptPage2],
        [cleanPage1, cleanPage2]
    );

    assert.strictEqual(audit.totalPages, 2);
    assert.ok(audit.summary.legacy.averageWhitespaceRatio < 0.1, 'Legacy whitespace ratio is severely collapsed');
    assert.ok(audit.summary.candidate.averageWhitespaceRatio > 0.12, 'Candidate whitespace ratio is healthy');
    assert.ok(audit.summary.legacy.totalSuspiciousTokens >= 1, 'Legacy has suspicious runs');
    assert.strictEqual(audit.summary.candidate.totalSuspiciousTokens, 0, 'Candidate has 0 suspicious runs');

    assert.strictEqual(audit.pageAudits.length, 2);
    assert.ok(audit.pageAudits[0].flags.some((f) => f.includes('COLLAPSED_WHITESPACE') || f.includes('LONG_ALPHABETIC_RUN')));
    assert.ok(audit.pageAudits[0].wordDisagreementRate > 0.5);

    console.log('book text audit tool tests passed');
}

runTests().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
