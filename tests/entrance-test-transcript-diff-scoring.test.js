const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function getDiffFunction() {
    const fileContent = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'crm-entrance-test-result.js'), 'utf8');

    const fnMatch = fileContent.match(/function computeTranscriptDiffHtml\([\s\S]*?\n  \}/);
    if (!fnMatch) {
        throw new Error('Could not find computeTranscriptDiffHtml in public/crm-entrance-test-result.js');
    }

    const scriptSource = `
        function escapeHtml(str) {
            return String(str || '').replace(/[&<>"']/g, function(m) {
                switch (m) {
                    case '&': return '&amp;';
                    case '<': return '&lt;';
                    case '>': return '&gt;';
                    case '"': return '&quot;';
                    case "'": return '&#039;';
                    default: return m;
                }
            });
        }
        function formatTimeSec(ms) {
            if (!Number.isFinite(ms)) return '0:00';
            const sec = Math.floor(ms / 1000);
            const m = Math.floor(sec / 60);
            const s = sec % 60;
            return m + ':' + (s < 10 ? '0' : '') + s;
        }
        ${fnMatch[0]}
        this.computeTranscriptDiffHtml = computeTranscriptDiffHtml;
    `;
    const context = vm.createContext({
        window: {},
        document: {}
    });
    const script = new vm.Script(scriptSource);
    script.runInContext(context);
    return context.computeTranscriptDiffHtml;
}

test('computeTranscriptDiffHtml: Q1 restores "get" with crm-transcript-correct and accuracy tooltip', () => {
    const computeTranscriptDiffHtml = getDiffFunction();
    const expected = 'Scientists make observations, make assumptions, and do experiments. After these have been done, they get their results.';
    const words = [
        { word: 'Scientists', startMs: 200, endMs: 700, accuracyScore: 95, errorType: 'None' },
        { word: 'make', startMs: 750, endMs: 1000, accuracyScore: 92, errorType: 'None' },
        { word: 'observations', startMs: 1050, endMs: 1800, accuracyScore: 90, errorType: 'None' },
        { word: 'make', startMs: 1850, endMs: 2100, accuracyScore: 88, errorType: 'None' },
        { word: 'assumptions', startMs: 2150, endMs: 2900, accuracyScore: 85, errorType: 'None' },
        { word: 'and', startMs: 2950, endMs: 3100, accuracyScore: 91, errorType: 'None' },
        { word: 'do', startMs: 3150, endMs: 3300, accuracyScore: 94, errorType: 'None' },
        { word: 'experiments', startMs: 3350, endMs: 4100, accuracyScore: 89, errorType: 'None' },
        { word: 'After', startMs: 4500, endMs: 4800, accuracyScore: 96, errorType: 'None' },
        { word: 'these', startMs: 4850, endMs: 5100, accuracyScore: 90, errorType: 'None' },
        { word: 'have', startMs: 5150, endMs: 5350, accuracyScore: 92, errorType: 'None' },
        { word: 'been', startMs: 5400, endMs: 5600, accuracyScore: 93, errorType: 'None' },
        { word: 'done', startMs: 5650, endMs: 6000, accuracyScore: 95, errorType: 'None' },
        { word: 'they', startMs: 7500, endMs: 7800, accuracyScore: 98, errorType: 'None' },
        { word: 'get', startMs: 7940, endMs: 8245, accuracyScore: 97, errorType: 'None' },
        { word: 'their', startMs: 8300, endMs: 8500, accuracyScore: 95, errorType: 'None' },
        { word: 'results', startMs: 8550, endMs: 9100, accuracyScore: 94, errorType: 'None' }
    ];

    const html = computeTranscriptDiffHtml(expected, '', words);

    // "get" must be rendered with crm-transcript-correct
    assert.ok(html.includes('crm-transcript-correct'), 'should have correct tokens');
    assert.ok(html.includes('data-start-ms="7940"'), 'should have start-ms 7940 for get');
    assert.ok(html.includes('Accuracy: 97%'), 'tooltip should display Accuracy: 97%');
    // Ensure "get" is NOT marked as omitted
    assert.ok(!html.includes('title="get (omitted)"'), 'get should NOT be marked omitted');
});

