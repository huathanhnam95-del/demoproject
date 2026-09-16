// Room F bridge plank — block-built (BEL-ART-01). One shared factory, six
// exact semantic identities (activities/bridge.mjs PLANKS colour + mark).
// The plank is three chamfered boards with visible seams, brass nail blocks
// and a pixel-mask mark. Each call returns one independent runtime object;
// nothing is welded into a crossing and no clip assembles the bridge. The
// plank's wording is never modelled.
import { PLANK_IDENTITIES } from './identity.mjs';
import { PALETTE, SURFACE, sharedMaterial } from './materials.mjs';
import { block, countTriangles, localBounds, maskBlocks, mergeGeometries, tint } from './geometry.mjs';

// length = F crossing width 82 logical px (scenes.mjs 'crossing' box) x 0.02
// depth  = placement pitch 16 logical px (bridge.mjs plankPosition) x 0.02,
//          so six placed planks tile the crossing with no visible hole
// thickness = authoring choice (4.5 logical px)
export const PLANK_DIMENSIONS = Object.freeze({ length: 1.64, depth: 0.32, thickness: 0.09, lengthLogical: 82, depthLogical: 16, boards: 3, markCell: 0.024, markGrid: 9 });
const MARK_CENTER_X = -0.566; // left fifth of the top face, as painted in F-complete.png
const BOARD_TINTS = [1, 0.965, 1.025]; // deterministic tonal cells, not new colours

// 9 x 9 pixel masks. Row 0 is the far edge (screen up in the elevated view),
// so the triangle points up exactly as it does in the source artwork, and the
// circle stays a recognisable disc rather than a square.
const MARK_MASKS = Object.freeze({
  diamond: ['....#....', '...###...', '..#####..', '.#######.', '#########', '.#######.', '..#####..', '...###...', '....#....'],
  'two bars': Array(9).fill('.###.###.'),
  star: ['....#....', '...###...', '...###...', '#########', '.#######.', '..#####..', '..##.##..', '.##...##.', '.#.....#.'],
  circle: ['...###...', '.#######.', '#########', '#########', '#########', '#########', '#########', '.#######.', '...###...'],
  cross: ['...###...', '...###...', '...###...', '#########', '#########', '#########', '...###...', '...###...', '...###...'],
  triangle: ['....#....', '...###...', '...###...', '..#####..', '..#####..', '.#######.', '.#######.', '#########', '#########']
});
const toRows = mask => mask.map(row => row.replace(/\./g, ' '));

function bodyGeometry(THREE) {
  const { length, depth, thickness, boards } = PLANK_DIMENSIONS, w = depth / boards, seam = 0.006;
  const parts = [];
  for (let i = 0; i < boards; i++) {
    // Seams are cut from the inner edges only, so the outer edges stay at
    // +-depth/2 and six placed planks still tile the pitch without a hole.
    const z0 = -depth / 2 + i * w + (i > 0 ? seam / 2 : 0);
    const z1 = -depth / 2 + (i + 1) * w - (i < boards - 1 ? seam / 2 : 0);
    parts.push(tint(THREE, block(THREE, length, thickness, z1 - z0, { position: [0, thickness / 2, (z0 + z1) / 2] }, 0.01), BOARD_TINTS[i]));
  }
  return mergeGeometries(THREE, parts);
}

function nailGeometry(THREE) {
  const { length, depth, thickness } = PLANK_DIMENSIONS, parts = [];
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    parts.push(block(THREE, 0.028, 0.01, 0.028, { position: [x * (length / 2 - 0.055), thickness - 0.002, z * (depth / 2 - 0.045)] }, 0.004));
  }
  return mergeGeometries(THREE, parts);
}

function markGeometry(THREE, mark) {
  const mask = MARK_MASKS[mark];
  if (!mask) throw new RangeError(`Unknown plank mark ${mark}`);
  const g = maskBlocks(THREE, toRows(mask), PLANK_DIMENSIONS.markCell, 0.008);
  g.translate(MARK_CENTER_X, PLANK_DIMENSIONS.thickness - 0.002, 0);
  return g;
}

export function createPlank(THREE, scope, { variant, assetId, packVersion }) {
  const identity = PLANK_IDENTITIES.find(p => p.id === variant);
  if (!identity) throw new RangeError(`bridge plank variant must be one of ${PLANK_IDENTITIES.map(p => p.id).join(', ')}.`);
  const geo = (key, build) => scope.shared(`geometry:plank:${key}`, build);
  const root = new THREE.Group();
  root.name = identity.id;
  root.userData.belAsset = { assetId, variant: identity.id, color: identity.color, mark: identity.mark, packVersion };

  const body = new THREE.Mesh(geo('body', () => bodyGeometry(THREE)),
    sharedMaterial(THREE, scope, `plank_${identity.color}`, PALETTE.planks[identity.color], { ...SURFACE.paintedWood, vertexColors: true }));
  body.name = 'M_plank_body'; body.castShadow = true; body.receiveShadow = true;
  const nails = new THREE.Mesh(geo('nails', () => nailGeometry(THREE)), sharedMaterial(THREE, scope, 'plankNail', PALETTE.plankNail, SURFACE.brass));
  nails.name = 'M_plank_nails';
  const mark = new THREE.Mesh(geo(`mark:${identity.mark}`, () => markGeometry(THREE, identity.mark)), sharedMaterial(THREE, scope, 'plankMark', PALETTE.plankMark, SURFACE.paint));
  mark.name = 'M_plank_mark'; mark.receiveShadow = true;
  root.add(body, nails, mark);

  const sockets = {};
  for (const [name, y, purpose] of [['socket_grip', PLANK_DIMENSIONS.thickness / 2, 'carry pivot: plank centre; attach to the avatar socket_held'],
    ['socket_top', PLANK_DIMENSIONS.thickness, 'top-surface centre; place at floor height (root y = -thickness) for a flush placed plank']]) {
    const s = new THREE.Object3D(); s.name = name; s.position.set(0, y, 0); s.userData.purpose = purpose; root.add(s); sockets[name] = s;
  }

  return {
    root, clips: [], sockets, bounds: localBounds(THREE, root),
    applyAppearance: () => ({}), // planks have no appearance options
    metadata: {
      kind: 'rigid-prop (block-built)',
      artDirection: 'BEL-ART-01 v1.0 — three chamfered boards with seams, brass nail blocks, 9x9 pixel-mask mark',
      identity: { ...identity }, dimensions: { ...PLANK_DIMENSIONS },
      markMask: { grid: `${PLANK_DIMENSIONS.markGrid}x${PLANK_DIMENSIONS.markGrid}`, cell: PLANK_DIMENSIONS.markCell, filledCells: toRows(MARK_MASKS[identity.mark]).join('').replace(/ /g, '').length },
      boardTints: BOARD_TINTS,
      origin: 'bottom-centre of the plank; long axis = X, across = Z, up = Y; the mark sits on the -X end of the top face',
      triangles: countTriangles(root), meshes: 3,
      logicalPlacement: 'Gemini places the root from bridge.mjs state (spawn x/y, plankPosition(index), owner). This asset holds no position or order.'
    }
  };
}
