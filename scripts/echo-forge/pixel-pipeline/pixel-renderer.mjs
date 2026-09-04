// Echo Forge volumetric pixel sprite renderer (pure, no DOM).
// Builds characters from 3D SDF primitives, lights them, quantises to tone ramps.

import zlib from 'node:zlib';

// ---------------------------------------------------------------- palette

export const RAMPS = {
  arm:  ['#072838', '#0a4d68', '#0c7da6', '#14b8d4', '#6de4f8', '#b8f2fc'],
  sub:  ['#060a12', '#0e1726', '#172338', '#243550', '#354d6c', '#4a6a8e'],
  trim: ['#0a5870', '#0d88a8', '#14c4e4', '#4dd8f0', '#8aeaf7', '#d0f7fc'],
  cape: ['#04161e', '#073848', '#0a5e78', '#0e84a6', '#14a8cc', '#20cce8'],
  core: ['#6b2f04', '#a14508', '#e88a10', '#f5b020', '#fcd34d', '#fef3c7'],
  vis:  ['#0878a0', '#10b8d4', '#40d4ec', '#7ee6f5', '#b4f1fa', '#e4fbfe'],
  vio:  ['#160840', '#2c1470', '#4420a0', '#6636d0', '#8b5cf6', '#bca4fc'],
  viod: ['#0e0520', '#1e0c4a', '#341878', '#4c24a8', '#6d36d4', '#9468f0'],
  rose: ['#3e0414', '#7a0e2c', '#c01840', '#e84068', '#f88098', '#fcc4d0'],
  crack: ['#060210', '#080316', '#0a041c', '#0e0624', '#12082c', '#180c38'],
  leg:  ['#081018', '#101e30', '#1c3450', '#2a4e74', '#3c6c9c', '#5090c4'],
  gold: ['#4a2800', '#7c4400', '#b86800', '#e89000', '#f8b830', '#fcd878'],
};

export const EMISSIVE = new Set(['core', 'vis']);

const hex2rgb = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

export function buildRamps(overrides) {
  const out = {};
  for (const key of Object.keys(RAMPS)) {
    out[key] = (overrides?.[key] ?? RAMPS[key]).map(hex2rgb);
  }
  return out;
}

export const BASE_RAMPS = buildRamps(null);

// ---------------------------------------------------------------- primitives

export const S = (cx, cy, cz, r, m) => ({ t: 0, cx, cy, cz, r, m });
export const C = (ax, ay, az, bx, by, bz, r, m) => ({ t: 1, ax, ay, az, bx, by, bz, r, m });
export const B = (cx, cy, cz, bx, by, bz, rr, m, rot = 0) => ({ t: 2, cx, cy, cz, bx, by, bz, r: rr, m, rot });
export const O = (cx, cy, cz, s, m) => ({ t: 3, cx, cy, cz, s, m });

// ---------------------------------------------------------------- SDFs