test('computeTranscriptDiffHtml: Q2 flags mispronounced "accurately" with crm-transcript-error', () => {
    const computeTranscriptDiffHtml = getDiffFunction();
    const expected = 'Statistical literacy, then, is the ability to accurately understand the data.';
    const words = [
        { word: 'Statistical', startMs: 1000, endMs: 1600, accuracyScore: 88, errorType: 'None' },
        { word: 'literacy', startMs: 1650, endMs: 2200, accuracyScore: 82, errorType: 'None' },
        { word: 'then', startMs: 2300, endMs: 2500, accuracyScore: 90, errorType: 'None' },
        { word: 'is', startMs: 2550, endMs: 2700, accuracyScore: 95, errorType: 'None' },
        { word: 'the', startMs: 2750, endMs: 2900, accuracyScore: 92, errorType: 'None' },
        { word: 'ability', startMs: 2950, endMs: 3400, accuracyScore: 85, errorType: 'None' },
        { word: 'to', startMs: 3450, endMs: 3600, accuracyScore: 91, errorType: 'None' },
        { word: 'accurately', startMs: 24940, endMs: 25990, accuracyScore: 18, errorType: 'Mispronunciation' },
        { word: 'understand', startMs: 26100, endMs: 26800, accuracyScore: 87, errorType: 'None' },
        { word: 'the', startMs: 26850, endMs: 27000, accuracyScore: 93, errorType: 'None' },
        { word: 'data', startMs: 27050, endMs: 27500, accuracyScore: 89, errorType: 'None' }
    ];

    const html = computeTranscriptDiffHtml(expected, '', words);

    // "accurately" must have crm-transcript-error
    assert.ok(html.includes('class="crm-word-token crm-transcript-error"'), 'should have crm-transcript-error class');
    assert.ok(html.includes('Accuracy: 18%'), 'tooltip should display Accuracy: 18%');
    assert.ok(html.includes('[Mispronunciation]'), 'tooltip should display [Mispronunciation]');
    // Make sure "accurately" is NOT green
    assert.ok(!html.includes('class="crm-word-token crm-transcript-correct" data-start-ms="24940"'), 'accurately should NOT be crm-transcript-correct');
});

test('computeTranscriptDiffHtml: classifies 60-79 as crm-transcript-uncertain', () => {
    const computeTranscriptDiffHtml = getDiffFunction();
    const expected = 'We observe the stars.';
    const words = [
        { word: 'We', startMs: 100, endMs: 300, accuracyScore: 85, errorType: 'None' },
        { word: 'observe', startMs: 350, endMs: 800, accuracyScore: 72, errorType: 'None' },
        { word: 'the', startMs: 850, endMs: 1000, accuracyScore: 90, errorType: 'None' },
        { word: 'stars', startMs: 1050, endMs: 1500, accuracyScore: 95, errorType: 'None' }
    ];

    const html = computeTranscriptDiffHtml(expected, '', words);
    assert.ok(html.includes('class="crm-word-token crm-transcript-uncertain"'), 'observe should be crm-transcript-uncertain');
    assert.ok(html.includes('Accuracy: 72%'), 'tooltip should show Accuracy: 72%');
});

test('computeTranscriptDiffHtml: backwards compatible with words lacking accuracyScore', () => {
    const computeTranscriptDiffHtml = getDiffFunction();
    const expected = 'Hello world';
    const words = [
        { word: 'Hello', startMs: 100, endMs: 400 },
        { word: 'world', startMs: 450, endMs: 800 }
    ];

    const html = computeTranscriptDiffHtml(expected, '', words);
    assert.ok(html.includes('crm-transcript-correct'), 'should default to correct for legacy words');
    assert.ok(!html.includes('Accuracy:'), 'no accuracy tooltip for legacy words');
});

