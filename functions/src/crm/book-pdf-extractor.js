const { analyzeTextQuality, compareTextQuality } = require('./book-text-quality');

const MIN_AVG_CHARS_PER_PAGE = 50;

function countImageXObjects(buffer) {
    const source = Buffer.isBuffer(buffer)
        ? buffer.toString('latin1')
        : Buffer.from(buffer).toString('latin1');
    return (source.match(/\/Subtype\s*\/Image\b/g) || []).length;
}

async function extractPdfPages(buffer, options = {}) {
    const uint8 = Buffer.isBuffer(buffer)
        ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        : (buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
    const { extractText } = await import('unpdf');

    const result = await extractText(uint8, { mergePages: false });
    const rawPages = result.text || [];
    const pages = rawPages.map((pageText) => {
        if (!pageText || typeof pageText !== 'string') return '';
        let t = pageText.replace(/([a-zA-Z]+)-\s*\n\s*([a-zA-Z]+)/g, '$1$2');
        t = t.replace(/^(\d{1,4})([A-Za-z])/gm, '$1\n$2');
        t = t.replace(/\r\n?/g, '\n');
        return t.split('\n').map((line) => line.trimEnd()).join('\n');
    });
    const totalPages = result.totalPages ?? pages.length;
    const physicalPageCount = Number.isInteger(totalPages) && totalPages >= 0 ? totalPages : pages.length;

    if (physicalPageCount === 0) {
        const quality = analyzeTextQuality({ pages: [], referencePages: options.referencePages, physicalPageCount: 0 });
        return {
            totalPages: 0,
            physicalPageCount: 0,
            pages: [],
            avgCharsPerPage: 0,
            isScanned: true,
            imageXObjectCount: countImageXObjects(buffer),
            blankPageCount: quality.blankPageCount,
            blankPages: quality.blankPages,
            extractedTextBlankCount: quality.extractedTextBlankCount,
            extractedTextBlankPages: quality.extractedTextBlankPages,
            sourceAccuracyStatus: quality.sourceAccuracyStatus,
            isSourceAccurate: quality.sourceAccurate,
            sourceAccurate: quality.sourceAccurate,
            quality
        };
    }

    const totalChars = pages.reduce((sum, p) => sum + (p || '').length, 0);
    const avgCharsPerPage = Math.round(totalChars / physicalPageCount);
    const isScanned = avgCharsPerPage < MIN_AVG_CHARS_PER_PAGE;
    const quality = analyzeTextQuality({
        pages,
        referencePages: options.referencePages,
        physicalPageCount
    });
    const imageXObjectCount = countImageXObjects(buffer);

    return {
        totalPages: physicalPageCount,
        physicalPageCount,
        pages,
        avgCharsPerPage,
        isScanned,
        imageXObjectCount,
        blankPageCount: quality.blankPageCount,
        blankPages: quality.blankPages,
        extractedTextBlankCount: quality.extractedTextBlankCount,
        extractedTextBlankPages: quality.extractedTextBlankPages,
        sourceAccuracyStatus: quality.sourceAccuracyStatus,
        isSourceAccurate: quality.sourceAccurate,
        sourceAccurate: quality.sourceAccurate,
        quality
    };
}

module.exports = { compareTextQuality, countImageXObjects, extractPdfPages, MIN_AVG_CHARS_PER_PAGE };
