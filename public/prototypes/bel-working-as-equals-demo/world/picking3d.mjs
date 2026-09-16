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
    pick(clientX, clientY, interactiveObjects) {
      if (!canvas || !camera || !interactiveObjects || interactiveObjects.length === 0) {
        return null;
      }

      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;

      // Normalise device coordinates to [-1, 1]
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      const intersects = raycaster.intersectObjects(interactiveObjects, true);

      if (intersects.length === 0) return null;

      // Find first intersection with a registered target
      for (const hit of intersects) {
        let curr = hit.object;
        while (curr) {
          if (curr.userData && curr.userData.belTargetId) {
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