function sphereD(px, py, pz, cx, cy, cz, r) {
  const dx = px - cx, dy = py - cy, dz = pz - cz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

function capsuleD(px, py, pz, ax, ay, az, bx, by, bz, r) {
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const bb = bax * bax + bay * bay + baz * baz;
  let h = bb > 0 ? (pax * bax + pay * bay + paz * baz) / bb : 0;
  h = h < 0 ? 0 : h > 1 ? 1 : h;
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

function boxD(px, py, pz, cx, cy, cz, bx, by, bz, rr) {
  const qx = Math.abs(px - cx) - bx;
  const qy = Math.abs(py - cy) - by;
  const qz = Math.abs(pz - cz) - bz;
  const mx = qx > 0 ? qx : 0, my = qy > 0 ? qy : 0, mz = qz > 0 ? qz : 0;
  const outside = Math.sqrt(mx * mx + my * my + mz * mz);
  const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0);
  return outside + inside - rr;
}

function octaD(px, py, pz, cx, cy, cz, s) {
  return (Math.abs(px - cx) + Math.abs(py - cy) + Math.abs(pz - cz) - s) * 0.57735027;
}

let hitMaterial = null;

function smin(a, b, k) {
  if (k <= 0) return a < b ? a : b;
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b * (1 - h) + a * h - k * h * (1 - h);
}

let yawCos = 1;
let yawSin = 0;
let blend = 0;

export function setSceneTransform({ yaw = 0, smooth = 0 } = {}) {
  yawCos = Math.cos(yaw);
  yawSin = Math.sin(yaw);
  blend = smooth;
}

function mapScene(prims, wx, wy, wz) {
  const px = wx * yawCos - wz * yawSin;
  const pz = wx * yawSin + wz * yawCos;
  const py = wy;

  let hard = 1e9;
  let soft = 1e9;
  let mat = null;

  for (let i = 0; i < prims.length; i += 1) {
    const p = prims[i];
    let d;
    if (p.t === 0) {
      d = sphereD(px, py, pz, p.cx, p.cy, p.cz, p.r);
    } else if (p.t === 1) {
      d = capsuleD(px, py, pz, p.ax, p.ay, p.az, p.bx, p.by, p.bz, p.r);
    } else if (p.t === 2) {
      let x = px, y = py;
      if (p.rot) {
        const ox = px - p.cx, oy = py - p.cy;
        const ca = Math.cos(p.rot), sa = Math.sin(p.rot);
        x = ox * ca + oy * sa + p.cx;
        y = -ox * sa + oy * ca + p.cy;
      }
      d = boxD(x, y, pz, p.cx, p.cy, p.cz, p.bx, p.by, p.bz, p.r);
    } else {
      d = octaD(px, py, pz, p.cx, p.cy, p.cz, p.s);
    }

    if (d < hard) { hard = d; mat = p.m; }
    soft = i === 0 ? d : smin(soft, d, p.sharp ? 0 : blend);
  }

  hitMaterial = mat;
  return soft;
}

// ---------------------------------------------------------------- renderer

const KEY_LIGHT = (() => {
  const [x, y, z] = [-0.48, 0.72, 0.62];
  const l = Math.sqrt(x * x + y * y + z * z);
  return [x / l, y / l, z / l];
})();

const FILL_LIGHT = (() => {
  const [x, y, z] = [0.6, 0.2, 0.5];
  const l = Math.sqrt(x * x + y * y + z * z);
  return [x / l, y / l, z / l];
})();

export function renderSprite(prims, size, opts = {}) {
  const ext = opts.ext ?? 13;
  const ramps = opts.ramps ?? BASE_RAMPS;
  const { shadowY, shadowX = 0, shadowRX = 5.2, shadowRY = 1.3 } = opts;
  setSceneTransform({ yaw: opts.yaw ?? 0, smooth: opts.smooth ?? 0 });

  const rgba = new Uint8Array(size * size * 4);
  const mask = new Uint8Array(size * size);
  const depth = new Float32Array(size * size);
  const step = (2 * ext) / size;

  for (let py = 0; py < size; py += 1) {
    const wy = ext - (py + 0.5) * step;
    for (let px = 0; px < size; px += 1) {
      const wx = -ext + (px + 0.5) * step;
      const o = (py * size + px) * 4;

      let t = 0;
      let hit = false;
      let hz = 0;
      for (let s = 0; s < 52; s += 1) {
        const z = 24 - t;
        const d = mapScene(prims, wx, wy, z);
        if (d < 0.018) { hit = true; hz = z; break; }
        t += d > 0.05 ? d : 0.05;
        if (t > 48) break;
      }

      if (!hit) {
        if (shadowY !== undefined) {
          const ux = (wx - shadowX) / shadowRX;
          const uy = (wy - shadowY) / shadowRY;
          const q = ux * ux + uy * uy;
          if (q < 1) {
            const a = (1 - q) * (1 - q) * 160;
            rgba[o] = 2; rgba[o + 1] = 4; rgba[o + 2] = 10; rgba[o + 3] = a;
          }
        }
        continue;
      }

      const mat = hitMaterial;
      depth[py * size + px] = hz;
      const e = 0.025;
      let nx = mapScene(prims, wx + e, wy, hz) - mapScene(prims, wx - e, wy, hz);
      let ny = mapScene(prims, wx, wy + e, hz) - mapScene(prims, wx, wy - e, hz);
      let nz = mapScene(prims, wx, wy, hz + e) - mapScene(prims, wx, wy, hz - e);
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;

      const ramp = ramps[mat] ?? ramps.sub;
      let k;
      if (EMISSIVE.has(mat)) {
        // 3-step emissive falloff for better sphere read
        k = nz > 0.65 ? ramp.length - 1
          : nz > 0.3 ? ramp.length - 2
          : ramp.length - 3;
      } else {
        const keyDiff = Math.max(0, nx * KEY_LIGHT[0] + ny * KEY_LIGHT[1] + nz * KEY_LIGHT[2]);
        const fillDiff = Math.max(0, nx * FILL_LIGHT[0] + ny * FILL_LIGHT[1] + nz * FILL_LIGHT[2]);
        const rim = Math.pow(1 - Math.max(0, nz), 3.5);
        // Specular highlight on the key light
        const hx = KEY_LIGHT[0], hy = KEY_LIGHT[1], hz2 = KEY_LIGHT[2] + 1;
        const hl = Math.sqrt(hx * hx + hy * hy + hz2 * hz2) || 1;
        const spec = Math.pow(Math.max(0, (nx * hx + ny * hy + nz * hz2) / hl), 24);
        const lum = 0.08 + keyDiff * 0.62 + fillDiff * 0.18 + rim * 0.36 + spec * 0.30;
        k = Math.min(ramp.length - 1, Math.max(0, Math.floor(lum * ramp.length)));
      }
      const c = ramp[k];
      rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
      mask[py * size + px] = 1;
    }
  }

  // 1px contour outline
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (mask[y * size + x]) continue;
      const near =
        (x > 0 && mask[y * size + x - 1]) ||
        (x < size - 1 && mask[y * size + x + 1]) ||
        (y > 0 && mask[(y - 1) * size + x]) ||
        (y < size - 1 && mask[(y + 1) * size + x]);
      if (!near) continue;
      const o = (y * size + x) * 4;
      rgba[o] = 3; rgba[o + 1] = 6; rgba[o + 2] = 14; rgba[o + 3] = 255;
    }
  }

  // Ambient occlusion pass: darken pixels whose 4-neighbors are all filled
  // and whose average depth is higher (recessed)
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      if (!mask[y * size + x]) continue;
      const idx = y * size + x;
      const nCount =
        (mask[idx - 1] ? 1 : 0) + (mask[idx + 1] ? 1 : 0) +
        (mask[idx - size] ? 1 : 0) + (mask[idx + size] ? 1 : 0);
      if (nCount < 4) continue;
      const avgD = (depth[idx - 1] + depth[idx + 1] + depth[idx - size] + depth[idx + size]) / 4;
      if (depth[idx] < avgD - 0.12) {
        const o = idx * 4;
        rgba[o] = Math.max(0, rgba[o] - 12);
        rgba[o + 1] = Math.max(0, rgba[o + 1] - 12);
        rgba[o + 2] = Math.max(0, rgba[o + 2] - 12);
      }
    }
  }

  return { size, rgba };
}

