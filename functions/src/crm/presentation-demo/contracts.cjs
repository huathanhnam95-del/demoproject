'use strict';

const ROOM_SCHEMA_VERSION = 2;
const PROTOCOL_VERSION = 2;
const CONTENT_VERSION = 'bel-working-as-equals-1';
const SIMULATION_VERSION = 'authoritative-v2';
const SLOT_IDS = Object.freeze(['p0', 'p1', 'p2', 'p3']);
const PARTICIPANT_SLOT_IDS = Object.freeze(SLOT_IDS.slice(1));
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;
const LIFECYCLES = Object.freeze(['reception', 'playing', 'ended']);
const SCENES = Object.freeze(['home', 'street', 'reception', 'A', 'B1', 'B2', 'B3', 'C', 'D', 'E', 'F', 'G', 'I', 'J']);
const ACTIVE_LIFECYCLES = new Set(['reception', 'playing']);
const MAX_DISPLAY_NAME = 80;
const MAX_NOTE_BODY = 50000;

function fail(code, message = code) {
    const error = new Error(message);
    error.code = code;
    throw error;
}

function isPlainRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function clone(value) {
    return structuredClone(value);
}

function exactKeys(value, allowed, required = allowed) {
    if (!isPlainRecord(value)) fail('INVALID_PAYLOAD');
    for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('COMMAND_EXTRA_FIELD');
    for (const key of required) if (!Object.hasOwn(value, key)) fail('COMMAND_MISSING_FIELD');
}

function isUid(value) {
    return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
}

function isRoomId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{6,128}$/.test(value);
}

function normalizeRoomCode(value) {
    const code = String(value ?? '').replace(/[\s-]/g, '').toUpperCase();
    if (code.length !== ROOM_CODE_LENGTH || [...code].some(char => !ROOM_CODE_ALPHABET.includes(char))) {
        fail('ROOM_CODE_INVALID', 'Enter a six-character room code.');
    }
    return code;
}

function makePosition(slotIndex) {
    return { x: slotIndex === 0 ? 96 : 120 + slotIndex * 24, y: 220 };
}

function createRoomState({ roomId, code, presenterUid, now = Date.now(), operationId = null } = {}) {
    if (!isRoomId(roomId) || !isUid(presenterUid)) fail('ROOM_INVALID');
    const normalizedCode = normalizeRoomCode(code);
    const slots = Object.fromEntries(SLOT_IDS.map((slotId, index) => [slotId, {
        slotId,
        role: index === 0 ? 'presenter' : 'participant',
        uid: index === 0 ? presenterUid : null,
        displayName: index === 0 ? 'Presenter' : `Participant ${index}`,
        originalRole: index === 0 ? 'admin' : 'participant',
        joinedAt: index === 0 ? now : null,
        connected: false,
        connectionGeneration: 0,
        lastSeenAt: null,
        position: makePosition(index),
        customization: { hat: 'none', glasses: false, shirt: index === 0 ? 'blue' : 'teal' },
        scene: index === 0 ? 'reception' : 'home',
        instanceId: index === 0 ? 'reception' : `home:p${index}`,
        activity: { ready: false, state: null },
        relationship: { leader: null, follower: null, carry: null, handhold: null },
        notesRevision: 0,
        notes: []
    }]));
    return {
        schemaVersion: ROOM_SCHEMA_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        contentVersion: CONTENT_VERSION,
        simulationVersion: SIMULATION_VERSION,
        roomId,
        code: normalizedCode,
        presenterUid,
        lifecycle: 'reception',
        revision: 0,
        createdAt: now,
        lastPresenterActivityAt: now,
        expiresAt: now + 24 * 60 * 60 * 1000,
        allParticipantsJoinedAt: null,
        startedAt: null,
        endedAt: null,
        endReason: null,
        archiveStatus: 'live',
        owner: { gatewayId: null, ownerEpoch: 0, leaseUntil: 0 },
        lastCommandSeq: Object.fromEntries(SLOT_IDS.map(slotId => [slotId, 0])),
        deck: { room: null, slide: 1, steps: {}, finalPage: 'determine', etaOrigin: null, properties: { showQuotes: true, showFolio: true, photoTreatment: 'Black and white' } },
        activity: { id: null, phase: null, state: null },
        gameplay: {
            version: 1,
            bridge: { generation: 0, phase: 'gathering', remaining: 60000, placed: 0, assisted: false, planks: [] },
            reversal: { phase: 'gathering', index: 0, remaining: 0, results: [], debuffs: { p1: 0, p2: 0, p3: 0 } },
            cubes: { pairs: [false, false, false], matchedAt: [], cubes: [] },
            objects: {}
        },
        slots,
        operationId
    };
}

