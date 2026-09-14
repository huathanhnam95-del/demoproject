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
    archives: 'presentationDemoArchives'
});
const DAY_MS = 24 * 60 * 60 * 1000;
const TICKET_MS = 60 * 1000;

function tokenHash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function operationHash(value) { return tokenHash(JSON.stringify(value ?? null)); }
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
    function archiveRef(roomId) { return db.collection(COLLECTIONS.archives).doc(String(roomId)); }

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
            fail('OPERATION_IN_PROGRESS');
        }
        await db.runTransaction(async tx => {
            const current = await tx.get(ref);
            if (current.exists) {
                const value = current.data() || {};
                if (value.inputHash !== hash) fail('OPERATION_ID_REUSED');
                if (value.status === 'complete') return;
                fail('OPERATION_IN_PROGRESS');
            }
            tx.create(ref, { inputHash: hash, status: 'pending', createdAt: clock() });
        });
        try {
            const result = await action();
            await ref.set({ inputHash: hash, status: 'complete', result: cloneValue(result), completedAt: clock() }, { merge: true });
            return result;
        } catch (error) {
            await ref.set({ inputHash: hash, status: 'failed', errorCode: error.code || 'PRESENTATION_DEMO_ERROR', failedAt: clock() }, { merge: true });
            throw error;
        }
    }

    async function getRoom(roomId) {
        const snap = await roomRef(roomId).get();
        return snap.exists ? cloneValue(snap.data()) : null;
    }

    async function listRooms(input, { limit = 50 } = {}) {
        const identity = assertActiveIdentity(input);
        const maximum = Math.min(100, Math.max(1, Number(limit) || 50));
        const snap = await db.collection(COLLECTIONS.rooms).get();
        return snap.docs.map(doc => doc.data())
            .filter(room => room.presenterUid === identity.uid || Object.values(room.slots || {}).some(slot => slot.uid === identity.uid))
            .sort((a, b) => Number(b.lastPresenterActivityAt || b.createdAt || 0) - Number(a.lastPresenterActivityAt || a.createdAt || 0))
            .slice(0, maximum)
            .map(room => ({ ...publicRoomSnapshot(room, identity.uid), roomId: room.roomId, code: room.code }));
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
            if (active) return publicResult(active, identity.uid);
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
                if (created) return publicResult(created, identity.uid);
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
            return { roomId: joined.room.roomId, code: joined.room.code, seatId: joined.seatId, role: joined.room.slots[joined.seatId].role, snapshot: await publicResult(joined.room, identity.uid) };
        }));
    }

    async function markBootstrap(input, roomId) {
        const identity = assertActiveIdentity(input);
        const ref = roomRef(roomId);
        const room = await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists) fail('ROOM_NOT_FOUND');
            const value = snap.data();
            const membership = Object.values(value.slots).find(slot => slot.uid === identity.uid);
            assertRoomActor(identity, membership && { uid: membership.uid, seatId: membership.slotId, role: membership.role });
            if (!membership.bootstrapAt) membership.bootstrapAt = clock();
            if (!value.allParticipantsJoinedAt && PARTICIPANT_SLOT_IDS.every(id => value.slots[id].uid && value.slots[id].bootstrapAt)) value.allParticipantsJoinedAt = clock();
            value.revision += 1;
            tx.set(ref, value);
            return value;
        });
        return publicResult(room, identity.uid);
    }

    async function issueTicket(input, roomId) {
        const identity = assertActiveIdentity(input);
        const room = await resolveRoom(roomId);
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
            if (value.presenterUid !== identity.uid) fail('ACTOR_MISMATCH');
            if (!ACTIVE_LIFECYCLES.has(value.lifecycle)) fail('ROOM_ENDED');
            value.lastPresenterActivityAt = clock();
            value.expiresAt = value.lastPresenterActivityAt + DAY_MS;
            value.revision += 1;
            tx.set(ref, value);
            return value;
        });
        return publicResult(room, identity.uid);
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

    async function syncRuntimeState(roomId, runtimeState) {
        const ref = roomRef(roomId);
        const persisted = await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists || snap.data().lifecycle === 'ended') fail('ROOM_ENDED');
            const current = snap.data();
            if (runtimeState.roomId !== current.roomId || runtimeState.revision < current.revision) fail('RUNTIME_REVISION_STALE');
            for (const slotId of Object.keys(current.slots)) {
                if (current.slots[slotId].uid !== runtimeState.slots?.[slotId]?.uid) fail('RUNTIME_MEMBERSHIP_STALE');
            }
            const next = cloneValue(runtimeState);
            for (const slotId of Object.keys(current.slots)) {
                next.slots[slotId].notes = cloneValue(current.slots[slotId].notes || []);
                next.slots[slotId].notesRevision = current.slots[slotId].notesRevision || 0;
            }
            tx.set(ref, next);
            return next;
        });
        await rtdb.ref(`presentationRooms/${roomId}`).set(cloneValue(persisted));
        return cloneValue(persisted);
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
        const snap = await notebookRef(roomId, uid).get();
        const pages = snap.exists ? snap.data().pages || [] : [];
        return cloneValue(pages);
    }
    const visible = pages => (pages || []).filter(page => page.deleted !== true);
    const revision = pages => (pages || []).reduce((max, page) => Math.max(max, Number(page.version) || 0), 0);

    const notes = {
        async readNotebook(input, roomId, targetUid) {
            const identity = assertActiveIdentity(input);
            const { room, slot } = await membership(roomId, identity.uid);
            const target = String(targetUid || identity.uid);
            if (target !== identity.uid && slot.role !== 'presenter') fail('NOTE_FORBIDDEN');
            await membership(roomId, target);
            return { roomId, uid: target, notebookRevision: revision(await readPages(roomId, target)), pages: visible(await readPages(roomId, target)) };
        },
        async readNotebookByUid(roomId, uid) {
            await membership(roomId, uid);
            const pages = await readPages(roomId, uid);
            return { roomId, uid, notebookRevision: revision(pages), pages: visible(pages) };
        },
        async savePage(input, roomId, targetUid, page) {
            const identity = assertActiveIdentity(input);
            if (String(targetUid || identity.uid) !== identity.uid) fail('NOTE_AUTHOR_ONLY');
            if (!page || !/^[A-Za-z0-9:_-]{1,128}$/.test(page.pageId || '') || typeof page.title !== 'string' || page.title.length > 200 || typeof page.body !== 'string' || page.body.length > 50000 || !Number.isSafeInteger(page.expectedVersion) || page.expectedVersion < 0) fail('NOTE_INVALID');
            const roomRefValue = roomRef(roomId); const notesRef = notebookRef(roomId, identity.uid);
            const saved = await db.runTransaction(async tx => {
                const roomSnap = await tx.get(roomRefValue); const notesSnap = await tx.get(notesRef);
                if (!roomSnap.exists) fail('ROOM_NOT_FOUND');
                const room = roomSnap.data(); if (room.lifecycle === 'ended') fail('ROOM_ENDED');
                const member = Object.values(room.slots).find(slot => slot.uid === identity.uid); assertRoomActor(identity, member && { uid: member.uid, seatId: member.slotId, role: member.role });
                const pages = notesSnap.exists ? notesSnap.data().pages || [] : []; const index = pages.findIndex(candidate => candidate.id === page.pageId); const current = index >= 0 ? pages[index] : null; const currentVersion = current?.version || 0;
                if (currentVersion !== page.expectedVersion) fail('NOTE_CONFLICT');
                const value = { id: page.pageId, title: page.title, body: page.body, version: currentVersion + 1, updatedAt: clock(), updatedBy: identity.uid };
                if (index >= 0) pages[index] = value; else pages.push(value);
                tx.set(notesRef, { roomId, uid: identity.uid, pages, revision: revision(pages), updatedAt: clock() });
                const slot = room.slots[member.slotId]; slot.notes = visible(pages); slot.notesRevision = revision(pages); tx.set(roomRefValue, room);
                return value;
            });
            if (identity.uid === (await getRoom(roomId)).presenterUid) await touchPresenter(identity, roomId);
            return cloneValue(saved);
        },
        async deletePage(input, roomId, targetUid, page) {
            const identity = assertActiveIdentity(input);
            if (String(targetUid || identity.uid) !== identity.uid) fail('NOTE_AUTHOR_ONLY');
            if (!page || !/^[A-Za-z0-9:_-]{1,128}$/.test(page.pageId || '') || !Number.isSafeInteger(page.expectedVersion) || page.expectedVersion < 0) fail('NOTE_INVALID');
            const roomRefValue = roomRef(roomId); const notesRef = notebookRef(roomId, identity.uid);
            const result = await db.runTransaction(async tx => {
                const roomSnap = await tx.get(roomRefValue); const notesSnap = await tx.get(notesRef);
                if (!roomSnap.exists) fail('ROOM_NOT_FOUND'); const room = roomSnap.data(); if (room.lifecycle === 'ended') fail('ROOM_ENDED');
                const member = Object.values(room.slots).find(slot => slot.uid === identity.uid); assertRoomActor(identity, member && { uid: member.uid, seatId: member.slotId, role: member.role });
                const pages = notesSnap.exists ? notesSnap.data().pages || [] : []; const index = pages.findIndex(candidate => candidate.id === page.pageId);
                if (index < 0 || pages[index].version !== page.expectedVersion) fail('NOTE_CONFLICT');
                pages[index] = { ...pages[index], deleted: true, deletedAt: clock(), deletedBy: identity.uid };
                tx.set(notesRef, { roomId, uid: identity.uid, pages, revision: revision(pages), updatedAt: clock() });
                room.slots[member.slotId].notes = visible(pages); room.slots[member.slotId].notesRevision = revision(pages); tx.set(roomRefValue, room);
                return { deleted: true, pageId: page.pageId, pages: visible(pages) };
            });
            if (identity.uid === (await getRoom(roomId)).presenterUid) await touchPresenter(identity, roomId);
            return cloneValue(result);
        }
    };

    function archiveChecksum(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
    const archives = {
        async archiveRoom(roomId) {
            const ref = roomRef(roomId); const archive = await db.runTransaction(async tx => {
                const roomSnap = await tx.get(ref); if (!roomSnap.exists || roomSnap.data().lifecycle !== 'ended') fail('ROOM_NOT_TERMINAL');
                const room = roomSnap.data(); const existingSnap = await tx.get(archiveRef(roomId)); if (existingSnap.exists) return existingSnap.data();
                const notebookRefs = Object.values(room.slots).filter(slot => slot.uid).map(slot => ({ slot, ref: notebookRef(roomId, slot.uid) }));
                const notebookSnaps = []; for (const item of notebookRefs) notebookSnaps.push({ ...item, snap: await tx.get(item.ref) });
                const members = notebookRefs.map(item => ({ uid: item.slot.uid, seatId: item.slot.slotId, role: item.slot.role, displayName: item.slot.displayName, joinedAt: item.slot.joinedAt }));
                const notebooks = Object.fromEntries(notebookSnaps.map(item => { const pages = item.snap.exists ? item.snap.data().pages || [] : []; return [item.slot.uid, { notebookRevision: revision(pages), pages: visible(pages) }]; }));
                const payload = { roomId, sourceRevision: room.revision, members, notebooks }; const value = { archiveId: roomId, roomId, status: 'archived', createdAt: clock(), sourceRevision: room.revision, members, notebooks, checksum: archiveChecksum(payload) };
                tx.create(archiveRef(roomId), value); room.archiveStatus = 'archived'; tx.set(ref, room); return value;
            });
            return cloneValue(archive);
        },
        async readArchive(input, roomId) {
            const identity = assertActiveIdentity(input); const snap = await archiveRef(roomId).get(); if (!snap.exists) fail('ARCHIVE_NOT_FOUND');
            const archive = snap.data(); const member = archive.members.find(value => value.uid === identity.uid); if (!member) fail('EXPORT_FORBIDDEN'); assertRoomActor(identity, member);
            const notebooks = member.role === 'presenter' ? cloneValue(archive.notebooks) : { [identity.uid]: cloneValue(archive.notebooks[identity.uid] || { notebookRevision: 0, pages: [] }) };
            return { archiveId: archive.archiveId, roomId: archive.roomId, status: archive.status, checksum: archive.checksum, members: cloneValue(archive.members), notebooks };
        }
    };

    return { COLLECTIONS, roomService, notes, archives, stores: { durable: true, db, rtdb } };
}

module.exports = { COLLECTIONS, createFirebasePresentationDemoServices, notebookId, ticketId };
