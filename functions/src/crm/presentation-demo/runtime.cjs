'use strict';

const {
    PARTICIPANT_SLOT_IDS,
    SLOT_IDS,
    clone,
    fail,
    publicRoomSnapshot,
    validateClientCommand,
    validateRoomState
} = require('./contracts.cjs');

class RuntimeError extends Error {
    constructor(code, message = code) {
        super(message);
        this.name = 'RuntimeError';
        this.code = code;
    }
}

function runtimeFail(code, message) { throw new RuntimeError(code, message); }

class AuthoritativeRuntime {
    constructor(room, { clock = () => Date.now(), ownerLeaseMs = 10000 } = {}) {
        validateRoomState(room);
        this.clock = clock;
        this.ownerLeaseMs = ownerLeaseMs;
        this.room = clone(room);
        this.commands = new Map();
        this.commandSeq = Object.fromEntries(SLOT_IDS.map(slotId => [slotId, this.room.lastCommandSeq?.[slotId] || 0]));
    }

    refreshRoom(room) {
        validateRoomState(room);
        const previous = this.room;
        this.room = clone(room);
        for (const slotId of SLOT_IDS) {
            const oldSlot = previous.slots[slotId];
            const newSlot = this.room.slots[slotId];
            if (oldSlot.uid && oldSlot.uid === newSlot.uid) {
                newSlot.connected = oldSlot.connected;
                newSlot.connectionGeneration = oldSlot.connectionGeneration;
                newSlot.lastSeenAt = oldSlot.lastSeenAt;
            }
        }
        this.commandSeq = { ...this.commandSeq, ...(this.room.lastCommandSeq || {}) };
        return this.snapshot();
    }

    snapshot(actorUid = null) { return publicRoomSnapshot(this.room, actorUid); }
    rawState() { return clone(this.room); }

    connect(slotId, requestedGeneration = null, { replaceExisting = false, now = this.clock() } = {}) {
        const slot = this.room.slots[slotId];
        if (!slot || !slot.uid) runtimeFail('SEAT_INVALID');
        if (slot.connected && !replaceExisting) runtimeFail('CONNECTION_EXISTS', 'This seat is already active on another device.');
        const generation = Math.max(slot.connectionGeneration + 1, Number.isSafeInteger(requestedGeneration) && requestedGeneration > 0 ? requestedGeneration : 0);
        slot.connectionGeneration = generation;
        slot.connected = true;
        slot.lastSeenAt = now;
        return { slotId, uid: slot.uid, generation, revision: this.room.revision, snapshot: this.snapshot(slot.uid) };
    }

    replaceConnection(slotId, now = this.clock()) { return this.connect(slotId, null, { replaceExisting: true, now }); }

    setPresence(slotId, connected, now = this.clock(), generation = null) {
        const slot = this.room.slots[slotId];
        if (!slot || !slot.uid || typeof connected !== 'boolean') runtimeFail('PRESENCE_INVALID');
        if (generation !== null && generation !== slot.connectionGeneration) runtimeFail('STALE_CONNECTION');
        slot.connected = connected;
        slot.lastSeenAt = now;
        if (!connected) {
            slot.activity.ready = false;
            slot.relationship = { leader: null, follower: null, carry: null, handhold: null };
        }
        this.room.revision += 1;
        return this.snapshot(slot.uid);
    }

    markBootstrap(slotId, now = this.clock()) {
        const slot = this.room.slots[slotId];
        if (!slot || !slot.uid) runtimeFail('SEAT_INVALID');
        slot.bootstrapAt = slot.bootstrapAt || now;
        if (!this.room.allParticipantsJoinedAt && PARTICIPANT_SLOT_IDS.every(id => this.room.slots[id].uid && this.room.slots[id].bootstrapAt)) {
            this.room.allParticipantsJoinedAt = now;
        }
        this.room.revision += 1;
        return this.snapshot(slot.uid);
    }

    arrivalGate(slotIds = SLOT_IDS) {
        const missing = slotIds.filter(slotId => {
            const slot = this.room.slots[slotId];
            return slot && slot.uid && slot.connected && slot.arrived !== true;
        });
        return { blocked: missing.length > 0, missing };
    }

    setArrival(slotId, arrived, now = this.clock(), generation = null) {
        const slot = this.room.slots[slotId];
        if (!slot || !slot.uid || typeof arrived !== 'boolean') runtimeFail('ARRIVAL_INVALID');
        if (generation !== null && generation !== slot.connectionGeneration) runtimeFail('STALE_CONNECTION');
        slot.arrived = arrived;
        slot.lastSeenAt = now;
        this.room.revision += 1;
        return this.snapshot(slot.uid);
    }

    requireGeneration(slotId, generation) {
        const slot = this.room.slots[slotId];
        if (!slot || !slot.uid) runtimeFail('SEAT_INVALID');
        if (!slot.connected || slot.connectionGeneration !== generation) runtimeFail('STALE_CONNECTION');
        return slot;
    }

