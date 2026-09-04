// Echo Forge character rigs — V5.
// Heroic proportions with clear material hierarchy:
//   dark undersuit (sub) → cyan armor plates (arm) → gold accents (gold) → glowing core
// Bigger head for game readability, armored boots, energy blade weapon.

import { S, C, B, O } from './pixel-renderer.mjs';

// ---------------------------------------------------------------- hero

export function heroRig(o = {}) {
  const lean = o.lean ?? 0;
  const drop = o.drop ?? 0;
  const lElb = o.lElb ?? [-5.0, 1.6, 0.8];
  const lHnd = o.lHnd ?? [-4.8, -1.4, 1.6];
  const rElb = o.rElb ?? [5.0, 1.6, 0.8];
  const rHnd = o.rHnd ?? [4.8, -1.4, 1.6];
  const capeZ = o.capeZ ?? -2.6;
  const capeRot = o.capeRot ?? 0;
  const lFx = o.lFx ?? -2.0;
  const rFx = o.rFx ?? 2.0;
  const lFy = o.lFy ?? 0;
  const rFy = o.rFy ?? 0;
  const eyeMat = o.eyeMat ?? 'vis';
  const weapon = o.weapon ?? false;
  const wTip = o.wTip ?? [12, 6, 4.5];
  const L = lean;
  const D = drop;

  const prims = [
    // === LEGS (dark undersuit + armored boots) ===
    // upper legs — dark undersuit
    C(-1.3, -1.6 - D, 0, lFx, -5.2 + lFy, 0.2, 1.25, 'sub'),
    C(1.3, -1.6 - D, 0, rFx, -5.2 + rFy, 0.2, 1.25, 'sub'),
    // lower legs — armored greaves
    C(lFx, -5.2 + lFy, 0.2, lFx, -8.8 + lFy, 0.4, 1.2, 'leg'),
    C(rFx, -5.2 + rFy, 0.2, rFx, -8.8 + rFy, 0.4, 1.2, 'leg'),
    // knee guards
    { ...S(lFx, -5.2 + lFy, 1.2, 0.8, 'gold'), sharp: true },
    { ...S(rFx, -5.2 + rFy, 1.2, 0.8, 'gold'), sharp: true },
    // boots — chunky, armored
    { ...B(lFx, -9.8 + lFy, 0.4, 1.5, 1.1, 2.2, 0.5, 'arm'), sharp: true },
    { ...B(rFx, -9.8 + rFy, 0.4, 1.5, 1.1, 2.2, 0.5, 'arm'), sharp: true },

    // === TORSO (dark undersuit core + armor plates) ===
    // hip/waist — narrow, dark
    S(L * 0.3, -1.4 - D, 0, 2.0, 'sub'),
    // belt
    { ...C(L * 0.3 - 2.4, -1.4 - D, 1.6, L * 0.3 + 2.4, -1.4 - D, 1.6, 0.4, 'gold'), sharp: true },
    // mid torso — transitional
    S(L * 0.5, 1.0 - D, 0, 2.3, 'sub'),
    // chest plate — the main armor piece, wider
    S(L * 0.7, 3.4 - D, 0.4, 2.9, 'arm'),
    // upper chest / collar
    S(L * 0.8, 5.2 - D, 0, 2.3, 'arm'),

    // chest core — resonance crystal, prominent
    { ...S(L * 0.7, 3.6 - D, 2.8, 1.1, 'core'), sharp: true },

    // === SHOULDERS (big pauldrons for silhouette) ===
    S(L - 4.4, 5.6 - D, 0, 2.1, 'arm'),
    S(L + 4.4, 5.6 - D, 0, 2.1, 'arm'),
    // gold shoulder trim
    { ...C(L - 4.4, 6.4 - D, 1.4, L - 4.4, 6.4 - D, 1.8, 1.5, 'gold'), sharp: true },
    { ...C(L + 4.4, 6.4 - D, 1.4, L + 4.4, 6.4 - D, 1.8, 1.5, 'gold'), sharp: true },

    // === ARMS (dark undersuit + armored forearms) ===
    // upper arms — dark
    C(L - 4.4, 5.2 - D, 0, lElb[0], lElb[1] - D, lElb[2], 1.05, 'sub'),
    C(L + 4.4, 5.2 - D, 0, rElb[0], rElb[1] - D, rElb[2], 1.05, 'sub'),
    // forearms — armored
    C(lElb[0], lElb[1] - D, lElb[2], lHnd[0], lHnd[1] - D, lHnd[2], 0.95, 'arm'),
    C(rElb[0], rElb[1] - D, rElb[2], rHnd[0], rHnd[1] - D, rHnd[2], 0.95, 'arm'),
    // gauntlets
    S(lHnd[0], lHnd[1] - D, lHnd[2], 1.1, 'trim'),
    S(rHnd[0], rHnd[1] - D, rHnd[2], 1.1, 'trim'),

    // === CAPE / MANTLE ===
    { ...B(L * 0.5, 4.0 - D, capeZ, 3.8, 2.8, 0.5, 0.6, 'cape', capeRot), sharp: true },

    // === HEAD (bigger for game readability) ===
    // neck — dark
    C(L * 0.8, 6.4 - D, 0, L * 0.8, 7.6 - D, 0, 0.85, 'sub'),
    // helmet base — larger
    { ...S(L * 0.8, 9.0 - D, 0.3, 2.7, 'arm'), sharp: true },
    // helmet crown
    { ...S(L * 0.8, 9.8 - D, -0.4, 2.9, 'arm'), sharp: true },
    // face plate — darker inset
    { ...S(L * 0.8, 8.6 - D, 1.8, 1.6, 'sub'), sharp: true },
    // visor — wide, bright, the character's eyes
    { ...B(L * 0.8, 8.6 - D, 2.6, 1.8, 0.4, 0.5, 0.08, eyeMat), sharp: true },
    // gold chin guard
    { ...B(L * 0.8, 7.6 - D, 2.0, 1.2, 0.3, 0.6, 0.12, 'gold'), sharp: true },
    // crest — tall mohawk style, two-tone
    { ...B(L * 0.8, 11.6 - D, -0.8, 0.35, 2.0, 2.4, 0.1, 'trim', -0.14), sharp: true },
    { ...B(L * 0.8, 12.8 - D, -1.6, 0.22, 1.0, 1.8, 0.06, 'gold', -0.10), sharp: true },
  ];

  // energy blade — thick enough to read at 64px
  if (weapon) {
    const hx = rHnd[0], hy = rHnd[1] - D, hz = rHnd[2];
    // hilt
    prims.push({ ...C(hx, hy, hz, hx * 0.85, hy * 0.85, hz * 0.85, 0.5, 'gold'), sharp: true });
    // blade — two layers for glow
    prims.push(
      { ...C(hx, hy, hz, wTip[0], wTip[1], wTip[2], 0.55, 'trim'), sharp: true },
      { ...C(hx * 0.95 + wTip[0] * 0.05, hy * 0.95 + wTip[1] * 0.05, hz * 0.95 + wTip[2] * 0.05,
             wTip[0] * 0.95, wTip[1] * 0.95, wTip[2] * 0.95, 0.35, 'vis'), sharp: true },
    );
  }

  return prims;
}

