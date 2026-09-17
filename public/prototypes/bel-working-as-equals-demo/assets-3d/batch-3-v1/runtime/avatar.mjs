// Reusable articulated participant avatar — block-built (BEL-ART-01).
// Every form is a chamfered cuboid: a squared head with a readable face,
// stepped hair masses, a shirt-shaped torso with shoulder yoke and hem, and
// rectangular limb segments with visible joints. The rig, clips, units and
// appearance semantics are unchanged from batch-0-v1; the geometry, its
// surface detail and two accessory socket positions were revised.
//
// Existing options only: shirt default/teal/cream/amber/red, hat
// none/straw/cap, glasses on/off.
import { ACTORS, DEFAULT_APPEARANCE, resolveAppearance } from './identity.mjs';
import { ACTOR_PALETTES, PALETTE, SHIRT_TINTS, SURFACE, sharedMaterial, standard } from './materials.mjs';
import { CARRY_PROFILES, JOINTS, SOCKETS, RIG_DIMENSIONS } from './avatar-rig.mjs';
import { CLIP_INFO, buildAvatarClips } from './avatar-clips.mjs';
import { block, countTriangles, localBounds, mergeGeometries, tint } from './geometry.mjs';

// Head-local frame (J_head): the head cuboid is centred at (0, HEAD.y, 0).
const HEAD = Object.freeze({ w: 0.34, h: 0.36, d: 0.32, y: 0.2 });
const FACE_Z = HEAD.d / 2;            // front plane of the head
const HAIR_TOP = HEAD.y + HEAD.h / 2; // 0.38

// Base looks read from the cast sprites; see README "Avatar source mapping".
const ACTOR_STYLE = Object.freeze({
  p0: Object.freeze({ build: 'male', sleeves: 'long', hair: 'short', ears: true, undershirt: true }),
  p1: Object.freeze({ build: 'female', sleeves: 'short', hair: 'ponytail', ears: false, undershirt: false }),
  p2: Object.freeze({ build: 'female', sleeves: 'long', hair: 'shoulder', ears: false, undershirt: false }),
  p3: Object.freeze({ build: 'female', sleeves: 'short', hair: 'long', ears: false, undershirt: false })
});

const at = (x, y, z) => ({ position: [x, y, z] });

// ---- hair: a few stepped masses, never strands ----
function hairGeometry(THREE, style) {
  const parts = [block(THREE, HEAD.w + 0.02, 0.05, HEAD.d + 0.02, at(0, HAIR_TOP + 0.025, 0))];
  if (style === 'short') {
    parts.push(block(THREE, 0.3, 0.045, 0.26, at(0, HAIR_TOP + 0.072, 0.03)));   // stepped quiff
    parts.push(block(THREE, HEAD.w + 0.02, 0.2, 0.05, at(0, 0.28, -(HEAD.d / 2 + 0.005))));
    for (const x of [-1, 1]) parts.push(block(THREE, 0.035, 0.17, 0.26, at(x * (HEAD.w / 2 + 0.005), 0.29, -0.03)));
  } else {
    parts.push(block(THREE, HEAD.w - 0.02, 0.04, HEAD.d - 0.04, at(0, HAIR_TOP + 0.068, 0)));     // stepped crown
    parts.push(block(THREE, HEAD.w + 0.03, 0.06, 0.05, at(0, HAIR_TOP - 0.025, FACE_Z - 0.005))); // fringe step
    for (const x of [-1, 1]) parts.push(block(THREE, 0.04, 0.24, 0.3, at(x * (HEAD.w / 2 + 0.01), 0.26, -0.02)));
  }
  if (style === 'ponytail') {
    parts.push(block(THREE, HEAD.w + 0.02, 0.26, 0.055, at(0, 0.27, -(HEAD.d / 2 + 0.008))));
    parts.push(block(THREE, 0.15, 0.15, 0.13, at(0, 0.3, -0.27)));               // stacked tail
    parts.push(block(THREE, 0.125, 0.15, 0.11, at(0, 0.18, -0.31)));
    parts.push(block(THREE, 0.095, 0.12, 0.09, at(0, 0.07, -0.325)));
  } else if (style === 'shoulder' || style === 'long') {
    const bottom = style === 'long' ? -0.12 : -0.06, height = 0.44 + (style === 'long' ? 0.06 : 0);
    parts.push(block(THREE, HEAD.w + 0.03, height, 0.06, at(0, bottom + height / 2, -(HEAD.d / 2 + 0.01))));
    for (const x of [-1, 1]) parts.push(block(THREE, 0.05, height * 0.72, 0.14, at(x * (HEAD.w / 2 + 0.015), bottom + height * 0.45, -0.07)));
  } else {
    parts.push(block(THREE, HEAD.w + 0.02, 0.22, 0.05, at(0, 0.26, -(HEAD.d / 2 + 0.008))));
  }
  return mergeGeometries(THREE, parts);
}

