window.CrmDataInputVoice = Object.freeze({
    // Feature lifecycle adapter only. The injected shared transport owns current
    // admission, credentials, usage accounting, audio encoding and playback.
    createSession({ getUid, transport, getUserMedia, onTranscript = () => {}, onChange = () => {}, onConfirmation, retireOnFinal = false }) {
        if (typeof getUid !== 'function' || typeof transport?.prepare !== 'function' || typeof getUserMedia !== 'function') throw new TypeError('Voice adapters are required.');
        let generation = 0, owner = null, handle = null, stream = null, abort = null, finishPromise = null, replyComplete = false, transcriptComplete = false;
        let state = { status: 'idle', muted: false, responseMuted: false, transcript: '', error: null, canFinish: false };
        const snapshot = () => ({ ...state });
        const publish = changes => { state = { ...state, ...changes }; onChange(snapshot()); };
        const stopTracks = media => media?.getTracks().forEach(track => track.stop());
        async function close(connection) { if (connection) { try { await connection.close(); } catch { /* Shared transport retains unsettled usage; never infer a refund. */ } } }
        function stop(status = 'idle') {
            generation++; abort?.abort(); abort = null; finishPromise = null; replyComplete = false; transcriptComplete = false;
            const previous = handle; handle = null; stopTracks(stream); stream = null; owner = null;
            publish({ status, muted: false, responseMuted: false, transcript: '', error: null, canFinish: false });
            return close(previous);
        }
        function current(token, uid) { return token === generation && getUid() === uid && owner === uid; }
        async function eventError(token, uid, message) {
            if (!current(token, uid)) return;
            const retired = generation + 1; await stop('error');
            if (generation === retired) publish({ error: message });
        }
        return {
            getState: snapshot,
            stop,
            syncIdentity() { return owner && getUid() !== owner ? stop() : Promise.resolve(); },
            async start() {
                if (['reply_ready', 'instruction_ready'].includes(state.status)) {
                    const retired = generation + 1; await stop();
                    if (generation !== retired) return;
                }
                if (['preparing', 'permission', 'connecting', 'listening', 'finishing', 'waiting_reply', 'processing_instruction', 'confirming'].includes(state.status)) throw new Error('Voice is already active.');
                const uid = getUid(); if (!uid) throw new Error('Sign in before starting voice.');
                const token = ++generation; owner = uid; abort = new AbortController(); const signal = abort.signal, finals = new Map();
                async function confirm(event) {
                    try {
                        if (typeof onConfirmation !== 'function' || !Number.isSafeInteger(event.epoch) || event.epoch < 1
                            || ['attestationId', 'sessionId', 'utteranceId'].some(key => typeof event[key] !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(event[key]))) {
                            throw new Error('Trusted voice confirmation is unavailable.');
                        }
                        stopTracks(stream); stream = null;
                        publish({ status: 'confirming', muted: false, transcript: '' });
                        const reference = Object.freeze({ attestationId: event.attestationId, sessionId: event.sessionId, epoch: event.epoch, utteranceId: event.utteranceId });
                        // Only the injected application callback can consume the
                        // opaque reference. Keep the session alive for its transaction.
                        const receipt = await onConfirmation(reference, { actorUid: uid, signal });
                        if (!current(token, uid)) return;
                        if (receipt?.status !== 'committed') throw new Error('A committed receipt was not returned.');
                        await stop('saved');
                    } catch {
                        await eventError(token, uid, 'Save could not be confirmed. Check saved status before trying again.');
                    }
                }
                async function acceptInstruction(text, context) {
                    const completed = handle; handle = null; stopTracks(stream); stream = null;
                    publish({ status: 'processing_instruction', muted: false, canFinish: false });
                    // Retire the completed provider connection before changing
                    // its draft context, but retain this accepted operation's
                    // cancellation signal for explicit stop/account changes.
                    await close(completed);
                    if (!current(token, uid)) return;
                    await onTranscript(text, context);
                    if (current(token, uid)) publish({ status: 'instruction_ready' });
                }
                publish({ status: 'preparing', muted: false, responseMuted: false, transcript: '', error: null });
                try {
                    const prepared = await transport.prepare({ actorUid: uid, feature: 'crm-data-input', signal });
                    if (!current(token, uid)) { if (token === generation) await stop(); await close(prepared); return; }
                    handle = prepared;
                    if (!handle || ['connect', 'close', 'interrupt'].some(method => typeof handle[method] !== 'function')) throw new Error('Voice transport is unavailable.');
                    publish({ status: 'permission' });
                    const media = await getUserMedia({ audio: true, video: false });
                    if (!current(token, uid)) { stopTracks(media); if (token === generation) await stop(); return; }
                    stream = media; publish({ status: 'connecting' });
                    await handle.connect({ stream, signal, onEvent(event) {
                        if (!current(token, uid)) { if (token === generation) void stop(); return; }
                        if (['processing_instruction', 'instruction_ready'].includes(state.status)) return;
                        if (event?.type === 'disconnected') {
                            if (state.status === 'confirming') void eventError(token, uid, 'Voice disconnected while saving. Check saved status before trying again.');
                            else void stop('disconnected');
                            return;
                        }
                        if (state.status === 'confirming') return;
                        if (event?.type === 'confirmation_ready') { void confirm(event); return; }
                        if (event?.type === 'turn_complete') {
                            if (['finishing', 'waiting_reply'].includes(state.status)) replyComplete = true;
                            if (state.status === 'waiting_reply' && transcriptComplete) publish({ status: 'reply_ready' });
                            return;
                        }
                        if (event?.type !== 'transcript' || typeof event.text !== 'string' || event.text.length > 16000 || !event.text.trim()) return;
                        if (event.final === true && event.utteranceId !== undefined) {
                            if (typeof event.utteranceId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(event.utteranceId)) { void eventError(token, uid, 'Voice transcript identity is invalid. Start voice again.'); return; }
                            if (finals.has(event.utteranceId)) {
                                if (finals.get(event.utteranceId) !== event.text) void eventError(token, uid, 'Voice transcript changed unexpectedly. Check the instruction before continuing.');
                                return;
                            }
                            if (finals.size >= 256) { void eventError(token, uid, 'Voice transcript limit reached. Start a new voice session.'); return; }
                            finals.set(event.utteranceId, event.text);
                        }
                        if (event.final === true) transcriptComplete = true;
                        publish({ transcript: event.text, ...(state.status === 'waiting_reply' && replyComplete && transcriptComplete ? { status: 'reply_ready' } : {}) });
                        if (event.final === true) {
                            const context = Object.freeze({ actorUid: uid, signal, utteranceId: event.utteranceId });
                            void Promise.resolve(retireOnFinal ? acceptInstruction(event.text, context) : onTranscript(event.text, context)).catch(() => eventError(token, uid, 'The spoken instruction could not be processed. Check the draft before trying again.'));
                        }
                    } });
                    if (current(token, uid)) { if (state.status === 'connecting') publish({ status: 'listening', canFinish: typeof handle.endInput === 'function' }); }
                    else if (token === generation) await stop();
                } catch (error) {
                    if (current(token, uid) && ['processing_instruction', 'instruction_ready'].includes(state.status)) return;
                    if (token === generation) { const retired = generation + 1; await stop('error'); if (generation === retired) publish({ error: error.message || 'Voice connection failed.' }); throw error; }
                }
            },
            finishSpeaking() {
                if (!owner || getUid() !== owner) return stop();
                if (finishPromise) return finishPromise;
                if (state.status !== 'listening' || typeof handle?.endInput !== 'function') return Promise.reject(new Error('Finishing voice input is unavailable.'));
                const token = generation, uid = owner, connection = handle;
                publish({ status: 'finishing', muted: false });
                finishPromise = Promise.resolve().then(async () => {
                    if (!current(token, uid)) return;
                    await connection.endInput();
                    if (!current(token, uid) || state.status !== 'finishing') return;
                    stopTracks(stream); stream = null;
                    publish({ status: replyComplete && transcriptComplete ? 'reply_ready' : 'waiting_reply' });
                }).catch(async error => {
                    // A trusted confirmation can intentionally cancel the flush
                    // while retaining the session for its atomic save.
                    if (!current(token, uid) || ['confirming', 'processing_instruction', 'instruction_ready'].includes(state.status)) return;
                    await eventError(token, uid, 'Voice input could not finish. Start voice again or continue typing.');
                    throw error;
                });
                return finishPromise;
            },
            setMuted(muted) {
                if (!owner || getUid() !== owner) { void stop(); return; }
                if (state.status !== 'listening') return;
                stream.getAudioTracks().forEach(track => { track.enabled = !muted; }); publish({ muted: Boolean(muted) });
            },
            async interrupt() {
                if (!owner || getUid() !== owner) { await stop(); return; }
                if (!state.responseMuted && ['listening', 'waiting_reply', 'reply_ready'].includes(state.status)) {
                    const token = generation, uid = owner;
                    await handle.interrupt();
                    if (current(token, uid)) publish({ responseMuted: true });
                }
            }
        };
    }
});
