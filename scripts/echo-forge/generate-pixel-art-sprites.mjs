// @ts-check
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SRC_DIR = path.join(ROOT, 'assets/echo-forge/v1/src');

/**
 * Converts a 32x32 ASCII character grid + palette into an SVG containing pixel rects.
 * @param {string[]} rows - 32 strings, each 32 characters long
 * @param {Record<string, string>} palette - map from character to hex color
 * @param {number} size - total canvas size (e.g. 256)
 * @param {number} pixelSize - size of each pixel (e.g. 8)
 * @returns {string} SVG xml
 */
function gridToSvg(rows, palette, size = 256, pixelSize = 8) {
  const rects = [];
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const char = row[x];
      if (char === '.' || char === ' ' || !palette[char]) continue;
      const color = palette[char];
      rects.push(`<rect x="${x * pixelSize}" y="${y * pixelSize}" width="${pixelSize}" height="${pixelSize}" fill="${color}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">\n  ${rects.join('\n  ')}\n</svg>\n`;
}

// ---------------------------------------------------------------------------
// 1. HERO SPRITE (Resonant): 32x32 pixel art warrior with spiky hair, cyan blade
// ---------------------------------------------------------------------------
const HERO_PALETTE = {
  // Outlines
  'K': '#090d16', // Darkest outline
  'k': '#151d2f', // Secondary outline
  
  // Hair & Highlights
  'W': '#ffffff', // Pure white shine
  'H': '#e2e8f0', // Light silver hair
  'h': '#94a3b8', // Mid silver hair
  'd': '#64748b', // Dark hair shadow
  
  // Skin
  'F': '#ffedd5', // Fair skin highlight
  'S': '#fed7aa', // Skin base
  's': '#fba359', // Skin shadow
  'E': '#38bdf8', // Eye cyan
  
  // Coat & Armor
  'A': '#334155', // Slate armor highlight
  'a': '#1e293b', // Navy coat main
  'D': '#0f172a', // Deep shadow coat
  
  // Resonant Cyan Glow & Trim
  'C': '#67e8f9', // Bright neon cyan
  'c': '#06b6d4', // Mid cyan
  'B': '#0284c7', // Deep resonant cyan
  'b': '#e0f2fe', // Electric cyan-white
  
  // Gold Resonance Core & Belt
  'G': '#fde047', // Gold highlight
  'g': '#eab308', // Gold main
  'J': '#a16207', // Gold shadow
  
  // Metal & Weapon
  'M': '#cbd5e1', // Metal shine
  'm': '#94a3b8', // Steel
  'L': '#475569', // Dark steel
};

const HERO_GRID = [
  "................................", // 0
  "...........KKKKKK...............", // 1
  ".........KKHHHHHhKK.............", // 2
  "........KKWHHHHHHhdK............", // 3
  ".......KWHHHHHHHHhhdK...........", // 4
  ".......KWHHhKKKKKhhdK...........", // 5
  ".......KWHhKFFFFKhhdK...........", // 6
  "........KhKFSESFKhdK............", // 7
  "........KhKFSESFKhK.............", // 8
  ".........KKFssssFKK.............", // 9
  "..........KKssssKK..............", // 10
  "........KKaaaaaaKK..............", // 11
  ".......KaaccGGccaaK.............", // 12
  "......KaaacCggCcaaaK...bb.......", // 13
  ".....KaaDacCggCcaDaaK.bCb.......", // 14
  "....KaDaDaacJJcaaaDaKbCb........", // 15
  "....KaDaDaaCggCaaaDaKbCb........", // 16
  "....KaDaDaakkkkaaaDaKbCb........", // 17
  ".....KaaDaKssssKaaDaKbCb........", // 18
  ".....KDaDaKssssKaDaDKbCb........", // 19
  "......KDaKaaaaaaKaDK.bCb........", // 20
  "......KDaKaaDDaaKaDK.bCb........", // 21
  ".......KKKaaDDaaKKK..bCb........", // 22
  "........KaaccCccaK...bCb........", // 23
  "........KaaaDaaaK....bCb........", // 24
  "........KaDaKKaDaK...bCb........", // 25
  ".......KaDaK..KaDaK..bCb........", // 26
  ".......KaDaK..KaDaK...Kb........", // 27
  ".......KaDaK..KaDaK...KK........", // 28
  "......KaaDaK..KaaDaK............", // 29
  "......KccccK..KccccK............", // 30
  "......KKKKKK..KKKKKK............", // 31
];

// ---------------------------------------------------------------------------
// 2. ENEMY SPRITE (Echo Sentinel): 32x32 ancient floating sonic golem
// ---------------------------------------------------------------------------
const ENEMY_PALETTE = {
  // Outlines
  'K': '#0a0414', // Deepest obsidian outline
  'k': '#1e0a38', // Secondary purple outline
  
  // Plating / Armor
  'P': '#7c3aed', // Luminous violet plate
  'p': '#5b21b6', // Deep purple armor
  'd': '#3b0764', // Dark shadow plate
  'V': '#a78bfa', // Bright violet edge
  'v': '#c4b5fd', // Violet highlight
  'W': '#ffffff', // Pure white rune shine
  
  // Core Eye & Energy Visor
  'G': '#fde047', // Glowing yellow eye
  'g': '#f59e0b', // Amber core
  'O': '#b45309', // Dark amber eye border
  'o': '#ffffff', // Pupil white hot
  
  // Dark Interior Chassis
  'A': '#2e1065', // Dark chassis
  'a': '#17052e', // Deep cavity
  
  // Sonic Float Energy / Glyphs
  'C': '#e9d5ff', // Neon lavender float aura
  'c': '#8b5cf6', // Resonant purple aura
};

const ENEMY_GRID = [
  "..............KK................", // 0
  ".............KvvK...............", // 1
  "............KvVVvK..............", // 2
  "...........KvVPpPvK.............", // 3
  "..........KvVPdddPvK............", // 4
  ".........KvvPddddPvvK...........", // 5
  "........KvVPddddddPvVK..........", // 6
  ".......KvVPdaAAaAdPvVK..........", // 7
  "......KvvPdaAGGAadPvvK..........", // 8
  "......KvPddaGooGaddPvK..........", // 9
  "...KK.KvPddaGooGaddPvK.KK.......", // 10
  "..KvPKKvPddaGOOGaddPvKKvPK......", // 11
  ".KvVPPKvPddaaaaaaddPvKPVPvK.....", // 12
  ".KvvPPddPddaccaddddPPddPvK......", // 13
  ".KvVPdddaaaaaaaaaaaddddPvK......", // 14
  ".KvVPdddaacGGcaaaaaddddPvK......", // 15
  "..KvvPddaacGGcaaaaddddPvvK......", // 16
  "...KvPdddaaccadddaadddPvK.......", // 17
  "....KvPddaaaaaaaaaddddPvK.......", // 18
  "....KvVPdddaaaaaddddPvVK........", // 19
  ".....KvVPdddaaddddPvVK..........", // 20
  "......KvvPddddddPvvK............", // 21
  ".......KvVPddddPvVK.............", // 22
  "........KvVPddPvVK..............", // 23
  ".........KvVPdPvK...............", // 24
  "..........KvVVPK................", // 25
  "...........KvvK.................", // 26
  "............KK..................", // 27
  "...........cCCca................", // 28
  "..........ccCCCcc...............", // 29
  "...........ccccc................", // 30
  "................................", // 31
];

// Write out the new SVGs
const heroSvg = gridToSvg(HERO_GRID, HERO_PALETTE);
const enemySvg = gridToSvg(ENEMY_GRID, ENEMY_PALETTE);

fs.writeFileSync(path.join(SRC_DIR, 'ef-hero-idle.svg'), heroSvg, 'utf8');
fs.writeFileSync(path.join(SRC_DIR, 'ef-enemy-idle.svg'), enemySvg, 'utf8');

console.log('Successfully generated authentic 16-bit pixel art SVGs for Hero and Enemy.');
