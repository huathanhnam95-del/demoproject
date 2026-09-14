'use strict';

const crypto = require('node:crypto');
const { assertActiveIdentity, assertRoomActor } = require('./identity.cjs');
const { clone, fail } = require('./contracts.cjs');

function checksum(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function createArchiveService({ roomService, notesService, stores = roomService?.stores, clock = () => Date.now() } = {}) {
    if (!roomService || !notesService || !stores) throw new TypeError('roomService, notesService and stores are required');

    async function archiveRoom(roomId) {
        const room = await roomService.getRoom(roomId);
        if (!room || room.lifecycle !== 'ended') fail('ROOM_NOT_TERMINAL');
        const existing = stores.archives.get(roomId);
        if (existing) return clone(existing);
        const notebooks = {};
        const members = [];
        for (const slot of Object.values(room.slots)) {
            if (!slot.uid) continue;
            members.push({ uid: slot.uid, seatId: slot.slotId, role: slot.role, displayName: slot.displayName, joinedAt: slot.joinedAt });
            const notebook = await notesService.readNotebookByUid(roomId, slot.uid);
            notebooks[slot.uid] = { notebookRevision: notebook.notebookRevision, pages: notebook.pages };
        }
        const payload = { roomId, sourceRevision: room.revision, members, notebooks };
        const archive = { archiveId: roomId, roomId, status: 'archived', createdAt: clock(), sourceRevision: room.revision, members, notebooks, checksum: checksum(payload) };
        stores.archives.set(roomId, clone(archive));
        await roomService.markArchiveStatus(roomId, 'archived');
        return clone(archive);
    }

    async function readArchive(input, roomId) {
        const identity = assertActiveIdentity(input);
        const archive = stores.archives.get(roomId);
        if (!archive) fail('ARCHIVE_NOT_FOUND');
        const membership = archive.members.find(member => member.uid === identity.uid);
        if (!membership) fail('EXPORT_FORBIDDEN');
        assertRoomActor(identity, membership);
        const notebooks = membership.role === 'presenter'
            ? clone(archive.notebooks)
            : { [identity.uid]: clone(archive.notebooks[identity.uid] || []) };
        return { archiveId: archive.archiveId, roomId: archive.roomId, status: archive.status, checksum: archive.checksum, members: clone(archive.members), notebooks };
    }

    return { archiveRoom, readArchive };
}

module.exports = { createArchiveService };
