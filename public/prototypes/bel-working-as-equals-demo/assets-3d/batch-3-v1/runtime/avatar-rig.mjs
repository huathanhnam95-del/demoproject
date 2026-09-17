// Articulated rigid-part rig shared by avatar.mjs (construction) and
// avatar-clips.mjs (keyframes). Units: 1 world unit = 50 logical px
// (s = 0.02). Axes: +Y up, +Z forward (the avatar's face), character-left
// is +X. The root is on the floor between the feet and is never animated.
//
// Height 1.54 = the existing 2D cast height (77 logical px) x s.

export const RIG_DIMENSIONS = Object.freeze({
  height: 1.54,
  head: Object.freeze({ w: 0.34, h: 0.36, d: 0.32, y: 0.2 }), // head cuboid in J_head space
  thigh: 0.28,
  shin: 0.27,
  ankleHeight: 0.065,
  hipsHeight: 0.635,       // J_hips rest height above the floor
  thighOffset: [0.085, -0.02, 0], // thigh joint relative to J_hips (mirrored for R)
  upperArm: 0.2,
  foreArm: 0.18,
  collisionRadiusLogical: 10, // world/geometry.mjs RADIUS, unchanged
  collisionRadius: 0.2
});

const D = RIG_DIMENSIONS;

// name, parent, rest position (parent space), rest Euler XYZ (radians).
export const JOINTS = Object.freeze([
  ['J_hips', null, [0, D.hipsHeight, 0], [0, 0, 0]],
  ['J_spine', 'J_hips', [0, 0.055, 0], [0, 0, 0]],
  ['J_neck', 'J_spine', [0, 0.33, 0], [0, 0, 0]],
  ['J_head', 'J_neck', [0, 0.04, 0], [0, 0, 0]],
  ['J_upperArm_L', 'J_spine', [0.2, 0.27, 0], [0, 0, 0.13]],
  ['J_foreArm_L', 'J_upperArm_L', [0, -D.upperArm, 0], [-0.12, 0, 0]],
  ['J_hand_L', 'J_foreArm_L', [0, -D.foreArm, 0], [0, 0, 0]],
  ['J_upperArm_R', 'J_spine', [-0.2, 0.27, 0], [0, 0, -0.13]],
  ['J_foreArm_R', 'J_upperArm_R', [0, -D.upperArm, 0], [-0.12, 0, 0]],
  ['J_hand_R', 'J_foreArm_R', [0, -D.foreArm, 0], [0, 0, 0]],
  ['J_thigh_L', 'J_hips', D.thighOffset, [0, 0, 0]],
  ['J_shin_L', 'J_thigh_L', [0, -D.thigh, 0], [0, 0, 0]],
  ['J_foot_L', 'J_shin_L', [0, -D.shin, 0], [0, 0, 0]],
  ['J_thigh_R', 'J_hips', [-D.thighOffset[0], D.thighOffset[1], 0], [0, 0, 0]],
  ['J_shin_R', 'J_thigh_R', [0, -D.thigh, 0], [0, 0, 0]],
  ['J_foot_R', 'J_shin_R', [0, -D.shin, 0], [0, 0, 0]]
].map(j => Object.freeze(j)));

// Named attachment points: name, parent joint, position, purpose.
export const SOCKETS = Object.freeze([
  ['socket_hand_L', 'J_hand_L', [0, -0.045, 0.01], 'character-left hand grip point'],
  ['socket_hand_R', 'J_hand_R', [0, -0.045, 0.01], 'character-right hand grip point'],
  ['socket_held', 'J_spine', [0, 0.06, 0.24], 'provisional held-object anchor in front of the torso (0.75 above the floor at rest); Batch 1 carry clips refine the grip'],
  ['socket_hat', 'J_head', [0, 0.33, 0], 'hat seat on the block head (top of the head cuboid is 0.38); straw hat and cap are children'],
  ['socket_glasses', 'J_head', [0, 0.235, 0.172], 'glasses bridge point on the front face of the block head']
].map(s => Object.freeze(s)));

// How each carried object hangs off socket_held. The 2D renderer draws a
// carried cube lower than a carried plank (sprites.mjs: cube at p.y - 29,
// plank at p.y - 28 but much wider), so the offsets keep the same reading and
// stop a large cube covering the face.
export const CARRY_PROFILES = Object.freeze({
  'prop.bridge-plank': Object.freeze({ offset: [0, 0, 0], note: 'plank centre at socket_held; the hands meet its top face' }),
  'prop.activity-cube': Object.freeze({ offset: [0, -0.12, 0.02], note: 'cube centre just below socket_held, clear of the chin, as the 2D sprite draws it' }),
  'prop.route-shape': Object.freeze({ offset: [0, -0.08, 0.01], note: 'shape carried at chest height' }),
  default: Object.freeze({ offset: [0, 0, 0], note: 'attach the object socket_grip to socket_held' })
});

