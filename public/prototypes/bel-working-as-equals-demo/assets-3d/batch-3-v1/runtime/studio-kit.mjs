// Shared studio furniture kit — block-built (BEL-ART-01 section 7).
// The existing studio inventory only: the green armchair, the wall monitor,
// the presenter console, the carpet. Reused by studios A / C / E / G; Room F
// borrows the plant, door and wall components from room-kit.mjs.
//
// Sizes come from the baseline logical rectangles (scenes.mjs): a seat is
// 42 x 25 px (0.84 x 0.5), the monitor solid is 210 x 16 px, the console solid
// is 40 x 28 px. Nothing here adds furniture, and no surface carries text.
import { PALETTE, SURFACE, sharedMaterial } from './materials.mjs';
import { block, countTriangles, localBounds, mergeGeometries, tint, verticalTint } from './geometry.mjs';

const at = (x, y, z) => ({ position: [x, y, z] });
const num = (value, fallback) => (Number.isFinite(value) ? value : fallback);

const COMPONENTS = {
  // Armchair: seat box, back, two arms, four legs — the source silhouette.
  'studio.chair': (THREE, scope, variant) => {
    const width = num(variant.width, 0.84), depth = num(variant.depth, 0.5);
    const seatH = num(variant.seatHeight, 0.36);   // fitted to the approved avatar's SeatedIdle
    const geo = scope.shared(`geometry:studio:chair:${width}x${depth}x${seatH}`, () => {
      const parts = [], armW = 0.1;
      parts.push(tint(THREE, block(THREE, width, 0.16, depth, at(0, seatH - 0.08, 0)), 1.04));                 // seat cushion
      parts.push(verticalTint(THREE, block(THREE, width, 0.52, 0.14, at(0, seatH + 0.26, -depth / 2 + 0.07)), seatH, seatH + 0.52, 0.9, 1.06)); // back
      for (const x of [-1, 1]) parts.push(block(THREE, armW, 0.14, depth - 0.06, at(x * (width / 2 - armW / 2), seatH + 0.07, 0.03)));
      return mergeGeometries(THREE, parts);
    });
    const body = new THREE.Mesh(geo, sharedMaterial(THREE, scope, 'chairFabric', PALETTE.studio.chairFabric, { ...SURFACE.fabric, vertexColors: true }));
    body.name = 'M_chair_body'; body.castShadow = true; body.receiveShadow = true;
    const legGeo = scope.shared(`geometry:studio:chairLegs:${width}x${depth}x${seatH}`, () => mergeGeometries(THREE,
      [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sz]) => block(THREE, 0.07, seatH - 0.16, 0.07,
        at(sx * (width / 2 - 0.07), (seatH - 0.16) / 2, sz * (depth / 2 - 0.07)), 0.008))));
    const legs = new THREE.Mesh(legGeo, sharedMaterial(THREE, scope, 'chairLegWood', PALETTE.studio.consoleWood, SURFACE.timber));
    legs.name = 'M_chair_legs'; legs.castShadow = true;
    return { meshes: [body, legs], info: { width, depth, seatHeight: seatH, footprint: [width, depth], note: 'seat height matches the avatar SeatedIdle target for Batch 1' } };
  },
  // Wall monitor: dark frame, neutral screen face, wall bracket.
  'studio.monitor': (THREE, scope, variant) => {
    const width = num(variant.width, 4.2), height = num(variant.height, 2.1), depth = num(variant.depth, 0.22);
    const frameGeo = scope.shared(`geometry:studio:monitorFrame:${width}x${height}`, () => mergeGeometries(THREE, [
      block(THREE, width, height, depth, at(0, 0, 0)),
      tint(THREE, block(THREE, width + 0.08, 0.1, depth + 0.06, at(0, -height / 2 - 0.02, 0)), 0.85)  // lower lip
    ]));
    const frame = new THREE.Mesh(frameGeo, sharedMaterial(THREE, scope, 'monitorFrame', PALETTE.studio.monitorFrame, { ...SURFACE.paintedWood, vertexColors: true }));
    frame.name = 'M_monitor_frame'; frame.castShadow = true; frame.receiveShadow = true;
    const screenGeo = scope.shared(`geometry:studio:monitorScreen:${width}x${height}`, () => block(THREE, width - 0.16, height - 0.16, 0.03, at(0, 0, depth / 2 - 0.005), 0.006));
    const screenMaterial = scope.shared(`material:monitorScreen:${variant.glow ? 'glow' : 'flat'}`, () => {
      const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.studio.monitorScreen), ...SURFACE.screen });
      m.name = 'monitorScreen';
      if (variant.glow) { m.emissive = new THREE.Color(PALETTE.studio.monitorScreen); m.emissiveIntensity = 0.28; }
      return m;
    });
    const screen = new THREE.Mesh(screenGeo, screenMaterial);
    screen.name = 'M_monitor_screen';
    const bracketGeo = scope.shared('geometry:studio:monitorBracket', () => block(THREE, 0.5, 0.3, 0.16, at(0, 0, -0.16)));
    const bracket = new THREE.Mesh(bracketGeo, sharedMaterial(THREE, scope, 'monitorFrame', PALETTE.studio.monitorFrame, SURFACE.paintedWood));
    bracket.name = 'M_monitor_bracket';
    return {
      meshes: [frame, screen, bracket],
      info: {
        width, height, depth, glow: Boolean(variant.glow),
        note: 'A neutral physical screen surface. Slides, source text and objectives never appear on it — they stay in the HTML modal / native presentation.'
      }
    };
  },
  // Presenter console: timber podium with a small angled screen.
  'studio.console': (THREE, scope, variant) => {
    const width = num(variant.width, 0.8), depth = num(variant.depth, 0.56), height = num(variant.height, 1.05);
    const bodyGeo = scope.shared(`geometry:studio:console:${width}x${depth}x${height}`, () => mergeGeometries(THREE, [
      verticalTint(THREE, block(THREE, width, height - 0.08, depth, at(0, (height - 0.08) / 2, 0)), 0, height, 0.8, 1.04),
      tint(THREE, block(THREE, width + 0.1, 0.08, depth + 0.1, at(0, height - 0.04, 0)), 1.08)   // desktop lip
    ]));
    const body = new THREE.Mesh(bodyGeo, sharedMaterial(THREE, scope, 'consoleWood', PALETTE.studio.consoleWood, { ...SURFACE.timber, vertexColors: true }));
    body.name = 'M_console_body'; body.castShadow = true; body.receiveShadow = true;
    const screenGeo = scope.shared('geometry:studio:consoleScreen', () => {
      const g = block(THREE, 0.44, 0.3, 0.05, at(0, 0.16, 0), 0.008);
      g.rotateX(-0.28);
      return g;
    });
    const screen = new THREE.Mesh(screenGeo, sharedMaterial(THREE, scope, 'monitorScreenFlat', PALETTE.studio.monitorScreen, SURFACE.screen));
    screen.name = 'M_console_screen'; screen.position.set(0, height, 0.02); screen.castShadow = true;
    return { meshes: [body, screen], info: { width, depth, height, note: 'the existing presenter console; its small screen is a prop surface, never slide content' } };
  },
  // Carpet: a flat mat with a simple two-tone weave, no pattern or symbol.
  'studio.carpet': (THREE, scope, variant) => {
    const width = num(variant.width, 11), depth = num(variant.depth, 5.6);
    const geo = scope.shared(`geometry:studio:carpet:${width}x${depth}`, () => {
      const rows = Math.max(2, Math.round(depth / 0.7)), parts = [];
      for (let i = 0; i < rows; i++) {
        const d = depth / rows;
        parts.push(tint(THREE, block(THREE, width, 0.03, d, at(0, 0.015, -depth / 2 + d * (i + 0.5)), 0.006), i % 2 ? 0.97 : 1.03));
      }
      return mergeGeometries(THREE, parts);
    });
    const mesh = new THREE.Mesh(geo, sharedMaterial(THREE, scope, 'carpet', PALETTE.studio.carpet, { ...SURFACE.fabric, vertexColors: true }));
    mesh.name = 'M_carpet'; mesh.receiveShadow = true;
    return { meshes: [mesh], info: { width, depth, thickness: 0.03, note: 'flat mat; it adds no step and no obstacle' } };
  }
};

export const STUDIO_COMPONENT_IDS = Object.freeze(Object.keys(COMPONENTS));

export function createStudioComponent(THREE, scope, { assetId, variant = {}, packVersion }) {
  const build = COMPONENTS[assetId];
  if (!build) throw new RangeError(`Unknown studio component "${assetId}". Known: ${STUDIO_COMPONENT_IDS.join(', ')}.`);
  const root = new THREE.Group();
  root.name = assetId.replace(/[.-]/g, '_');
  root.userData.belAsset = { assetId, variant, packVersion };
  const { meshes, info } = build(THREE, scope, variant);
  root.add(...meshes);
  return {
    root, clips: [], sockets: {}, bounds: localBounds(THREE, root),
    applyAppearance: () => ({}),
    metadata: {
      kind: 'studio-kit component (block-built)',
      artDirection: 'BEL-ART-01 v1.0 — existing furniture inventory rebuilt with real depth, supports and material separation',
      component: assetId, variant, ...info,
      triangles: countTriangles(root), meshes: meshes.length,
      placement: 'Gemini places this at the existing logical seat/monitor/console rectangles; the component holds no scene position and no collision.'
    }
  };
}
