'use strict';
const { createAdmission } = require('../../crm/data-input/authorization');
const { createPaymentFollowupService } = require('../../crm/payment-followup-service');
const { createPaymentEvidenceStorage } = require('../../crm/payment-evidence-storage');
const { normalizeImage, IMAGE_LIMITS } = require('../../crm/data-input/image-validation');
const { withImageUpload } = require('../../crm/data-input/attachment-http');
const error = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
async function readImage(req) {
    const mimeType = req.headers?.['content-type'];
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw error('IMAGE_TYPE', 'Choose a PNG, JPEG or WebP image.', 415);
    const declared = req.headers?.['content-length'];
    if (declared !== undefined && (!/^\d+$/.test(String(declared)) || Number(declared) > IMAGE_LIMITS.inputBytes)) throw error('IMAGE_SIZE', 'Image is too large.', 413);
    let bytes = req.rawBody || (Buffer.isBuffer(req.body) ? req.body : null);
    if (!bytes && (typeof req.on !== 'function' || req.readableEnded || req.destroyed)) throw error('IMAGE_INTERRUPTED', 'Image upload was interrupted.');
    if (!bytes) bytes = await new Promise((resolve, reject) => {
        const chunks = []; let length = 0, settled = false;
        const timer = setTimeout(() => finish(error('IMAGE_TIMEOUT', 'Image upload timed out.', 408)), 15000);
        function finish(failure) {
            if (settled) return; settled = true; clearTimeout(timer);
            req.removeListener('data', data); req.removeListener('end', end); req.removeListener('error', aborted); req.removeListener('aborted', aborted); req.removeListener('close', aborted);
            if (failure) { req.resume?.(); reject(failure); } else resolve(Buffer.concat(chunks, length));
        }
        function data(chunk) { length += chunk.length; if (length > IMAGE_LIMITS.inputBytes) finish(error('IMAGE_SIZE', 'Image is too large.', 413)); else chunks.push(Buffer.from(chunk)); }
        function end() { finish(); }
        function aborted() { finish(error('IMAGE_INTERRUPTED', 'Image upload was interrupted.')); }
        req.on('data', data); req.on('end', end); req.on('error', aborted); req.on('aborted', aborted); req.on('close', aborted);
    });
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > IMAGE_LIMITS.inputBytes || declared !== undefined && bytes.length !== Number(declared)) throw error('IMAGE_SIZE', 'Image upload is empty, incomplete or too large.');
    return { bytes, mimeType };
}
module.exports = function registerPaymentEvidenceRoutes(router, deps) {
    const { db, paymentEvidenceAuth: auth, requireAdminHandlers = [], sendSuccess, sendError } = deps;
    function handler(action) {
        return async (req, res) => {
            try {
                if (!auth?.verifyIdToken) throw error('AUTH_UNAVAILABLE', 'Staff authentication is unavailable.', 503);
                const token = req.headers?.authorization;
                if (typeof token !== 'string' || !token.startsWith('Bearer ')) throw error('UNAUTHORIZED', 'Authentication required.', 401);
                let identity;
                try { identity = await auth.verifyIdToken(token.slice(7), true); } catch { throw error('UNAUTHORIZED', 'Authentication failed.', 401); }
                const authorize = createAdmission({ db, authClient: auth, identity });
                if (await db.runTransaction(tx => authorize({ tx, actorUid: identity.uid })) !== true) throw error('FORBIDDEN', 'Current CRM staff access required.', 403);
                const storage = action === 'status' ? null : deps.paymentEvidenceStorage || (deps.getStorageBucket ? createPaymentEvidenceStorage({ bucket: await deps.getStorageBucket() }) : null);
                const service = createPaymentFollowupService({ db, authorize, storage, normalizeImage });
                if (action === 'status') return sendSuccess(res, await service.get(identity.uid, req.params.studentId));
                if (action === 'put') return sendSuccess(res, await withImageUpload(async () => service.putEvidence(identity.uid, req.params.paymentId, await readImage(req))));
                const bytes = await service.readEvidence(identity.uid, req.params.paymentId);
                return res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).status(200).send(bytes);
            } catch (failure) {
                const status = failure.status >= 400 && failure.status < 600 ? failure.status : 500;
                return sendError(res, status, status < 500 ? failure.code : 'PAYMENT_EVIDENCE_UNAVAILABLE', status < 500 ? failure.message : 'Payment evidence is unavailable.');
            }
        };
    }
    router.get('/students/:studentId/payment-followup', ...requireAdminHandlers, handler('status'));
    router.put('/payments/:paymentId/evidence', ...requireAdminHandlers, handler('put'));
    router.get('/payments/:paymentId/evidence', ...requireAdminHandlers, handler('read'));
};
module.exports.readImage = readImage;
