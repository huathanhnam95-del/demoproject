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

const { ensureWorld, disconnectWorld, reconnectWorld, tickWorld, worldCommand } = require('./online-world.cjs');
const PRESENCE_LEASE_MS = 20000;
const DECK_RANGES = Object.freeze({ A: [1, 3], C: [4, 9], E: [10, 16], G: [17, 18], I: [19, 20], J: [21, 21] });
const PRESENTATION_SEQUENCE = Object.freeze(['A', 'C', 'E', 'G', 'I', 'J']);

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
        this.room.lastTickAt = Number.isFinite(this.room.lastTickAt) ? this.room.lastTickAt : this.room.createdAt;
        ensureWorld(this.room);
        this.commands = new Map();
        this.commandSeq = Object.fromEntries(SLOT_IDS.map(slotId => [slotId, this.room.lastCommandSeq?.[slotId] || 0]));
        this.room.lastInputSeq ||= Object.fromEntries(SLOT_IDS.map(slotId => [slotId, 0]));
    }

    refreshRoom(room) {
        validateRoomState(room);
        this.room = clone(room);
        ensureWorld(this.room);
        this.commandSeq = { ...this.commandSeq, ...(this.room.lastCommandSeq || {}) };
        this.room.lastInputSeq ||= Object.fromEntries(SLOT_IDS.map(slotId => [slotId, 0]));
        return this.snapshot();
    }

    snapshot(actorUid = null) { return publicRoomSnapshot(this.room, actorUid); }
    rawState() { return clone(this.room); }

    connect(slotId, requestedGeneration = null, { replaceExisting = false, now = this.clock() } = {}) {
        this.assertNotExpired(now);
        const slot = this.room.slots[slotId];
        if (!slot || !slot.uid) runtimeFail('SEAT_INVALID');
        if (slot.connected && !replaceExisting) runtimeFail('CONNECTION_EXISTS', 'This seat is already active on another device.');
        const generation = Math.max(slot.connectionGeneration + 1, Number.isSafeInteger(requestedGeneration) && requestedGeneration > 0 ? requestedGeneration : 0);
        slot.connectionGeneration = generation;
        slot.connected = true;
        slot.lastSeenAt = now;
        slot.distanceSinceScene = 0;
        reconnectWorld(this.room, slotId, now);
        this.room.revision += 1;
        // Sequence high-water marks survive device takeover and receipt pruning.
        slot.bootstrapAt = slot.bootstrapAt || now;
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
            this.#clearCarriedObject(slotId);
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

    requireGeneration(slotId, generation, now = this.clock()) {
        this.assertNotExpired(now);
        const slot = this.room.slots[slotId];
        if (!slot || !slot.uid) runtimeFail('SEAT_INVALID');
        if (!slot.connected || slot.connectionGeneration !== generation) runtimeFail('STALE_CONNECTION');
        if (!Number.isFinite(slot.lastSeenAt) || now - slot.lastSeenAt > PRESENCE_LEASE_MS) runtimeFail('STALE_CONNECTION');
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
        this.assertNotExpired(now);
        const slot = this.requireGeneration(slotId, generation, now);
        let safeCommand;
        try { safeCommand = validateClientCommand(command); } catch (error) { runtimeFail(error.code || 'COMMAND_INVALID', error.message); }
        slot.lastSeenAt = now;
        const movement = safeCommand.type === 'move';
        const previousSeq = (movement ? this.room.lastInputSeq[slotId] : this.commandSeq[slotId]) || 0;
        const cacheKey = `${slotId}:${movement ? 'input' : 'command'}:${safeCommand.seq}`;
        if (safeCommand.seq <= previousSeq) {
            const replay = this.commands.get(cacheKey);
            if (replay && JSON.stringify(replay.command) === JSON.stringify(safeCommand)) return clone(replay.result);
            runtimeFail('ALREADY_APPLIED_RESYNC');
        }
        if (!movement && safeCommand.seq !== previousSeq + 1) runtimeFail('SEQUENCE_GAP');
        const result = this.#applyCommand(slot, safeCommand, now);
        if (movement) this.room.lastInputSeq[slotId] = safeCommand.seq;
        else { this.commandSeq[slotId] = safeCommand.seq; this.room.lastCommandSeq[slotId] = safeCommand.seq; }
        this.room.revision += 1;
        const output = { ...result, revision: this.room.revision, snapshot: this.snapshot(slot.uid) };
        this.commands.set(cacheKey, { command: safeCommand, result: output });
        return clone(output);
    }

    #applyCommand(slot, command, now) {
        try {
            const result = worldCommand(this.room, slot, command, now);
            if (slot.role === 'presenter') this.#touchPresenter(now);
            return result;
        } catch (error) { runtimeFail(error.code || 'WORLD_ACTION_REJECTED', error.message); }
    }

    assertNotExpired(now = this.clock()) {
        if (this.room.lifecycle === 'ended') runtimeFail('ROOM_ENDED');
        if (Number(this.room.expiresAt) <= now) runtimeFail('ROOM_EXPIRED', 'This room has expired and cannot be revived.');
    }

    heartbeat(slotId, generation, now = this.clock()) {
        const slot = this.requireGeneration(slotId, generation, now);
        slot.lastSeenAt = now;
        this.room.revision += 1;
        return { accepted: true, generation, revision: this.room.revision, snapshot: this.snapshot(slot.uid) };
    }

    #touchPresenter(now) {
        this.room.lastPresenterActivityAt = now;
        this.room.expiresAt = now + 24 * 60 * 60 * 1000;
    }

    #clearCarriedObject(slotId) { disconnectWorld(this.room, slotId); }

    #sweepPresence(now) {
        const expired = [];
        for (const slot of Object.values(this.room.slots || {})) {
            if (!slot.uid || !slot.connected) continue;
            if (!Number.isFinite(slot.lastSeenAt) || now - slot.lastSeenAt > PRESENCE_LEASE_MS) {
                this.#clearCarriedObject(slot.slotId);
                slot.connected = false;
                slot.activity.ready = false;
                slot.relationship = { leader: null, follower: null, carry: null, handhold: null };
                expired.push(slot.slotId);
            }
        }
        return expired;
    }

    tick(now = this.clock()) {
        if (this.room.lifecycle === 'ended') return { advanced: false, reason: 'ended', snapshot: this.snapshot() };
        if (Number(this.room.expiresAt) <= now) return { advanced: false, reason: 'expired', snapshot: this.snapshot() };
        const previousTick = Number(this.room.lastTickAt || now);
        const elapsed = Math.max(0, now - previousTick);
        this.room.lastTickAt = now;
        const expiredSlots = this.#sweepPresence(now);
        tickWorld(this.room, now, elapsed);
        this.room.revision += 1;
        return { advanced: true, revision: this.room.revision, expiredSlots, snapshot: this.snapshot() };
    }
}

module.exports = { AuthoritativeRuntime, DECK_RANGES, PRESENTATION_SEQUENCE, RuntimeError };