test('computeTranscriptDiffHtml: boundary scoring (59=error, 60=uncertain, 79=uncertain, 80=correct, 0=error)', () => {
    const computeTranscriptDiffHtml = getDiffFunction();
    const expected = 'wordZero wordFiftyNine wordSixty wordSeventyNine wordEighty';
    const words = [
        { word: 'wordZero', startMs: 0, endMs: 200, accuracyScore: 0, errorType: 'None' },
        { word: 'wordFiftyNine', startMs: 250, endMs: 500, accuracyScore: 59, errorType: 'None' },
        { word: 'wordSixty', startMs: 550, endMs: 800, accuracyScore: 60, errorType: 'None' },
        { word: 'wordSeventyNine', startMs: 850, endMs: 1100, accuracyScore: 79, errorType: 'None' },
        { word: 'wordEighty', startMs: 1150, endMs: 1400, accuracyScore: 80, errorType: 'None' }
    ];

    const html = computeTranscriptDiffHtml(expected, '', words);
    // wordZero at 0ms is playable
    assert.ok(html.includes('data-start-ms="0"'), 'word at startMs=0 must be rendered with data-start-ms="0"');
    assert.ok(html.includes('class="crm-word-token crm-transcript-error" data-start-ms="0"'), 'score 0 must be crm-transcript-error');
    assert.ok(html.includes('class="crm-word-token crm-transcript-error" data-start-ms="250"'), 'score 59 must be crm-transcript-error');
    assert.ok(html.includes('class="crm-word-token crm-transcript-uncertain" data-start-ms="550"'), 'score 60 must be crm-transcript-uncertain');
    assert.ok(html.includes('class="crm-word-token crm-transcript-uncertain" data-start-ms="850"'), 'score 79 must be crm-transcript-uncertain');
    assert.ok(html.includes('class="crm-word-token crm-transcript-correct" data-start-ms="1150"'), 'score 80 must be crm-transcript-correct');
});

test('computeTranscriptDiffHtml: errorType case-insensitivity and lowercase none suppression', () => {
    const computeTranscriptDiffHtml = getDiffFunction();
    const expected = 'accent check';
    const words = [
        { word: 'accent', startMs: 100, endMs: 400, accuracyScore: 92, errorType: 'mispronunciation' },
        { word: 'check', startMs: 450, endMs: 700, accuracyScore: 85, errorType: 'none' }
    ];

    const html = computeTranscriptDiffHtml(expected, '', words);
    // accent has score 92 but errorType 'mispronunciation' (lowercase) -> must be crm-transcript-error
    assert.ok(html.includes('class="crm-word-token crm-transcript-error" data-start-ms="100"'), 'mispronunciation in lowercase must still yield error');
    assert.ok(html.includes('[mispronunciation]'), 'tooltip must show [mispronunciation]');

    // check has errorType 'none' (lowercase) -> tooltip must NOT show [none]
    assert.ok(!html.includes('[none]'), 'tooltip should NOT show [none]');
    assert.ok(html.includes('class="crm-word-token crm-transcript-correct" data-start-ms="450"'), 'check must be correct');
});

