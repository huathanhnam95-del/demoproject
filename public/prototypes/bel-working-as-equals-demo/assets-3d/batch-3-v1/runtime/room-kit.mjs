// Room architecture kit — block-built (BEL-ART-01 sections 5 and 7).
// Modular components, each independently addressable: floor platforms, the
// Room F channel, its railing, walls with real thickness, doorways and doors,
// the existing potted plants and the existing framed picture.
//
// Every component is sized by the caller from the baseline logical rectangles
// (Gemini owns placement and approved dimensions). Nothing here adds an
// obstacle, a route, a sign or a label. Static pieces carry a gentle baked
// vertical tint so corners and recesses read under the room light; movable
// objects never carry baked shading.
import { PALETTE, SURFACE, sharedMaterial } from './materials.mjs';
import { block, countTriangles, localBounds, mergeGeometries, tint, verticalTint } from './geometry.mjs';

export const ROOM_DEFAULTS = Object.freeze({
  platformThickness: 0.3,   // visible floor depth; the logical floor stays flat at y = 0
  wallHeight: 2.6,
  wallThickness: 0.24,
  skirting: 0.14,
  railHeight: 0.52,
  railPostPitch: 2.2,
  troughDrop: 0.95,
  plankBoard: 0.55         // floor board width along Z, matching the painted planks
});

const at = (x, y, z) => ({ position: [x, y, z] });
const num = (value, fallback) => (Number.isFinite(value) ? value : fallback);

// ---- floor platform: boards along X with seams, a rim, and a side face ----
function platformGeometry(THREE, width, depth, thickness, boardWidth) {
  const rows = Math.max(1, Math.round(depth / boardWidth)), w = depth / rows, seam = 0.02, parts = [];
  for (let i = 0; i < rows; i++) {
    const z0 = -depth / 2 + i * w + (i > 0 ? seam / 2 : 0);
    const z1 = -depth / 2 + (i + 1) * w - (i < rows - 1 ? seam / 2 : 0);
    // A repeating 3-step tonal cycle reads as separate boards without textures.
    parts.push(tint(THREE, block(THREE, width, 0.06, z1 - z0, at(0, -0.03, (z0 + z1) / 2), 0.008), [1.0, 0.972, 1.018][i % 3]));
  }
  // Contact darkening on the outer border of the top boards, so walls, the
  // channel rim and furniture edges sit on the floor instead of hovering.
  for (const part of parts) {
    const position = part.getAttribute('position'), color = part.getAttribute('color');
    for (let i = 0; i < position.count; i++) {
      const ex = Math.max(0, 1 - (width / 2 - Math.abs(position.getX(i))) / 0.45);
      const ez = Math.max(0, 1 - (depth / 2 - Math.abs(position.getZ(i))) / 0.45);
      const shade = 1 - 0.16 * Math.max(ex, ez);
      const base = color.getX(i);
      color.setXYZ(i, base * shade, base * shade, base * shade);
    }
  }
  // Body below the boards, darker, so the platform has visible thickness.
  parts.push(tint(THREE, block(THREE, width, thickness - 0.06, depth, at(0, -0.06 - (thickness - 0.06) / 2, 0), 0.01), 0.78));
  return mergeGeometries(THREE, parts);
}

// ---- the Room F channel: dark inner walls and floor, with a timber rim ----
function troughGeometry(THREE, width, depth, drop) {
  const t = 0.18, parts = [];
  parts.push(verticalTint(THREE, block(THREE, width, 0.12, depth, at(0, -drop, 0)), -drop, -drop + 0.12, 0.85, 1.0));
  // Inner walls in three stacked bands, so the channel reads as built blocks
  // rather than a flat black void, and still darkens with depth.
  const bands = 3;
  for (const [w, d, x, z] of [[width, t, 0, -depth / 2 + t / 2], [width, t, 0, depth / 2 - t / 2], [t, depth, -width / 2 + t / 2, 0], [t, depth, width / 2 - t / 2, 0]]) {
    for (let b = 0; b < bands; b++) {
      const h = drop / bands, y = -drop + h * (b + 0.5);
      parts.push(verticalTint(THREE, block(THREE, w, h - 0.015, d, at(x, y, z), 0.008), y - h / 2, y + h / 2, 0.9 + b * 0.09, 1.02 + b * 0.11));
    }
  }
  return mergeGeometries(THREE, parts);
}