// ---------------------------------------------------------------- PNG output

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

export function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function upscale({ size, rgba }, factor) {
  const out = new Uint8Array(size * factor * size * factor * 4);
  const w = size * factor;
  for (let y = 0; y < w; y += 1) {
    const sy = (y / factor) | 0;
    for (let x = 0; x < w; x += 1) {
      const sx = (x / factor) | 0;
      const s = (sy * size + sx) * 4;
      const d = (y * w + x) * 4;
      out[d] = rgba[s]; out[d + 1] = rgba[s + 1];
      out[d + 2] = rgba[s + 2]; out[d + 3] = rgba[s + 3];
    }
  }
  return { size: w, rgba: out };
}

export function contactSheet(cells, { cols, cell, pad = 12, bg = [12, 18, 32], labels }) {
  const rows = Math.ceil(cells.length / cols);
  const labelH = labels ? 18 : 0;
  const w = cols * (cell + pad) + pad;
  const h = rows * (cell + pad + labelH) + pad;
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    out[i * 4] = bg[0]; out[i * 4 + 1] = bg[1]; out[i * 4 + 2] = bg[2]; out[i * 4 + 3] = 255;
  }
  cells.forEach((sprite, i) => {
    const cx = pad + (i % cols) * (cell + pad);
    const cy = pad + Math.floor(i / cols) * (cell + pad + labelH);
    for (let y = 0; y < sprite.size; y += 1) {
      for (let x = 0; x < sprite.size; x += 1) {
        const s = (y * sprite.size + x) * 4;
        const a = sprite.rgba[s + 3] / 255;
        if (a === 0) continue;
        const d = ((cy + y) * w + (cx + x)) * 4;
        out[d] = Math.round(out[d] * (1 - a) + sprite.rgba[s] * a);
        out[d + 1] = Math.round(out[d + 1] * (1 - a) + sprite.rgba[s + 1] * a);
        out[d + 2] = Math.round(out[d + 2] * (1 - a) + sprite.rgba[s + 2] * a);
      }
    }
  });
  return { width: w, height: h, rgba: out };
}
