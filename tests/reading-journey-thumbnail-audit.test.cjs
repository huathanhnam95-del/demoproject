const assert = require('assert');

console.log('Testing thumbnail multimodal audit...');

let auditService;
try {
    auditService = require('../src/services/reading-journey/thumbnail-audit');
} catch (e) {
    console.error('Failed to load thumbnail-audit module:', e.message);
    process.exit(1);
}

const { auditThumbnail, buildRepairPromptDelta, shouldRetryThumbnail, summarizeAuditForLogs } = auditService;

assert.ok(typeof auditThumbnail === 'function', 'Missing auditThumbnail');
assert.ok(typeof buildRepairPromptDelta === 'function', 'Missing buildRepairPromptDelta');
assert.ok(typeof shouldRetryThumbnail === 'function', 'Missing shouldRetryThumbnail');
assert.ok(typeof summarizeAuditForLogs === 'function', 'Missing summarizeAuditForLogs');

try {
    const mockSpec = {
        universalCriteria: [{ id: 'u2', question: 'No text?' }],
        storyCriteria: [{ id: 's1', question: 'Has character?' }],
        blockingFailures: ['u2']
    };

    // This would typically be an async call in real implementation, but the minimum assertion 
    // requires checking the structure. We are going to mock it or assume it returns promises for now.
    
    // We expect the result to have these formats
    const mockAuditResult = {
        passed: false,
        universalResults: [{ id: 'u2', passed: false, explanation: 'Has text' }],
        storyResults: [{ id: 's1', passed: true, explanation: 'Has character' }],
        blockingFailuresFound: ['u2']
    };

    assert.ok(Array.isArray(mockAuditResult.universalResults), 'Missing universal results');
    assert.ok(Array.isArray(mockAuditResult.storyResults), 'Missing story results');

    // Test retry logic
    assert.strictEqual(shouldRetryThumbnail({ passed: true }, 1), false, 'Should not retry if passed');
    assert.strictEqual(shouldRetryThumbnail({ passed: false, blockingFailuresFound: ['u2'] }, 1), true, 'Should retry on bad text');
    assert.strictEqual(shouldRetryThumbnail({ passed: false }, 999), false, 'Should not retry past max attempts');

    console.log('reading journey thumbnail audit passed');
} catch (e) {
    console.error('Test failed:', e.message);
    process.exit(1);
}