    requireOwner(gatewayId, ownerEpoch, now = this.clock()) {
        const owner = this.room.owner;
        if (owner.gatewayId !== gatewayId || owner.ownerEpoch !== ownerEpoch || owner.leaseUntil < now) runtimeFail('OWNER_FENCED');
        return owner;
    }

    claimOwner(gatewayId, now = this.clock()) {
        const owner = this.room.owner;
        if (owner.gatewayId && owner.gatewayId !== gatewayId && owner.leaseUntil >= now) runtimeFail('OWNER_LEASE_HELD');
        owner.gatewayId = String(gatewayId);
        owner.ownerEpoch += 1;
        owner.leaseUntil = now + this.ownerLeaseMs;
        this.room.revision += 1;
        return clone(owner);
    }

    renewOwner(gatewayId, ownerEpoch, now = this.clock()) {
        this.requireOwner(gatewayId, ownerEpoch, now);
        this.room.owner.leaseUntil = now + this.ownerLeaseMs;
        return clone(this.room.owner);
    }

    command(slotId, generation, command, now = this.clock()) {
        const slot = this.requireGeneration(slotId, generation);
        let safeCommand;
        try { safeCommand = validateClientCommand(command); } catch (error) { runtimeFail(error.code || 'COMMAND_INVALID', error.message); }
        const previousSeq = this.commandSeq[slotId] || 0;
        if (safeCommand.seq <= previousSeq) {
            const replay = this.commands.get(`${slotId}:${safeCommand.seq}`);
            if (replay && JSON.stringify(replay.command) === JSON.stringify(safeCommand)) return clone(replay.result);
            runtimeFail('STALE_SEQUENCE');
        }
        const result = this.#applyCommand(slot, safeCommand, now);
        this.commandSeq[slotId] = safeCommand.seq;
        this.room.lastCommandSeq[slotId] = safeCommand.seq;
        this.room.revision += 1;
        const output = { ...result, revision: this.room.revision, snapshot: this.snapshot(slot.uid) };
        this.commands.set(`${slotId}:${safeCommand.seq}`, { command: safeCommand, result: output });
        return clone(output);
    }

    #applyCommand(slot, command, now) {
        if (this.room.lifecycle === 'ended') runtimeFail('ROOM_ENDED');
        if (command.type === 'move') {
            const speed = 12;
            slot.position.x = Math.max(0, Math.min(1180, slot.position.x + command.dx * speed));
            slot.position.y = Math.max(0, Math.min(700, slot.position.y + command.dy * speed));
            slot.lastAcceptedInputAt = now;
            if (slot.role === 'presenter') this.room.lastPresenterActivityAt = now;
            return { accepted: true, type: command.type, position: clone(slot.position) };
        }
        if (command.type === 'transition') {
            if (slot.role !== 'presenter') runtimeFail('PRESENTER_ONLY');
            if (this.room.lifecycle !== 'reception') runtimeFail('TRANSITION_INVALID');
            if (!PARTICIPANT_SLOT_IDS.every(id => this.room.slots[id].uid)) runtimeFail('PARTICIPANTS_NOT_JOINED');
            this.room.allParticipantsJoinedAt ||= now;
            this.room.lifecycle = 'playing';
            this.room.startedAt ||= now;
            this.room.lastPresenterActivityAt = now;
            return { accepted: true, type: command.type, lifecycle: this.room.lifecycle };
        }
        if (command.type === 'setReady') {
            slot.activity.ready = command.ready;
            return { accepted: true, type: command.type, ready: command.ready };
        }
        if (command.type === 'slide') {
            if (slot.role !== 'presenter') runtimeFail('PRESENTER_ONLY');
            this.room.deck = { ...this.room.deck, room: command.room, slide: command.slide, steps: { ...this.room.deck.steps, ...(command.step === undefined ? {} : { [command.slide]: command.step }) } };
            this.room.lastPresenterActivityAt = now;
            return { accepted: true, type: command.type, deck: clone(this.room.deck) };
        }
        if (command.type === 'activity') {
            if (['skip', 'reset'].includes(command.action) && slot.role !== 'presenter') runtimeFail('PRESENTER_ONLY');
            this.room.activity = { id: command.action === 'reset' ? null : command.action, phase: command.action, state: clone(command.payload || {}) };
            if (slot.role === 'presenter') this.room.lastPresenterActivityAt = now;
            return { accepted: true, type: command.type, activity: clone(this.room.activity) };
        }
        runtimeFail('COMMAND_TYPE_FORBIDDEN');
    }

    tick(now = this.clock()) {
        if (this.room.lifecycle === 'ended') return { advanced: false, reason: 'ended', snapshot: this.snapshot() };
        this.room.lastTickAt = now;
        this.room.revision += 1;
        return { advanced: true, revision: this.room.revision, snapshot: this.snapshot() };
    }
}

module.exports = { AuthoritativeRuntime, RuntimeError };
