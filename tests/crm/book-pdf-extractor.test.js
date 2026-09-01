const assert = require('assert');
const { extractPdfPages } = require('../../functions/src/crm/book-pdf-extractor');

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

async function main() {
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