const COMPONENTS = {
  // floor platform (near / far / entry share one factory)
  'room.floor-platform': (THREE, scope, variant) => {
    const width = num(variant.width, 17.6), depth = num(variant.depth, 3.1), thickness = num(variant.thickness, ROOM_DEFAULTS.platformThickness);
    const geo = scope.shared(`geometry:room:platform:${width}x${depth}x${thickness}`, () => platformGeometry(THREE, width, depth, thickness, ROOM_DEFAULTS.plankBoard));
    const mesh = new THREE.Mesh(geo, sharedMaterial(THREE, scope, 'floorTimber', PALETTE.roomF.floorNear, { ...SURFACE.timber, vertexColors: true }));
    mesh.name = 'M_platform'; mesh.receiveShadow = true; mesh.castShadow = true;
    return { meshes: [mesh], info: { width, depth, thickness, topY: 0, boards: Math.round(depth / ROOM_DEFAULTS.plankBoard) } };
  },
  // the gap channel
  'room.gap-trough': (THREE, scope, variant) => {
    const width = num(variant.width, 17.6), depth = num(variant.depth, 1.6), drop = num(variant.drop, ROOM_DEFAULTS.troughDrop);
    const geo = scope.shared(`geometry:room:trough:${width}x${depth}x${drop}`, () => troughGeometry(THREE, width, depth, drop));
    const mesh = new THREE.Mesh(geo, sharedMaterial(THREE, scope, 'gapDark', PALETTE.roomF.gapDark, { ...SURFACE.matte, vertexColors: true }));
    mesh.name = 'M_trough'; mesh.receiveShadow = true;
    const rimGeo = scope.shared(`geometry:room:troughRim:${width}x${depth}`, () => mergeGeometries(THREE, [
      block(THREE, width, 0.07, 0.16, at(0, -0.02, -depth / 2 + 0.08)),
      block(THREE, width, 0.07, 0.16, at(0, -0.02, depth / 2 - 0.08))
    ]));
    const rim = new THREE.Mesh(rimGeo, sharedMaterial(THREE, scope, 'channelRim', PALETTE.roomF.channelRim, SURFACE.timber));
    rim.name = 'M_trough_rim'; rim.castShadow = true; rim.receiveShadow = true;
    return { meshes: [mesh, rim], info: { width, depth, drop, note: 'visual depth only; the logical floor and the crossing are unchanged' } };
  },
  // railing: posts with two beams; `gap` leaves the crossing clear
  'room.rail': (THREE, scope, variant) => {
    const length = num(variant.length, 6), height = num(variant.height, ROOM_DEFAULTS.railHeight);
    const pitch = num(variant.postPitch, ROOM_DEFAULTS.railPostPitch);
    const key = `geometry:room:rail:${length}x${height}x${pitch}`;
    const geo = scope.shared(key, () => {
      const parts = [], posts = Math.max(2, Math.round(length / pitch) + 1);
      for (let i = 0; i < posts; i++) {
        const x = -length / 2 + (length * i) / (posts - 1);
        parts.push(block(THREE, 0.14, height, 0.14, at(x, height / 2, 0)));
        parts.push(tint(THREE, block(THREE, 0.18, 0.05, 0.18, at(x, height + 0.02, 0)), 0.88)); // post cap
      }
      for (const y of [height - 0.06, height * 0.55]) parts.push(tint(THREE, block(THREE, length, 0.09, 0.08, at(0, y, 0)), 1.06));
      return mergeGeometries(THREE, parts);
    });
    const mesh = new THREE.Mesh(geo, sharedMaterial(THREE, scope, 'railWood', PALETTE.roomF.railPost, { ...SURFACE.timber, vertexColors: true }));
    mesh.name = 'M_rail'; mesh.castShadow = true; mesh.receiveShadow = true;
    return { meshes: [mesh], info: { length, height, postPitch: pitch, note: 'decorative guard at the existing channel edge; it adds no logical obstacle' } };
  },
  // wall segment with skirting, optionally with a doorway opening
  'room.wall': (THREE, scope, variant) => {
    const length = num(variant.length, 8), height = num(variant.height, ROOM_DEFAULTS.wallHeight);
    const thickness = num(variant.thickness, ROOM_DEFAULTS.wallThickness);
    const opening = variant.opening ? { width: num(variant.opening.width, 1.2), height: num(variant.opening.height, 2.05), x: num(variant.opening.x, 0) } : null;
    const key = `geometry:room:wall:${length}x${height}x${thickness}:${opening ? `${opening.width}x${opening.height}@${opening.x}` : 'solid'}`;
    const geo = scope.shared(key, () => {
      const parts = [];
      const panel = (w, h, x, y) => parts.push(verticalTint(THREE, block(THREE, w, h, thickness, at(x, y, 0)), 0, height, 0.82, 1.04));
      if (!opening) panel(length, height, 0, height / 2);
      else {
        const left = opening.x - opening.width / 2 + length / 2, right = length / 2 - (opening.x + opening.width / 2);
        if (left > 0.01) panel(left, height, -length / 2 + left / 2, height / 2);
        if (right > 0.01) panel(right, height, length / 2 - right / 2, height / 2);
        panel(opening.width, height - opening.height, opening.x, opening.height + (height - opening.height) / 2);
      }
      return mergeGeometries(THREE, parts);
    });
    const palette = variant.color === 'navy' ? { name: 'wallTrimNavy', hex: PALETTE.roomF.trimNavy } : { name: 'wallCream', hex: PALETTE.roomF.wallCream };
    const mesh = new THREE.Mesh(geo, sharedMaterial(THREE, scope, palette.name, palette.hex, { ...SURFACE.plaster, vertexColors: true }));
    mesh.name = 'M_wall'; mesh.receiveShadow = true; mesh.castShadow = true;
    const meshes = [mesh];
    if (variant.color !== 'navy' && variant.coping !== false) {
      const copingGeo = scope.shared(`geometry:room:coping:${length}x${thickness}`, () => block(THREE, length, 0.13, thickness + 0.08, at(0, height + 0.065, 0)));
      const coping = new THREE.Mesh(copingGeo, sharedMaterial(THREE, scope, 'wallTrimNavy', PALETTE.roomF.trimNavy, SURFACE.plaster));
      coping.name = 'M_wall_coping'; coping.castShadow = true; coping.receiveShadow = true;
      meshes.push(coping);
    }
    if (variant.skirting !== false) {
      const skirtKey = `geometry:room:skirting:${length}:${opening ? opening.width + '@' + opening.x : 'solid'}`;
      const skirtGeo = scope.shared(skirtKey, () => {
        const h = ROOM_DEFAULTS.skirting, parts = [];
        const run = (w, x) => parts.push(block(THREE, w, h, thickness + 0.04, at(x, h / 2, 0)));
        if (!opening) run(length, 0);
        else {
          const left = opening.x - opening.width / 2 + length / 2, right = length / 2 - (opening.x + opening.width / 2);
          if (left > 0.01) run(left, -length / 2 + left / 2);
          if (right > 0.01) run(right, length / 2 - right / 2);
        }
        return mergeGeometries(THREE, parts);
      });
      const skirt = new THREE.Mesh(skirtGeo, sharedMaterial(THREE, scope, 'skirting', PALETTE.roomF.skirting, SURFACE.paintedWood));
      skirt.name = 'M_skirting'; skirt.receiveShadow = true; skirt.castShadow = true;
      meshes.push(skirt);
    }
    return { meshes, info: { length, height, thickness, opening, color: variant.color || 'cream', skirting: variant.skirting !== false } };
  },
  // door leaf in its frame; `swing` is cosmetic and owned by the integration
  'room.door': (THREE, scope, variant) => {
    const width = num(variant.width, 1.2), height = num(variant.height, 2.05), leaves = variant.leaves === 2 ? 2 : 1;
    const key = `geometry:room:door:${width}x${height}x${leaves}`;
    const geo = scope.shared(key, () => {
      const parts = [], leafW = leaves === 2 ? width / 2 - 0.02 : width - 0.06;
      for (let i = 0; i < leaves; i++) {
        const cx = leaves === 2 ? (i === 0 ? -width / 4 : width / 4) : 0;
        parts.push(block(THREE, leafW, height - 0.04, 0.09, at(cx, (height - 0.04) / 2, 0)));
        // two recessed panels, as painted on the source door
        for (const py of [height * 0.31, height * 0.67]) {
          parts.push(tint(THREE, block(THREE, leafW - 0.22, height * 0.26, 0.11, at(cx, py, 0), 0.01), 0.9));
        }
      }
      return mergeGeometries(THREE, parts);
    });
    const door = new THREE.Mesh(geo, sharedMaterial(THREE, scope, 'doorWood', PALETTE.roomF.doorWood, { ...SURFACE.timber, vertexColors: true }));
    door.name = 'M_door'; door.castShadow = true; door.receiveShadow = true;
    const frameGeo = scope.shared(`geometry:room:doorFrame:${width}x${height}`, () => mergeGeometries(THREE, [
      block(THREE, 0.1, height + 0.1, 0.18, at(-width / 2 - 0.05, (height + 0.1) / 2, 0)),
      block(THREE, 0.1, height + 0.1, 0.18, at(width / 2 + 0.05, (height + 0.1) / 2, 0)),
      block(THREE, width + 0.2, 0.1, 0.18, at(0, height + 0.05, 0))
    ]));
    const frame = new THREE.Mesh(frameGeo, sharedMaterial(THREE, scope, 'doorFrame', PALETTE.roomF.doorFrame, SURFACE.paintedWood));
    frame.name = 'M_door_frame'; frame.castShadow = true; frame.receiveShadow = true;
    const handleGeo = scope.shared('geometry:room:doorHandle', () => block(THREE, 0.12, 0.05, 0.05, at(0, 0, 0.07), 0.012));
    const handle = new THREE.Mesh(handleGeo, sharedMaterial(THREE, scope, 'doorHandle', PALETTE.plankNail, SURFACE.brass));
    handle.name = 'M_door_handle';
    handle.position.set(leaves === 2 ? -0.08 : width / 2 - 0.2, height * 0.46, 0.02);
    handle.castShadow = true;
    return { meshes: [door, frame, handle], info: { width, height, leaves, note: 'visual only: the door never opens itself and never changes a lock' } };
  },
  // the existing potted plant, as stepped leaf clusters
  'prop.plant': (THREE, scope, variant) => {
    const scale = num(variant.scale, 1);
    const geo = scope.shared(`geometry:prop:plantPot:${scale}`, () => mergeGeometries(THREE, [
      verticalTint(THREE, block(THREE, 0.44 * scale, 0.36 * scale, 0.44 * scale, at(0, 0.18 * scale, 0)), 0, 0.36 * scale, 0.78, 1.02),
      tint(THREE, block(THREE, 0.5 * scale, 0.07 * scale, 0.5 * scale, at(0, 0.38 * scale, 0)), 1.05)   // rim
    ]));
    const pot = new THREE.Mesh(geo, sharedMaterial(THREE, scope, 'plantPot', PALETTE.roomF.plantPot, { ...SURFACE.plaster, vertexColors: true }));
    pot.name = 'M_plant_pot'; pot.castShadow = true; pot.receiveShadow = true;
    const soil = new THREE.Mesh(scope.shared(`geometry:prop:plantSoil:${scale}`, () => block(THREE, 0.38 * scale, 0.05 * scale, 0.38 * scale, at(0, 0.4 * scale, 0))),
      sharedMaterial(THREE, scope, 'plantSoil', PALETTE.roomF.plantSoil, SURFACE.matte));
    soil.name = 'M_plant_soil';
    const leavesGeo = scope.shared(`geometry:prop:plantLeaves:${scale}`, () => {
      const parts = [], s = scale;
      parts.push(block(THREE, 0.1 * s, 0.34 * s, 0.1 * s, at(0, 0.58 * s, 0)));               // stem cluster
      // Six stepped leaf blades around the stem, alternating height and reach.
      const blades = [[0.34, 0.62, 0, 1], [-0.34, 0.6, 0.06, 1], [0.1, 0.78, 0.3, 0], [-0.12, 0.8, -0.28, 0], [0.26, 0.9, -0.2, 0], [-0.24, 0.88, 0.22, 0]];
      for (const [dx, y, dz, wide] of blades) {
        const w = (wide ? 0.42 : 0.3) * s, d = (wide ? 0.16 : 0.34) * s;
        parts.push(block(THREE, w, 0.07 * s, d, at(dx * s, y * s, dz * s)));
        parts.push(tint(THREE, block(THREE, w * 0.55, 0.06 * s, d * 0.55, at(dx * 1.32 * s, (y + 0.07) * s, dz * 1.32 * s)), 1.12)); // stepped tip
      }
      parts.push(tint(THREE, block(THREE, 0.26 * s, 0.09 * s, 0.26 * s, at(0, 0.98 * s, 0)), 1.1));
      return mergeGeometries(THREE, parts);
    });
    const leaves = new THREE.Mesh(leavesGeo, sharedMaterial(THREE, scope, 'plantLeaf', PALETTE.roomF.plantLeaf, { ...SURFACE.leaf, vertexColors: true }));
    leaves.name = 'M_plant_leaves'; leaves.castShadow = true;
    return { meshes: [pot, soil, leaves], info: { scale, height: 1.07 * scale, footprint: [0.5 * scale, 0.5 * scale], note: 'the existing BEL pot plant; no new species, planter or colour' } };
  },
  // the existing framed picture on the side walls
  'prop.picture': (THREE, scope, variant) => {
    const width = num(variant.width, 0.44), height = num(variant.height, 0.58);
    const frameGeo = scope.shared(`geometry:prop:pictureFrame:${width}x${height}`, () => mergeGeometries(THREE, [
      block(THREE, width, height, 0.06, at(0, 0, 0)),
      tint(THREE, block(THREE, width - 0.12, height - 0.12, 0.08, at(0, 0, 0.01), 0.008), 0.9)
    ]));
    const frame = new THREE.Mesh(frameGeo, sharedMaterial(THREE, scope, 'pictureFrameWood', PALETTE.roomF.pictureFrameWood, { ...SURFACE.timber, vertexColors: true }));
    frame.name = 'M_picture_frame'; frame.castShadow = true;
    const skyGeo = scope.shared(`geometry:prop:pictureSky:${width}x${height}`, () => block(THREE, width - 0.16, (height - 0.16) * 0.55, 0.02, at(0, (height - 0.16) * 0.22, 0.05), 0.004));
    const fieldGeo = scope.shared(`geometry:prop:pictureField:${width}x${height}`, () => block(THREE, width - 0.16, (height - 0.16) * 0.45, 0.02, at(0, -(height - 0.16) * 0.27, 0.05), 0.004));
    const sky = new THREE.Mesh(skyGeo, sharedMaterial(THREE, scope, 'pictureSky', PALETTE.roomF.pictureSky, SURFACE.matte));
    const field = new THREE.Mesh(fieldGeo, sharedMaterial(THREE, scope, 'pictureField', PALETTE.roomF.pictureField, SURFACE.matte));
    sky.name = 'M_picture_sky'; field.name = 'M_picture_field';
    return { meshes: [frame, sky, field], info: { width, height, note: 'the existing decorative landscape picture; it carries no text and no source content' } };
  }
};

export const ROOM_COMPONENT_IDS = Object.freeze(Object.keys(COMPONENTS));

export function createRoomComponent(THREE, scope, { assetId, variant = {}, packVersion }) {
  const build = COMPONENTS[assetId];
  if (!build) throw new RangeError(`Unknown room component "${assetId}". Known: ${ROOM_COMPONENT_IDS.join(', ')}.`);
  const root = new THREE.Group();
  root.name = assetId.replace(/[.-]/g, '_');
  root.userData.belAsset = { assetId, variant, packVersion };
  const { meshes, info } = build(THREE, scope, variant);
  root.add(...meshes);
  return {
    root, clips: [], sockets: {}, bounds: localBounds(THREE, root),
    applyAppearance: () => ({}),
    metadata: {
      kind: 'room-kit component (block-built)',
      artDirection: 'BEL-ART-01 v1.0 — cuboid construction with visible thickness, seams and a gentle baked vertical tint on static pieces',
      component: assetId, variant, ...info,
      triangles: countTriangles(root), meshes: meshes.length,
      placement: 'Gemini places and sizes this from the baseline logical rectangles; the component holds no scene position and no collision.'
    }
  };
}