export const HERO_POSES = {
  idle: {},
  windup: {
    lean: -1.4, drop: 1.8, capeRot: 0.24, capeZ: -3.2,
    lElb: [-5.6, 1.0, -1.6], lHnd: [-6.0, -1.6, -3.2],
    rElb: [3.4, 3.2, -1.6], rHnd: [2.8, 6.2, -3.4],
    lFx: -3.2, rFx: 2.2, lFy: 0.6,
    weapon: true, wTip: [1.4, 10.0, -4.5],
  },
  strike: {
    lean: 2.2, drop: 0.4, capeRot: -0.42, capeZ: -4.2,
    lElb: [-5.0, 0.8, -2.0], lHnd: [-4.8, -2.4, -3.0],
    rElb: [6.6, 4.2, 2.6], rHnd: [9.8, 5.0, 4.2],
    lFx: -3.8, rFx: 3.2, lFy: 0.8,
    weapon: true, wTip: [15, 7.0, 5.8],
  },
  hit: {
    lean: -2.2, drop: 1.2, capeRot: 0.44, capeZ: -1.8,
    lElb: [-6.2, 3.2, 2.0], lHnd: [-7.4, 0.8, 3.2],
    rElb: [5.4, 3.2, 2.0], rHnd: [6.6, 0.8, 3.2],
    lFx: -3.4, rFx: 1.0, eyeMat: 'rose',
  },
  victory: {
    lean: 0, drop: -1.2, capeRot: 0, capeZ: -3.0,
    lElb: [-5.4, 6.0, 0.8], lHnd: [-5.8, 9.6, 1.2],
    rElb: [5.4, 6.0, 0.8], rHnd: [5.8, 9.6, 1.2],
    lFx: -2.4, rFx: 2.4,
    weapon: true, wTip: [5.8, 14.0, 2.0],
  },
};

export const HERO_ORDER = ['idle', 'windup', 'strike', 'hit', 'victory'];

export const HERO_RENDER_OPTS = {
  ext: 14.5, yaw: 0.55, smooth: 0.30,
  shadowY: -11.5, shadowX: 0, shadowRX: 6.2, shadowRY: 1.5,
};

// ---------------------------------------------------------------- warden

