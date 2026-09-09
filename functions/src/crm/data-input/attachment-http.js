'use strict';
const { IMAGE_LIMITS } = require('./image-validation');
let activeUploads = 0;
const failure = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
async function withImageUpload(run) {
    if (activeUploads >= 2) throw failure('IMAGE_BUSY', 'Image uploads are busy. Try again shortly.', 429);
    activeUploads++;
    try { return await run(); } finally { activeUploads--; }
}
/** Call only after current staff admission and draft ownership have passed. */
async function readImageUpload(req, { timeoutMs = 15000 } = {}) {
    const mimeType = req.headers?.['content-type'], revision = req.headers?.['x-crm-draft-revision'];
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw failure('IMAGE_TYPE', 'Upload PNG, JPEG or WebP bytes.', 415);
    if (typeof revision !== 'string' || !/^\d{1,16}$/.test(revision) || !Number.isSafeInteger(Number(revision))) throw failure('INVALID_REQUEST', 'Provide the current draft revision.');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw TypeError('Bounded upload timeout required.');
    const declared = req.headers?.['content-length'];
    if (declared !== undefined && (typeof declared !== 'string' || !/^\d+$/.test(declared) || Number(declared) > IMAGE_LIMITS.inputBytes)) throw failure('IMAGE_SIZE', 'Choose an image of at most 4 MiB.', 413);
    let bytes;
    if (req.rawBody !== undefined) {
        if (!Buffer.isBuffer(req.rawBody) || req.rawBody.length > IMAGE_LIMITS.inputBytes) throw failure('IMAGE_SIZE', 'Choose an image of at most 4 MiB.', 413);
        bytes = req.rawBody;
    } else {
        if (typeof req.on !== 'function' || req.readableEnded || req.destroyed) throw failure('IMAGE_UPLOAD_INTERRUPTED', 'Image upload was interrupted.');
        bytes = await new Promise((resolve, reject) => {
            const chunks = []; let size = 0, settled = false;
            function finish(error) {
                if (settled) return; settled = true; clearTimeout(timer);
                req.removeListener('data', data); req.removeListener('end', end); req.removeListener('error', aborted); req.removeListener('aborted', aborted); req.removeListener('close', aborted);
                if (error) { if (!req.destroyed) { req.once('error', () => {}); req.resume?.(); } reject(error); } else resolve(Buffer.concat(chunks, size));
            }
            const data = chunk => { size += chunk.length; if (size > IMAGE_LIMITS.inputBytes) finish(failure('IMAGE_SIZE', 'Choose an image of at most 4 MiB.', 413)); else chunks.push(Buffer.from(chunk)); };
            const end = () => finish();
            const aborted = () => finish(failure('IMAGE_UPLOAD_INTERRUPTED', 'Image upload was interrupted.'));
            const timer = setTimeout(() => finish(failure('IMAGE_UPLOAD_TIMEOUT', 'Image upload timed out.', 408)), timeoutMs);
            req.on('end', end); req.on('error', aborted); req.on('aborted', aborted); req.on('close', aborted); req.on('data', data);
        });
    }
    if (!bytes.length) throw failure('IMAGE_SIZE', 'Choose a nonempty image.');
    if (declared !== undefined && Number(declared) !== bytes.length) throw failure('IMAGE_UPLOAD_INTERRUPTED', 'Image upload length did not match.');
    return { bytes, mimeType, expectedRevision: Number(revision) };
}
module.exports = { readImageUpload, withImageUpload };
