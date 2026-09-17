// Keyframed AnimationClips for the articulated avatar. Clips are baked from
// deterministic pose functions into ordinary Quaternion/Vector keyframe
// tracks, so they need no runtime callbacks and would survive an optional
// GLTFExporter pass. The asset root is never keyed: no root motion.
import { HOLD_PROFILE, JOINTS, RIDE_PROFILES, RIG_DIMENSIONS as D, solveArmX, solveArmZ, solveLeg } from './avatar-rig.mjs';
import { SOCIAL } from './identity.mjs';

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
  }),
  CarryIdle: Object.freeze({
    name: 'CarryIdle', duration: 3.2, fps: 30, loop: true, rootMotion: false,
    carries: Object.freeze(['prop.bridge-plank', 'prop.activity-cube', 'prop.route-shape']),
    notes: 'Idle with both arms forward at socket_held. The hands sit at the carried object; nothing is welded to the avatar.'
  }),
  CarryWalk: Object.freeze({
    name: 'CarryWalk', duration: 0.4, fps: 60, loop: true, rootMotion: false,
    travelPerCycle: +(WALK_SPEED * 0.4).toFixed(4), travelPerCycleLogical: +(108 * 0.4).toFixed(4),
    nominalSpeed: WALK_SPEED, nominalSpeedLogical: 108,
    timeScaleRule: 'timeScale = displayedSpeed / nominalSpeed; carrying never changes the host speed',
    stanceFraction: 0.5,
    footContacts: Object.freeze({ left: Object.freeze([Object.freeze({ plant: 0, lift: 0.2 })]), right: Object.freeze([Object.freeze({ plant: 0.2, lift: 0.4 })]) }),
    carries: Object.freeze(['prop.bridge-plank', 'prop.activity-cube', 'prop.route-shape']),
    notes: 'Walk legs with the carry arms held steady. Same travel per cycle as Walk: carrying is not slower.'
  }),
  SeatedIdle: Object.freeze({
    name: 'SeatedIdle', duration: 3.6, fps: 30, loop: true, rootMotion: false,
    seatHeight: 0.36,
    placement: 'Place the avatar root at the seat centre on the floor. The clip lifts the hips onto the cushion and folds the legs; the hips never move horizontally.',
    notes: 'Feet rest flat on the floor in front of the chair; the back does not pass through the chair back.'
  }),
  Wave: Object.freeze({
    name: 'Wave', duration: 2.2, fps: 30, loop: false, rootMotion: false,
    sourceMs: SOCIAL.waveMs,
    arm: 'character-right',
    placement: 'Play once on top of / after Idle. The first and last frames are exactly the Idle frame at t = 0, so it blends back without a pop.',
    notes: 'Greeting only. The name label the 2D renderer draws while waving stays in the host HUD; the clip carries no text.'
  }),
  HandholdIdle_L: Object.freeze({
    name: 'HandholdIdle_L', duration: 3.2, fps: 30, loop: true, rootMotion: false,
    partnerSide: 'character-left (+X)', partnerGap: HOLD_PROFILE.partnerGap, partnerGapLogical: HOLD_PROFILE.partnerGapLogical,
    joinPoint: Object.freeze([HOLD_PROFILE.partnerGap / 2, HOLD_PROFILE.joinHeight, 0]),
    notes: 'Standing, the character-left hand held out to the join point half way to the partner. Pair the leader _L with the follower _R.'
  }),
  HandholdIdle_R: Object.freeze({
    name: 'HandholdIdle_R', duration: 3.2, fps: 30, loop: true, rootMotion: false,
    partnerSide: 'character-right (-X)', partnerGap: HOLD_PROFILE.partnerGap, partnerGapLogical: HOLD_PROFILE.partnerGapLogical,
    joinPoint: Object.freeze([-HOLD_PROFILE.partnerGap / 2, HOLD_PROFILE.joinHeight, 0]),
    notes: 'Mirror of HandholdIdle_L.'
  }),
  HandholdWalk_L: Object.freeze({
    name: 'HandholdWalk_L', duration: 0.4, fps: 60, loop: true, rootMotion: false,
    travelPerCycle: +(WALK_SPEED * 0.4).toFixed(4), travelPerCycleLogical: +(108 * 0.4).toFixed(4),
    nominalSpeed: WALK_SPEED, nominalSpeedLogical: 108,
    timeScaleRule: 'timeScale = displayedSpeed / nominalSpeed; holding hands never changes the host speed',
    stanceFraction: 0.5,
    footContacts: Object.freeze({ left: Object.freeze([Object.freeze({ plant: 0, lift: 0.2 })]), right: Object.freeze([Object.freeze({ plant: 0.2, lift: 0.4 })]) }),
    partnerSide: 'character-left (+X)', joinPoint: Object.freeze([HOLD_PROFILE.partnerGap / 2, HOLD_PROFILE.joinHeight, 0]),
    notes: 'Walk legs; the held hand stays on the join point while the free arm swings. Same travel per cycle as Walk.'
  }),
  HandholdWalk_R: Object.freeze({
    name: 'HandholdWalk_R', duration: 0.4, fps: 60, loop: true, rootMotion: false,
    travelPerCycle: +(WALK_SPEED * 0.4).toFixed(4), travelPerCycleLogical: +(108 * 0.4).toFixed(4),
    nominalSpeed: WALK_SPEED, nominalSpeedLogical: 108,
    timeScaleRule: 'timeScale = displayedSpeed / nominalSpeed; holding hands never changes the host speed',
    stanceFraction: 0.5,
    footContacts: Object.freeze({ left: Object.freeze([Object.freeze({ plant: 0, lift: 0.2 })]), right: Object.freeze([Object.freeze({ plant: 0.2, lift: 0.4 })]) }),
    partnerSide: 'character-right (-X)', joinPoint: Object.freeze([-HOLD_PROFILE.partnerGap / 2, HOLD_PROFILE.joinHeight, 0]),
    notes: 'Mirror of HandholdWalk_L.'
  }),
  ScooterIdle: Object.freeze({
    name: 'ScooterIdle', duration: 3.0, fps: 30, loop: true, rootMotion: false,
    rides: 'prop.scooter', standHeight: RIDE_PROFILES.scooter.standHeight, grip: RIDE_PROFILES.scooter.grip,
    contact: 'both feet on the deck; the object rolls, so no foot carries the motion',
    notes: 'The coasting pose (simulation.mjs pose "coasting"). Both hands on the handlebar, knees softly flexed.'
  }),
  ScooterRide: Object.freeze({
    name: 'ScooterRide', duration: 0.9, fps: 60, loop: true, rootMotion: false,
    rides: 'prop.scooter', standHeight: RIDE_PROFILES.scooter.standHeight, grip: RIDE_PROFILES.scooter.grip,
    nominalSpeed: +(165 * 0.02).toFixed(4), nominalSpeedLogical: 165,
    timeScaleRule: 'timeScale = displayedSpeed / nominalSpeed (1.0 at the unchanged 165 px/s ride speed)',
    contact: 'both feet on the deck; the object rolls, so no foot carries the motion and the clip claims no planted stride',
    notes: 'Moving pose (simulation.mjs pose "riding"): forward lean, a sway and a knee cycle. Following the 2D renderer, riding changes the arms and the lean, not the stride.'
  }),
  SkateboardIdle: Object.freeze({
    name: 'SkateboardIdle', duration: 3.0, fps: 30, loop: true, rootMotion: false,
    rides: 'prop.skateboard', standHeight: RIDE_PROFILES.skateboard.standHeight, grip: null,
    contact: 'both feet on the deck; the object rolls, so no foot carries the motion',
    notes: 'The coasting pose. Arms out a little for balance, no handlebar.'
  }),
  SkateboardRide: Object.freeze({
    name: 'SkateboardRide', duration: 0.9, fps: 60, loop: true, rootMotion: false,
    rides: 'prop.skateboard', standHeight: RIDE_PROFILES.skateboard.standHeight, grip: null,
    nominalSpeed: +(165 * 0.02).toFixed(4), nominalSpeedLogical: 165,
    timeScaleRule: 'timeScale = displayedSpeed / nominalSpeed (1.0 at the unchanged 165 px/s ride speed)',
    contact: 'both feet on the deck; the object rolls, so no foot carries the motion and the clip claims no planted stride',
    notes: 'Moving pose: lean, sway and a knee cycle, arms counterbalancing.'
  })
});

