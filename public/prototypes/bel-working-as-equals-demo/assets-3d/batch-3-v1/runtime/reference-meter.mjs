// Preview-only scale reference (Batch 0 "meter reference"). Not a gameplay
// object and not scene art: a 2-unit ruler with 0.1 ticks, a 1-unit cube,
// the unchanged collision footprint (RADIUS 10 logical px = 0.2 units) and a
// 50 logical px (= 1 unit) floor bar in 10 px steps.
import { PALETTE } from './materials.mjs';
import { countTriangles, localBounds, mergeGeometries, transformed } from './geometry.mjs';

function rulerGeometry(THREE) {
  const parts = [transformed(THREE, new THREE.BoxGeometry(0.02, 2, 0.02), { position: [0, 1, 0] })];
  for (let i = 1; i <= 20; i++) {
    const major = i % 5 === 0;
    parts.push(transformed(THREE, new THREE.BoxGeometry(major ? 0.16 : 0.08, 0.008, 0.008), { position: [major ? 0.08 : 0.04, i / 10, 0] }));
  }
  return mergeGeometries(THREE, parts);
}

function logicalBarGeometry(THREE, odd) {
  const parts = [];
  for (let i = odd ? 1 : 0; i < 5; i += 2) parts.push(transformed(THREE, new THREE.BoxGeometry(0.2, 0.01, 0.06), { position: [0.1 + i * 0.2, 0.005, 0] }));
  return mergeGeometries(THREE, parts);
}

export function createMeterReference(THREE, scope, { assetId, packVersion }) {
  const geo = (key, build) => scope.shared(`geometry:ref:${key}`, build);
  const basic = (name, hex) => scope.shared(`material:ref:${name}`, () => { const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex) }); m.name = name; return m; });
  const root = new THREE.Group();
  root.name = 'ref_meter';
  root.userData.belAsset = { assetId, role: 'preview-reference', packVersion };

  const ruler = new THREE.Mesh(geo('ruler', () => rulerGeometry(THREE)), basic('reference', PALETTE.reference));
  ruler.name = 'M_ruler_2u';
  const cubeEdges = scope.shared('geometry:ref:cubeEdges', () => { const box = new THREE.BoxGeometry(1, 1, 1); const e = new THREE.EdgesGeometry(box); box.dispose(); return e; });
  const lineMaterial = scope.shared('material:ref:line', () => { const m = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.reference) }); m.name = 'referenceLine'; return m; });
  const cube = new THREE.LineSegments(cubeEdges, lineMaterial);
  cube.name = 'L_cube_1u'; cube.position.set(0.75, 0.5, 0);
  const footprint = new THREE.Mesh(geo('footprint', () => transformed(THREE, new THREE.RingGeometry(0.185, 0.2, 48), { position: [-0.45, 0.003, 0], rotation: [-Math.PI / 2, 0, 0] })), basic('reference', PALETTE.reference));
  footprint.name = 'M_collision_radius_0.2u';
  const barA = new THREE.Mesh(geo('bar:even', () => logicalBarGeometry(THREE, false)), basic('reference', PALETTE.reference));
  const barB = new THREE.Mesh(geo('bar:odd', () => logicalBarGeometry(THREE, true)), basic('barDark', '#1d1d1d'));
  barA.name = 'M_logical_50px_a'; barB.name = 'M_logical_50px_b';
  for (const bar of [barA, barB]) bar.position.set(0.25, 0, 0.6);
  root.add(ruler, cube, footprint, barA, barB);

  return {
    root, clips: [], sockets: {}, bounds: localBounds(THREE, root),
    applyAppearance: () => ({}),
    metadata: {
      kind: 'preview-reference', role: 'preview-reference (not a gameplay object, not scene art)',
      triangles: countTriangles(root),
      marks: { rulerHeight: 2, tick: 0.1, cube: 1, collisionRadius: 0.2, logicalBar: '5 x 10 px = 50 px = 1.0 unit' }
    }
  };
}
