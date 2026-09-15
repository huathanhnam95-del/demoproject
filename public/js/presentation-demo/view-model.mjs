export class PresentationViewModel {
  constructor({ transport, identity }) { this.transport = transport; this.identity = identity; this.room = null; this.connection = null; this.sequence = 0; this.inputSequence = 0; this.uncertain = null; }
  setRoom(room) { this.room = room; this.sequence = Math.max(this.sequence, room.acceptedSequence?.command || 0); this.inputSequence = Math.max(this.inputSequence, room.acceptedSequence?.input || 0); return room; }
  isPresenter() { return this.room?.presenterUid === this.identity.uid; }
  slot() { return Object.values(this.room?.slots || {}).find(slot => slot.uid === this.identity.uid) || null; }
  nextSequence() { this.sequence += 1; return this.sequence; }
  command(type, values = {}) {
    if (!this.connection) throw Object.assign(new Error('Connect to the room first.'), { code: 'NOT_CONNECTED' });
    const pending = (this.commandTail || Promise.resolve()).catch(() => {}).then(async () => {
      if (this.uncertain) await this.deliver(this.uncertain);
      const command = { type, seq: (type === 'move' ? this.inputSequence : this.sequence) + 1, ...values };
      return this.deliver({ command, id: crypto.randomUUID() });
    });
    this.commandTail = pending;
    return pending;
  }
  async deliver(operation) {
    try {
      const result = await this.transport.input(this.connection?.connectionId, operation.command, operation.id);
      this.uncertain = null;
      if (operation.command.type === 'move') this.inputSequence = Math.max(this.inputSequence, operation.command.seq);
      else this.sequence = Math.max(this.sequence, operation.command.seq);
      if (result.snapshot) this.setRoom(result.snapshot);
      return result;
    } catch (error) {
      if (['OUTCOME_UNKNOWN', 'WS_DISCONNECTED', 'WS_NOT_CONNECTED', 'WS_REQUEST_TIMEOUT', 'WS_RECONNECT_FAILED'].includes(error.code) || error instanceof TypeError) this.uncertain = operation;
      else { this.uncertain = null; if (['SEQUENCE_GAP', 'ALREADY_APPLIED_RESYNC'].includes(error.code)) this.setRoom(await this.transport.room(this.room.roomId)); }
      throw error;
    }
  }
  async connect({ replaceExisting = false } = {}) { const ticket = await this.transport.ticket(this.room.roomId); this.connection = await this.transport.connect(ticket, replaceExisting); this.setRoom(this.connection.snapshot); return this.connection; }
  async disconnect() { if (this.connection) await this.transport.disconnect(this.connection.connectionId); this.connection = null; }
}
