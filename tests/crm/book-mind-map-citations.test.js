/* eslint-disable no-console */
const assert = require('assert');
const {
    normalizeMindMapCategories,
    collectMindMapCitationGaps,
    buildMindMapCitationRepairPrompt,
    repairMindMapCitations,
    MIND_MAP_CITATION_SCHEMA_VERSION
} = require('../../functions/src/crm/book-summary-service');

const notes = [
    {
        id: 'note_1',
        text: 'Learning as product focuses on the result. Learning as process focuses on the experience.'
    },
    {
        id: 'note_2',
        text: 'Learning as function emphasizes motivation, retention, and transfer.'
    },
    {
        id: 'note_3',
        text: 'Motivation — retention and transfer shape durable learning.'
    }
];

const categories = normalizeMindMapCategories([
    {
        id: 'cat_1',
        title: 'Dimensions of Learning',
        subtopics: [
            {
                id: 'sub_1_1',
                title: 'Product and Process',
                summary: 'Learning can be understood by its result or by the experience itself.',
                noteIds: ['note_1', 'invented_note'],
                citations: [
                    {
                        noteId: 'note_1',
                        quote: 'Learning as product focuses on the result.'
                    },
                    {
                        noteId: 'note_1',
                        quote: 'This sentence was never in the source note.'
                    },
                    {
                        noteId: 'note_1',
                        quote: '  Learning as product focuses on the result.  '
                    },
                    {
                        noteId: 'invented_note',
                        quote: 'Invented citation.'
                    }
                ],
                fullText: 'Generated supporting explanation.'
            },
            {
                id: 'sub_1_2',
                title: 'Function',
                summary: 'Learning also depends on motivation and transfer.',
                noteIds: ['note_2'],
                citations: [
                    {
                        noteId: 'note_2',
                        quote: 'Learning as function emphasizes motivation, retention, and transfer.'
                    }
                ]
            },
            {
                id: 'sub_1_3',
                title: 'Shared Function Evidence',
                summary: 'The same passage can support a related thought.',
                noteIds: ['note_2'],
                citations: [{
                    noteId: 'note_2',
                    quote: 'Learning as function emphasizes motivation, retention, and transfer.'
                }]
            },
            {
                id: 'sub_1_4',
                title: 'Typography Normalization',
                summary: 'Typography differences still match the saved passage.',
                noteIds: ['note_3'],
                citations: [{
                    noteId: 'note_3',
                    quote: 'Motivation -   retention and transfer shape durable learning.'
                }]
            }
        ]
    }
], notes);

assert.deepStrictEqual(
    categories[0].subtopics[0].noteIds,
    ['note_1'],
    'Mind-map note IDs must be restricted to real source notes.'
);
assert.deepStrictEqual(
    categories[0].subtopics[0].citations,
    [{ noteId: 'note_1', quote: 'Learning as product focuses on the result.' }],
    'Only exact quotes from the cited source note may survive normalization and duplicates must collapse.'
);
assert.deepStrictEqual(
    categories[0].subtopics[1].citations,
    [{ noteId: 'note_2', quote: 'Learning as function emphasizes motivation, retention, and transfer.' }],
    'Each thought block must retain its own source-backed citation.'
);
assert.strictEqual(categories[0].subtopics[0].evidenceStatus, 'verified', 'Valid citations must mark the block verified.');
assert.deepStrictEqual(
    categories[0].subtopics[2].citations,
    categories[0].subtopics[1].citations,
    'The same valid citation may be reused by separate thought blocks.'
);
assert.strictEqual(categories[0].subtopics[3].evidenceStatus, 'verified', 'Whitespace and typographic punctuation normalization must match genuine source text.');

