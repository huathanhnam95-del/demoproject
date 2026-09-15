'use strict';

const { createWorld, stepWorld, act, monitorPresence, drop, release, transition, solidsFor } = require('./core/world/simulation.mjs');
const { SCENES, entry } = require('./core/world/scenes.mjs');
const { safeAnchor, valid } = require('./core/world/geometry.mjs');
const { presentationReadiness } = require('./core/state/progression.mjs');
const { GROUPS } = require('./core/content/source.mjs');
const { fail } = require('./contracts.cjs');
const { tickBridge } = require('./core/activities/bridge.mjs');
const { tickReversal } = require('./core/activities/reversal.mjs');

function baseState(room) {
    const world = room.gameplay;
    return {
        id: room.roomId, online: true,
        presentation: world.presentation || { active: false, roomId: null },
        pauseReasons: world.paused ? ['presenter'] : [],
        players: Object.fromEntries(Object.entries(room.slots).map(([id, slot]) => {
            const player = world.players?.[id];
            return [id, { id, name: slot.displayName, connected: !!slot.uid && slot.connected, ready: slot.activity.ready,
                appearance: slot.customization,
                location: { sceneId: player?.scene || slot.scene, instanceId: player?.instance || slot.instanceId,
                    atScreen: player ? monitorPresence(player, slot.connected, world) : false } }];
        }))
    };
}

function ensureWorld(room) {
    if (!room.gameplay?.players) {
        const world = createWorld(baseState(room));
        world.presentation = { active: false, roomId: null };
        world.paused = false; world.inputs = {};
        room.gameplay = world;
        room.deck = world.deck;
    }
    room.gameplay.inputs ||= {};
    room.gameplay.presentation ||= { active: false, roomId: null };
    for (const player of Object.values(room.gameplay.players)) {
        for (const key of ['leader', 'follower', 'carry', 'request', 'seat', 'ride']) player[key] ??= null;
        if (player.carry && carriedObject(room.gameplay, player)?.owner !== player.id) player.carry = null;
        for (const key of ['leader', 'follower']) {
            const other = room.gameplay.players[player[key]], inverse = key === 'leader' ? 'follower' : 'leader';
            if (player[key] && (!other || other.instance !== player.instance || other[inverse] !== player.id)) player[key] = null;
        }
    }
    for (const [scene, objects] of Object.entries({ ...room.gameplay.routes, F: room.gameplay.bridge.planks, J: room.gameplay.cubes.cubes })) {
        for (const object of objects) {
            const owner = room.gameplay.players[object.owner];
            if (object.owner && (object.placed || !owner || owner.scene !== scene || owner.carry !== object.id)) object.owner = null;
        }
    }
    for (const player of Object.values(room.gameplay.players)) if (player.carry && carriedObject(room.gameplay, player)?.owner !== player.id) player.carry = null;
    room.gameplay.cubes.cubes.forEach((cube, index) => { cube.index = index; });
    room.gameplay.deck = room.deck;
    syncSlots(room);
    return room.gameplay;
}

function syncSlots(room) {
    for (const [id, player] of Object.entries(room.gameplay.players)) {
        const slot = room.slots[id];
        if (slot.instanceId !== player.instance) { slot.activity.ready = false; slot.sceneEnteredAt = room.lastTickAt; }
        slot.scene = player.scene; slot.instanceId = player.instance;
        slot.position = { x: player.x, y: player.y };
        slot.relationship = { leader: player.leader ?? null, follower: player.follower ?? null, carry: player.carry ?? null, handhold: player.request ?? null };
        player.connected = !!slot.uid && slot.connected;
    }
    room.deck = room.gameplay.deck;
}

function disconnectWorld(room, id) {
    const world = ensureWorld(room);
    const player = world.players[id];
    const object = carriedObject(world, player);
    const hint = { scene: player.scene, instance: player.instance, bridgeGeneration: world.bridge.generation,
        seat: player.seat, ride: player.ride, carry: player.carry, partner: player.leader || player.follower, object: null };
    drop(world, id); release(world, id); delete world.inputs[id];
    if (object) hint.object = { x: object.x, y: object.y, placed: object.placed };
    room.slots[id].resumeHint = hint;
    player.connected = false; player.seat = null; player.ride = null;
    Object.assign(player, safeAnchor(player, SCENES[player.scene], solidsFor(world, id)));
    syncSlots(room);
}

function carriedObject(world, player, objectId = player.carry) {
    const list = player.scene === 'F' ? world.bridge.planks : player.scene === 'J' ? world.cubes.cubes : world.routes[player.scene];
    return list?.find(object => object.id === objectId) || null;
}

