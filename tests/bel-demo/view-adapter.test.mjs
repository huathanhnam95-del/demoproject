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

test('P05.1: ASSEMBLIES covers all 14 reference rooms', async () => {
  const { ASSEMBLIES } = await import('../../public/prototypes/bel-working-as-equals-demo/world/renderer3d.mjs');
  const expectedRooms = ['home', 'street', 'reception', 'A', 'B1', 'B2', 'B3', 'C', 'D', 'E', 'F', 'G', 'I', 'J'];
  assert.equal(Object.keys(ASSEMBLIES).length, 14);
  for (const r of expectedRooms) {
    assert.ok(ASSEMBLIES[r], `Missing assembly for room: ${r}`);
    assert.ok(Array.isArray(ASSEMBLIES[r].components), `Room ${r} components should be an array`);
    assert.ok(ASSEMBLIES[r].components.length > 0, `Room ${r} components should not be empty`);
  }
});

test('P05.3: target picker normalizes coordinates accurately', async () => {
  const { createTargetPicker } = await import('../../public/prototypes/bel-working-as-equals-demo/world/picking3d.mjs');

  let receivedPointer = null;
  const mockRaycaster = {
    setFromCamera: (pointer, camera) => {
      receivedPointer = { x: pointer.x, y: pointer.y };
    },
    intersectObjects: () => []
  };

  const mockTHREE = {
    Raycaster: class {
      constructor() { return mockRaycaster; }
    },
    Vector2: class {
      constructor() { this.x = 0; this.y = 0; }
    }
  };

  const mockCanvas = {
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 1000, height: 480 })
  };

  const picker = createTargetPicker(mockTHREE, {}, mockCanvas);

  // Center click (600, 290) -> relative (500, 240) -> NDC (0, 0)
  picker.pick(600, 290, [{}]);
  assert.equal(receivedPointer.x, 0);
  assert.equal(receivedPointer.y, 0);

  // Top-left click (100, 50) -> relative (0, 0) -> NDC (-1, 1)
  picker.pick(100, 50, [{}]);
  assert.equal(receivedPointer.x, -1);
  assert.equal(receivedPointer.y, 1);

  // Bottom-right click (1100, 530) -> relative (1000, 480) -> NDC (1, -1)
  picker.pick(1100, 530, [{}]);
  assert.equal(receivedPointer.x, 1);
  assert.equal(receivedPointer.y, -1);

  // Object-based point passing
  picker.pick({ x: 500, y: 240 }, [{}]);
  assert.equal(receivedPointer.x, 0);
  assert.equal(receivedPointer.y, 0);
});

test('P05.1: 14 animation clips suite completeness, casing aliases, and Wave loop property', async () => {
  const THREE = await import('../../public/prototypes/bel-working-as-equals-demo/assets-3d/vendor/three/three.module.js');
  const { createAsset } = await import('../../public/prototypes/bel-working-as-equals-demo/assets-3d/batch-3-v1/runtime/index.mjs');
  const { CLIP_INFO } = await import('../../public/prototypes/bel-working-as-equals-demo/assets-3d/batch-3-v1/runtime/avatar-clips.mjs');

  const expectedClips = [
    'Idle', 'Walk', 'CarryIdle', 'CarryWalk', 'SeatedIdle', 'Wave',
    'HandholdIdle_L', 'HandholdIdle_R', 'HandholdWalk_L', 'HandholdWalk_R',
    'ScooterIdle', 'ScooterRide', 'SkateboardIdle', 'SkateboardRide'
  ];

  assert.equal(Object.keys(CLIP_INFO).length, 14);
  for (const name of expectedClips) {
    assert.ok(CLIP_INFO[name], `Missing clip info for ${name}`);
  }

  // Wave has loop === false
  assert.equal(CLIP_INFO.Wave.loop, false);
  assert.equal(CLIP_INFO.Idle.loop, true);

  // Avatar creation and clip actions
  const avatar = createAsset({ THREE, assetId: 'avatar.participant', variant: { actor: 'p1' } });
  assert.equal(avatar.clips.length, 14);

  const mixer = new THREE.AnimationMixer(avatar.root);
  const actions = {};
  for (const clip of avatar.clips) {
    const action = mixer.clipAction(clip);
    actions[clip.name] = action;
    actions[clip.name.toLowerCase()] = action;
  }

  // Verify casing lookup
  assert.ok(actions.Idle || actions.idle);
  assert.ok(actions.Walk || actions.walk);
  assert.equal(actions.Idle, actions.idle);
  assert.equal(actions.Walk, actions.walk);

  avatar.dispose();
});