const browGeometry = THREE => mergeGeometries(THREE, [-0.075, 0.075].map(x => block(THREE, 0.085, 0.022, 0.016, at(x, 0.3, FACE_Z + 0.002), 0.004)));
const eyeGeometry = THREE => mergeGeometries(THREE, [-0.075, 0.075].map(x => block(THREE, 0.05, 0.06, 0.016, at(x, 0.235, FACE_Z + 0.002), 0.004)));

// ---- accessories: stepped blocks on the documented sockets ----
const strawHatGeometry = THREE => mergeGeometries(THREE, [
  block(THREE, 0.56, 0.045, 0.56, at(0, 0, 0)),          // brim
  block(THREE, 0.44, 0.03, 0.44, at(0, 0.035, 0)),       // stepped brim inner
  block(THREE, 0.38, 0.13, 0.36, at(0, 0.115, 0))        // crown
]);
const strawBandGeometry = THREE => block(THREE, 0.395, 0.04, 0.375, at(0, 0.058, 0));
const capGeometry = THREE => mergeGeometries(THREE, [
  block(THREE, 0.38, 0.13, 0.36, at(0, 0.08, 0)),
  block(THREE, 0.07, 0.035, 0.07, at(0, 0.16, 0))        // button
]);
const capBrimGeometry = THREE => block(THREE, 0.34, 0.035, 0.17, at(0, 0.02, 0.25));

function glassesFrameGeometry(THREE) {
  const parts = [], bar = 0.014, w = 0.092, h = 0.078;
  for (const x of [-0.075, 0.075]) {
    parts.push(block(THREE, w, bar, bar, at(x, h / 2, 0), 0.004));
    parts.push(block(THREE, w, bar, bar, at(x, -h / 2, 0), 0.004));
    parts.push(block(THREE, bar, h, bar, at(x - Math.sign(x) * w / 2, 0, 0), 0.004));
    parts.push(block(THREE, bar, h, bar, at(x + Math.sign(x) * w / 2, 0, 0), 0.004));
    parts.push(block(THREE, bar, bar, 0.2, at(Math.sign(x) * 0.152, 0.02, -0.1), 0.004));  // temple
  }
  parts.push(block(THREE, 0.06, bar, bar, at(0, 0, 0), 0.004));                            // bridge
  return mergeGeometries(THREE, parts);
}
const glassesLensGeometry = THREE => mergeGeometries(THREE, [-0.075, 0.075].map(x => block(THREE, 0.08, 0.066, 0.008, at(x, 0, -0.001), 0.003)));

const shoeGeometry = THREE => mergeGeometries(THREE, [
  tint(THREE, block(THREE, 0.155, 0.075, 0.2, at(0, -0.0025, 0.035)), 1),
  tint(THREE, block(THREE, 0.168, 0.026, 0.222, at(0, -0.052, 0.035)), 0.72)   // darker sole
]);

