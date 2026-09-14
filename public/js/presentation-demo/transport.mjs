import { authHeaders, authToken } from './auth.mjs';

export class PresentationTransport {
  constructor(identity) { this.identity = identity; this.base = '/api/presentation-demo'; this.connection = null; this.socket = null; this.socketWaiters = new Map(); }

  async request(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(await authHeaders(this.identity)), ...(options.headers || {}) };
    const response = await fetch(`${this.base}${path}`, { ...options, headers, cache: 'no-store' });
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
  async connect(ticket, replaceExisting = false) {
    if (this.identity?.local) return this.request('/connect', { method: 'POST', body: JSON.stringify({ ticket, replaceExisting }) });
    const token = await authToken(this.identity);
    if (!token || !window.WebSocket) throw Object.assign(new Error('Authenticated WebSocket is unavailable.'), { code: 'WS_UNAVAILABLE' });
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    this.socket = new WebSocket(`${scheme}://${window.location.host}/api/presentation-demo/ws`, [`bearer.${token}`]);
    this.socket.addEventListener('message', event => {
      try {
        const message = JSON.parse(event.data);
        const waiter = this.socketWaiters.get(message.data?.requestId);
        if (!waiter) return;
        this.socketWaiters.delete(message.data.requestId);
        if (message.type === 'error') waiter.reject(Object.assign(new Error(message.data.message), { code: message.data.code }));
        else waiter.resolve(message.data);
      } catch (_) { /* malformed gateway frames are ignored */ }
    });
    await new Promise((resolve, reject) => { this.socket.addEventListener('open', resolve, { once: true }); this.socket.addEventListener('error', () => reject(Object.assign(new Error('Authenticated WebSocket connection failed.'), { code: 'WS_CONNECT_FAILED' })), { once: true }); });
    return this.socketRequest('connect', { ticket, replaceExisting });
  }
  socketRequest(type, payload = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw Object.assign(new Error('WebSocket is not connected.'), { code: 'WS_NOT_CONNECTED' });
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => { this.socketWaiters.set(requestId, { resolve, reject }); this.socket.send(JSON.stringify({ type, requestId, ...payload })); });
  }
  heartbeat(connectionId) { return this.identity?.local ? this.request('/heartbeat', { method: 'POST', body: JSON.stringify({ connectionId }) }) : this.socketRequest('heartbeat', { connectionId }); }
  input(connectionId, command) { return this.identity?.local ? this.request('/input', { method: 'POST', body: JSON.stringify({ connectionId, command }) }) : this.socketRequest('input', { connectionId, command }); }
  disconnect(connectionId) { return this.identity?.local ? this.request('/disconnect', { method: 'POST', body: JSON.stringify({ connectionId }) }) : this.socketRequest('disconnect', { connectionId }); }
  readNotes(roomId) { return this.request(`/rooms/${encodeURIComponent(roomId)}/notes/${encodeURIComponent(this.identity.uid)}`); }
  saveNote(roomId, page) { return this.request(`/rooms/${encodeURIComponent(roomId)}/notes/${encodeURIComponent(this.identity.uid)}`, { method: 'PUT', body: JSON.stringify(page) }); }
  endRoom(roomId) { return this.request(`/rooms/${encodeURIComponent(roomId)}/end`, { method: 'POST', body: JSON.stringify({ reason: 'explicit' }) }); }
  exportPdf(roomId) { return this.request(`/rooms/${encodeURIComponent(roomId)}/export.pdf`); }
  readArchive(roomId) { return this.request(`/rooms/${encodeURIComponent(roomId)}/archive`); }
}
