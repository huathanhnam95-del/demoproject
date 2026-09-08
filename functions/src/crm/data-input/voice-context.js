'use strict';
const C = require('../collections');
const { digestDraft } = require('./draft-service');
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const targets = Object.freeze({ leadId: C.CRM_LEADS, studentId: C.CRM_STUDENTS, courseId: C.CRM_COURSES,
    classId: C.CRM_CLASSROOMS, enrollmentId: C.CRM_ENROLLMENTS, invoiceId: C.CRM_INVOICES,
    paymentId: C.CRM_PAYMENTS, teacherUid: C.USERS, agentSourceId: C.CRM_AGENT_SOURCES, testId: C.ENTRANCE_TESTS });
const privateFields = new Set(['confirmationToken', 'tokenHash', 'testTokens', 'deliveryToken', 'studentLink', 'testLink', 'resultLink']);
function fail(code, message) { throw Object.assign(new Error(message), { code, status: 403 }); }
function safe(value) {
    if (Array.isArray(value)) return value.map(safe);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !privateFields.has(key)).map(([key, item]) => [key, safe(item)]));
    return value;
}
function phrase(revision, payments) {
    return `Tôi xác nhận lưu bản xem trước số ${revision}${payments ? ' và đã nhận các khoản thanh toán được liệt kê' : ''}`;
}
function phraseEnglish(revision, payments) {
    return `I confirm saving preview number ${revision}${payments ? ' and I have received the listed payments' : ''}`;
}
function cardinalForms(revision) {
    // Exact English renderings of the bound number, never a general text/intent
    // rewrite. Revisions outside 0..999 retain the existing digit-only policy.
    if (!Number.isInteger(revision) || revision < 0 || revision > 999) return [];
    const small = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
    const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
    function underHundred(number) {
        if (number < 20) return [small[number]];
        const prefix = tens[Math.floor(number / 10)], unit = number % 10;
        return unit ? [`${prefix} ${small[unit]}`, `${prefix}-${small[unit]}`] : [prefix];
    }
    if (revision < 100) return underHundred(revision);
    const prefix = `${small[Math.floor(revision / 100)]} hundred`, remainder = revision % 100;
    return remainder ? underHundred(remainder).flatMap(suffix => [`${prefix} ${suffix}`, `${prefix} and ${suffix}`]) : [prefix];
}
function normalized(text) { return typeof text === 'string' ? text.normalize('NFC').trim().replace(/\.$/, '').replace(/\s+/g, ' ').toLocaleLowerCase('vi') : ''; }

/** Shared voice calls authorize before resolveContext. Target checks also run on
 * committed receipts; a consumed attestation never substitutes for these checks. */
