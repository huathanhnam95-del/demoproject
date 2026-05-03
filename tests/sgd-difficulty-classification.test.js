const assert = require('assert/strict');

const {
    computeMetrics,
    computeComposite,
    computePercentileThresholds,
    assignLevelsFromCompositeScores,
    classifyEntriesByText
} = require('../public/content-difficulty-classifier.js');

console.log('Running SGD difficulty classification tests...');

const shortDiscussion = [
    'Narration: Two students discuss lunch after class.',
    'Speaker1: We can eat at noon.',
    'Speaker2: The cafe is nearby and cheap.'
].join(' ');

const mediumDiscussion = [
    'Narration: Three students discuss preparing for a psychology presentation.',
    'Speaker1: We should divide the topic into clear sections and compare recent studies before class.',
    'Speaker2: Let us organize the slides, rehearse the transitions, and explain the strongest evidence with simple examples.',
    'Speaker3: If we practice twice, we can improve timing and make the argument easier to follow.'
].join(' ');

const hardDiscussion = [
    'Narration: Three graduate students debate ethical frameworks for coastal adaptation policy in a research seminar.',
    'Speaker1: The presentation should evaluate whether distributive justice and long-term ecological resilience can coexist when infrastructure budgets remain constrained.',
    'Speaker2: We also need comparative evidence, interdisciplinary terminology, and a synthesis of stakeholder perspectives before we defend any recommendation.',
    'Speaker3: Without a nuanced explanation of governance trade-offs, institutional accountability, and climate externalities, the discussion will sound descriptive rather than analytically rigorous.'
].join(' ');

{
    const shortMetrics = computeMetrics(shortDiscussion);
    const hardMetrics = computeMetrics(hardDiscussion);

    assert.ok(hardMetrics.wordCount > shortMetrics.wordCount, 'hard passage should be longer');
    assert.ok(hardMetrics.avgWordLen > shortMetrics.avgWordLen, 'hard passage should use longer words on average');

    const shortComposite = computeComposite(shortMetrics);
    const hardComposite = computeComposite(hardMetrics);
    assert.ok(hardComposite.composite > shortComposite.composite, 'hard passage should score higher than short passage');
}

{
    const thresholds = computePercentileThresholds([1, 5, 9]);
    assert.deepEqual(thresholds, { p33: 1, p66: 5 });

    const assigned = assignLevelsFromCompositeScores([1, 5, 9], thresholds);
    assert.deepEqual(assigned, [1, 2, 3], 'percentile assignment should map increasing scores to levels 1..3');
}

{
    const classified = classifyEntriesByText(
        [
            { id: 'easy', transcript: shortDiscussion },
            { id: 'medium', transcript: mediumDiscussion },
            { id: 'hard', transcript: hardDiscussion }
        ],
        (entry) => entry.transcript
    );

    assert.deepEqual(
        classified.map((entry) => entry.level),
        [1, 2, 3],
        'SGD transcripts should be classified into distinct difficulty tiers'
    );

    assert.ok(
        classified[0].scores.composite < classified[1].scores.composite &&
        classified[1].scores.composite < classified[2].scores.composite,
        'composite scores should increase with transcript complexity'
    );
}

console.log('SGD difficulty classification tests passed');
