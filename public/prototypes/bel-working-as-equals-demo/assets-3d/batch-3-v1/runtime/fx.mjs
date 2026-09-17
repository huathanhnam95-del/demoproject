// Optional atmosphere (BEL-ART-01 section 9, pass L5). Both assets are OFF
// unless the integration owner turns them on, both are decorative only, and
// neither may ever signal state, mark a slot or gate an action.
//
//  fx.sun-patch  — the warm daylight patch the source art already paints on
//                  the Room F far platform. Static geometry, no light source.
//  fx.dust-motes — slow warm motes in the lit air. Motion comes from ordinary
//                  looping AnimationClips played on the host's mixer: the
//                  asset has no loop, timer, RAF or update call of its own.
//                  Skip the actions (or hide the root) for reduced motion.
import { PALETTE } from './materials.mjs';
import { block, countTriangles, localBounds, mergeGeometries } from './geometry.mjs';

const num = (value, fallback) => (Number.isFinite(value) ? value : fallback);
// Deterministic hash-based noise: same seed, same motes, every time.
const rand = (seed, i) => { const n = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453; return n - Math.floor(n); };

export const DUST_DEFAULTS = Object.freeze({ clusters: 3, motesPerCluster: 10, size: 0.019, volume: [3.2, 1.5, 2.0], loopSeconds: [17, 21, 25] });

// ---- sun patch ----
export function createSunPatch(THREE, scope, { variant = {}, assetId, packVersion }) {
  const width = num(variant.width, 1.35), depth = num(variant.depth, 1.0), skew = num(variant.skew, 0.42);
  const segments = 10;
  const geo = scope.shared(`geometry:fx:sunPatch:${width}x${depth}x${skew}`, () => {
    const g = new THREE.PlaneGeometry(width, depth, segments, segments);
    g.rotateX(-Math.PI / 2);
    const position = g.getAttribute('position'), colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), z = position.getZ(i);
      position.setX(i, x + z * skew);                       // parallelogram, as painted
      const fx = 1 - Math.abs(x) / (width / 2), fz = 1 - Math.abs(z) / (depth / 2);
      const falloff = Math.max(0, Math.min(1, fx)) ** 1.1 * Math.max(0, Math.min(1, fz)) ** 1.1;
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = falloff;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  });
  const material = scope.shared('material:fx:sunPatch', () => {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.roomF.sunPatch), vertexColors: true, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending });
    m.name = 'sunPatch';
    return m;
  });
  const root = new THREE.Group();
  root.name = 'fx_sun_patch';
  root.userData.belAsset = { assetId, variant, packVersion };
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'M_sun_patch';
  mesh.renderOrder = 1;
  root.add(mesh);
  return {
    root, clips: [], sockets: {}, bounds: localBounds(THREE, root),
    applyAppearance: () => ({}),
    metadata: {
      kind: 'optional atmosphere (static)', component: assetId, width, depth, skew,
      artDirection: 'BEL-ART-01 v1.0 pass L5 — the daylight patch already painted on the F far platform',
      dependsOn: 'the key-light direction in runtime/lighting.mjs; move or drop the patch if the key moves',
      rules: 'static, decorative, additive; never over a movable object, never a placement or answer cue',
      triangles: countTriangles(root), meshes: 1
    }
  };
}

// ---- dust motes ----
export function createDustMotes(THREE, scope, { variant = {}, seed = 1, assetId, packVersion }) {
  const clusters = num(variant.clusters, DUST_DEFAULTS.clusters);
  const perCluster = num(variant.motesPerCluster, DUST_DEFAULTS.motesPerCluster);
  const size = num(variant.size, DUST_DEFAULTS.size);
  const [vx, vy, vz] = variant.volume || DUST_DEFAULTS.volume;
  const material = scope.shared('material:fx:dust', () => {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff2d6'), transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
    m.name = 'dustMote';
    return m;
  });
  const root = new THREE.Group();
  root.name = 'fx_dust_motes';
  root.userData.belAsset = { assetId, variant: { clusters, motesPerCluster: perCluster, size }, packVersion };

  const clips = [];
  for (let c = 0; c < clusters; c++) {
    const group = new THREE.Group();
    group.name = `dust_cluster_${c}`;
    const geo = scope.shared(`geometry:fx:dust:${seed}:${c}:${perCluster}:${size}:${vx}x${vy}x${vz}`, () => mergeGeometries(THREE,
      Array.from({ length: perCluster }, (_, i) => {
        const s = size * (0.6 + 0.8 * rand(seed + c, i * 3));
        return block(THREE, s, s, s, { position: [(rand(seed + c, i * 3 + 1) - 0.5) * vx, (rand(seed + c, i * 3 + 2) - 0.5) * vy, (rand(seed + c, i * 3 + 3) - 0.5) * vz] }, s * 0.2);
      })));
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `M_dust_${c}`;
    mesh.renderOrder = 2;
    group.add(mesh);
    root.add(group);

    // A closed drift loop: first and last keys are identical, so the clip
    // loops seamlessly and never accumulates displacement.
    const duration = DUST_DEFAULTS.loopSeconds[c % DUST_DEFAULTS.loopSeconds.length];
    const frames = 24, times = [], values = [];
    const ax = 0.22 + 0.1 * rand(seed, c), ay = 0.1 + 0.05 * rand(seed, c + 7), az = 0.16 + 0.08 * rand(seed, c + 13);
    const phase = rand(seed, c + 21) * Math.PI * 2;
    for (let f = 0; f <= frames; f++) {
      const u = f / frames, a = u * Math.PI * 2 + phase;
      times.push(+(duration * u).toFixed(4));
      values.push(+(Math.sin(a) * ax).toFixed(5), +(Math.sin(a * 2 + phase) * ay).toFixed(5), +(Math.cos(a) * az).toFixed(5));
    }
    values.splice(values.length - 3, 3, values[0], values[1], values[2]);
    clips.push(new THREE.AnimationClip(`DustDrift_${c}`, duration, [new THREE.VectorKeyframeTrack(`dust_cluster_${c}.position`, times, values)]));
  }

  return {
    root, clips, sockets: {}, bounds: localBounds(THREE, root),
    applyAppearance: () => ({}),
    metadata: {
      kind: 'optional atmosphere (decorative motion)', component: assetId,
      artDirection: 'BEL-ART-01 v1.0 pass L5 — warm motes in the lit air',
      clusters, motesPerCluster: perCluster, size, volume: [vx, vy, vz], seed,
      clips: clips.map(c => ({ name: c.name, duration: c.duration, loop: true, tracks: c.tracks.length })),
      motion: 'looping AnimationClips for the host mixer; no loop, timer or update call inside the asset',
      reducedMotion: 'do not create the actions, or hide the root; a static pose is valid and nothing else changes',
      rules: 'off by default, decorative only, never a state cue, never near a timed prompt',
      triangles: countTriangles(root), meshes: clusters
    }
  };
}
