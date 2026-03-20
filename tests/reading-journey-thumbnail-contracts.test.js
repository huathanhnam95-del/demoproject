const assert = require('assert');
console.log('Testing thumbnail contracts...');

let contracts;
try {
    contracts = require('../src/services/reading-journey/thumbnail-contracts');
} catch (e) {
    console.error('Failed to load contracts module:', e.message);
    process.exit(1);
}

const {
    validateThumbnailSceneSummary,
    validateThumbnailPromptSpec,
    validateThumbnailAuditSpec,
    validateThumbnailGenerationRecord
} = contracts;

assert.ok(typeof validateThumbnailSceneSummary === 'function', 'Missing validateThumbnailSceneSummary');
assert.ok(typeof validateThumbnailPromptSpec === 'function', 'Missing validateThumbnailPromptSpec');
assert.ok(typeof validateThumbnailAuditSpec === 'function', 'Missing validateThumbnailAuditSpec');
assert.ok(typeof validateThumbnailGenerationRecord === 'function', 'Missing validateThumbnailGenerationRecord');

// Check universal criteria fields
assert.throws(() => {
    validateThumbnailAuditSpec({
        universalCriteria: [{ id: 'test' }], // Missing fields
        storyCriteria: [],
        blockingFailures: [],
        repairInstructions: ''
    });
}, /id, label, severity, and question/i);

// Check story criteria source requirement
assert.throws(() => {
    validateThumbnailAuditSpec({
        universalCriteria: [{id: '1', label: 'L', severity: 'pass', question: 'Q'}],
        storyCriteria: [{ id: 'test', question: '?' }], // Missing source
        blockingFailures: [],
        repairInstructions: ''
    });
}, /source/i);

// Check spoilerLevel restrictions
assert.throws(() => {
    validateThumbnailSceneSummary({
        storyId: '123',
        outlineId: '456',
        title: 'Title',
        logline: 'Logline',
        thumbnailMoment: 'Moment',
        characters: [],
        setting: 'Setting',
        timeOfDay: 'Day',
        keyProps: [],
        emotionalTone: 'Happy',
        spoilerLevel: 'invalid_level', // Invalid
        sourceBeats: ['beat-1']
    });
}, /spoilerLevel/i);

console.log('reading journey thumbnail contracts passed');
