// Target picking and raycasting for 3D view (Phase 05 / P05.3)
// Intersects pointer rays against interactive 3D meshes and maps back to stable target IDs.
// Host proximity checks (<= 48 px) and Keyboard F selection semantics remain authoritative.

import { worldToLogical } from './coordinates3d.mjs';

/**
 * Creates a target picker given a Three.js camera and canvas.
 */
export function createTargetPicker(THREE, camera, canvas) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  return {
    pick(arg1, arg2, arg3) {
      let interactiveObjects;
      let x, y, width, height;

      if (typeof arg1 === 'object' && arg1 !== null) {
        interactiveObjects = arg2;
        const rect = canvas?.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: 1000, height: 480 };
        width = arg1.width || rect.width || 1000;
        height = arg1.height || rect.height || 480;

        if (arg1.offsetX !== undefined && arg1.offsetY !== undefined) {
          x = arg1.offsetX;
          y = arg1.offsetY;
        } else if (arg1.clientX !== undefined && arg1.clientY !== undefined) {
          x = arg1.clientX - (rect.left || 0);
          y = arg1.clientY - (rect.top || 0);
        } else if (arg1.x !== undefined && arg1.y !== undefined) {
          x = arg1.x;
          y = arg1.y;
          width = 1000;
          height = 480;
        }
      } else {
        interactiveObjects = arg3;
        const rect = canvas?.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: 1000, height: 480 };
        width = rect.width || 1000;
        height = rect.height || 480;
        x = arg1 - (rect.left || 0);
        y = arg2 - (rect.top || 0);
      }

      if (!canvas || !camera || !interactiveObjects || interactiveObjects.length === 0) {
        return null;
      }
      if (width === 0 || height === 0 || x === undefined || y === undefined) return null;

      // Normalise device coordinates to [-1, 1]: (x / width) * 2 - 1, -(y / height) * 2 + 1
      pointer.x = (x / width) * 2 - 1;
      pointer.y = -(y / height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      const intersects = raycaster.intersectObjects(interactiveObjects, true);

      if (intersects.length === 0) return null;

      // Find first intersection with a registered target
      for (const hit of intersects) {
        let curr = hit.object;
        let isVisible = true;
        let p = curr;
        while (p) {
          if (p.visible === false) { isVisible = false; break; }
          p = p.parent;
        }
        if (!isVisible) continue;

        while (curr) {
          if (curr.userData && typeof curr.userData.belTargetId === 'string') {
            const logicalPos = worldToLogical(hit.point.x, hit.point.z);
            return {
              targetId: curr.userData.belTargetId,
              targetType: curr.userData.belTargetType || 'object',
              point: logicalPos,
              distance3D: hit.distance
            };
          }
          curr = curr.parent;
        }
      }

      return null;
    }
  };
}