const TAU = Math.PI * 2;
const JU = 'J_upperArm_', JF = 'J_foreArm_', JH = 'J_hand_';
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

// Both arms forward, hands meeting at the held object. One pose serves the
// plank, the cube and the route shapes: the hands end up just outside a
// 0.58 cube and on the face of a plank.
function carryArms(pose, wobble = 0) {
  for (const [side, sign] of [['L', 1], ['R', -1]]) {
    pose[`J_upperArm_${side}`] = [-0.95 + wobble, 0, sign * 0.3];
    pose[`J_foreArm_${side}`] = [-0.3 - wobble * 0.5, 0, 0];
    pose[`J_hand_${side}`] = [0.12, 0, 0];
  }
}

function carryIdlePose(t) {
  const { duration } = CLIP_INFO.CarryIdle, w = TAU * t / duration;
  const hipsY = D.hipsHeight - 0.005 * (1 - Math.cos(w)) / 2;
  const pose = { hipsY };
  pose.J_hips = [0, 0, 0];
  pose.J_spine = [-0.02 + 0.008 * Math.sin(w), 0, 0];     // slight lean back against the load
  pose.J_neck = [0.015, 0.02 * Math.sin(w), 0];
  pose.J_head = [0.01 * Math.sin(2 * w), 0.03 * Math.sin(w), 0];
  carryArms(pose, 0.02 * Math.sin(w));
  for (const side of ['L', 'R']) legPose(pose, side, hipsY, 0, D.ankleHeight);
  return pose;
}

