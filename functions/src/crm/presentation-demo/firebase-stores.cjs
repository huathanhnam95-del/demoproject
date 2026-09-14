'use strict';

const crypto = require('node:crypto');
const {
    ACTIVE_LIFECYCLES,
    PARTICIPANT_SLOT_IDS,
    clone,
    createRoomState,
    fail,
    publicRoomSnapshot
} = require('./contracts.cjs');
const { assertActiveIdentity, assertPresenter, assertRoomActor } = require('./identity.cjs');

const COLLECTIONS = Object.freeze({
    rooms: 'presentationDemoRooms',
    codes: 'presentationDemoRoomCodes',
    presenterLocks: 'presentationDemoPresenterLocks',
    tickets: 'presentationDemoTickets',
    operations: 'presentationDemoOperations',
    notebooks: 'presentationDemoNotebooks',
    notebookPages: 'presentationDemoNotebookPages',
    archives: 'presentationDemoArchives',
    archivePages: 'presentationDemoArchivePages'
});
const DAY_MS = 24 * 60 * 60 * 1000;
const TICKET_MS = 60 * 1000;
const MAX_PAGES = 100;
const OWNER_LEASE_MS = 10000;
const OPERATION_LEASE_MS = 30000;

function tokenHash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function operationHash(value) { return tokenHash(JSON.stringify(value ?? null)); }
function runtimeCommandHash(command, generation) { return tokenHash(JSON.stringify({ generation, command })); }
function ticketId(value) { return tokenHash(value); }
function notebookId(roomId, uid) { return tokenHash(`${roomId}:${uid}`); }
function cloneValue(value) { return value === undefined ? undefined : clone(value); }

