window.CrmDataInputAttachments = Object.freeze({
    createPanel({ host, client, perform, beforeUpload = async () => {}, interpretImage = null }) {
        const doc = host.ownerDocument;
        let state = {}, identity = null, disposed = false, previewUrl = null, previewId = null, expiryTimer = null;
        const node = (tag, text) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
        const button = (text, action) => { const el = node('button', text); el.type = 'button'; el.className = 'crm-btn-secondary'; el.addEventListener('click', () => perform(action)); return el; };
        const heading = node('h3', 'Images'), note = node('p'), input = node('input'), list = node('div'), preview = node('img'), pending = node('p');
        input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp'; input.setAttribute('aria-label', 'Image to attach');
        preview.alt = 'Attached image preview'; preview.style.maxWidth = '100%'; preview.style.maxHeight = '260px'; preview.style.objectFit = 'contain'; preview.hidden = true;
        function clearPreview() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; previewId = null; clearTimeout(expiryTimer); preview.removeAttribute('src'); preview.hidden = true; }
        const upload = button('Attach image', async () => { await beforeUpload(); await client.uploadAttachment(input.files[0]); if (!disposed) input.value = ''; });
        const retry = button('Retry image upload', async () => { await client.uploadAttachment(input.files[0]); if (!disposed) input.value = ''; });
        const refresh = button('Check image status', () => client.refreshAttachments());
        host.append(heading, note, input, upload, retry, refresh, pending, list, preview);
        async function showImage(attachment) {
            const owner = identity;
            const blob = await client.readAttachment(attachment.attachmentId);
            if (disposed || owner !== identity) return;
            clearPreview(); previewId = attachment.attachmentId; previewUrl = URL.createObjectURL(blob);
            preview.src = previewUrl; preview.hidden = false;
            expiryTimer = setTimeout(clearPreview, Math.max(0, attachment.expiresAtMs - Date.now()));
        }
        return {
            render(next) {
                if (disposed) return; state = next;
                const nextIdentity = `${state.uid}/${state.draft?.draftId}`;
                if (identity !== nextIdentity) { identity = nextIdentity; clearPreview(); input.value = ''; }
                host.hidden = !state.capabilities?.attachments;
                const terminal = ['committed', 'cancelled'].includes(state.draft?.status), interpreting = ['running', 'unknown'].includes(state.interpretation?.status);
                const locked = state.busy || state.pendingSave || interpreting;
                input.disabled = locked || terminal;
                upload.disabled = locked || terminal || !!state.pendingAttachment || state.attachments.length >= 5;
                upload.hidden = terminal; retry.hidden = !state.pendingAttachment || terminal; retry.disabled = locked;
                refresh.disabled = locked || !state.draft;
                note.textContent = state.capabilities?.imageInterpretation ? 'Enter an instruction, then choose Use image below. Review extracted information before saving. A payment image is not bank verification.' : 'Images are attached for review. AI image interpretation is currently unavailable.';
                pending.textContent = state.pendingAttachment ? 'Upload status is uncertain. Check its status or retry the same image; after reload, select that image again to retry.' : '';
                const ready = state.attachments.filter(item => item.status === 'ready');
                if (previewId && !ready.some(item => item.attachmentId === previewId)) clearPreview();
                list.replaceChildren();
                state.attachments.forEach((attachment, index) => {
                    const row = node('div'); row.className = 'crm-input-attachment';
                    row.append(node('p', `Image ${index + 1} · ${attachment.status}${attachment.width ? ` · ${attachment.width} × ${attachment.height}` : ''}`));
                    if (attachment.status === 'ready') { const view = button(`Preview image ${index + 1}`, () => showImage(attachment)); view.disabled = locked; row.append(view); }
                    if (attachment.status === 'ready' && state.capabilities?.imageInterpretation && typeof interpretImage === 'function') {
                        const use = button(`Use image ${index + 1}`, () => interpretImage(attachment.attachmentId));
                        use.disabled = locked || terminal || !!state.pendingAttachment; row.append(use);
                    }
                    if (attachment.status !== 'deleted') { const remove = button(`Remove image ${index + 1}`, async () => { await client.removeAttachment(attachment.attachmentId); if (previewId === attachment.attachmentId) clearPreview(); }); remove.disabled = locked; row.append(remove); }
                    list.append(row);
                });
            },
            clearPreview,
            dispose() { disposed = true; clearPreview(); input.value = ''; host.replaceChildren(); }
        };
    }
});
