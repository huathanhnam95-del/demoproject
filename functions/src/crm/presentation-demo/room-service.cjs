'use strict';

const crypto = require('node:crypto');
const { assertActiveIdentity, assertPresenter, assertRoomActor } = require('./identity.cjs');
const {
    ACTIVE_LIFECYCLES,
    PARTICIPANT_SLOT_IDS,
    clone,
    createRoomState,
    fail,
    normalizeRoomCode,
    publicRoomSnapshot,
    validateRoomState
} = require('./contracts.cjs');
const { createMemoryRuntimeStore } = require('./runtime-store.cjs');
const { createMemoryOperationStore } = require('./operation-store.cjs');

const DAY_MS = 24 * 60 * 60 * 1000;
const TICKET_MS = 60 * 1000;

function createMemoryRoomStores() {
    const rooms = new Map();
    const codes = new Map();
    const presenterLocks = new Map();
    const runtime = createMemoryRuntimeStore();
    const operations = createMemoryOperationStore();
    const tickets = new Map();
    const notebooks = new Map();
    const archives = new Map();
    return { rooms, codes, presenterLocks, runtime, operations, tickets, notebooks, archives };
}

function createMutex() {
    let tail = Promise.resolve();
    return async function withLock(action) {
        const previous = tail;
        let release;
        tail = new Promise(resolve => { release = resolve; });
        await previous;
        try { return await action(); } finally { release(); }
    };

}

function defaultIdFactory() { return crypto.randomUUID().replace(/-/g, ''); }
function defaultTicketFactory() { return crypto.randomBytes(32).toString('base64url'); }

function publicResult(room, actorUid) {
    return { ...publicRoomSnapshot(room, actorUid), roomId: room.roomId, code: room.code };
}