export function wardenRig(state) {
  const core = state === 'hit' ? 'rose' : 'core';

  if (state === 'telegraph') {
    return [
      O(0, 1.2, -1.0, 7.8, 'vio'),
      O(0, 1.2, -5.0, 3.8, 'viod'),
      S(0, 1.2, 7.0, 2.8, core),
      O(0, 10.2, 0, 3.2, 'vio'), O(0, -8.4, 0, 3.4, 'vio'),
      O(-10.0, 3.8, 1.2, 2.4, 'vio'), O(10.2, 3.8, 1.2, 2.2, 'vio'),
      O(-8.8, -4.2, 0.6, 1.7, 'vio'), O(9.0, -3.8, 0.6, 1.9, 'vio'),
      O(-5.4, 8.8, 0.8, 1.4, 'vio'), O(5.8, 8.4, 0.8, 1.6, 'vio'),
      { ...C(-2.0, 1.2, 5.0, 2.0, 1.2, 5.0, 1.0, 'vis'), sharp: true },
    ];
  }

  if (state === 'hit') {
    return [
      O(1.0, 1.0, -1.0, 6.8, 'vio'),
      O(1.0, 1.0, -4.6, 3.0, 'viod'),
      S(1.0, 1.0, 5.8, 2.2, core),
      O(1.8, 8.4, 0, 2.4, 'vio'), O(0.2, -7.2, 0, 2.7, 'vio'),
      { ...B(-2.8, 1.4, 6.0, 0.28, 5.0, 1.3, 0.02, 'crack', 0.34), sharp: true },
      { ...B(3.6, 0.4, 5.8, 0.28, 3.8, 1.3, 0.02, 'crack', -0.48), sharp: true },
      { ...B(0.6, -2.8, 5.8, 3.0, 0.24, 1.3, 0.02, 'crack', 0.18), sharp: true },
      O(-9.4, 4.8, 1.0, 1.6, 'vio'), O(9.6, 2.4, 1.0, 1.8, 'vio'),
      O(-8.0, -5.2, 0.5, 1.2, 'vio'),
    ];
  }

  if (state === 'broken') {
    return [
      O(-3.2, 3.0, 0, 3.4, 'viod'), O(3.8, 0.8, -0.4, 2.6, 'viod'),
      O(-1.4, -4.2, 0.4, 2.4, 'viod'), O(3.2, 5.2, 0.6, 1.9, 'viod'),
      S(-0.8, 1.2, 3.2, 1.0, 'core'),
      O(-9.2, 5.8, 0.8, 1.7, 'vio'), O(8.8, 4.0, 0.5, 1.3, 'vio'),
      O(-7.2, -6.0, 0.3, 1.4, 'vio'), O(7.8, -5.2, 0.3, 1.6, 'vio'),
      O(1.0, -9.2, 0, 1.8, 'viod'), O(-4.6, -7.8, 0.4, 1.1, 'vio'),
      O(6.0, 8.4, 0.2, 1.2, 'vio'), O(-3.8, 9.0, 0.2, 1.5, 'vio'),
      { ...S(-2.0, -10.0, 1.0, 0.5, 'vis'), sharp: true },
      { ...S(3.0, -9.5, 0.8, 0.4, 'vis'), sharp: true },
    ];
  }

  return [
    O(0, 1.0, -1.0, 7.0, 'vio'),
    O(0, 1.0, -4.6, 3.2, 'viod'),
    S(0, 1.0, 6.0, 2.3, core),
    O(0, 9.0, 0, 2.8, 'vio'), O(0, -7.4, 0, 3.0, 'vio'),
    O(-9.2, 3.0, 1.0, 2.0, 'vio'), O(9.2, 3.0, 1.0, 1.7, 'vio'),
    O(-7.8, -3.8, 0.5, 1.3, 'vio'), O(7.8, -3.8, 0.5, 1.5, 'vio'),
    { ...O(0, 1.0, 2.0, 3.5, 'viod'), sharp: true },
  ];
}

export const WARDEN_ORDER = ['idle', 'telegraph', 'hit', 'broken'];

export const WARDEN_RENDER_OPTS = { ext: 14, yaw: 0.12, smooth: 0 };

export const WARDEN_TINTS = [
  { id: 'hollow', name: 'The Hollow Vowel', overrides: null },
  {
    id: 'stress', name: 'The Broken Stress',
    overrides: {
      vio: ['#3a1000', '#5e1c06', '#882c0e', '#b84418', '#e86428', '#f89048'],
      viod: ['#200800', '#3e1204', '#601e0a', '#883014', '#b04820', '#d86838'],
    },
  },
  {
    id: 'severed', name: 'The Severed Chain',
    overrides: {
      vio: ['#380808', '#5c1010', '#881818', '#b42828', '#e04040', '#f07070'],
      viod: ['#200404', '#400c0c', '#681414', '#901e1e', '#b83030', '#e05050'],
    },
  },
];