function carryWalkPose(t) {
  const pose = walkPose(t);                                 // identical legs and travel
  const w = TAU * ((t / CLIP_INFO.CarryWalk.duration) % 1);
  pose.J_spine = [-0.01, 0.04 * Math.cos(w), -0.015 * Math.cos(w)];
  pose.J_neck = [0.02, -0.02 * Math.cos(w), 0];
  pose.J_head = [-0.01, 0, 0];
  carryArms(pose, 0.03 * Math.cos(w));                      // steady arms, small carry bounce
  return pose;
}

function seatedPose(t) {
  const { duration, seatHeight } = CLIP_INFO.SeatedIdle, w = TAU * t / duration;
  // Pelvis resting on the cushion: the pelvis block is 0.09 below J_hips.
  const hipsY = seatHeight + 0.09 + 0.004 * Math.sin(w);
  const pose = { hipsY };
  pose.J_hips = [0, 0, 0];
  pose.J_spine = [-0.07 + 0.01 * Math.sin(w), 0, 0];        // upright, leaning very slightly back
  pose.J_neck = [0.03, 0.03 * Math.sin(w), 0];
  pose.J_head = [0.012 * Math.sin(2 * w), 0.04 * Math.sin(w), 0];
  for (const [side, sign] of [['L', 1], ['R', -1]]) {
    pose[`J_upperArm_${side}`] = [-0.42, 0, sign * 0.17];   // hands resting on the thighs
    pose[`J_foreArm_${side}`] = [-0.55 + 0.02 * Math.sin(w), 0, 0];
    pose[`J_hand_${side}`] = [0.2, 0, 0];
    // Feet flat on the floor, knees forward: solved, never posed by eye.
    legPose(pose, side, hipsY, 0.3, D.ankleHeight);
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

// ---- Batch 3 poses ----
// Shoulder joint in root space for a given hips height and spine pitch.
function shoulderAt(hipsY, spineX, side) {
  return { x: side === 'L' ? 0.2 : -0.2, y: hipsY + 0.055 + 0.27 * Math.cos(spineX), z: 0.27 * Math.sin(spineX) };
}

// Put one hand on a target in the sagittal plane (reaching forward), solving
// in the spine's own frame so the spine pitch is accounted for exactly.
function reachForward(pose, side, hipsY, spineX, target) {
  const sh = shoulderAt(hipsY, spineX, side);
  const dz0 = target[2] - sh.z, dy0 = target[1] - sh.y;
  const c = Math.cos(spineX), sn = Math.sin(spineX);
  const arm = solveArmX(-dy0 * sn + dz0 * c, dy0 * c + dz0 * sn);
  pose[JU + side] = [arm.upper, 0, 0];
  pose[JF + side] = [arm.fore, 0, 0];
  pose[JH + side] = [0, 0, 0];
}

// Put one hand on a target in the frontal plane (reaching sideways).
function reachSideways(pose, side, hipsY, target) {
  const sh = shoulderAt(hipsY, 0, side);
  const arm = solveArmZ(target[0] - sh.x, target[1] - sh.y);
  pose[JU + side] = [0, 0, arm.upper];
  pose[JF + side] = [0, 0, arm.fore];
  pose[JH + side] = [0, 0, 0];
}

const smooth = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

// Greeting. The base is the Idle pose at the same time, so the first and last
// frames are exactly Idle: the clip can be played once and blended away.
function wavePose(t) {
  const { duration } = CLIP_INFO.Wave;
  const pose = idlePose(t);
  const raise = smooth(t / 0.35) * (1 - smooth((t - (duration - 0.4)) / 0.4));
  if (raise <= 0) return pose;
  const w = TAU * (t - 0.35) / 0.5;                      // three waves inside the held phase
  const sh = shoulderAt(pose.hipsY, 0, 'R');
  const target = [-(0.4 + 0.09 * Math.sin(w)), sh.y + 0.2 + 0.03 * Math.cos(w), 0];
  const arm = solveArmZ(target[0] - sh.x, target[1] - sh.y);
  pose.J_upperArm_R = mix(pose.J_upperArm_R, [0, 0, arm.upper], raise);
  pose.J_foreArm_R = mix(pose.J_foreArm_R, [0, 0, arm.fore], raise);
  pose.J_neck = mix(pose.J_neck, [-0.02, -0.06, 0], raise);
  pose.J_head = mix(pose.J_head, [0.03, -0.08, 0], raise);
  return pose;
}

function handholdIdlePose(side) {
  const sign = side === 'L' ? 1 : -1;
  return t => {
    const { duration } = CLIP_INFO.HandholdIdle_L, w = TAU * t / duration;
    const pose = idlePose(t);
    pose.J_spine = [0.02 + 0.01 * Math.sin(w), sign * 0.05, 0];       // turned a little towards the partner
    pose.J_neck = [-0.01, sign * 0.06 + 0.02 * Math.sin(w), 0];
    pose.J_head = [0.015 * Math.sin(2 * w), sign * 0.05, 0];
    reachSideways(pose, side, pose.hipsY, [sign * HOLD_PROFILE.partnerGap / 2, HOLD_PROFILE.joinHeight + 0.006 * Math.sin(w), 0]);
    return pose;
  };
}

function handholdWalkPose(side) {
  const sign = side === 'L' ? 1 : -1;
  return t => {
    const pose = walkPose(t);
    const w = TAU * ((t / CLIP_INFO.HandholdWalk_L.duration) % 1);
    pose.J_spine = [0.06, sign * 0.04 + 0.06 * Math.cos(w), -0.015 * Math.cos(w)];
    pose.J_neck = [-0.02, sign * 0.04 - 0.04 * Math.cos(w), 0];
    // The held hand stays on the join point; the free arm keeps its Walk swing.
    reachSideways(pose, side, pose.hipsY, [sign * HOLD_PROFILE.partnerGap / 2, HOLD_PROFILE.joinHeight, 0]);
    return pose;
  };
}

// Standing on a ridable object. Following the 2D renderer, riding changes the
// arms, the lean and the knee flex - never the stride: the object rolls.
function ridePose(kind, clipName, moving) {
  const profile = RIDE_PROFILES[kind];
  return t => {
    const { duration } = CLIP_INFO[clipName], w = TAU * t / duration;
    const ankleY = profile.standHeight + D.ankleHeight;
    const flex = moving ? 0.035 + 0.02 * Math.sin(w) : 0.02 + 0.008 * Math.sin(w);
    const hipsY = profile.standHeight + D.hipsHeight - 0.05 - flex;
    const spineX = (moving ? 0.2 : 0.1) + 0.02 * Math.sin(w);
    const pose = { hipsY };
    pose.J_hips = [0, 0, 0];
    pose.J_spine = [spineX, (moving ? 0.05 : 0.02) * Math.sin(w), (moving ? -0.03 : -0.012) * Math.cos(w)];
    pose.J_neck = [-spineX * 0.7, 0.02 * Math.sin(w), 0];
    pose.J_head = [-0.02, 0.03 * Math.sin(w), 0];
    legPose(pose, 'L', hipsY, profile.frontFootZ, ankleY);
    legPose(pose, 'R', hipsY, profile.backFootZ, ankleY);
    if (profile.grip) {
      for (const [side, sign] of [['L', 1], ['R', -1]]) {
        reachForward(pose, side, hipsY, spineX, [sign * 0.2, profile.grip[1], profile.grip[2]]);
      }
    } else {
      for (const [side, sign] of [['L', 1], ['R', -1]]) {
        pose[JU + side] = [-0.25 + (moving ? 0.18 : 0.06) * Math.sin(w) * sign, 0, sign * (0.34 + 0.05 * Math.sin(w))];
        pose[JF + side] = [-0.34 - 0.06 * Math.sin(w) * sign, 0, 0];
        pose[JH + side] = [0, 0, 0];
      }
    }
    return pose;
  };
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
  return [
    bake(THREE, CLIP_INFO.Idle, idlePose),
    bake(THREE, CLIP_INFO.Walk, walkPose),
    bake(THREE, CLIP_INFO.CarryIdle, carryIdlePose),
    bake(THREE, CLIP_INFO.CarryWalk, carryWalkPose),
    bake(THREE, CLIP_INFO.SeatedIdle, seatedPose),
    bake(THREE, CLIP_INFO.Wave, wavePose),
    bake(THREE, CLIP_INFO.HandholdIdle_L, handholdIdlePose('L')),
    bake(THREE, CLIP_INFO.HandholdIdle_R, handholdIdlePose('R')),
    bake(THREE, CLIP_INFO.HandholdWalk_L, handholdWalkPose('L')),
    bake(THREE, CLIP_INFO.HandholdWalk_R, handholdWalkPose('R')),
    bake(THREE, CLIP_INFO.ScooterIdle, ridePose('scooter', 'ScooterIdle', false)),
    bake(THREE, CLIP_INFO.ScooterRide, ridePose('scooter', 'ScooterRide', true)),
    bake(THREE, CLIP_INFO.SkateboardIdle, ridePose('skateboard', 'SkateboardIdle', false)),
    bake(THREE, CLIP_INFO.SkateboardRide, ridePose('skateboard', 'SkateboardRide', true))
  ];
}
