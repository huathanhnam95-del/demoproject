'use strict';

const crypto = require('node:crypto');
const { AuthoritativeRuntime } = require('./runtime.cjs');
const { createRoomAuthority } = require('./authority-service.cjs');
const { assertActiveIdentity } = require('./identity.cjs');
const { fail, publicRoomSnapshot, assertOperationEnabled } = require('./contracts.cjs');

function createConnectionService({ roomService, clock = Date.now, gatewayId = 'gateway-' + crypto.randomUUID(), runtimeFactory = room => new AuthoritativeRuntime(room, { clock }), autoStart = true } = {}) {
    if (!roomService?.authorityStore) throw new TypeError('roomService.authorityStore is required');
    const store = roomService.authorityStore;
    const authority = createRoomAuthority({ store, clock, gatewayId, runtimeFactory, autoStart });
    const connections = new Map(), runtimes = new Map(), tails = new Map();

    async function serial(key, action) {
        const previous = tails.get(key) || Promise.resolve();
        const next = previous.catch(() => {}).then(action);
        tails.set(key, next);
        try { return await next; } finally { if (tails.get(key) === next) tails.delete(key); }
    }
    // This is a read-only inspection facade. Only the leased authority
    // commits runtime mutations.
    async function getRuntime(roomId) {
        await store.ensure(roomId);
        const room = await store.read(roomId);
        if (!room) fail('ROOM_NOT_FOUND');
        const runtime = runtimeFactory(room);
        runtimes.set(roomId, runtime);
        return runtime;
    }
    async function open(input, ticket, { replaceExisting = false } = {}) {
        assertOperationEnabled('mutation');
        const identity = assertActiveIdentity(input);
        const rawTicket = ticket.ticket || ticket;
        return serial('ticket:' + rawTicket, async () => {
            const admission = await roomService.consumeTicket(identity, rawTicket, { markUsed: false });
            const admittedRoom = await store.read(admission.roomId);
            const seat = admittedRoom?.slots[admission.seatId];
            if (seat?.connected && clock() - seat.lastSeenAt <= 20000 && !replaceExisting) fail('CONNECTION_EXISTS', 'This seat is already active on another device.');
            // The durable single-use ticket is consumed before queueing an
            // admission; two gateways cannot both return the same capability.
            await roomService.consumeTicket(identity, rawTicket, { markUsed: true });
            const id = 'connect:' + crypto.createHash('sha256').update(String(rawTicket)).digest('hex') + (replaceExisting ? ':replace' : ':new');
            const result = await authority.submit(admission.roomId, { kind: 'connect', id, identity, seatId: admission.seatId, replaceExisting });
            const connectionId = crypto.randomUUID();
            const context = { connectionId, roomId: admission.roomId, seatId: admission.seatId, uid: identity.uid, role: admission.role, generation: result.generation, authContext: identity };
            connections.set(connectionId, context);
            return { ...context, authContext: undefined, snapshot: publicRoomSnapshot(await store.read(admission.roomId), identity.uid) };
        });
    }
    function actor(context, input) {
        const current = connections.get(context?.connectionId);
        if (!current || current.uid !== context.uid || current.roomId !== context.roomId || current.seatId !== context.seatId) fail('STALE_CONNECTION');
        const identity = assertActiveIdentity(input || current.authContext);
        if (identity.uid !== current.uid) fail('ACTOR_MISMATCH');
        if (current.role === 'presenter' && !identity.isAdmin) fail('PRESENTER_ONLY');
        return { current, identity };
    }
    async function submit(context, input, kind, command = undefined, commandId = null) {
        assertOperationEnabled('mutation');
        const { current, identity } = actor(context, input);
        return serial(current.connectionId, async () => {
            const result = await authority.submit(current.roomId, { kind, identity, seatId: current.seatId, generation: current.generation, id: commandId || crypto.randomUUID(), ...(command ? { command } : {}) });
            return { ...result, snapshot: publicRoomSnapshot(await store.read(current.roomId), identity.uid) };
        });
    }
    async function heartbeat(context, identity = null) { return submit(context, identity, 'heartbeat'); }
    async function input(context, command, identity = null, { commandId = null } = {}) { return submit(context, identity, 'input', command, commandId); }
    async function close(context, identity = null) {
        try { return await submit(context, identity, 'disconnect'); }
        finally { if (context?.connectionId) connections.delete(context.connectionId); }
    }
    function subscribe(context, callback, revoked = () => {}) {
        actor(context);
        let revision = -1;
        return store.onSnapshot(context.roomId, room => {
            if (!room || room.revision === revision) return;
            const slot = room.slots[context.seatId];
            if (slot?.uid !== context.uid || slot.connectionGeneration !== context.generation) { revoked('STALE_CONNECTION'); return; }
            revision = room.revision;
            callback(publicRoomSnapshot(room, context.uid));
        });
    }
    function validate(context, identity) { return actor(context, identity); }
    async function shutdown() { authority.close(); await authority.drain(); connections.clear(); runtimes.clear(); }
    return {
        authority, connections, roomService, runtimes, getRuntime, open, heartbeat, input, close, subscribe, validate, shutdown,
        heartbeatById: (id, identity) => heartbeat(connections.get(id), identity),
        inputById: (id, command, identity, options) => input(connections.get(id), command, identity, options),
        closeById: (id, identity) => close(connections.get(id), identity)
    };
}

module.exports = { createConnectionService };
