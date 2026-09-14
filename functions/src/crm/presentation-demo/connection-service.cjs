'use strict';

const crypto = require('node:crypto');
const { AuthoritativeRuntime } = require('./runtime.cjs');
const { assertActiveIdentity } = require('./identity.cjs');
const { fail } = require('./contracts.cjs');

function createConnectionService({ roomService, clock = () => Date.now(), runtimeFactory = room => new AuthoritativeRuntime(room, { clock }) } = {}) {
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
        let runtime = runtimes.get(roomId);
        if (!runtime) {
            const room = await roomService.getRoom(roomId);
            if (!room) fail('ROOM_NOT_FOUND');
            runtime = runtimeFactory(room);
            runtimes.set(roomId, runtime);
        }
        return runtime;
    }

    async function open(input, ticket, { replaceExisting = false } = {}) {
        const identity = assertActiveIdentity(input);
        const rawTicket = ticket.ticket || ticket;
        const admission = await roomService.consumeTicket(identity, rawTicket, { markUsed: false });
        return withRoomLock(admission.roomId, async () => {
            const runtime = await getRuntime(admission.roomId);
            const connectionId = crypto.randomUUID();
            const result = runtime.connect(admission.seatId, null, { replaceExisting, now: clock() });
            await roomService.consumeTicket(identity, rawTicket, { markUsed: true });
            runtime.markBootstrap(admission.seatId, clock());
            await roomService.syncRuntimeState(admission.roomId, runtime.rawState());
            const context = { connectionId, roomId: admission.roomId, seatId: admission.seatId, uid: identity.uid, role: admission.role, generation: result.generation, runtime };
            connections.set(connectionId, context);
            return { ...context, snapshot: runtime.snapshot(identity.uid) };
        });
    }

    function contextFor(context) {
        const current = connections.get(context?.connectionId);
        if (!current || current.uid !== context.uid || current.roomId !== context.roomId || current.seatId !== context.seatId) fail('STALE_CONNECTION');
        return current;
    }

    async function heartbeat(context) {
        const current = contextFor(context);
        return withRoomLock(current.roomId, async () => {
            current.runtime.requireGeneration(current.seatId, current.generation);
            const slot = current.runtime.room.slots[current.seatId];
            slot.lastSeenAt = clock();
            await roomService.syncRuntimeState(current.roomId, current.runtime.rawState());
            return { accepted: true, generation: current.generation, snapshot: current.runtime.snapshot(current.uid) };
        });
    }

    async function input(context, command) {
        const current = contextFor(context);
        return withRoomLock(current.roomId, async () => {
            const result = current.runtime.command(current.seatId, current.generation, command, clock());
            await roomService.syncRuntimeState(current.roomId, current.runtime.rawState());
            return result;
        });
    }

    async function close(context) {
        const current = contextFor(context);
        return withRoomLock(current.roomId, async () => {
            current.runtime.setPresence(current.seatId, false, clock(), current.generation);
            await roomService.syncRuntimeState(current.roomId, current.runtime.rawState());
            connections.delete(current.connectionId);
            return { accepted: true };
        });
    }

    async function heartbeatById(connectionId) {
        const context = connections.get(connectionId);
        return heartbeat(context);
    }

    async function inputById(connectionId, command) {
        const context = connections.get(connectionId);
        return input(context, command);
    }

    async function closeById(connectionId) {
        const context = connections.get(connectionId);
        return close(context);
    }

    return { close, closeById, connections, getRuntime, heartbeat, heartbeatById, input, inputById, open, roomService, runtimes };
}

module.exports = { createConnectionService };
