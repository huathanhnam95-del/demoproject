// Batch 2 activity props — block-built (BEL-ART-01).
// The existing objects of rooms B1/B2/B3, D, I and J: the three reflection
// shapes and their pedestals, the six cube identities, the two floor choice
// regions with their existing tick/cross markers, the gallery frame, and the
// shared tables and bench.
//
// Identities come from the baseline (activities/cubes.mjs, world/scenes.mjs,
// activities/reversal.mjs, world/sprites.mjs). No word, objective, pair or
// answer is modelled: a cube shows only its colour and mark, a region shows
// only its existing marker, and a gallery frame holds an empty slot that the
// integration fills with the original photograph.
import { CHOICE_REGIONS, CUBE_IDENTITIES, ROUTE_SHAPES } from './identity.mjs';
import { MARK_MASKS } from './bridge-props.mjs';
import { PALETTE, SURFACE, sharedMaterial } from './materials.mjs';
import { block, countTriangles, localBounds, maskBlocks, mergeGeometries, polygonShape, tint, transformed, verticalTint } from './geometry.mjs';

const at = (x, y, z) => ({ position: [x, y, z] });
const num = (value, fallback) => (Number.isFinite(value) ? value : fallback);
const S = 0.02;

export const CUBE_DIMENSIONS = Object.freeze({ size: 0.58, sizeLogical: 29, markCell: 0.05, markGrid: 9 });

// world/sprites.mjs shape(): the three reflection shapes and their colours.
export const SHAPE_COLORS = Object.freeze({ triangle: '#ca6742', square: '#3689ac', circle: '#7c9960', outline: '#513923', empty: '#80512d' });
// world/activity-renderer.mjs prepareChoicesBackground(): region tints and marker colours.
export const REGION_COLORS = Object.freeze({ do: '#9fbd94', dont: '#d9877b', tick: '#487c51', cross: '#9c4539' });

// 9 x 9 marker masks for the existing floor symbols. Row 0 is the far edge.
const REGION_MASKS = Object.freeze({
  tick: ['.........', '.......#.', '......##.', '.#...##..', '.##.##...', '..####...', '...##....', '.........', '.........'],
  cross: ['.........', '.##...##.', '.###.###.', '..#####..', '...###...', '..#####..', '.###.###.', '.##...##.', '.........']
});
const toRows = mask => mask.map(row => row.replace(/\./g, ' '));

// A stepped 3D version of each reflection shape, still unmistakable at the
// gameplay camera: a triangle stays a triangle, a circle stays round.
function shapeGeometry(THREE, shape, size) {
  const h = size * 0.34;
  if (shape === 'square') return block(THREE, size, h, size * 0.92, at(0, h / 2, 0), 0.02);
  if (shape === 'triangle') {
    const points = [[0, size * 0.52], [size * 0.52, -size * 0.36], [-size * 0.52, -size * 0.36]];
    const g = new THREE.ExtrudeGeometry(polygonShape(THREE, points), { depth: h, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1, curveSegments: 1 });
    return transformed(THREE, g, { position: [0, h / 2, 0], rotation: [-Math.PI / 2, 0, 0] });
  }
  // circle: a voxel disc from the same 9 x 9 mask the plank mark uses, so the
  // top-down silhouette stays round instead of collapsing to a square.
  const g = maskBlocks(THREE, toRows(MARK_MASKS.circle), size / 9, h);
  g.translate(0, h / 2, 0);
  return g;
}

