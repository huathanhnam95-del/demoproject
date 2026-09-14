'use strict';

const { fail } = require('./contracts.cjs');

function pdfEscape(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[\r\n]+/g, ' ');
}

function buildPdf(lines) {
    const content = ['BT', '/F1 11 Tf', '50 770 Td', ...lines.map((line, index) => `${index ? '0 -16 Td ' : ''}(${pdfEscape(line)}) Tj`), 'ET'].join('\n');
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`
    ];
    let output = '%PDF-1.4\n';
    const offsets = [0];
    for (let index = 0; index < objects.length; index += 1) {
        offsets.push(Buffer.byteLength(output, 'utf8'));
        output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
    }
    const xref = Buffer.byteLength(output, 'utf8');
    output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(output, 'utf8');
}

function createPdfService({ archives } = {}) {
    if (!archives) throw new TypeError('archives is required');
    async function exportPdf(identity, roomId) {
        const archive = await archives.readArchive(identity, roomId);
        const lines = ['BEL Working as Equals', `Room ${archive.roomId}`, `Archive ${archive.checksum}`];
        for (const [uid, notebook] of Object.entries(archive.notebooks)) {
            lines.push(`Notes for ${uid}`);
            for (const page of notebook.pages || []) lines.push(`${page.title}: ${page.body}`);
        }
        if (lines.length === 3) lines.push('No saved notes.');
        return buildPdf(lines);
    }
    return { exportPdf };
}

module.exports = { buildPdf, createPdfService };
