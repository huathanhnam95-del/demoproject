'use strict';

const crypto = require('node:crypto');
const { AuthoritativeRuntime } = require('./runtime.cjs');
const { assertActiveIdentity } = require('./identity.cjs');
const { fail } = require('./contracts.cjs');

function createConnectionService({ roomService, clock = () => Date.now(), gatewayId = `gateway-${crypto.randomUUID()}`, runtimeFactory = room => new AuthoritativeRuntime(room, { clock }) } = {}) {
    if (!roomService) throw new TypeError('roomService is required');
    const runtimes = new Map();
    const connections = new Map();
    const roomTails = new Map();

    async function withRoomLock(roomId, action) {
        const key = String(roomId);
        const previous = roomTails.get(key) || Promise.resolve();
        let release;
        const current = new Promise(resolve => { release = resolve; });
        roomTails.set(key, current);
        await previous;
        try { return await action(); } finally {
            release();
            if (roomTails.get(key) === current) roomTails.delete(key);
        }
    }

    async function getRuntime(roomId) {
        const room = await roomService.getRoom(roomId);
        if (!room) fail('ROOM_NOT_FOUND');
        let runtime = runtimes.get(roomId);
        if (!runtime) {
            runtime = runtimeFactory(room);
            runtimes.set(roomId, runtime);
        } else if (runtime.room.revision < room.revision || roomService.refreshRuntimeOnRead === true) {
            runtime.refreshRoom(room);
        }
        return runtime;
    }

    function writeFence(state) {
        return {
            expectedRevision: state.revision,
            expectedGenerations: Object.fromEntries(Object.entries(state.slots || {}).map(([slotId, slot]) => [slotId, slot.connectionGeneration])),
            expectedOwner: state.owner?.gatewayId ? { gatewayId: state.owner.gatewayId, ownerEpoch: state.owner.ownerEpoch } : null
        };
    }

    async function ensureOwner(roomId, { force = false } = {}) {
        if (typeof roomService.claimRuntimeOwner !== 'function') return null;
        const result = await roomService.claimRuntimeOwner(roomId, gatewayId, clock(), { force });
        const runtime = runtimes.get(roomId);
        if (runtime && runtime.room.revision < result.room.revision) runtime.refreshRoom(result.room);
        return result.owner;
    }

    async function open(input, ticket, { replaceExisting = false } = {}) {
        const identity = assertActiveIdentity(input);
        const rawTicket = ticket.ticket || ticket;
        const admission = await roomService.consumeTicket(identity, rawTicket, { markUsed: false });
        return withRoomLock(admission.roomId, async () => {
            if (replaceExisting) await ensureOwner(admission.roomId, { force: true });
            const runtime = await getRuntime(admission.roomId);
            const baseState = runtime.rawState();
            const connectionId = crypto.randomUUID();
            const result = runtime.connect(admission.seatId, null, { replaceExisting, now: clock() });
            await roomService.consumeTicket(identity, rawTicket, { markUsed: true });
            runtime.markBootstrap(admission.seatId, clock());
            await roomService.syncRuntimeState(admission.roomId, runtime.rawState(), writeFence(baseState));
            const context = { connectionId, roomId: admission.roomId, seatId: admission.seatId, uid: identity.uid, role: admission.role, generation: result.generation, runtime, authContext: { uid: identity.uid, email: identity.email, accountStatus: identity.accountStatus, isAdmin: identity.isAdmin, isTeacher: identity.isTeacher, crmEligible: true } };
            connections.set(connectionId, context);
            return { connectionId, roomId: admission.roomId, seatId: admission.seatId, uid: identity.uid, role: admission.role, generation: result.generation, snapshot: runtime.snapshot(identity.uid) };
        });
    }

    async function contextFor(context, identity = null) {
        const current = connections.get(context?.connectionId);
        if (!current || current.uid !== context.uid || current.roomId !== context.roomId || current.seatId !== context.seatId) fail('STALE_CONNECTION');
        const currentIdentity = assertActiveIdentity(identity || current.authContext || context);
        if (currentIdentity.uid !== current.uid) fail('ACTOR_MISMATCH');
        const room = await roomService.getRoom(current.roomId);
        const membership = room && Object.values(room.slots).find(slot => slot.uid === currentIdentity.uid);
        if (!membership || membership.slotId !== current.seatId || membership.role !== current.role) fail('ACTOR_MISMATCH');
        if (current.role === 'presenter' && currentIdentity.isAdmin !== true) fail('PRESENTER_ONLY');
        return current;
    }

    async function heartbeat(context, identity = null) {
        const current = await contextFor(context, identity);
        return withRoomLock(current.roomId, async () => {
            await ensureOwner(current.roomId);
            await getRuntime(current.roomId);
            const baseState = current.runtime.rawState();
            current.runtime.tick(clock());
            const result = current.runtime.heartbeat(current.seatId, current.generation, clock());
            await roomService.syncRuntimeState(current.roomId, current.runtime.rawState(), writeFence(baseState));
            return result;
        });
    }

    async function input(context, command, identity = null, { commandId = null } = {}) {
        const current = await contextFor(context, identity);
        return withRoomLock(current.roomId, async () => {
            await ensureOwner(current.roomId);
            await getRuntime(current.roomId);
            if (commandId && typeof roomService.readRuntimeCommandReceipt === 'function') {
                const receipt = await roomService.readRuntimeCommandReceipt(current.roomId, current.seatId, commandId);
                if (receipt) return receipt;
                const persisted = await roomService.getRoom(current.roomId);
                if (Number(command?.seq) <= Number(persisted?.lastCommandSeq?.[current.seatId] || 0)) return { accepted: true, type: command?.type, replayed: true, revision: persisted.revision, snapshot: current.runtime.snapshot(current.uid) };
            }
            const baseState = current.runtime.rawState();
            current.runtime.tick(clock());
            const result = current.runtime.command(current.seatId, current.generation, command, clock());
            await roomService.syncRuntimeState(current.roomId, current.runtime.rawState(), writeFence(baseState));
            if (commandId && typeof roomService.writeRuntimeCommandReceipt === 'function') await roomService.writeRuntimeCommandReceipt(current.roomId, current.seatId, commandId, result);
            return result;
        });
    }

    async function close(context, identity = null) {
        const current = await contextFor(context, identity);
        return withRoomLock(current.roomId, async () => {
            await ensureOwner(current.roomId);
            await getRuntime(current.roomId);
            const baseState = current.runtime.rawState();
            current.runtime.setPresence(current.seatId, false, clock(), current.generation);
            await roomService.syncRuntimeState(current.roomId, current.runtime.rawState(), writeFence(baseState));
            connections.delete(current.connectionId);
            return { accepted: true };
        });
    }

    async function heartbeatById(connectionId, identity) {
        const context = connections.get(connectionId);
        return heartbeat(context, identity);
    }

    async function inputById(connectionId, command, identity, options = {}) {
        const context = connections.get(connectionId);
        return input(context, command, identity, options);
    }

    async function closeById(connectionId, identity) {
        const context = connections.get(connectionId);
        return close(context, identity);
    }

    return { close, closeById, connections, getRuntime, heartbeat, heartbeatById, input, inputById, open, roomService, runtimes };
}

module.exports = { createConnectionService };
