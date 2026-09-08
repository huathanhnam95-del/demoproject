window.CrmDataInputVoicePanel = Object.freeze({
    createPanel({ host, instruction, transport, getUid, perform, canStart = () => true, onConfirmation, onSpokenInstruction }) {
        if (!transport) { host.hidden = true; return { refresh() {}, stop() {}, dispose() {} }; }
        const doc = host.ownerDocument; let disposed = false, state = { status: 'idle', muted: false };
        const node = (tag, text) => { const el = doc.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
        const button = (text, action) => { const el = node('button', text); el.type = 'button'; el.className = 'crm-btn-secondary'; el.addEventListener('click', () => perform(action)); return el; };
        const status = node('p'), transcript = node('p'), guidance = node('p', typeof onSpokenInstruction === 'function'
            ? 'Spoken instructions prepare a draft and preview automatically. Resolve any questions, then review the changes before confirming the save.' : typeof onConfirmation === 'function'
            ? 'Spoken details are added to the instruction box. Review the changes, then say the exact confirmation phrase shown with the review to save them.'
            : 'Spoken details are added to the instruction box. Correct them, then send the instruction. Voice does not confirm a save here.');
        status.setAttribute('role', 'status'); transcript.setAttribute('aria-label', 'Live transcript');
        const session = window.CrmDataInputVoice.createSession({ getUid, transport, onConfirmation, retireOnFinal: typeof onSpokenInstruction === 'function',
            getUserMedia: constraints => navigator.mediaDevices.getUserMedia(constraints),
            onChange(next) { if (!disposed) { state = next; render(); } },
            onTranscript(text, context) {
                if (disposed) return;
                const combined = [instruction.value.trim(), text.trim()].filter(Boolean).join('\n');
                if (combined.length > 16000) { guidance.textContent = 'The instruction is full. Copy the latest transcript or shorten the instruction before continuing.'; return; }
                instruction.value = combined;
                if (typeof onSpokenInstruction === 'function') return perform(() => onSpokenInstruction(combined, context));
            }
        });
        const start = button('Start voice', () => session.start()), stop = button('Stop voice', () => session.stop());
        const finish = button('Finish speaking', () => session.finishSpeaking());
        const mute = button('Mute microphone', () => session.setMuted(!state.muted));
        const interrupt = button('Mute response', () => session.interrupt());
        function render() {
            if (disposed) return;
            const active = ['preparing', 'permission', 'connecting', 'listening', 'finishing', 'waiting_reply', 'processing_instruction', 'confirming'].includes(state.status);
            start.disabled = active || !canStart(); stop.disabled = !active && state.status !== 'reply_ready';
            finish.hidden = state.canFinish !== true; finish.disabled = state.status !== 'listening' || !state.canFinish;
            mute.disabled = state.status !== 'listening'; mute.textContent = state.muted ? 'Unmute microphone' : 'Mute microphone';
            interrupt.disabled = state.responseMuted === true || !['listening', 'waiting_reply', 'reply_ready'].includes(state.status);
            interrupt.textContent = state.responseMuted ? 'Response muted' : 'Mute response';
            interrupt.title = 'Mutes response audio for this voice turn. Processing and usage accounting continue. Start a new voice turn to hear responses again.';
            const messages = { idle: 'Voice stopped.', preparing: 'Checking voice access…', permission: 'Waiting for microphone permission…', connecting: 'Connecting voice…', listening: state.muted ? 'Microphone muted.' : 'Microphone on.', finishing: 'Finishing this voice turn…', waiting_reply: 'Microphone off. Waiting for reply…', reply_ready: 'Reply received. You can start another voice turn.', processing_instruction: 'Microphone off. Preparing the draft…', instruction_ready: 'Check the draft below. You can start another voice turn.', confirming: 'Microphone off. Confirming the reviewed save…', saved: 'Reviewed changes saved. Voice stopped.', disconnected: 'Voice disconnected. Start again to reconnect.', error: 'Voice could not start. You can continue typing.' };
            status.textContent = state.error || messages[state.status] || 'Voice status unavailable.'; transcript.textContent = state.transcript || '';
        }
        host.append(node('h3', 'Voice'), guidance, status, start, finish, stop, mute, interrupt, transcript); render();
        return { refresh() { void session.syncIdentity(); render(); }, stop: () => session.stop(), dispose() { disposed = true; void session.stop(); host.replaceChildren(); } };
    }
});
