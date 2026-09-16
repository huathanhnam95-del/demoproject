// Unit tests for View Adapter & 3D/2D Lifecycle Abstraction (Phase 05 / P05.1)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createView } from '../../public/prototypes/bel-working-as-equals-demo/world/view-adapter.mjs';
import { logicalToWorld, worldToLogical, SCALE } from '../../public/prototypes/bel-working-as-equals-demo/world/coordinates3d.mjs';

// Mock Image class for Node.js test environment
if (typeof globalThis.Image === 'undefined') {
  globalThis.Image = class {
    constructor() {
      setTimeout(() => { if (typeof this.onload === 'function') this.onload(); }, 1);
    }
    decode() {
      return Promise.resolve();
    }
  };
}

function createMock2DContext() {
  const ctx = {
    measureText: () => ({ width: 50 }),
    getImageData: () => ({ data: new Uint8ClampedArray(400) }),
    createPattern: () => ({})
  };
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => {};
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    }
  });
}

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => createMock2DContext()
    })
  };
}

test('P05.1: createView defaults to 2D renderer when 3D is not requested', async () => {
  // Mock canvas
  const mockCanvas = {
    getContext: (type) => {
      if (type === '2d') {
        return createMock2DContext();
      }
      return null;
    },
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  const view = await createView({ canvas: mockCanvas, mode: '2d' });
  assert.equal(view.mode, '2d');
  assert.equal(typeof view.draw, 'function');
  assert.equal(typeof view.dispose, 'function');
});

test('P05.1: 3D coordinates contract matches SCALE = 0.02', () => {
  assert.equal(SCALE, 0.02);
  const testP = { x: 300, y: 150 };
  const worldP = logicalToWorld(testP.x, testP.y);
  assert.equal(worldP.x, (300 - 500) * 0.02); // -4.0
  assert.equal(worldP.z, (150 - 240) * 0.02); // -1.8
  assert.equal(worldP.y, 0);

  const back = worldToLogical(worldP.x, worldP.z);
  assert.equal(back.x, 300);
  assert.equal(back.y, 150);
});
