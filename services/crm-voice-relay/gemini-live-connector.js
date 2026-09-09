'use strict';

// Transport only. These local resource limits do NOT prove a provider billing
// maximum or make transcripts/usage suitable as confirmation/settlement evidence.
const ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const MODEL = 'models/gemini-3.1-flash-live-preview';
const PROVENANCE = Object.freeze({ model: MODEL, transport: 'gemini-live-v1beta',
    inputTranscriptionEnabled: true, outputTranscriptionEnabled: true, thinkingLevel: 'MINIMAL',
    transcriptsAttestable: false, billingBoundProven: false, transcriptionCostProven: false,
    thoughtsMayBeBillable: true });
const LIMITS = Object.freeze({ contextBytes: 32768, frameBytes: 65536, audioFrameBytes: 32000,
    inputAudioBytes: 3840000, outputBytes: 8388608, queueBytes: 262144, queueMessages: 32,
    admissionMs: 5000, setupMs: 5000, sessionMs: 120000 });
function error(code) { return Object.assign(new Error(code), { code }); }
function check(condition, code = 'INVALID_PROVIDER_MESSAGE') { if (!condition) throw error(code); }
function object(value, keys) {
    check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)));
}
function string(value, max = 16000) { check(typeof value === 'string' && value.length <= max); }
function count(value) { check(Number.isSafeInteger(value) && value >= 0); }
function validateMessage(message) {
    object(message, ['setupComplete', 'serverContent', 'usageMetadata', 'goAway', 'voiceActivity', 'sessionResumptionUpdate']);
    const structuralKeys = Object.keys(message).filter(key => !['usageMetadata', 'voiceActivity'].includes(key));
    check(structuralKeys.length === 1 || (structuralKeys.length === 0 && (message.usageMetadata !== undefined || message.voiceActivity !== undefined)));
    if (message.voiceActivity !== undefined) {
        object(message.voiceActivity, ['type', 'voiceActivityType', 'audioOffset']);
        check(message.voiceActivity.type === undefined || message.voiceActivity.voiceActivityType === undefined);
        const activityType = message.voiceActivity.type ?? message.voiceActivity.voiceActivityType;
        if (activityType !== undefined) check(['TYPE_UNSPECIFIED', 'VOICE_ACTIVITY_TYPE_UNSPECIFIED', 'ACTIVITY_START', 'ACTIVITY_END'].includes(activityType));
        if (message.voiceActivity.audioOffset !== undefined) string(message.voiceActivity.audioOffset, 64);
    }
    if (message.setupComplete !== undefined) object(message.setupComplete, []);
    if (message.sessionResumptionUpdate !== undefined) {
        const update = message.sessionResumptionUpdate;
        object(update, ['newHandle', 'resumable', 'lastConsumedClientMessageIndex']);
        if (update.newHandle !== undefined) string(update.newHandle, 4096);
        if (update.resumable !== undefined) check(typeof update.resumable === 'boolean');
        if (update.lastConsumedClientMessageIndex !== undefined) check(typeof update.lastConsumedClientMessageIndex === 'string' && /^\d{1,20}$/.test(update.lastConsumedClientMessageIndex));
    }
    if (message.goAway !== undefined) { object(message.goAway, ['timeLeft']); string(message.goAway.timeLeft, 64); }
    if (message.usageMetadata !== undefined) {
        const usage = message.usageMetadata;
        const totals = ['promptTokenCount', 'cachedContentTokenCount', 'responseTokenCount', 'candidatesTokenCount', 'toolUsePromptTokenCount', 'thoughtsTokenCount', 'totalTokenCount'];
        const details = ['promptTokensDetails', 'cacheTokensDetails', 'responseTokensDetails', 'candidatesTokensDetails', 'toolUsePromptTokensDetails'];
        object(usage, [...totals, ...details, 'trafficType', 'serviceTier']);
        for (const key of ['trafficType', 'serviceTier']) if (usage[key] !== undefined) string(usage[key], 64);
        for (const key of totals) if (usage[key] !== undefined) count(usage[key]);
        for (const key of details) if (usage[key] !== undefined) {
            check(Array.isArray(usage[key]) && usage[key].length <= 16);
            for (const entry of usage[key]) { object(entry, ['modality', 'tokenCount']); string(entry.modality, 64); count(entry.tokenCount); }
        }
    }
    if (message.serverContent !== undefined) {
        const content = message.serverContent;
        object(content, ['generationComplete', 'turnComplete', 'interrupted', 'groundingMetadata', 'inputTranscription',
            'interimInputTranscription', 'outputTranscription', 'urlContextMetadata', 'waitingForInput', 'speechState', 'interactionStatus', 'turnCompleteReason', 'modelTurn']);
        for (const key of ['generationComplete', 'turnComplete', 'interrupted', 'waitingForInput']) if (content[key] !== undefined) check(typeof content[key] === 'boolean');
        for (const key of ['speechState', 'interactionStatus', 'turnCompleteReason']) if (content[key] !== undefined) string(content[key], 128);
        // Grounding/URL tools are never configured. Empty metadata is harmless;
        // actual retrieval metadata is an unexpected capability and fails closed.
        for (const key of ['groundingMetadata', 'urlContextMetadata']) if (content[key] !== undefined) object(content[key], []);
        for (const key of ['inputTranscription', 'interimInputTranscription', 'outputTranscription']) if (content[key] !== undefined) {
            object(content[key], ['text', 'languageCode', 'finished', 'speakerLabel', 'words']);
            if (content[key].text !== undefined) string(content[key].text);
            if (content[key].languageCode !== undefined) string(content[key].languageCode, 64);
            if (content[key].finished !== undefined) check(typeof content[key].finished === 'boolean');
            if (content[key].speakerLabel !== undefined) string(content[key].speakerLabel, 128);
            if (content[key].words !== undefined) {
                check(Array.isArray(content[key].words) && content[key].words.length <= 512);
                for (const word of content[key].words) { object(word, ['word', 'startOffset', 'endOffset']); if (word.word !== undefined) string(word.word, 256); for (const offset of ['startOffset', 'endOffset']) if (word[offset] !== undefined) string(word[offset], 64); }
            }
        }
        if (content.modelTurn !== undefined) {
            const turn = content.modelTurn; object(turn, ['role', 'parts']);
            check(turn.role === undefined || turn.role === 'model');
            check(Array.isArray(turn.parts) && turn.parts.length > 0 && turn.parts.length <= 32);
            for (const part of turn.parts) {
                object(part, ['text', 'inlineData', 'thought', 'thoughtSignature']);
                check(part.text !== undefined || part.inlineData !== undefined);
                if (part.text !== undefined) string(part.text);
                if (part.thought !== undefined) check(typeof part.thought === 'boolean');
                if (part.thoughtSignature !== undefined) string(part.thoughtSignature, 32000);
                if (part.inlineData !== undefined) {
                    object(part.inlineData, ['mimeType', 'data']);
                    check(part.inlineData.mimeType === 'audio/pcm;rate=24000');
                    const data = part.inlineData.data;
                    check(typeof data === 'string' && data.length > 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data));
                    const decoded = Buffer.from(data, 'base64');
                    check(decoded.length > 0 && decoded.length % 2 === 0 && decoded.toString('base64') === data);
                }
            }
        }
    }
    return message;
}

