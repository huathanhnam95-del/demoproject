// Preview-only material board (BEL-ART-01 section 8.2). One stepped block per
// existing BEL material family, in its source colour and its proposed surface
// response, so the roughness/metalness separation can be judged under neutral
// light and under the room light. Not a gameplay object and not scene art.
import { PALETTE, SURFACE, sharedMaterial } from './materials.mjs';
import { block, countTriangles, localBounds, mergeGeometries } from './geometry.mjs';

// family, source colour, surface, what it stands for in the existing rooms
export const MATERIAL_FAMILIES = Object.freeze([
  Object.freeze(['wall', PALETTE.environment.wallCream, 'matteWall', 'plaster / painted wall (F.png, C.png)']),
  Object.freeze(['timber', PALETTE.environment.floorWood, 'paintedWood', 'timber floor and platform boards (F.png)']),
  Object.freeze(['paintedProp', PALETTE.planks.teal, 'paintedWood', 'painted activity props, e.g. plank-0 (F-complete.png)']),
  Object.freeze(['fabric', PALETTE.studio.chairFabric, 'fabric', 'studio chair upholstery (C.png)']),
  Object.freeze(['carpet', PALETTE.studio.carpet, 'fabric', 'studio carpet (C.png)']),
  Object.freeze(['darkWood', PALETTE.studio.consoleWood, 'paintedWood', 'console / door timber (C.png)']),
  Object.freeze(['metal', PALETTE.plankNail, 'brass', 'small metal details, e.g. plank nails (F-complete.png)']),
  Object.freeze(['screen', PALETTE.studio.monitorScreen, 'matteWall', 'monitor surface (C.png) — a neutral prop surface, never slide content'])
]);

const SURFACE_FOR = { matteWall: { roughness: 0.88, metalness: 0 }, paintedWood: SURFACE.paintedWood, fabric: { roughness: 0.95, metalness: 0 }, brass: SURFACE.brass };

// One sample: a base cube with a smaller stepped cube on top, so each family
// shows a top plane, a side plane and a recess under the same light.
function sampleGeometry(THREE) {
  return mergeGeometries(THREE, [
    block(THREE, 0.42, 0.24, 0.42, { position: [0, 0.12, 0] }),
    block(THREE, 0.26, 0.16, 0.26, { position: [0.04, 0.32, -0.04] })
  ]);
}

export function createMaterialSamples(THREE, scope, { assetId, packVersion }) {
  const root = new THREE.Group();
  root.name = 'ref_material_board';
  root.userData.belAsset = { assetId, role: 'preview-reference', packVersion };
  const geo = scope.shared('geometry:ref:materialSample', () => sampleGeometry(THREE));
  const pitch = 0.56;
  MATERIAL_FAMILIES.forEach(([family, hex, surface], i) => {
    const mesh = new THREE.Mesh(geo, sharedMaterial(THREE, scope, `sample_${family}`, hex, SURFACE_FOR[surface]));
    mesh.name = `M_sample_${family}`;
    mesh.position.set((i - (MATERIAL_FAMILIES.length - 1) / 2) * pitch, 0, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  });
  const base = new THREE.Mesh(
    scope.shared('geometry:ref:materialBase', () => block(THREE, MATERIAL_FAMILIES.length * pitch + 0.12, 0.06, 0.6, { position: [0, -0.03, 0] })),
    sharedMaterial(THREE, scope, 'sample_base', '#4a4540', { roughness: 1, metalness: 0 }));
  base.name = 'M_sample_base';
  base.receiveShadow = true;
  root.add(base);

  return {
    root, clips: [], sockets: {}, bounds: localBounds(THREE, root),
    applyAppearance: () => ({}),
    metadata: {
      kind: 'preview-reference', role: 'preview-reference (material board; not a gameplay object, not scene art)',
      artDirection: 'BEL-ART-01 v1.0 section 8.2 — one sample per existing material family',
      families: MATERIAL_FAMILIES.map(([family, hex, surface, source]) => ({ family, hex, surface: SURFACE_FOR[surface], source })),
      triangles: countTriangles(root)
    }
  };
}