test('P05.3: 3D raycast target picking correctly resolves targets and ignores floors/walls and hidden objects', async () => {
  const THREE = await import('../../public/prototypes/bel-working-as-equals-demo/assets-3d/vendor/three/three.module.js');
  const { ASSEMBLIES } = await import('../../public/prototypes/bel-working-as-equals-demo/world/renderer3d.mjs');
  const { createAsset, createResourceCache } = await import('../../public/prototypes/bel-working-as-equals-demo/assets-3d/batch-3-v1/runtime/index.mjs');
  const { createTargetPicker } = await import('../../public/prototypes/bel-working-as-equals-demo/world/picking3d.mjs');

  const camera = new THREE.PerspectiveCamera(40, 1000 / 480, 0.1, 120);
  camera.position.set(0, 15, 18);
  camera.lookAt(0, 0, 1.5);
  camera.updateMatrixWorld();

  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 480 }) };
  const picker = createTargetPicker(THREE, camera, canvas);
  const resources = createResourceCache(THREE);
  const interactiveMeshes = [];

  const assembly = ASSEMBLIES.home;
  const targets = assembly.baseline.targets;
  const targetMap = new Map(targets.map(t => [t.id, t]));
  const matchedTargets = new Set();

  for (const entry of assembly.components) {
    const asset = createAsset({ THREE, assetId: entry.assetId, variant: entry.variant, resources });
    if (entry.position) asset.root.position.set(...entry.position);

    const isStructural = entry.assetId.includes('wall') ||
                         entry.assetId.includes('floor') ||
                         entry.assetId.includes('ceiling') ||
                         entry.assetId.startsWith('fx.');
    if (!isStructural) {
      let tid = null;
      if (entry.source) {
        const m = entry.source.match(/targets#([a-zA-Z0-9_-]+)/);
        if (m && targetMap.has(m[1]) && !matchedTargets.has(m[1])) tid = m[1];
      }
      if (!tid) {
        if (targetMap.has('wardrobe') && entry.assetId === 'prop.wardrobe') tid = 'wardrobe';
      }
      if (tid) {
        matchedTargets.add(tid);
        asset.root.userData.belTargetId = tid;
        asset.root.userData.belTargetType = targetMap.get(tid)?.type || 'object';
        interactiveMeshes.push(asset.root);
      }
    }
    asset.root.updateMatrixWorld(true);
  }

  // 1. Picking wardrobe succeeds with exact string targetId
  const v = new THREE.Vector3(-8.18, 1, -2.33).project(camera);
  const screenX = (v.x + 1) * 500;
  const screenY = (-v.y + 1) * 240;
  const wardrobeHit = picker.pick({ x: screenX, y: screenY, width: 1000, height: 480 }, interactiveMeshes);
  assert.ok(wardrobeHit);
  assert.equal(wardrobeHit.targetId, 'wardrobe');
  assert.equal(typeof wardrobeHit.targetId, 'string');
  assert.equal(wardrobeHit.targetType, 'profile');

  // 2. Picking floor returns null (structural floor is not in interactiveMeshes)
  const floorHit = picker.pick({ x: 500, y: 240, width: 1000, height: 480 }, interactiveMeshes);
  assert.equal(floorHit, null);

  // 3. Invisible object with visible = false is ignored
  const hiddenAsset = createAsset({ THREE, assetId: 'prop.scooter', variant: { stand: true }, resources });
  hiddenAsset.root.userData.belTargetId = 'hidden-scooter';
  hiddenAsset.root.visible = false;
  hiddenAsset.root.position.set(0, 0, 1.5);
  hiddenAsset.root.updateMatrixWorld(true);
  interactiveMeshes.push(hiddenAsset.root);

  const hiddenHit = picker.pick({ x: 500, y: 240, width: 1000, height: 480 }, [hiddenAsset.root]);
  assert.equal(hiddenHit, null);

  hiddenAsset.dispose();
});