async function createGeminiLiveConnector({ apiKey, contextText, maxOutputTokens, maxInputAudioBytes,
    authorizeDispatch, onMessage, onError, WebSocketImpl, signal } = {}) {
    check(typeof apiKey === 'string' && apiKey.length > 0 && apiKey.length <= 4096 && !/[\r\n]/.test(apiKey), 'INVALID_CONFIGURATION');
    check(typeof contextText === 'string' && Buffer.byteLength(contextText) <= LIMITS.contextBytes, 'INVALID_CONFIGURATION');
    check(Number.isInteger(maxOutputTokens) && maxOutputTokens > 0 && maxOutputTokens <= 8192, 'INVALID_CONFIGURATION');
    check(Number.isInteger(maxInputAudioBytes) && maxInputAudioBytes >= 2 && maxInputAudioBytes <= LIMITS.inputAudioBytes && maxInputAudioBytes % 2 === 0, 'INVALID_CONFIGURATION');
    check(typeof authorizeDispatch === 'function' && typeof onMessage === 'function' && typeof onError === 'function', 'INVALID_CONFIGURATION');
    check(signal === undefined || (typeof signal.aborted === 'boolean' && typeof signal.addEventListener === 'function' && typeof signal.removeEventListener === 'function'), 'INVALID_CONFIGURATION');
    check(!signal?.aborted, 'CONNECTOR_ABORTED');
    const admissionController = new AbortController();
    const admissionDeadline = Date.now() + LIMITS.admissionMs;
    // The authorizer retains ownership of reservations, including a commit that
    // races cancellation. It receives a cancellation signal for cooperative
    // cleanup/reconciliation. This transport never refunds or releases permits.
    // A late result is observed but can never start a socket after this deadline.
    const permit = await new Promise((resolve, reject) => {
        let settled = false, timer;
        function finish(code, value) {
            if (settled) return;
            if (!code && Date.now() >= admissionDeadline) code = 'ADMISSION_TIMEOUT';
            settled = true; clearTimeout(timer); signal?.removeEventListener('abort', aborted);
            if (code) { admissionController.abort(); reject(error(code)); } else resolve(value);
        }
        function aborted() { finish('CONNECTOR_ABORTED'); }
        signal?.addEventListener('abort', aborted, { once: true });
        timer = setTimeout(() => finish('ADMISSION_TIMEOUT'), LIMITS.admissionMs);
        if (signal?.aborted) { aborted(); return; }
        try {
            Promise.resolve(authorizeDispatch({ signal: admissionController.signal })).then(
                value => finish(null, value), () => finish('DISPATCH_DENIED'));
        } catch (_) { finish('DISPATCH_DENIED'); }
    });
    if (signal?.aborted || admissionController.signal.aborted) { admissionController.abort(); throw error('CONNECTOR_ABORTED'); }
    if (Date.now() >= admissionDeadline) { admissionController.abort(); throw error('ADMISSION_TIMEOUT'); }
    check(permit && permit.sendPermit === true && typeof permit.reservationId === 'string' && permit.reservationId.length > 0 && permit.reservationId.length <= 256, 'DISPATCH_DENIED');
    // No socket, DNS or provider I/O exists above this admission boundary.
    const Socket = WebSocketImpl || require('ws');
    let socket;
    try { socket = new Socket(ENDPOINT, { headers: { 'x-goog-api-key': apiKey }, perMessageDeflate: false,
        maxPayload: LIMITS.frameBytes, handshakeTimeout: LIMITS.setupMs, followRedirects: false }); }
    catch (_) { throw error('PROVIDER_CONNECT_FAILED'); }
    let closed = false, ready = false, opened = false, setupTimer, sessionTimer;
    let inputBytes = 0, outputBytes = 0, queuedBytes = 0, utterance = null, ended = false, endPromise;
    const queue = []; let active = null;
    const inbound = []; let inboundActive = null, inboundBytes = 0, inboundReadPaused = false, pumpingInbound = false;
    let resolveReady, rejectReady;
    const readiness = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    function close(reason = 'CONNECTOR_CLOSED') {
        if (closed) return;
        closed = true; clearTimeout(setupTimer); clearTimeout(sessionTimer);
        signal?.removeEventListener('abort', abortConnection);
        admissionController.abort();
        rejectReady(error(reason));
        if (active) { active.reject(error(reason)); active = null; }
        for (const job of queue.splice(0)) job.reject(error(reason));
        queuedBytes = 0;
        inbound.length = 0; inboundActive = null; inboundBytes = 0;
        // Terminate stops I/O immediately even if a peer never completes close.
        try { socket.terminate(); } catch (_) { /* no provider error details escape */ }
    }
    function fail(code) {
        if (closed) return;
        close(code);
        try { Promise.resolve(onError(error(code))).catch(() => {}); } catch (_) { /* callback cannot prevent cleanup */ }
    }
    function pump() {
        if (closed || active || !queue.length) return;
        active = queue.shift(); const job = active;
        try {
            socket.send(job.wire, sendError => {
                if (closed || active !== job) return;
                if (sendError) { fail('PROVIDER_SEND_FAILED'); return; }
                active = null; queuedBytes -= job.size; job.resolve(); pump();
            });
        } catch (_) { fail('PROVIDER_SEND_FAILED'); }
    }
    function enqueue(messages) {
        if (closed) return Promise.reject(error('CONNECTOR_CLOSED'));
        const wires = messages.map(message => JSON.stringify(message));
        const sizes = wires.map(wire => Buffer.byteLength(wire));
        if (sizes.some(size => size > LIMITS.frameBytes) || queuedBytes + sizes.reduce((a, b) => a + b, 0) > LIMITS.queueBytes ||
            queue.length + (active ? 1 : 0) + wires.length > LIMITS.queueMessages || socket.bufferedAmount > LIMITS.queueBytes) {
            fail('INPUT_QUEUE_LIMIT'); return Promise.reject(error('INPUT_QUEUE_LIMIT'));
        }
        const pending = wires.map((wire, index) => new Promise((resolve, reject) => {
            queuedBytes += sizes[index]; queue.push({ wire, size: sizes[index], resolve, reject });
        }));
        pump(); return Promise.all(pending).then(() => undefined);
    }
    function pumpInbound() {
        if (closed || pumpingInbound) return;
        pumpingInbound = true;
        try {
            while (!closed && !inboundActive && inbound.length) {
                const job = inboundActive = inbound.shift();
                const complete = () => {
                    if (closed || inboundActive !== job) return;
                    inboundActive = null; inboundBytes -= job.size;
                    if (job.message.goAway !== undefined) { fail('PROVIDER_GO_AWAY'); return; }
                    pumpInbound();
                };
                const result = onMessage(job.message);
                if (result && typeof result.then === 'function') {
                    // Pausing ws only stops new socket reads: its receiver can
                    // still emit buffered frames. inboundActive also gates their
                    // delivery, and the unchanged inbound limits bound residuals.
                    Promise.resolve(result).then(complete, () => fail('PROVIDER_CALLBACK_FAILED'));
                    if (!closed && !inboundReadPaused) { inboundReadPaused = true; socket.pause(); }
                } else complete();
            }
            // Drain buffered callbacks first. A second pending callback must not
            // briefly restart reads, nor may late completion restart closed I/O.
            if (!closed && !inboundActive && !inbound.length && inboundReadPaused) { inboundReadPaused = false; socket.resume(); }
        } catch (_) { fail('PROVIDER_CALLBACK_FAILED'); }
        finally { pumpingInbound = false; }
    }
    socket.on('open', () => {
        if (closed) return;
        if (opened) { fail('INVALID_PROVIDER_STATE'); return; }
        opened = true;
        enqueue([{ setup: { model: MODEL, generationConfig: { maxOutputTokens, responseModalities: ['AUDIO'], thinkingConfig: { thinkingLevel: 'MINIMAL' } },
            systemInstruction: { parts: [{ text: contextText }] },
            realtimeInputConfig: { automaticActivityDetection: { disabled: true }, activityHandling: 'NO_INTERRUPTION', turnCoverage: 'TURN_INCLUDES_ONLY_ACTIVITY' },
            inputAudioTranscription: {}, outputAudioTranscription: {} } }]).catch(() => {});
    });
    socket.on('message', data => {
        if (closed) return;
        try {
            check(typeof data === 'string' || Buffer.isBuffer(data), 'INVALID_PROVIDER_MESSAGE');
            const size = Buffer.byteLength(data); outputBytes += size;
            check(size <= LIMITS.frameBytes && outputBytes <= LIMITS.outputBytes, 'PROVIDER_OUTPUT_LIMIT');
            // Gemini emits UTF-8 JSON in binary WebSocket frames as well as
            // text frames. Binary framing is not raw PCM; strict UTF-8 and the
            // same bounded JSON schema remain mandatory.
            const wire = typeof data === 'string' ? data : new TextDecoder('utf-8', { fatal: true }).decode(data);
            const message = validateMessage(JSON.parse(wire));
            if (!ready) {
                check(opened && message.setupComplete !== undefined, 'INVALID_PROVIDER_STATE');
                ready = true; clearTimeout(setupTimer);
            } else check(message.setupComplete === undefined, 'INVALID_PROVIDER_STATE');
            // Some native sessions emit this control frame without requesting
            // resumption. Validate it, then discard its capability entirely.
            // Never forward, persist, or use it to reconnect automatically.
            if (message.sessionResumptionUpdate !== undefined) { delete message.sessionResumptionUpdate; if (!Object.keys(message).length) return; }
            check(inboundBytes + size <= LIMITS.queueBytes && inbound.length + (inboundActive ? 1 : 0) < LIMITS.queueMessages, 'PROVIDER_QUEUE_LIMIT');
            inboundBytes += size; inbound.push({ message, size }); pumpInbound();
            resolveReady();
        } catch (failure) {
            fail(['PROVIDER_OUTPUT_LIMIT', 'PROVIDER_QUEUE_LIMIT', 'INVALID_PROVIDER_STATE'].includes(failure.code) ? failure.code : 'INVALID_PROVIDER_MESSAGE');
        }
    });
    socket.on('error', () => fail('PROVIDER_CONNECTION_ERROR'));
    socket.on('close', () => fail('PROVIDER_CLOSED'));
    setupTimer = setTimeout(() => fail('PROVIDER_SETUP_TIMEOUT'), LIMITS.setupMs);
    sessionTimer = setTimeout(() => fail('PROVIDER_SESSION_TIMEOUT'), LIMITS.sessionMs);
    function abortConnection() { fail('CONNECTOR_ABORTED'); }
    signal?.addEventListener('abort', abortConnection, { once: true });
    if (signal?.aborted) abortConnection();
    await readiness;
    return Object.freeze({
        reservationId: permit.reservationId,
        provenance: PROVENANCE,
        sendAudio({ bytes, sampleRate, utteranceId } = {}) {
            if (closed) return Promise.reject(error('CONNECTOR_CLOSED'));
            if (ended) return Promise.reject(error('INPUT_ENDED'));
            if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength % 2 || bytes.byteLength > LIMITS.audioFrameBytes || sampleRate !== 16000 ||
                typeof utteranceId !== 'string' || !utteranceId.length || utteranceId.length > 128 || (utterance !== null && utterance !== utteranceId)) {
                fail('INVALID_INPUT_AUDIO'); return Promise.reject(error('INVALID_INPUT_AUDIO'));
            }
            if (inputBytes + bytes.byteLength > maxInputAudioBytes) { fail('INPUT_AUDIO_LIMIT'); return Promise.reject(error('INPUT_AUDIO_LIMIT')); }
            const messages = [];
            if (utterance === null) { utterance = utteranceId; messages.push({ realtimeInput: { activityStart: {} } }); }
            inputBytes += bytes.byteLength;
            messages.push({ realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: Buffer.from(bytes).toString('base64') } } });
            return enqueue(messages);
        },
        endInput() {
            if (endPromise) return endPromise;
            if (closed) return Promise.reject(error('CONNECTOR_CLOSED'));
            if (utterance === null) return Promise.reject(error('EMPTY_INPUT'));
            ended = true; endPromise = enqueue([{ realtimeInput: { activityEnd: {} } }]); return endPromise;
        },
        close: () => close()
    });
}
module.exports = { createGeminiLiveConnector, ENDPOINT, MODEL, LIMITS, PROVENANCE };