function createRoomService({
    stores = createMemoryRoomStores(),
    clock = () => Date.now(),
    idFactory = defaultIdFactory,
    codeFactory,
    ticketFactory = defaultTicketFactory
} = {}) {
    const withLock = createMutex();
    const makeCode = codeFactory || (() => {
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    });

    async function getRoom(roomId) {
        const room = stores.rooms.get(String(roomId));
        return room ? clone(room) : null;
    }

    async function saveRoom(room) {
        validateRoomState(room);
        stores.rooms.set(room.roomId, clone(room));
        await stores.runtime.set(room.roomId, room);
        return clone(room);
    }

    function activeRoomForPresenter(uid) {
        const roomId = stores.presenterLocks.get(uid);
        if (!roomId) return null;
        const room = stores.rooms.get(roomId);
        if (!room || !ACTIVE_LIFECYCLES.has(room.lifecycle)) {
            stores.presenterLocks.delete(uid);
            return null;
        }
        return room;
    }

    async function createOrResume(input, { operationId = null } = {}) {
        const identity = assertPresenter(input);
        return withLock(async () => stores.operations.run('create', operationId, { uid: identity.uid }, async () => {
            const existing = activeRoomForPresenter(identity.uid);
            if (existing) return publicResult(existing, identity.uid);
            let room = null;
            for (let attempt = 0; attempt < 12; attempt += 1) {
                const code = normalizeRoomCode(makeCode(attempt));
                if (!stores.codes.has(code)) {
                    room = createRoomState({ roomId: idFactory(), code, presenterUid: identity.uid, now: clock(), operationId });
                    break;
                }
            }
            if (!room) fail('ROOM_CODE_UNAVAILABLE');
            stores.codes.set(room.code, room.roomId);
            stores.presenterLocks.set(identity.uid, room.roomId);
            await saveRoom(room);
            return publicResult(room, identity.uid);
        }));
    }

    async function resolveRoom(codeOrId) {
        const value = String(codeOrId || '').trim();
        const roomId = stores.rooms.has(value) ? value : (value.length === 6 ? stores.codes.get(normalizeRoomCode(value)) : value);
        const room = roomId ? stores.rooms.get(roomId) : null;
        if (!room) fail('ROOM_NOT_FOUND', 'That room is not available.');
        return room;
    }

    async function join(input, codeOrId, { operationId = null } = {}) {
        const identity = assertActiveIdentity(input);
        return withLock(async () => stores.operations.run('join', operationId, { uid: identity.uid, room: String(codeOrId) }, async () => {
            const room = await resolveRoom(codeOrId);
            if (!ACTIVE_LIFECYCLES.has(room.lifecycle)) fail('ROOM_ENDED');
            const existing = Object.values(room.slots).find(slot => slot.uid === identity.uid);
            let slot = existing;
            if (!slot) {
                slot = PARTICIPANT_SLOT_IDS.map(slotId => room.slots[slotId]).find(candidate => !candidate.uid);
                if (!slot) fail('ROOM_FULL', 'All three participant slots are already reserved.');
                slot.uid = identity.uid;
                slot.displayName = identity.email ? identity.email.split('@')[0].slice(0, 80) : `Participant ${slot.slotId.slice(1)}`;
                slot.originalRole = identity.isTeacher ? 'teacher' : 'participant';
                slot.joinedAt = clock();
            }
            await saveRoom(room);
            return { roomId: room.roomId, code: room.code, seatId: slot.slotId, role: slot.role, snapshot: publicResult(room, identity.uid) };
        }));
    }

    async function markBootstrap(input, roomId) {
        const identity = assertActiveIdentity(input);
        return withLock(async () => {
            const room = await resolveRoom(roomId);
            const membership = Object.values(room.slots).find(slot => slot.uid === identity.uid);
            assertRoomActor(identity, membership && { uid: membership.uid, seatId: membership.slotId, role: membership.role });
            if (!membership.bootstrapAt) membership.bootstrapAt = clock();
            const complete = PARTICIPANT_SLOT_IDS.every(slotId => room.slots[slotId].uid && room.slots[slotId].bootstrapAt);
            if (complete && !room.allParticipantsJoinedAt) room.allParticipantsJoinedAt = clock();
            await saveRoom(room);
            return publicResult(room, identity.uid);
        });
    }

    async function issueTicket(input, roomId) {
        const identity = assertActiveIdentity(input);
        const room = await resolveRoom(roomId);
        const membership = Object.values(room.slots).find(slot => slot.uid === identity.uid);
        assertRoomActor(identity, membership && { uid: membership.uid, seatId: membership.slotId, role: membership.role });
        const ticket = ticketFactory();
        const expiresAt = clock() + TICKET_MS;
        stores.tickets.set(ticket, { roomId: room.roomId, uid: identity.uid, seatId: membership.slotId, expiresAt, used: false });
        return { ticket, roomId: room.roomId, seatId: membership.slotId, role: membership.role, expiresAt };
    }

    async function consumeTicket(input, ticket, { markUsed = true } = {}) {
        const identity = assertActiveIdentity(input);
        const value = stores.tickets.get(String(ticket || ''));
        if (!value || value.used || value.expiresAt < clock() || value.uid !== identity.uid) fail('TICKET_INVALID');
        if (markUsed) value.used = true;
        return clone(value);
    }

    async function touchPresenter(input, roomId) {
        const identity = assertPresenter(input);
        return withLock(async () => {
            const room = await resolveRoom(roomId);
            if (room.presenterUid !== identity.uid) fail('ACTOR_MISMATCH');
            if (!ACTIVE_LIFECYCLES.has(room.lifecycle)) fail('ROOM_ENDED');
            room.lastPresenterActivityAt = clock();
            room.expiresAt = room.lastPresenterActivityAt + DAY_MS;
            await saveRoom(room);
            return publicResult(room, identity.uid);
        });
    }

    async function updateNotebookMetadata(roomId, seatId, metadata = {}) {
        return withLock(async () => {
            const room = stores.rooms.get(String(roomId));
            const slot = room?.slots?.[seatId];
            if (!room || !slot) fail('ROOM_NOT_FOUND');
            if (Array.isArray(metadata.notes)) slot.notes = clone(metadata.notes);
            if (Number.isSafeInteger(metadata.notesRevision)) slot.notesRevision = metadata.notesRevision;
            // Notebook edits are stored in their own page store and must not
            // consume the live runtime revision used by movement/deck input.
            stores.rooms.set(room.roomId, clone(room));
            return clone(room);
        });
    }

    async function end(input, roomId, reason = 'explicit') {
        const identity = assertPresenter(input);
        return withLock(async () => {
            const room = await resolveRoom(roomId);
            if (room.presenterUid !== identity.uid) fail('ACTOR_MISMATCH');
            if (room.lifecycle === 'ended') return clone(room);
            room.lifecycle = 'ended';
            room.endedAt = clock();
            room.endReason = reason;
            room.archiveStatus = 'pending';
            room.revision += 1;
            await saveRoom(room);
            stores.presenterLocks.delete(identity.uid);
            return clone(room);
        });
    }

    async function syncRuntimeState(roomId, runtimeState) {
        return withLock(async () => {
            const current = await getRoom(roomId);
            if (!current || current.lifecycle === 'ended') fail('ROOM_ENDED');
            validateRoomState(runtimeState);
            if (runtimeState.roomId !== current.roomId || runtimeState.revision < current.revision) fail('RUNTIME_REVISION_STALE');
            stores.rooms.set(roomId, clone(runtimeState));
            await stores.runtime.set(roomId, runtimeState);
            return clone(runtimeState);
        });
    }

    async function markArchiveStatus(roomId, status) {
        return withLock(async () => {
            const room = stores.rooms.get(roomId);
            if (!room || room.lifecycle !== 'ended') fail('ROOM_NOT_FOUND');
            room.archiveStatus = status;
            stores.rooms.set(roomId, clone(room));
            await stores.runtime.set(roomId, room);
            return clone(room);
        });
    }

    async function expireDue() {
        return withLock(async () => {
            const ended = [];
            for (const room of stores.rooms.values()) {
                if (ACTIVE_LIFECYCLES.has(room.lifecycle) && room.expiresAt <= clock()) {
                    room.lifecycle = 'ended';
                    room.endedAt = clock();
                    room.endReason = 'expired';
                    room.archiveStatus = 'pending';
                    room.revision += 1;
                    await saveRoom(room);
                    stores.presenterLocks.delete(room.presenterUid);
                    ended.push(clone(room));
                }
            }
            return ended;
        });
    }

    return { createOrResume, end, expireDue, getRoom, issueTicket, join, markArchiveStatus, markBootstrap, consumeTicket, syncRuntimeState, touchPresenter, updateNotebookMetadata, stores };
}

module.exports = { DAY_MS, TICKET_MS, createMemoryRoomStores, createRoomService };