function createVoiceContextAdapter({ db, authorize, authorizeRecord, now = Date.now }) {
    if (!db || typeof authorize !== 'function' || typeof authorizeRecord !== 'function') throw TypeError('Voice context requires explicit domain and target authorization.');
    async function authorizeTargets({ tx, actorUid, draft, receipt }) {
        const references = new Map();
        function visit(value) {
            if (!value || typeof value !== 'object') return;
            for (const [field, item] of Object.entries(value)) {
                if (targets[field] && typeof item === 'string' && ID.test(item)) references.set(`${targets[field]}/${item}`, { field, collection: targets[field], id: item });
                else if (item && typeof item === 'object') visit(item);
            }
        }
        for (const action of draft.actions) visit(action.values);
        if (receipt) visit(receipt.results);
        if (references.size > 500) fail('VOICE_CONTEXT_LIMIT', 'Too many CRM records for voice context.');
        for (const target of references.values()) {
            const snapshot = await tx.get(db.collection(target.collection).doc(target.id)), data = snapshot.exists ? snapshot.data() : null;
            if (!data || data.deletedAt || await authorizeRecord({ tx, actorUid, ...target, data }) !== true) fail('VOICE_TARGET_FORBIDDEN', 'A current CRM target is unavailable or not authorized.');
        }
    }
    return Object.freeze({
        authorize,
        authorizeTargets,
        async resolveContext({ tx, actorUid, contextHints = {} }) {
            if (!contextHints || typeof contextHints !== 'object' || Array.isArray(contextHints) || Object.keys(contextHints).some(key => !['draftId', 'previewId'].includes(key))) fail('VOICE_CONTEXT_INVALID', 'Select a CRM draft and its displayed review.');
            if (!contextHints.draftId) return { summary: 'Ready for CRM instructions. No draft is selected.', previewBinding: null, context: { status: 'idle' } };
            if (!ID.test(contextHints.draftId) || contextHints.previewId !== undefined && !ID.test(contextHints.previewId)) fail('VOICE_CONTEXT_INVALID', 'Invalid draft or preview identity.');
            const ref = db.collection(C.CRM_DATA_INPUT_DRAFTS).doc(contextHints.draftId), snapshot = await tx.get(ref), draft = snapshot.exists ? snapshot.data() : null;
            if (!draft || draft.actorUid !== actorUid) fail('VOICE_DRAFT_FORBIDDEN', 'The current staff account does not own this draft.');
            if (draft.status !== 'committed' && now() >= draft.expiresAtMs) fail('VOICE_DRAFT_EXPIRED', 'The selected draft expired.');
            let receipt = null;
            if (draft.status === 'committed') {
                const saved = await tx.get(ref.collection('operations').doc(draft.receiptId)); receipt = saved.exists ? saved.data() : null;
                if (!receipt || receipt.actorUid !== actorUid) fail('VOICE_RECEIPT_UNAVAILABLE', 'Saved receipt is unavailable.');
            }
            await authorizeTargets({ tx, actorUid, draft, receipt });
            const context = { draftId: contextHints.draftId, revision: draft.revision, status: draft.status, trust: 'untrusted-record-data',
                actions: draft.actions.map(action => ({ actionId: action.actionId, kind: action.kind, values: safe(action.values) })) };
            let previewBinding = null;
            if (draft.status === 'review' && contextHints.previewId && draft.preview?.previewId === contextHints.previewId) {
                const shown = await tx.get(ref.collection('previews').doc(contextHints.previewId)), preview = shown.exists ? shown.data() : null;
                if (preview && preview.revision === draft.revision && preview.draftDigest === digestDraft(draft) && now() < preview.expiresAtMs) {
                    previewBinding = { feature: 'crm-data-input', actorUid, draftId: contextHints.draftId, previewId: contextHints.previewId, revision: draft.revision, draftDigest: preview.draftDigest, expiresAtMs: preview.expiresAtMs };
                    context.previewId = contextHints.previewId; context.review = safe(preview.review);
                    const paymentActionIds = (preview.review.paymentAssertions || []).map(item => item.actionId).sort();
                    context.confirmationPolicy = { paymentActionIds, phrase: phrase(draft.revision, paymentActionIds.length > 0), phraseEnglish: phraseEnglish(draft.revision, paymentActionIds.length > 0) };
                }
            }
            if (receipt) context.receipt = { operationId: receipt.operationId, revision: receipt.revision };
            if (Buffer.byteLength(JSON.stringify(context)) > 32768) return { summary: 'This CRM draft is too large for voice confirmation. Review the full details and use the save button.', previewBinding: null, context: { draftId: context.draftId, revision: context.revision, status: context.status, voiceConfirmationUnavailable: 'context-size' } };
            const summary = receipt ? `Saved ${draft.actions.length} CRM steps. Result links are available in the CRM.`
                : previewBinding ? `Review revision ${draft.revision} contains ${draft.actions.length} CRM steps. To confirm this exact review, say: ${context.confirmationPolicy.phrase}. Or in English: ${context.confirmationPolicy.phraseEnglish}.`
                    : `${draft.actions.length} CRM draft steps are available. Open the current review before confirming a save.`;
            return { summary, previewBinding, context };
        },
        confirm({ text, binding, context }) {
            if (!binding || binding.feature !== 'crm-data-input' || !context?.confirmationPolicy || context.draftId !== binding.draftId
                || context.revision !== binding.revision || context.previewId !== binding.previewId || !Array.isArray(context.confirmationPolicy.paymentActionIds)) return false;
            const payments = context.confirmationPolicy.paymentActionIds.length > 0;
            return [phrase(binding.revision, payments), phraseEnglish(binding.revision, payments),
                ...cardinalForms(binding.revision).map(number => phraseEnglish(number, payments))]
                .some(expected => normalized(text) === normalized(expected));
        }
    });
}
module.exports = { createVoiceContextAdapter };
