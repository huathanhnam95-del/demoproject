'use strict';
const { createHash } = require('node:crypto');
const { IMAGE_LIMITS } = require('./image-validation');
const pathPattern = /^crm-data-input\/[a-f0-9]{64}\/[a-f0-9]{64}\/[a-f0-9]{64}\.png$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function failure(code, message, status = 409) { return Object.assign(new Error(message), { code, status }); }
function fail(...args) { throw failure(...args); }
function createAttachmentStorage({ bucket, now = Date.now, readTimeoutMs = 10000 }) {
    if (!bucket || typeof bucket.file !== 'function' || !Number.isInteger(readTimeoutMs) || readTimeoutMs < 1 || readTimeoutMs > 30000) throw TypeError('Private attachment bucket and bounded timeout are required.');
    function file(path, options) {
        if (typeof path !== 'string' || !pathPattern.test(path)) fail('INVALID_STORAGE_PATH', 'Invalid managed attachment path.', 400);
        return bucket.file(path, options);
    }
    async function metadata(path) {
        try { const [result] = await file(path).getMetadata(); return result; }
        catch (error) { if (Number(error.code) === 404) return null; throw error; }
    }
    function managed(meta) {
        const custom = meta?.metadata;
        if (!meta || meta.contentType !== 'image/png' || custom?.crmDataInput !== 'v1'
            || !/^[a-f0-9]{64}$/.test(custom.sha256 || '') || !/^\d+$/.test(String(meta.generation || ''))
            || !/^\d+$/.test(String(meta.size || '')) || !Number.isSafeInteger(Number(custom.expiresAtMs))) fail('ATTACHMENT_STORAGE_CONFLICT', 'Stored object is not a managed attachment.');
        return { sha256: custom.sha256, expiresAtMs: Number(custom.expiresAtMs), size: Number(meta.size), generation: String(meta.generation) };
    }
    async function read(path, maxBytes) {
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > IMAGE_LIMITS.outputBytes) fail('ATTACHMENT_SIZE', 'Invalid attachment read limit.', 400);
        const meta = await metadata(path);
        if (!meta) fail('ATTACHMENT_UNAVAILABLE', 'Attachment object is unavailable.', 404);
        const details = managed(meta);
        if (now() >= details.expiresAtMs) fail('ATTACHMENT_EXPIRED', 'Attachment expired.', 404);
        if (!Number.isSafeInteger(details.size) || details.size < 1 || details.size > maxBytes) fail('ATTACHMENT_SIZE', 'Stored attachment exceeds the read limit.');
        const stream = file(path, { generation: details.generation }).createReadStream({ validation: 'crc32c' });
        const timer = setTimeout(() => stream.destroy(failure('ATTACHMENT_TIMEOUT', 'Attachment read timed out.', 503)), readTimeoutMs);
        const chunks = []; let size = 0;
        try {
            for await (const chunk of stream) {
                size += chunk.length;
                if (size > maxBytes) { stream.destroy(); fail('ATTACHMENT_SIZE', 'Stored attachment exceeds the read limit.'); }
                chunks.push(Buffer.from(chunk));
            }
        } finally { clearTimeout(timer); }
        const bytes = Buffer.concat(chunks, size);
        if (size !== details.size || hash(bytes) !== details.sha256) fail('ATTACHMENT_INTEGRITY', 'Stored attachment failed its integrity check.');
        if (now() >= details.expiresAtMs) fail('ATTACHMENT_EXPIRED', 'Attachment expired.', 404);
        return bytes;
    }
    return {
        async putIfAbsent(path, bytes, options) {
            const target = file(path);
            if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > IMAGE_LIMITS.outputBytes || options?.sha256 !== hash(bytes)
                || !Number.isSafeInteger(options?.expiresAtMs) || options.expiresAtMs <= now() || options.expiresAtMs > now() + 86400000) fail('INVALID_ATTACHMENT', 'Invalid bounded attachment upload.', 400);
            async function verifyExisting(meta) {
                const existing = managed(meta);
                if (existing.sha256 !== options.sha256 || existing.size !== bytes.length || existing.expiresAtMs !== options.expiresAtMs) fail('ATTACHMENT_STORAGE_CONFLICT', 'Attachment path contains different content.');
                const saved = await read(path, IMAGE_LIMITS.outputBytes);
                if (hash(saved) !== options.sha256) fail('ATTACHMENT_INTEGRITY', 'Stored attachment differs from the upload.');
            }
            const present = await metadata(path);
            if (present) return verifyExisting(present);
            try {
                await target.save(bytes, { resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 },
                    metadata: { contentType: 'image/png', cacheControl: 'private, no-store', metadata: { crmDataInput: 'v1', sha256: options.sha256, expiresAtMs: String(options.expiresAtMs) } } });
            } catch (error) {
                if (Number(error.code) !== 412) throw error;
                // Metadata alone is insufficient proof of a successful earlier
                // upload: verify the bounded bytes of the pinned generation too.
                await verifyExisting(await metadata(path));
            }
        },
        read,
        // Infrastructure-only maintenance. Listing objects (rather than draft
        // manifests) also catches writes whose database acknowledgement failed.
        // The caller must persist the opaque continuation token between runs.
        async sweepExpired({ pageToken, limit = 100 } = {}) {
            if (!Number.isInteger(limit) || limit < 1 || limit > 100
                || (pageToken !== undefined && (typeof pageToken !== 'string' || !pageToken.length || pageToken.length > 8192))) fail('INVALID_SWEEP', 'Invalid bounded attachment sweep.', 400);
            const [files, nextQuery] = await bucket.getFiles({ prefix: 'crm-data-input/', autoPaginate: false, maxResults: limit, ...(pageToken === undefined ? {} : { pageToken }) });
            if (!Array.isArray(files) || files.length > limit) fail('INVALID_SWEEP', 'Storage listing exceeded the bounded sweep.', 503);
            const nextPageToken = nextQuery?.pageToken ?? null;
            if (nextPageToken !== null && (typeof nextPageToken !== 'string' || !nextPageToken.length || nextPageToken.length > 8192)) fail('INVALID_SWEEP', 'Invalid storage continuation.', 503);
            const result = { scanned: files.length, deleted: 0, retained: 0, skipped: 0, conflicted: 0, nextPageToken };
            for (const entry of files) {
                if (typeof entry?.name !== 'string' || !pathPattern.test(entry.name)) { result.skipped++; continue; }
                // Refresh listing metadata before applying the expiry decision.
                const meta = await metadata(entry.name);
                if (!meta) { result.skipped++; continue; }
                let details;
                try { details = managed(meta); }
                catch (error) { if (error.code !== 'ATTACHMENT_STORAGE_CONFLICT') throw error; result.skipped++; continue; }
                if (details.expiresAtMs > now()) { result.retained++; continue; }
                try {
                    await file(entry.name).delete({ ifGenerationMatch: details.generation, ignoreNotFound: true });
                    result.deleted++;
                } catch (error) {
                    if (Number(error.code) === 412) result.conflicted++;
                    else if (Number(error.code) === 404) result.skipped++;
                    else throw error; // Do not advance the caller's cursor on partial failure.
                }
            }
            return result;
        },
        async delete(path) {
            const meta = await metadata(path); if (!meta) return;
            const details = managed(meta);
            try { await file(path).delete({ ifGenerationMatch: details.generation, ignoreNotFound: true }); }
            catch (error) { if (Number(error.code) === 412) fail('ATTACHMENT_STORAGE_CONFLICT', 'Attachment changed before deletion.'); if (Number(error.code) !== 404) throw error; }
        }
    };
}
module.exports = { createAttachmentStorage };
