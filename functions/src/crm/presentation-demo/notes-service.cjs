'use strict';

const crypto = require('node:crypto');
const { assertActiveIdentity, assertRoomActor } = require('./identity.cjs');
const { MAX_NOTE_BODY, clone, fail } = require('./contracts.cjs');
const MAX_PAGES = 100, MAX_PAGE_IDS = 1000;
const key = (roomId, uid) => roomId + ':' + uid;
const visible = pages => pages.filter(page => page.deleted !== true);
const revision = pages => pages.reduce((sum, page) => sum + page.version, 0);
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function createNotebookService({ roomService, clock = Date.now, maxPages = MAX_PAGES } = {}) {
    if (!roomService?.withRoomLock) throw new TypeError('Transactional roomService required');
    const stores = roomService.stores;
    stores.noteReceipts ||= new Map();
    function member(roomId, identity) {
        const room = stores.rooms.get(roomId);
        if (!room) fail('ROOM_NOT_FOUND');
        const slot = Object.values(room.slots).find(slot => slot.uid === identity.uid);
        if (!slot) fail('NOTE_FORBIDDEN');
        assertRoomActor(identity, { uid: slot.uid, seatId: slot.slotId, role: slot.role });
        return { room, slot };
    }
    const pagesFor = (roomId, uid) => clone(stores.notebooks.get(key(roomId, uid)) || []);
    function targetFor(room, target, fallback) { return room.slots[target]?.uid || target || fallback; }
    async function snapshotNotebooks(input, roomId, targetUids) {
        const identity = assertActiveIdentity(input);
        return roomService.withRoomLock(() => {
            const { room, slot } = member(roomId, identity);
            const notebooks = {};
            for (const raw of targetUids) {
                const uid = targetFor(room, raw, identity.uid);
                if (uid !== identity.uid && (slot.role !== 'presenter' || !identity.isAdmin)) fail('NOTE_FORBIDDEN');
                if (!Object.values(room.slots).some(slot => slot.uid === uid)) fail('NOTE_FORBIDDEN');
                const pages = pagesFor(roomId, uid);
                notebooks[uid] = { roomId, uid, notebookRevision: revision(pages), pages: visible(pages) };
            }
            return { room: clone(room), notebooks };
        });
    }
    async function readNotebook(input, roomId, targetUid) {
        const identity = assertActiveIdentity(input);
        const snapshot = await snapshotNotebooks(identity, roomId, [targetUid || identity.uid]);
        return Object.values(snapshot.notebooks)[0];
    }
    async function readNotebookByUid(inputOrRoomId, roomIdOrUid, maybeUid) {
        if (typeof inputOrRoomId === 'object') return readNotebook(inputOrRoomId, roomIdOrUid, maybeUid);
        // Internal terminal archive reader. Callers with a user identity use
        // the authorized overload above.
        const roomId = inputOrRoomId, uid = roomIdOrUid;
        return roomService.withRoomLock(() => {
            const room = stores.rooms.get(roomId);
            if (!room || !Object.values(room.slots).some(slot => slot.uid === uid)) fail('NOTE_FORBIDDEN');
            const pages = pagesFor(roomId, uid);
            return { roomId, uid, notebookRevision: revision(pages), pages: visible(pages) };
        });
    }
    async function mutate(input, roomId, targetUid, page, deleting) {
        const identity = assertActiveIdentity(input);
        if (!page || !/^[A-Za-z0-9:_-]{1,128}$/.test(page.pageId || '') || !Number.isSafeInteger(page.expectedVersion) || page.expectedVersion < 0
            || (!deleting && (typeof page.title !== 'string' || page.title.length > 200 || typeof page.body !== 'string' || page.body.length > MAX_NOTE_BODY))
            || (page.operationId !== undefined && !/^[A-Za-z0-9:_-]{1,128}$/.test(page.operationId))) fail('NOTE_INVALID');
        return roomService.withRoomLock(() => {
            const { room, slot } = member(roomId, identity);
            const target = targetFor(room, targetUid, identity.uid);
            if (target !== identity.uid) fail('NOTE_AUTHOR_ONLY');
            const receiptKey = page.operationId ? hash([roomId, identity.uid, page.operationId]) : null;
            const inputHash = hash([deleting, page.pageId, page.expectedVersion, page.title, page.body]);
            const previous = receiptKey && stores.noteReceipts.get(receiptKey);
            if (previous) {
                if (previous.inputHash !== inputHash) fail('OPERATION_ID_REUSED');
                return deleting ? clone(previous.result) : { id: page.pageId, title: page.title, body: page.body, ...clone(previous.result) };
            }
            if (room.lifecycle === 'ended' || room.expiresAt <= clock()) fail('ROOM_ENDED');
            const pages = pagesFor(roomId, target);
            const index = pages.findIndex(item => item.id === page.pageId), current = pages[index];
            if ((current?.version || 0) !== page.expectedVersion || (deleting && (!current || current.deleted))) fail('NOTE_CONFLICT');
            if (!deleting && (!current || current.deleted) && visible(pages).length >= maxPages) fail('NOTE_PAGE_LIMIT');
            if (!current && pages.length >= MAX_PAGE_IDS) fail('NOTE_PAGE_LIMIT');
            const now = clock();
            const saved = deleting ? { id: current.id, version: current.version + 1, deleted: true, deletedAt: now, deletedBy: identity.uid }
                : { id: page.pageId, title: page.title, body: page.body, version: (current?.version || 0) + 1, updatedAt: now, updatedBy: identity.uid };
            if (index < 0) pages.push(saved); else pages[index] = saved;
            stores.notebooks.set(key(roomId, target), pages);
            slot.notes = []; slot.notesRevision = revision(pages);
            if (identity.uid === room.presenterUid) { room.lastPresenterActivityAt = now; room.expiresAt = now + 86400000; }
            stores.rooms.set(roomId, room);
            const result = deleting ? { deleted: true, pageId: page.pageId, pages: [] } : clone(saved);
            if (receiptKey) {
                const compact = deleting ? { deleted: true, pageId: page.pageId, pages: [] } : { id: saved.id, version: saved.version, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy };
                stores.noteReceipts.set(receiptKey, { inputHash, result: compact });
            }
            return result;
        });
    }
    return { snapshotNotebooks, readNotebook, readNotebookByUid,
        savePage: (identity, roomId, uid, page) => mutate(identity, roomId, uid, page, false),
        deletePage: (identity, roomId, uid, page) => mutate(identity, roomId, uid, page, true) };
}
module.exports = { MAX_PAGES, createNotebookService };
