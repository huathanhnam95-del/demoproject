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

const MOVE_INTERVAL_MS = 50;
const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 480;
const DECK_RANGES = Object.freeze({ A: [1, 3], B1: [4, 4], B2: [5, 5], B3: [6, 6], C: [7, 9], D: [10, 10], E: [11, 16], F: [17, 17], G: [18, 18], I: [19, 20], J: [21, 21] });

function rectsFor(scene) {
    if (scene === 'B1' || scene === 'B2' || scene === 'B3') return [{ x: 177, y: 176, w: 107, h: 62 }, { x: 430, y: 94, w: 118, h: 65 }, { x: 655, y: 148, w: 122, h: 53 }];
    if (scene === 'F') return [{ x: 459, y: 145, w: 82, h: 96 }];
    if (scene === 'J') return [{ x: 374, y: 211, w: 252, h: 78 }];
    return [];
}

function blocked(point, scene) {
    return rectsFor(scene).some(rect => point.x > rect.x - 12 && point.x < rect.x + rect.w + 12 && point.y > rect.y - 12 && point.y < rect.y + rect.h + 12);
}

function ensureGameplay(room) {
    if (!room.gameplay || typeof room.gameplay !== 'object') room.gameplay = {
        version: 1,
        bridge: { generation: 0, phase: 'gathering', remaining: 60000, placed: 0, assisted: false, planks: [] },
        reversal: { phase: 'gathering', index: 0, remaining: 0, results: [], debuffs: { p1: 0, p2: 0, p3: 0 } },
        cubes: { pairs: [false, false, false], matchedAt: [], cubes: [] },
        objects: {}
    };
    const cubes = room.gameplay.cubes || (room.gameplay.cubes = {});
    if (!Array.isArray(cubes.pairs) || cubes.pairs.length !== 3) cubes.pairs = [false, false, false];
    if (!Array.isArray(cubes.cubes) || cubes.cubes.length !== 6) {
        cubes.cubes = Array.from({ length: 6 }, (_, index) => ({ cubeIndex: index, pair: Math.floor(index / 2), owner: null, placed: false }));
    } else {
        cubes.cubes = cubes.cubes.map((cube, index) => ({ cubeIndex: index, pair: Number.isSafeInteger(cube?.pair) ? cube.pair : Math.floor(index / 2), owner: cube?.owner || null, placed: cube?.placed === true }));
    }
    return room.gameplay;
}

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
        ensureGameplay(this.room);
        this.commands = new Map();
        this.commandSeq = Object.fromEntries(SLOT_IDS.map(slotId => [slotId, this.room.lastCommandSeq?.[slotId] || 0]));
    }

    refreshRoom(room) {
        validateRoomState(room);
        const previous = this.room;
        this.room = clone(room);
        ensureGameplay(this.room);
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
        // A generation is a fresh membership session. Its first command is
        // intentionally seq=1, while older generations remain fenced.
        this.commandSeq[slotId] = 0;
        this.room.lastCommandSeq[slotId] = 0;
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
            if (slot.lastAcceptedInputAt !== null && slot.lastAcceptedInputAt !== undefined && now - slot.lastAcceptedInputAt < MOVE_INTERVAL_MS) {
                return { accepted: true, type: command.type, position: clone(slot.position), rateLimited: true };
            }
            const speed = 12;
            const candidate = {
                x: Math.max(0, Math.min(WORLD_WIDTH, slot.position.x + command.dx * speed)),
                y: Math.max(0, Math.min(WORLD_HEIGHT, slot.position.y + command.dy * speed))
            };
            if (!blocked(candidate, slot.scene)) slot.position = candidate;
            slot.lastAcceptedInputAt = now;
            if (slot.role === 'presenter') this.#touchPresenter(now);
            return { accepted: true, type: command.type, position: clone(slot.position) };
        }
        if (command.type === 'transition') {
            if (slot.role !== 'presenter') runtimeFail('PRESENTER_ONLY');
            if (this.room.lifecycle !== 'reception') runtimeFail('TRANSITION_INVALID');
            if (!PARTICIPANT_SLOT_IDS.every(id => this.room.slots[id].uid)) runtimeFail('PARTICIPANTS_NOT_JOINED');
            if (!this.room.allParticipantsJoinedAt && !PARTICIPANT_SLOT_IDS.every(id => this.room.slots[id].connected && this.room.slots[id].bootstrapAt)) runtimeFail('PARTICIPANTS_NOT_READY');
            this.room.allParticipantsJoinedAt ||= now;
            this.room.lifecycle = 'playing';
            this.room.startedAt ||= now;
            this.#touchPresenter(now);
            return { accepted: true, type: command.type, lifecycle: this.room.lifecycle };
        }
        if (command.type === 'setReady') {
            slot.activity.ready = command.ready;
            return { accepted: true, type: command.type, ready: command.ready };
        }
        if (command.type === 'slide') {
            if (slot.role !== 'presenter') runtimeFail('PRESENTER_ONLY');
            const range = DECK_RANGES[command.room];
            if (!range || command.slide < range[0] || command.slide > range[1]) runtimeFail('COMMAND_SLIDE_INVALID', 'That slide is outside the authored deck range.');
            this.room.deck = { ...this.room.deck, room: command.room, slide: command.slide, steps: { ...this.room.deck.steps, ...(command.step === undefined ? {} : { [command.slide]: command.step }) } };
            this.#touchPresenter(now);
            return { accepted: true, type: command.type, deck: clone(this.room.deck) };
        }
        if (command.type === 'activity') {
            if (['skip', 'reset'].includes(command.action) && slot.role !== 'presenter') runtimeFail('PRESENTER_ONLY');
            const payload = command.payload || {};
            const gameplay = ensureGameplay(this.room);
            if (command.action === 'bridge') {
                if (!['place', 'start', 'reset', 'skip'].includes(payload.op)) runtimeFail('COMMAND_ACTIVITY_FORBIDDEN');
                if (payload.op === 'start' || payload.op === 'reset' || payload.op === 'skip') {
                    if (slot.role !== 'presenter') runtimeFail('PRESENTER_ONLY');
                    gameplay.bridge.phase = payload.op === 'skip' ? 'complete' : payload.op === 'start' ? 'preparation' : 'gathering';
                    if (payload.op === 'skip') { gameplay.bridge.placed = 6; gameplay.bridge.assisted = true; }
                } else {
                    if (slot.scene !== 'F' || !Number.isSafeInteger(payload.plankIndex) || payload.plankIndex !== gameplay.bridge.placed) runtimeFail('ACTIVITY_INTENTION_INVALID');
                    gameplay.bridge.placed += 1;
                    gameplay.bridge.phase = gameplay.bridge.placed === 6 ? 'complete' : 'attempt';
                }
            } else if (command.action === 'reversal') {
                if (payload.op === 'start') {
                    if (slot.role !== 'presenter') runtimeFail('PRESENTER_ONLY');
                    gameplay.reversal.phase = 'choice';
                } else if (payload.op === 'choose') {
                    if (slot.scene !== 'I' || !['Do', "Don't"].includes(payload.choice)) runtimeFail('ACTIVITY_INTENTION_INVALID');
                    gameplay.reversal.results = [...(gameplay.reversal.results || []), { uid: slot.uid, index: gameplay.reversal.index, choice: payload.choice }];
                } else runtimeFail('COMMAND_ACTIVITY_FORBIDDEN');
            } else if (command.action === 'cubes') {
                if (payload.op === 'claim') {
                    if (slot.scene !== 'J' || !Number.isSafeInteger(payload.cubeIndex) || payload.cubeIndex < 0 || payload.cubeIndex > 5) runtimeFail('ACTIVITY_INTENTION_INVALID');
                    gameplay.cubes.cubes[payload.cubeIndex] = { owner: slot.slotId, placed: false };
                } else if (payload.op === 'match') {
                    if (slot.scene !== 'J' || !['p1', 'p2', 'p3'].includes(payload.otherSeat)) runtimeFail('ACTIVITY_INTENTION_INVALID');
                    const a = gameplay.cubes.cubes.find(cube => cube?.owner === slot.slotId);
                    const b = gameplay.cubes.cubes.find(cube => cube?.owner === payload.otherSeat);
                    if (!a || !b || a.pair === undefined || a.pair !== b.pair) runtimeFail('CUBE_PAIR_INVALID');
                    a.owner = null; b.owner = null; a.placed = true; b.placed = true;
                    gameplay.cubes.pairs[a.pair] = true;
                } else runtimeFail('COMMAND_ACTIVITY_FORBIDDEN');
            } else if (command.action === 'reset') {
                this.room.activity = { id: null, phase: null, state: null };
                return { accepted: true, type: command.type, activity: clone(this.room.activity), gameplay: clone(gameplay) };
            }
            this.room.activity = { id: command.action, phase: payload.op || command.action, state: clone(payload) };
            if (slot.role === 'presenter') this.#touchPresenter(now);
            return { accepted: true, type: command.type, activity: clone(this.room.activity), gameplay: clone(gameplay) };
        }
        runtimeFail('COMMAND_TYPE_FORBIDDEN');
    }

    #touchPresenter(now) {
        this.room.lastPresenterActivityAt = now;
        this.room.expiresAt = now + 24 * 60 * 60 * 1000;
    }

    tick(now = this.clock()) {
        if (this.room.lifecycle === 'ended') return { advanced: false, reason: 'ended', snapshot: this.snapshot() };
        this.room.lastTickAt = now;
        ensureGameplay(this.room).tickAt = now;
        this.room.revision += 1;
        return { advanced: true, revision: this.room.revision, snapshot: this.snapshot() };
    }
}

module.exports = { AuthoritativeRuntime, RuntimeError };
