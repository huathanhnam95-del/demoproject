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
const PRESENCE_LEASE_MS = 20000;
const BRIDGE_PREPARATION_MS = 60000;
const BRIDGE_ATTEMPT_MS = 30000;
const BRIDGE_REVIEW_MS = 10000;
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

function distance(a, b) { return Math.hypot(Number(a?.x || 0) - Number(b?.x || 0), Number(a?.y || 0) - Number(b?.y || 0)); }

function setPresentationScene(room, scene) {
    const indexBySlot = { p0: 0, p1: 1, p2: 2, p3: 3 };
    for (const slot of Object.values(room.slots || {})) {
        if (!slot.uid) continue;
        const index = indexBySlot[slot.slotId] || 0;
        const changedScene = slot.scene !== scene || slot.instanceId !== scene;
        const position = scene === 'F' ? { x: 350 + index * 68, y: 375 } : scene === 'I' ? { x: 470 + index * 21, y: 365 } : scene === 'J' ? { x: 450 + index * 30, y: 370 } : { x: 451 + index * 27, y: 370 };
        slot.scene = scene; slot.instanceId = scene;
        if (changedScene) { slot.position = position; slot.distanceSinceScene = 0; slot.sceneEnteredAt = Date.now(); }
        slot.relationship = { leader: null, follower: null, carry: null, handhold: null };
    }
}

