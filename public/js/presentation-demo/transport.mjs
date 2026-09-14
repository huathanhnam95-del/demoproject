import { authHeaders, authToken } from './auth.mjs';

export class PresentationTransport {
  constructor(identity, { failoverOrigins = [] } = {}) {
    this.identity = identity; this.base = '/api/presentation-demo';
    const configured = [window.location.origin, ...failoverOrigins].map(value => String(value || '').replace(/\/$/, '')).filter(Boolean);
    this.origins = [...new Set(configured)]; this.originIndex = 0;
    this.connection = null; this.socket = null; this.socketWaiters = new Map(); this.socketTicket = null; this.socketReplaceExisting = false; this.socketRoomId = null; this.reconnectPromise = null; this.intentionalClose = false; this.state = 'disconnected'; this.onState = null; this.onReconnect = null;
  }

  get apiOrigin() { return this.origins[this.originIndex] || ''; }
  advanceOrigin() { if (this.origins.length > 1) this.originIndex = (this.originIndex + 1) % this.origins.length; }

  setState(state) { this.state = state; this.onState?.(state); }

  reconnectWithLock() {
    if (!this.reconnectPromise) this.reconnectPromise = this.reconnect().finally(() => { this.reconnectPromise = null; });
    return this.reconnectPromise;
  }