function validateRoomState(room) {
    if (!isPlainRecord(room) || room.schemaVersion !== ROOM_SCHEMA_VERSION || room.protocolVersion !== PROTOCOL_VERSION) fail('ROOM_INVALID');
    if (!isRoomId(room.roomId) || !isUid(room.presenterUid)) fail('ROOM_INVALID');
    if (normalizeRoomCode(room.code) !== room.code || !LIFECYCLES.includes(room.lifecycle)) fail('ROOM_INVALID');
    if (!Number.isSafeInteger(room.revision) || room.revision < 0) fail('ROOM_INVALID');
    if (room.gameplay !== undefined && !isPlainRecord(room.gameplay)) fail('ROOM_INVALID');
    if (!Number.isFinite(room.createdAt) || !Number.isFinite(room.lastPresenterActivityAt) || !Number.isFinite(room.expiresAt)) fail('ROOM_INVALID');
    if (!isPlainRecord(room.slots) || JSON.stringify(Object.keys(room.slots)) !== JSON.stringify(SLOT_IDS)) fail('ROOM_INVALID');
    for (const [index, slotId] of SLOT_IDS.entries()) {
        const slot = room.slots[slotId];
        if (!isPlainRecord(slot) || slot.slotId !== slotId || slot.role !== (index === 0 ? 'presenter' : 'participant')) fail('ROOM_INVALID');
        if (slot.uid !== null && !isUid(slot.uid)) fail('ROOM_INVALID');
        if (!isPlainRecord(slot.position) || !Number.isFinite(slot.position.x) || !Number.isFinite(slot.position.y)) fail('ROOM_INVALID');
        if (!isPlainRecord(slot.activity) || typeof slot.activity.ready !== 'boolean') fail('ROOM_INVALID');
        if (!isPlainRecord(slot.relationship)) fail('ROOM_INVALID');
        if (!Number.isSafeInteger(slot.connectionGeneration) || slot.connectionGeneration < 0) fail('ROOM_INVALID');
        if (!Array.isArray(slot.notes)) fail('ROOM_INVALID');
        for (const note of slot.notes) {
            if (!isPlainRecord(note) || !/^[A-Za-z0-9:_-]{1,128}$/.test(note.id) || typeof note.title !== 'string' || note.title.length > 200 || typeof note.body !== 'string' || note.body.length > MAX_NOTE_BODY || !Number.isSafeInteger(note.version) || note.version < 1) fail('ROOM_INVALID');
        }
    }
    if (room.slots.p0.uid !== room.presenterUid || room.slots.p0.joinedAt === null) fail('ROOM_INVALID');
    const joinedUids = SLOT_IDS.map(slotId => room.slots[slotId].uid).filter(Boolean);
    if (new Set(joinedUids).size !== joinedUids.length) fail('ROOM_INVALID');
    return room;
}

function publicSlotSnapshot(slot, actorUid) {
    const result = {
        slotId: slot.slotId,
        role: slot.role,
        uid: slot.uid,
        displayName: slot.displayName,
        joinedAt: slot.joinedAt,
        connected: slot.connected === true,
        position: clone(slot.position),
        customization: clone(slot.customization),
        scene: slot.scene,
        instanceId: slot.instanceId,
        activity: clone(slot.activity),
        relationship: clone(slot.relationship)
    };
    if (slot.uid === actorUid) result.notesRevision = slot.notesRevision;
    return result;
}

