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
const { createFirebaseAuthorityStore, hydrate, roomState } = require('./authority-store.cjs');

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
function archiveTuple(roomId, uid, pageId) { return [String(roomId ?? ''), String(uid ?? ''), String(pageId ?? '')]; }
function archivePageDocumentId(roomId, uid, pageId) {
    // v2 is a lossless base64url encoding of the JSON tuple. Unlike the v1
    // colon-joined ID, every valid room, uid, and page value has one identity.
    return `v2_${Buffer.from(JSON.stringify(archiveTuple(roomId, uid, pageId)), 'utf8').toString('base64url')}`;
}
function decodeArchivePageDocumentId(id) {
    const value = String(id || '');
    if (!value.startsWith('v2_')) return null;
    try {
        const tuple = JSON.parse(Buffer.from(value.slice(3), 'base64url').toString('utf8'));
        if (!Array.isArray(tuple) || tuple.length !== 3 || tuple.some(item => typeof item !== 'string')) return null;
        return tuple;
    } catch (_) { return null; }
}
function legacyArchivePageDocumentId(roomId, uid, pageId) { return `${roomId}:${uid}:${pageId}`; }
function archivePageDocumentIdCandidates(roomId, uid, pageId) {
    return [archivePageDocumentId(roomId, uid, pageId), legacyArchivePageDocumentId(roomId, uid, pageId)];
}
function archivePageSemanticValue(page) {
    return Object.fromEntries(['roomId', 'uid', 'id', 'title', 'body', 'version', 'deleted'].map(key => [key, page?.[key] ?? null]));
}
function archivePageRecordId(record) { return String(record?.id ?? record?.documentId ?? ''); }
function archivePageRecordData(record) { return record?.data && typeof record.data === 'object' ? record.data : record; }
function resolveArchivePageRecords(records, { roomId, uid } = {}) {
    if (!Array.isArray(records)) throw new TypeError('archive page records must be an array');
    const groups = new Map();
    for (const record of records) {
        const documentId = archivePageRecordId(record);
        const page = archivePageRecordData(record);
        if (!documentId || !page || typeof page !== 'object') continue;
        const tuple = archiveTuple(page.roomId, page.uid, page.id);
        if ((roomId !== undefined && tuple[0] !== String(roomId)) || (uid !== undefined && tuple[1] !== String(uid))) continue;
        const [v2Id, legacyId] = archivePageDocumentIdCandidates(...tuple);
        const storageVersion = documentId === v2Id ? 'v2' : documentId === legacyId ? 'legacy' : null;
        if (!storageVersion) continue;
        const item = { documentId, storageVersion, page: cloneValue(page), semanticHash: operationHash(archivePageSemanticValue(page)), v2Id, legacyId };
        const existing = groups.get(tuple.join('\u0000')) || [];
        existing.push(item); groups.set(tuple.join('\u0000'), existing);
    }
    const resolved = [];
    for (const items of groups.values()) {
        const semanticHashes = new Set(items.map(item => item.semanticHash));
        if (semanticHashes.size !== 1) fail('ARCHIVE_PAGE_CONFLICT');
        const v2 = items.filter(item => item.storageVersion === 'v2');
        const legacy = items.filter(item => item.storageVersion === 'legacy');
        if (v2.length > 1 || legacy.length > 1) fail('ARCHIVE_PAGE_CONFLICT');
        const selected = v2[0] || legacy[0];
        resolved.push({ ...selected, id: selected.page.id, storageVersion: v2[0] ? 'v2' : 'legacy' });
    }
    return resolved.sort((left, right) => String(left.page.id).localeCompare(String(right.page.id)));
}
async function migrateArchivePageRecord(records, { roomId, uid, writeV2, deleteLegacy, removeLegacy = true } = {}) {
    const resolved = resolveArchivePageRecords(records, { roomId, uid });
    if (!resolved.length) return null;
    if (resolved.length !== 1) throw Object.assign(new Error('archive migration expects one page tuple'), { code: 'ARCHIVE_PAGE_CONFLICT' });
    const item = resolved[0];
    if (item.storageVersion === 'legacy') {
        if (typeof writeV2 !== 'function') throw new TypeError('writeV2 is required for legacy archive page migration');
        await writeV2(item.v2Id, cloneValue(item.page));
    }
    if (removeLegacy && typeof deleteLegacy === 'function' && (item.storageVersion === 'legacy' || records.some(record => archivePageRecordId(record) === item.legacyId))) {
        await deleteLegacy(item.legacyId);
    }
    return { ...item, storageVersion: 'v2', documentId: item.v2Id };
}
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
    function archivePageRef(roomId, uid, pageId) { return db.collection(COLLECTIONS.archivePages).doc(archivePageDocumentId(roomId, uid, pageId)); }
    function liveRoomRef(roomId) { return rtdb.ref(`presentationRooms/${roomId}`); }

    // RTDB is the canonical low-latency room state. Firestore retains the
    // directory, notes and archive projections and is repaired from this
    // revisioned outbox when its mirror write is unavailable.
    async function mirrorCanonicalRoom(room) {
        const ref = liveRoomRef(room.roomId);
        const initial = (await ref.get()).val();
        await ref.transaction(current => {
            current ||= initial;
            if (!current) return cloneValue(room);
            const next = hydrate(current);
            let membershipChanged = false;
            for (const slotId of Object.keys(room.slots || {})) {
                const incoming = room.slots[slotId]; const target = next.slots?.[slotId];
                if (!incoming?.uid || !target || target.uid === incoming.uid) continue;
                Object.assign(target, { uid: incoming.uid, displayName: incoming.displayName, originalRole: incoming.originalRole, joinedAt: incoming.joinedAt, bootstrapAt: incoming.bootstrapAt || target.bootstrapAt });
                membershipChanged = true;
            }
            // Firestore owns admission and notebook metadata, never physics.
            // Its revision cannot authorize replacing a newer live world.
            for (const [slotId, incoming] of Object.entries(room.slots)) {
                const target = next.slots[slotId];
                target.bootstrapAt = Math.max(target.bootstrapAt || 0, incoming.bootstrapAt || 0) || null;
                target.notesRevision = Math.max(target.notesRevision || 0, incoming.notesRevision || 0);
            }
            next.allParticipantsJoinedAt ||= room.allParticipantsJoinedAt || null;
            next.lastPresenterActivityAt = Math.max(next.lastPresenterActivityAt, room.lastPresenterActivityAt);
            next.expiresAt = Math.max(next.expiresAt, room.expiresAt);
            if (room.lifecycle === 'ended') Object.assign(next, { lifecycle: 'ended', endedAt: room.endedAt, endReason: room.endReason, archiveStatus: room.archiveStatus });
            if (membershipChanged || JSON.stringify(next) !== JSON.stringify(hydrate(current))) next.revision = Number(current.revision) + 1;
            return next;
        }, undefined, false);
        return cloneValue(room);
    }

    const mirroredAt = new Map();
    async function mirrorAuthority(room, receipts = {}) {
        await drainNoteEffects(room.roomId);
        room = roomState(room);
        delete room._effects;
        // Receipts leave the bounded hot room only after this durable write.
        // A crash before removal is safe: replay finds either copy.
        if (Object.keys(receipts).length) await rtdb.ref(`presentationReceipts/${room.roomId}`).update(receipts);
        if (room.lifecycle !== 'ended' && clock() - (mirroredAt.get(room.roomId) || 0) < 5000) return;
        await db.runTransaction(async tx => {
            const ref = roomRef(room.roomId), snap = await tx.get(ref);
            if (!snap.exists) return;
            const current = snap.data();
            if (Number(current.runtimeRevision || 0) > room.revision) return;
            const presenterLock = room.lifecycle === 'ended' || current.lifecycle === 'ended' ? await tx.get(lockRef(current.presenterUid)) : null;
            const next = cloneValue(room);
            for (const [id, slot] of Object.entries(current.slots)) {
                if (!next.slots[id].uid && slot.uid) Object.assign(next.slots[id], { uid: slot.uid, displayName: slot.displayName, originalRole: slot.originalRole, joinedAt: slot.joinedAt });
                next.slots[id].notes = [];
                next.slots[id].notesRevision = slot.notesRevision || 0;
            }
            next.lastPresenterActivityAt = Math.max(next.lastPresenterActivityAt, current.lastPresenterActivityAt);
            next.expiresAt = Math.max(next.expiresAt, current.expiresAt);
            if (current.lifecycle === 'ended') Object.assign(next, { lifecycle: 'ended', endedAt: current.endedAt, endReason: current.endReason, archiveStatus: current.archiveStatus });
            next.runtimeRevision = room.revision;
            tx.set(ref, next);
            if (next.lifecycle === 'ended' && presenterLock?.data()?.roomId === room.roomId) tx.delete(lockRef(next.presenterUid));
        });
        mirroredAt.set(room.roomId, clock());
        // Consume older outbox records left by the previous implementation.
        const outbox = rtdb.ref(`presentationRoomOutbox/${room.roomId}`);
        const queued = (await outbox.get()).val() || {};
        const done = Object.fromEntries(Object.entries(queued).filter(([, item]) => item.revision <= room.revision).map(([key]) => [key, null]));
        if (Object.keys(done).length) await outbox.update(done);
    }
    const authorityStore = createFirebaseAuthorityStore({
        rtdb,
        loadRoom: async id => { const snap = await roomRef(id).get(); return snap.exists ? snap.data() : null; },
        mirror: mirrorAuthority,
        readArchivedReceipt: async (id, key) => (await rtdb.ref(`presentationReceipts/${id}/${key}`).get()).val()
    });

    async function expireCanonicalRoom(roomId) {
        const checkedAt = clock();
        await authorityStore.ensure(roomId);
        const terminal = await authorityStore.transact(roomId, current => {
            if (!current || !ACTIVE_LIFECYCLES.has(current.lifecycle) || Number(current.expiresAt) > checkedAt) return undefined;
            Object.assign(current, { lifecycle: 'ended', endedAt: checkedAt, endReason: 'expired', archiveStatus: 'pending', revision: current.revision + 1 });
            if (current.gameplay) current.gameplay.inputs = {};
            return current;
        });
        const current = roomState(terminal.value);
        if (terminal.committed) {
            await drainNoteEffects(roomId);
            await mirrorAuthority(current);
        }
        return { committed: terminal.committed, room: current };
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
        const merged = liveRoom
            ? { ...firestoreRoom, ...liveRoom }
            : { ...firestoreRoom };
        const slots = Object.fromEntries(Object.keys(firestoreRoom.slots || {}).map(slotId => {
            const firestoreSlot = firestoreRoom.slots[slotId] || {};
            const liveSlot = liveRoom?.slots?.[slotId] || {};
            return [slotId, {
                ...firestoreSlot,
                ...(liveRoom ? liveSlot : {}),
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
        const liveSnap = await liveRoomRef(roomId).get();
        const liveRoom = liveSnap.exists() ? hydrate(liveSnap.val()) : null;
        const current = mergeRoomState(firestoreRoom, liveRoom);
        if (ACTIVE_LIFECYCLES.has(current.lifecycle) && Number(current.expiresAt) <= clock()) {
            const canonical = await expireCanonicalRoom(roomId);
            return canonical.room ? mergeRoomState(firestoreRoom, canonical.room) : null;
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
        await mirrorCanonicalRoom(room);
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
        let denied = null;
        await authorityStore.ensure(roomId);
        await authorityStore.transact(roomId, current => {
            denied = null;
            if (current.presenterUid !== identity.uid) { denied = true; return undefined; }
            if (current.lifecycle === 'ended') return undefined;
            Object.assign(current, { lifecycle: 'ended', endedAt: clock(), endReason: reason, archiveStatus: 'pending', revision: current.revision + 1 });
            if (current.gameplay) current.gameplay.inputs = {};
            return current;
        });
        if (denied) fail('ACTOR_MISMATCH');
        await drainNoteEffects(roomId);
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
        await mirrorCanonicalRoom(room);
        const canonical = roomState(await authorityStore.read(roomId));
        await mirrorAuthority(canonical);
        return cloneValue(canonical);
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
        const projected = await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists || snap.data().lifecycle !== 'ended') fail('ROOM_NOT_FOUND');
            const room = snap.data(); room.archiveStatus = status; tx.set(ref, room); return room;
        });
        await authorityStore.ensure(roomId);
        const canonical = await authorityStore.transact(roomId, current => {
            if (!current || current.lifecycle !== 'ended') return undefined;
            if (current.archiveStatus === status) return undefined;
            current.archiveStatus = status; current.revision += 1;
            return current;
        });
        return cloneValue(canonical.value ? roomState(canonical.value) : projected);
    }

    async function throttle(identity, scope, maximum) {
        const window = Math.floor(clock() / 60000), ref = operationRef('rate', operationHash([identity.uid, scope, window]));
        await db.runTransaction(async tx => {
            const snap = await tx.get(ref), count = snap.exists ? snap.data().count : 0;
            if (count >= maximum) fail('RATE_LIMITED', 'Please wait a minute before trying again.');
            tx.set(ref, { uid: identity.uid, scope, window, count: count + 1, expiresAt: (window + 2) * 60000 });
        });
    }
    async function recordExport(identity, record) {
        await operationRef('export', crypto.randomUUID()).set({ ...record, uid: identity.uid, kind: 'export', at: clock() });
    }

    async function listPendingArchives(limit = 100) {
        const snap = await db.collection(COLLECTIONS.rooms).where('archiveStatus', 'in', ['pending', 'failed']).limit(Math.min(100, Math.max(1, limit))).get();
        return snap.docs.map(doc => doc.data()).filter(room => ['pending', 'failed'].includes(room.archiveStatus)).sort((a, b) => Number(a.endedAt || 0) - Number(b.endedAt || 0)).slice(0, Math.max(0, limit));
    }

    async function reconcileTerminalRooms(limit = 100) {
        const maximum = Math.min(100, Math.max(1, Number(limit) || 100));
        const candidates = new Map();
        for (const status of ['pending', 'failed']) {
            const snap = await rtdb.ref('presentationRooms').orderByChild('archiveStatus').equalTo(status).limitToFirst(maximum).get();
            for (const [roomId, value] of Object.entries(snap.val() || {})) {
                const room = roomState(value);
                if (room?.lifecycle === 'ended') candidates.set(roomId, room);
            }
        }
        const terminal = [...candidates.values()].sort((a, b) => Number(a.endedAt || 0) - Number(b.endedAt || 0)).slice(0, maximum);
        for (const room of terminal) await mirrorAuthority(room);
        return terminal;
    }

    async function cleanupTransient(limit = 100) {
        const maximum = Math.min(100, Math.max(1, limit));
        let removed = 0;
        for (const collection of [COLLECTIONS.tickets, COLLECTIONS.operations]) {
            const expired = await db.collection(collection).where('expiresAt', '<=', clock()).limit(maximum).get();
            for (const doc of expired.docs) {
                const value = doc.data();
                // Accepted effects and receipts are retained. Unaccepted staging
                // is terminally fenced before deleting, so a retry cannot attach
                // a reference to a payload that cleanup has removed.
                if (value.status === 'staged') {
                    const room = await authorityStore.read(value.roomId);
                    if (!room || room.lifecycle !== 'ended' || Object.keys(room._effects || {}).length) continue;
                }
                if (collection === COLLECTIONS.operations && value.status && value.status !== 'staged') continue;
                await doc.ref.delete(); removed++;
            }
        }
        return { removed };
    }

    async function expireDue() {
        const cursorRef = operationRef('maintenance', 'expiry-scan');
        const cursor = (await cursorRef.get()).data();
        let query = db.collection(COLLECTIONS.rooms).where('expiresAt', '<=', clock()).orderBy('expiresAt').orderBy('__name__');
        if (cursor) query = query.startAfter(cursor.lastExpiresAt, cursor.roomId);
        const snap = await query.limit(100).get();
        const expired = [];
        for (const doc of snap.docs) {
            if (!ACTIVE_LIFECYCLES.has(doc.data().lifecycle)) continue;
            const terminal = await expireCanonicalRoom(doc.id);
            if (terminal.committed) expired.push(terminal.room);
        }
        if (snap.size === 100) {
            const last = snap.docs.at(-1); await cursorRef.set({ lastExpiresAt: last.data().expiresAt, roomId: last.id, kind: 'expiry-cursor' });
        } else await cursorRef.delete();
        return expired;
    }

    const roomService = { authorityStore, createOrResume, end, expireDue, cleanupTransient, getRoom, issueTicket, join, listRooms, listPendingArchives, reconcileTerminalRooms, markArchiveStatus, markBootstrap, consumeTicket, syncRuntimeState, touchPresenter, updateNotebookMetadata, throttle, recordExport, refreshRuntimeOnRead: true, durable: true };

    async function membership(roomId, uid) {
        const room = await getRoom(roomId);
        if (!room) fail('ROOM_NOT_FOUND');
        const slot = Object.values(room.slots).find(candidate => candidate.uid === uid);
        if (!slot) fail('NOTE_FORBIDDEN');
        return { room, slot };
    }

    const visible = pages => (pages || []).filter(page => page.deleted !== true);
    const revision = (pages, meta = null) => Number(meta?.revision) || (pages || []).reduce((sum, page) => sum + (Number(page.version) || 0), 0);

    async function snapshotNotebooks(input, roomId, targetUids) {
        const identity = input ? assertActiveIdentity(input) : null;
        return db.runTransaction(async tx => {
            const roomSnap = await tx.get(roomRef(roomId));
            if (!roomSnap.exists) fail('ROOM_NOT_FOUND');
            const room = roomSnap.data();
            const viewer = identity && Object.values(room.slots).find(slot => slot.uid === identity.uid);
            if (identity) assertRoomActor(identity, viewer && { uid: viewer.uid, seatId: viewer.slotId, role: viewer.role });
            const uids = [...new Set(targetUids.map(raw => room.slots[raw]?.uid || raw))];
            for (const uid of uids) {
                if (!Object.values(room.slots).some(slot => slot.uid === uid)) fail('NOTE_FORBIDDEN');
                if (identity && uid !== identity.uid && (viewer.role !== 'presenter' || !identity.isAdmin)) fail('NOTE_FORBIDDEN');
            }
            const metas = uids.length ? await tx.getAll(...uids.map(uid => notebookRef(roomId, uid))) : [];
            const notebooks = {};
            for (let i = 0; i < uids.length; i++) {
                const uid = uids[i], meta = metas[i].exists ? metas[i].data() : { pageIds: [], revision: 0 };
                const refs = (meta.pageIds || []).map(id => notebookPageRef(roomId, uid, id));
                const documents = refs.length ? await tx.getAll(...refs) : [];
                const pages = documents.filter(snap => snap.exists).map(snap => snap.data()).sort((a, b) => a.id.localeCompare(b.id));
                notebooks[uid] = { roomId, uid, notebookRevision: revision(pages, meta), pages: visible(pages) };
            }
            return { room, notebooks };
        }, { readOnly: true });
    }

    async function commitNote(input, roomId, targetUid, page, deleting) {
        const identity = assertActiveIdentity(input);
        if (String(targetUid || identity.uid) !== identity.uid) fail('NOTE_AUTHOR_ONLY');
        if (!page || !/^[A-Za-z0-9:_-]{1,128}$/.test(page.pageId || '') || !Number.isSafeInteger(page.expectedVersion) || page.expectedVersion < 0
            || (!deleting && (typeof page.title !== 'string' || page.title.length > 200 || typeof page.body !== 'string' || page.body.length > 50000))
            || (page.operationId !== undefined && !/^[A-Za-z0-9:_-]{1,128}$/.test(page.operationId))) fail('NOTE_INVALID');
        const ref = roomRef(roomId), notesRef = notebookRef(roomId, identity.uid), pageRef = notebookPageRef(roomId, identity.uid, page.pageId);
        const receiptRef = page.operationId ? operationRef('note', operationHash([roomId, identity.uid, page.operationId])) : null;
        const inputHash = operationHash([deleting, page.pageId, page.expectedVersion, page.title, page.body]);
        const now = clock();
        const saved = await db.runTransaction(async tx => {
            const roomSnap = await tx.get(ref);
            const room = roomSnap.exists ? roomSnap.data() : null;
            if (!room) fail('ROOM_NOT_FOUND');
            const member = Object.values(room.slots).find(slot => slot.uid === identity.uid);
            assertRoomActor(identity, member && { uid: member.uid, seatId: member.slotId, role: member.role });
            const receiptSnap = receiptRef && await tx.get(receiptRef);
            if (receiptSnap?.exists && receiptSnap.data().status !== 'staged') {
                const receipt = receiptSnap.data();
                if (receipt.status === 'failed') fail(receipt.error.code, receipt.error.message);
                if (receipt.inputHash !== inputHash) fail('OPERATION_ID_REUSED');
                return deleting ? receipt.result : { roomId, uid: identity.uid, id: page.pageId, title: page.title, body: page.body, ...receipt.result };
            }
            // The canonical effect reference was accepted before the End fence.
            // End drains it before freezing the notebook, even after termination.
            const notesSnap = await tx.get(notesRef), pageSnap = await tx.get(pageRef);
            const meta = notesSnap.exists ? notesSnap.data() : { pageIds: [], revision: 0, activeCount: 0 };
            const current = pageSnap.exists ? pageSnap.data() : null, currentVersion = current?.version || 0;
            if (currentVersion !== page.expectedVersion || (deleting && (!current || current.deleted))) fail('NOTE_CONFLICT');
            let activeCount = meta.activeCount;
            if (!Number.isSafeInteger(activeCount)) {
                const refs = (meta.pageIds || []).map(id => notebookPageRef(roomId, identity.uid, id));
                const oldPages = refs.length ? await tx.getAll(...refs) : [];
                activeCount = oldPages.filter(snap => snap.exists && !snap.data().deleted).length;
            }
            if (!deleting && (!current || current.deleted) && activeCount >= MAX_PAGES) fail('NOTE_PAGE_LIMIT');
            if (!current && (meta.pageIds || []).length >= 1000) fail('NOTE_PAGE_LIMIT');
            const value = deleting ? { roomId, uid: identity.uid, id: current.id, version: currentVersion + 1, deleted: true, deletedAt: now, deletedBy: identity.uid }
                : { roomId, uid: identity.uid, id: page.pageId, title: page.title, body: page.body, version: currentVersion + 1, updatedAt: now, updatedBy: identity.uid };
            const pageIds = current ? [...(meta.pageIds || [])] : [...(meta.pageIds || []), page.pageId];
            const nextRevision = (Number(meta.revision) || 0) + 1;
            tx.set(pageRef, value);
            tx.set(notesRef, { roomId, uid: identity.uid, pageIds, revision: nextRevision, activeCount: activeCount + (deleting ? -1 : !current || current.deleted ? 1 : 0), updatedAt: now });
            room.slots[member.slotId].notes = []; room.slots[member.slotId].notesRevision = nextRevision;
            if (identity.uid === room.presenterUid) { room.lastPresenterActivityAt = now; room.expiresAt = now + DAY_MS; }
            tx.set(ref, room);
            const result = deleting ? { deleted: true, pageId: page.pageId, pages: [] } : value;
            if (receiptRef) tx.set(receiptRef, { inputHash, roomId, status: 'complete', result: deleting ? result : { version: value.version, updatedAt: now, updatedBy: identity.uid }, completedAt: now });
            return result;
        });
        // No post-commit mutation can turn a successful save into ROOM_ENDED.
        // The owner also reconciles the directory at its next mirror pass.
        if (identity.isAdmin) {
            const snap = await roomRef(roomId).get().catch(() => null);
            if (snap?.exists && snap.data().presenterUid === identity.uid) await mirrorCanonicalRoom(snap.data()).catch(() => {});
        }
        return cloneValue(saved);
    }
    const effectDrains = new Map();
    async function removeNoteEffect(roomId, id) {
        await authorityStore.transact(roomId, room => {
            if (!room?._effects?.[id]) return undefined;
            delete room._effects[id]; return room;
        });
    }
    async function processNoteEffect(roomId, id, inputPage = null) {
        const ref = operationRef('note', id), snap = await ref.get();
        if (!snap.exists) fail('OUTCOME_UNKNOWN', 'The accepted note effect is temporarily unavailable.');
        const operation = snap.data();
        if (operation.status === 'complete' || operation.status === 'failed') {
            await removeNoteEffect(roomId, id);
            if (operation.status === 'failed') fail(operation.error.code, operation.error.message);
            return inputPage && !operation.result.deleted ? { id: inputPage.pageId, title: inputPage.title, body: inputPage.body, ...operation.result } : operation.result;
        }
        try {
            const result = await commitNote(operation.identity, roomId, operation.identity.uid, operation.page, operation.deleting);
            await removeNoteEffect(roomId, id).catch(() => {});
            return result;
        } catch (error) {
            if (['NOTE_CONFLICT', 'NOTE_PAGE_LIMIT', 'NOTE_INVALID'].includes(error.code)) {
                await ref.set({ inputHash: operation.inputHash, status: 'failed', error: { code: error.code, message: error.message }, completedAt: clock(), roomId });
                await removeNoteEffect(roomId, id).catch(() => {});
            }
            throw error;
        }
    }
    async function drainNoteEffects(roomId) {
        if (effectDrains.has(roomId)) return effectDrains.get(roomId);
        const pending = (async () => {
            const room = await authorityStore.read(roomId);
            for (const id of Object.keys(room?._effects || {})) {
                try { await processNoteEffect(roomId, id); }
                catch (error) { if (!['NOTE_CONFLICT', 'NOTE_PAGE_LIMIT', 'NOTE_INVALID'].includes(error.code)) throw error; }
            }
        })().finally(() => effectDrains.delete(roomId));
        effectDrains.set(roomId, pending); return pending;
    }
    async function stageNote(input, roomId, targetUid, inputPage, deleting = false) {
        const identity = assertActiveIdentity(input);
        if (String(targetUid || identity.uid) !== identity.uid) fail('NOTE_AUTHOR_ONLY');
        const page = { ...inputPage, operationId: inputPage?.operationId || crypto.randomUUID() };
        if (!/^[A-Za-z0-9:_-]{1,128}$/.test(page.pageId || '') || !/^[A-Za-z0-9:_-]{1,128}$/.test(page.operationId) || !Number.isSafeInteger(page.expectedVersion) || page.expectedVersion < 0
            || (!deleting && (typeof page.title !== 'string' || page.title.length > 200 || typeof page.body !== 'string' || page.body.length > 50000))) fail('NOTE_INVALID');
        const id = operationHash([roomId, identity.uid, page.operationId]), ref = operationRef('note', id);
        const inputHash = operationHash([deleting, page.pageId, page.expectedVersion, page.title, page.body]);
        const member = await membership(roomId, identity.uid);
        assertRoomActor(identity, { uid: identity.uid, seatId: member.slot.slotId, role: member.slot.role });
        const original = await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (snap.exists) {
                const current = snap.data();
                if (current.inputHash !== inputHash) fail('OPERATION_ID_REUSED');
                return current;
            }
            const staged = { inputHash, status: 'staged', roomId, identity: { uid: identity.uid, accountStatus: 'active', isAdmin: identity.isAdmin, isTeacher: identity.isTeacher }, page, deleting, stagedAt: clock(), expiresAt: clock() + 86400000 };
            tx.set(ref, staged); return staged;
        });
        if (original.status === 'failed') fail(original.error.code, original.error.message);
        if (original.status === 'complete') return { id, result: deleting ? original.result : { roomId, uid: identity.uid, id: page.pageId, title: page.title, body: page.body, ...original.result } };
        let rejected = null;
        await authorityStore.transact(roomId, room => {
            rejected = null;
            if (room?._effects?.[id]) return undefined;
            try {
                assertCurrentRoom(room);
                const slot = Object.values(room.slots).find(slot => slot.uid === identity.uid);
                assertRoomActor(identity, slot && { uid: slot.uid, seatId: slot.slotId, role: slot.role });
                room._effects ||= {};
                if (Object.keys(room._effects).length >= 32) fail('RATE_LIMITED');
                room._effects[id] = { kind: 'note', acceptedAt: clock() };
                return room;
            } catch (error) { rejected = error; return undefined; }
        });
        if (rejected) {
            // A worker can finish and remove the effect between staging and
            // this transaction. Its committed receipt still wins over End.
            const receipt = (await ref.get()).data();
            if (receipt?.status === 'complete' && receipt.inputHash === inputHash) return { id, result: deleting ? receipt.result : { roomId, uid: identity.uid, id: page.pageId, title: page.title, body: page.body, ...receipt.result } };
            throw rejected;
        }
        return { id, accepted: true };
    }
    async function mutateNote(input, roomId, targetUid, page, deleting) {
        const staged = await stageNote(input, roomId, targetUid, page, deleting);
        if (staged.result) return staged.result;
        return processNoteEffect(roomId, staged.id, page);
    }
    const notes = {
        snapshotNotebooks, stageNote, drainNoteEffects,
        async readNotebook(input, roomId, targetUid) {
            const identity = assertActiveIdentity(input);
            return Object.values((await snapshotNotebooks(identity, roomId, [targetUid || identity.uid])).notebooks)[0];
        },
        async readNotebookByUid(inputOrRoomId, roomIdOrUid, maybeUid) {
            const hasActor = inputOrRoomId && typeof inputOrRoomId === 'object';
            const identity = hasActor ? assertActiveIdentity(inputOrRoomId) : null;
            const roomId = hasActor ? roomIdOrUid : inputOrRoomId, uid = hasActor ? maybeUid : roomIdOrUid;
            return Object.values((await snapshotNotebooks(identity, roomId, [uid])).notebooks)[0];
        },
        savePage: (input, roomId, targetUid, page) => mutateNote(input, roomId, targetUid, page, false),
        deletePage: (input, roomId, targetUid, page) => mutateNote(input, roomId, targetUid, page, true)
    };

    function archiveChecksum(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
    const archives = {
        async archiveRoom(inputOrRoomId, maybeRoomId) {
            const hasActor = inputOrRoomId && typeof inputOrRoomId === 'object';
            const identity = hasActor ? assertPresenter(inputOrRoomId) : null;
            const roomId = hasActor ? maybeRoomId : inputOrRoomId;
            await drainNoteEffects(roomId);
            const ref = roomRef(roomId); const started = await db.runTransaction(async tx => {
                const roomSnap = await tx.get(ref); if (!roomSnap.exists || roomSnap.data().lifecycle !== 'ended') fail('ROOM_NOT_TERMINAL');
                const room = roomSnap.data(); if (identity && room.presenterUid !== identity.uid) fail('PRESENTER_ONLY');
                const existingSnap = await tx.get(archiveRef(roomId)); if (existingSnap.exists && existingSnap.data().status === 'archived') return existingSnap.data();
                const members = Object.values(room.slots).filter(slot => slot.uid).map(slot => ({ uid: slot.uid, seatId: slot.slotId, role: slot.role, displayName: slot.displayName, joinedAt: slot.joinedAt }));
                const value = { archiveId: roomId, roomId, status: 'pending', createdAt: clock(), sourceRevision: room.revision, members, gameplay: room.gameplay, deck: room.deck };
                if (existingSnap.exists) tx.set(archiveRef(roomId), value); else tx.create(archiveRef(roomId), value);
                room.archiveStatus = 'pending'; tx.set(ref, room); return value;
            });
            if (started.status === 'archived') { await markArchiveStatus(roomId, 'archived'); return cloneValue(started); }
            const notebooks = {};
            for (const member of started.members) {
                const notebook = await notes.readNotebookByUid(roomId, member.uid);
                notebooks[member.uid] = { notebookRevision: notebook.notebookRevision, pages: notebook.pages };
                for (const page of notebook.pages) await archivePageRef(roomId, member.uid, page.id).set({ ...page, roomId, uid: member.uid });
            }
            const payload = { roomId, sourceRevision: started.sourceRevision, members: started.members, notebooks, gameplay: started.gameplay, deck: started.deck };
            const archive = await db.runTransaction(async tx => {
                const snap = await tx.get(archiveRef(roomId)); const roomSnap = await tx.get(ref); if (!snap.exists) fail('ARCHIVE_NOT_FOUND');
                const value = snap.data(); if (value.status === 'archived') return value;
                const next = { ...value, status: 'archived', checksum: archiveChecksum(payload), notebookRevisions: Object.fromEntries(Object.entries(notebooks).map(([uid, item]) => [uid, item.notebookRevision])), completedAt: clock() };
                tx.set(archiveRef(roomId), next); if (roomSnap.exists) { const room = roomSnap.data(); room.archiveStatus = 'archived'; tx.set(ref, room); } return next;
            });
            await markArchiveStatus(roomId, 'archived');
            return { ...cloneValue(archive), notebooks: cloneValue(notebooks) };
        },
        async readArchive(input, roomId) {
            const identity = assertActiveIdentity(input); const room = await getRoom(roomId); const current = room && Object.values(room.slots).find(value => value.uid === identity.uid); assertRoomActor(identity, current && { uid: current.uid, seatId: current.slotId, role: current.role });
            const snap = await archiveRef(roomId).get(); if (!snap.exists || snap.data().status !== 'archived') fail('ARCHIVE_NOT_FOUND');
            const archive = snap.data(); const member = archive.members.find(value => value.uid === identity.uid); if (!member) fail('EXPORT_FORBIDDEN');
            // Reads stay field-based so v1 colon-joined archive pages remain
            // compatible during migration. The resolver chooses one verified
            // page per tuple, prefers v2 when mixed storage is identical, and
            // fails closed on a conflicting legacy/v2 pair.
            const pageSnap = await db.collection(COLLECTIONS.archivePages).where('roomId', '==', roomId).get(); const targetMembers = member.role === 'presenter' ? archive.members : [member]; const notebooks = {};
            for (const target of targetMembers) {
                const pages = resolveArchivePageRecords(pageSnap.docs.map(doc => ({ id: doc.id, data: doc.data() })), { roomId, uid: target.uid });
                notebooks[target.uid] = { notebookRevision: archive.notebookRevisions?.[target.uid] || revision(pages.map(item => item.page)), pages: pages.map(item => cloneValue(item.page)) };
            }
            return { archiveId: archive.archiveId, roomId: archive.roomId, status: archive.status, checksum: archive.checksum, members: cloneValue(archive.members), notebooks };
        }
    };

    return { COLLECTIONS, roomService: { ...roomService, claimRuntimeOwner, readRuntimeCommandReceipt, writeRuntimeCommandReceipt }, notes, archives, stores: { durable: true, db, rtdb } };
}

module.exports = {
    COLLECTIONS,
    archivePageDocumentId,
    archivePageDocumentIdCandidates,
    archivePageSemanticValue,
    createFirebasePresentationDemoServices,
    decodeArchivePageDocumentId,
    legacyArchivePageDocumentId,
    migrateArchivePageRecord,
    notebookId,
    resolveArchivePageRecords,
    ticketId
};