const missingEvidenceCategories = normalizeMindMapCategories([
    {
        id: 'cat_2',
        title: 'Needs Evidence',
        subtopics: [{
            id: 'sub_missing',
            title: 'Missing citation',
            summary: 'This block needs a source passage.',
            noteIds: ['note_1'],
            citations: []
        }]
    }
], notes);
assert.strictEqual(missingEvidenceCategories[0].subtopics[0].evidenceStatus, 'insufficient', 'Blocks without citations must be marked insufficient.');
assert.deepStrictEqual(
    collectMindMapCitationGaps(missingEvidenceCategories).map(gap => gap.subtopicId),
    ['sub_missing'],
    'Citation gaps must identify the stable subtopic ID for repair.'
);

const repairPrompt = buildMindMapCitationRepairPrompt(
    collectMindMapCitationGaps(missingEvidenceCategories),
    notes
);
assert.match(repairPrompt, /sub_missing/, 'Repair prompt must include the stable subtopic ID.');
assert.match(repairPrompt, /exact, verbatim quote/i, 'Repair prompt must require exact source passages.');
assert.ok(!repairPrompt.includes(notes[1].text), 'Repair prompt should scope source text to the notes referenced by the gap.');

const inventedOnlyCategories = normalizeMindMapCategories([{
    id: 'cat_invented',
    subtopics: [{
        id: 'sub_invented',
        title: 'Invented initial quote',
        summary: 'Needs a genuine passage.',
        noteIds: ['note_1'],
        citations: [{ noteId: 'note_1', quote: 'A fabricated sentence.' }]
    }]
}], notes);
assert.strictEqual(inventedOnlyCategories[0].subtopics[0].evidenceStatus, 'insufficient', 'Invented initial quotes must be downgraded before repair.');

(async () => {
    let repairCalls = 0;
    const repaired = await repairMindMapCitations({
        categories: missingEvidenceCategories,
        notes,
        models: {},
        generate: async () => {
            repairCalls += 1;
            return {
                json: {
                    citations: [{
                        subtopicId: 'sub_missing',
                        citations: [{ noteId: 'note_1', quote: 'Learning as process focuses on the experience.' }]
                    }]
                },
                usage: { inputTokens: 3, outputTokens: 4 }
            };
        }
    });
    assert.strictEqual(repairCalls, 1, 'Citation repair must make at most one bounded repair call.');
    assert.strictEqual(repaired.categories[0].subtopics[0].evidenceStatus, 'verified', 'A valid repair must verify the block.');
    assert.strictEqual(repaired.repairedCount, 1, 'Successful repairs must be counted.');

    const inventedRepair = await repairMindMapCitations({
        categories: inventedOnlyCategories,
        notes,
        models: {},
        generate: async () => ({
            json: {
                citations: [{
                    subtopicId: 'sub_invented',
                    citations: [{ noteId: 'note_1', quote: 'Learning as product focuses on the result.' }]
                }]
            }
        })
    });
    assert.strictEqual(inventedRepair.categories[0].subtopics[0].evidenceStatus, 'verified', 'A valid repair must replace an invented initial quote.');

    const failedRepair = await repairMindMapCitations({
        categories: missingEvidenceCategories,
        notes,
        models: {},
        generate: async () => ({
            json: {
                citations: [{
                    subtopicId: 'sub_missing',
                    citations: [{ noteId: 'note_1', quote: 'This passage is not in the note.' }]
                }]
            },
            usage: { inputTokens: 3, outputTokens: 4 }
        })
    });
    assert.strictEqual(failedRepair.categories[0].subtopics[0].evidenceStatus, 'insufficient', 'Invalid repairs must remain explicitly insufficient.');
    assert.deepStrictEqual(failedRepair.categories[0].subtopics[0].citations, [], 'Invalid repairs must not leak as citations.');
    assert.strictEqual(failedRepair.insufficientCount, 1, 'Remaining gaps must be counted as insufficient.');
})();

assert.strictEqual(MIND_MAP_CITATION_SCHEMA_VERSION, 1, 'Mind maps must expose a stable citation schema version.');

setImmediate(() => console.log('book mind-map citation contracts passed'));
