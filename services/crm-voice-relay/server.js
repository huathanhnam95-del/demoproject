'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { parseProviderMessage, pcm } = require('./provider-parser');
const LIMITS = Object.freeze({ frameBytes: 65536, queueBytes: 262144, queueMessages: 32, authTimeoutMs: 5000, sessionMs: 120000, audioBytes: 3840000, outputBytes: 5760000, sockets: 128 });
function fail(code = 'RELAY_REJECTED', status = 400) { throw Object.assign(new Error(code), { code, status }); }
function object(value, keys) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail(); }
function identifier(value, max = 128) { if (typeof value !== 'string' || !value || value.length > max || [...value].some(character => character.charCodeAt(0) <= 32) || /[\\/]/.test(value)) fail(); return value; }
function createRelayServer({ sessionService, authenticate, runAsIdentity = (_identity, work) => work(), allowedOrigins = [], ledger, features = {}, providerFactory, engineeringMode = false, nativeMode = false, onDiagnostic = () => {}, limits: requested = {} } = {}) {
    if (!sessionService || typeof authenticate !== 'function' || !ledger) throw new TypeError('Session, authentication and ledger services are required.');
    if (typeof runAsIdentity !== 'function') throw new TypeError('Identity operation boundary must be a function.');
    const origins = new Set(allowedOrigins); if (!origins.size || [...origins].some(origin => { try { const url = new URL(origin); return url.origin !== origin || !['http:', 'https:'].includes(url.protocol); } catch (_) { return true; } })) throw new TypeError('Exact allowed origins are required.');
    const limits = { ...LIMITS };
    for (const [key, value] of Object.entries(requested)) { if (!Object.hasOwn(limits, key) || !Number.isSafeInteger(value) || value < 1 || value > limits[key]) throw new TypeError('Limits may only be lowered.'); limits[key] = value; }
    // Pause before the hard cap: one arriving maximum frame can cross this
    // threshold, leaving another frame of headroom under the default limits.
    // Lowered caps still reject any individual frame they cannot accommodate.
    const highBytes = Math.max(1, Math.min(Math.floor(limits.queueBytes / 2), limits.queueBytes - limits.frameBytes));
    const lowBytes = Math.floor(highBytes / 2), highJobs = Math.max(1, Math.floor(limits.queueMessages / 2)), lowJobs = Math.floor(highJobs / 2);
    function configuration(feature) {
        const config = Object.hasOwn(features, feature) && features[feature];
        const engineering = engineeringMode === true && config?.engineeringOnly === true && String(config.model).startsWith('engineering-') && String(config.provider).startsWith('engineering-') && providerFactory?.engineeringOnly === true;
        const native = nativeMode === true && engineeringMode !== true && config?.engineeringOnly === false && config.model === 'gemini-3.1-flash-live-preview' && config.provider === 'gemini' && providerFactory?.native === true;
        if (!config || !(engineering || native) || typeof config.admission !== 'function') fail('PAID_DISPATCH_DISABLED', 409);
        return config;
    }
    async function verifiedIdentity(token) { identifier(token, 8192); const identity = await authenticate(token); if (!identity?.uid) fail('UNAUTHORIZED', 401); return Object.freeze({ ...identity, uid: identifier(identity.uid) }); }
    async function actor(token) { return (await verifiedIdentity(token)).uid; }
    async function withActor(token, work) {
        const identity = await verifiedIdentity(token);
        // The composition may bind verified claims to this awaited operation
        // (e.g. AsyncLocalStorage). Never use a process-wide last-user cache.
        return runAsIdentity(identity, () => work(identity.uid));
    }
    function origin(req) { if (!origins.has(req.headers.origin)) fail('ORIGIN_DENIED', 403); }
    async function body(req) {
        let size = 0; const chunks = []; for await (const chunk of req) { size += chunk.length; if (size > limits.frameBytes) fail(); chunks.push(chunk); }
        try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { fail(); }
    }
    const server = http.createServer(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            origin(req); res.setHeader('Access-Control-Allow-Origin', req.headers.origin); res.setHeader('Vary', 'Origin');
            if (req.url !== '/prepare' && req.url !== '/status') fail('NOT_FOUND', 404);
            if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'POST'); res.writeHead(204).end(); return; }
            if (req.method !== 'POST' || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) fail();
            const header = req.headers.authorization || ''; if (!header.startsWith('Bearer ')) fail('UNAUTHORIZED', 401);
            const result = await withActor(header.slice(7), async actorUid => {
                const input = await body(req);
                if (req.url === '/prepare') { object(input, ['feature', 'requestId', 'contextHints']); identifier(input.feature); identifier(input.requestId); configuration(input.feature); return sessionService.prepare({ actorUid, ...input }); }
                object(input, ['feature', 'sessionId']); identifier(input.feature); identifier(input.sessionId); return sessionService.readStatus({ actorUid, ...input });
            });
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
        } catch (error) { res.writeHead(Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.status : 400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.code === 'PAID_DISPATCH_DISABLED' ? error.code : 'RELAY_REJECTED' })); }
    });
    server.requestTimeout = limits.authTimeoutMs; server.headersTimeout = limits.authTimeoutMs;
    const sockets = new Set(); const wss = new WebSocketServer({ noServer: true, maxPayload: limits.frameBytes, perMessageDeflate: false });
    server.on('upgrade', (req, socket, head) => {
        try { origin(req); if (req.url !== '/voice' || sockets.size >= limits.sockets) fail(); wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws)); }
        catch (_) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); }
    });
    wss.on('connection', ws => {
        const lifetime = new AbortController();
        sockets.add(ws); let scope, token, provider, reservation, presentedContextRevision, dispatched = false, settled = false, closed = false, authenticating = false, chain = Promise.resolve(), queued = 0, queuedBytes = 0, audioBytes = 0, outputBytes = 0, utterance, audioTail, providerTail, confirmationIssued = false, inputEnded = false;
        let capacity, responseAudioMuted = false;
        function diagnostic(code) { try { onDiagnostic({ code, queued, queuedBytes }); } catch (_) { /* Diagnostics cannot prevent cleanup or draining. */ } }
        function releaseCapacity() {
            if (!capacity || !closed && (queued > lowJobs || queuedBytes > lowBytes)) return;
            const pending = capacity; capacity = null;
            if (!closed) diagnostic('QUEUE_RESUMED');
            pending.resolve();
        }
        function providerCapacity() {
            if (closed || nativeMode !== true) return;
            if (!capacity && (queued >= highJobs || queuedBytes >= highBytes)) {
                let resolve; const promise = new Promise(done => { resolve = done; });
                capacity = { promise, resolve }; diagnostic('QUEUE_PAUSED');
            }
            return capacity?.promise;
        }
        const authTimer = setTimeout(() => stop(), limits.authTimeoutMs); let sessionTimer;
        const send = value => { const bytes = JSON.stringify(value); if (Buffer.byteLength(bytes) > limits.frameBytes || ws.bufferedAmount > limits.queueBytes) fail(); if (!closed && ws.readyState === WebSocket.OPEN) ws.send(bytes); };
        async function current() { if (closed || !scope) fail(); if (await actor(token) !== scope.actorUid) fail(); const { actorUid, feature, sessionId } = scope; const value = await sessionService.readStatus({ actorUid, feature, sessionId }); if (value.epoch !== scope.epoch || value.state !== 'connected' || value.expiresAtMs !== undefined && value.expiresAtMs <= Date.now()) fail('STALE_EPOCH'); if (value.contextChanged || value.contextRevision !== presentedContextRevision) { send({ type: 'context', contextRevision: value.contextRevision, summary: value.summary }); fail('CONTEXT_CHANGED'); } return value; }
        async function cleanup() {
            if (closed) return; closed = true; lifetime.abort(); releaseCapacity(); clearTimeout(authTimer); clearTimeout(sessionTimer); sockets.delete(ws);
            // Provider shutdown and session fencing must not wait for an
            // unavailable accounting backend. The dispatch guard is durable.
            await Promise.allSettled([
                Promise.resolve().then(() => provider?.close?.()),
                Promise.resolve().then(() => dispatched && !settled ? ledger.markUnknown(reservation.reservationId) : undefined),
                Promise.resolve().then(() => scope ? sessionService.close(scope) : undefined)
            ]);
        }
        function stop(error) { diagnostic(error?.code || 'RELAY_STOPPED'); void cleanup(); if (ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify({ type: 'error', code: 'RELAY_REJECTED' })); } catch (_) { /* Closing. */ } ws.close(1008, 'Relay closed'); } const timer = setTimeout(() => ws.terminate(), 250); timer.unref(); }
        function queue(work, bytes, frames = null, messages = null) {
            // A new job seals both tails, preserving arrival order across controls.
            audioTail = null; providerTail = null;
            if (closed) return;
            if (queued + 1 > limits.queueMessages || queuedBytes + bytes > limits.queueBytes) { stop({ code: 'QUEUE_LIMIT' }); return; }
            const job = { bytes, frames, messages }; queued++; queuedBytes += bytes;
            if (frames) audioTail = job; if (messages) providerTail = job;
            chain = chain.then(async () => {
                // Never append to a batch once its fresh authority check starts.
                if (audioTail === job) audioTail = null; if (providerTail === job) providerTail = null;
                if (!closed) {
                    if (scope) await withActor(token, actorUid => { if (actorUid !== scope.actorUid) fail('UNAUTHORIZED', 401); return work(job); });
                    else await work(job);
                }
            }).catch(error => stop(error)).finally(() => { queued--; queuedBytes -= job.bytes; releaseCapacity(); });
        }
        async function sendAudio(data) {
            if (closed || confirmationIssued || inputEnded) return;
            audioBytes += data.length; if (audioBytes > limits.audioBytes || settled) fail();
            if (!utterance) { utterance = { id: crypto.randomUUID(), hash: crypto.createHash('sha256'), bytes: 0 }; await sessionService.providerChannel(scope).beginUtterance({ utteranceId: utterance.id, eventId: crypto.randomUUID(), source: 'user_audio' }); }
            if (closed) return;
            utterance.hash.update(data); utterance.bytes += data.length; await provider.sendAudio({ bytes: data, sampleRate: 16000, utteranceId: utterance.id });
        }
        function queueAudio(data, bytes) {
            if (closed || confirmationIssued || inputEnded) return;
            if (audioTail && audioTail.bytes + bytes <= limits.frameBytes) {
                if (queuedBytes + bytes > limits.queueBytes) { stop({ code: 'QUEUE_LIMIT' }); return; }
                audioTail.frames.push(data); audioTail.bytes += bytes; queuedBytes += bytes; return;
            }
            queue(async job => { if (confirmationIssued || inputEnded) return; await current(); for (const frame of job.frames) await sendAudio(frame); }, bytes, [data]);
        }
        async function providerMessages(messages) {
            await current();
            const normalized = []; for (const message of messages) normalized.push(nativeMode === true ? await provider.processMessage(message) : message);
            await current();
            for (const message of normalized) for (const event of parseProviderMessage(message)) {
                if (event.type === 'usage') { await ledger.settle(reservation.reservationId, event.evidence); if (event.evidence.complete) { settled = true; ws.close(1000, 'Provider completed'); await cleanup(); return; } continue; }
                if (event.type === 'user_transcription') {
                    if (!utterance || event.utteranceId !== utterance.id) fail('UNBOUND_UTTERANCE');
                    if (event.final) {
                        const channel = sessionService.providerChannel(scope);
                        const finalized = await channel.finalizeUtterance({ utteranceId: utterance.id, eventId: event.eventId, source: 'user_audio', text: event.text, final: true, audioEvidence: { audioDigest: utterance.hash.digest('hex'), durationMs: Math.ceil(utterance.bytes / 32), ...(event.transcription ? { transcription: event.transcription } : {}) } });
                        // This is an opaque server attestation reference. Domain
                        // commit must look up its exact persisted binding; it is
                        // never passed to the model or accepted as client speech.
                        if (finalized?.attestationId) {
                            // Confirmation is terminal for input, not the session:
                            // leave its epoch available for atomic consumption.
                            confirmationIssued = true;
                            send({ type: 'confirmation_ready', attestationId: finalized.attestationId, sessionId: scope.sessionId, epoch: scope.epoch, utteranceId: utterance.id });
                        }
                        utterance = null;
                    }
                    send({ type: 'transcript', utteranceId: event.utteranceId, text: event.text, final: event.final }); continue;
                }
                if (event.type === 'assistant_audio') { outputBytes += Buffer.from(event.data, 'base64').length; if (outputBytes > limits.outputBytes) fail(); if (responseAudioMuted) continue; }
                send(event);
            }
        }
        function queueProvider(message, bytes) {
            if (closed) return;
            // Terminal processing performs accounting/ASR. Keep its fresh checks
            // separate so earlier audio is delivered before waiting on that I/O.
            const batchable = nativeMode === true && message.serverContent?.turnComplete !== true;
            audioTail = null;
            if (batchable && providerTail && providerTail.messages.length < 16 && providerTail.bytes + bytes <= limits.frameBytes) {
                if (queuedBytes + bytes > limits.queueBytes) { stop({ code: 'QUEUE_LIMIT' }); return; }
                providerTail.messages.push(message); providerTail.bytes += bytes; queuedBytes += bytes; return providerCapacity();
            }
            if (batchable) queue(job => providerMessages(job.messages), bytes, null, [message]);
            else queue(() => providerMessages([message]), bytes);
            return providerCapacity();
        }
        ws.on('message', (bytes, binary) => {
            providerTail = null;
            if (binary) { stop(); return; }
            if (provider) {
                try {
                    const input = JSON.parse(bytes.toString('utf8'));
                    if (input?.type === 'audio') { object(input, ['type', 'data']); queueAudio(Buffer.from(pcm(input.data), 'base64'), bytes.length); return; }
                } catch (error) { stop(error); return; }
            }
            queue(async () => {
                let input; try { input = JSON.parse(bytes.toString('utf8')); } catch (_) { fail(); }
                if (!scope) {
                    object(input, ['type', 'idToken', 'sessionId', 'ticket', 'feature']); if (input.type !== 'authenticate' || authenticating) fail(); authenticating = true;
                    token = input.idToken;
                    return withActor(token, async actorUid => {
                    if (closed) return;
                    identifier(input.feature); identifier(input.sessionId); identifier(input.ticket, 512); const config = configuration(input.feature);
                    const claimed = await sessionService.claim({ actorUid, feature: input.feature, sessionId: input.sessionId, ticket: input.ticket, connectionId: crypto.randomUUID() });
                    scope = { actorUid, feature: input.feature, sessionId: input.sessionId, epoch: claimed.epoch }; presentedContextRevision = claimed.contextRevision; if (!Number.isSafeInteger(presentedContextRevision) || presentedContextRevision < 0) fail(); await current();
                    const featureLedger = ledger.forFeature(scope.feature); const admission = await config.admission({ ...scope, session: claimed });
                    if (admission.model !== config.model) fail();
                    reservation = await featureLedger.reserve(actorUid, { ...admission, requestId: `voice-${scope.sessionId}-${scope.epoch}` });
                    const permission = await featureLedger.authorizeDispatch(actorUid, reservation.reservationId);
                    if (!permission.sendPermit || permission.sendPermit.engineeringOnly !== config.engineeringOnly || permission.sendPermit.provider !== config.provider || permission.sendPermit.model !== config.model) fail();
                    dispatched = true; if (closed) { await ledger.markUnknown(reservation.reservationId); return; } await current();
                    const providerContext = await sessionService.providerChannel(scope).getContext();
                    if (closed) return;
                    provider = await providerFactory({ signal: lifetime.signal, scope: { ...scope }, session: claimed, context: providerContext, sendPermit: permission.sendPermit,
                        onMessage(message) { let length; try { length = Buffer.byteLength(JSON.stringify(message)); } catch (_) { stop(); return; } if (length > limits.frameBytes) { stop(); return; } return queueProvider(message, length); }, onError: stop });
                    if (closed) { await provider?.close?.(); if (!settled) await ledger.markUnknown(reservation.reservationId); return; }
                    clearTimeout(authTimer); sessionTimer = setTimeout(stop, limits.sessionMs); send({ type: 'ready', sessionId: scope.sessionId, epoch: scope.epoch, engineeringOnly: config.engineeringOnly });
                    });
                }
                if (input.type === 'audio' && (confirmationIssued || inputEnded)) return;
                await current();
                if (input.type === 'audio') {
                    object(input, ['type', 'data']); await sendAudio(Buffer.from(pcm(input.data), 'base64'));
                } else if (input.type === 'interrupt') {
                    object(input, ['type']);
                    if (nativeMode === true) {
                        // Suppress this one-shot turn's response audio after fresh
                        // authority checks. Keep ASR, confirmation and accounting;
                        // this does not cancel provider generation or its expense.
                        responseAudioMuted = true; send({ type: 'interrupted', scope: 'response_audio' });
                    } else { await provider.interrupt?.(); send({ type: 'interrupted' }); }
                }
                else if (input.type === 'context') { object(input, ['type', 'contextHints']); if (nativeMode === true && typeof provider.updateContext !== 'function') fail('CONTEXT_RESTART_REQUIRED'); const status = await sessionService.updateContext({ ...scope, contextHints: input.contextHints }); await provider.updateContext?.(await sessionService.providerChannel(scope).getContext()); presentedContextRevision = status.contextRevision; send({ type: 'context', contextRevision: status.contextRevision, summary: status.summary }); }
                else if (input.type === 'end') {
                    object(input, ['type']);
                    if (closed) return;
                    if (!inputEnded && !confirmationIssued) {
                        if (typeof provider.endInput !== 'function') fail('END_INPUT_UNSUPPORTED');
                        inputEnded = true; await provider.endInput();
                    }
                }
                else fail();
            }, bytes.length);
        });
        ws.on('close', () => { void cleanup(); }); ws.on('error', stop);
    });
    return { server, async close() { for (const ws of sockets) ws.terminate(); await new Promise(resolve => wss.close(resolve)); if (server.listening) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); } }, limits: Object.freeze(limits) };
}
module.exports = { createRelayServer, LIMITS };