// ---- factory ----
export function createAvatar(THREE, scope, { variant = {}, assetId, packVersion }) {
  const actor = variant.actor;
  if (!ACTORS.includes(actor)) throw new RangeError(`avatar variant.actor must be one of ${ACTORS.join(', ')}.`);
  const style = ACTOR_STYLE[actor], colors = ACTOR_PALETTES[actor];
  const torsoW = style.build === 'male' ? 0.4 : 0.36;
  const geo = (key, build) => scope.shared(`geometry:avatar:${key}`, build);
  const mat = (name, hex, surface) => sharedMaterial(THREE, scope, name, hex, surface);

  const root = new THREE.Group();
  root.name = `avatar_${actor}`;
  root.userData.belAsset = { assetId, variant: { actor }, packVersion };

  const joints = {};
  for (const [name, parent, position, euler] of JOINTS) {
    const joint = new THREE.Object3D();
    joint.name = name;
    joint.position.set(...position);
    joint.rotation.set(...euler);
    (parent ? joints[parent] : root).add(joint);
    joints[name] = joint;
  }
  const sockets = {};
  for (const [name, parent, position] of SOCKETS) {
    const socket = new THREE.Object3D();
    socket.name = name;
    socket.position.set(...position);
    joints[parent].add(socket);
    sockets[name] = socket;
  }

  // Mutable, per-instance clothing slot (never shared between actors).
  const shirt = scope.own(standard(THREE, `shirt_${actor}`, colors.shirt, SURFACE.cloth));
  const skin = mat('skin', PALETTE.skin, SURFACE.skin);
  const pants = mat(`pants_${actor}`, colors.pants, SURFACE.denim);
  const shoes = mat(`shoes_${actor}`, colors.shoes, { ...SURFACE.leather, vertexColors: true });
  const hair = mat(`hair_${actor}`, colors.hair, SURFACE.hair);

  const meshes = [];
  const add = (parent, name, geometry, material, { shadow = true } = {}) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = shadow;
    parent.add(mesh);
    meshes.push(mesh);
    return mesh;
  };

  add(joints.J_hips, 'M_pelvis', geo('pelvis', () => block(THREE, 0.3, 0.17, 0.22, at(0, -0.005, 0))), pants);
  // Torso: main volume + shoulder yoke + hem + collar, so the construction reads.
  add(joints.J_spine, 'M_torso', geo(`torso:${style.build}`, () => mergeGeometries(THREE, [
    block(THREE, torsoW, 0.36, 0.24, at(0, 0.13, 0)),
    block(THREE, torsoW + 0.04, 0.09, 0.26, at(0, 0.3, 0)),
    block(THREE, torsoW + 0.03, 0.105, 0.27, at(0, -0.0675, 0)), // hem: hangs past the hip joint so the thigh tops never show
    block(THREE, 0.17, 0.035, 0.19, at(0, 0.355, 0))
  ])), shirt);
  if (style.undershirt) {
    add(joints.J_spine, 'M_undershirt', geo('undershirt', () => block(THREE, 0.09, 0.28, 0.03, at(0, 0.15, 0.12))),
      mat(`undershirt_${actor}`, colors.undershirt, SURFACE.cloth));
  }
  add(joints.J_neck, 'M_neck', geo('neck', () => block(THREE, 0.13, 0.07, 0.13, at(0, 0.025, 0))), skin);
  add(joints.J_head, 'M_head', geo('head', () => mergeGeometries(THREE, [
    block(THREE, HEAD.w, HEAD.h, HEAD.d, at(0, HEAD.y, 0)),
    block(THREE, 0.05, 0.05, 0.035, at(0, 0.195, FACE_Z + 0.008))            // nose block
  ])), skin);
  add(joints.J_head, 'M_eyes', geo('eyes', () => eyeGeometry(THREE)), mat('eye', PALETTE.eye, SURFACE.skin), { shadow: false });
  add(joints.J_head, 'M_mouth', geo('mouth', () => block(THREE, 0.06, 0.022, 0.016, at(0, 0.14, FACE_Z + 0.002), 0.004)),
    mat('mouth', PALETTE.mouth, SURFACE.skin), { shadow: false });
  add(joints.J_head, 'M_brows', geo('brows', () => browGeometry(THREE)), hair, { shadow: false });
  if (style.ears) {
    add(joints.J_head, 'M_ears', geo('ears', () => mergeGeometries(THREE, [-1, 1].map(x =>
      block(THREE, 0.025, 0.085, 0.07, at(x * (HEAD.w / 2 + 0.005), 0.2, -0.01))))), skin);
  }
  add(joints.J_head, 'M_hair', geo(`hair:${style.hair}`, () => hairGeometry(THREE, style.hair)), hair);
  if (colors.hairTie) {
    add(joints.J_head, 'M_hairTie', geo('hairTie', () => block(THREE, 0.17, 0.055, 0.15, at(0, 0.38, -0.23))), mat('hairTie', colors.hairTie, SURFACE.cloth));
  }

  for (const side of ['L', 'R']) {
    if (style.sleeves === 'long') {
      add(joints[`J_upperArm_${side}`], `M_upperArm_${side}`, geo('upperArm:sleeve', () => block(THREE, 0.105, 0.23, 0.125, at(0, -0.1, 0))), shirt);
      add(joints[`J_foreArm_${side}`], `M_foreArm_${side}`, geo('foreArm:long', () => mergeGeometries(THREE, [
        block(THREE, 0.095, 0.21, 0.115, at(0, -0.09, 0)),
        block(THREE, 0.11, 0.04, 0.13, at(0, -0.175, 0))                      // cuff step
      ])), shirt);
    } else {
      add(joints[`J_upperArm_${side}`], `M_upperArm_${side}`, geo('upperArm:bare', () => block(THREE, 0.095, 0.23, 0.11, at(0, -0.1, 0))), skin);
      add(joints[`J_upperArm_${side}`], `M_sleeve_${side}`, geo('upperArm:shortSleeve', () => block(THREE, 0.135, 0.11, 0.155, at(0, -0.04, 0))), shirt);
      add(joints[`J_foreArm_${side}`], `M_foreArm_${side}`, geo('foreArm:short', () => block(THREE, 0.09, 0.21, 0.105, at(0, -0.09, 0))), skin);
    }
    add(joints[`J_hand_${side}`], `M_hand_${side}`, geo('hand', () => block(THREE, 0.105, 0.1, 0.105, at(0, -0.05, 0.005))), skin);
    add(joints[`J_thigh_${side}`], `M_thigh_${side}`, geo('thigh', () => block(THREE, 0.15, 0.31, 0.17, at(0, -0.145, 0))), pants);
    add(joints[`J_shin_${side}`], `M_shin_${side}`, geo('shin', () => mergeGeometries(THREE, [
      block(THREE, 0.135, 0.29, 0.155, at(0, -0.135, 0)),
      block(THREE, 0.152, 0.05, 0.172, at(0, -0.01, 0))                        // knee step
    ])), pants);
    add(joints[`J_foot_${side}`], `M_shoe_${side}`, geo('shoe', () => shoeGeometry(THREE)), shoes);
  }

  // Accessories: separate objects, toggled by visibility.
  const straw = new THREE.Group(); straw.name = 'A_hat_straw'; sockets.socket_hat.add(straw);
  add(straw, 'M_hat_straw', geo('hat:straw', () => strawHatGeometry(THREE)), mat('straw', PALETTE.straw, SURFACE.straw));
  add(straw, 'M_hat_strawBand', geo('hat:strawBand', () => strawBandGeometry(THREE)), mat('strawBand', PALETTE.strawBand, SURFACE.cloth));
  const cap = new THREE.Group(); cap.name = 'A_hat_cap'; sockets.socket_hat.add(cap);
  add(cap, 'M_hat_cap', geo('hat:cap', () => capGeometry(THREE)), mat('cap', PALETTE.cap, SURFACE.cloth));
  add(cap, 'M_hat_capBrim', geo('hat:capBrim', () => capBrimGeometry(THREE)), mat('capBrim', PALETTE.capBrim, SURFACE.cloth));
  const glasses = new THREE.Group(); glasses.name = 'A_glasses'; sockets.socket_glasses.add(glasses);
  add(glasses, 'M_glasses_frame', geo('glasses:frame', () => glassesFrameGeometry(THREE)), mat('glassesFrame', PALETTE.glassesFrame, SURFACE.frame));
  add(glasses, 'M_glasses_lens', geo('glasses:lens', () => glassesLensGeometry(THREE)), mat('glassesLens', PALETTE.glassesLens, SURFACE.lens), { shadow: false });

  let appearance = null;
  function applyAppearance(input = DEFAULT_APPEARANCE) {
    if (scope.disposed) throw new Error('applyAppearance called on a disposed avatar.');
    appearance = resolveAppearance(input);
    shirt.color.set(appearance.shirt === 'default' ? colors.shirt : SHIRT_TINTS[appearance.shirt]);
    straw.visible = appearance.hat === 'straw';
    cap.visible = appearance.hat === 'cap';
    glasses.visible = appearance.glasses;
    return { ...appearance };
  }

  // Bounds/triangles: bind pose without accessories, then the worst case.
  applyAppearance({ hat: 'none', glasses: false });
  const bounds = localBounds(THREE, root);
  const trianglesBase = countTriangles(root);
  const accessoryTriangles = o => countTriangles(o, { visibleOnly: false });
  const trianglesMax = trianglesBase + accessoryTriangles(glasses) + Math.max(accessoryTriangles(straw), accessoryTriangles(cap));
  applyAppearance({ hat: 'straw', glasses: true });
  const boundsWithStraw = localBounds(THREE, root);
  applyAppearance(variant.appearance || DEFAULT_APPEARANCE);

  const clips = scope.shared('clips:avatar:v1', () => buildAvatarClips(THREE));

  return {
    root, clips, sockets, joints, bounds, applyAppearance,
    get appearance() { return appearance && { ...appearance }; },
    metadata: {
      kind: 'articulated-rigid-hierarchy (block-built)',
      artDirection: 'BEL-ART-01 v1.0 — cuboid forms with a 0.012 chamfer, stepped hair and accessory masses',
      actor, style: { ...style },
      dimensions: { ...RIG_DIMENSIONS, head: { ...HEAD }, measuredHeight: bounds.size[1] },
      boundsWithAccessories: boundsWithStraw,
      triangles: { base: trianglesBase, allAccessories: trianglesMax },
      meshes: meshes.length,
      joints: JOINTS.map(([name, parent]) => ({ name, parent })),
      sockets: SOCKETS.map(([name, parent, position, purpose]) => ({ name, parent, position, purpose })),
      clips: Object.values(CLIP_INFO),
      carryProfiles: CARRY_PROFILES,
      materialSlots: { mutablePerInstance: ['shirt'], sharedReadOnly: ['skin', 'hair', 'pants', 'shoes', 'eye', 'mouth', 'undershirt', 'hairTie', 'straw', 'strawBand', 'cap', 'capBrim', 'glassesFrame', 'glassesLens'] },
      accessories: { hat: { straw: 'A_hat_straw', cap: 'A_hat_cap' }, glasses: 'A_glasses' }
    }
  };
}
