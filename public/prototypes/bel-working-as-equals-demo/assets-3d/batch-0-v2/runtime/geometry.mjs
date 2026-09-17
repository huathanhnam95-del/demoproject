// Small geometry helpers shared by the factories. Pure functions of THREE and
// their numeric inputs; nothing is cached here.

// Apply a position / Euler rotation / scale to a geometry in place.
export function transformed(THREE, geometry, { position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale));
  geometry.applyMatrix4(m);
  return geometry;
}

// Merge geometries (indexed or not) into one non-indexed geometry with
// position/normal/uv, and with color when any part carries vertex colours
// (parts without colours default to white, so tinted and untinted blocks can
// be merged into one mesh). Inputs are disposed; the result is new.
export function mergeGeometries(THREE, geometries) {
  const parts = geometries.map(g => {
    const flat = g.index ? g.toNonIndexed() : g;
    if (flat !== g) g.dispose();
    if (!flat.getAttribute('normal')) flat.computeVertexNormals();
    return flat;
  });
  const withColor = parts.some(g => g.getAttribute('color'));
  const count = parts.reduce((n, g) => n + g.getAttribute('position').count, 0);
  const position = new Float32Array(count * 3), normal = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  const color = withColor ? new Float32Array(count * 3).fill(1) : null;
  let offset = 0;
  for (const g of parts) {
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), t = g.getAttribute('uv'), c = g.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
      const o = offset + i;
      position[o * 3] = p.getX(i); position[o * 3 + 1] = p.getY(i); position[o * 3 + 2] = p.getZ(i);
      normal[o * 3] = n.getX(i); normal[o * 3 + 1] = n.getY(i); normal[o * 3 + 2] = n.getZ(i);
      if (t) { uv[o * 2] = t.getX(i); uv[o * 2 + 1] = t.getY(i); }
      if (c) { color[o * 3] = c.getX(i); color[o * 3 + 1] = c.getY(i); color[o * 3 + 2] = c.getZ(i); }
    }
    offset += p.count;
    g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (color) merged.setAttribute('color', new THREE.BufferAttribute(color, 3));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

export function roundedRectShape(THREE, width, height, radius, cx = 0, cy = 0) {
  const w = width / 2, h = height / 2, r = Math.min(radius, w, h);
  const x0 = cx - w, x1 = cx + w, y0 = cy - h, y1 = cy + h;
  const s = new THREE.Shape();
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0); s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - r); s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1); s.quadraticCurveTo(x0, y1, x0, y1 - r);
  s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

export function polygonShape(THREE, points) {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
}

// Visible triangle count of a hierarchy (for metadata and budgets).
export function countTriangles(root, { visibleOnly = true } = {}) {
  let triangles = 0;
  root.traverse(o => {
    if (!o.isMesh || (visibleOnly && !isShown(o))) return;
    const g = o.geometry;
    triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return triangles;
}

function isShown(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

// Bounds of visible meshes in the root's local space (root assumed at identity
// in its own frame; construction never parents the root).
export function localBounds(THREE, root) {
  root.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const box = new THREE.Box3(), tmp = new THREE.Box3(), m = new THREE.Matrix4();
  root.traverse(o => {
    if (!o.isMesh || !isShown(o)) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    tmp.copy(o.geometry.boundingBox).applyMatrix4(m.multiplyMatrices(inverse, o.matrixWorld));
    box.union(tmp);
  });
  const size = box.getSize(new THREE.Vector3());
  const round = v => v.toArray().map(n => Math.round(n * 10000) / 10000);
  return { min: round(box.min), max: round(box.max), size: round(size) };
}

// ---- block-built geometry (BEL-ART-01) ----
// Every visible form is a cuboid with a tiny chamfer: block silhouettes that
// still catch light on their edges. No spheres, capsules or lathes.
export const BEVEL = 0.012;

export function block(THREE, w, h, d, place = {}, bevel = BEVEL) {
  // The chamfer is proportional on small parts, so detail blocks stay crisp
  // instead of reading as rounded pebbles.
  const b = Math.min(bevel, 0.1 * Math.min(w, h, d));
  const shape = roundedRectShape(THREE, w - 2 * b, h - 2 * b, Math.max(b, 1e-4));
  const g = new THREE.ExtrudeGeometry(shape, { depth: d - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: 1, steps: 1 });
  g.translate(0, 0, -(d / 2 - b));
  g.computeVertexNormals();
  return transformed(THREE, g, place);
}

// Uniform vertex tint so merged parts can share one material and still read as
// separate boards/panels.
export function tint(THREE, geometry, factor) {
  const count = geometry.getAttribute('position').count, colors = new Float32Array(count * 3).fill(factor);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

// Pixel mask -> merged blocks. rows are strings; any non-space character is a
// filled cell. Consecutive filled cells in a row become one block, so the
// stepped silhouette is identical with far fewer triangles. Used for the plank
// marks, where a circle must still read as a circle.
export function maskBlocks(THREE, rows, cellSize, thickness) {
  const h = rows.length, w = Math.max(...rows.map(r => r.length)), parts = [];
  const push = (x0, x1, z) => parts.push(block(THREE, (x1 - x0 + 1) * cellSize, thickness, cellSize,
    { position: [((x0 + x1) / 2 - (w - 1) / 2) * cellSize, 0, (z - (h - 1) / 2) * cellSize] }, cellSize * 0.12));
  for (let z = 0; z < h; z++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const filled = x < w && (rows[z][x] ?? ' ') !== ' ';
      if (filled && start < 0) start = x;
      if (!filled && start >= 0) { push(start, x - 1, z); start = -1; }
    }
  }
  return mergeGeometries(THREE, parts);
}
