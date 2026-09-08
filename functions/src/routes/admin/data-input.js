'use strict';
const { createAdmission } = require('../../crm/data-input/authorization');
const { createConversationService } = require('../../crm/data-input/conversation-service');
const { createContextService } = require('../../crm/data-input/context-service');
const { createCommitService } = require('../../crm/data-input/commit-service');
const { createDataInputAssistance } = require('../../crm/data-input/assistance-service');
const { buildHttpNativeConfig } = require('../../crm/data-input/http-native-config');
const { createInterpretationService } = require('../../crm/data-input/interpretation-service');
const { createAttachmentService } = require('../../crm/data-input/attachment-service');
const { createAttachmentStorage } = require('../../crm/data-input/attachment-storage');
const { readImageUpload, withImageUpload } = require('../../crm/data-input/attachment-http');
const { resolvePublicOrigin } = require('../../crm/public-origin');

function validateBody(body, keys) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.getPrototypeOf(body) !== Object.prototype
        || Object.keys(body).some(key => !keys.includes(key))) throw Object.assign(new Error('Invalid request fields.'), { status: 400, code: 'INVALID_REQUEST' });
    return body;
}

module.exports = function registerDataInputRoutes(router, deps) {
    const { db, dataInputAuth, dataInputProvider = null, requireAdminHandlers, sendSuccess, sendError } = deps;
    const enabled = deps.dataInputEnabled === true;
    const hasStorage = !!deps.dataInputStorage || typeof deps.getStorageBucket === 'function';
    function handler(run, capability = false, binary = false) {
        return async (req, res) => {
            if (!dataInputAuth || typeof dataInputAuth.verifyIdToken !== 'function') return sendError(res, 503, 'DATA_INPUT_UNAVAILABLE', 'Data input authorization is unavailable.');
            const header = req.headers?.authorization;
            if (typeof header !== 'string' || !header.startsWith('Bearer ') || !header.slice(7).trim()) return sendError(res, 401, 'UNAUTHORIZED', 'Authentication required.');
            let identity;
            try { identity = await dataInputAuth.verifyIdToken(header.slice(7).trim(), true); }
            catch { return sendError(res, 401, 'UNAUTHORIZED', 'Authentication failed.'); }
            const authorize = createAdmission({ db, authClient: dataInputAuth, identity });
            const conversations = createConversationService({ db, authorize });
            const currentAdmission = ({ actorUid }) => db.runTransaction(tx => authorize({ tx, actorUid }));
            const context = createContextService({ db, authorize: currentAdmission, authorizeRecord: currentAdmission });
            let assistance;
            try {
                const config = Object.hasOwn(deps, 'dataInputAssistanceConfig') ? deps.dataInputAssistanceConfig
                    : buildHttpNativeConfig({ ...deps.dataInputNativeConfigOptions, enabled });
                assistance = createDataInputAssistance({ db, authorize, config: config || {} });
            }
            catch { return sendError(res, 503, 'ASSISTANCE_UNAVAILABLE', 'CRM assistance configuration is unavailable.'); }
            const provider = dataInputProvider || assistance.provider;
            const commits = createCommitService({ db, authorize, identity, publicOrigin: resolvePublicOrigin(req), voice: assistance.voice });
            const interpretations = createInterpretationService({ db, authorize, provider, context,
                attachments: { read: async input => (await attachments()).read(input) } });
            async function attachments() {
                if (!hasStorage) throw Object.assign(new Error('Image attachments are unavailable.'), { status: 503, code: 'ATTACHMENTS_UNAVAILABLE' });
                const storage = deps.dataInputStorage || createAttachmentStorage({ bucket: await deps.getStorageBucket() });
                return createAttachmentService({ db, authorize, storage });
            }
            try {
                if (!enabled && !capability) {
                    if (await currentAdmission({ actorUid: identity.uid }) !== true) return sendError(res, 403, 'FORBIDDEN', 'CRM data input access is required.');
                    return sendError(res, 503, 'DATA_INPUT_DISABLED', 'CRM data input is not enabled. Use the CRM record forms.');
                }
                const result = await run({ req, actorUid: identity.uid, conversations, context, commits, interpretations, attachments, currentAdmission, assistance, provider });
                if (binary) return res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': String(result.bytes.length) }).status(200).send(result.bytes);
                return sendSuccess(res, result);
            } catch (error) {
                if (error.code === 'VOICE_UNAVAILABLE') return sendError(res, 503, error.code, 'Voice confirmation is not available. Use the reviewed save button.');
                if (error.status === 503 && ['ATTACHMENTS_UNAVAILABLE', 'ATTACHMENT_UNCERTAIN'].includes(error.code)) return sendError(res, 503, error.code, error.code === 'ATTACHMENT_UNCERTAIN' ? 'Upload response was interrupted. Retry the same attachment.' : 'Image attachments are unavailable.');
                if (error.status === 503 && error.code === 'INTERPRETATION_UNAVAILABLE') return sendError(res, 503, 'INTERPRETATION_UNAVAILABLE', 'AI interpretation is not available. You can still edit draft details manually.');
                const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
                const details = status === 422 && error.code === 'DRAFT_INCOMPLETE' ? error.details : null;
                return sendError(res, status, status < 500 ? error.code || 'INVALID_REQUEST' : 'DATA_INPUT_ERROR', status < 500 ? error.message : 'Data input request failed.', details);
            }
        };
    }
    const guards = requireAdminHandlers || [];
    router.get('/data-input/capabilities', ...guards, handler(async ({ actorUid, currentAdmission, assistance, provider }) => {
        if (await currentAdmission({ actorUid }) !== true) throw Object.assign(new Error('CRM data input access is required.'), { status: 403, code: 'FORBIDDEN' });
        const interpretation = enabled && !!provider && typeof provider.generate === 'function';
        return { drafts: enabled, interpretation, attachments: enabled && hasStorage,
            imageInterpretation: interpretation && hasStorage && provider.supportsImages === true,
            budget: enabled, voice: enabled && assistance.voiceEnabled, voiceRelayUrl: enabled ? assistance.voiceRelayUrl : null };
    }, true));
    router.get('/data-input/budget', ...guards, handler(async ({ actorUid, assistance }) => ({ budget: await assistance.getBudget(actorUid) })));
    router.post('/data-input/conversations/:draftId/voice-context', ...guards, handler(({ req, actorUid, assistance }) => {
        const body = validateBody(req.body, ['previewId']);
        return assistance.getVoiceContext(actorUid, { draftId: req.params.draftId, ...(body.previewId === undefined ? {} : { previewId: body.previewId }) });
    }));
    router.post('/data-input/conversations', ...guards, handler(({ req, actorUid, conversations }) => {
        const body = validateBody(req.body, ['requestId']);
        return conversations.create({ actorUid, requestId: body.requestId });
    }));
    router.get('/data-input/conversations/:draftId', ...guards, handler(({ req, actorUid, conversations }) => conversations.load({ actorUid, draftId: req.params.draftId })));
    router.patch('/data-input/conversations/:draftId', ...guards, handler(({ req, actorUid, conversations }) => {
        const body = validateBody(req.body, ['changes', 'messageId', 'text']);
        const changes = validateBody(body.changes, ['expectedRevision', 'upserts', 'removals']);
        if (!Number.isSafeInteger(changes.expectedRevision) || changes.expectedRevision < 0
            || ('upserts' in changes && !Array.isArray(changes.upserts)) || ('removals' in changes && !Array.isArray(changes.removals))) {
            throw Object.assign(new Error('Invalid draft correction.'), { status: 400, code: 'INVALID_REQUEST' });
        }
        return conversations.apply({ actorUid, draftId: req.params.draftId, changes, text: body.text, source: { kind: 'text', messageId: body.messageId } });
    }));
    router.post('/data-input/conversations/:draftId/discard', ...guards, handler(({ req, actorUid, conversations }) => {
        const body = validateBody(req.body, ['expectedRevision']);
        return conversations.discard({ actorUid, draftId: req.params.draftId, expectedRevision: body.expectedRevision });
    }));
    router.post('/data-input/context', ...guards, handler(({ req, actorUid, context }) => {
        const body = validateBody(req.body, ['kind', 'id', 'match']);
        return context.resolve({ ...body, actorUid });
    }));
    router.post('/data-input/conversations/:draftId/preview', ...guards, handler(({ req, actorUid, commits }) => {
        const body = validateBody(req.body, ['expectedRevision', 'requestId']);
        return commits.preview({ actorUid, draftId: req.params.draftId, expectedRevision: body.expectedRevision, requestId: body.requestId });
    }));
    router.post('/data-input/conversations/:draftId/commit', ...guards, handler(({ req, actorUid, commits, assistance }) => {
        const body = validateBody(req.body, ['previewId', 'confirmationToken', 'voiceAttestationId', 'paymentAcknowledgements']);
        if (body.voiceAttestationId !== undefined && !assistance.voiceEnabled) throw Object.assign(new Error('Voice unavailable.'), { status: 503, code: 'VOICE_UNAVAILABLE' });
        return commits.commit({ actorUid, draftId: req.params.draftId, previewId: body.previewId, confirmationToken: body.confirmationToken, voiceAttestationId: body.voiceAttestationId, paymentAcknowledgements: body.paymentAcknowledgements });
    }));
    router.get('/data-input/conversations/:draftId/operation', ...guards, handler(({ req, actorUid, commits }) => commits.status({ actorUid, draftId: req.params.draftId })));
    router.post('/data-input/conversations/:draftId/interpretations', ...guards, handler(({ req, actorUid, interpretations }) => {
        const body = validateBody(req.body, ['messageId', 'expectedRevision', 'text', 'selections', 'attachmentId']);
        return interpretations.start({ actorUid, draftId: req.params.draftId, messageId: body.messageId, expectedRevision: body.expectedRevision, text: body.text, selections: body.selections, attachmentId: body.attachmentId });
    }));
    router.post('/data-input/conversations/:draftId/lookups', ...guards, handler(({ req, actorUid, interpretations }) => {
        const body = validateBody(req.body, ['expectedRevision', 'selections']);
        return interpretations.lookups({ actorUid, draftId: req.params.draftId, expectedRevision: body.expectedRevision, selections: body.selections });
    }));
    router.get('/data-input/conversations/:draftId/interpretations/:messageId', ...guards, handler(({ req, actorUid, interpretations }) => interpretations.get({ actorUid, draftId: req.params.draftId, messageId: req.params.messageId })));
    router.post('/data-input/conversations/:draftId/interpretations/:messageId/apply', ...guards, handler(({ req, actorUid, interpretations }) => {
        validateBody(req.body, []);
        return interpretations.apply({ actorUid, draftId: req.params.draftId, messageId: req.params.messageId });
    }));
    router.post('/data-input/conversations/:draftId/attachments/:attachmentId', ...guards, handler(async ({ req, actorUid, conversations, attachments }) => {
        await conversations.load({ actorUid, draftId: req.params.draftId });
        return withImageUpload(async () => {
            const service = await attachments(), image = await readImageUpload(req);
            return service.upload({ actorUid, draftId: req.params.draftId, attachmentId: req.params.attachmentId, ...image });
        });
    }));
    router.get('/data-input/conversations/:draftId/attachments', ...guards, handler(async ({ req, actorUid, attachments }) => (await attachments()).list({ actorUid, draftId: req.params.draftId })));
    router.get('/data-input/conversations/:draftId/attachments/:attachmentId', ...guards, handler(async ({ req, actorUid, attachments }) => (await attachments()).read({ actorUid, draftId: req.params.draftId, attachmentId: req.params.attachmentId }), false, true));
    router.post('/data-input/conversations/:draftId/attachments/:attachmentId/remove', ...guards, handler(async ({ req, actorUid, attachments }) => {
        validateBody(req.body, []);
        return (await attachments()).remove({ actorUid, draftId: req.params.draftId, attachmentId: req.params.attachmentId });
    }));
};
