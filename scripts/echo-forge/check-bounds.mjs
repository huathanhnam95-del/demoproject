import fs from 'node:fs';
import path from 'node:path';
import { renderSprite, upscale, encodePng } from './pixel-pipeline/pixel-renderer.mjs';
import { heroRig, HERO_POSES, HERO_RENDER_OPTS, wardenRig, WARDEN_RENDER_OPTS } from './pixel-pipeline/sprite-rigs.mjs';

const heroSprite = upscale(renderSprite(heroRig(HERO_POSES.idle), 96, HERO_RENDER_OPTS), 2);
const wardenSprite = upscale(renderSprite(wardenRig('idle'), 96, WARDEN_RENDER_OPTS), 2);

console.log('Hero 96x2 sprite size:', heroSprite.size);
console.log('Warden 96x2 sprite size:', wardenSprite.size);

// Find bounding box of non-transparent pixels
function findBounds(sprite) {
  let minX = sprite.size, maxX = 0, minY = sprite.size, maxY = 0;
  for (let y = 0; y < sprite.size; y++) {
    for (let x = 0; x < sprite.size; x++) {
      const idx = (y * sprite.size + x) * 4;
      if (sprite.rgba[idx + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, maxX, minY, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

console.log('Hero bounds:', findBounds(heroSprite));
console.log('Warden bounds:', findBounds(wardenSprite));
