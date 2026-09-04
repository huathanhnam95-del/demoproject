import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderSprite, upscale, contactSheet, encodePng, buildRamps, BASE_RAMPS,
} from './pixel-renderer.mjs';
import {
  heroRig, HERO_POSES, HERO_ORDER, HERO_RENDER_OPTS,
  wardenRig, WARDEN_ORDER, WARDEN_TINTS, WARDEN_RENDER_OPTS,
} from './sprite-rigs.mjs';

const OUT = path.dirname(fileURLToPath(import.meta.url));
const started = Date.now();

function sheet(name, cells, cols, cell) {
  const { width, height, rgba } = contactSheet(cells, { cols, cell });
  fs.writeFileSync(path.join(OUT, name), encodePng(width, height, rgba));
  console.log(`${name}  ${width}x${height}`);
}

// --- hero poses at 96, upscaled 2x for 192px display ---
const hero96 = HERO_ORDER.map((pose) =>
  upscale(renderSprite(heroRig(HERO_POSES[pose]), 96, HERO_RENDER_OPTS), 2));
sheet('sheet-hero-96.png', hero96, 5, 192);

// --- hero poses at 64, upscaled 3x for 192px display ---
const hero64 = HERO_ORDER.map((pose) =>
  upscale(renderSprite(heroRig(HERO_POSES[pose]), 64, HERO_RENDER_OPTS), 3));
sheet('sheet-hero-64.png', hero64, 5, 192);

// --- hero idle at three grid sizes, normalised to same display ---
const grids = [
  upscale(renderSprite(heroRig(HERO_POSES.idle), 48, HERO_RENDER_OPTS), 4),
  upscale(renderSprite(heroRig(HERO_POSES.idle), 64, HERO_RENDER_OPTS), 3),
  upscale(renderSprite(heroRig(HERO_POSES.idle), 96, HERO_RENDER_OPTS), 2),
];
sheet('sheet-hero-grids.png', grids, 3, 192);

// --- warden states at 96 ---
const warden96 = WARDEN_ORDER.map((state) =>
  upscale(renderSprite(wardenRig(state), 96, WARDEN_RENDER_OPTS), 2));
sheet('sheet-warden-96.png', warden96, 4, 192);

// --- warden tints ---
const tints = WARDEN_TINTS.map((t) =>
  upscale(renderSprite(wardenRig('idle'), 96, {
    ...WARDEN_RENDER_OPTS,
    ramps: t.overrides ? buildRamps(t.overrides) : BASE_RAMPS,
  }), 2));
sheet('sheet-warden-tints.png', tints, 3, 192);

// --- single hero idle at 96, upscaled 4x for close inspection ---
const heroClose = upscale(renderSprite(heroRig(HERO_POSES.idle), 96, HERO_RENDER_OPTS), 4);
fs.writeFileSync(
  path.join(OUT, 'hero-closeup.png'),
  encodePng(heroClose.size, heroClose.size, heroClose.rgba),
);
console.log(`hero-closeup.png  ${heroClose.size}x${heroClose.size}`);

console.log(`done in ${Date.now() - started}ms`);