function reconnectWorld(room, id, now) {
    const world = ensureWorld(room), player = world.players[id], slot = room.slots[id], hint = slot.resumeHint;
    let reason = null;
    const nextScene = world.gStarted && player.scene === 'F' ? 'G' : world.cStarted && player.scene.startsWith('B') ? 'C' : null;
    if (nextScene) { transition(world, id, nextScene, now); reason = 'section-completed'; }
    else if (hint && player.scene === 'F' && hint.bridgeGeneration !== world.bridge.generation) {
        player.carry = null; player.seat = null; Object.assign(player, safeAnchor(entry('F', id), SCENES.F, solidsFor(world, id))); reason = 'activity-reset';
    }
    if (hint && !reason && hint.instance === player.instance) {
        if (hint.seat && SCENES[player.scene].targets.some(target => target.id === hint.seat && target.type === 'seat') &&
            !Object.values(world.players).some(other => other.id !== id && other.connected && other.instance === player.instance && other.seat === hint.seat)) {
            const seat = SCENES[player.scene].targets.find(target => target.id === hint.seat);
            player.seat = hint.seat; player.x = seat.x; player.y = seat.y;
        }
        if (hint.ride && ['home', 'street'].includes(player.scene)) player.ride = hint.ride;
        const object = hint.carry && carriedObject(world, player, hint.carry);
        if (object && !object.owner && !object.placed && hint.object && object.x === hint.object.x && object.y === hint.object.y && object.placed === hint.object.placed) {
            object.owner = id; player.carry = object.id;
        }
    }
    // Recovery may retain a mutual, live relationship. A released invitation
    // never recreates consent, and an object claim never overrides its owner.
    for (const key of ['leader', 'follower']) {
        const other = world.players[player[key]], inverse = key === 'leader' ? 'follower' : 'leader';
        if (player[key] && (!other || !other.connected || other.instance !== player.instance || other[inverse] !== id)) player[key] = null;
    }
    if (player.carry && carriedObject(world, player)?.owner !== id) player.carry = null;
    if (player.seat && Object.values(world.players).some(other => other.id !== id && other.connected && other.instance === player.instance && other.seat === player.seat)) player.seat = null;
    if (!valid(player, SCENES[player.scene], solidsFor(world, id), player.ride ? 15 : 10)) {
        Object.assign(player, safeAnchor(player, SCENES[player.scene], solidsFor(world, id), player.ride ? 15 : 10)); reason ||= 'floor-reconciled';
    }
    player.pose = player.seat ? 'seated' : player.ride ? 'coasting' : player.carry ? 'carrying' : 'idle';
    delete slot.resumeHint; slot.recoveryReason = reason; slot.activity.ready = false;
    syncSlots(room);
}

function tickWorld(room, now, elapsed) {
    const world = ensureWorld(room);
    const base = baseState(room);
    // 25 Hz simulation, grouped into the authority's 10 Hz commits. Inputs
    // expire after 300 ms; elapsed activity time continues across recovery.
    if (base.pauseReasons.length || base.presentation.active) {
        stepWorld(world, base, {}, 0, now); world.tickAt = now; syncSlots(room); return;
    }
    // Movement integration stays bounded. Activity time is never discarded
    // after a long owner-free interval: advance older time by phase boundaries.
    let older = Math.max(0, elapsed - 180000);
    while (older > 0) {
        const phases = [world.bridge, world.reversal].filter(activity => activity.remaining > 0 && !['gathering', 'complete'].includes(activity.phase));
        if (!phases.length) break;
        const step = Math.min(older, ...phases.map(activity => activity.remaining));
        tickBridge(world, base, step, false); tickReversal(world, base, step, false); older -= step;
    }
    const start = now - Math.min(180000, Math.max(0, elapsed));
    for (let time = start; time < now;) {
        const step = Math.min(40, now - time); time += step;
        stepWorld(world, base, world.inputs, step / 1000, time);
    }
    world.revision += 1;
    world.tickAt = now;
    syncSlots(room);
}

