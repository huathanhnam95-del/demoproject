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
