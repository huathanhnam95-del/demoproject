(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.CrmDataInputClient = api;
})(typeof window === 'object' ? window : globalThis, function () {
    'use strict';
    const copy = value => JSON.parse(JSON.stringify(value));
    function createClient({ request, getUid, storage, createId = () => crypto.randomUUID(), onChange = () => {} }) {
        const base = '/api/admin/data-input';
        let epoch = 0, pointer = {}, pendingEdit = null, pendingCommit = null, pendingFile = null;
        let state = empty(null);
        function empty(uid) { return { uid, draft: null, messages: [], preview: null, voiceContext: null, receipt: null, interpretation: null, capabilities: null, lookups: null, attachments: [], pendingAttachment: null, busy: false, pendingSave: false, error: null }; }
        const key = uid => `crm-data-input:${uid}`;
        function notify() { onChange(copy(state)); }
        function identity() {
            const uid = getUid() || null;
            if (uid !== state.uid) {
                epoch++; state = empty(uid); pendingEdit = null; pendingCommit = null; pendingFile = null; pointer = {};
                try {
                    const saved = JSON.parse(storage?.getItem(key(uid)) || '{}');
                    if (typeof saved.draftId === 'string') pointer.draftId = saved.draftId;
                    if (typeof saved.requestId === 'string') pointer.requestId = saved.requestId;
                    if (typeof saved.interpretationMessageId === 'string') { pointer.interpretationMessageId = saved.interpretationMessageId; state.interpretation = { messageId: saved.interpretationMessageId, status: 'unknown' }; }
                    if (typeof saved.pendingAttachmentId === 'string') { pointer.pendingAttachmentId = saved.pendingAttachmentId; state.pendingAttachment = { attachmentId: saved.pendingAttachmentId, status: 'unknown' }; }
                } catch { pointer = {}; }
                notify();
            }
            return uid;
        }
        function remember() {
            try { storage?.setItem(key(state.uid), JSON.stringify(pointer)); } catch { /* Server persistence remains authoritative. */ }
        }
        function guard(owner, generation) {
            identity();
            if (state.uid !== owner || epoch !== generation) throw new Error('The signed-in account changed.');
        }
        async function run(operation) {
            const owner = identity(), generation = epoch;
            if (!owner) throw new Error('Sign in to use CRM data input.');
            if (state.busy) throw new Error('Another request is in progress.');
            state.busy = true; state.error = null; notify();
            async function api(suffix, method = 'GET', body, extra = {}) {
                const result = await request(`${base}${suffix}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), ...extra });
                guard(owner, generation);
                return extra.responseType === 'blob' ? result : copy(result);
            }
            async function ensureDraft() {
                if (state.draft) return state.draft;
                pointer.requestId ||= createId(); remember();
                const draft = await api('/conversations', 'POST', { requestId: pointer.requestId });
                state.draft = draft; pointer.draftId = draft.draftId; remember();
                return draft;
            }
            try { return await operation(api, ensureDraft, () => epoch === generation && state.uid === owner && (getUid() || null) === owner); }
            catch (error) {
                identity();
                if (state.uid === owner && epoch === generation) state.error = error.message || 'Request failed.';
                throw error;
            } finally {
                identity();
                if (state.uid === owner && epoch === generation) { state.busy = false; notify(); }
            }
        }
        const path = () => `/conversations/${encodeURIComponent(state.draft.draftId)}`;
        function clearInterpretationPointer() { delete pointer.interpretationMessageId; remember(); }
        function clearAttachmentPointer() { delete pointer.pendingAttachmentId; state.pendingAttachment = null; pendingFile = null; remember(); }
        function settledAttachments() { if (pointer.pendingAttachmentId) throw new Error('Check the image upload status before continuing.'); }
        async function loadAttachments(api) {
            if (!state.draft) return;
            const loaded = await api(path()); state.draft = loaded.draft; state.messages = loaded.messages; state.preview = null; state.voiceContext = null; state.lookups = null;
            const result = await api(`${path()}/attachments`); state.attachments = result.attachments;
            const pending = result.attachments.find(item => item.attachmentId === pointer.pendingAttachmentId);
            if (pending && ['ready', 'deleted', 'expired'].includes(pending.status)) clearAttachmentPointer();
            return { result: copy(result), expired: loaded.expired === true };
        }
        async function requestReview(api) {
            state.preview = null; state.voiceContext = null;
            state.preview = await api(`${path()}/preview`, 'POST', { expectedRevision: state.draft.revision, requestId: createId() });
            state.draft.status = 'review';
            if (state.capabilities?.voice) state.voiceContext = await api(`${path()}/voice-context`, 'POST', { previewId: state.preview.previewId });
            return copy(state.preview);
        }
        async function restoreReview(api, prior, expired) {
            // Recover only an unchanged review; the server rechecks current authority,
            // expiry and targets and replaces the old confirmation binding.
            if (expired || !prior || prior.status !== 'review' || state.draft?.status !== 'review'
                || prior.draftId !== state.draft.draftId || prior.revision !== state.draft.revision
                || JSON.stringify(prior.actions) !== JSON.stringify(state.draft.actions)
                || Date.now() >= state.draft.expiresAtMs || state.pendingSave || pendingCommit || pendingEdit
                || pointer.interpretationMessageId || pointer.pendingAttachmentId) return;
            await requestReview(api);
        }
        function settledInterpretation() { if (pointer.interpretationMessageId) throw new Error('Check the interpretation status before continuing.'); }
        async function receiveInterpretation(api, result, isCurrent) {
            state.interpretation = result;
            const terminal = ['committed', 'cancelled'].includes(state.draft?.status);
            if (result.status === 'done' && terminal) state.interpretation = { ...result, status: 'stale' };
            else if (['done', 'applied'].includes(result.status)) {
                try {
                    const applied = await api(`${path()}/interpretations/${encodeURIComponent(result.messageId)}/apply`, 'POST', {});
                    state.draft = applied.draft; state.preview = null; state.lookups = null;
                    state.interpretation = { messageId: applied.messageId, text: applied.text, status: applied.status, appliedRevision: applied.appliedRevision };
                    if (!state.messages.some(message => message.messageId === applied.messageId)) state.messages.push({ messageId: applied.messageId, text: applied.text, source: { kind: 'text' }, revision: applied.appliedRevision });
                } catch (error) {
                    if (isCurrent() && error.status >= 400 && error.status < 500) { state.interpretation = { ...result, status: 'stale' }; clearInterpretationPointer(); }
                    throw error;
                }
            }
            if (!['running', 'unknown'].includes(state.interpretation.status)) clearInterpretationPointer();
            return copy(state.interpretation);
        }
        function editable() {
            if (state.pendingSave) throw new Error('Check the save status before changing this draft.');
            if (state.draft && ['committed', 'cancelled'].includes(state.draft.status)) throw new Error('Start a new conversation to make more changes.');
        }
        function voiceHints() {
            if (!state.draft) return {};
            const binding = state.voiceContext?.previewBinding;
            const matched = state.preview && state.draft.status === 'review' && binding?.actorUid === state.uid
                && binding.draftId === state.draft.draftId && binding.previewId === state.preview.previewId && binding.revision === state.draft.revision;
            return { draftId: state.draft.draftId, ...(matched ? { previewId: binding.previewId } : {}) };
        }
        return {
            getState() { identity(); return copy(state); },
            getVoiceHints() { identity(); return voiceHints(); },
            refreshIdentity: identity,
            capabilities() { return run(async api => { const value = await api('/capabilities'); state.capabilities = { interpretation: value.interpretation === true, attachments: value.attachments === true, imageInterpretation: value.imageInterpretation === true, budget: value.budget === true, voice: value.voice === true, voiceRelayUrl: typeof value.voiceRelayUrl === 'string' ? value.voiceRelayUrl : null }; return copy(state.capabilities); }); },
            uploadAttachment(file) { return run(async (api, ensureDraft, isCurrent) => {
                editable(); settledInterpretation(); file ||= pendingFile;
                if (!file || typeof file.arrayBuffer !== 'function' || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size < 1 || file.size > 4194304) throw new Error('Choose a PNG, JPEG or WebP image of at most 4 MiB.');
                await ensureDraft(); pointer.pendingAttachmentId ||= createId(); pendingFile = file; remember();
                const attachmentId = pointer.pendingAttachmentId; state.pendingAttachment = { attachmentId, status: 'uploading' }; state.preview = null; notify();
                try {
                    const result = await api(`${path()}/attachments/${encodeURIComponent(attachmentId)}`, 'POST', undefined, { body: file, headers: { 'content-type': file.type, 'x-crm-draft-revision': String(state.draft.revision) } });
                    state.draft = result.draft; state.lookups = null;
                    state.attachments = [...state.attachments.filter(item => item.attachmentId !== attachmentId), result.attachment];
                    clearAttachmentPointer(); return copy(result.attachment);
                } catch (error) {
                    if (isCurrent()) {
                        if (['IMAGE_TYPE', 'INVALID_IMAGE', 'IMAGE_SIZE', 'IMAGE_FRAMES', 'ATTACHMENT_LIMIT'].includes(error.payload?.error)) clearAttachmentPointer();
                        else state.pendingAttachment = { attachmentId, status: 'unknown' };
                    }
                    throw error;
                }
            }); },
            refreshAttachments() { return run(async api => {
                const prior = state.draft && copy(state.draft);
                const loaded = await loadAttachments(api);
                if (loaded) await restoreReview(api, prior, loaded.expired);
                return loaded?.result;
            }); },
            readAttachment(attachmentId) { return run(api => api(`${path()}/attachments/${encodeURIComponent(attachmentId)}`, 'GET', undefined, { responseType: 'blob' })); },
            removeAttachment(attachmentId) { return run(async api => {
                const result = await api(`${path()}/attachments/${encodeURIComponent(attachmentId)}/remove`, 'POST', {});
                if (pointer.pendingAttachmentId === attachmentId) clearAttachmentPointer();
                await loadAttachments(api); return result;
            }); },
            lookups(selections = []) { return run(async (api, ensureDraft) => {
                editable(); settledInterpretation(); await ensureDraft();
                state.lookups = await api(`${path()}/lookups`, 'POST', { expectedRevision: state.draft.revision, selections });
                return copy(state.lookups);
            }); },
            interpret(text, selections = [], attachmentId) { return run(async (api, ensureDraft, isCurrent) => {
                editable(); settledInterpretation(); settledAttachments();
                if (typeof text !== 'string' || !text.trim() || text.length > 16000) throw new Error('Enter an instruction of at most 16000 characters.');
                if (attachmentId !== undefined) {
                    if (!state.capabilities?.imageInterpretation) throw new Error('Image interpretation is unavailable.');
                    if (typeof attachmentId !== 'string' || !state.attachments.some(item => item.attachmentId === attachmentId && item.status === 'ready')) throw new Error('Choose a ready image from this conversation.');
                }
                await ensureDraft();
                const messageId = createId(); pointer.interpretationMessageId = messageId; remember();
                state.preview = null; state.interpretation = { messageId, text, status: 'running' }; notify();
                try {
                    const result = await api(`${path()}/interpretations`, 'POST', { messageId, text, expectedRevision: state.draft.revision, selections, ...(attachmentId !== undefined ? { attachmentId } : {}) });
                    return await receiveInterpretation(api, result, isCurrent);
                } catch (error) {
                    if (isCurrent() && pointer.interpretationMessageId) {
                        if ((error.status >= 400 && error.status < 500) || (error.status === 503 && error.payload?.error === 'INTERPRETATION_UNAVAILABLE')) { state.interpretation = { messageId, text, status: 'rejected' }; clearInterpretationPointer(); }
                        else state.interpretation = { messageId, text, status: 'unknown' };
                    }
                    throw error;
                }
            }); },
            recoverInterpretation() { return run(async (api, _ensureDraft, isCurrent) => {
                if (!state.draft || !pointer.interpretationMessageId) return;
                const messageId = pointer.interpretationMessageId;
                try { return await receiveInterpretation(api, await api(`${path()}/interpretations/${encodeURIComponent(messageId)}`), isCurrent); }
                catch (error) { if (isCurrent() && error.status === 404) { state.interpretation = { messageId, status: 'not_received' }; clearInterpretationPointer(); } throw error; }
            }); },
            resume() { return run(async (api, ensureDraft, isCurrent) => {
                if (!pointer.draftId && !pointer.requestId) return;
                if (!pointer.draftId) await ensureDraft();
                const loaded = await api(`/conversations/${encodeURIComponent(pointer.draftId)}`);
                state.draft = loaded.draft; state.messages = loaded.messages; state.preview = null; state.voiceContext = null; state.lookups = null;
                const prior = copy(state.draft);
                if (state.draft.status === 'committed') { state.receipt = (await api(`${path()}/operation`)).receipt; state.pendingSave = false; pendingCommit = null; }
                if (pointer.interpretationMessageId) {
                    const messageId = pointer.interpretationMessageId;
                    try { await receiveInterpretation(api, await api(`${path()}/interpretations/${encodeURIComponent(messageId)}`), isCurrent); }
                    catch (error) { if (isCurrent() && error.status === 404) { state.interpretation = { messageId, status: 'not_received' }; clearInterpretationPointer(); } throw error; }
                }
                const attachments = state.capabilities?.attachments || pointer.pendingAttachmentId ? await loadAttachments(api) : null;
                await restoreReview(api, prior, loaded.expired === true || attachments?.expired === true);
            }); },
            edit(upserts = [], removals = [], text = 'Updated draft details') { return run(async (api, ensureDraft) => {
                editable(); await ensureDraft();
                const changes = { expectedRevision: state.draft.revision, upserts, removals };
                const fingerprint = JSON.stringify({ changes, text });
                if (!pendingEdit || pendingEdit.fingerprint !== fingerprint) pendingEdit = { fingerprint, body: { changes, text, messageId: createId() } };
                state.preview = null;
                const response = await api(path(), 'PATCH', pendingEdit.body);
                state.draft = response.draft; state.lookups = null;
                if (!state.messages.some(message => message.messageId === pendingEdit.body.messageId)) state.messages.push({ messageId: pendingEdit.body.messageId, text, source: { kind: 'text' }, revision: response.appliedRevision || response.draft.revision });
                pendingEdit = null;
                return copy(state.draft);
            }); },
            review() { return run(async (api, ensureDraft) => {
                editable(); settledInterpretation(); settledAttachments(); await ensureDraft();
                return requestReview(api);
            }); },
            commitVoice(reference, { actorUid, signal } = {}) { return run(async api => {
                if (actorUid !== state.uid || signal?.aborted) throw new Error('The voice account or operation changed.');
                if (state.pendingSave || pendingCommit) throw new Error('Check the save status before confirming again.');
                settledInterpretation(); settledAttachments();
                if (!state.capabilities?.voice || !voiceHints().previewId) throw new Error('Review the current draft before confirming by voice.');
                if (!reference || !Number.isSafeInteger(reference.epoch) || reference.epoch < 1
                    || ['attestationId', 'sessionId', 'utteranceId'].some(key => typeof reference[key] !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(reference[key]))) throw new Error('Trusted voice confirmation is unavailable.');
                pendingCommit = { previewId: state.preview.previewId, voiceAttestationId: reference.attestationId,
                    paymentAcknowledgements: (state.preview.review.paymentAssertions || []).map(item => item.actionId) };
                state.pendingSave = true;
                try {
                    state.receipt = await api(`${path()}/commit`, 'POST', pendingCommit, signal ? { signal } : {});
                    if (state.receipt?.status !== 'committed') throw new Error('Save status is uncertain. Check its status before continuing.');
                    state.draft.status = 'committed'; state.pendingSave = false; pendingCommit = null; state.preview = null; state.voiceContext = null;
                    return copy(state.receipt);
                } catch (error) {
                    if (error.status >= 400 && error.status < 500) { pendingCommit = null; state.pendingSave = false; state.preview = null; state.voiceContext = null; }
                    throw error;
                }
            }); },
            commit(paymentAcknowledgements = []) { return run(async api => {
                settledInterpretation(); settledAttachments();
                if (!state.preview && !pendingCommit) throw new Error('Review the current draft before saving.');
                if (!pendingCommit) {
                    const required = (state.preview.review.paymentAssertions || []).map(item => item.actionId).sort();
                    if (!Array.isArray(paymentAcknowledgements) || paymentAcknowledgements.some(item => typeof item !== 'string')
                        || JSON.stringify([...paymentAcknowledgements].sort()) !== JSON.stringify(required)) throw new Error('Confirm the meaning of each image-related payment before saving.');
                    pendingCommit = { previewId: state.preview.previewId, confirmationToken: state.preview.confirmationToken, paymentAcknowledgements: [...paymentAcknowledgements] };
                }
                state.pendingSave = true;
                try {
                    state.receipt = await api(`${path()}/commit`, 'POST', pendingCommit);
                    state.draft.status = 'committed'; state.pendingSave = false; pendingCommit = null; state.preview = null;
                    return copy(state.receipt);
                } catch (error) {
                    if (error.status >= 400 && error.status < 500) { pendingCommit = null; state.pendingSave = false; state.preview = null; }
                    throw error;
                }
            }); },
            recover() { return run(async api => {
                if (!state.draft) return;
                const operation = await api(`${path()}/operation`);
                state.receipt = operation.receipt; state.pendingSave = false; pendingCommit = null;
                if (operation.status === 'committed') { state.draft.status = 'committed'; state.preview = null; }
                return operation;
            }); },
            resolve(query) { return run(api => api('/context', 'POST', query)); },
            discard() { return run(async api => {
                editable(); if (!state.draft) return;
                state.draft = await api(`${path()}/discard`, 'POST', { expectedRevision: state.draft.revision });
                state.preview = null; pendingEdit = null; clearAttachmentPointer();
            }); },
            newConversation() { return run(async () => {
                settledInterpretation(); settledAttachments();
                if (state.pendingSave || ((state.draft?.actions.length || state.draft?.attachmentIds?.length) && !['committed', 'cancelled'].includes(state.draft.status))) throw new Error('Save or discard the current draft first.');
                pointer = {}; remember(); pendingEdit = null; pendingCommit = null;
                state = { ...empty(state.uid), capabilities: state.capabilities, busy: true };
            }); }
        };
    }
    return { createClient };
});
