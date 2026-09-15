'use strict';

const { WebSocketServer } = require('ws');
const { PROTOCOL_VERSION, CONTENT_VERSION } = require('../../functions/src/crm/presentation-demo/contracts.cjs');

function tokenFromProtocols(value) {
    const protocols = String(value || '').split(',').map(item => item.trim()).filter(Boolean);
    const bearer = protocols.find(item => item.startsWith('bearer.'));
    return bearer ? bearer.slice('bearer.'.length) : null;
}

function rejectUpgrade(socket, status, message) {
    socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
}

function originAllowed(request, configuredOrigin) {
    const requestOrigin = String(request.headers.origin || '').trim();
    if (!requestOrigin) return true;
    const configured = Array.isArray(configuredOrigin) ? configuredOrigin.filter(Boolean) : configuredOrigin ? [configuredOrigin] : [];
    if (configured.length) return configured.includes(requestOrigin);
    const expected = `${request.socket.encrypted ? 'https' : 'http'}://${request.headers.host}`;
    return requestOrigin === expected;
}

function installWebSocketGateway(server, { connections, authenticate, resolveIdentity = async identity => identity, path = '/api/presentation-demo/ws', origin = null, maxMessageBytes = 120000, enabled = () => true } = {}) {
    if (!server || !connections || typeof authenticate !== 'function') throw new TypeError('server, connections and authenticate are required');
    const wss = new WebSocketServer({ noServer: true, maxPayload: maxMessageBytes });
    server.on('upgrade', async (request, socket, head) => {
        if (!enabled()) return rejectUpgrade(socket, 503, 'Service Unavailable');
        try {
            const url = new URL(request.url, 'http://presentation-demo.invalid');
            if (url.pathname !== path) return rejectUpgrade(socket, 404, 'Not Found');
            if (!originAllowed(request, origin)) return rejectUpgrade(socket, 403, 'Forbidden');
            const token = tokenFromProtocols(request.headers['sec-websocket-protocol']);
            if (!token) return rejectUpgrade(socket, 401, 'Unauthorized');
            const identity = await authenticate(token, request);
            if (!identity) return rejectUpgrade(socket, 401, 'Unauthorized');
            wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request, token, identity));
        } catch (_) {
            rejectUpgrade(socket, 401, 'Unauthorized');
        }
    });
    wss.on('connection', (ws, request, token, initialIdentity) => {
        let session = null;
        let closed = false;
        let unsubscribe = () => {};
        let tail = Promise.resolve(), pendingCount = 0, authAt = 0, cachedIdentity = null;
        const admissionTimer = setTimeout(() => { if (!session) ws.close(4401, 'Ticket required within five seconds'); }, 5000);
        admissionTimer.unref();
        function revoke(code) { unsubscribe(); unsubscribe = () => {}; send('replaced', { code }); ws.close(4409, code); }
        async function currentIdentity(force = false) {
            if (!enabled()) throw Object.assign(new Error('Online rooms are disabled.'), { code: 'FEATURE_DISABLED' });
            if (!force && cachedIdentity && Date.now() - authAt < 55000) return cachedIdentity;
            const identity = await authenticate(token, request);
            cachedIdentity = await resolveIdentity(identity, request);
            if (session) connections.validate(session, cachedIdentity);
            authAt = Date.now();
            return cachedIdentity;
        }
        const authTimer = setInterval(() => { if (session) currentIdentity(true).catch(error => revoke(error.code || 'UNAUTHORIZED')); }, 55000);
        authTimer.unref();
        function send(type, data, requestId = null) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type, data: { ...(data || {}), ...(requestId ? { requestId } : {}) } }));
        }
        function fail(error) {
            send('error', { code: error?.code || 'PRESENTATION_DEMO_ERROR', message: error?.message || 'Online room request failed.' });
        }
        async function handleMessage(raw) {
            if (closed || raw.length > maxMessageBytes) return fail(Object.assign(new Error('Message too large.'), { code: 'PAYLOAD_TOO_LARGE' }));
            let message;
            try { message = JSON.parse(raw.toString('utf8')); } catch (_) { return fail(Object.assign(new Error('Invalid message.'), { code: 'PAYLOAD_INVALID' })); }
            try {
                if (message.type === 'connect') {
                    if (message.protocolVersion !== PROTOCOL_VERSION || message.contentVersion !== CONTENT_VERSION) throw Object.assign(new Error('Reload this page to use the current room version.'), { code: 'PROTOCOL_MISMATCH' });
                    if (typeof message.ticket !== 'string' || !message.ticket) throw Object.assign(new Error('A connection ticket is required.'), { code: 'TICKET_INVALID' });
                    // Admission bounds the arrival of credentials. A valid request may
                    // then wait for the previous authority's 15-second lease to expire.
                    clearTimeout(admissionTimer);
                }
                const identity = await currentIdentity(message.type === 'connect' || session?.role === 'presenter' && message.command?.type !== 'move');
                if (message.type === 'connect') {
                    if (message.protocolVersion !== PROTOCOL_VERSION || message.contentVersion !== CONTENT_VERSION) throw Object.assign(new Error('Reload this page to use the current room version.'), { code: 'PROTOCOL_MISMATCH' });
                    if (session) throw Object.assign(new Error('Already connected.'), { code: 'CONNECTION_EXISTS' });
                    session = await connections.open(identity, message.ticket, { replaceExisting: message.replaceExisting === true });
                    if (closed) return;
                    clearTimeout(admissionTimer);
                    unsubscribe = connections.subscribe(session, snapshot => send('snapshot', { snapshot }), revoke);
                    return send('connected', { connectionId: session.connectionId, roomId: session.roomId, seatId: session.seatId, role: session.role, generation: session.generation, snapshot: session.snapshot }, message.requestId);
                }
                if (!session) throw Object.assign(new Error('Connect the socket first.'), { code: 'NOT_CONNECTED' });
                if (message.type === 'heartbeat') return send('heartbeat', await connections.heartbeat(session, identity), message.requestId);
                if (message.type === 'input') return send('input', await connections.input(session, message.command, identity, { commandId: message.requestId }), message.requestId);
                if (message.type === 'disconnect') {
                    unsubscribe(); unsubscribe = () => {};
                    const result = await connections.close(session, identity); session = null; return send('disconnected', result, message.requestId);
                }
                throw Object.assign(new Error('Unknown gateway message.'), { code: 'PAYLOAD_INVALID' });
            } catch (error) {
                send('error', { code: error?.code || 'PRESENTATION_DEMO_ERROR', message: error?.message || 'Online room request failed.' }, message.requestId);
                if (message.type === 'connect') ws.close(4401, 'Connection rejected');
                else if (['FEATURE_DISABLED', 'SERVICE_RECOVERY', 'FORBIDDEN', 'UNAUTHORIZED', 'PRESENTER_ONLY', 'ACCOUNT_DISABLED', 'ACCOUNT_INACTIVE', 'CRM_ELIGIBILITY_REQUIRED', 'CONNECTION_REPLACED', 'STALE_CONNECTION'].includes(error?.code)) revoke(error.code);
            }
        }
        ws.on('message', raw => {
            if (++pendingCount > 32) { pendingCount--; fail(Object.assign(new Error('Too many pending messages.'), { code: 'RATE_LIMITED' })); ws.close(4429, 'Queue limit'); return; }
            tail = tail.then(() => handleMessage(raw)).catch(fail).finally(() => { pendingCount--; });
        });
        ws.on('close', async () => {
            closed = true;
            clearTimeout(admissionTimer); clearInterval(authTimer);
            unsubscribe();
            await tail;
            unsubscribe();
            if (session) { try { await connections.close(session, initialIdentity); } catch (_) { /* lease sweep owns recovery */ } session = null; }
        });
    });
    return { wss, close: () => new Promise(resolve => { for (const socket of wss.clients) socket.terminate(); wss.close(() => resolve()); }) };
}

module.exports = { installWebSocketGateway, tokenFromProtocols };
