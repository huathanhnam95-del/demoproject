const TARGET_CHUNK_SIZE = 1200;
const OVERLAP_SIZE = 150;
const HEADER_THRESHOLD = 0.6;

function detectRepeatedHeaders(pages) {
    const lineCounts = new Map();
    for (const page of pages) {
        if (!page) continue;
        const lines = page.split('\n').slice(0, 3);
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length < 3 || trimmed.length > 120) continue;
            lineCounts.set(trimmed, (lineCounts.get(trimmed) || 0) + 1);
        }
    }

    const threshold = Math.max(3, Math.floor(pages.length * HEADER_THRESHOLD));
    const headers = new Set();
    for (const [line, count] of lineCounts) {
        if (count >= threshold) headers.add(line);
    }

    const footerCounts = new Map();
    for (const page of pages) {
        if (!page) continue;
        const lines = page.split('\n');
        const tail = lines.slice(Math.max(0, lines.length - 3));
        for (const line of tail) {
            const trimmed = line.trim();
            if (trimmed.length < 3 || trimmed.length > 120) continue;
            footerCounts.set(trimmed, (footerCounts.get(trimmed) || 0) + 1);
        }
    }
    for (const [line, count] of footerCounts) {
        if (count >= threshold) headers.add(line);
    }

    return headers;
}

function stripHeaders(text, headers) {
    if (!headers.size) return text;
    const lines = text.split('\n');
    return lines.filter((l) => !headers.has(l.trim())).join('\n');
}

function splitOnBoundaries(text) {
    const paragraphs = text.split(/\n\s*\n/);
    const segments = [];
    for (const para of paragraphs) {
        const trimmed = para.trim();
        if (!trimmed) continue;
        if (trimmed.length <= TARGET_CHUNK_SIZE * 1.3) {
            segments.push(trimmed);
        } else {
            const sentences = trimmed.match(/[^.!?]+[.!?]+[\s"']*/g) || [trimmed];
            for (const s of sentences) {
                const st = s.trim();
                if (st) segments.push(st);
            }
        }
    }
    return segments;
}

function chunkPages(pages, options = {}) {
    const target = options.targetSize || TARGET_CHUNK_SIZE;
    const overlap = options.overlapSize || OVERLAP_SIZE;

    const headers = detectRepeatedHeaders(pages);

    const pageTexts = pages.map((p, i) => ({
        pageNumber: i + 1,
        text: stripHeaders(p || '', headers).trim()
    }));

    const chunks = [];
    let currentText = '';
    let currentPageStart = 1;
    let currentPageEnd = 1;

    function flushChunk() {
        const trimmed = currentText.trim();
        if (!trimmed) return;
        chunks.push({
            index: chunks.length,
            text: trimmed,
            charCount: trimmed.length,
            pageStart: currentPageStart,
            pageEnd: currentPageEnd,
            textRevisionId: options.textRevisionId || null
        });
    }

    for (const { pageNumber, text } of pageTexts) {
        if (!text) continue;

        const segments = splitOnBoundaries(text);
        for (const seg of segments) {
            if (!currentText) {
                currentPageStart = pageNumber;
                currentPageEnd = pageNumber;
                currentText = seg;
                continue;
            }

            if (currentText.length + seg.length + 1 <= target * 1.3) {
                currentText += '\n\n' + seg;
                currentPageEnd = pageNumber;
            } else {
                flushChunk();

                const overlapText = currentText.length > overlap
                    ? currentText.slice(-overlap)
                    : '';
                currentText = overlapText ? overlapText + '\n\n' + seg : seg;
                currentPageStart = overlapText ? currentPageEnd : pageNumber;
                currentPageEnd = pageNumber;
            }
        }
    }
    flushChunk();

    return { chunks, strippedHeaders: [...headers] };
}

module.exports = {
    chunkPages,
    detectRepeatedHeaders,
    stripHeaders,
    TARGET_CHUNK_SIZE,
    OVERLAP_SIZE,
    HEADER_THRESHOLD
};
