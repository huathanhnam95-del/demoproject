'use strict';

const { clone, fail, validateRoomState } = require('./contracts.cjs');
const { AuthoritativeRuntime } = require('./runtime.cjs');

function reconcileRoomState(input) {
    const room = clone(input);
    validateRoomState(room);
    const slotIds = new Set(Object.keys(room.slots));
    for (const slot of Object.values(room.slots)) {
        const relationship = slot.relationship || {};
        const leader = slotIds.has(relationship.leader) && room.slots[relationship.leader]?.uid ? relationship.leader : null;
        const follower = slotIds.has(relationship.follower) && room.slots[relationship.follower]?.uid ? relationship.follower : null;
        const carry = typeof relationship.carry === 'string' && !relationship.carry.startsWith('missing') ? relationship.carry : null;
        const handhold = slotIds.has(relationship.handhold) && room.slots[relationship.handhold]?.uid ? relationship.handhold : null;
        slot.relationship = { leader, follower, carry, handhold };
    }
    return room;
}

function createReconciler({ roomService, runtimeFactory = room => new AuthoritativeRuntime(room) } = {}) {
    if (!roomService) throw new TypeError('roomService is required');
    async function restore(roomId) {
        const room = await roomService.getRoom(roomId);
        if (!room) fail('ROOM_NOT_FOUND');
        if (room.lifecycle === 'ended') fail('ROOM_ENDED');
        const reconciled = reconcileRoomState(room);
        const runtime = runtimeFactory(reconciled);
        return { ...reconciled, runtime, snapshot: runtime.snapshot() };
    }
    return { restore };
}

module.exports = { createReconciler, reconcileRoomState };