const COMPONENTS = {
  // Room J cube: one identity per existing cube, mark on the top and sides.
  'prop.activity-cube': (THREE, scope, variant) => {
    const identity = CUBE_IDENTITIES.find(c => c.id === variant) || CUBE_IDENTITIES.find(c => c.id === variant?.id);
    if (!identity) throw new RangeError(`activity cube variant must be one of ${CUBE_IDENTITIES.map(c => c.id).join(', ')}.`);
    const size = CUBE_DIMENSIONS.size;
    const body = new THREE.Mesh(scope.shared(`geometry:cube:body:${size}`, () => mergeGeometries(THREE, [
      tint(THREE, block(THREE, size, size, size, at(0, size / 2, 0), 0.022), 1),
      tint(THREE, block(THREE, size * 1.02, size * 0.1, size * 1.02, at(0, size * 0.05, 0), 0.012), 0.9)   // base step
    ])), sharedMaterial(THREE, scope, `cube_${identity.color}`, PALETTE.planks[identity.color], { ...SURFACE.paintedWood, vertexColors: true }));
    body.name = 'M_cube_body'; body.castShadow = true; body.receiveShadow = true;
    const markGeo = scope.shared(`geometry:cube:mark:${identity.mark}`, () => {
      const flat = maskBlocks(THREE, toRows(MARK_MASKS[identity.mark]), CUBE_DIMENSIONS.markCell, 0.012);
      const upright = transformed(THREE, flat.clone(), { rotation: [Math.PI / 2, 0, 0] });   // stand it up first
      const faces = [transformed(THREE, flat.clone(), { position: [0, size + 0.004, 0] })];  // top
      for (const [rotY, pos] of [[0, [0, size / 2, size / 2 + 0.004]], [Math.PI, [0, size / 2, -size / 2 - 0.004]],
        [Math.PI / 2, [size / 2 + 0.004, size / 2, 0]], [-Math.PI / 2, [-size / 2 - 0.004, size / 2, 0]]]) {
        faces.push(transformed(THREE, upright.clone(), { position: pos, rotation: [0, rotY, 0] }));           // then yaw it
      }
      flat.dispose(); upright.dispose();
      return mergeGeometries(THREE, faces);
    });
    const mark = new THREE.Mesh(markGeo, sharedMaterial(THREE, scope, 'plankMark', PALETTE.plankMark, SURFACE.paint));
    mark.name = 'M_cube_mark'; mark.castShadow = true;
    const grip = new THREE.Object3D(); grip.name = 'socket_grip'; grip.position.set(0, size / 2, 0);
    return {
      meshes: [body, mark], sockets: { socket_grip: grip },
      info: {
        identity: { ...identity }, size, sizeLogical: CUBE_DIMENSIONS.sizeLogical,
        origin: 'bottom centre; socket_grip at the cube centre attaches to the avatar socket_held',
        note: 'colour and mark only. The cube word, its objective and its pair are never on the model.'
      }
    };
  },
  // B1/B2/B3 reflection shape.
  'prop.route-shape': (THREE, scope, variant) => {
    const shape = ROUTE_SHAPES.includes(variant) ? variant : (ROUTE_SHAPES.includes(variant?.shape) ? variant.shape : null);
    if (!shape) throw new RangeError(`route shape variant must be one of ${ROUTE_SHAPES.join(', ')}.`);
    const size = num(variant?.size, 0.76);
    const mesh = new THREE.Mesh(scope.shared(`geometry:shape:${shape}:${size}`, () => shapeGeometry(THREE, shape, size)),
      sharedMaterial(THREE, scope, `shape_${shape}`, SHAPE_COLORS[shape], SURFACE.paintedWood));
    mesh.name = `M_shape_${shape}`; mesh.castShadow = true; mesh.receiveShadow = true;
    const grip = new THREE.Object3D(); grip.name = 'socket_grip'; grip.position.set(0, size * 0.17, 0);
    return { meshes: [mesh], sockets: { socket_grip: grip }, info: { shape, size, note: 'the existing shape identity and colour; the pedestal match is unchanged' } };
  },
  // B-route pedestal, sized from the existing pedestal solid.
  'prop.pedestal': (THREE, scope, variant) => {
    const width = num(variant.width, 2.14), depth = num(variant.depth, 1.24), height = num(variant.height, 0.78);
    const geo = scope.shared(`geometry:pedestal:${width}x${depth}x${height}`, () => mergeGeometries(THREE, [
      verticalTint(THREE, block(THREE, width * 0.86, height - 0.1, depth * 0.86, at(0, (height - 0.1) / 2, 0)), 0, height, 0.8, 1.02),
      tint(THREE, block(THREE, width, 0.1, depth, at(0, height - 0.05, 0)), 1.06),      // top slab
      tint(THREE, block(THREE, width * 0.95, 0.07, depth * 0.95, at(0, 0.035, 0)), 0.9) // plinth
    ]));
    const mesh = new THREE.Mesh(geo, sharedMaterial(THREE, scope, 'pedestalWood', PALETTE.studio.consoleWood, { ...SURFACE.timber, vertexColors: true }));
    mesh.name = 'M_pedestal'; mesh.castShadow = true; mesh.receiveShadow = true;
    const slot = new THREE.Object3D(); slot.name = 'socket_shape'; slot.position.set(0, height, 0);
    return { meshes: [mesh], sockets: { socket_shape: slot }, info: { width, depth, height, note: 'socket_shape marks the existing pedestal top; the application decides the match' } };
  },
  // Room I floor choice region with its existing marker.
  'prop.choice-region': (THREE, scope, variant) => {
    const region = CHOICE_REGIONS.find(r => r.id === variant) || CHOICE_REGIONS.find(r => r.id === variant?.id);
    if (!region) throw new RangeError(`choice region variant must be one of ${CHOICE_REGIONS.map(r => r.id).join(', ')}.`);
    const width = +((region.logical.x1 - region.logical.x0) * S).toFixed(4);
    const depth = +((region.logical.y1 - region.logical.y0) * S).toFixed(4);
    const surface = new THREE.Mesh(scope.shared(`geometry:region:${region.id}:${width}x${depth}`, () => {
      const rows = Math.max(2, Math.round(depth / 0.55)), parts = [];
      for (let i = 0; i < rows; i++) {
        const d = depth / rows;
        parts.push(tint(THREE, block(THREE, width, 0.02, d - 0.02, at(0, 0.01, -depth / 2 + d * (i + 0.5)), 0.006), i % 2 ? 0.97 : 1.03));
      }
      return mergeGeometries(THREE, parts);
    }), sharedMaterial(THREE, scope, `region_${region.id}`, REGION_COLORS[region.id], { ...SURFACE.fabric, vertexColors: true }));
    surface.name = `M_region_${region.id}`; surface.receiveShadow = true;
    const markName = region.id === 'do' ? 'tick' : 'cross';
    const marker = new THREE.Mesh(scope.shared(`geometry:region:mark:${markName}`, () => {
      const g = maskBlocks(THREE, toRows(REGION_MASKS[markName]), 0.14, 0.03);
      g.translate(0, 0.025, 0);
      return g;
    }), sharedMaterial(THREE, scope, `regionMark_${markName}`, REGION_COLORS[markName], SURFACE.paint));
    marker.name = `M_region_marker_${markName}`; marker.receiveShadow = true;
    return {
      meshes: [surface, marker], sockets: {},
      info: {
        region: region.id, width, depth, logical: { ...region.logical },
        note: 'sized from the authoritative choiceAt() boundary, so the floor never promises a choice the host would reject. The Do and Do-not wording stays in the existing screen-space HUD.'
      }
    };
  },
  // Gallery D frame: the frame only. The original photograph is applied by the
  // integration to the empty slot; no face is ever generated here.
  'prop.gallery-frame': (THREE, scope, variant) => {
    const width = num(variant.width, 1.05), height = num(variant.height, 1.35);
    const frame = new THREE.Mesh(scope.shared(`geometry:gallery:frame:${width}x${height}`, () => mergeGeometries(THREE, [
      block(THREE, width, height, 0.09, at(0, 0, 0)),
      tint(THREE, block(THREE, width - 0.16, height - 0.16, 0.11, at(0, 0, 0.012), 0.01), 0.88)
    ])), sharedMaterial(THREE, scope, 'pictureFrameWood', PALETTE.roomF.pictureFrameWood, { ...SURFACE.timber, vertexColors: true }));
    frame.name = 'M_gallery_frame'; frame.castShadow = true; frame.receiveShadow = true;
    const slot = new THREE.Mesh(scope.shared(`geometry:gallery:slot:${width}x${height}`, () => block(THREE, width - 0.2, height - 0.2, 0.02, at(0, 0, 0.055), 0.004)),
      sharedMaterial(THREE, scope, 'gallerySlot', '#d8d2c8', SURFACE.matte));
    slot.name = 'M_gallery_portrait_slot';
    slot.userData.portraitSlot = 'Map the original portrait image here, unchanged and with its real aspect ratio. Never generate or restyle a face.';
    return {
      meshes: [frame, slot], sockets: {},
      info: { width, height, aspect: +((width - 0.2) / (height - 0.2)).toFixed(3), portraitSlot: 'M_gallery_portrait_slot', note: 'frame only; the pack ships no portrait pixels' }
    };
  },
  // Shared table / bench used by Gallery D and Room J.
  'studio.table': (THREE, scope, variant) => {
    const width = num(variant.width, 3.86), depth = num(variant.depth, 0.98), height = num(variant.height, 0.72);
    const geo = scope.shared(`geometry:table:${width}x${depth}x${height}`, () => {
      const parts = [tint(THREE, block(THREE, width, 0.09, depth, at(0, height - 0.045, 0)), 1.05),
        tint(THREE, block(THREE, width - 0.12, 0.07, depth - 0.12, at(0, height - 0.12, 0)), 0.92)];
      for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        parts.push(block(THREE, 0.1, height - 0.09, 0.1, at(sx * (width / 2 - 0.1), (height - 0.09) / 2, sz * (depth / 2 - 0.1)), 0.01));
      }
      return mergeGeometries(THREE, parts);
    });
    const mesh = new THREE.Mesh(geo, sharedMaterial(THREE, scope, 'consoleWood', PALETTE.studio.consoleWood, { ...SURFACE.timber, vertexColors: true }));
    mesh.name = 'M_table'; mesh.castShadow = true; mesh.receiveShadow = true;
    return { meshes: [mesh], sockets: {}, info: { width, depth, height, note: 'the existing table/bench footprint; nothing is placed on it by the asset' } };
  }
};

export const ACTIVITY_COMPONENT_IDS = Object.freeze(Object.keys(COMPONENTS));

export function createActivityProp(THREE, scope, { assetId, variant, packVersion }) {
  const build = COMPONENTS[assetId];
  if (!build) throw new RangeError(`Unknown activity prop "${assetId}". Known: ${ACTIVITY_COMPONENT_IDS.join(', ')}.`);
  const root = new THREE.Group();
  root.name = assetId.replace(/[.-]/g, '_');
  const { meshes, sockets, info } = build(THREE, scope, variant ?? {});
  root.userData.belAsset = { assetId, variant: info.identity?.id ?? info.shape ?? info.region ?? variant, packVersion };
  root.add(...meshes, ...Object.values(sockets));
  return {
    root, clips: [], sockets,
    bounds: localBounds(THREE, root),
    applyAppearance: () => ({}),
    metadata: {
      kind: 'activity prop (block-built)',
      artDirection: 'BEL-ART-01 v1.0 — existing activity objects with real depth; identities preserved, answers never modelled',
      component: assetId, ...info,
      triangles: countTriangles(root), meshes: meshes.length,
      placement: 'Gemini places this from the existing scene data; the component holds no position, ownership or state.'
    }
  };
}
