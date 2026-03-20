const assert = require('assert');

console.log('Testing thumbnail coordination service...');

let thumbnailService;
try {
    thumbnailService = require('../src/services/reading-journey/thumbnail-service');
} catch (e) {
    console.error('Failed to load thumbnail-service module:', e.message);
    process.exit(1);
}

const { generateStoryThumbnail } = thumbnailService;

// Mock the dependencies
const gemini = require('../src/services/reading-journey/gemini');
gemini.generateThumbnailSceneSummaryJson = async () => ({
    thumbnailMoment: 'Mock moment',
    characters: ['Mock char'],
    setting: 'Mock setting',
    timeOfDay: 'day',
    keyProps: [],
    emotionalTone: 'happy',
    spoilerLevel: 'safe_social',
    sourceBeats: []
});

assert.ok(typeof generateStoryThumbnail === 'function', 'Missing generateStoryThumbnail');

async function test() {
    try {
        const result = await generateStoryThumbnail('fake-story-id', { dryRun: true });
        
        assert.ok(result.record, 'Should return generation record');
        assert.ok(result.record.storyId === 'fake-story-id', 'Should link correct story id');
        assert.ok(result.record.auditResult.passed, 'Audit should pass in dry run');
        assert.ok(result.record.imageStoragePath, 'Should assign a storage path');
        
        console.log('reading journey thumbnail service passed');
    } catch(e) {
        console.error('Test failed:', e.message);
        process.exit(1);
    }
}

test();
