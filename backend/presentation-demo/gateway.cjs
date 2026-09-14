'use strict';

const { WebSocketServer } = require('ws');

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

function installWebSocketGateway(server, { connections, authenticate, resolveIdentity = async identity => identity, path = '/api/presentation-demo/ws', origin = null, maxMessageBytes = 120000 } = {}) {
    if (!server || !connections || typeof authenticate !== 'function') throw new TypeError('server, connections and authenticate are required');
    const wss = new WebSocketServer({ noServer: true, maxPayload: maxMessageBytes });
    server.on('upgrade', async (request, socket, head) => {
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
        async function currentIdentity() {
            const identity = await authenticate(token, request);
            return resolveIdentity(identity, request);
        }
        function send(type, data, requestId = null) {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type, data: { ...(data || {}), ...(requestId ? { requestId } : {}) } }));
        }
        function fail(error) {
            send('error', { code: error?.code || 'PRESENTATION_DEMO_ERROR', message: error?.message || 'Online room request failed.' });
        }
        ws.on('message', async raw => {
            if (closed || raw.length > maxMessageBytes) return fail(Object.assign(new Error('Message too large.'), { code: 'PAYLOAD_TOO_LARGE' }));
            let message;
            try { message = JSON.parse(raw.toString('utf8')); } catch (_) { return fail(Object.assign(new Error('Invalid message.'), { code: 'PAYLOAD_INVALID' })); }
            try {
                const identity = await currentIdentity();
                if (message.type === 'connect') {
                    if (session) throw Object.assign(new Error('Already connected.'), { code: 'CONNECTION_EXISTS' });
                    session = await connections.open(identity, message.ticket, { replaceExisting: message.replaceExisting === true });
                    return send('connected', { connectionId: session.connectionId, roomId: session.roomId, seatId: session.seatId, role: session.role, generation: session.generation, snapshot: session.snapshot }, message.requestId);
                }
                if (!session) throw Object.assign(new Error('Connect the socket first.'), { code: 'NOT_CONNECTED' });
                if (message.type === 'heartbeat') return send('heartbeat', await connections.heartbeat(session, identity), message.requestId);
                if (message.type === 'input') return send('input', await connections.input(session, message.command, identity, { commandId: message.requestId }), message.requestId);
                if (message.type === 'disconnect') {
                    const result = await connections.close(session, identity); session = null; return send('disconnected', result, message.requestId);
                }
                throw Object.assign(new Error('Unknown gateway message.'), { code: 'PAYLOAD_INVALID' });
            } catch (error) { send('error', { code: error?.code || 'PRESENTATION_DEMO_ERROR', message: error?.message || 'Online room request failed.' }, message.requestId); }
        });
        ws.on('close', async () => {
            closed = true;
            if (session) { try { await connections.close(session, initialIdentity); } catch (_) { /* lease sweep owns recovery */ } session = null; }
        });
    });
    return { wss, close: () => new Promise(resolve => wss.close(() => resolve())) };
}

module.exports = { installWebSocketGateway, tokenFromProtocols };
