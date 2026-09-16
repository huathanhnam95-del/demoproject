// Keyframed AnimationClips for the articulated avatar. Clips are baked from
// deterministic pose functions into ordinary Quaternion/Vector keyframe
// tracks, so they need no runtime callbacks and would survive an optional
// GLTFExporter pass. The asset root is never keyed: no root motion.
import { JOINTS, RIG_DIMENSIONS as D, solveLeg } from './avatar-rig.mjs';

// Host walking speed: 108 logical px/s (C21) x s = 2.16 world units/s.
const WALK_SPEED = 108 * 0.02;

export const CLIP_INFO = Object.freeze({
  Idle: Object.freeze({
    name: 'Idle', duration: 3.2, fps: 30, loop: true, rootMotion: false,
    notes: 'Grounded breathing/weight loop. Feet solved to fixed floor positions; no world displacement.'
  }),
  Walk: Object.freeze({
    name: 'Walk', duration: 0.4, fps: 60, loop: true, rootMotion: false,
    travelPerCycle: +(WALK_SPEED * 0.4).toFixed(4),          // world units per loop at timeScale 1
    travelPerCycleLogical: +(108 * 0.4).toFixed(4),        // logical px per loop
    nominalSpeed: WALK_SPEED, nominalSpeedLogical: 108,
    timeScaleRule: 'timeScale = displayedSpeed / nominalSpeed (1.0 at the unchanged 108 px/s host speed)',
    stanceFraction: 0.5,
    footContacts: Object.freeze({
      left: Object.freeze([Object.freeze({ plant: 0, lift: 0.2 })]),
      right: Object.freeze([Object.freeze({ plant: 0.2, lift: 0.4 })])
    }),
    notes: 'In place. During stance the planted ankle moves backwards relative to the root at exactly nominalSpeed, so the foot is stationary on the floor when the host moves the avatar at 108 px/s.'
  })
});

const TAU = Math.PI * 2;
const REST = Object.fromEntries(JOINTS.map(([name, , position, euler]) => [name, { position, euler }]));
const thighJointY = hipsY => hipsY + D.thighOffset[1];

function legPose(pose, side, hipsY, ankleZ, ankleY) {
  const leg = solveLeg(ankleZ, ankleY - thighJointY(hipsY));
  pose[`J_thigh_${side}`] = [leg.thigh, 0, 0];
  pose[`J_shin_${side}`] = [leg.shin, 0, 0];
  pose[`J_foot_${side}`] = [leg.foot, 0, 0];
}

function idlePose(t) {
  const { duration } = CLIP_INFO.Idle, w = TAU * t / duration;
  const hipsY = D.hipsHeight - 0.006 * (1 - Math.cos(w)) / 2;
  const pose = { hipsY };
  pose.J_hips = [0, 0, 0];
  pose.J_spine = [0.02 + 0.012 * Math.sin(w), 0, 0];
  pose.J_neck = [-0.01, 0.02 * Math.sin(w), 0];
  pose.J_head = [0.015 * Math.sin(2 * w), 0.05 * Math.sin(w), 0];
  for (const [side, sign] of [['L', 1], ['R', -1]]) {
    pose[`J_upperArm_${side}`] = [0.03 * Math.sin(w + 0.5), 0, sign * (0.13 + 0.02 * Math.sin(w))];
    pose[`J_foreArm_${side}`] = [-0.15 - 0.03 * Math.sin(w + 0.5), 0, 0];
    pose[`J_hand_${side}`] = [0, 0, 0];
    legPose(pose, side, hipsY, 0, D.ankleHeight);
  }
  return pose;
}

function walkFoot(u) {
  // u in [0,1): stance for u < 0.5, swing after. Relative to the thigh joint.
  const { travelPerCycle: travel } = CLIP_INFO.Walk, half = travel / 4;
  if (u < 0.5) return { z: half - travel * u, y: D.ankleHeight, stance: true };
  const v = (u - 0.5) / 0.5;
  return { z: -half + 2 * half * (1 - Math.cos(Math.PI * v)) / 2, y: D.ankleHeight + 0.085 * Math.sin(Math.PI * v), stance: false };
}

function walkPose(t) {
  const { duration, travelPerCycle: travel } = CLIP_INFO.Walk;
  const u = (t / duration) % 1, w = TAU * u;
  const left = walkFoot(u), right = walkFoot((u + 0.5) % 1);
  const stance = left.stance ? left : right;
  // Inverted-pendulum hip height from the stance leg, softened so the knees
  // keep a little flex at mid-stance.
  const reach = (D.thigh + D.shin) * 0.99, half = travel / 4;
  const hEnd = D.ankleHeight + Math.sqrt(reach * reach - half * half);
  const hPend = D.ankleHeight + Math.sqrt(reach * reach - stance.z * stance.z);
  const hipsY = hEnd + 0.55 * (hPend - hEnd) - D.thighOffset[1];
  const pose = { hipsY };
  // Hips stay unrotated so the root-frame leg IK is exact (no foot slip);
  // the counter-swing lives in the spine.
  pose.J_hips = [0, 0, 0];
  pose.J_spine = [0.07, 0.1 * Math.cos(w), -0.02 * Math.cos(w)];
  pose.J_neck = [-0.03, -0.06 * Math.cos(w), 0];
  pose.J_head = [-0.03 + 0.02 * Math.sin(2 * w), 0, 0];
  for (const [side, sign, foot] of [['L', 1, left], ['R', -1, right]]) {
    const swing = sign * Math.cos(w); // >0 = this arm swings back
    pose[`J_upperArm_${side}`] = [0.42 * swing, 0, sign * 0.15];
    pose[`J_foreArm_${side}`] = [-0.25 - 0.3 * Math.max(0, -swing), 0, 0];
    pose[`J_hand_${side}`] = [0, 0, 0];
    legPose(pose, side, hipsY, foot.z, foot.y);
  }
  return pose;
}

function bake(THREE, info, poseAt) {
  const frames = Math.round(info.duration * info.fps);
  const times = [], quats = Object.fromEntries(JOINTS.map(([n]) => [n, []])), hips = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler(), prev = {};
  for (let f = 0; f <= frames; f++) {
    const t = f === frames ? info.duration : f / info.fps;
    // The closing key repeats frame 0 exactly so the loop is seamless.
    const pose = poseAt(f === frames ? 0 : t);
    times.push(+t.toFixed(6));
    hips.push(0, +pose.hipsY.toFixed(6), 0);
    for (const [name] of JOINTS) {
      e.set(...(pose[name] || REST[name].euler), 'XYZ');
      q.setFromEuler(e);
      if (prev[name] && prev[name].dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      prev[name] = (prev[name] || new THREE.Quaternion()).copy(q);
      quats[name].push(...q.toArray().map(v => +v.toFixed(7)));
    }
  }
  const tracks = [new THREE.VectorKeyframeTrack('J_hips.position', times, hips)];
  for (const [name] of JOINTS) tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, quats[name]));
  const clip = new THREE.AnimationClip(info.name, info.duration, tracks);
  return clip;
}

// Immutable clips; safe to share between any number of mixers.
export function buildAvatarClips(THREE) {
  return [bake(THREE, CLIP_INFO.Idle, idlePose), bake(THREE, CLIP_INFO.Walk, walkPose)];
}
