import { authHeaders } from './auth.mjs';

export class PresentationTransport {
  constructor(identity) { this.identity = identity; this.base = '/api/presentation-demo'; this.connection = null; }

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
  join(code) { return this.request('/join', { method: 'POST', body: JSON.stringify({ code, operationId: crypto.randomUUID() }) }); }
  room(roomId) { return this.request(`/rooms/${encodeURIComponent(roomId)}`); }
  bootstrap(roomId) { return this.request(`/rooms/${encodeURIComponent(roomId)}/bootstrap`, { method: 'POST', body: '{}' }); }
  ticket(roomId) { return this.request(`/rooms/${encodeURIComponent(roomId)}/ticket`, { method: 'POST', body: '{}' }); }
  connect(ticket, replaceExisting = false) { return this.request('/connect', { method: 'POST', body: JSON.stringify({ ticket, replaceExisting }) }); }
  heartbeat(connectionId) { return this.request('/heartbeat', { method: 'POST', body: JSON.stringify({ connectionId }) }); }
  input(connectionId, command) { return this.request('/input', { method: 'POST', body: JSON.stringify({ connectionId, command }) }); }
  disconnect(connectionId) { return this.request('/disconnect', { method: 'POST', body: JSON.stringify({ connectionId }) }); }
  readNotes(roomId) { return this.request(`/rooms/${encodeURIComponent(roomId)}/notes/${encodeURIComponent(this.identity.uid)}`); }
  saveNote(roomId, page) { return this.request(`/rooms/${encodeURIComponent(roomId)}/notes/${encodeURIComponent(this.identity.uid)}`, { method: 'PUT', body: JSON.stringify(page) }); }
  endRoom(roomId) { return this.request(`/rooms/${encodeURIComponent(roomId)}/end`, { method: 'POST', body: JSON.stringify({ reason: 'explicit' }) }); }
  exportPdf(roomId) { return this.request(`/rooms/${encodeURIComponent(roomId)}/export.pdf`); }
}
