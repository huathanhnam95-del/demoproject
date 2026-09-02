const assert = require('assert');
const { extractPdfPages, compareTextQuality } = require('../../functions/src/crm/book-pdf-extractor');
const { analyzeTextQuality } = require('../../functions/src/crm/book-text-quality');
const { EXPECTED, buildCorruptTextLayerPdf } = require('./fixtures/build-corrupt-text-layer-pdf');

async function main() {
    const extracted = await extractPdfPages(buildCorruptTextLayerPdf(), {
        referencePages: EXPECTED.pages.map((page) => page.rasterText)
    });

    assert.strictEqual(extracted.physicalPageCount, EXPECTED.physicalPageCount);
    assert.strictEqual(extracted.blankPageCount, 0);
    assert.deepStrictEqual(extracted.blankPages, []);
    assert.strictEqual(extracted.quality.sourceAccuracyStatus, 'unverified');
    assert.strictEqual(extracted.quality.sourceAccurate, null);
    assert.strictEqual(extracted.quality.embeddedVsReferenceDisagreement, true);

    const firstPage = extracted.quality.pages[0];
    assert.strictEqual(firstPage.isBlank, false);
    assert.strictEqual(firstPage.extractedTextBlank, false);
    assert.strictEqual(firstPage.confirmedPhysicalBlank, false);
    assert.strictEqual(firstPage.whitespaceRatio, 0);
    assert.ok(firstPage.longestAlphaRun >= 17);
    assert.ok(firstPage.suspiciousTokens.includes('ANeglectedSpecias'));
    assert.ok(firstPage.cer > 0);
    assert.ok(firstPage.wer > 0);

    const secondPage = extracted.quality.pages[1];
    assert.strictEqual(secondPage.isBlank, false);
    assert.strictEqual(secondPage.extractedTextBlank, false);
    assert.strictEqual(secondPage.confirmedPhysicalBlank, false);
    assert.ok(secondPage.suspiciousTokens.includes('IIMIWIN'));
    assert.ok(secondPage.suspiciousTokens.includes('itt'));
    assert.ok(secondPage.suspiciousTokens.includes('jof'));
    assert.ok(secondPage.suspiciousTokens.includes('ASTD'));
    assert.ok(secondPage.cer > 0);
    assert.ok(secondPage.wer > 0);

    const embeddedPages = EXPECTED.pages.map((page) => page.embeddedText);
    const referencePages = EXPECTED.pages.map((page) => page.rasterText);
    const verified = analyzeTextQuality({
        pages: referencePages,
        referencePages,
        physicalPageCount: EXPECTED.physicalPageCount
    });
    assert.strictEqual(verified.sourceAccuracyStatus, 'verified');
    assert.strictEqual(verified.sourceAccurate, true);

    const noReference = analyzeTextQuality({
        pages: embeddedPages,
        physicalPageCount: EXPECTED.physicalPageCount
    });
    assert.strictEqual(noReference.sourceAccuracyStatus, 'unverified');
    assert.strictEqual(noReference.sourceAccurate, null);

    const partialReference = analyzeTextQuality({
        pages: embeddedPages,
        referencePages: [referencePages[0]],
        physicalPageCount: EXPECTED.physicalPageCount
    });
    assert.strictEqual(partialReference.sourceAccuracyStatus, 'unverified');
    assert.strictEqual(partialReference.sourceAccurate, null);

    const sparseReferences = [];
    sparseReferences.length = EXPECTED.physicalPageCount;
    sparseReferences[1] = referencePages[1];
    const sparseReference = analyzeTextQuality({
        pages: referencePages,
        referencePages: sparseReferences,
        physicalPageCount: EXPECTED.physicalPageCount
    });
    assert.strictEqual(sparseReference.pages[0].referenceProvided, false);
    assert.strictEqual(sparseReference.pages[1].referenceProvided, true);
    assert.strictEqual(sparseReference.sourceAccuracyStatus, 'unverified');
    assert.strictEqual(sparseReference.sourceAccurate, null);

    const emptyExtractedPage = analyzeTextQuality({
        pages: [embeddedPages[0], ''],
        referencePages,
        physicalPageCount: EXPECTED.physicalPageCount
    });
    assert.strictEqual(emptyExtractedPage.pages[1].extractedTextBlank, true);
    assert.strictEqual(emptyExtractedPage.pages[1].confirmedPhysicalBlank, false);
    assert.deepStrictEqual(emptyExtractedPage.blankPages, []);
    assert.deepStrictEqual(emptyExtractedPage.extractedTextBlankPages, [2]);
    assert.strictEqual(emptyExtractedPage.sourceAccuracyStatus, 'unverified');
    assert.strictEqual(emptyExtractedPage.sourceAccurate, null);

    const subtlyWrongReference = [...referencePages];
    subtlyWrongReference[0] = 'A Neglected Speciez';
    const subtleMismatch = analyzeTextQuality({
        pages: embeddedPages,
        referencePages: subtlyWrongReference,
        physicalPageCount: EXPECTED.physicalPageCount
    });
    assert.ok(subtleMismatch.pages[0].cer > 0);
    assert.strictEqual(subtleMismatch.sourceAccuracyStatus, 'unverified');
    assert.strictEqual(subtleMismatch.sourceAccurate, null);

    assert.strictEqual(typeof compareTextQuality, 'function');
    const dehyphenated = compareTextQuality('A communi-\ncative class-\nroom', 'A communicative classroom');
    assert.strictEqual(dehyphenated.cer, 0);
    assert.strictEqual(dehyphenated.wer, 0);

    console.log('book text quality diagnostics contract passed');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
