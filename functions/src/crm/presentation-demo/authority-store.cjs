'use strict';

const { createRoomState } = require('./contracts.cjs');
const copy = value => value == null ? value : structuredClone(value);
function merge(base, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return copy(value);
    const result = { ...(base || {}) };
    for (const [key, item] of Object.entries(value)) result[key] = item && typeof item === 'object' && !Array.isArray(item) ? merge(result[key], item) : copy(item);
    return result;
}
function hydrate(value) {
    if (!value) return null;
    const room = merge(createRoomState({ roomId: value.roomId, code: value.code, presenterUid: value.presenterUid, now: value.createdAt }), value);
    // RTDB represents dense numeric child keys as arrays, including holes.
    // Reveal steps are a numeric-keyed map, never a sparse Firestore array.
    for (const deck of [room.deck, room.gameplay?.deck]) if (deck) deck.steps = Object.fromEntries(Object.entries(deck.steps || {}).filter(([, step]) => Number.isSafeInteger(step)));
    return room;
}
function roomState(value) {
    const room = hydrate(value);
    if (room) { delete room._inbox; delete room._receipts; }
    return room;
}

function createMemoryAuthorityStore({ rooms = new Map() } = {}) {
    const inboxListeners = new Map(), changes = new Map(), archived = new Map();
    const notify = (map, id) => { for (const callback of map.get(id) || []) queueMicrotask(callback); };
    function listen(map, id, callback) {
        if (!map.has(id)) map.set(id, new Set());
        map.get(id).add(callback);
        return () => { map.get(id)?.delete(callback); if (!map.get(id)?.size) map.delete(id); };
    }
    async function transact(id, update) {
        const previous = copy(rooms.get(id));
        const next = update(hydrate(previous));
        if (next === undefined) return { committed: false, value: hydrate(previous) };
        rooms.set(id, copy(next));
        notify(changes, id);
        if (Object.keys(next?._inbox || {}).some(key => !previous?._inbox?.[key])) notify(inboxListeners, id);
        return { committed: true, value: hydrate(next) };
    }
    const store = {
        async ensure(id) { if (!rooms.has(id)) throw Object.assign(new Error('Room not found'), { code: 'ROOM_NOT_FOUND' }); },
        read: async id => hydrate(rooms.get(id)), transact,
        onInbox: (id, callback) => listen(inboxListeners, id, callback),
        onChange: (id, callback) => listen(changes, id, callback),
        onSnapshot: (id, callback) => listen(changes, id, async () => callback(roomState(await store.read(id)))),
        readReceipt: async (id, key) => copy(rooms.get(id)?._receipts?.[key] || archived.get(`${id}:${key}`)),
        async mirror(id, value) {
            for (const [key, receipt] of Object.entries(value._receipts || {})) archived.set(`${id}:${key}`, copy(receipt));
        },
        close() { inboxListeners.clear(); changes.clear(); }
    };
    return store;
}

function createFirebaseAuthorityStore({ rtdb, loadRoom, mirror, readArchivedReceipt }) {
    const ref = id => rtdb.ref(`presentationRooms/${id}`);
    const committedRooms = new Map();
    const watching = new Set();
    const remember = (id, value) => { if (value) committedRooms.set(id, value); else committedRooms.delete(id); return hydrate(value); };
    const store = {
        async ensure(id) {
            const snapshot = await ref(id).get();
            if (snapshot.exists()) { remember(id, snapshot.val()); return; }
            const initial = await loadRoom(id);
            if (!initial) throw Object.assign(new Error('Room not found'), { code: 'ROOM_NOT_FOUND' });
            try {
                await ref(id).transaction(current => current || initial);
            } catch (_) {
                await ref(id).update(initial);
                remember(id, initial);
            }
        },
        async read(id) { return watching.has(id) && committedRooms.has(id) ? hydrate(committedRooms.get(id)) : remember(id, (await ref(id).get()).val()); },
        async transact(id, update) {
            // Firebase may invoke the callback repeatedly. All effects are
            // outside this callback; reducer inputs and time are fixed.
            const initial = committedRooms.get(id) || (await ref(id).get()).val();
            if (!initial) return { committed: false, value: null };
            let result;
            try {
                result = await ref(id).transaction(raw => {
                    const next = update(hydrate(raw || initial));
                    return next === undefined ? undefined : JSON.parse(JSON.stringify(next));
                });
            } catch (err) {
                console.warn('[authorityStore.transact] transaction failed, falling back to direct update:', err?.message || err);
                const fresh = (await ref(id).get()).val() || initial;
                const next = update(hydrate(fresh));
                if (next !== undefined) {
                    await ref(id).update(JSON.parse(JSON.stringify(next)));
                    remember(id, next);
                    return { committed: true, value: hydrate(next) };
                }
                return { committed: false, value: hydrate(fresh) };
            }
            // An aborted callback can expose only the SDK's empty local
            // cache. Fetch the committed server value before owner routing.
            const value = result.committed ? result.snapshot.val() : committedRooms.get(id) || (await ref(id).get()).val();
            if (value && Number(value.revision) >= Number(committedRooms.get(id)?.revision ?? -1)) remember(id, value);
            return { committed: result.committed, value: hydrate(value) };
        },
        onInbox(id, callback) {
            watching.add(id);
            const root = ref(id), node = root.child('_inbox');
            const changed = snapshot => remember(id, snapshot.val());
            root.on('value', changed); node.on('child_added', callback);
            return () => { watching.delete(id); node.off('child_added', callback); root.off('value', changed); committedRooms.delete(id); };
        },
        onChange(id, callback) { const node = ref(id).child('_receipts'); node.on('value', callback); return () => node.off('value', callback); },
        onSnapshot(id, callback) { const node = ref(id); const listener = snapshot => callback(roomState(snapshot.val())); node.on('value', listener); return () => node.off('value', listener); },
        async readReceipt(id, key) { return copy(committedRooms.get(id)?._receipts?.[key]) || (await ref(id).child(`_receipts/${key}`).get()).val() || await readArchivedReceipt?.(id, key) || null; },
        async mirror(id, value) { await mirror(roomState(value), value._receipts || {}); },
        close() { /* individual authorities own their listener disposers */ }
    };
    return store;
}

module.exports = { createMemoryAuthorityStore, createFirebaseAuthorityStore, hydrate, roomState };