function worldCommand(room, slot, command, now) {
    const world = ensureWorld(room), id = slot.slotId;
    let base = baseState(room);
    if (command.type === 'move') {
        world.inputs[id] = { keys: { a: command.dx < 0, d: command.dx > 0, w: command.dy < 0, s: command.dy > 0 }, at: now, blocked: false };
        return { accepted: true, type: 'move' };
    }
    if (command.type === 'setReady') {
        if (command.instance !== world.players[id].instance) fail('STALE_SCENE');
        slot.activity.ready = command.ready;
        return { accepted: true, type: command.type, ready: command.ready };
    }
    if (command.type === 'transition') {
        if (id !== 'p0') fail('PRESENTER_ONLY');
        if (room.lifecycle !== 'reception') fail('TRANSITION_INVALID');
        if (!['p1', 'p2', 'p3'].every(id => room.slots[id].uid)) fail('PARTICIPANTS_NOT_JOINED');
        if (!['p1', 'p2', 'p3'].every(id => room.slots[id].bootstrapAt)) fail('PARTICIPANTS_NOT_READY');
        room.allParticipantsJoinedAt ||= now; room.startedAt ||= now; room.lifecycle = 'playing';
        return { accepted: true, type: command.type, lifecycle: 'playing' };
    }
    if (command.type === 'profile') {
        slot.displayName = command.name;
        slot.customization = { ...slot.customization, ...command.appearance };
        return { accepted: true, type: command.type };
    }
    if (command.type === 'presentation') {
        if (id !== 'p0') fail('PRESENTER_ONLY');
        if (command.action === 'pause' || command.action === 'resume') world.paused = command.action === 'pause';
        else if (command.action === 'open') {
            if (room.lifecycle !== 'playing') fail('PRESENTATION_NOT_STARTED');
            const scene = world.players.p0.scene;
            if (!GROUPS[scene] || !presentationReadiness(base, scene).ready) fail('ARRIVAL_REQUIRED', 'Gather the connected players and approach the monitor.');
            world.presentation = { active: true, roomId: scene };
        } else {
            if (!world.presentation.active) fail('PRESENTATION_NOT_STARTED');
            const [, last] = GROUPS[world.presentation.roomId];
            // Slide 19 introduces the floor activity. Returning to the room
            // permits its timer; the I exit stays locked until slide 20.
            if (world.presentation.roomId !== 'I' && world.deck.slide !== last) fail('PROGRESSION_REQUIRED', 'Finish the current presentation before leaving.');
            world.presentation = { active: false, roomId: null };
        }
        stepWorld(world, baseState(room), {}, 0, now);
        syncSlots(room);
        return { accepted: true, type: command.type };
    }
    let action;
    if (command.type === 'world') action = { type: command.action, payload: command.payload };
    else if (command.type === 'slide') {
        const range = GROUPS[command.room];
        if (!range || command.slide < range[0] || command.slide > range[1]) fail('COMMAND_SLIDE_INVALID');
        if (command.room !== world.presentation.roomId || Math.abs(command.slide - world.deck.slide) !== 1) fail('PROGRESSION_REQUIRED');
        action = { type: 'slide', payload: { action: command.slide > world.deck.slide ? 'next' : 'previous' } };
    } else if (command.type === 'activity') {
        const player = world.players[id];
        if (command.payload?.instance !== player.instance || player.scene === 'F' && command.payload?.generation !== world.bridge.generation) fail('STALE_SCENE');
        action = { type: 'activity', payload: { action: command.payload?.op || command.action, instance: player.instance, generation: world.bridge.generation } };
    } else fail('COMMAND_TYPE_FORBIDDEN');
    if (room.lifecycle !== 'playing' && (action.type === 'skip' || (action.type === 'enter' && world.players[id].scene === 'reception' && action.payload?.target === 'studio'))) fail('PARTICIPANTS_NOT_READY');
    if (action.type === 'activity' && world.players[id].scene === 'J' && action.payload?.action === 'assist') {
        if (id !== 'p0') fail('PRESENTER_ONLY');
        if (world.presentation.active || world.paused) fail('WORLD_PAUSED');
        if (action.payload.instance !== world.players[id].instance) fail('STALE_SCENE');
        const available = Object.values(room.slots).filter(slot => slot.connected && slot.uid && world.players[slot.slotId].scene === 'J');
        if (available.length >= 2) fail('ASSIST_NOT_REQUIRED', 'Two connected players can complete the normal matches.');
        world.cubes.assistedPairs ||= [false, false, false];
        for (let pair = 0; pair < 3; pair++) if (!world.cubes.pairs[pair]) {
            world.cubes.pairs[pair] = true; world.cubes.assistedPairs[pair] = true;
            world.cubes.assistedAt = now;
            world.cubes.cubes.filter(cube => cube.pair === pair).forEach((cube, offset) => {
                if (cube.owner) world.players[cube.owner].carry = null;
                Object.assign(cube, { owner: null, placed: true, x: 400 + pair * 86 + offset * 30, y: 246 });
            });
        }
        syncSlots(room);
        return { accepted: true, type: command.type, kind: 'toast', text: 'Remaining objectives completed with presenter assistance.' };
    }
    if (action.type === 'social' && action.payload?.action === 'notes' && action.payload?.target !== id && id !== 'p0') fail('NOTES_PRIVATE', 'Each participant has a private notebook.');
    const result = act(world, base, id, action, now);
    syncSlots(room);
    return { accepted: true, type: command.type, ...result };
}

module.exports = { baseState, disconnectWorld, ensureWorld, reconnectWorld, syncSlots, tickWorld, worldCommand };