function createFirebasePresentationDemoServices({ db, rtdb, clock = () => Date.now(), idFactory = () => crypto.randomUUID().replace(/-/g, ''), codeFactory, ticketFactory = () => crypto.randomBytes(32).toString('base64url') } = {}) {
    if (!db || typeof db.collection !== 'function') throw new TypeError('Firestore db is required');
    if (!rtdb || typeof rtdb.ref !== 'function') throw new TypeError('Realtime Database is required');
    const localTails = new Map();
    const makeCode = codeFactory || (() => {
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    });

    function roomRef(roomId) { return db.collection(COLLECTIONS.rooms).doc(String(roomId)); }
    function codeRef(code) { return db.collection(COLLECTIONS.codes).doc(String(code)); }
    function lockRef(uid) { return db.collection(COLLECTIONS.presenterLocks).doc(String(uid)); }
    function operationRef(scope, id) { return db.collection(COLLECTIONS.operations).doc(`${scope}:${id}`); }
    function notebookRef(roomId, uid) { return db.collection(COLLECTIONS.notebooks).doc(notebookId(roomId, uid)); }
    function notebookPageRef(roomId, uid, pageId) { return db.collection(COLLECTIONS.notebookPages).doc(`${notebookId(roomId, uid)}:${pageId}`); }
    function archiveRef(roomId) { return db.collection(COLLECTIONS.archives).doc(String(roomId)); }
    function archivePageRef(roomId, uid, pageId) { return db.collection(COLLECTIONS.archivePages).doc(`${roomId}:${uid}:${pageId}`); }
    function liveRoomRef(roomId) { return rtdb.ref(`presentationRooms/${roomId}`); }

    // RTDB is the canonical low-latency room state. Firestore retains the
    // directory, notes and archive projections and is repaired from this
    // revisioned outbox when its mirror write is unavailable.
    async function mirrorCanonicalRoom(room) {
        const ref = liveRoomRef(room.roomId);
        await ref.transaction(current => {
            if (!current || Number(current.revision) <= Number(room.revision)) return cloneValue(room);
            const next = cloneValue(current);
            let membershipChanged = false;
            for (const slotId of Object.keys(room.slots || {})) {
                const incoming = room.slots[slotId]; const target = next.slots?.[slotId];
                if (!incoming?.uid || !target || target.uid === incoming.uid) continue;
                Object.assign(target, { uid: incoming.uid, displayName: incoming.displayName, originalRole: incoming.originalRole, joinedAt: incoming.joinedAt, bootstrapAt: incoming.bootstrapAt || target.bootstrapAt });
                membershipChanged = true;
            }
            if (membershipChanged) next.revision = Number(current.revision) + 1;
            return next;
        });
        return cloneValue(room);
    }

    function assertCurrentRoom(room, now = clock()) {
        if (!room) fail('ROOM_NOT_FOUND');
        if (room.lifecycle === 'ended') fail('ROOM_ENDED');
        if (Number(room.expiresAt) <= now) fail('ROOM_EXPIRED');
        return room;
    }

    function assertCurrentRoomInTransaction(tx, ref, room) {
        if (!room) fail('ROOM_NOT_FOUND');
        if (room.lifecycle === 'ended') fail('ROOM_ENDED');
        if (Number(room.expiresAt) <= clock()) {
            room.lifecycle = 'ended'; room.endedAt = clock(); room.endReason = 'expired'; room.archiveStatus = 'pending'; room.revision += 1;
            tx.set(ref, room); tx.delete(lockRef(room.presenterUid));
            fail('ROOM_EXPIRED', 'This room has expired and cannot be revived.');
        }
        return room;
    }

    function generationMap(room) {
        return Object.fromEntries(Object.entries(room.slots || {}).map(([slotId, slot]) => [slotId, Number(slot.connectionGeneration) || 0]));
    }

    async function runSerial(key, action) {
        const previous = localTails.get(key) || Promise.resolve();
        let release;
        const current = new Promise(resolve => { release = resolve; });
        localTails.set(key, current);
        await previous;
        try { return await action(); } finally { release(); if (localTails.get(key) === current) localTails.delete(key); }
    }

    async function idempotent(scope, operationId, input, action) {
        const id = String(operationId || '').trim();
        if (!id) return action();
        const ref = operationRef(scope, id);
        const hash = operationHash(input);
        const existing = await ref.get();
        if (existing.exists) {
            const value = existing.data() || {};
            if (value.inputHash !== hash) fail('OPERATION_ID_REUSED');
            if (value.status === 'complete') return cloneValue(value.result);
            if (value.status === 'pending' && Number(value.updatedAt || value.createdAt || 0) + OPERATION_LEASE_MS > clock()) fail('OPERATION_IN_PROGRESS');
        }
        await db.runTransaction(async tx => {
            const current = await tx.get(ref);
            if (current.exists) {
                const value = current.data() || {};
                if (value.inputHash !== hash) fail('OPERATION_ID_REUSED');
                if (value.status === 'complete') return;
                if (value.status === 'pending' && Number(value.updatedAt || value.createdAt || 0) + OPERATION_LEASE_MS > clock()) fail('OPERATION_IN_PROGRESS');
            }
            tx.set(ref, { inputHash: hash, status: 'pending', createdAt: current.exists ? current.data()?.createdAt || clock() : clock(), updatedAt: clock() }, { merge: true });
        });
        try {
            const result = await action();
            await ref.set({ inputHash: hash, status: 'complete', result: cloneValue(result), completedAt: clock() }, { merge: true });
            return result;
        } catch (error) {
            await ref.set({ inputHash: hash, status: 'failed', errorCode: error.code || 'PRESENTATION_DEMO_ERROR', failedAt: clock(), updatedAt: clock() }, { merge: true });
            throw error;
        }
    }

    function mergeRoomState(firestoreRoom, liveRoom) {
        const merged = liveRoom && Number(liveRoom.revision) >= Number(firestoreRoom.revision)
            ? { ...firestoreRoom, ...liveRoom }
            : { ...firestoreRoom };
        const slots = Object.fromEntries(Object.keys(firestoreRoom.slots || {}).map(slotId => {
            const firestoreSlot = firestoreRoom.slots[slotId] || {};
            const liveSlot = liveRoom?.slots?.[slotId] || {};
            return [slotId, {
                ...firestoreSlot,
                ...(liveRoom && Number(liveRoom.revision) >= Number(firestoreRoom.revision) ? liveSlot : {}),
                uid: firestoreSlot.uid || liveSlot.uid || null,
                displayName: (firestoreSlot.uid ? firestoreSlot.displayName : liveSlot.displayName) ?? firestoreSlot.displayName ?? `Participant ${slotId.slice(1)}`,
                joinedAt: firestoreSlot.joinedAt ?? liveSlot.joinedAt ?? null,
                originalRole: (firestoreSlot.uid ? firestoreSlot.originalRole : liveSlot.originalRole) ?? firestoreSlot.originalRole ?? (slotId === 'p0' ? 'admin' : 'participant'),
                relationship: { leader: null, follower: null, carry: null, handhold: null, ...(firestoreSlot.relationship || {}), ...(liveSlot.relationship || {}) },
                notes: [],
                notesRevision: Math.max(Number(firestoreSlot.notesRevision) || 0, Number(liveSlot.notesRevision) || 0)
            }];
        }));
        const deck = { ...(firestoreRoom.deck || {}), ...(merged.deck || {}) };
        deck.room = deck.room ?? null;
        deck.etaOrigin = deck.etaOrigin ?? null;
        const activity = { ...(firestoreRoom.activity || {}), ...(merged.activity || {}) };
        activity.id = activity.id ?? null;
        activity.phase = activity.phase ?? null;
        activity.state = activity.state ?? null;
        return {
            ...merged,
            allParticipantsJoinedAt: merged.allParticipantsJoinedAt ?? null,
            startedAt: merged.startedAt ?? null,
            endedAt: merged.endedAt ?? null,
            endReason: merged.endReason ?? null,
            deck,
            activity,
            slots
        };
    }

    async function getRoom(roomId) {
        const ref = roomRef(roomId);
        const snap = await ref.get();
        if (!snap.exists) return null;
        const firestoreRoom = snap.data();
        const liveSnap = await liveRoomRef(roomId).get().catch(() => ({ exists: false }));
        const liveRoom = liveSnap.exists ? liveSnap.val() : null;
        const current = mergeRoomState(firestoreRoom, liveRoom);
        if (ACTIVE_LIFECYCLES.has(current.lifecycle) && Number(current.expiresAt) <= clock()) {
            const ended = await db.runTransaction(async tx => {
                const fresh = await tx.get(ref);
                if (!fresh.exists) return null;
                const value = fresh.data();
                if (ACTIVE_LIFECYCLES.has(value.lifecycle) && Number(value.expiresAt) <= clock()) {
                    value.lifecycle = 'ended'; value.endedAt = clock(); value.endReason = 'expired'; value.archiveStatus = 'pending'; value.revision += 1;
                    tx.set(ref, value); tx.delete(lockRef(value.presenterUid)); return value;
                }
                return value;
            });
            return cloneValue(ended);
        }
        return cloneValue(current);
    }

    async function listRooms(input, { limit = 50 } = {}) {
        const identity = assertActiveIdentity(input);
        const maximum = Math.min(100, Math.max(1, Number(limit) || 50));
        const snap = await db.collection(COLLECTIONS.rooms).get();
        const matching = snap.docs.map(doc => doc.data())
            .filter(room => room.presenterUid === identity.uid || Object.values(room.slots || {}).some(slot => slot.uid === identity.uid))
            .sort((a, b) => Number(b.lastPresenterActivityAt || b.createdAt || 0) - Number(a.lastPresenterActivityAt || a.createdAt || 0))
            .slice(0, maximum);
        const snapshots = [];
        for (const room of matching) {
            const current = await getRoom(room.roomId);
            if (current) snapshots.push({ ...publicRoomSnapshot(current, identity.uid), roomId: current.roomId, code: current.code });
        }
        return snapshots;
    }

    async function publicResult(room, uid) {
        return { ...publicRoomSnapshot(room, uid), roomId: room.roomId, code: room.code };
    }

    async function resolveRoom(value) {
        const raw = String(value || '').trim();
        let room = await getRoom(raw);
        if (!room && raw.length === 6) {
            const code = raw.toUpperCase().replace(/[\s-]/g, '');
            const codeSnap = await codeRef(code).get();
            if (codeSnap.exists) room = await getRoom(codeSnap.data().roomId);
        }
        if (!room) fail('ROOM_NOT_FOUND', 'That room is not available.');
        return room;
    }

    async function createOrResume(input, { operationId = null } = {}) {
        const identity = assertPresenter(input);
        return runSerial(`presenter:${identity.uid}`, () => idempotent('create', operationId, { uid: identity.uid }, async () => {
            const existing = await db.collection(COLLECTIONS.rooms).where('presenterUid', '==', identity.uid).get();
            const active = existing.docs.map(doc => doc.data()).find(room => ACTIVE_LIFECYCLES.has(room.lifecycle));
            if (active) return publicResult(await getRoom(active.roomId), identity.uid);
            for (let attempt = 0; attempt < 12; attempt += 1) {
                const roomId = idFactory();
                const code = String(makeCode(attempt)).toUpperCase().replace(/[\s-]/g, '');
                const room = createRoomState({ roomId, code, presenterUid: identity.uid, now: clock(), operationId });
                const created = await db.runTransaction(async tx => {
                    const codeSnap = await tx.get(codeRef(room.code));
                    const presenterLock = await tx.get(lockRef(identity.uid));
                    if (presenterLock.exists) {
                        const lockedRoom = await tx.get(roomRef(presenterLock.data().roomId));
                        if (lockedRoom.exists && ACTIVE_LIFECYCLES.has(lockedRoom.data().lifecycle)) return lockedRoom.data();
                    }
                    if (codeSnap.exists) return null;
                    tx.create(roomRef(room.roomId), room);
                    tx.create(codeRef(room.code), { roomId: room.roomId, createdAt: clock(), tombstone: false });
                    tx.set(lockRef(identity.uid), { roomId: room.roomId, updatedAt: clock() });
                    return room;
                });
                if (created) { await mirrorCanonicalRoom(created); return publicResult(created, identity.uid); }
            }
            fail('ROOM_CODE_UNAVAILABLE');
        }));
    }

    async function join(input, codeOrId, { operationId = null } = {}) {
        const identity = assertActiveIdentity(input);
        return runSerial(`room:${String(codeOrId)}`, () => idempotent('join', operationId, { uid: identity.uid, room: String(codeOrId) }, async () => {
            const resolved = await resolveRoom(codeOrId);
            const ref = roomRef(resolved.roomId);
            const joined = await db.runTransaction(async tx => {
                const snap = await tx.get(ref);
                if (!snap.exists) fail('ROOM_NOT_FOUND');
                const room = snap.data();
                if (!ACTIVE_LIFECYCLES.has(room.lifecycle)) fail('ROOM_ENDED');
                assertCurrentRoomInTransaction(tx, ref, room);
                const existing = Object.values(room.slots).find(slot => slot.uid === identity.uid);
                const slot = existing || PARTICIPANT_SLOT_IDS.map(slotId => room.slots[slotId]).find(candidate => !candidate.uid);
                if (!slot) fail('ROOM_FULL', 'All three participant slots are already reserved.');
                if (!existing) {
                    slot.uid = identity.uid;
                    slot.displayName = identity.email ? identity.email.split('@')[0].slice(0, 80) : `Participant ${slot.slotId.slice(1)}`;
                    slot.originalRole = identity.isTeacher ? 'teacher' : 'participant';
                    slot.joinedAt = clock();
                    room.revision += 1;
                }
                tx.set(ref, room);
                return { room, seatId: slot.slotId };
            });
            await mirrorCanonicalRoom(joined.room);
            const canonical = await getRoom(joined.room.roomId);
            return { roomId: canonical.roomId, code: canonical.code, seatId: joined.seatId, role: canonical.slots[joined.seatId].role, snapshot: await publicResult(canonical, identity.uid) };
        }));
    }

    async function markBootstrap(input, roomId) {
        const identity = assertActiveIdentity(input);
        const ref = roomRef(roomId);
        const room = await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists) fail('ROOM_NOT_FOUND');
            const value = snap.data();
            assertCurrentRoomInTransaction(tx, ref, value);
            const membership = Object.values(value.slots).find(slot => slot.uid === identity.uid);
            assertRoomActor(identity, membership && { uid: membership.uid, seatId: membership.slotId, role: membership.role });
            if (!membership.bootstrapAt) membership.bootstrapAt = clock();
            if (!value.allParticipantsJoinedAt && PARTICIPANT_SLOT_IDS.every(id => value.slots[id].uid && value.slots[id].bootstrapAt)) value.allParticipantsJoinedAt = clock();
            value.revision += 1;
            tx.set(ref, value);
            return value;
        });
        await mirrorCanonicalRoom(room);
        return publicResult(await getRoom(roomId), identity.uid);
    }

    async function issueTicket(input, roomId) {
        const identity = assertActiveIdentity(input);
        const room = await resolveRoom(roomId);
        if (!ACTIVE_LIFECYCLES.has(room.lifecycle)) fail('ROOM_ENDED');
        const membership = Object.values(room.slots).find(slot => slot.uid === identity.uid);
        assertRoomActor(identity, membership && { uid: membership.uid, seatId: membership.slotId, role: membership.role });
        const raw = ticketFactory();
        const expiresAt = clock() + TICKET_MS;
        await db.collection(COLLECTIONS.tickets).doc(ticketId(raw)).create({ roomId: room.roomId, uid: identity.uid, seatId: membership.slotId, role: membership.role, expiresAt, used: false, createdAt: clock() });
        return { ticket: raw, roomId: room.roomId, seatId: membership.slotId, role: membership.role, expiresAt };
    }

    async function consumeTicket(input, ticket, { markUsed = true } = {}) {
        const identity = assertActiveIdentity(input);
        const ref = db.collection(COLLECTIONS.tickets).doc(ticketId(ticket));
        return db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            const value = snap.exists ? snap.data() : null;
            if (!value || value.used || value.expiresAt < clock() || value.uid !== identity.uid) fail('TICKET_INVALID');
            const roomSnap = await tx.get(roomRef(value.roomId));
            const room = roomSnap.exists ? roomSnap.data() : null;
            assertCurrentRoomInTransaction(tx, roomRef(value.roomId), room);
            const membership = room && Object.values(room.slots).find(slot => slot.uid === identity.uid);
            assertRoomActor(identity, membership && { uid: membership.uid, seatId: membership.slotId, role: membership.role });
            if (markUsed) tx.update(ref, { used: true, usedAt: clock() });
            return cloneValue(value);
        });
    }

    async function touchPresenter(input, roomId) {
        const identity = assertPresenter(input);
        const ref = roomRef(roomId);
        const room = await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists) fail('ROOM_NOT_FOUND');
            const value = snap.data();
            assertCurrentRoomInTransaction(tx, ref, value);
            if (value.presenterUid !== identity.uid) fail('ACTOR_MISMATCH');
            if (!ACTIVE_LIFECYCLES.has(value.lifecycle)) fail('ROOM_ENDED');
            value.lastPresenterActivityAt = clock();
            value.expiresAt = value.lastPresenterActivityAt + DAY_MS;
            value.revision += 1;
            tx.set(ref, value);
            return value;
        });
        return publicResult(await getRoom(roomId), identity.uid);
    }

    async function updateNotebookMetadata(roomId, seatId, metadata = {}) {
        const ref = roomRef(roomId);
        return db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists || !snap.data().slots[seatId]) fail('ROOM_NOT_FOUND');
            const room = snap.data();
            const slot = room.slots[seatId];
            if (Array.isArray(metadata.notes)) slot.notes = clone(metadata.notes);
            if (Number.isSafeInteger(metadata.notesRevision)) slot.notesRevision = metadata.notesRevision;
            tx.set(ref, room);
            return room;
        });
    }

    async function end(input, roomId, reason = 'explicit') {
        const identity = assertPresenter(input);
        const ref = roomRef(roomId);
        const room = await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists) fail('ROOM_NOT_FOUND');
            const value = snap.data();
            if (value.presenterUid !== identity.uid) fail('ACTOR_MISMATCH');
            if (value.lifecycle === 'ended') return value;
            value.lifecycle = 'ended'; value.endedAt = clock(); value.endReason = reason; value.archiveStatus = 'pending'; value.revision += 1;
            tx.set(ref, value);
            tx.delete(lockRef(identity.uid));
            return value;
        });
        return cloneValue(room);
    }

    async function syncRuntimeState(roomId, runtimeState, { expectedRevision = null, expectedGenerations = null, expectedOwner = null } = {}) {
        const ref = roomRef(roomId);
        const liveRef = liveRoomRef(roomId);
        const firestoreSnap = await ref.get();
        const liveSnap = await liveRef.get();
        const fallback = firestoreSnap.exists ? firestoreSnap.data() : null;
        const initial = liveSnap.exists ? liveSnap.val() : fallback;
        if (!initial) fail('ROOM_NOT_FOUND');
        let transactionError = null;
        const abort = (code, message = code) => { transactionError = { code, message }; return undefined; };
        let persisted;
        const committed = await liveRef.transaction(currentValue => {
            const current = currentValue || initial;
            if (runtimeState.roomId !== current.roomId) return abort('RUNTIME_ROOM_MISMATCH');
            if (current.lifecycle === 'ended') return abort('ROOM_ENDED');
            if (Number(current.expiresAt) <= clock()) return abort('ROOM_EXPIRED', 'This room has expired and cannot be revived.');
            if (expectedRevision !== null && Number(current.revision) !== Number(expectedRevision)) return abort('RUNTIME_REVISION_CONFLICT');
            if (Number(runtimeState.revision) <= Number(current.revision)) return abort('RUNTIME_REVISION_STALE');
            for (const slotId of Object.keys(current.slots || {})) {
                if (current.slots[slotId].uid !== runtimeState.slots?.[slotId]?.uid) return abort('RUNTIME_MEMBERSHIP_STALE');
                if (expectedGenerations && Number(current.slots[slotId].connectionGeneration) !== Number(expectedGenerations[slotId])) return abort('RUNTIME_GENERATION_CONFLICT');
            }
            if (expectedOwner && (current.owner?.gatewayId !== expectedOwner.gatewayId || current.owner?.ownerEpoch !== expectedOwner.ownerEpoch)) return abort('OWNER_FENCED');
            const next = cloneValue(runtimeState);
            for (const slotId of Object.keys(current.slots || {})) {
                next.slots[slotId].notes = [];
                next.slots[slotId].notesRevision = Math.max(Number(current.slots[slotId].notesRevision) || 0, Number(fallback?.slots?.[slotId]?.notesRevision) || 0);
            }
            return next;
        });
        if (transactionError) fail(transactionError.code, transactionError.message);
        if (!committed?.committed) fail('RUNTIME_REVISION_CONFLICT');
        persisted = cloneValue(committed.snapshot.val());
        try {
            await db.runTransaction(async tx => {
                const snap = await tx.get(ref);
                if (!snap.exists) return;
                const current = snap.data();
                if (Number(current.revision) > Number(persisted.revision)) return;
                // RTDB omits null-only and empty child maps. Mirror the full
                // command state to Firestore so a temporary RTDB read failure
                // cannot turn a valid room into a schema-invalid projection.
                const mirror = cloneValue(runtimeState);
                for (const slotId of Object.keys(mirror.slots || {})) {
                    mirror.slots[slotId].notes = [];
                    mirror.slots[slotId].notesRevision = current.slots[slotId].notesRevision || 0;
                }
                tx.set(ref, mirror);
            });
        } catch (error) {
            // Accepted live state remains in RTDB. This durable outbox is the
            // repair signal; it must never turn a committed command into a
            // misleading partial-write response.
            try { await rtdb.ref(`presentationRoomOutbox/${roomId}/${persisted.revision}`).set({ roomId, revision: persisted.revision, state: persisted, queuedAt: clock(), kind: 'firestore-mirror' }); } catch (_) { /* canonical state is already committed */ }
        }
        return persisted;
    }

    async function claimRuntimeOwner(roomId, gatewayId, now = clock(), { force = false } = {}) {
        const ref = roomRef(roomId);
        const liveRef = liveRoomRef(roomId);
        const firestoreSnap = await ref.get();
        const liveSnap = await liveRef.get();
        const initial = liveSnap.exists ? liveSnap.val() : (firestoreSnap.exists ? firestoreSnap.data() : null);
        if (!initial) fail('ROOM_NOT_FOUND');
        let transactionError = null;
        const abort = (code, message = code) => { transactionError = { code, message }; return undefined; };
        let committed;
        committed = await liveRef.transaction(currentValue => {
            const room = currentValue || initial;
            if (!ACTIVE_LIFECYCLES.has(room.lifecycle)) return abort('ROOM_ENDED');
            const owner = { gatewayId: null, ownerEpoch: 0, leaseUntil: 0, ...(room.owner || {}) };
            // `force` is intentionally ignored at this boundary. Reconnect
            // replaces a seat generation, not the live simulation leader.
            if (owner.gatewayId && owner.gatewayId !== gatewayId && Number(owner.leaseUntil) >= now) return abort('OWNER_LEASE_HELD');
            if (owner.gatewayId !== gatewayId) owner.ownerEpoch = Number(owner.ownerEpoch || 0) + 1;
            owner.gatewayId = String(gatewayId); owner.leaseUntil = now + OWNER_LEASE_MS;
            return { ...room, owner, revision: Number(room.revision) + 1 };
        });
        if (transactionError) fail(transactionError.code, transactionError.message);
        if (!committed?.committed) fail('OWNER_LEASE_HELD');
        // The transaction snapshot is the RTDB wire shape and may omit
        // null-only children. Rehydrate it before returning it to a cached
        // runtime or mirroring it back to Firestore.
        const room = await getRoom(roomId);
        try {
            await db.runTransaction(async tx => {
                const snap = await tx.get(ref);
                if (!snap.exists || Number(snap.data().revision) > Number(room.revision)) return;
                tx.set(ref, room);
            });
        } catch (_) {
            try { await rtdb.ref(`presentationRoomOutbox/${roomId}/${room.revision}`).set({ roomId, revision: room.revision, state: room, queuedAt: clock(), kind: 'firestore-mirror' }); } catch (_) { /* canonical state is already committed */ }
        }
        return { owner: cloneValue(room.owner), room };
    }

    async function readRuntimeCommandReceipt(roomId, seatId, commandId, { generation = null, command = null } = {}) {
        const snap = await operationRef(`command:${roomId}:${seatId}`, commandId).get();
        if (!snap.exists || snap.data()?.status !== 'complete') return null;
        const value = snap.data();
        if (generation !== null && value.generation !== generation) fail('COMMAND_RECEIPT_SUPERSEDED');
        if (command && value.commandHash !== runtimeCommandHash(command, generation)) fail('COMMAND_RECEIPT_CONFLICT');
        return cloneValue(value.result);
    }

    async function writeRuntimeCommandReceipt(roomId, seatId, commandId, result, { generation, command } = {}) {
        const ref = operationRef(`command:${roomId}:${seatId}`, commandId);
        await ref.set({ scope: 'runtime-command', roomId, seatId, commandId, generation, commandHash: runtimeCommandHash(command, generation), status: 'complete', result: cloneValue(result), completedAt: clock() }, { merge: true });
        return cloneValue(result);
    }

    async function markArchiveStatus(roomId, status) {
        const ref = roomRef(roomId);
        return db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists || snap.data().lifecycle !== 'ended') fail('ROOM_NOT_FOUND');
            const room = snap.data(); room.archiveStatus = status; tx.set(ref, room); return room;
        });
    }

    async function listPendingArchives(limit = 100) {
        const snap = await db.collection(COLLECTIONS.rooms).where('lifecycle', '==', 'ended').get();
        return snap.docs.map(doc => doc.data()).filter(room => ['pending', 'failed'].includes(room.archiveStatus)).sort((a, b) => Number(a.endedAt || 0) - Number(b.endedAt || 0)).slice(0, Math.max(0, limit));
    }

    async function expireDue() {
        const snap = await db.collection(COLLECTIONS.rooms).get();
        const expired = [];
        for (const doc of snap.docs) {
            const ref = doc.ref;
            const room = await db.runTransaction(async tx => {
                const currentSnap = await tx.get(ref);
                if (!currentSnap.exists) return null;
                const value = currentSnap.data();
                if (!ACTIVE_LIFECYCLES.has(value.lifecycle) || Number(value.expiresAt) > clock()) return null;
                value.lifecycle = 'ended'; value.endedAt = clock(); value.endReason = 'expired'; value.archiveStatus = 'pending'; value.revision += 1;
                tx.set(ref, value); tx.delete(lockRef(value.presenterUid)); return value;
            });
            if (room) expired.push(room);
        }
        return expired;
    }

    const roomService = { createOrResume, end, expireDue, getRoom, issueTicket, join, listRooms, listPendingArchives, markArchiveStatus, markBootstrap, consumeTicket, syncRuntimeState, touchPresenter, updateNotebookMetadata, refreshRuntimeOnRead: true, durable: true };

    async function membership(roomId, uid) {
        const room = await getRoom(roomId);
        if (!room) fail('ROOM_NOT_FOUND');
        const slot = Object.values(room.slots).find(candidate => candidate.uid === uid);
        if (!slot) fail('NOTE_FORBIDDEN');
        return { room, slot };
    }

    async function readPages(roomId, uid) {
        const snap = await db.collection(COLLECTIONS.notebookPages).get();
        return cloneValue(snap.docs.map(doc => doc.data()).filter(page => page.roomId === roomId && page.uid === uid).sort((a, b) => a.id.localeCompare(b.id)));
    }
    async function readNotebookMeta(roomId, uid) {
        const snap = await notebookRef(roomId, uid).get();
        return snap.exists ? cloneValue(snap.data()) : { roomId, uid, pageIds: [], revision: 0 };
    }
    const visible = pages => (pages || []).filter(page => page.deleted !== true);
    const revision = (pages, meta = null) => Math.max(Number(meta?.revision) || 0, ...(pages || []).map(page => Number(page.version) || 0));

    const notes = {
        async readNotebook(input, roomId, targetUid) {
            const identity = assertActiveIdentity(input);
            const { room, slot } = await membership(roomId, identity.uid);
            const target = String(targetUid || identity.uid);
            if (target !== identity.uid && (slot.role !== 'presenter' || identity.isAdmin !== true)) fail('NOTE_FORBIDDEN');
            await membership(roomId, target);
            const pages = await readPages(roomId, target);
            const meta = await readNotebookMeta(roomId, target);
            return { roomId, uid: target, notebookRevision: revision(pages, meta), pages: visible(pages) };
        },
        async readNotebookByUid(inputOrRoomId, roomIdOrUid, maybeUid) {
            const hasActor = inputOrRoomId && typeof inputOrRoomId === 'object';
            const identity = hasActor ? assertActiveIdentity(inputOrRoomId) : null;
            const roomId = hasActor ? roomIdOrUid : inputOrRoomId;
            const uid = hasActor ? maybeUid : roomIdOrUid;
            const { room, slot } = await membership(roomId, hasActor ? identity.uid : uid);
            if (hasActor && uid !== identity.uid && (slot.role !== 'presenter' || identity.isAdmin !== true)) fail('NOTE_FORBIDDEN');
            const target = Object.values(room.slots).find(candidate => candidate.uid === uid);
            if (!target) fail('NOTE_FORBIDDEN');
            const pages = await readPages(roomId, uid);
            const meta = await readNotebookMeta(roomId, uid);
            return { roomId, uid, notebookRevision: revision(pages, meta), pages: visible(pages) };
        },
        async savePage(input, roomId, targetUid, page) {
            const identity = assertActiveIdentity(input);
            if (String(targetUid || identity.uid) !== identity.uid) fail('NOTE_AUTHOR_ONLY');
            if (!page || !/^[A-Za-z0-9:_-]{1,128}$/.test(page.pageId || '') || typeof page.title !== 'string' || page.title.length > 200 || typeof page.body !== 'string' || page.body.length > 50000 || !Number.isSafeInteger(page.expectedVersion) || page.expectedVersion < 0) fail('NOTE_INVALID');
            const roomRefValue = roomRef(roomId); const notesRef = notebookRef(roomId, identity.uid); const pageRef = notebookPageRef(roomId, identity.uid, page.pageId);
            const saved = await db.runTransaction(async tx => {
                const roomSnap = await tx.get(roomRefValue); const notesSnap = await tx.get(notesRef); const pageSnap = await tx.get(pageRef);
                const room = roomSnap.exists ? roomSnap.data() : null; assertCurrentRoomInTransaction(tx, roomRefValue, room);
                const member = Object.values(room.slots).find(slot => slot.uid === identity.uid); assertRoomActor(identity, member && { uid: member.uid, seatId: member.slotId, role: member.role });
                const meta = notesSnap.exists ? notesSnap.data() : { pageIds: [], revision: 0 }; const current = pageSnap.exists ? pageSnap.data() : null; const currentVersion = current?.version || 0;
                if (currentVersion !== page.expectedVersion) fail('NOTE_CONFLICT');
                if (!current && (meta.pageIds || []).length >= MAX_PAGES) fail('NOTE_PAGE_LIMIT');
                const value = { roomId, uid: identity.uid, id: page.pageId, title: page.title, body: page.body, version: currentVersion + 1, updatedAt: clock(), updatedBy: identity.uid };
                const pageIds = current ? [...(meta.pageIds || [])] : [...(meta.pageIds || []), page.pageId];
                const nextRevision = (Number(meta.revision) || 0) + 1;
                tx.set(pageRef, value);
                tx.set(notesRef, { roomId, uid: identity.uid, pageIds, revision: nextRevision, updatedAt: clock() });
                const slot = room.slots[member.slotId]; slot.notes = []; slot.notesRevision = nextRevision; room.revision += 1; tx.set(roomRefValue, room);
                return value;
            });
            if (identity.uid === (await getRoom(roomId)).presenterUid) await touchPresenter(identity, roomId);
            return cloneValue(saved);
        },
        async deletePage(input, roomId, targetUid, page) {
            const identity = assertActiveIdentity(input);
            if (String(targetUid || identity.uid) !== identity.uid) fail('NOTE_AUTHOR_ONLY');
            if (!page || !/^[A-Za-z0-9:_-]{1,128}$/.test(page.pageId || '') || !Number.isSafeInteger(page.expectedVersion) || page.expectedVersion < 0) fail('NOTE_INVALID');
            const roomRefValue = roomRef(roomId); const notesRef = notebookRef(roomId, identity.uid); const pageRef = notebookPageRef(roomId, identity.uid, page.pageId);
            const result = await db.runTransaction(async tx => {
                const roomSnap = await tx.get(roomRefValue); const notesSnap = await tx.get(notesRef); const pageSnap = await tx.get(pageRef);
                const room = roomSnap.exists ? roomSnap.data() : null; assertCurrentRoomInTransaction(tx, roomRefValue, room);
                const member = Object.values(room.slots).find(slot => slot.uid === identity.uid); assertRoomActor(identity, member && { uid: member.uid, seatId: member.slotId, role: member.role });
                const meta = notesSnap.exists ? notesSnap.data() : { pageIds: [], revision: 0 }; const current = pageSnap.exists ? pageSnap.data() : null;
                if (!current || current.version !== page.expectedVersion || current.deleted === true) fail('NOTE_CONFLICT');
                const nextRevision = (Number(meta.revision) || 0) + 1;
                tx.set(pageRef, { ...current, version: current.version + 1, deleted: true, deletedAt: clock(), deletedBy: identity.uid, updatedAt: clock() });
                tx.set(notesRef, { roomId, uid: identity.uid, pageIds: [...(meta.pageIds || [])], revision: nextRevision, updatedAt: clock() });
                room.slots[member.slotId].notes = []; room.slots[member.slotId].notesRevision = nextRevision; room.revision += 1; tx.set(roomRefValue, room);
                return { deleted: true, pageId: page.pageId, pages: [] };
            });
            result.pages = visible(await readPages(roomId, identity.uid));
            if (identity.uid === (await getRoom(roomId)).presenterUid) await touchPresenter(identity, roomId);
            return cloneValue(result);
        }
    };

    function archiveChecksum(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
    const archives = {
        async archiveRoom(inputOrRoomId, maybeRoomId) {
            const hasActor = inputOrRoomId && typeof inputOrRoomId === 'object';
            const identity = hasActor ? assertPresenter(inputOrRoomId) : null;
            const roomId = hasActor ? maybeRoomId : inputOrRoomId;
            const ref = roomRef(roomId); const started = await db.runTransaction(async tx => {
                const roomSnap = await tx.get(ref); if (!roomSnap.exists || roomSnap.data().lifecycle !== 'ended') fail('ROOM_NOT_TERMINAL');
                const room = roomSnap.data(); if (identity && room.presenterUid !== identity.uid) fail('PRESENTER_ONLY');
                const existingSnap = await tx.get(archiveRef(roomId)); if (existingSnap.exists && existingSnap.data().status === 'archived') return existingSnap.data();
                const members = Object.values(room.slots).filter(slot => slot.uid).map(slot => ({ uid: slot.uid, seatId: slot.slotId, role: slot.role, displayName: slot.displayName, joinedAt: slot.joinedAt }));
                const value = { archiveId: roomId, roomId, status: 'pending', createdAt: clock(), sourceRevision: room.revision, members };
                if (existingSnap.exists) tx.set(archiveRef(roomId), value); else tx.create(archiveRef(roomId), value);
                room.archiveStatus = 'pending'; tx.set(ref, room); return value;
            });
            if (started.status === 'archived') return cloneValue(started);
            const notebooks = {};
            for (const member of started.members) {
                const notebook = await notes.readNotebookByUid(roomId, member.uid);
                notebooks[member.uid] = { notebookRevision: notebook.notebookRevision, pages: notebook.pages };
                for (const page of notebook.pages) await archivePageRef(roomId, member.uid, page.id).set({ ...page, roomId, uid: member.uid });
            }
            const payload = { roomId, sourceRevision: started.sourceRevision, members: started.members, notebooks };
            const archive = await db.runTransaction(async tx => {
                const snap = await tx.get(archiveRef(roomId)); const roomSnap = await tx.get(ref); if (!snap.exists) fail('ARCHIVE_NOT_FOUND');
                const value = snap.data(); if (value.status === 'archived') return value;
                const next = { ...value, status: 'archived', checksum: archiveChecksum(payload), notebookRevisions: Object.fromEntries(Object.entries(notebooks).map(([uid, item]) => [uid, item.notebookRevision])), completedAt: clock() };
                tx.set(archiveRef(roomId), next); if (roomSnap.exists) { const room = roomSnap.data(); room.archiveStatus = 'archived'; tx.set(ref, room); } return next;
            });
            return { ...cloneValue(archive), notebooks: cloneValue(notebooks) };
        },
        async readArchive(input, roomId) {
            const identity = assertActiveIdentity(input); const room = await getRoom(roomId); const current = room && Object.values(room.slots).find(value => value.uid === identity.uid); assertRoomActor(identity, current && { uid: current.uid, seatId: current.slotId, role: current.role });
            const snap = await archiveRef(roomId).get(); if (!snap.exists || snap.data().status !== 'archived') fail('ARCHIVE_NOT_FOUND');
            const archive = snap.data(); const member = archive.members.find(value => value.uid === identity.uid); if (!member) fail('EXPORT_FORBIDDEN');
            const pageSnap = await db.collection(COLLECTIONS.archivePages).get(); const targetMembers = member.role === 'presenter' ? archive.members : [member]; const notebooks = {};
            for (const target of targetMembers) {
                const pages = pageSnap.docs.map(doc => doc.data()).filter(page => page.roomId === roomId && page.uid === target.uid).sort((a, b) => a.id.localeCompare(b.id));
                notebooks[target.uid] = { notebookRevision: archive.notebookRevisions?.[target.uid] || revision(pages), pages: cloneValue(pages) };
            }
            return { archiveId: archive.archiveId, roomId: archive.roomId, status: archive.status, checksum: archive.checksum, members: cloneValue(archive.members), notebooks };
        }
    };

    return { COLLECTIONS, roomService: { ...roomService, claimRuntimeOwner, readRuntimeCommandReceipt, writeRuntimeCommandReceipt }, notes, archives, stores: { durable: true, db, rtdb } };
}

module.exports = { COLLECTIONS, createFirebasePresentationDemoServices, notebookId, ticketId };
