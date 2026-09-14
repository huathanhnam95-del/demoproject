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
const DECK_RANGES = Object.freeze({ A: [1, 3], C: [4, 9], E: [10, 16], G: [17, 18], I: [19, 20], J: [21, 21] });
const PRESENTATION_SEQUENCE = Object.freeze(['A', 'C', 'E', 'G', 'I', 'J']);
const BRIDGE_PLANKS = Object.freeze([
    ['teal', 'diamond', 'Prepare your questions', 650, 351], ['violet', 'two bars', 'Discuss your opinions and approaches', 210, 337], ['rose', 'star', 'Review discussions', 363, 361],
    ['red', 'circle', 'Define action plan', 319, 286], ['blue', 'cross', 'Update on progress + Q&A', 795, 361], ['amber', 'triangle', 'Revise action plan', 682, 274]
]);

function rectsFor(scene) {
    if (scene === 'B1' || scene === 'B2' || scene === 'B3') return [{ x: 177, y: 176, w: 107, h: 62 }, { x: 430, y: 94, w: 118, h: 65 }, { x: 655, y: 148, w: 122, h: 53 }];
    if (scene === 'F') return [{ x: 459, y: 145, w: 82, h: 96 }];
    if (scene === 'J') return [{ x: 374, y: 211, w: 252, h: 78 }];
    return [];
}

function blocked(point, scene) {
    return rectsFor(scene).some(rect => point.x > rect.x - 12 && point.x < rect.x + rect.w + 12 && point.y > rect.y - 12 && point.y < rect.y + rect.h + 12);
}

function setPresentationScene(room, scene) {
    const indexBySlot = { p0: 0, p1: 1, p2: 2, p3: 3 };
    for (const slot of Object.values(room.slots || {})) {
        if (!slot.uid) continue;
        const index = indexBySlot[slot.slotId] || 0;
        const position = scene === 'F' ? { x: 350 + index * 68, y: 375 } : scene === 'I' ? { x: 470 + index * 21, y: 365 } : scene === 'J' ? { x: 450 + index * 30, y: 370 } : { x: 451 + index * 27, y: 370 };
        slot.scene = scene; slot.instanceId = scene; slot.position = position;
        slot.relationship = { leader: null, follower: null, carry: null, handhold: null };
    }
}

