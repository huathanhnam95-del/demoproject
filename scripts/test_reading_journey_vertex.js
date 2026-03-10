/* eslint-disable no-console */
/**
 * Test Script: Reading Journey – Vertex AI Billing Verification
 *
 * Generates 5 complete stories (topic tags → outline → 5 MCQ beats + ending beat)
 * to simulate real user behavior and confirm that billing goes through Vertex AI.
 *
 * Usage:  node scripts/test_reading_journey_vertex.js
 */
require('dotenv').config();

const gemini = require('../src/services/reading-journey/gemini');

const STORY_CONFIGS = [
    { keywords: ['space', 'robot'], level: 'B1' },
    { keywords: ['cooking', 'friendship'], level: 'A2' },
    { keywords: ['mystery', 'school'], level: 'B2' },
    { keywords: ['travel', 'nature'], level: 'B1' },
    { keywords: ['sports', 'teamwork'], level: 'C1' },
];

const CHOICE_IDS = ['investigate', 'ask', 'wait'];

async function runStory(config, storyIndex) {
    const label = `Story #${storyIndex + 1}`;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${label}  keywords=${config.keywords.join(',')}  level=${config.level}`);
    console.log('='.repeat(60));

    // Step 1: Generate topic tags
    console.log(`  [1/3] Generating topic tags...`);
    const topicTags = await gemini.generateTopicTags({
        keywords: config.keywords,
        level: config.level,
        language: 'en',
    });
    console.log(`        Tags: ${topicTags.join(', ')}`);

    // Step 2: Generate outline
    console.log(`  [2/3] Generating outline...`);
    const outline = await gemini.generateOutline({
        keywords: config.keywords,
        topicTags,
        level: config.level,
        language: 'en',
    });
    console.log(`        Title: "${outline.title}"`);
    console.log(`        Premise: "${outline.premise}"`);
    console.log(`        Beats: ${outline.beatOutline.length}`);

    // Step 3: Generate all 6 beats (5 interactive + 1 ending)
    console.log(`  [3/3] Generating beats...`);
    let storySoFar = '';
    const path = [];

    for (let beatNum = 1; beatNum <= 6; beatNum++) {
        const isEnding = beatNum === 6;
        // Cycle through all 3 choice types across beats
        const questionType = isEnding ? 'end' : (beatNum % 2 === 0 ? 'open' : 'mcq');

        const beat = await gemini.generateBeat({
            outline,
            beatNumber: beatNum,
            path,
            questionType,
            storySoFar,
            level: config.level,
            language: 'en',
        });

        const segmentSnippet = beat.segment.slice(0, 80) + (beat.segment.length > 80 ? '...' : '');
        console.log(`        Beat ${beatNum}/${6} [${beat.questionType}]: "${segmentSnippet}"`);

        if (beat.highlights?.length) {
            console.log(`          Highlights: ${beat.highlights.join(', ')}`);
        }

        storySoFar += ' ' + beat.segment;

        // Simulate a user choice for MCQ beats
        if (beat.choiceQuestion && beat.choiceQuestion.options?.length) {
            const choiceIndex = (beatNum - 1) % CHOICE_IDS.length;
            const chosenId = CHOICE_IDS[choiceIndex];
            path.push(chosenId);
            console.log(`          → User chose: "${chosenId}"`);
        }

        if (beat.shouldEnd && beat.endWrap) {
            console.log(`          EndWrap: "${beat.endWrap}"`);
        }
    }

    console.log(`  ✅ ${label} complete! (${path.length} user choices made)`);
    return { title: outline.title, beats: 6, choices: path };
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║   Reading Journey – Vertex AI Billing Test              ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log(`Model: ${gemini.getModelName()} (fallback: ${gemini.getFallbackModelName()})`);
    console.log(`Project: ${process.env.FIREBASE_PROJECT_ID}`);
    console.log(`Location: ${process.env.GOOGLE_CLOUD_LOCATION || 'us-central1'}`);
    console.log(`Generating ${STORY_CONFIGS.length} full stories...\n`);

    const startTime = Date.now();
    const results = [];

    for (let i = 0; i < STORY_CONFIGS.length; i++) {
        try {
            const result = await runStory(STORY_CONFIGS[i], i);
            results.push(result);
        } catch (err) {
            console.error(`  ❌ Story #${i + 1} FAILED: ${err.message}`);
            results.push({ error: err.message });
        }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n${'═'.repeat(60)}`);
    console.log('SUMMARY');
    console.log('═'.repeat(60));
    results.forEach((r, i) => {
        if (r.error) {
            console.log(`  Story #${i + 1}: ❌ ${r.error}`);
        } else {
            console.log(`  Story #${i + 1}: ✅ "${r.title}" — ${r.beats} beats, choices: [${r.choices.join(', ')}]`);
        }
    });
    console.log(`\nTotal time: ${elapsed}s`);
    console.log(`Effective model: ${gemini.getEffectiveModelName()}`);
    const fallbackReason = gemini.getForceFallbackReason();
    if (fallbackReason) {
        console.log(`⚠️  Fallback was triggered: ${fallbackReason}`);
    }
    console.log('\n💰 Check your Google Cloud Billing Console to verify');
    console.log('   that charges appear under Vertex AI → Generative AI.');
    console.log('   URL: https://console.cloud.google.com/billing');
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
