/**
 * Synthetic test PDF builder with representative corrupt text layer.
 * Generates valid PDF bytes without committing copyrighted source book data.
 */

function escapePdfText(text) {
    return String(text).replace(/([\\()])/g, '\\$1');
}

function buildCorruptTextLayerPdf(customPages) {
    const defaultPages = [
        'ANeglectedSpecias\nChapter 1\nBasics of Teaching Pronunciation',
        'jof ASTD itt Training IIMIWIN\nTeachingPronunciationintheCommunicativeClassroom'
    ];

    const pageTexts = customPages || defaultPages;
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
            const lines = text.split('\n');
            const streamLines = lines.map((l, lineIdx) => {
                const yOffset = 720 - lineIdx * 24;
                return `BT\n/F1 18 Tf\n72 ${yOffset} Td\n(${escapePdfText(l)}) Tj\nET`;
            }).join('\n');
            return `<< /Length ${Buffer.byteLength(streamLines, 'ascii')} >>\nstream\n${streamLines}\nendstream`;
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

module.exports = {
    buildCorruptTextLayerPdf,
    CORRUPT_FIXTURE_PAGE_1_CORRUPT: 'ANeglectedSpecias\nChapter 1\nBasics of Teaching Pronunciation',
    CORRUPT_FIXTURE_PAGE_1_TRUTH: 'A Neglected Species\nChapter 1\nBasics of Teaching Pronunciation',
    CORRUPT_FIXTURE_PAGE_2_CORRUPT: 'jof ASTD itt Training IIMIWIN\nTeachingPronunciationintheCommunicativeClassroom',
    CORRUPT_FIXTURE_PAGE_2_TRUTH: 'Teaching Pronunciation in the Communicative Classroom'
};
