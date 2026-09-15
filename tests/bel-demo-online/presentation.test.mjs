import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { acceptFrameMessage, createFrameMessage } from '../../public/js/presentation-demo/presentation/frame.mjs';
import { etaForServerTime } from '../../public/js/presentation-demo/presentation/final.mjs';

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
