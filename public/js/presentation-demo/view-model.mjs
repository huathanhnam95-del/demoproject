export class PresentationViewModel {
  constructor({ transport, identity }) { this.transport = transport; this.identity = identity; this.room = null; this.connection = null; this.sequence = 0; }
  setRoom(room) { this.room = room; return room; }
  isPresenter() { return this.room?.presenterUid === this.identity.uid; }
  slot() { return Object.values(this.room?.slots || {}).find(slot => slot.uid === this.identity.uid) || null; }
  nextSequence() { this.sequence += 1; return this.sequence; }
  command(type, values = {}) { if (!this.connection) throw Object.assign(new Error('Connect to the room first.'), { code: 'NOT_CONNECTED' }); return this.transport.input(this.connection.connectionId, { type, seq: this.nextSequence(), ...values }); }
  async connect({ replaceExisting = false } = {}) { const ticket = await this.transport.ticket(this.room.roomId); this.sequence = 0; this.connection = await this.transport.connect(ticket, replaceExisting); return this.connection; }
  async disconnect() { if (this.connection) await this.transport.disconnect(this.connection.connectionId); this.connection = null; }
}
