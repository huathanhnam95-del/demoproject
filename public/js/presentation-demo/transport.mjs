import { authHeaders, authToken } from './auth.mjs';

export class PresentationTransport {
  constructor(identity, { failoverOrigins = [] } = {}) {
    this.identity = identity; this.base = '/api/presentation-demo';
    this.realtimeOrigin = identity?.realtimeOrigin || null;
    if (this.realtimeOrigin) {
      const origin = new URL(this.realtimeOrigin);
      if (origin.protocol !== 'https:' || origin.origin !== this.realtimeOrigin) throw Error('The realtime origin must be an exact HTTPS origin.');
    }
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
    const target = new URL(this.realtimeOrigin || this.apiOrigin || window.location.origin, window.location.href);
    const scheme = target.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${target.host}/api/presentation-demo/ws`, [`bearer.${token}`]);
    this.socket = socket;
    this.setState('connecting');
    socket.addEventListener('message', event => {
      if (this.socket !== socket) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'replaced') { this.intentionalClose = true; this.connection = null; this.setState('replaced'); return; }
        if (message.type === 'snapshot' && message.data?.snapshot) { this.onSnapshot?.(message.data.snapshot); return; }
        const waiter = this.socketWaiters.get(message.data?.requestId);
        if (!waiter) return;
        this.socketWaiters.delete(message.data.requestId);
        if (message.type === 'error') waiter.reject(Object.assign(new Error(message.data.message), { code: message.data.code }));
        else waiter.resolve(message.data);
      } catch (_) { /* malformed gateway frames are ignored */ }
    });
    socket.addEventListener('close', () => this.handleSocketClose(socket));
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => { try { socket.close(); } catch (_) {} reject(Object.assign(new Error('Authenticated WebSocket connection failed.'), { code: 'WS_CONNECT_FAILED' })); }, { once: true }); });
    const connection = await this.socketRequest('connect', { ticket: ticketValue, replaceExisting, protocolVersion: 2, contentVersion: 'bel-working-as-equals-1' });
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
    if (this.intentionalClose || !this.socketRoomId) { if (this.state !== 'replaced') this.setState('disconnected'); return; }
    this.setState('reconnecting');
      this.reconnectWithLock().catch(() => {});
  }

  async reconnect() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await new Promise(resolve => window.setTimeout(resolve, Math.min(1000 * (attempt + 1), 4000)));
        if (this.intentionalClose) return null;
        const ticket = await this.ticket(this.socketRoomId);
        if (this.intentionalClose) return null;
        const connection = await this.connect(ticket, true, { automatic: true });
        this.socketTicket = ticket; this.socketReplaceExisting = true; this.connection = connection;
        await this.onReconnect?.(connection);
        this.setState('connected');
        return connection;
      } catch (error) { if (attempt === 4) { this.setState('disconnected'); throw error; } }
    }
    throw Object.assign(new Error('The room connection could not be restored.'), { code: 'WS_RECONNECT_FAILED' });
  }
  async socketRequest(type, payload = {}, requestId = crypto.randomUUID()) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || (type !== 'connect' && !this.connection)) {
      if (!this.socketRoomId || this.intentionalClose) throw Object.assign(new Error('WebSocket is not connected.'), { code: 'WS_NOT_CONNECTED' });
      await this.reconnectWithLock();
    }
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw Object.assign(new Error('WebSocket is not connected.'), { code: 'WS_NOT_CONNECTED' });
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => { this.socketWaiters.delete(requestId); reject(Object.assign(new Error('The room request timed out. Retry the same operation.'), { code: 'WS_REQUEST_TIMEOUT' })); }, 22000);
      this.socketWaiters.set(requestId, { resolve: value => { window.clearTimeout(timer); resolve(value); }, reject: error => { window.clearTimeout(timer); reject(error); } });
      this.socket.send(JSON.stringify({ type, requestId, ...payload }));
    });
  }
  heartbeat(connectionId) { return this.identity?.local ? this.request('/heartbeat', { method: 'POST', body: JSON.stringify({ connectionId }) }) : this.socketRequest('heartbeat', { connectionId }); }
  input(connectionId, command, commandId = crypto.randomUUID()) { return this.identity?.local ? this.request('/input', { method: 'POST', body: JSON.stringify({ connectionId, command, commandId }) }) : this.socketRequest('input', { connectionId, command }, commandId); }
  disconnect(connectionId) { return this.identity?.local ? this.request('/disconnect', { method: 'POST', body: JSON.stringify({ connectionId }) }) : this.socketRequest('disconnect', { connectionId }); }
  readNotes(roomId) { return this.request(`/rooms/${encodeURIComponent(roomId)}/notes/${encodeURIComponent(this.identity.uid)}`); }
  saveNote(roomId, page) { return this.request(`/rooms/${encodeURIComponent(roomId)}/notes/${encodeURIComponent(this.identity.uid)}`, { method: 'PUT', body: JSON.stringify(page) }); }
  endRoom(roomId) { return this.request(`/rooms/${encodeURIComponent(roomId)}/end`, { method: 'POST', body: JSON.stringify({ reason: 'explicit' }) }); }
  async exportPdf(roomId) {
    const deadline = performance.now() + 12000;
    let terminal = false, retryDelay = 250;
    for (;;) {
      try { return await this.request(`/rooms/${encodeURIComponent(roomId)}/export.pdf`); }
      catch (error) {
        if (error.code !== 'ARCHIVE_NOT_FOUND') throw error;
        // The terminal snapshot can arrive before End finishes archiving.
        // Retry this read briefly; never retry authorization failures or save
        // a local draft while waiting for the retained saved-note snapshot.
        if (!terminal) terminal = (await this.room(roomId)).lifecycle === 'ended';
        if (!terminal) throw error;
        const remaining = deadline - performance.now();
        if (remaining <= 0) throw Object.assign(new Error('Saved notes are still being finalized. Please try the export again shortly.'), { code: 'ARCHIVE_PENDING' });
        await new Promise(resolve => window.setTimeout(resolve, Math.min(retryDelay, remaining)));
        retryDelay = Math.min(Math.ceil(retryDelay * 1.5), 1000);
      }
    }
  }
  readArchive(roomId) { return this.request(`/rooms/${encodeURIComponent(roomId)}/archive`); }

  close() { this.intentionalClose = true; if (this.socket) this.socket.close(); this.socket = null; this.connection = null; this.setState('disconnected'); }
}
