'use strict';

const { assertActiveIdentity, assertRoomActor } = require('./identity.cjs');
const { MAX_NOTE_BODY, clone, fail } = require('./contracts.cjs');

const MAX_PAGES = 100;
const MAX_TITLE = 200;

function key(roomId, uid) { return `${roomId}:${uid}`; }

function createNotebookService({ roomService, clock = () => Date.now(), maxPages = MAX_PAGES } = {}) {
    if (!roomService) throw new TypeError('roomService is required');

    async function membership(roomId, uid) {
        const room = await roomService.getRoom(roomId);
        if (!room) fail('ROOM_NOT_FOUND');
        const slot = Object.values(room.slots).find(candidate => candidate.uid === uid);
        if (!slot) fail('NOTE_FORBIDDEN');
        return { room, slot };
    }

    function pagesFor(roomId, uid) {
        const pages = roomService.stores.notebooks.get(key(roomId, uid));
        return pages ? clone(pages) : [];
    }

    function resolveTargetUid(room, value, fallbackUid) {
        const raw = String(value || fallbackUid);
        return room.slots[raw]?.uid || raw;
    }

    async function readNotebook(input, roomId, targetUid) {
        const identity = assertActiveIdentity(input);
        const { room, slot: requester } = await membership(roomId, identity.uid);
        const target = resolveTargetUid(room, targetUid, identity.uid);
        if (target !== identity.uid && requester.role !== 'presenter') fail('NOTE_FORBIDDEN');
        await membership(roomId, target);
        assertRoomActor(identity, { uid: requester.uid, seatId: requester.slotId, role: requester.role });
        return { roomId: room.roomId, uid: target, notebookRevision: pagesFor(roomId, target).length, pages: pagesFor(roomId, target) };
    }

    async function savePage(input, roomId, targetUid, page) {
        const identity = assertActiveIdentity(input);
        const { room, slot: requester } = await membership(roomId, identity.uid);
        const target = resolveTargetUid(room, targetUid, identity.uid);
        if (target !== identity.uid && requester.role !== 'presenter') fail('NOTE_FORBIDDEN');
        const targetMembership = (await membership(roomId, target)).slot;
        assertRoomActor(identity, { uid: requester.uid, seatId: requester.slotId, role: requester.role });
        if (!page || !/^[A-Za-z0-9:_-]{1,128}$/.test(page.pageId || '') || typeof page.title !== 'string' || page.title.length > MAX_TITLE || typeof page.body !== 'string' || page.body.length > MAX_NOTE_BODY || !Number.isSafeInteger(page.expectedVersion) || page.expectedVersion < 0) fail('NOTE_INVALID');
        const pages = pagesFor(roomId, target);
        const index = pages.findIndex(candidate => candidate.id === page.pageId);
        const current = index >= 0 ? pages[index] : null;
        const currentVersion = current?.version || 0;
        if (currentVersion !== page.expectedVersion) fail('NOTE_CONFLICT');
        const saved = { id: page.pageId, title: page.title, body: page.body, version: currentVersion + 1, updatedAt: clock(), updatedBy: identity.uid };
        if (index >= 0) pages[index] = saved;
        else {
            if (pages.length >= maxPages) fail('NOTE_PAGE_LIMIT');
            pages.push(saved);
        }
        roomService.stores.notebooks.set(key(roomId, target), clone(pages));
        targetMembership.notes = clone(pages);
        targetMembership.notesRevision = pages.reduce((sum, candidate) => sum + candidate.version, 0);
        if (identity.uid === room.presenterUid) {
            await roomService.touchPresenter(identity, roomId);
        }
        await roomService.updateNotebookMetadata(roomId, targetMembership.slotId, { notes: pages, notesRevision: targetMembership.notesRevision });
        return clone(saved);
    }

    async function deletePage(input, roomId, targetUid, page) {
        const identity = assertActiveIdentity(input);
        const { room, slot: requester } = await membership(roomId, identity.uid);
        const target = resolveTargetUid(room, targetUid, identity.uid);
        if (target !== identity.uid && requester.role !== 'presenter') fail('NOTE_FORBIDDEN');
        const targetMembership = (await membership(roomId, target)).slot;
        assertRoomActor(identity, { uid: requester.uid, seatId: requester.slotId, role: requester.role });
        if (!page || !/^[A-Za-z0-9:_-]{1,128}$/.test(page.pageId || '') || !Number.isSafeInteger(page.expectedVersion) || page.expectedVersion < 0) fail('NOTE_INVALID');
        const pages = pagesFor(roomId, target);
        const index = pages.findIndex(candidate => candidate.id === page.pageId);
        if (index < 0 || pages[index].version !== page.expectedVersion) fail('NOTE_CONFLICT');
        pages.splice(index, 1);
        roomService.stores.notebooks.set(key(roomId, target), clone(pages));
        targetMembership.notes = clone(pages);
        if (identity.uid === room.presenterUid) {
            await roomService.touchPresenter(identity, roomId);
        }
        await roomService.updateNotebookMetadata(roomId, targetMembership.slotId, { notes: pages, notesRevision: pages.reduce((sum, candidate) => sum + candidate.version, 0) });
        return { deleted: true, pageId: page.pageId, pages: clone(pages) };
    }

    async function readNotebookByUid(roomId, uid) {
        await membership(roomId, uid);
        return { roomId, uid, notebookRevision: pagesFor(roomId, uid).length, pages: pagesFor(roomId, uid) };
    }

    return { deletePage, readNotebook, readNotebookByUid, savePage };
}

module.exports = { MAX_PAGES, createNotebookService };