// How the avatar stands on each ridable object. The standing height is the
// source value: world/sprites.mjs lifts a riding sprite by 6 logical px
// (x 0.02 = 0.12), and ride() draws a 56 px deck with its axles 23 px either
// side of centre. Foot placements along the deck are authored.
export const RIDE_PROFILES = Object.freeze({
  scooter: Object.freeze({
    standHeight: 0.12, deckLength: 1.12, axleHalfSpacing: 0.46,
    grip: Object.freeze([0, 0.98, 0.4]),    // handlebar centre, from ride(): the stem stands at x 18..22 (centre 20 -> 0.4) and tops out at 49 px -> 0.98
    frontFootZ: 0.12, backFootZ: -0.16, pushFootZ: -0.46,
    note: 'One foot forward on the deck, one behind it; the pushing foot leaves the deck and touches the floor.'
  }),
  skateboard: Object.freeze({
    standHeight: 0.12, deckLength: 1.12, axleHalfSpacing: 0.46,
    grip: null,
    frontFootZ: 0.16, backFootZ: -0.2, pushFootZ: -0.5,
    note: 'Both feet on the deck while coasting; the back foot reaches the floor to push.'
  })
});

// Holding hands. world/simulation.mjs re-anchors a pair at { x: p.x + 32 },
// so the partner stands 32 logical px (0.64) to the character-left (+X).
export const HOLD_PROFILE = Object.freeze({
  partnerGap: 0.64, partnerGapLogical: 32,
  joinHeight: 0.7, joinForward: 0,
  note: 'The _L clips reach with the character-left hand to a join point half way to the partner (x = +0.32, y = 0.70, in the frontal plane); _R mirrors them. The pair relation itself stays with the host.'
});

const clamp1 = v => Math.min(1, Math.max(-1, v));

// Planar two-bone IK in the leg's sagittal (Y/Z) plane. Returns local X
// rotations for thigh, shin and foot so the ankle reaches (dz, dy) relative to
// the thigh joint and the foot stays level with the floor. +Z is forward; a
// forward thigh swing is a negative X rotation; knees bend backwards.
export function solveLeg(dz, dy, thigh = D.thigh, shin = D.shin) {
  const reach = thigh + shin;
  let d = Math.hypot(dz, dy);
  const limit = reach * 0.9995;
  if (d > limit) d = limit;
  const alpha = Math.atan2(dz, -dy);
  const cosBeta = (thigh * thigh + d * d - shin * shin) / (2 * thigh * d);
  const beta = Math.acos(Math.min(1, Math.max(-1, cosBeta)));
  const cosGamma = (thigh * thigh + shin * shin - d * d) / (2 * thigh * shin);
  const knee = Math.PI - Math.acos(Math.min(1, Math.max(-1, cosGamma)));
  const phi = alpha + beta;
  return { thigh: -phi, shin: knee, foot: phi - knee };
}

// Two-bone arm IK in the sagittal (Y/Z) plane, for reaching forward: returns
// local X rotations for the upper arm and the forearm so the hand joint lands
// at (dz, dy) relative to the shoulder. The elbow bends backwards.
export function solveArmX(dz, dy, upper = D.upperArm, fore = D.foreArm) {
  const reach = upper + fore;
  let d = Math.hypot(dz, dy);
  if (d > reach * 0.9995) d = reach * 0.9995;
  if (d < 1e-6) return { upper: 0, fore: 0 };
  const alpha = Math.atan2(-dz, -dy);
  const beta = Math.acos(clamp1((upper * upper + d * d - fore * fore) / (2 * upper * d)));
  const gamma = Math.acos(clamp1((upper * upper + fore * fore - d * d) / (2 * upper * fore)));
  return { upper: alpha - beta, fore: Math.PI - gamma };
}

// The same solver in the frontal (X/Y) plane, for reaching sideways: returns
// local Z rotations so the hand joint lands at (dx, dy) relative to the
// shoulder. Used by the handholding clips and by the raised waving arm.
export function solveArmZ(dx, dy, upper = D.upperArm, fore = D.foreArm) {
  const reach = upper + fore;
  let d = Math.hypot(dx, dy);
  if (d > reach * 0.9995) d = reach * 0.9995;
  if (d < 1e-6) return { upper: 0, fore: 0 };
  const alpha = Math.atan2(dx, -dy);
  const beta = Math.acos(clamp1((upper * upper + d * d - fore * fore) / (2 * upper * d)));
  const gamma = Math.acos(clamp1((upper * upper + fore * fore - d * d) / (2 * upper * fore)));
  return { upper: alpha + beta, fore: -(Math.PI - gamma) };
}
