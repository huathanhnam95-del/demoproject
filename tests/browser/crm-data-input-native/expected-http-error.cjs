'use strict';
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
function createExpectedHttpErrorGate(scenario) {
    const payment = scenario === 'image-payment', date = scenario === 'image-ambiguous-date';
    let armed = null, used = false; const accepted = [];
    return {
        arm(input) {
            if ((!payment && !date) || armed || used || !input || Object.keys(input).some(key => !['draftId', 'previewId', 'revision'].includes(key))
                || !validId(input.draftId) || !Number.isSafeInteger(input.revision) || input.revision < 0 || payment && !validId(input.previewId)
                || date && input.previewId !== undefined) throw Error('Invalid expected-error arm.');
            armed = { ...input }; return { armed: true };
        },
        observe({ method, path, status, body, response }) {
            if (!armed || used || status !== 422 || method !== 'POST' || response?.success !== false || !body || typeof body !== 'object') return false;
            const code = payment ? 'PAYMENT_ASSERTION_REQUIRED' : 'DRAFT_INCOMPLETE';
            const expectedPath = `/api/admin/data-input/conversations/${armed.draftId}/${payment ? 'commit' : 'preview'}`;
            if (path !== expectedPath || response.error !== code) return false;
            const keys = payment ? ['previewId', 'confirmationToken', 'paymentAcknowledgements'] : ['expectedRevision', 'requestId'];
            if (Object.keys(body).length !== keys.length || Object.keys(body).some(key => !keys.includes(key))) return false;
            if (payment ? body.previewId !== armed.previewId || typeof body.confirmationToken !== 'string' || !body.confirmationToken
                || !Array.isArray(body.paymentAcknowledgements) || body.paymentAcknowledgements.length !== 0
                : body.expectedRevision !== armed.revision || !validId(body.requestId)) return false;
            accepted.push({ scenario, path, code, status }); used = true; armed = null; return true;
        },
        evidence() { return accepted.map(item => ({ ...item })); }
    };
}
module.exports = { createExpectedHttpErrorGate };
