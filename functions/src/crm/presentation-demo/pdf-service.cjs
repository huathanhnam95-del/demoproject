'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { assertActiveIdentity, assertRoomActor } = require('./identity.cjs');
const { fail } = require('./contracts.cjs');

const FONT_PATH = path.join(__dirname, 'fonts', 'Roboto-Regular.ttf');
// Identity-H text uses the font's default CID width. Keep a conservative line
// length so exported notes remain inside the 612pt page after embedding.
const MAX_LINE_CHARS = 76;
const LINES_PER_PAGE = 43;

function u16(buffer, offset) { return buffer.readUInt16BE(offset); }
function s16(buffer, offset) { return buffer.readInt16BE(offset); }
function u32(buffer, offset) { return buffer.readUInt32BE(offset); }

function tableDirectory(font) {
    const tables = new Map();
    const count = u16(font, 4);
    for (let index = 0; index < count; index += 1) {
        const offset = 12 + index * 16;
        tables.set(font.toString('ascii', offset, offset + 4), { offset: u32(font, offset + 8), length: u32(font, offset + 12) });
    }
    return tables;
}

function cmapLookup(font) {
    const tables = tableDirectory(font);
    const cmap = tables.get('cmap');
    const lookup = new Map();
    if (!cmap) return lookup;
    const base = cmap.offset;
    const count = u16(font, base + 2);
    const subtables = [];
    for (let index = 0; index < count; index += 1) {
        const offset = base + 4 + index * 8;
        const subOffset = base + u32(font, offset + 4);
        subtables.push({ format: u16(font, subOffset), offset: subOffset });
    }
    const format12 = subtables.find(item => item.format === 12);
    if (format12) {
        const start = format12.offset;
        const groups = u32(font, start + 12);
        for (let index = 0; index < groups; index += 1) {
            const row = start + 16 + index * 12;
            const first = u32(font, row);
            const last = u32(font, row + 4);
            const glyph = u32(font, row + 8);
            for (let codePoint = first; codePoint <= last && codePoint <= 0xFFFF; codePoint += 1) lookup.set(codePoint, glyph + codePoint - first);
        }
        return lookup;
    }
    const format4 = subtables.find(item => item.format === 4);
    if (!format4) return lookup;
    const start = format4.offset;
    const segments = u16(font, start + 6) / 2;
    const endCodes = start + 14;
    const startCodes = endCodes + segments * 2 + 2;
    const deltas = startCodes + segments * 2;
    const rangeOffsets = deltas + segments * 2;
    for (let segment = 0; segment < segments; segment += 1) {
        const end = u16(font, endCodes + segment * 2);
        const first = u16(font, startCodes + segment * 2);
        const delta = s16(font, deltas + segment * 2);
        const rangeOffset = u16(font, rangeOffsets + segment * 2);
        if (first === 0xFFFF && end === 0xFFFF) continue;
        for (let codePoint = first; codePoint <= end; codePoint += 1) {
            let glyph;
            if (rangeOffset === 0) glyph = (codePoint + delta) & 0xFFFF;
            else {
                const address = rangeOffsets + segment * 2 + rangeOffset + (codePoint - first) * 2;
                glyph = u16(font, address);
                if (glyph) glyph = (glyph + delta) & 0xFFFF;
            }
            lookup.set(codePoint, glyph || 0);
        }
    }
    return lookup;
}

function fontDescriptor(font) {
    const head = tableDirectory(font).get('head');
    if (!head) return { bbox: '[0 -300 1200 1000]' };
    const start = head.offset;
    return { bbox: `[${s16(font, start + 36)} ${s16(font, start + 38)} ${s16(font, start + 40)} ${s16(font, start + 42)}]` };
}

function hexCid(value) { return Number(value).toString(16).padStart(4, '0').toUpperCase(); }

function wrapLines(lines) {
    const output = [];
    for (const raw of lines) {
        const source = String(raw ?? '');
        for (const part of source.split(/\r?\n/)) {
            let remaining = part;
            if (!remaining) { output.push(''); continue; }
            while (remaining.length > MAX_LINE_CHARS) {
                let cut = remaining.lastIndexOf(' ', MAX_LINE_CHARS);
                if (cut < 1) cut = MAX_LINE_CHARS;
                output.push(remaining.slice(0, cut));
                remaining = remaining.slice(cut).trimStart();
            }
            output.push(remaining);
        }
    }
    return output;
}

function stream(dict, data) {
    return Buffer.concat([Buffer.from(`${dict}\nstream\n`, 'ascii'), data, Buffer.from('\nendstream', 'ascii')]);
}

function makeToUnicode(codePoints) {
    const entries = [...codePoints].sort((a, b) => a - b);
    const blocks = [];
    for (let index = 0; index < entries.length; index += 100) {
        const chunk = entries.slice(index, index + 100);
        blocks.push(`${chunk.length} beginbfchar\n${chunk.map(codePoint => `<${hexCid(codePoint)}> <${Buffer.from(String.fromCodePoint(codePoint), 'utf16le').swap16().toString('hex').toUpperCase()}>`).join('\n')}\nendbfchar`);
    }
    return Buffer.from(`/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${blocks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`, 'ascii');
}

