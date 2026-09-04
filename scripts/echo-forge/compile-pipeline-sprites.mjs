// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { renderSprite, upscale } from './pixel-pipeline/pixel-renderer.mjs';
import {
  heroRig, HERO_POSES, HERO_RENDER_OPTS,
  wardenRig, WARDEN_RENDER_OPTS,
} from './pixel-pipeline/sprite-rigs.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SRC_DIR = path.join(ROOT, 'assets/echo-forge/v1/src');

/**
 * Converts an upscaled sprite into an SVG on a target canvas with integer rect runs.
 * @param {{ size: number, rgba: Uint8Array }} sprite
 * @param {number} canvasW
 * @param {number} canvasH
 * @param {number} offsetX
 * @param {number} offsetY
 * @returns {string} SVG xml
 */
function spriteToSvg(sprite, canvasW = 256, canvasH = 256, offsetX = 0, offsetY = 0) {
  const rects = [];
  const { size, rgba } = sprite;

  // We can step pixel by pixel and merge horizontal runs of identical colors
  for (let y = 0; y < size; y++) {
    const targetY = offsetY + y;
    if (targetY < 0 || targetY >= canvasH) continue;

    let runStart = -1;
    let runColor = '';

    for (let x = 0; x < size; x++) {
      const targetX = offsetX + x;
      if (targetX < 0 || targetX >= canvasW) continue;

      const idx = (y * size + x) * 4;
      const a = rgba[idx + 3];

      let color = '';
      if (a > 10) {
        // Quantize alpha to full or thresholded
        const r = rgba[idx];
        const g = rgba[idx + 1];
        const b = rgba[idx + 2];
        color = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
      }

      if (color === runColor) {
        // Continue current run
      } else {
        if (runColor && runStart >= 0) {
          const runLength = targetX - runStart;
          rects.push(`<rect x="${runStart}" y="${targetY}" width="${runLength}" height="1" fill="${runColor}"/>`);
        }
        runStart = targetX;
        runColor = color;
      }
    }

    if (runColor && runStart >= 0) {
      const runLength = (offsetX + size) - runStart;
      rects.push(`<rect x="${runStart}" y="${targetY}" width="${runLength}" height="1" fill="${runColor}"/>`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">\n  ${rects.join('\n  ')}\n</svg>\n`;
}

// 1. Render Hero idle at 96, upscaled 2x to 192px
const heroSprite = upscale(renderSprite(heroRig(HERO_POSES.idle), 96, HERO_RENDER_OPTS), 2);
// Hero bounds: width 84, height 180, maxY 181. We want maxY ~ 224.
// offsetX = 128 - 97 = 31, offsetY = 224 - 181 = 43.
const heroSvg = spriteToSvg(heroSprite, 256, 256, 31, 43);
fs.writeFileSync(path.join(SRC_DIR, 'ef-hero-idle.svg'), heroSvg, 'utf8');
console.log('Compiled ef-hero-idle.svg from 3D-rigged pixel pipeline.');

// 2. Render Warden idle at 96, upscaled 2x to 192px
const wardenSprite = upscale(renderSprite(wardenRig('idle'), 96, WARDEN_RENDER_OPTS), 2);
// Warden bounds: width 154, height 154, center ~ 94.5 x 90.5. Center on 128, 128.
// offsetX = 128 - 95 = 33, offsetY = 128 - 91 = 37.
const wardenSvg = spriteToSvg(wardenSprite, 256, 256, 33, 37);
fs.writeFileSync(path.join(SRC_DIR, 'ef-enemy-idle.svg'), wardenSvg, 'utf8');
console.log('Compiled ef-enemy-idle.svg from 3D-rigged pixel pipeline.');
