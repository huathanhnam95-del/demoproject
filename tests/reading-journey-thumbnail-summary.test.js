const assert = require('assert');
console.log('Testing thumbnail summary extraction...');

let summaryService;
try {
    summaryService = require('../src/services/reading-journey/thumbnail-summary');
} catch (e) {
    console.error('Failed to load thumbnail-summary module:', e.message);
    process.exit(1);
}

const gemini = require('../src/services/reading-journey/gemini');
const { buildThumbnailSceneSummary } = summaryService;

assert.ok(typeof buildThumbnailSceneSummary === 'function', 'Missing buildThumbnailSceneSummary');

// We need an async test harness because extraction calls Gemini
async function runTests() {
    try {
        const outline = {
            id: 'outline-123',
            title: 'The Great Adventure',
            logline: 'A hero saves the day.',
            characters: [{ name: 'Hero', role: 'protagonist' }],
            setting: 'A mystical forest'
        };
        const beats = [
            { id: 'beat-1', content: 'Hero enters the forest.' },
            { id: 'beat-2', content: 'Hero finds the magic sword.' },
            { id: 'beat-3', content: 'Hero defeats the dragon.' } // Often too spoiler-y for the library
        ];

        // This is a minimal mock to simulate the AI call if the service supports it,
        // but for now we'll just assert the shape of a completed extraction.
        // We'll pass the data to the builder. The minimal implementation
        // should return a structured summary.
        // Mock the Gemini call
        gemini.generateThumbnailSceneSummaryJson = async () => ({
            thumbnailMoment: 'Hero lifts the glowing magic sword.',
            characters: ['Hero'],
            setting: 'A mystical forest clearing',
            timeOfDay: 'dusk',
            keyProps: ['magic sword'],
            emotionalTone: 'triumphant',
            spoilerLevel: 'safe_library',
            sourceBeats: ['beat-2']
        });

        // The minimal implementation should return a structured summary.
        const summary = await buildThumbnailSceneSummary({ outline, beats });
        
        // Assertions
        assert.ok(summary.thumbnailMoment, 'Missing thumbnailMoment');
        assert.ok(summary.sourceBeats && summary.sourceBeats.length > 0, 'Missing sourceBeats');
        assert.ok(summary.characters, 'Missing characters');
        
        // Ensure spoilerLevel is one of the valid states (from contracts)
        const validSpoilerLevels = ['safe_library', 'safe_story_detail', 'full'];
        assert.ok(validSpoilerLevels.includes(summary.spoilerLevel), 'Invalid spoilerLevel');

        // Check it selects exactly one thumbnailMoment
        assert.strictEqual(typeof summary.thumbnailMoment, 'string', 'thumbnailMoment should be a string');

        // Check if the end-state moment sets correct spoiler level (to test the logic, maybe difficult without mock AI)
        // Here we just assert the result fields map correctly.
        assert.strictEqual(summary.storyId, 'outline-123', 'Should map outline.id to storyId');

        console.log('reading journey thumbnail summary passed');
    } catch (e) {
        console.error('Test failed:', e.message);
        process.exit(1);
    }
}

runTests();
