// Reversible logical-to-3D coordinate transformation (Phase 05 / P05.2)
// Authoritative simulation operates in 1000 x 480 2D space.
// 3D coordinate system: +Y up, +Z toward viewer (larger logical y), +X right (larger logical x).
// Scale s = 0.02 (1 world unit = 50 logical px).

export const SCALE = 0.02;
export const LOGICAL_WIDTH = 1000;
export const LOGICAL_HEIGHT = 480;
export const ORIGIN_X = 500;
export const ORIGIN_Y = 240;

/**
 * Transforms logical 2D coordinate (x, y) to 3D world space (X, Y, Z).
 */
export function logicalToWorld(x, y, visualHeight = 0) {
  return {
    x: (x - ORIGIN_X) * SCALE,
    y: visualHeight,
    z: (y - ORIGIN_Y) * SCALE
  };
}

/**
 * Transforms 3D world space (X, Z) back to logical 2D coordinate (x, y).
 * Reversible within < 0.01 px tolerance.
 */
export function worldToLogical(wx, wz) {
  return {
    x: Math.round(wx / SCALE + ORIGIN_X),
    y: Math.round(wz / SCALE + ORIGIN_Y)
  };
}

/**
 * Transforms a 2D bounding box { x, y, w, h } to a 3D box { min, max, center, size }.
 */
export function logicalBoxToWorld(box, visualHeight = 0, visualDepth = 0.5) {
  const min = logicalToWorld(box.x, box.y + box.h, visualHeight);
  const max = logicalToWorld(box.x + box.w, box.y, visualHeight + visualDepth);
  return {
    min: { x: min.x, y: visualHeight, z: logicalToWorld(box.x, box.y).z },
    max: { x: max.x, y: visualHeight + visualDepth, z: min.z },
    center: logicalToWorld(box.x + box.w / 2, box.y + box.h / 2, visualHeight + visualDepth / 2),
    size: { x: box.w * SCALE, y: visualDepth, z: box.h * SCALE }
  };
}

/**
 * Scales a logical distance in pixels to 3D world units.
 */
export function logicalDistanceToWorld(px) {
  return px * SCALE;
}

/**
 * Scales a 3D world distance to logical pixels.
 */
export function worldDistanceToLogical(units) {
  return units / SCALE;
}