  async request(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(await authHeaders(this.identity)), ...(options.headers || {}) };
    let response;
    try { response = await fetch(`${this.apiOrigin}${this.base}${path}`, { ...options, headers, cache: 'no-store' }); }
    catch (error) {
      if (this.origins.length < 2) throw error;
      this.advanceOrigin(); response = await fetch(`${this.apiOrigin}${this.base}${path}`, { ...options, headers, cache: 'no-store' });
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/pdf')) {
      if (!response.ok) throw Object.assign(new Error('PDF export failed.'), { code: 'EXPORT_FAILED', status: response.status });
      return response.blob();
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) throw Object.assign(new Error(body?.error?.message || body?.message || 'Online room request failed.'), { code: body?.error?.code || 'REQUEST_FAILED', status: response.status });
    return body.data;
  }

  createRoom() { return this.request('/rooms', { method: 'POST', body: JSON.stringify({ operationId: crypto.randomUUID() }) }); }
  rooms() { return this.request('/rooms'); }
  join(code) { return this.request('/join', { method: 'POST', body: JSON.stringify({ code, operationId: crypto.randomUUID() }) }); }
  room(roomId) { return this.request(`/rooms/${encodeURIComponent(roomId)}`); }
  bootstrap(roomId) { return this.request(`/rooms/${encodeURIComponent(roomId)}/bootstrap`, { method: 'POST', body: '{}' }); }
  ticket(roomId) { return this.request(`/rooms/${encodeURIComponent(roomId)}/ticket`, { method: 'POST', body: '{}' }); }
  async connect(ticket, replaceExisting = false, { automatic = false } = {}) {
    if (this.identity?.local) return this.request('/connect', { method: 'POST', body: JSON.stringify({ ticket, replaceExisting }) });
    const token = await authToken(this.identity);
    if (!token || !window.WebSocket) throw Object.assign(new Error('Authenticated WebSocket is unavailable.'), { code: 'WS_UNAVAILABLE' });
    const ticketValue = ticket?.ticket || ticket;
    if (!automatic) { this.socketTicket = ticket; this.socketRoomId = ticket?.roomId || this.socketRoomId; this.socketReplaceExisting = replaceExisting; this.intentionalClose = false; }
    const target = new URL(this.apiOrigin || window.location.origin, window.location.href);
    const scheme = target.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${target.host}/api/presentation-demo/ws`, [`bearer.${token}`]);
    this.socket = socket;
    this.setState('connecting');
    socket.addEventListener('message', event => {
      try {
        const message = JSON.parse(event.data);
        const waiter = this.socketWaiters.get(message.data?.requestId);
        if (!waiter) return;
        this.socketWaiters.delete(message.data.requestId);
        if (message.type === 'error') waiter.reject(Object.assign(new Error(message.data.message), { code: message.data.code }));
        else waiter.resolve(message.data);
      } catch (_) { /* malformed gateway frames are ignored */ }
    });
    socket.addEventListener('close', () => this.handleSocketClose(socket));
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => { try { socket.close(); } catch (_) {} reject(Object.assign(new Error('Authenticated WebSocket connection failed.'), { code: 'WS_CONNECT_FAILED' })); }, { once: true }); });
    const connection = await this.socketRequest('connect', { ticket: ticketValue, replaceExisting });
    if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) throw Object.assign(new Error('The authenticated WebSocket closed during connection setup.'), { code: 'WS_DISCONNECTED' });
    this.connection = connection;
    if (!automatic) this.setState('connected');
    return connection;
  }

  handleSocketClose(socket) {
    if (socket !== this.socket) return;
    this.socket = null; this.connection = null;
    for (const waiter of this.socketWaiters.values()) waiter.reject(Object.assign(new Error('The room connection closed.'), { code: 'WS_DISCONNECTED' }));
    this.socketWaiters.clear();
    if (this.intentionalClose || !this.socketRoomId) { this.setState('disconnected'); return; }
    this.setState('reconnecting');
    this.reconnectWithLock();
  }

  async reconnect() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await new Promise(resolve => window.setTimeout(resolve, Math.min(1000 * (attempt + 1), 4000)));
        const ticket = await this.ticket(this.socketRoomId);
        const connection = await this.connect(ticket, true, { automatic: true });
        this.socketTicket = ticket; this.socketReplaceExisting = true; this.connection = connection;
        await this.onReconnect?.(connection);
        this.setState('connected');
        return connection;
      } catch (error) { if (attempt === 4) { this.setState('disconnected'); throw error; } }
    }
    throw Object.assign(new Error('The room connection could not be restored.'), { code: 'WS_RECONNECT_FAILED' });
  }
  async socketRequest(type, payload = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || (type !== 'connect' && !this.connection)) {
      if (!this.socketRoomId || this.intentionalClose) throw Object.assign(new Error('WebSocket is not connected.'), { code: 'WS_NOT_CONNECTED' });
      await this.reconnectWithLock();
    }
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw Object.assign(new Error('WebSocket is not connected.'), { code: 'WS_NOT_CONNECTED' });
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => { this.socketWaiters.delete(requestId); reject(Object.assign(new Error('The room request timed out.'), { code: 'WS_REQUEST_TIMEOUT' })); }, 10000);
      this.socketWaiters.set(requestId, { resolve: value => { window.clearTimeout(timer); resolve(value); }, reject: error => { window.clearTimeout(timer); reject(error); } });
      this.socket.send(JSON.stringify({ type, requestId, ...payload }));
    });
  }
  heartbeat(connectionId) { return this.identity?.local ? this.request('/heartbeat', { method: 'POST', body: JSON.stringify({ connectionId }) }) : this.socketRequest('heartbeat', { connectionId }); }
  input(connectionId, command) { return this.identity?.local ? this.request('/input', { method: 'POST', body: JSON.stringify({ connectionId, command }) }) : this.socketRequest('input', { connectionId, command }); }
  disconnect(connectionId) { return this.identity?.local ? this.request('/disconnect', { method: 'POST', body: JSON.stringify({ connectionId }) }) : this.socketRequest('disconnect', { connectionId }); }
  readNotes(roomId) { return this.request(`/rooms/${encodeURIComponent(roomId)}/notes/${encodeURIComponent(this.identity.uid)}`); }
  saveNote(roomId, page) { return this.request(`/rooms/${encodeURIComponent(roomId)}/notes/${encodeURIComponent(this.identity.uid)}`, { method: 'PUT', body: JSON.stringify(page) }); }
  endRoom(roomId) { return this.request(`/rooms/${encodeURIComponent(roomId)}/end`, { method: 'POST', body: JSON.stringify({ reason: 'explicit' }) }); }
  exportPdf(roomId) { return this.request(`/rooms/${encodeURIComponent(roomId)}/export.pdf`); }
  readArchive(roomId) { return this.request(`/rooms/${encodeURIComponent(roomId)}/archive`); }

  close() { this.intentionalClose = true; if (this.socket) this.socket.close(); this.socket = null; this.connection = null; this.setState('disconnected'); }
}
