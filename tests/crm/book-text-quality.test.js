/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
    calculateWhitespaceRatio,
    calculateLongestAlphabeticRun,
    detectSuspiciousTokens,
    calculateCER,
    calculateWER,
    detectDisagreement,
    assessPageTextQuality,
    assessBookTextQuality,
    QUALITY_THRESHOLDS
} = require('../../functions/src/crm/book-text-quality');

const { buildCorruptTextLayerPdf } = require('./fixtures/build-corrupt-text-layer-pdf');
const expectedFixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../fixtures/crm-books/corrupt-text-layer.expected.json'), 'utf8')
);

// Load production dictionary segmenter in VM
const segmenterSource = fs.readFileSync(path.resolve(__dirname, '../../public/js/crm/books-word-segmenter.js'), 'utf8');
const vmContext = { window: {} };
vm.runInNewContext(segmenterSource, vmContext, { filename: 'books-word-segmenter.js' });
const segmenter = vmContext.window.CrmWordSegmenter;

async function runTests() {
    console.log('Testing text quality diagnostics and metrics...');

    // 1. Whitespace ratio metrics
    const normalText = 'This is normal English prose with standard word spacing and punctuation.';
    const normalRatio = calculateWhitespaceRatio(normalText);
    assert.ok(normalRatio > 0.10, 'Normal prose should have > 10% whitespace');

    const corruptText1 = expectedFixture.pages[0].embeddedCorruptText;
    const corruptRatio1 = calculateWhitespaceRatio(corruptText1);
    assert.ok(corruptRatio1 < normalRatio, 'Corrupt text should have lower whitespace ratio');

    const noSpaceText = 'ANeglectedSpeciesChapter1BasicsOfTeachingPronunciation';
    assert.strictEqual(calculateWhitespaceRatio(noSpaceText), 0, 'No spaces text must report 0 whitespace');

    // 2. Longest alphabetic run
    const normalRun = calculateLongestAlphabeticRun(normalText);
    assert.ok(normalRun < QUALITY_THRESHOLDS.MAX_ALPHABETIC_RUN, 'Normal text longest run should be under threshold');

    const longFusedRun = calculateLongestAlphabeticRun(expectedFixture.pages[1].embeddedCorruptText);
    assert.strictEqual(
        longFusedRun,
        48,
        'Page 2 corrupt fused string should have 48 char alphabetic run'
    );
    assert.ok(
        longFusedRun >= QUALITY_THRESHOLDS.MAX_ALPHABETIC_RUN,
        'Long fused token must breach max alphabetic run threshold'
    );

    // 3. Suspicious tokens detection
    const detectedTokens = detectSuspiciousTokens(expectedFixture.pages[1].embeddedCorruptText);
    assert.ok(detectedTokens.includes('IIMIWIN') || detectedTokens.some((t) => t.includes('TeachingPronunciation')), 'Must detect suspicious tokens');

    // 4. Line-dehyphenation-tolerant CER / WER
    const refWithHyphen = 'This is a com-\nmunication framework.';
    const hypClean = 'This is a communication framework.';
    const cerClean = calculateCER(refWithHyphen, hypClean, { dehyphenate: true });
    assert.strictEqual(cerClean, 0, 'Dehyphenated reference must yield 0 CER against clean text');

    const werClean = calculateWER(refWithHyphen, hypClean, { dehyphenate: true });
    assert.strictEqual(werClean, 0, 'Dehyphenated reference must yield 0 WER against clean text');

    // 5. Embedded vs ground truth disagreement
    const page1Truth = expectedFixture.pages[0].sourceGroundTruth;
    const page1Corrupt = expectedFixture.pages[0].embeddedCorruptText;
    const disagreement = detectDisagreement(page1Corrupt, page1Truth);
    assert.ok(disagreement.disagrees, 'Disagreement check must flag corrupt embedded text against ground truth');
    assert.ok(disagreement.cer > 0.04, 'CER should be > 4% on corrupted page 1');
    assert.ok(disagreement.wer >= 0.20, 'WER should be >= 20% on corrupted page 1');
    assert.ok(calculateCER('A Neglected Species', 'ANeglectedSpecias') > 0.10, 'Heading CER should be > 10%');

    // 6. Segmenter behavior on corrupt text (amplifying corruption rather than recovering source truth)
    if (segmenter && typeof segmenter.segmentText === 'function') {
        const segOutput1 = segmenter.segmentText('ANeglectedSpecias');
        assert.strictEqual(
            segOutput1,
            'A Neglected Spec ias',
            'Segmenter must produce "A Neglected Spec ias" from "ANeglectedSpecias" (proving it splits Specias to Spec ias)'
        );

        const segOutput2 = segmenter.segmentText('IIMIWIN');
        assert.strictEqual(
            segOutput2,
            'IIMIW IN',
            'Segmenter must produce "IIMIW IN" from "IIMIWIN"'
        );
    }

    // 7. Page-level and book-level quality assessment
    const page1Assessment = assessPageTextQuality(page1Corrupt, 1);
    assert.strictEqual(page1Assessment.isSuspect, true, 'Page 1 corrupt text must be assessed as suspect');

    const page2Assessment = assessPageTextQuality(expectedFixture.pages[1].embeddedCorruptText, 2);
    assert.strictEqual(page2Assessment.isSuspect, true, 'Page 2 corrupt text must be assessed as suspect');
    assert.ok(page2Assessment.reasons.length > 0, 'Must provide explanatory reasons for suspect page');

    const bookAssessment = assessBookTextQuality([page1Corrupt, expectedFixture.pages[1].embeddedCorruptText]);
    assert.strictEqual(bookAssessment.isSuspect, true, 'Book with corrupt pages must be flagged as suspect');
    assert.strictEqual(bookAssessment.suspectPagesCount, 2, 'Both corrupt pages must be counted as suspect');

    console.log('book text quality metrics and diagnostics tests passed');
}

runTests().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
