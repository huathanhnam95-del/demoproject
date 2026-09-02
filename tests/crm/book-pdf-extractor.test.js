const assert = require('assert');
const crypto = require('crypto');
const { extractPdfPages } = require('../../functions/src/crm/book-pdf-extractor');
const { EXPECTED, buildCorruptTextLayerPdf } = require('./fixtures/build-corrupt-text-layer-pdf');

function escapePdfText(text) {
    return String(text).replace(/([\\()])/g, '\\$1');
}

function buildTinyPdf(pageTexts) {
    const pageIds = pageTexts.map((_, index) => 3 + index);
    const fontId = 3 + pageTexts.length;
    const contentIds = pageTexts.map((_, index) => fontId + 1 + index);
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        `<< /Type /Pages /Count ${pageTexts.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`,
        ...pageTexts.map((_, index) => (
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
            `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`
        )),
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        ...pageTexts.map((text) => {
            const stream = `BT\n/F1 18 Tf\n72 720 Td\n(${escapePdfText(text)}) Tj\nET`;
            return `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`;
        })
    ];

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((body, index) => {
        offsets.push(Buffer.byteLength(pdf, 'ascii'));
        pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });

    const xrefOffset = Buffer.byteLength(pdf, 'ascii');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => {
        pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(pdf, 'ascii');
}

function extractAsciiHexImagePayloads(pdfBuffer) {
    const source = Buffer.from(pdfBuffer).toString('ascii');
    const images = [];
    const imagePattern = /\/Subtype\s*\/Image\b[\s\S]*?\/Length\s+(\d+)\s*>>\s*stream\r?\n/g;
    let match;
    while ((match = imagePattern.exec(source))) {
        const streamStart = imagePattern.lastIndex;
        const streamEnd = source.indexOf('\nendstream', streamStart);
        assert.ok(streamEnd > streamStart, 'image XObject must have a complete stream');
        const payloadText = source.slice(streamStart, streamEnd).replace(/\s+/g, '').replace(/>$/, '');
        const payloadOffset = source.indexOf(payloadText, streamStart);
        images.push({
            bytes: Buffer.from(payloadText, 'hex'),
            payloadOffset
        });
        imagePattern.lastIndex = streamEnd + '\nendstream'.length;
    }
    return images;
}

function assertRasterPayloadsMatch(pdfBuffer, expectedPages) {
    const images = extractAsciiHexImagePayloads(pdfBuffer);
    assert.strictEqual(images.length, expectedPages.length, 'every expected physical page must have one raster payload');
    images.forEach((image, index) => {
        const actualSha256 = crypto.createHash('sha256').update(image.bytes).digest('hex');
        assert.strictEqual(
            actualSha256,
            expectedPages[index].rasterSha256,
            `raster SHA-256 mismatch on page ${index + 1}`
        );
    });
    return images;
}

async function main() {
    const corruptFixture = buildCorruptTextLayerPdf();
    const rasterImages = assertRasterPayloadsMatch(corruptFixture, EXPECTED.pages);
    const mutatedFixture = Buffer.from(corruptFixture);
    mutatedFixture[rasterImages[0].payloadOffset] = '0'.charCodeAt(0);
    mutatedFixture[rasterImages[0].payloadOffset + 1] = '0'.charCodeAt(0);
    assert.throws(
        () => assertRasterPayloadsMatch(mutatedFixture, EXPECTED.pages),
        /raster SHA-256 mismatch/,
        'a corrupt/white raster mutation must fail independent raster validation'
    );
    const allWhiteFixture = Buffer.from(corruptFixture);
    rasterImages.forEach((image) => {
        for (let index = 0; index < image.bytes.length; index++) {
            allWhiteFixture[image.payloadOffset + index * 2] = 'F'.charCodeAt(0);
            allWhiteFixture[image.payloadOffset + index * 2 + 1] = 'F'.charCodeAt(0);
        }
    });
    assert.throws(
        () => assertRasterPayloadsMatch(allWhiteFixture, EXPECTED.pages),
        /raster SHA-256 mismatch/,
        'an all-white raster mutation must fail independent raster validation'
    );

    const corruptExtracted = await extractPdfPages(corruptFixture);
    assert.strictEqual(corruptExtracted.totalPages, EXPECTED.physicalPageCount);
    assert.strictEqual(corruptExtracted.pages.length, EXPECTED.pages.length);
    assert.match(corruptExtracted.pages[0], /ANeglectedSpecias/);
    assert.match(corruptExtracted.pages[1], /IIMIWIN/);
    assert.match(corruptExtracted.pages[1], /itt/);
    assert.match(corruptExtracted.pages[1], /jof ASTD/);
    assert.notStrictEqual(corruptExtracted.pages[0].trim(), EXPECTED.pages[0].rasterText);
    assert.notStrictEqual(corruptExtracted.pages[1].trim(), EXPECTED.pages[1].rasterText);
    assert.strictEqual(corruptExtracted.sourceAccuracyStatus, 'unverified');
    assert.strictEqual(corruptExtracted.isSourceAccurate, null, 'corrupt native text must not be source-accurate');

    const extracted = await extractPdfPages(buildTinyPdf(['First page text', 'Second page text']));

    assert.strictEqual(extracted.totalPages, 2);
    assert.strictEqual(extracted.pages.length, 2);
    assert.match(extracted.pages[0], /First page text/);
    assert.match(extracted.pages[1], /Second page text/);
    assert.ok(extracted.avgCharsPerPage > 0);

    await assert.rejects(() => extractPdfPages(Buffer.from('not a PDF')));

    console.log('book PDF extractor page/text/error contract passed');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
