import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { acceptFrameMessage, createFrameMessage } from '../../public/js/presentation-demo/presentation/frame.mjs';
import { etaForServerTime } from '../../public/js/presentation-demo/presentation/final.mjs';

const require = createRequire(import.meta.url);
const {
  archivePageDocumentId,
  archivePageDocumentIdCandidates,
  decodeArchivePageDocumentId,
  legacyArchivePageDocumentId,
  resolveArchivePageRecords,
  migrateArchivePageRecord
} = require('../../functions/src/crm/presentation-demo/firebase-stores.cjs');

test('generated online deck keeps authored resources and online frame adapter', () => {
  const html = fs.readFileSync('public/presentation-demo/native/deck.html', 'utf8');
  assert.match(html, /\/prototypes\/bel-working-as-equals-demo\/native\/support\.js/);
  assert.match(html, /\/prototypes\/bel-working-as-equals-demo\/native\/images\/cover\.jpg/);
  assert.match(html, /\/prototypes\/bel-working-as-equals-demo\/_ds\//);
  assert.match(html, /\/js\/presentation-demo\/presentation\/frame\.mjs/);
  assert.match(html, /from="\/prototypes\/bel-working-as-equals-demo\/native\/deck-stage\.js"/);
  assert.match(html, /Our First Month Together/);
});

test('host frame messages require same origin, room source and room identity', () => {
  const iframe = {};
  const event = { origin: 'https://demo.test', source: iframe, data: createFrameMessage({ roomId: 'room-1', revision: 4, contentVersion: 'v1', serverNow: 100, type: 'ready' }) };
  assert.equal(acceptFrameMessage(event, { roomId: 'room-1', origin: 'https://demo.test', source: iframe }).type, 'ready');
  assert.equal(acceptFrameMessage({ ...event, source: {} }, { roomId: 'room-1', origin: 'https://demo.test', source: iframe }), null);
  assert.equal(acceptFrameMessage({ ...event, data: { ...event.data, roomId: 'room-2' } }, { roomId: 'room-1', origin: 'https://demo.test', source: iframe }), null);
});

test('ETA uses server time so client clock skew does not change the deadline', () => {
  assert.equal(etaForServerTime({ etaOrigin: 120000, serverNow: 60000, clientNow: 3600000 }), 3660000);
});

test('an export clicked at End waits for the archive without retrying forbidden reads', async () => {
  const previous = globalThis.window;
  globalThis.window = { location: { origin: 'http://127.0.0.1', search: '' }, setTimeout };
  try {
    const { PresentationTransport } = await import('../../public/js/presentation-demo/transport.mjs');
    const transport = new PresentationTransport({ uid: 'reader', local: true });
    const pdf = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    let exports = 0, reads = 0;
    transport.request = async path => {
      if (!path.endsWith('/export.pdf')) { reads++; return { lifecycle: 'ended' }; }
      if (++exports === 1) throw Object.assign(new Error('pending archive'), { code: 'ARCHIVE_NOT_FOUND' });
      return pdf;
    };
    assert.equal(await transport.exportPdf('ending-room'), pdf);
    assert.equal(exports, 2); assert.equal(reads, 1);
    transport.request = async () => { throw Object.assign(new Error('forbidden'), { code: 'EXPORT_FORBIDDEN' }); };
    await assert.rejects(transport.exportPdf('other-room'), { code: 'EXPORT_FORBIDDEN' });
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

test('archive page IDs encode the complete room, uid, and page tuple without delimiter collisions', () => {
  const first = ['room:one', 'uid:page', 'page:two'];
  const second = ['room:one:uid', 'page', 'two'];
  const firstId = archivePageDocumentId(...first);
  const secondId = archivePageDocumentId(...second);

  assert.match(firstId, /^v2_/);
  assert.notEqual(firstId, secondId);
  assert.deepEqual(decodeArchivePageDocumentId(firstId), first);
  assert.deepEqual(archivePageDocumentIdCandidates(...first), [firstId, 'room:one:uid:page:page:two']);
});

test('archive resolver returns exactly one page for legacy-only, v2-only, and identical mixed records', () => {
  const tuple = ['room-1', 'uid-1', 'main'];
  const page = { roomId: tuple[0], uid: tuple[1], id: tuple[2], title: 'Ghi chú', body: 'Nội dung', version: 2, updatedAt: 123, updatedBy: 'uid-1' };
  const v2 = archivePageDocumentId(...tuple);
  const legacy = legacyArchivePageDocumentId(...tuple);
  for (const [records, expectedVersion] of [
    [[{ id: legacy, data: page }], 'legacy'],
    [[{ id: v2, data: page }], 'v2'],
    [[{ id: legacy, data: page }, { id: v2, data: { ...page } }], 'v2']
  ]) {
    const resolved = resolveArchivePageRecords(records, { roomId: tuple[0], uid: tuple[1] });
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].id, tuple[2]);
    assert.equal(resolved[0].storageVersion, expectedVersion);
    assert.deepEqual(resolved[0].page, page);
  }
});

test('archive resolver fails closed on conflicting mixed versions and migration retries idempotently', async () => {
  const tuple = ['room-2', 'uid-2', 'page-1'];
  const legacy = legacyArchivePageDocumentId(...tuple);
  const v2 = archivePageDocumentId(...tuple);
  const first = { roomId: tuple[0], uid: tuple[1], id: tuple[2], title: 'one', body: 'same', version: 1 };
  const second = { ...first, title: 'two' };
  assert.throws(
    () => resolveArchivePageRecords([{ id: legacy, data: first }, { id: v2, data: second }], { roomId: tuple[0], uid: tuple[1] }),
    error => error.code === 'ARCHIVE_PAGE_CONFLICT'
  );

  const writes = [];
  let deleteAttempts = 0;
  await assert.rejects(
    migrateArchivePageRecord([{ id: legacy, data: first }], {
      roomId: tuple[0], uid: tuple[1],
      writeV2: async (id, data) => writes.push([id, data]),
      deleteLegacy: async () => { deleteAttempts += 1; throw new Error('interrupted cleanup'); }
    }),
    /interrupted cleanup/
  );
  assert.deepEqual(writes.map(([id]) => id), [v2]);
  const retry = await migrateArchivePageRecord([{ id: legacy, data: first }, { id: v2, data: first }], {
    roomId: tuple[0], uid: tuple[1],
    writeV2: async (id) => writes.push([id]),
    deleteLegacy: async () => { deleteAttempts += 1; }
  });
  assert.equal(retry.storageVersion, 'v2');
  assert.equal(writes.length, 1, 'interrupted migration retry must not duplicate the v2 write');
  assert.equal(deleteAttempts, 2);
});