test('computeTranscriptDiffHtml: preserves and serializes syllables in data-syllables and data-accuracy', () => {
    const computeTranscriptDiffHtml = getDiffFunction();
    const expected = 'Statistical indicators accurately understand';
    const syllablesAccurately = [
        { text: 'ac', ipa: 'æk', accuracyScore: 34 },
        { text: 'cu', ipa: 'jʊ', accuracyScore: 9 },
        { text: 'rate', ipa: 'rət', accuracyScore: 23 },
        { text: 'ly', ipa: 'li', accuracyScore: 58 }
    ];
    const syllablesIndicators = [
        { text: 'in', ipa: 'ɪn', accuracyScore: 99 },
        { text: 'di', ipa: 'dɪ', accuracyScore: 100 },
        { text: 'ca', ipa: 'keɪ', accuracyScore: 100 },
        { text: 'tors', ipa: 'tərz', accuracyScore: 74 }
    ];
    const words = [
        {
            word: 'Statistical',
            startMs: 1000,
            endMs: 1600,
            accuracyScore: 88,
            errorType: 'None'
        },
        {
            word: 'indicators',
            startMs: 1650,
            endMs: 2200,
            accuracyScore: 74,
            errorType: 'None',
            syllables: syllablesIndicators
        },
        {
            word: 'accurately',
            startMs: 2250,
            endMs: 2900,
            accuracyScore: 18,
            errorType: 'Mispronunciation',
            syllables: syllablesAccurately
        },
        {
            word: 'understand',
            startMs: 2950,
            endMs: 3400,
            accuracyScore: 87,
            errorType: 'None',
            syllables: null
        }
    ];

    const html = computeTranscriptDiffHtml(expected, '', words);

    // Verify indicators token attributes
    assert.ok(html.includes('data-accuracy="74"'), 'indicators must have data-accuracy="74"');
    assert.ok(html.includes('data-syllables='), 'must serialize data-syllables');
    assert.ok(html.includes('&quot;text&quot;:&quot;tors&quot;'), 'syllables for indicators must contain tors');
    assert.ok(html.includes('class="crm-word-token crm-transcript-uncertain"'), 'indicators must be crm-transcript-uncertain');

    // Verify accurately token attributes
    assert.ok(html.includes('data-accuracy="18"'), 'accurately must have data-accuracy="18"');
    assert.ok(html.includes('&quot;text&quot;:&quot;rate&quot;'), 'syllables for accurately must contain rate');
    assert.ok(html.includes('class="crm-word-token crm-transcript-error"'), 'accurately must be crm-transcript-error');

    // Verify understand has empty array serialized for syllables
    assert.ok(html.includes('data-accuracy="87" data-syllables=\'[]\''), 'understand with null syllables must serialize to empty array');
});

test('computeTranscriptDiffHtml: correctly escapes and serializes complex syllables with apostrophes and non-playable tokens', () => {
    const computeTranscriptDiffHtml = getDiffFunction();
    const expected = "people's don't omittedWord";
    const words = [
        {
            word: "people's",
            startMs: 100,
            endMs: 500,
            accuracyScore: 78,
            errorType: 'None',
            syllables: [
                { text: 'peo', ipa: 'pi', accuracyScore: 90 },
                { text: "ple's", ipa: 'pəlz', accuracyScore: 66 }
            ]
        },
        {
            word: "don't",
            startMs: null, // non-playable token
            endMs: null,
            accuracyScore: 55,
            errorType: 'Mispronunciation',
            syllables: [
                { text: "don't", ipa: 'doʊnt', accuracyScore: 55 }
            ]
        }
    ];

    const html = computeTranscriptDiffHtml(expected, '', words);
    assert.ok(html.includes('data-syllables='), 'must serialize data-syllables attribute');

    // Extract data-syllables attribute value and test parsing like the browser would
    const match = html.match(/data-syllables='([^']+)'/);
    assert.ok(match, 'must match data-syllables single-quoted attribute');
    const attrRaw = match[1];

    // Decode HTML entities (as the browser DOM parser does)
    const decoded = attrRaw
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');

    const parsed = JSON.parse(decoded);
    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0].text, 'peo');
    assert.strictEqual(parsed[1].text, "ple's");
    assert.strictEqual(parsed[1].accuracyScore, 66);

    // Verify non-playable token receives accuracy and syllables attributes
    assert.ok(html.includes('<span class="crm-word-token crm-transcript-error" data-playable="false" data-accuracy="55" data-syllables='), 'unplayable token with accuracy must serialize data-accuracy and data-syllables');
});

