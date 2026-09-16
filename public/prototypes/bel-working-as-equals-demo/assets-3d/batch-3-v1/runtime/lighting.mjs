// Lighting reference for Room F / studio G (BEL-ART-01 section 9).
// Plain data only: no THREE objects, no lights, no loops. Claude's preview
// applies these presets so the reviewer sees them; Gemini owns the live
// renderer and applies/tunes the same numbers there. Warm, grounded and
// readable — never a night scene, never a cue that reveals state.
//
// Built in the passes the art direction asks for, so a reviewer can switch a
// pass off and see what it contributes:
//   L0 neutral   — flat asset review: base colour, normals, proportion
//   L1 key       — one daylight direction; top and side planes separate
//   L2 fill      — hemisphere sky/bounce + a cool opposite fill
//   L3 grounding — shadows, contact darkening
//   L4 response  — final exposure/material balance
//   L5 optional  — sun patches and dust motes, both off by default

export const LIGHTING_PASSES = Object.freeze(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);

const hemi = (sky, ground, intensity) => Object.freeze({ type: 'HemisphereLight', sky, ground, intensity });
const dir = (color, intensity, position, shadow = null) => Object.freeze({ type: 'DirectionalLight', color, intensity, position, castShadow: Boolean(shadow), shadow });

// One shadow camera covering the Room F action area (about 19 x 9 world units).
const KEY_SHADOW = Object.freeze({
  mapSize: 2048, camera: Object.freeze({ left: -11, right: 11, top: 7.5, bottom: -6.5, near: 1, far: 34 }),
  bias: -0.0006, normalBias: 0.035, radius: 2.2,
  note: 'One shadow-casting light only. Blocky geometry needs normalBias rather than a large bias, or contact shadows detach from the feet.'
});

export const LIGHTING_REFERENCE = Object.freeze({
  colorPipeline: Object.freeze({
    outputColorSpace: 'SRGBColorSpace', toneMapping: 'NeutralToneMapping', toneMappingExposure: 1.05,
    note: 'Source hexes are sRGB; THREE.Color converts them to the working space. Neutral tone mapping keeps the warm key from clipping the cream walls while leaving the activity colours where the source put them. Audit this before adding more light.'
  }),
  presets: Object.freeze({
    L0: Object.freeze({
      label: 'L0 neutral asset review', background: '#d7d7d7', shadows: false,
      lights: Object.freeze([hemi('#ffffff', '#c8c8c8', 2.1), dir('#ffffff', 0.9, [3, 9, 8])]),
      toneMapping: 'NoToneMapping', exposure: 1,
      question: 'Are base colours, normals, symbols and proportions right without atmosphere?'
    }),
    L1: Object.freeze({
      label: 'L1 key light only', background: '#bdb4a8', shadows: false,
      lights: Object.freeze([dir('#ffe9c9', 3.1, [-6.5, 9.5, 5.5])]),
      question: 'Do top and side planes separate without losing faces or marks?'
    }),
    L2: Object.freeze({
      label: 'L2 key + fill', background: '#e7ddd0', shadows: false,
      lights: Object.freeze([
        dir('#ffe9c9', 3.1, [-6.5, 9.5, 5.5]),
        hemi('#fff3e2', '#c29f7c', 0.95),                 // sky above, warm floor bounce below
        dir('#cfe0ff', 0.28, [7, 4.5, -6])                 // cool opposite fill, no shadow
      ]),
      question: 'Can all four avatars and every essential object be told apart?'
    }),
    L3: Object.freeze({
      label: 'L3 grounding (shadows)', background: '#e7ddd0', shadows: true,
      lights: Object.freeze([
        dir('#ffe9c9', 3.1, [-6.5, 9.5, 5.5], KEY_SHADOW),
        hemi('#fff3e2', '#c29f7c', 0.95),
        dir('#cfe0ff', 0.28, [7, 4.5, -6])
      ]),
      question: 'Do contacts follow movement, with no floating, acne or detached shadows?'
    }),
    L4: Object.freeze({
      label: 'L4 room light (reference)', background: '#e9e0d2', shadows: true,
      lights: Object.freeze([
        dir('#ffeacb', 2.95, [-6.5, 9.5, 5.5], KEY_SHADOW),
        hemi('#fff4e4', '#c9a684', 1.02),
        dir('#cfe0ff', 0.3, [7, 4.5, -6])
      ]),
      question: 'Do timber, cloth, wall and the small metal read differently without glare?'
    }),
    L5: Object.freeze({
      label: 'L5 + optional atmosphere', background: '#e9e0d2', shadows: true,
      lights: Object.freeze([
        dir('#ffeacb', 2.95, [-6.5, 9.5, 5.5], KEY_SHADOW),
        hemi('#fff4e4', '#c9a684', 1.02),
        dir('#cfe0ff', 0.3, [7, 4.5, -6])
      ]),
      optional: Object.freeze({ sunPatches: true, dustMotes: true, screenGlow: true }),
      question: 'Is there a visible benefit at real size, and does the four-window budget still pass?'
    })
  }),
  // Everything below is optional and off unless the integration owner turns it
  // on. None of it may signal state, mark an answer or gate an action.
  optionalAtmosphere: Object.freeze({
    sunPatches: Object.freeze({
      assetId: 'fx.sun-patch',
      why: 'F.png already paints two warm light patches on the far platform; this is the same static daylight, not a new effect.',
      dependsOn: 'The key light direction above. If Gemini moves the key, move or drop the patches — a patch pointing the wrong way is worse than none.',
      rules: 'Static only. Never over a movable object, never used to mark a placement slot or a correct answer.'
    }),
    dustMotes: Object.freeze({
      assetId: 'fx.dust-motes',
      why: 'Slow warm motes inside the lit air give the room depth, the way Vesper separates lit air from dark recesses.',
      motion: 'Looping AnimationClips on the host mixer; the asset has no loop, timer or update call of its own.',
      rules: 'Off by default. Must be hidden (or left unanimated) when the viewer prefers reduced motion. Never near a timed prompt, never used as a cue. Decorative only.',
      reducedMotion: 'Hide the asset, or simply do not create a mixer action for it; a static pose is valid.'
    }),
    screenGlow: Object.freeze({
      what: 'A small emissive on the studio monitor surface only, because the source art shows the screen lit.',
      rules: 'Never emissive on an activity prop, a plank, a cube or a door. It must not brighten when a state changes.'
    })
  }),
  budget: Object.freeze({
    shadowCastingLights: 1,
    postProcessing: 'none required; no bloom, fog, depth of field or reflections are part of this direction',
    note: 'Extra shadow-casting lights cost real frame time in four windows. Add one only with a measurement that justifies it.'
  })
});

export const DEFAULT_PRESET = 'L4';
