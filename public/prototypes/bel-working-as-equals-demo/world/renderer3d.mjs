// Three.js WebGL 3D Renderer for BEL Working as Equals (Phase 05 / P05.1)
// Integrates Claude Batch 0-v2 block-built avatar, timber planks, and room foundations.
// Conforms to BEL-ART-01 v1.0 and Master Plan Renderer Contract (§4.2).

import * as THREE from '../assets-3d/batch-0-v2/vendor/three.module.js';
import { createAsset } from '../assets-3d/batch-0-v2/runtime/index.mjs';
import { logicalToWorld, worldToLogical, SCALE } from './coordinates3d.mjs';
import { createTargetPicker } from './picking3d.mjs';
import { SCENES } from './scenes.mjs';

export async function createRenderer3D(canvas, { onFault } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  } catch (err) {
    if (typeof onFault === 'function') onFault(err);
    throw err;
  }

  // Handle WebGL context loss
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    if (typeof onFault === 'function') {
      onFault(new Error('WebGL context lost'));
    }
  }, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#efe7d9');

  // Isometric-style perspective camera
  const camera = new THREE.PerspectiveCamera(40, 1000 / 480, 0.1, 120);
  camera.position.set(0, 15, 18);
  camera.lookAt(0, 0, 1.5);

  // BEL-ART-01 Lighting passes (L0 neutral, L1 main directional, L2 fill)
  const ambient = new THREE.AmbientLight(0xfff5e6, 0.82);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffeedd, 0.95);
  sun.position.set(8, 18, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 1024;
  sun.shadow.mapSize.height = 1024;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 50;
  sun.shadow.camera.left = -12;
  sun.shadow.camera.right = 12;
  sun.shadow.camera.top = 8;
  sun.shadow.camera.bottom = -8;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0xddeeff, 0.35);
  fill.position.set(-10, 12, -8);
  scene.add(fill);

  // Target picker
  const picker = createTargetPicker(THREE, camera, canvas);

  // Scene state caches
  let currentSceneId = null;
  const roomGroup = new THREE.Group();
  scene.add(roomGroup);

  const actorGroup = new THREE.Group();
  scene.add(actorGroup);

  const interactiveMeshes = [];

  // Avatar state cache: actorId -> { root, clips, mixer, actions, currentAnim, lastPos }
  const avatars = {};

  function ensureAvatar(actorId, appearance) {
    if (avatars[actorId]) return avatars[actorId];

    const asset = createAsset({
      THREE,
      assetId: 'avatar.participant',
      variant: { actor: actorId, appearance }
    });

    const mixer = new THREE.AnimationMixer(asset.root);
    const actions = {};
    for (const clip of asset.clips) {
      actions[clip.name] = mixer.clipAction(clip);
    }

    if (actions.idle) {
      actions.idle.play();
    }

    asset.root.userData.belTargetId = actorId;
    asset.root.userData.belTargetType = 'person';
    actorGroup.add(asset.root);
    interactiveMeshes.push(asset.root);

    avatars[actorId] = {
      root: asset.root,
      clips: asset.clips,
      mixer,
      actions,
      currentAnim: 'idle',
      lastPos: { x: 0, y: 0 },
      dispose: asset.dispose
    };

    return avatars[actorId];
  }

  function buildRoom(sceneId) {
    // Clear room group
    while (roomGroup.children.length > 0) {
      const obj = roomGroup.children.pop();
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    }

    interactiveMeshes.length = 0;
    // Re-add avatar roots to interactive
    for (const a of Object.values(avatars)) {
      if (a?.root) interactiveMeshes.push(a.root);
    }

    // Floor plane
    const floorGeo = new THREE.PlaneGeometry(20, 9.6);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0xe8dfce,
      roughness: 0.72,
      metalness: 0.05
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.receiveShadow = true;
    roomGroup.add(floorMesh);

    // Build solid boundary walls from logical geometry
    const sceneDef = SCENES[sceneId];
    if (sceneDef?.solids) {
      const wallMat = new THREE.MeshStandardMaterial({
        color: 0xd9ceba,
        roughness: 0.88,
        metalness: 0.0
      });
      for (const [sx, sy, sw, sh] of sceneDef.solids) {
        const w = sw * SCALE;
        const d = sh * SCALE;
        const h = 0.8;
        const pos = logicalToWorld(sx + sw / 2, sy + sh / 2, h / 2);
        const wallGeo = new THREE.BoxGeometry(w, h, d);
        const wallMesh = new THREE.Mesh(wallGeo, wallMat);
        wallMesh.position.set(pos.x, pos.y, pos.z);
        wallMesh.castShadow = true;
        wallMesh.receiveShadow = true;
        roomGroup.add(wallMesh);
      }
    }

    currentSceneId = sceneId;
  }

  let lastTime = performance.now();

  return {
    get mode() { return '3d'; },
    get canvas() { return canvas; },
    get scene() { return scene; },
    get camera() { return camera; },

    draw(world, base, actorId, now, source) {
      const me = world?.players?.[actorId];
      if (!me) return;

      // Rebuild room if scene changed
      if (currentSceneId !== me.scene) {
        buildRoom(me.scene);
      }

      // Delta time for animation mixers
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      // Update avatars
      for (const [id, p] of Object.entries(world.players)) {
        if (p.scene !== me.scene || p.connected === false) {
          if (avatars[id]) {
            avatars[id].root.visible = false;
          }
          continue;
        }

        const baseP = base?.players?.[id];
        const av = ensureAvatar(id, baseP?.appearance);
        av.root.visible = true;

        // Position
        const worldPos = logicalToWorld(p.x, p.y, 0);
        av.root.position.set(worldPos.x, worldPos.y, worldPos.z);

        // Rotation facing direction
        const dx = p.x - av.lastPos.x;
        const dy = p.y - av.lastPos.y;
        const speed = Math.hypot(dx, dy);

        if (speed > 0.4) {
          av.root.rotation.y = Math.atan2(dx, dy);
          if (av.currentAnim !== 'walk' && av.actions.walk) {
            av.actions.idle?.fadeOut(0.15);
            av.actions.walk.reset().fadeIn(0.15).play();
            av.currentAnim = 'walk';
          }
        } else {
          if (av.currentAnim !== 'idle' && av.actions.idle) {
            av.actions.walk?.fadeOut(0.2);
            av.actions.idle.reset().fadeIn(0.2).play();
            av.currentAnim = 'idle';
          }
        }

        av.lastPos = { x: p.x, y: p.y };
        av.mixer.update(dt);
      }

      // Render 3D scene
      renderer.render(scene, camera);
    },

    pick({ clientX, clientY, actorId }) {
      return picker.pick(clientX, clientY, interactiveMeshes);
    },

    resize({ cssWidth, cssHeight, devicePixelRatio = 1 }) {
      if (!renderer || !camera) return;
      camera.aspect = cssWidth / cssHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(cssWidth, cssHeight, false);
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    },

    dispose() {
      for (const a of Object.values(avatars)) {
        if (typeof a.dispose === 'function') a.dispose();
      }
      scene.clear();
      renderer.dispose();
    }
  };
}