function ensureGameplay(room) {
    if (!room.gameplay || typeof room.gameplay !== 'object') room.gameplay = {
        version: 1,
        unlocked: { A: false, C: false, E: false, G: false, I: false },
        bridge: { generation: 0, phase: 'gathering', remaining: 60000, placed: 0, assisted: false, planks: BRIDGE_PLANKS.map(([color, mark, text, x, y], index) => ({ id: `plank-${index}`, index, color, mark, text, x, y, owner: null, placed: false })) },
        reversal: { phase: 'gathering', index: 0, remaining: 0, results: [], debuffs: { p1: 0, p2: 0, p3: 0 } },
        cubes: { pairs: [false, false, false], matchedAt: [], cubes: [] },
        objects: {}
    };
    if (!room.gameplay.bridge || typeof room.gameplay.bridge !== 'object') room.gameplay.bridge = { generation: 0, phase: 'gathering', remaining: 60000, placed: 0, assisted: false, planks: [] };
    if (!room.gameplay.unlocked || typeof room.gameplay.unlocked !== 'object') room.gameplay.unlocked = { A: false, C: false, E: false, G: false, I: false };
    if (!Array.isArray(room.gameplay.bridge.planks) || room.gameplay.bridge.planks.length !== 6) room.gameplay.bridge.planks = BRIDGE_PLANKS.map(([color, mark, text, x, y], index) => ({ id: `plank-${index}`, index, color, mark, text, x, y, owner: null, placed: false }));
    const cubes = room.gameplay.cubes || (room.gameplay.cubes = {});
    if (!Array.isArray(cubes.pairs) || cubes.pairs.length !== 3) cubes.pairs = [false, false, false];
    if (!Array.isArray(cubes.cubes) || cubes.cubes.length !== 6) {
        cubes.cubes = [['teal', 'diamond', 'Conduct', 2, 430, 214], ['red', 'circle', 'Identify', 0, 500, 214], ['amber', 'triangle', 'Gather', 1, 568, 214], ['blue', 'cross', 'Learning needs', 0, 428, 254], ['violet', 'two bars', 'Literature review', 2, 500, 254], ['rose', 'star', "Stakeholders' opinions", 1, 570, 254]].map(([color, mark, text, pair, x, y], index) => ({ id: `cube-${index}`, cubeIndex: index, pair, color, mark, text, x, y, owner: null, placed: false }));
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
        this.room.lastTickAt = Number.isFinite(this.room.lastTickAt) ? this.room.lastTickAt : this.room.createdAt;
        ensureGameplay(this.room);
        this.commands = new Map();
        this.commandSeq = Object.fromEntries(SLOT_IDS.map(slotId => [slotId, this.room.lastCommandSeq?.[slotId] || 0]));
    }

    refreshRoom(room) {
        validateRoomState(room);
        this.room = clone(room);
        ensureGameplay(this.room);
        this.commandSeq = { ...this.commandSeq, ...(this.room.lastCommandSeq || {}) };
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
        this.room.revision += 1;
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
        this.assertNotExpired(this.clock());
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
        this.assertNotExpired(now);
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
            if (this.room.lifecycle !== 'playing') runtimeFail('PRESENTATION_NOT_STARTED');
            this.room.deck = { ...this.room.deck, room: command.room, slide: command.slide, steps: { ...this.room.deck.steps, ...(command.step === undefined ? {} : { [command.slide]: command.step }) } };
            setPresentationScene(this.room, command.room);
            this.#touchPresenter(now);
            return { accepted: true, type: command.type, deck: clone(this.room.deck) };
        }
        if (command.type === 'activity') {
            if (this.room.lifecycle !== 'playing') runtimeFail('PRESENTATION_NOT_STARTED');
            if (['skip', 'reset'].includes(command.action) && slot.role !== 'presenter') runtimeFail('PRESENTER_ONLY');
            const payload = command.payload || {};
            const gameplay = ensureGameplay(this.room);
            if (command.action === 'skip') {
                const activeActivity = this.room.activity?.id || this.room.deck.room;
                if (activeActivity === 'bridge' || this.room.deck.room === 'F') {
                    gameplay.bridge.phase = 'complete'; gameplay.bridge.remaining = 0; gameplay.bridge.placed = 6; gameplay.bridge.assisted = true; gameplay.bridge.planks.forEach(plank => { plank.owner = null; plank.placed = true; });
                } else if (activeActivity === 'reversal' || this.room.deck.room === 'I') {
                    gameplay.reversal.phase = 'complete'; gameplay.reversal.remaining = 0;
                } else if (activeActivity === 'cubes' || this.room.deck.room === 'J') {
                    gameplay.cubes.pairs = [true, true, true]; gameplay.cubes.cubes.forEach(cube => { cube.owner = null; cube.placed = true; });
                }
                const index = PRESENTATION_SEQUENCE.indexOf(this.room.deck.room);
                if (index >= 0 && index < PRESENTATION_SEQUENCE.length - 1) {
                    const nextRoom = PRESENTATION_SEQUENCE[index + 1]; this.room.deck.room = nextRoom; this.room.deck.slide = DECK_RANGES[nextRoom][0];
                    setPresentationScene(this.room, nextRoom);
                }
                this.#touchPresenter(now);
                return { accepted: true, type: command.type, activity: { id: command.action, phase: 'complete', state: { assisted: true } }, gameplay: clone(gameplay), deck: clone(this.room.deck) };
            }
            if (command.action === 'bridge') {
                if (!['place', 'start', 'reset', 'skip'].includes(payload.op)) runtimeFail('COMMAND_ACTIVITY_FORBIDDEN');
                    if (payload.op === 'start' || payload.op === 'reset' || payload.op === 'skip') {
                    if (slot.role !== 'presenter') runtimeFail('PRESENTER_ONLY');
                    gameplay.bridge.phase = payload.op === 'skip' ? 'complete' : payload.op === 'start' ? 'preparation' : 'gathering';
                    if (payload.op === 'start') setPresentationScene(this.room, 'F');
                    if (payload.op === 'skip') { gameplay.bridge.placed = 6; gameplay.bridge.assisted = true; gameplay.bridge.remaining = 0; gameplay.bridge.planks.forEach(plank => { plank.owner = null; plank.placed = true; }); }
                } else {
                    if (slot.scene !== 'F' || !Number.isSafeInteger(payload.plankIndex) || payload.plankIndex !== gameplay.bridge.placed) runtimeFail('ACTIVITY_INTENTION_INVALID');
                    const plank = gameplay.bridge.planks[payload.plankIndex];
                    if (!plank || plank.placed || plank.owner) runtimeFail('ACTIVITY_INTENTION_INVALID');
                    plank.owner = null; plank.placed = true; plank.x = 500; plank.y = 233 - payload.plankIndex * 16;
                    gameplay.bridge.placed += 1;
                    gameplay.bridge.phase = gameplay.bridge.placed === 6 ? 'complete' : 'attempt';
                    if (gameplay.bridge.placed === 6) gameplay.bridge.remaining = 0;
                }
            } else if (command.action === 'reversal') {
                if (payload.op === 'start') {
                    if (slot.role !== 'presenter') runtimeFail('PRESENTER_ONLY');
                    gameplay.reversal.phase = 'choice';
                    setPresentationScene(this.room, 'I');
                } else if (payload.op === 'choose') {
                    if (slot.scene !== 'I' || !['Do', "Don't"].includes(payload.choice)) runtimeFail('ACTIVITY_INTENTION_INVALID');
                    gameplay.reversal.results = [...(gameplay.reversal.results || []), { uid: slot.uid, index: gameplay.reversal.index, choice: payload.choice }];
                } else runtimeFail('COMMAND_ACTIVITY_FORBIDDEN');
            } else if (command.action === 'cubes') {
                if (payload.op === 'claim') {
                    if (slot.scene !== 'J' || !Number.isSafeInteger(payload.cubeIndex) || payload.cubeIndex < 0 || payload.cubeIndex > 5) runtimeFail('ACTIVITY_INTENTION_INVALID');
                    const cube = gameplay.cubes.cubes[payload.cubeIndex];
                    if (!cube || cube.owner || cube.placed) runtimeFail('ACTIVITY_INTENTION_INVALID');
                    cube.owner = slot.slotId; cube.placed = false; slot.relationship.carry = cube.id;
                } else if (payload.op === 'match') {
                    if (slot.scene !== 'J' || !['p1', 'p2', 'p3'].includes(payload.otherSeat)) runtimeFail('ACTIVITY_INTENTION_INVALID');
                    const a = gameplay.cubes.cubes.find(cube => cube?.owner === slot.slotId);
                    const b = gameplay.cubes.cubes.find(cube => cube?.owner === payload.otherSeat);
                    if (!a || !b || a.pair === undefined || a.pair !== b.pair) runtimeFail('CUBE_PAIR_INVALID');
                    a.owner = null; b.owner = null; a.placed = true; b.placed = true;
                    gameplay.cubes.pairs[a.pair] = true;
                    slot.relationship.carry = null;
                    if (this.room.slots[payload.otherSeat]) this.room.slots[payload.otherSeat].relationship.carry = null;
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

    assertNotExpired(now = this.clock()) {
        if (this.room.lifecycle === 'ended') runtimeFail('ROOM_ENDED');
        if (Number(this.room.expiresAt) <= now) runtimeFail('ROOM_EXPIRED', 'This room has expired and cannot be revived.');
    }

    heartbeat(slotId, generation, now = this.clock()) {
        const slot = this.requireGeneration(slotId, generation);
        slot.lastSeenAt = now;
        this.room.revision += 1;
        return { accepted: true, generation, revision: this.room.revision, snapshot: this.snapshot(slot.uid) };
    }

    #touchPresenter(now) {
        this.room.lastPresenterActivityAt = now;
        this.room.expiresAt = now + 24 * 60 * 60 * 1000;
    }

    tick(now = this.clock()) {
        if (this.room.lifecycle === 'ended') return { advanced: false, reason: 'ended', snapshot: this.snapshot() };
        if (Number(this.room.expiresAt) <= now) return { advanced: false, reason: 'expired', snapshot: this.snapshot() };
        const previousTick = Number(this.room.lastTickAt || now);
        const elapsed = Math.max(0, now - previousTick);
        this.room.lastTickAt = now;
        const gameplay = ensureGameplay(this.room);
        gameplay.tickAt = now;
        if (['preparation', 'attempt', 'review'].includes(gameplay.bridge.phase)) {
            gameplay.bridge.remaining = Math.max(0, Number(gameplay.bridge.remaining || 0) - elapsed);
            if (gameplay.bridge.remaining === 0 && gameplay.bridge.phase === 'preparation') {
                gameplay.bridge.phase = 'attempt';
                gameplay.bridge.remaining = 30000;
            } else if (gameplay.bridge.remaining === 0 && gameplay.bridge.phase === 'attempt') {
                gameplay.bridge.phase = 'review';
                gameplay.bridge.remaining = 10000;
            } else if (gameplay.bridge.remaining === 0 && gameplay.bridge.phase === 'review') {
                gameplay.bridge.phase = 'preparation';
                gameplay.bridge.remaining = 60000;
                gameplay.bridge.generation += 1;
                gameplay.bridge.placed = 0;
                gameplay.bridge.assisted = false;
                gameplay.bridge.planks.forEach((plank, index) => { plank.owner = null; plank.placed = false; plank.x = BRIDGE_PLANKS[index][3]; plank.y = BRIDGE_PLANKS[index][4]; });
            }
        }
        this.room.revision += 1;
        return { advanced: true, revision: this.room.revision, snapshot: this.snapshot() };
    }
}

module.exports = { AuthoritativeRuntime, DECK_RANGES, PRESENTATION_SEQUENCE, RuntimeError };
