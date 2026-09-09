'use strict';
const { createHash } = require('node:crypto');
const { IMAGE_LIMITS } = require('./data-input/image-validation');
const MAX_BYTES = IMAGE_LIMITS.outputBytes;
const pattern = /^crmPaymentEvidence\/[A-Za-z0-9_-]{1,128}\/([a-f0-9]{64})\.png$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const failure = (code, message, status = 409) => Object.assign(new Error(message), { code, message, status });
function createPaymentEvidenceStorage({ bucket, timeoutMs = 10000 }) {
    if (!bucket?.file || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw TypeError('Private evidence bucket and bounded timeout required.');
    function file(path, options) {
        if (!pattern.test(path)) throw failure('INVALID_EVIDENCE_PATH', 'Invalid payment evidence path.', 400);
        return bucket.file(path, options);
    }
    async function read(path) {
        const [meta] = await file(path).getMetadata();
        const size = Number(meta.size), digest = pattern.exec(path)[1];
        if (meta.contentType !== 'image/png' || meta.metadata?.crmPaymentEvidence !== 'v1' || meta.metadata.sha256 !== digest
            || !Number.isSafeInteger(size) || size < 1 || size > MAX_BYTES || !/^\d+$/.test(String(meta.generation))) throw failure('EVIDENCE_INTEGRITY', 'Stored receipt evidence requires review.');
        const stream = file(path, { generation: meta.generation }).createReadStream({ validation: 'crc32c' });
        const timer = setTimeout(() => stream.destroy(failure('EVIDENCE_TIMEOUT', 'Receipt read timed out.', 503)), timeoutMs);
        const chunks = []; let length = 0;
        try {
            for await (const chunk of stream) {
                length += chunk.length;
                if (length > MAX_BYTES) { stream.destroy(); throw failure('EVIDENCE_INTEGRITY', 'Receipt exceeds its size limit.'); }
                chunks.push(Buffer.from(chunk));
            }
        } finally { clearTimeout(timer); }
        const bytes = Buffer.concat(chunks, length);
        if (length !== size || hash(bytes) !== digest) throw failure('EVIDENCE_INTEGRITY', 'Receipt bytes failed verification.');
        return bytes;
    }
    return Object.freeze({ read, async put(path, bytes) {
        const target = file(path);
        if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES || hash(bytes) !== pattern.exec(path)[1]) throw failure('INVALID_EVIDENCE', 'Invalid normalized image.', 400);
        try { await target.getMetadata(); await read(path); return; }
        catch (error) { if (Number(error.code) !== 404) throw error; }
        try {
            await target.save(bytes, { resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 },
                metadata: { contentType: 'image/png', cacheControl: 'private, no-store', metadata: { crmPaymentEvidence: 'v1', sha256: hash(bytes) } } });
        } catch (error) { if (Number(error.code) !== 412) throw error; }
        await read(path);
    } });
}
module.exports = { createPaymentEvidenceStorage };
