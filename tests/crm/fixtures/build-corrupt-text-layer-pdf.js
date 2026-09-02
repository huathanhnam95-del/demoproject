const EXPECTED = require('../../../tests/fixtures/crm-books/corrupt-text-layer.expected.json');

const GLYPHS = {
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
    C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
    D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
    H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
    J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
    K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    N: ['10001', '11001', '11001', '10101', '10011', '10011', '10001'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
    W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
    X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
    Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
    Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111']
};

const PAGE_WIDTH = 600;
const PAGE_HEIGHT = 800;
const IMAGE_HEIGHT = 80;
const SCALE = 2;

function rasterize(text) {
    const width = PAGE_WIDTH * SCALE;
    const height = IMAGE_HEIGHT * SCALE;
    const pixels = new Uint8Array(width * height).fill(255);
    const glyphWidth = 5 * SCALE;
    const glyphHeight = 7 * SCALE;
    const gap = SCALE;
    const charWidth = glyphWidth + gap;
    const textWidth = Math.min(width, text.length * charWidth);
    const startX = Math.max(0, Math.floor((width - textWidth) / 2));
    const startY = Math.floor((height - glyphHeight) / 2);

    [...text].forEach((character, charIndex) => {
        const glyph = GLYPHS[character.toUpperCase()];
        if (!glyph) return;
        const glyphX = startX + (charIndex * charWidth);
        glyph.forEach((row, rowIndex) => {
            [...row].forEach((bit, columnIndex) => {
                if (bit !== '1') return;
                for (let y = 0; y < SCALE; y++) {
                    for (let x = 0; x < SCALE; x++) {
                        const pixelX = glyphX + columnIndex * SCALE + x;
                        const pixelY = startY + rowIndex * SCALE + y;
                        if (pixelX < width && pixelY < height) {
                            pixels[pixelY * width + pixelX] = 0;
                        }
                    }
                }
            });
        });
    });

    return { width, height, pixels };
}

function escapePdfText(text) {
    return String(text).replace(/([\\()])/g, '\\$1');
}

function asciiHex(buffer) {
    return `${Buffer.from(buffer).toString('hex').toUpperCase()}>`;
}

function buildPdf(objects) {
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

function buildCorruptTextLayerPdf() {
    const pageIds = [3, 4];
    const fontId = 5;
    const imageIds = [6, 7];
    const contentIds = [8, 9];
    const images = EXPECTED.pages.map((page) => {
        const image = rasterize(page.rasterText);
        const encoded = asciiHex(image.pixels);
        return `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
            `/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode ` +
            `/Length ${Buffer.byteLength(encoded, 'ascii')} >>\nstream\n${encoded}\nendstream`;
    });
    const contents = EXPECTED.pages.map((page, index) => {
        const stream = [
            'q',
            `${PAGE_WIDTH} 0 0 ${IMAGE_HEIGHT} 0 0 cm`,
            `/Im${index + 1} Do`,
            'Q',
            'BT',
            '/F1 18 Tf',
            '3 Tr',
            '72 740 Td',
            `(${escapePdfText(page.embeddedText)}) Tj`,
            'ET'
        ].join('\n');
        return `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`;
    });
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>',
        ...pageIds.map((pageId, index) => (
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
            `/Resources << /XObject << /Im${index + 1} ${imageIds[index]} 0 R >> ` +
            `/Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`
        )),
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        ...images,
        ...contents
    ];

    return buildPdf(objects);
}

module.exports = {
    EXPECTED,
    PAGE_HEIGHT,
    PAGE_WIDTH,
    buildCorruptTextLayerPdf,
    rasterize
};