function ensureGameplay(room) {
    if (!room.gameplay || typeof room.gameplay !== 'object') room.gameplay = {
        version: 1,
        unlocked: { A: false, C: false, E: false, G: false, I: false },
        bridge: { generation: 0, phase: 'gathering', remaining: BRIDGE_PREPARATION_MS, placed: 0, assisted: false, planks: BRIDGE_PLANKS.map(([color, mark, text, x, y], index) => ({ id: `plank-${index}`, index, color, mark, text, x, y, owner: null, placed: false })) },
        reversal: { phase: 'gathering', index: 0, remaining: 0, results: [], choices: {}, debuffs: { p1: 0, p2: 0, p3: 0 } },
        cubes: { pairs: [false, false, false], matchedAt: [], cubes: [] },
        objects: {}
    };
    if (!room.gameplay.bridge || typeof room.gameplay.bridge !== 'object') room.gameplay.bridge = { generation: 0, phase: 'gathering', remaining: BRIDGE_PREPARATION_MS, placed: 0, assisted: false, planks: [] };
    if (!room.gameplay.unlocked || typeof room.gameplay.unlocked !== 'object') room.gameplay.unlocked = { A: false, C: false, E: false, G: false, I: false };
    if (!Array.isArray(room.gameplay.bridge.planks) || room.gameplay.bridge.planks.length !== 6) room.gameplay.bridge.planks = BRIDGE_PLANKS.map(([color, mark, text, x, y], index) => ({ id: `plank-${index}`, index, color, mark, text, x, y, owner: null, placed: false }));
    room.gameplay.bridge.remaining = Number.isFinite(room.gameplay.bridge.remaining) ? room.gameplay.bridge.remaining : BRIDGE_PREPARATION_MS;
    const cubes = room.gameplay.cubes || (room.gameplay.cubes = {});
    if (!Array.isArray(cubes.pairs) || cubes.pairs.length !== 3) cubes.pairs = [false, false, false];
    if (!Array.isArray(cubes.cubes) || cubes.cubes.length !== 6) {
        cubes.cubes = [['teal', 'diamond', 'Conduct', 2, 430, 214], ['red', 'circle', 'Identify', 0, 500, 214], ['amber', 'triangle', 'Gather', 1, 568, 214], ['blue', 'cross', 'Learning needs', 0, 428, 254], ['violet', 'two bars', 'Literature review', 2, 500, 254], ['rose', 'star', "Stakeholders' opinions", 1, 570, 254]].map(([color, mark, text, pair, x, y], index) => ({ id: `cube-${index}`, index, cubeIndex: index, pair, color, mark, text, x, y, owner: null, placed: false }));
    } else {
        cubes.cubes = cubes.cubes.map((cube, index) => ({
            ...cube,
            id: cube?.id || `cube-${index}`,
            // Keep the authored sprite identity in the wire snapshot, including
            // rooms persisted before that renderer field was supplied.
            index,
            cubeIndex: index,
            pair: Number.isSafeInteger(cube?.pair) ? cube.pair : Math.floor(index / 2),
            owner: cube?.owner || null,
            placed: cube?.placed === true
        }));
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
        slot.distanceSinceScene = 0;
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

    requireGeneration(slotId, generation) {
        this.assertNotExpired(this.clock());
        const slot = this.room.slots[slotId];
        if (!slot || !slot.uid) runtimeFail('SEAT_INVALID');
        if (!slot.connected || slot.connectionGeneration !== generation) runtimeFail('STALE_CONNECTION');
        if (!Number.isFinite(slot.lastSeenAt) || this.clock() - slot.lastSeenAt > PRESENCE_LEASE_MS) runtimeFail('STALE_CONNECTION');
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
            const traveled = blocked(candidate, slot.scene) ? 0 : distance(slot.position, candidate);
            if (!blocked(candidate, slot.scene)) slot.position = candidate;
            slot.lastAcceptedInputAt = now;
            slot.distanceSinceScene = Number(slot.distanceSinceScene || 0) + traveled;
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
            // Reception is the only legal entry into the online route. The
            // presenter may open the session, but nobody gets a server-side
            // scene jump to a later studio from this lifecycle transition.
            for (const member of Object.values(this.room.slots)) {
                if (!member.uid) continue;
                if (member.scene === 'home' || member.scene === 'street') {
                    member.scene = 'reception'; member.instanceId = 'reception'; member.position = { x: 451 + (Number(member.slotId.slice(1)) || 0) * 27, y: 370 };
                    member.distanceSinceScene = 0; member.relationship = { leader: null, follower: null, carry: null, handhold: null };
                }
            }
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
            const currentRoom = this.room.deck.room;
            const currentSlide = Number(this.room.deck.slide || 1);
            const currentIndex = currentRoom ? PRESENTATION_SEQUENCE.indexOf(currentRoom) : -1;
            const targetIndex = PRESENTATION_SEQUENCE.indexOf(command.room);
            const sameRoom = currentRoom === command.room;
            const initialRoom = !currentRoom;
            if (initialRoom) {
                if (command.room !== 'A') runtimeFail('PROGRESSION_REQUIRED', 'Start at Studio A before opening a later studio.');
            } else if (sameRoom) {
                if (Math.abs(command.slide - currentSlide) !== 1) runtimeFail('PROGRESSION_REQUIRED', 'Slides must advance one authored page at a time.');
            } else {
                const adjacent = targetIndex === currentIndex + 1 && command.slide === DECK_RANGES[command.room][0]
                    || targetIndex === currentIndex - 1 && command.slide === DECK_RANGES[command.room][1];
                if (!adjacent || targetIndex < 0) runtimeFail('PROGRESSION_REQUIRED', 'Move through the authored presentation sequence.');
                if (targetIndex > currentIndex && !this.#routeProgressMade()) runtimeFail('PROGRESSION_REQUIRED', 'Walk through the current room before continuing.');
            }
            this.room.deck = { ...this.room.deck, room: command.room, slide: command.slide, steps: { ...this.room.deck.steps, ...(command.step === undefined ? {} : { [command.slide]: command.step }) } };
            if (!sameRoom) setPresentationScene(this.room, command.room);
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
                    if (payload.op === 'start') {
                        if (!this.#allConnectedAt('F')) runtimeFail('ACTIVITY_NOT_READY', 'All connected players must gather in the bridge room.');
                        gameplay.bridge.phase = 'preparation'; gameplay.bridge.remaining = BRIDGE_PREPARATION_MS; gameplay.bridge.assisted = false;
                        setPresentationScene(this.room, 'F');
                    }
                    if (payload.op === 'reset') {
                        gameplay.bridge.phase = 'gathering'; gameplay.bridge.remaining = BRIDGE_PREPARATION_MS; gameplay.bridge.placed = 0; gameplay.bridge.assisted = false;
                        gameplay.bridge.planks.forEach((plank, index) => { plank.owner = null; plank.placed = false; plank.x = BRIDGE_PLANKS[index][3]; plank.y = BRIDGE_PLANKS[index][4]; });
                    }
                    if (payload.op === 'skip') { gameplay.bridge.phase = 'complete'; gameplay.bridge.placed = 6; gameplay.bridge.assisted = true; gameplay.bridge.remaining = 0; gameplay.bridge.planks.forEach(plank => { plank.owner = null; plank.placed = true; }); }
                } else {
                    if (slot.scene !== 'F' || !Number.isSafeInteger(payload.plankIndex) || payload.plankIndex !== gameplay.bridge.placed) runtimeFail('ACTIVITY_INTENTION_INVALID');
                    if (gameplay.bridge.phase !== 'attempt') runtimeFail('BRIDGE_NOT_IN_ATTEMPT', 'The preparation timer has not finished.');
                    const plank = gameplay.bridge.planks[payload.plankIndex];
                    if (!plank || plank.placed || plank.owner) runtimeFail('ACTIVITY_INTENTION_INVALID');
                    const target = { x: 500, y: 233 - payload.plankIndex * 16 };
                    if (distance(slot.position, target) > 64) runtimeFail('BRIDGE_NOT_AT_TARGET', 'Walk to the open bridge position before placing this plank.');
                    plank.owner = null; plank.placed = true; plank.x = 500; plank.y = 233 - payload.plankIndex * 16;
                    gameplay.bridge.placed += 1;
                    gameplay.bridge.phase = gameplay.bridge.placed === 6 ? 'complete' : 'attempt';
                    if (gameplay.bridge.placed === 6) gameplay.bridge.remaining = 0;
                }
            } else if (command.action === 'reversal') {
                if (payload.op === 'start') {
                    if (slot.role !== 'presenter') runtimeFail('PRESENTER_ONLY');
                    if (!this.#allConnectedAt('I')) runtimeFail('ACTIVITY_NOT_READY', 'All connected players must gather in Room I.');
                    gameplay.reversal.phase = 'opening'; gameplay.reversal.remaining = 3000; gameplay.reversal.index = 0; gameplay.reversal.results = []; gameplay.reversal.choices = {};
                    setPresentationScene(this.room, 'I');
                } else if (payload.op === 'choose') {
                    if (slot.scene !== 'I' || gameplay.reversal.phase !== 'choice' || !['Do', "Don't"].includes(payload.choice)) runtimeFail('ACTIVITY_INTENTION_INVALID');
                    if (!this.#choiceAt(slot.position)) runtimeFail('CHOICE_NOT_AT_ZONE', 'Stand fully in Do or Don’t before choosing.');
                    gameplay.reversal.choices[slot.uid] = payload.choice;
                } else runtimeFail('COMMAND_ACTIVITY_FORBIDDEN');
            } else if (command.action === 'cubes') {
                if (payload.op === 'claim') {
                    if (slot.scene !== 'J' || !Number.isSafeInteger(payload.cubeIndex) || payload.cubeIndex < 0 || payload.cubeIndex > 5) runtimeFail('ACTIVITY_INTENTION_INVALID');
                    const cube = gameplay.cubes.cubes[payload.cubeIndex];
                    if (!cube || cube.owner || cube.placed) runtimeFail('ACTIVITY_INTENTION_INVALID');
                    cube.owner = slot.slotId; cube.placed = false; slot.relationship.carry = cube.id;
                } else if (payload.op === 'match') {
                    if (slot.scene !== 'J' || !['p1', 'p2', 'p3'].includes(payload.otherSeat) || payload.otherSeat === slot.slotId) runtimeFail('CUBE_PAIR_INVALID', 'Two distinct participants must carry the cubes.');
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

    #clearCarriedObject(slotId) {
        const gameplay = ensureGameplay(this.room);
        for (const object of [...(gameplay.bridge?.planks || []), ...(gameplay.cubes?.cubes || [])]) {
            if (object.owner === slotId) object.owner = null;
        }
    }

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

    #allConnectedAt(scene) {
        const members = Object.values(this.room.slots || {}).filter(slot => slot.uid);
        return members.length > 0 && members.every(slot => slot.connected === true && slot.scene === scene && slot.instanceId === scene);
    }

    #routeProgressMade() {
        const members = Object.values(this.room.slots || {}).filter(slot => slot.uid && slot.connected);
        return members.length > 0 && members.every(slot => Number(slot.distanceSinceScene || 0) >= 32);
    }

    #choiceAt(position) {
        if (!position || position.y < 195 || position.y > 361) return null;
        if (position.x >= 135 && position.x <= 420) return 'Do';
        if (position.x >= 581 && position.x <= 866) return "Don't";
        return null;
    }

    #resolveReversalQuestion(now) {
        const reversal = ensureGameplay(this.room).reversal;
        const answer = reversal.index % 2 === 0 ? 'Do' : "Don't";
        const players = {};
        for (const slotId of PARTICIPANT_SLOT_IDS) {
            const slot = this.room.slots[slotId];
            const choice = slot?.connected && slot.scene === 'I' ? (reversal.choices?.[slot.uid] || this.#choiceAt(slot.position)) : null;
            const correct = choice === answer;
            players[slotId] = { choice, correct, connected: slot?.connected === true, evaluated: slot?.connected === true && slot?.scene === 'I' };
            if (!correct && reversal.debuffs[slotId] === 0) reversal.debuffs[slotId] = 20000;
        }
        reversal.results = [...(reversal.results || []), { index: reversal.index, answer, players, completedAt: now }];
        reversal.choices = {};
    }

    #tickReversal(elapsed, now) {
        const reversal = ensureGameplay(this.room).reversal;
        for (const slotId of PARTICIPANT_SLOT_IDS) reversal.debuffs[slotId] = Math.max(0, Number(reversal.debuffs[slotId] || 0) - elapsed);
        let remaining = Math.max(0, elapsed);
        while (remaining > 0 && !['gathering', 'complete'].includes(reversal.phase)) {
            const phaseDuration = Number(reversal.remaining || 0);
            if (phaseDuration > remaining) { reversal.remaining = phaseDuration - remaining; remaining = 0; break; }
            remaining -= phaseDuration;
            if (reversal.phase === 'opening') { reversal.phase = 'choice'; reversal.remaining = 5000; }
            else if (reversal.phase === 'choice') { this.#resolveReversalQuestion(now); if (reversal.index >= 5) { reversal.phase = 'complete'; reversal.remaining = 0; } else { reversal.phase = 'interval'; reversal.remaining = 10000; } }
            else if (reversal.phase === 'interval') { reversal.index += 1; reversal.phase = 'opening'; reversal.remaining = 3000; }
            else { reversal.phase = 'complete'; reversal.remaining = 0; }
            if (phaseDuration === 0) break;
        }
    }

    tick(now = this.clock()) {
        if (this.room.lifecycle === 'ended') return { advanced: false, reason: 'ended', snapshot: this.snapshot() };
        if (Number(this.room.expiresAt) <= now) return { advanced: false, reason: 'expired', snapshot: this.snapshot() };
        const previousTick = Number(this.room.lastTickAt || now);
        const elapsed = Math.max(0, now - previousTick);
        this.room.lastTickAt = now;
        const expiredSlots = this.#sweepPresence(now);
        const gameplay = ensureGameplay(this.room);
        gameplay.tickAt = now;
        let bridgeElapsed = elapsed;
        while (bridgeElapsed > 0 && ['preparation', 'attempt', 'review'].includes(gameplay.bridge.phase)) {
            const phaseDuration = Number(gameplay.bridge.remaining || 0);
            if (phaseDuration > bridgeElapsed) { gameplay.bridge.remaining = phaseDuration - bridgeElapsed; bridgeElapsed = 0; break; }
            bridgeElapsed -= phaseDuration;
            if (gameplay.bridge.phase === 'preparation') { gameplay.bridge.phase = 'attempt'; gameplay.bridge.remaining = BRIDGE_ATTEMPT_MS; }
            else if (gameplay.bridge.phase === 'attempt') { gameplay.bridge.phase = 'review'; gameplay.bridge.remaining = BRIDGE_REVIEW_MS; }
            else {
                gameplay.bridge.phase = 'preparation'; gameplay.bridge.remaining = BRIDGE_PREPARATION_MS; gameplay.bridge.generation += 1; gameplay.bridge.placed = 0; gameplay.bridge.assisted = false;
                gameplay.bridge.planks.forEach((plank, index) => { plank.owner = null; plank.placed = false; plank.x = BRIDGE_PLANKS[index][3]; plank.y = BRIDGE_PLANKS[index][4]; });
            }
            if (phaseDuration === 0) break;
        }
        this.#tickReversal(elapsed, now);
        this.room.revision += 1;
        return { advanced: true, revision: this.room.revision, expiredSlots, snapshot: this.snapshot() };
    }
}

module.exports = { AuthoritativeRuntime, DECK_RANGES, PRESENTATION_SEQUENCE, RuntimeError };
