// Material palette. Every colour below is traceable:
//   [sample]  median of a documented rect in the baseline art, see
//             evidence/source-palette.json (tools/extract-source-palette.py)
//   [sprites] constant in world/sprites.mjs at the baseline commit
// Roughness/metalness values are Claude authoring choices (no source value
// exists for them) and are listed in asset-contract.json as such.

export const SHIRT_TINTS = Object.freeze({
  // [sprites] createSpriteAtlas tint table, the live renderer's clothing options.
  teal: '#248f89', cream: '#e0d8c1', amber: '#b46f29', red: '#a13626'
});

export const ACTOR_PALETTES = Object.freeze({
  // [sample] per-actor clothing/hair from the approved cast sprites.
  p0: Object.freeze({ hair: '#4f2f1d', shirt: '#ab2420', undershirt: '#f8f0e3', pants: '#143e66', shoes: '#5b2c12' }),
  p1: Object.freeze({ hair: '#3f2314', hairTie: '#9f2313', shirt: '#47a695', pants: '#123458', shoes: '#4b2d14' }),
  p2: Object.freeze({ hair: '#8f4c1d', shirt: '#f9f2e5', pants: '#175075', shoes: '#4a290c' }),
  p3: Object.freeze({ hair: '#4d433d', shirt: '#c36a15', pants: '#052b4e', shoes: '#593611' })
});

export const PALETTE = Object.freeze({
  skin: '#fcbe8e',        // [sample] p0 face; one shared skin tone, as in the sprites' single skin constant
  eye: '#292521',         // [sprites] pixel-cast eye colour
  mouth: '#a66b4a',       // [sprites] pixel-cast mouth colour
  straw: '#eecc95',       // [sample] p3's baked straw hat
  strawBand: '#7b5a39',   // [sprites] straw hat band
  cap: '#3b6972',         // [sprites] atlas cap colour
  capBrim: '#31505b',     // [sprites] pixel-cast cap brim
  glassesFrame: '#183b3d',// [sprites] atlas glasses stroke
  glassesLens: '#93bbbd', // [sprites] pixel-cast lens tint
  plankMark: '#fbe5c8',   // [sample] painted plank marks, F-complete.png
  plankNail: '#f2b440',   // [sample] brass nail head, F-complete.png
  planks: Object.freeze({ // [sample] plank bodies, exact 2D renderer crop rects in F-complete.png
    teal: '#0098a9', violet: '#7e3ec0', rose: '#e06575', red: '#bb2a25', blue: '#1d5aca', amber: '#e28a17'
  }),
  // [sample] F.png environment references. Preview ground/reference only in
  // Batch 0; the Room F kit (Batch 1) will consume them.
  environment: Object.freeze({ floorWood: '#f3ceac', gapDark: '#282828', wallCream: '#fef4e9', trimNavy: '#093657', railWood: '#7f4e27' }),
  // [sample] C.png studio material families, used by the Batch 0 material
  // board and by the Batch 1 studio kit.
  studio: Object.freeze({ chairFabric: '#228a71', carpet: '#9aaf94', monitorFrame: '#172b3c', monitorScreen: '#98afd2', consoleWood: '#955a2e', doorWood: '#a06334', plantLeaf: '#246b24', plantPot: '#d0c6b0' }),
  reference: '#d23c8c'    // preview-only measuring aid; deliberately not a scene colour
});

// Authoring choices (not source values).
export const SURFACE = Object.freeze({
  skin: { roughness: 0.62, metalness: 0 },
  cloth: { roughness: 0.86, metalness: 0 },
  denim: { roughness: 0.9, metalness: 0 },
  hair: { roughness: 0.55, metalness: 0 },
  leather: { roughness: 0.5, metalness: 0 },
  straw: { roughness: 0.92, metalness: 0 },
  frame: { roughness: 0.35, metalness: 0.15 },
  lens: { roughness: 0.3, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false },
  paintedWood: { roughness: 0.7, metalness: 0 },
  paint: { roughness: 0.6, metalness: 0 },
  brass: { roughness: 0.35, metalness: 0.7 },
  matte: { roughness: 1, metalness: 0 }
});

export function standard(THREE, name, hex, surface) {
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), ...surface });
  material.name = name;
  return material;
}

// Shared, read-only material held through the instance scope's cache.
export function sharedMaterial(THREE, scope, name, hex, surface) {
  return scope.shared(`material:${name}:${hex}`, () => standard(THREE, name, hex, surface));
}
