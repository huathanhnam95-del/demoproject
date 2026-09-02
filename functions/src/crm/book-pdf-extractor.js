const { assessBookTextQuality } = require('./book-text-quality');

const MIN_AVG_CHARS_PER_PAGE = 50;

async function extractPdfPages(buffer) {
    const uint8 = Buffer.isBuffer(buffer)
        ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        : (buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
    const { extractText } = await import('unpdf');

    const result = await extractText(uint8, { mergePages: false });
    const pages = result.text || [];
    const totalPages = result.totalPages ?? pages.length;

    if (totalPages === 0) {
        return {
            totalPages: 0,
            pages: [],
            avgCharsPerPage: 0,
            isScanned: true,
            isSuspect: true,
            textQuality: assessBookTextQuality([])
        };
    }

    const totalChars = pages.reduce((sum, p) => sum + (p || '').length, 0);
    const avgCharsPerPage = Math.round(totalChars / totalPages);
    const isScanned = avgCharsPerPage < MIN_AVG_CHARS_PER_PAGE;
    const textQuality = assessBookTextQuality(pages);
    const isSuspect = textQuality.isSuspect;

    return {
        totalPages,
        pages,
        avgCharsPerPage,
        isScanned,
        isSuspect,
        textQuality
    };
}

module.exports = { extractPdfPages, MIN_AVG_CHARS_PER_PAGE };