function buildPdf(lines, { fontPath = FONT_PATH } = {}) {
    const font = fs.readFileSync(fontPath);
    const lookup = cmapLookup(font);
    const wrapped = wrapLines(lines);
    const pages = [];
    for (let index = 0; index < wrapped.length; index += LINES_PER_PAGE) pages.push(wrapped.slice(index, index + LINES_PER_PAGE));
    if (!pages.length) pages.push(['']);
    const used = new Set();
    for (const line of wrapped) for (const char of Array.from(line)) used.add(char.codePointAt(0) <= 0xFFFF ? char.codePointAt(0) : 0xFFFD);
    const cidToGid = Buffer.alloc(0x10000 * 2);
    for (const codePoint of used) cidToGid.writeUInt16BE(lookup.get(codePoint) || 0, codePoint * 2);
    const descriptor = fontDescriptor(font);
    const pageIds = pages.map((_, index) => 9 + index);
    const contentIds = pages.map((_, index) => 9 + pages.length + index);
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
        '<< /Type /Font /Subtype /Type0 /BaseFont /Roboto /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 6 0 R >>',
        '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Roboto /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 5 0 R /DW 600 /CIDToGIDMap 7 0 R >>',
        `<< /Type /FontDescriptor /FontName /Roboto /Flags 32 /FontBBox ${descriptor.bbox} /ItalicAngle 0 /Ascent 928 /Descent -244 /CapHeight 710 /StemV 80 /FontFile2 8 0 R >>`,
        stream(`<< /Length ${makeToUnicode(used).length} >>`, makeToUnicode(used)),
        stream(`<< /Length ${cidToGid.length} >>`, cidToGid),
        stream(`<< /Length ${font.length} /Length1 ${font.length} >>`, font)
    ];
    for (let index = 0; index < pages.length; index += 1) {
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentIds[index]} 0 R >>`);
    }
    for (const page of pages) {
        const commands = ['BT', '/F1 11 Tf', '50 752 Td'];
        page.forEach((line, index) => {
            if (index) commands.push('0 -16 Td');
            const codes = Array.from(line).map(char => {
                const codePoint = char.codePointAt(0);
                return hexCid(codePoint <= 0xFFFF ? codePoint : 0xFFFD);
            }).join('');
            commands.push(`<${codes}> Tj`);
        });
        commands.push('ET');
        const data = Buffer.from(commands.join('\n'), 'ascii');
        objects.push(stream(`<< /Length ${data.length} >>`, data));
    }
    // Existing offline consumers use this compact comment for provenance. PDF
    // readers ignore it; rendered text comes from the embedded Unicode font.
    const comment = Buffer.from(`% BEL-EXPORT ${lines.map(line => String(line).replace(/[\r\n]+/g, ' ')).join(' | ')}\n`, 'utf8');
    const chunks = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'binary'), comment];
    const offsets = [0];
    let position = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    for (let index = 0; index < objects.length; index += 1) {
        offsets.push(position);
        const prefix = Buffer.from(`${index + 1} 0 obj\n`, 'ascii');
        const suffix = Buffer.from('\nendobj\n', 'ascii');
        const value = Buffer.isBuffer(objects[index]) ? objects[index] : Buffer.from(objects[index], 'ascii');
        chunks.push(prefix, value, suffix);
        position += prefix.length + value.length + suffix.length;
    }
    const xrefOffset = position;
    const xref = [`xref\n0 ${objects.length + 1}`, '0000000000 65535 f '];
    for (let index = 1; index < offsets.length; index += 1) xref.push(`${String(offsets[index]).padStart(10, '0')} 00000 n `);
    xref.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
    chunks.push(Buffer.from(xref.join('\n'), 'ascii'));
    return Buffer.concat(chunks);
}

function checksum(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function createPdfService({ archives, roomService = null, notesService = null } = {}) {
    if (!archives) throw new TypeError('archives is required');
    async function activeExport(identity, roomId) {
        if (!roomService || !notesService) fail('ARCHIVE_NOT_FOUND');
        const current = await roomService.getRoom(roomId);
        if (!current || current.lifecycle === 'ended') fail('ARCHIVE_NOT_FOUND');
        const viewer = assertActiveIdentity(identity);
        const member = Object.values(current.slots).find(slot => slot.uid === viewer.uid);
        if (!member) fail('EXPORT_FORBIDDEN');
        assertRoomActor(viewer, { ...member, seatId: member.slotId });
        const targetUids = member.role === 'presenter' ? Object.values(current.slots).map(slot => slot.uid).filter(Boolean) : [viewer.uid];
        const notebooks = {};
        for (const uid of targetUids) notebooks[uid] = await notesService.readNotebookByUid(roomId, uid);
        return { roomId, checksum: checksum({ roomId, revision: current.revision, notebooks }), notebooks };
    }
    async function exportPdf(identity, roomId) {
        let archive;
        try { archive = await archives.readArchive(identity, roomId); }
        catch (error) { if (error.code !== 'ARCHIVE_NOT_FOUND') throw error; archive = await activeExport(identity, roomId); }
        const lines = ['BEL Working as Equals', `Room ${archive.roomId}`, `Archive ${archive.checksum}`];
        for (const [uid, notebook] of Object.entries(archive.notebooks || {})) {
            lines.push(`Notes for ${uid}`);
            for (const page of notebook.pages || []) lines.push(`${page.title}: ${page.body}`);
        }
        if (lines.length === 3) lines.push('No saved notes.');
        return buildPdf(lines);
    }
    return { exportPdf };
}

module.exports = { buildPdf, createPdfService, cmapLookup, wrapLines };