function publicRoomSnapshot(room, actorUid = null) {
    validateRoomState(room);
    return {
        schemaVersion: room.schemaVersion,
        protocolVersion: room.protocolVersion,
        contentVersion: room.contentVersion,
        simulationVersion: room.simulationVersion,
        roomId: room.roomId,
        code: room.code,
        presenterUid: room.presenterUid,
        lifecycle: room.lifecycle,
        revision: room.revision,
        createdAt: room.createdAt,
        allParticipantsJoinedAt: room.allParticipantsJoinedAt,
        startedAt: room.startedAt,
        endedAt: room.endedAt,
        endReason: room.endReason,
        expiresAt: room.expiresAt,
        deck: clone(room.deck),
        activity: clone(room.activity),
        gameplay: clone(room.gameplay || null),
        slots: Object.fromEntries(SLOT_IDS.map(slotId => [slotId, publicSlotSnapshot(room.slots[slotId], actorUid)]))
    };
}

function validateClientCommand(command) {
    if (!isPlainRecord(command) || typeof command.type !== 'string') fail('COMMAND_TYPE_FORBIDDEN');
    if (command.type === 'move') {
        exactKeys(command, ['type', 'seq', 'dx', 'dy']);
        if (!Number.isSafeInteger(command.seq) || command.seq < 1) fail('COMMAND_INVALID_SEQ');
        if (![command.dx, command.dy].every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1)) fail('COMMAND_INVALID_VECTOR');
        return clone(command);
    }
    if (command.type === 'transition') {
        exactKeys(command, ['type', 'seq', 'to']);
        if (!Number.isSafeInteger(command.seq) || command.seq < 1) fail('COMMAND_INVALID_SEQ');
        if (command.to !== 'playing') fail('COMMAND_TRANSITION_FORBIDDEN');
        return clone(command);
    }
    if (command.type === 'setReady') {
        exactKeys(command, ['type', 'seq', 'ready']);
        if (!Number.isSafeInteger(command.seq) || command.seq < 1 || typeof command.ready !== 'boolean') fail('COMMAND_INVALID_READY');
        return clone(command);
    }
    if (command.type === 'activity') {
        exactKeys(command, ['type', 'seq', 'action', 'payload'], ['type', 'seq', 'action']);
        if (!Number.isSafeInteger(command.seq) || command.seq < 1 || !['bridge', 'reversal', 'cubes', 'skip', 'reset'].includes(command.action)) fail('COMMAND_ACTIVITY_FORBIDDEN');
        if (Object.hasOwn(command, 'payload') && !isPlainRecord(command.payload)) fail('COMMAND_INVALID_PAYLOAD');
        return clone(command);
    }
    if (command.type === 'slide') {
        exactKeys(command, ['type', 'seq', 'room', 'slide', 'step'], ['type', 'seq', 'room', 'slide']);
        if (!Number.isSafeInteger(command.seq) || command.seq < 1 || typeof command.room !== 'string' || !Number.isSafeInteger(command.slide) || command.slide < 1 || (Object.hasOwn(command, 'step') && (!Number.isSafeInteger(command.step) || command.step < 0))) fail('COMMAND_SLIDE_INVALID');
        return clone(command);
    }
    fail('COMMAND_TYPE_FORBIDDEN');
}

module.exports = {
    ACTIVE_LIFECYCLES,
    CONTENT_VERSION,
    LIFECYCLES,
    MAX_DISPLAY_NAME,
    MAX_NOTE_BODY,
    PARTICIPANT_SLOT_IDS,
    PROTOCOL_VERSION,
    ROOM_CODE_ALPHABET,
    ROOM_CODE_LENGTH,
    ROOM_SCHEMA_VERSION,
    SCENES,
    SIMULATION_VERSION,
    SLOT_IDS,
    clone,
    createRoomState,
    fail,
    isPlainRecord,
    isUid,
    normalizeRoomCode,
    publicRoomSnapshot,
    validateClientCommand,
    validateRoomState
};
