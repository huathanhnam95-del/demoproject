const assert = require('assert');
console.log('Testing thumbnail prompt composer...');

let promptService;
try {
    promptService = require('../src/services/reading-journey/thumbnail-prompt');
} catch (e) {
    console.error('Failed to load thumbnail-prompt module:', e.message);
    process.exit(1);
}

const { buildThumbnailPromptSpec, buildThumbnailAuditSpec } = promptService;

assert.ok(typeof buildThumbnailPromptSpec === 'function', 'Missing buildThumbnailPromptSpec');
assert.ok(typeof buildThumbnailAuditSpec === 'function', 'Missing buildThumbnailAuditSpec');

const summary = {
    thumbnailMoment: 'Maya searches the dusty attic for the lost key.',
    characters: ['Maya'],
    setting: 'A dusty attic filled with old boxes',
    timeOfDay: 'afternoon',
    keyProps: ['lost key', 'old boxes'],
    emotionalTone: 'curious',
    spoilerLevel: 'safe_library',
    sourceBeats: ['beat-1']
};

try {
    const promptSpec = buildThumbnailPromptSpec(summary);
    
    assert.ok(promptSpec.subject, 'Missing subject');
    assert.ok(promptSpec.action, 'Missing action');
    assert.ok(promptSpec.environment, 'Missing environment');
    assert.ok(promptSpec.style, 'Missing style');
    assert.ok(promptSpec.composition, 'Missing composition');
    assert.ok(promptSpec.camera, 'Missing camera');
    assert.ok(promptSpec.lighting, 'Missing lighting');
    assert.ok(promptSpec.negativeConstraints, 'Missing negativeConstraints');
    assert.ok(promptSpec.continuityAnchors, 'Missing continuityAnchors');
    assert.ok(promptSpec.promptText, 'Missing promptText');

    const auditSpec = buildThumbnailAuditSpec(summary);
    
    assert.ok(Array.isArray(auditSpec.universalCriteria), 'universalCriteria should be an array');
    assert.ok(auditSpec.universalCriteria.length >= 5, 'Should have at least 5 universal criteria');
    
    assert.ok(Array.isArray(auditSpec.storyCriteria), 'storyCriteria should be an array');
    assert.ok(auditSpec.storyCriteria.length >= 3, 'Should have at least 3 story criteria');
    
    assert.ok(Array.isArray(auditSpec.blockingFailures), 'blockingFailures should be an array');
    assert.ok(auditSpec.blockingFailures.length >= 1, 'Should have at least 1 blocking failure');

    console.log('reading journey thumbnail prompt passed');
} catch (e) {
    console.error('Test failed:', e.message);
    process.exit(1);
}
