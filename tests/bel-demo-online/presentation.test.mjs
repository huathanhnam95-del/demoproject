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
  assert.match(html, /\/prototypes\/bel-working-as-equals-demo\/presentation\/frame\.mjs/);
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
