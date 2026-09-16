// Unit tests for 3D Coordinate Transforms & Invariant Reversibility (Phase 05 / P05.2)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SCALE,
  ORIGIN_X,
  ORIGIN_Y,
  logicalToWorld,
  worldToLogical,
  logicalBoxToWorld,
  logicalDistanceToWorld,
  worldDistanceToLogical
} from '../../public/prototypes/bel-working-as-equals-demo/world/coordinates3d.mjs';

test('P05.2: logicalToWorld and worldToLogical are perfectly reversible', () => {
  const testPoints = [
    { x: 0, y: 0 },
    { x: 500, y: 240 },      // Center origin -> (0, 0)
    { x: 1000, y: 480 },    // Bottom-right
    { x: 135, y: 195 },     // Room I choice boundary Do
    { x: 866, y: 361 },     // Room I choice boundary Don't
    { x: 260, y: 355 },     // A studio spawn
    { x: 500, y: 233 }      // F bridge placement target
  ];

  for (const pt of testPoints) {
    const w = logicalToWorld(pt.x, pt.y);
    const roundtrip = worldToLogical(w.x, w.z);
    assert.equal(roundtrip.x, pt.x, `X coord mismatch for ${JSON.stringify(pt)}`);
    assert.equal(roundtrip.y, pt.y, `Y coord mismatch for ${JSON.stringify(pt)}`);
  }
});

test('P05.2: Center coordinate (500, 240) maps exactly to 3D (0, 0, 0)', () => {
  const center = logicalToWorld(500, 240, 0);
  assert.equal(center.x, 0);
  assert.equal(center.y, 0);
  assert.equal(center.z, 0);
});

test('P05.2: Scale s = 0.02 accurately preserves distance metrics', () => {
  assert.equal(logicalDistanceToWorld(50), 1.0);     // 50 logical px = 1 world unit
  assert.equal(logicalDistanceToWorld(100), 2.0);
  assert.equal(worldDistanceToLogical(1.0), 50);

  // Proximity threshold 48 px
  const proxWorld = logicalDistanceToWorld(48);
  assert.equal(proxWorld, 0.96);
  assert.equal(worldDistanceToLogical(proxWorld), 48);
});

test('P05.2: logicalBoxToWorld transforms dimensions and centers accurately', () => {
  const box = { x: 400, y: 200, w: 200, h: 80 };
  const worldBox = logicalBoxToWorld(box, 0, 0.5);

  assert.equal(worldBox.size.x, 200 * 0.02); // 4.0
  assert.equal(worldBox.size.z, 80 * 0.02);  // 1.6
  assert.equal(worldBox.size.y, 0.5);

  // Center must be (500, 240) -> (0, 0)
  assert.equal(worldBox.center.x, 0);
  assert.equal(worldBox.center.z, 0);
});
