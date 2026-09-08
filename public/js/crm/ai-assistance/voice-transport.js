(function (globalScope) {
    'use strict';
    function createTransport({ getUid, getIdToken, getContext = () => ({}), baseUrl, workletUrl = '/js/crm/ai-assistance/voice-audio-worklet.js', fetchImpl = globalScope.fetch.bind(globalScope), WebSocketImpl = globalScope.WebSocket, AudioContextImpl = globalScope.AudioContext || globalScope.webkitAudioContext, AudioWorkletNodeImpl = globalScope.AudioWorkletNode } = {}) {
        if (typeof getUid !== 'function' || typeof getIdToken !== 'function') throw new TypeError('Current identity providers are required.');
        const base = new URL(baseUrl, globalScope.location?.href);
        if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) || base.username || base.password || base.search || base.hash) throw new TypeError('A secure relay URL is required.');
        let generation = 0, active = null;
        function requireCurrent(uid, revision, signal) { if (getUid() !== uid || generation !== revision || signal?.aborted) throw new Error('Voice identity or operation changed.'); }
        async function post(path, value, uid, revision, signal) {
            requireCurrent(uid, revision, signal); const token = await getIdToken(); requireCurrent(uid, revision, signal);
            const response = await fetchImpl(new URL(path, base).href, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal, credentials: 'omit', cache: 'no-store' });
            requireCurrent(uid, revision, signal); const text = await response.text(); requireCurrent(uid, revision, signal); if (text.length > 65536) throw new Error('Voice response exceeded its limit.');
            let data; try { data = JSON.parse(text); } catch (_) { throw new Error('Invalid voice response.'); }
            if (!response.ok) throw new Error(data.error === 'PAID_DISPATCH_DISABLED' ? 'Voice assistance is not available yet.' : 'Voice access is unavailable.'); return data;
        }
        async function close() { generation++; const old = active; active = null; await old?.close(); }
        async function prepare({ actorUid, feature, signal } = {}) {
            // Allocate this attempt's identity before yielding. Concurrent
            // preparations must never share the later attempt's generation.
            const revision = ++generation, old = active; active = null;
            await old?.close(); requireCurrent(actorUid, revision, signal);
            const contextHints = await getContext(); requireCurrent(actorUid, revision, signal);
            const requestId = globalScope.crypto.randomUUID();
            const prepared = await post('/prepare', { feature, requestId, contextHints }, actorUid, revision, signal);
            if (!prepared || typeof prepared.sessionId !== 'string' || typeof prepared.ticket !== 'string' || !prepared.ticket || typeof prepared.engineeringOnly !== 'boolean') throw new Error('Voice connection is unavailable.');
            let ws, audio, capture, source, mute, stream, closed = false, connected = false, audioReady = false, inputStopped = false, eventSink = () => {}, playbackAt = 0, identityTimer, connectReject, connectTimer, startupBytes = 0;
            const startupAudio = []; let responseAudioMuted = false;
            // Five 20ms worklet chunks form one 100ms authenticated relay
            // frame. This bounds retained capture to 3,200 PCM bytes while
            // reducing per-frame server authorization/transaction pressure.
            const captureBatch = new Int16Array(1600); let captureSamples = 0;
            let endPromise, flushRequest, flushResolve, flushReject, flushTimer, captureSealed = false, captureConfirmed = false;
            const playing = new Set(), abortSignals = new Set();
            function current() { requireCurrent(actorUid, revision, signal); if (closed) throw new Error('Voice is closed.'); }
            function stopPlayback() { startupAudio.length = 0; startupBytes = 0; for (const node of playing) { try { node.stop(); } catch (_) { /* Already stopped. */ } node.disconnect(); } playing.clear(); playbackAt = audio?.currentTime || 0; }
            function stopCapture() {
                clearTimeout(flushTimer); flushReject?.(new Error('Voice input flush canceled.')); flushResolve = null; flushReject = null; flushRequest = null;
                inputStopped = true; captureSamples = 0; captureBatch.fill(0);
                if (capture) { capture.port.onmessage = null; capture.disconnect(); capture = null; }
                source?.disconnect(); source = null; mute?.disconnect(); mute = null;
                stream?.getTracks().forEach(track => track.stop()); stream = null;
            }
            async function retire(notify = false) {
                if (active === handle) active = null;
                if (closed) return; closed = true; clearInterval(identityTimer); clearTimeout(connectTimer); connectReject?.(new Error('Voice connection closed.')); connectReject = null; stopPlayback();
                stopCapture();
                if (notify) { try { eventSink({ type: 'disconnected' }); } catch (_) { /* Cleanup must still release the device. */ } }
                for (const value of abortSignals) value.removeEventListener('abort', onAbort); abortSignals.clear();
                if (ws && ws.readyState < 2) ws.close(1000, 'Client closed'); if (audio) { try { await audio.close(); } catch (_) { /* Already closed. */ } }
            }
            function onAbort() { void retire(true); }
            function listenAbort(value) { if (value) { if (value.aborted) throw new Error('Voice operation canceled.'); value.addEventListener('abort', onAbort, { once: true }); abortSignals.add(value); } }
            function send(value) { current(); if (ws?.readyState !== 1 || ws.bufferedAmount > 262144) { void retire(true); throw new Error('Voice connection is unavailable.'); } ws.send(JSON.stringify(value)); }
            function flushCapture() {
                current(); if (inputStopped || !captureSamples) return;
                let encoded = ''; for (let index = 0; index < captureSamples; index++) { const value = captureBatch[index]; encoded += String.fromCharCode(value & 255, value >> 8 & 255); }
                captureSamples = 0; captureBatch.fill(0); send({ type: 'audio', data: globalScope.btoa(encoded) });
            }
            function decodeAudio(event) {
                if (event.sampleRate !== 24000 || typeof event.data !== 'string' || event.data.length > 48000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.data)) throw new Error('Invalid voice audio.');
                const raw = globalScope.atob(event.data); if (!raw.length || raw.length % 2) throw new Error('Invalid voice audio.');
                return raw;
            }
            function playback(event, raw = decodeAudio(event)) {
                if (playbackAt - audio.currentTime > 10 || playing.size > 64) throw new Error('Voice playback limit reached.');
                const buffer = audio.createBuffer(1, raw.length / 2, 24000), samples = buffer.getChannelData(0);
                for (let i = 0; i < samples.length; i++) { let value = raw.charCodeAt(i * 2) | raw.charCodeAt(i * 2 + 1) << 8; if (value & 32768) value -= 65536; samples[i] = value / 32768; }
                const node = audio.createBufferSource(); node.buffer = buffer; node.connect(audio.destination); playing.add(node); node.onended = () => { playing.delete(node); node.disconnect(); };
                playbackAt = Math.max(audio.currentTime, playbackAt); node.start(playbackAt); playbackAt += buffer.duration;
            }
            async function startAudio(media) {
                current(); if (inputStopped) return; audio = new AudioContextImpl(); await audio.audioWorklet.addModule(workletUrl); current(); if (inputStopped) return; await audio.resume(); current(); if (inputStopped) return;
                source = audio.createMediaStreamSource(media); capture = new AudioWorkletNodeImpl(audio, 'crm-voice-pcm-capture'); mute = audio.createGain(); mute.gain.value = 0;
                capture.port.onmessage = event => { try {
                    current(); if (inputStopped || captureSealed) return;
                    const ack = event.data?.type === 'flushed';
                    if (ack && (!flushRequest || event.data.requestId !== flushRequest || Object.keys(event.data).some(key => !['type', 'requestId', 'pcm'].includes(key)))) throw new Error('Invalid capture acknowledgment.');
                    const pcm = ack ? event.data.pcm : event.data;
                    if (Object.prototype.toString.call(pcm) !== '[object ArrayBuffer]' || pcm.byteLength % 2) throw new Error('Invalid capture chunk.');
                    const values = new Int16Array(pcm);
                    if (ack ? values.length > 320 : values.length !== 320) throw new Error('Invalid capture chunk.');
                    captureBatch.set(values, captureSamples); captureSamples += values.length;
                    if (captureSamples === captureBatch.length) flushCapture();
                    if (ack) { captureSealed = true; clearTimeout(flushTimer); const resolve = flushResolve; flushResolve = null; flushReject = null; flushRequest = null; resolve(); }
                } catch (_) { void retire(true); } };
                source.connect(capture); capture.connect(mute); mute.connect(audio.destination);
                audioReady = true; for (const event of startupAudio) playback(event); startupAudio.length = 0; startupBytes = 0;
            }
            const handle = {
                async connect({ stream: media, signal: connectSignal, onEvent = () => {} } = {}) {
                    if (connected || closed) throw new Error('Voice connection cannot be replayed.'); connected = true; stream = media; eventSink = onEvent;
                    try {
                        current(); listenAbort(connectSignal); if (!stream?.getTracks || typeof AudioContextImpl !== 'function' || typeof AudioWorkletNodeImpl !== 'function') throw new Error('Voice audio is unavailable.');
                        const token = await getIdToken(); current(); const url = new URL('/voice', base); url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
                        await new Promise((resolve, reject) => {
                            connectReject = reject; connectTimer = setTimeout(() => { reject(new Error('Voice connection timed out.')); void retire(true); }, 8000); ws = new WebSocketImpl(url.href);
                            ws.onopen = () => { try { send({ type: 'authenticate', feature, sessionId: prepared.sessionId, ticket: prepared.ticket, idToken: token }); } catch (error) { reject(error); void retire(true); } };
                            ws.onmessage = event => { try {
                                current(); if (typeof event.data !== 'string' || event.data.length > 65536) throw new Error('Invalid voice frame.'); const value = JSON.parse(event.data);
                                if (value.type === 'ready') { if (value.sessionId !== prepared.sessionId || !Number.isSafeInteger(value.epoch)) throw new Error('Invalid voice session.'); clearTimeout(connectTimer); connectReject = null; resolve(); return; }
                                if (value.type === 'error') throw new Error('Voice access is unavailable.');
                                if (value.type === 'assistant_audio') {
                                    const raw = decodeAudio(value);
                                    // Keep validating bounded PCM even when muted. Never retain,
                                    // schedule or forward muted audio to application consumers.
                                    if (responseAudioMuted) return;
                                    if (!audioReady) { if (startupAudio.length >= 32 || (startupBytes += value.data.length) > 262144) throw new Error('Startup audio limit reached.'); startupAudio.push(value); } else playback(value, raw);
                                }
                                else if (value.type === 'interrupted') { if (value.scope !== undefined && value.scope !== 'response_audio') throw new Error('Unsupported voice interruption.'); if (value.scope === 'response_audio') responseAudioMuted = true; stopPlayback(); }
                                else if (value.type === 'transcript') { if (typeof value.text !== 'string' || value.text.length > 16000 || typeof value.final !== 'boolean') throw new Error('Invalid voice transcript.'); }
                                else if (value.type === 'confirmation_ready') { if (typeof value.attestationId !== 'string' || value.attestationId.length > 128 || value.sessionId !== prepared.sessionId || !Number.isSafeInteger(value.epoch)) throw new Error('Invalid server confirmation reference.'); captureConfirmed = true; stopCapture(); }
                                else if (!['assistant_text', 'turn_complete', 'context'].includes(value.type)) throw new Error('Unsupported voice event.');
                                eventSink(value);
                            } catch (error) { reject(error); void retire(true); } };
                            ws.onerror = () => { reject(new Error('Voice connection failed.')); void retire(true); };
                            ws.onclose = () => { reject(new Error('Voice disconnected.')); void retire(true); };
                        });
                        current(); await startAudio(stream); current();
                    } catch (error) { await retire(true); throw error; }
                },
                close: retire,
                endInput() {
                    if (endPromise) return endPromise;
                    try { current(); if (!audioReady || !capture || inputStopped) throw new Error('Voice input is unavailable.'); } catch (error) { return Promise.reject(error); }
                    // Defer the body so concurrent callers share the promise
                    // before even a synchronous test port can acknowledge it.
                    endPromise = Promise.resolve().then(async () => {
                        current(); if (inputStopped || !capture) throw new Error('Voice input is unavailable.');
                        await new Promise((resolve, reject) => {
                            flushRequest = globalScope.crypto.randomUUID(); flushResolve = resolve; flushReject = reject;
                            flushTimer = setTimeout(() => { reject(new Error('Voice input flush timed out.')); void retire(true); }, 1000);
                            capture.port.postMessage({ type: 'flush-and-stop', requestId: flushRequest });
                        });
                        current(); if (inputStopped) throw new Error('Voice input flush canceled.');
                        flushCapture(); stopCapture(); send({ type: 'end' });
                    }).catch(async error => { if (!captureConfirmed) await retire(true); throw error; });
                    return endPromise;
                },
                interrupt() {
                    current(); responseAudioMuted = true; stopPlayback();
                    // Native turns are one-shot, with no response ID for safely
                    // unmuting late frames. Only a fresh preparation resets mute.
                    const run = () => { flushCapture(); send({ type: 'interrupt' }); };
                    return endPromise ? endPromise.then(run) : run();
                },
                async updateContext() { const contextHints = await getContext(); if (endPromise) await endPromise; current(); flushCapture(); send({ type: 'context', contextHints }); },
                readStatus() { return post('/status', { feature, sessionId: prepared.sessionId }, actorUid, revision, signal); },
                syncIdentity() { if (getUid() !== actorUid) return retire(true); }
            };
            listenAbort(signal); identityTimer = setInterval(() => { if (getUid() !== actorUid || generation !== revision) void retire(true); }, 250); active = handle; return handle;
        }
        return { prepare, close, endInput: () => active?.endInput(), interrupt: () => active?.interrupt(), updateContext: () => active?.updateContext(), readStatus: () => active?.readStatus(), syncIdentity: () => active?.syncIdentity() };
    }
    globalScope.CrmAiVoiceTransport = Object.freeze({ createTransport });
})(typeof window !== 'undefined' ? window : globalThis);
