// Three.js WebGL 3D Renderer for BEL Working as Equals (Phase 05 / P05.1)
// Integrates Claude Batch 0-v2 block-built avatar, timber planks, and room foundations.
// Conforms to BEL-ART-01 v1.0 and Master Plan Renderer Contract (§4.2).

import * as THREE from '../assets-3d/vendor/three/three.module.js';
import { createAsset, createResourceCache } from '../assets-3d/batch-3-v1/runtime/index.mjs';
import { CLIP_INFO } from '../assets-3d/batch-3-v1/runtime/avatar-clips.mjs';
import { logicalToWorld, worldToLogical, SCALE } from './coordinates3d.mjs';
import { createTargetPicker } from './picking3d.mjs';
import { SCENES } from './scenes.mjs';
import { plankPosition } from '../activities/bridge.mjs';
import { carsAt } from './simulation.mjs';

import { ASSEMBLY as HOME_ASSEMBLY } from '../assets-3d/batch-3-v1/assembly/home.mjs';
import { ASSEMBLY as STREET_ASSEMBLY } from '../assets-3d/batch-3-v1/assembly/street.mjs';
import { ASSEMBLY as RECEPTION_ASSEMBLY } from '../assets-3d/batch-3-v1/assembly/reception.mjs';
import { ASSEMBLY as A_ASSEMBLY } from '../assets-3d/batch-3-v1/assembly/studio-a.mjs';
import { ASSEMBLY as B1_ASSEMBLY } from '../assets-3d/batch-3-v1/assembly/b1.mjs';
import { ASSEMBLY as B2_ASSEMBLY } from '../assets-3d/batch-3-v1/assembly/b2.mjs';
import { ASSEMBLY as B3_ASSEMBLY } from '../assets-3d/batch-3-v1/assembly/b3.mjs';
import { ASSEMBLY as C_ASSEMBLY } from '../assets-3d/batch-3-v1/assembly/studio-c.mjs';
import { ASSEMBLY as D_ASSEMBLY } from '../assets-3d/batch-3-v1/assembly/gallery-d.mjs';
import { ASSEMBLY as E_ASSEMBLY } from '../assets-3d/batch-3-v1/assembly/studio-e.mjs';
import { ROOM_F_ASSEMBLY } from '../assets-3d/batch-3-v1/assembly/room-f.mjs';
import { STUDIO_G_ASSEMBLY } from '../assets-3d/batch-3-v1/assembly/studio-g.mjs';
import { ASSEMBLY as I_ASSEMBLY } from '../assets-3d/batch-3-v1/assembly/room-i.mjs';
import { ASSEMBLY as J_ASSEMBLY } from '../assets-3d/batch-3-v1/assembly/room-j.mjs';

export const ASSEMBLIES = {
  home: HOME_ASSEMBLY,
  street: STREET_ASSEMBLY,
  reception: RECEPTION_ASSEMBLY,
  A: A_ASSEMBLY,
  B1: B1_ASSEMBLY,
  B2: B2_ASSEMBLY,
  B3: B3_ASSEMBLY,
  C: C_ASSEMBLY,
  D: D_ASSEMBLY,
  E: E_ASSEMBLY,
  F: ROOM_F_ASSEMBLY,
  G: STUDIO_G_ASSEMBLY,
  I: I_ASSEMBLY,
  J: J_ASSEMBLY
};


export async function createRenderer3D(canvas, { onFault } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
    renderer.setPixelRatio(dpr);
    const initialWidth = canvas?.clientWidth || (canvas?.width ? canvas.width / dpr : 1000);
    const initialHeight = canvas?.clientHeight || (canvas?.height ? canvas.height / dpr : 480);
    renderer.setSize(initialWidth, initialHeight, false);
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
  const camera = new THREE.PerspectiveCamera(40, 1000 / 480, 0.1, 160);
  camera.position.set(0, 15, 18);
  camera.lookAt(0, 0, 1.5);

  // --- Adaptive room framing -------------------------------------------------
  // The room is a fixed 1000 x 480 logical stage (20 x 9.6 world units). A fixed
  // camera distance leaves that stage floating in empty background on wide
  // viewports, because a PerspectiveCamera holds its vertical FOV and simply
  // reveals more world horizontally. Instead, dolly the camera along its own
  // view axis until the room's bounding box exactly fills the current frustum.
  const FRAME_DIRECTION = new THREE.Vector3(0, 15, 16.5).normalize(); // target -> camera
  const FRAME_PADDING = 1.04;       // breathing room around the stage
  const FRAME_MIN_DISTANCE = 6;
  const FRAME_TARGET_HEIGHT = 0.34; // lift the look-at point off the floor
  // Clamp to the authored play area so an oversized ground plane (street) or a
  // stray collider cannot pull the framing back out again.
  const FRAME_CLAMP = { x: 10.8, y: 3.8, z: 5.4 };

  const frameBox = new THREE.Box3();
  const frameTarget = new THREE.Vector3();
  const frameRight = new THREE.Vector3();
  const frameUp = new THREE.Vector3();
  const frameCorner = new THREE.Vector3();
  const FRAME_WORLD_UP = new THREE.Vector3(0, 1, 0);
  let frameReady = false;

  function measureRoomBounds() {
    frameBox.setFromObject(roomGroup);
    if (frameBox.isEmpty() || !Number.isFinite(frameBox.min.x) || !Number.isFinite(frameBox.max.x)) {
      frameBox.set(
        new THREE.Vector3(-FRAME_CLAMP.x, 0, -FRAME_CLAMP.z),
        new THREE.Vector3(FRAME_CLAMP.x, 2.6, FRAME_CLAMP.z)
      );
    } else {
      frameBox.min.x = Math.max(frameBox.min.x, -FRAME_CLAMP.x);
      frameBox.max.x = Math.min(frameBox.max.x, FRAME_CLAMP.x);
      frameBox.min.z = Math.max(frameBox.min.z, -FRAME_CLAMP.z);
      frameBox.max.z = Math.min(frameBox.max.z, FRAME_CLAMP.z);
      frameBox.min.y = Math.max(frameBox.min.y, 0);
      frameBox.max.y = Math.min(Math.max(frameBox.max.y, 1.8), FRAME_CLAMP.y);
    }
    frameReady = true;
  }

  function frameRoom() {
    if (!frameReady) return;
    const min = frameBox.min;
    const max = frameBox.max;
    frameTarget.set(
      (min.x + max.x) / 2,
      min.y + (max.y - min.y) * FRAME_TARGET_HEIGHT,
      (min.z + max.z) / 2
    );

    // Camera basis for the fixed viewing angle (Three.js cameras look down -Z).
    frameRight.crossVectors(FRAME_WORLD_UP, FRAME_DIRECTION).normalize();
    frameUp.crossVectors(FRAME_DIRECTION, frameRight).normalize();

    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    const tanH = tanV * Math.max(camera.aspect, 0.0001);

    // A corner at camera-space (a, b, c) stays inside the frustum once the
    // camera distance is >= c + |a| / tanH and >= c + |b| / tanV.
    let distance = FRAME_MIN_DISTANCE;
    for (let i = 0; i < 8; i++) {
      frameCorner.set(
        i & 1 ? max.x : min.x,
        i & 2 ? max.y : min.y,
        i & 4 ? max.z : min.z
      ).sub(frameTarget);
      const a = Math.abs(frameCorner.dot(frameRight)) * FRAME_PADDING;
      const b = Math.abs(frameCorner.dot(frameUp)) * FRAME_PADDING;
      const c = frameCorner.dot(FRAME_DIRECTION);
      distance = Math.max(distance, c + a / tanH, c + b / tanV);
    }

    camera.position.copy(FRAME_DIRECTION).multiplyScalar(distance).add(frameTarget);
    camera.near = Math.max(0.1, distance * 0.02);
    camera.far = distance * 3 + 40;
    camera.lookAt(frameTarget);
    camera.updateProjectionMatrix();
  }

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

  // Shared resource cache for geometries and materials
  const resources = createResourceCache(THREE);

  // Scene state caches
  let currentSceneId = null;
  const roomGroup = new THREE.Group();
  scene.add(roomGroup);

  const activityGroup = new THREE.Group();
  scene.add(activityGroup);

  const actorGroup = new THREE.Group();
  scene.add(actorGroup);

  const interactiveMeshes = [];
  const roomParts = [];
  const activityProps = {};

  // Avatar state cache: actorId -> { root, clips, mixer, actions, currentAnim, lastPos }
  const avatars = {};

  function ensureAvatar(actorId, appearance) {
    if (avatars[actorId]) {
      if (appearance && avatars[actorId].applyAppearance) {
        avatars[actorId].applyAppearance(appearance);
      }
      return avatars[actorId];
    }

    const asset = createAsset({
      THREE,
      assetId: 'avatar.participant',
      variant: { actor: actorId, appearance },
      resources
    });

    const mixer = new THREE.AnimationMixer(asset.root);
    const actions = {};
    for (const clip of asset.clips) {
      const action = mixer.clipAction(clip);
      const info = CLIP_INFO[clip.name];
      if (info && info.loop === false) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(THREE.LoopRepeat);
      }
      actions[clip.name] = action;
      actions[clip.name.toLowerCase()] = action;
    }

    const initial = actions.Idle || actions.idle;
    if (initial) {
      initial.play();
    }

    asset.root.userData.belTargetId = actorId;
    asset.root.userData.belTargetType = 'person';
    actorGroup.add(asset.root);
    interactiveMeshes.push(asset.root);

    avatars[actorId] = {
      root: asset.root,
      clips: asset.clips,
      sockets: asset.sockets,
      applyAppearance: asset.applyAppearance,
      mixer,
      actions,
      currentAnim: 'Idle',
      targetRotation: 0,
      targetWorld: new THREE.Vector3(),
      prevWorld: new THREE.Vector3(),
      simTime: 0,
      simDuration: 0.033,
      simProgress: 1.0,
      lastSimX: undefined,
      lastSimY: undefined,
      lastMoveTime: 0,
      initialized: false,
      dispose: asset.dispose
    };

    return avatars[actorId];
  }

  const pedestalPositions = {};
  const textureLoader = new THREE.TextureLoader();

  function buildRoom(sceneId) {
    // Dispose previous room parts
    for (const part of roomParts) {
      if (typeof part.dispose === 'function') part.dispose();
      else if (part.root) part.root.removeFromParent();
    }
    roomParts.length = 0;

    // Dispose previous dynamic activity items
    for (const item of Object.values(activityProps)) {
      if (typeof item.dispose === 'function') item.dispose();
      else if (item.root) item.root.removeFromParent();
    }
    for (const key of Object.keys(activityProps)) delete activityProps[key];
    for (const key of Object.keys(pedestalPositions)) delete pedestalPositions[key];

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

    const assembly = ASSEMBLIES[sceneId];
    const sceneDef = SCENES[sceneId];
    const targets = assembly?.baseline?.targets || sceneDef?.targets || [];
    const targetMap = new Map(targets.map(t => [t.id, t]));
    const matchedTargets = new Set();

    if (assembly && Array.isArray(assembly.components)) {
      for (const entry of assembly.components) {
        // Skip dynamic activity items instantiated and animated by draw()
        if (entry.assetId === 'prop.route-shape' || entry.assetId === 'prop.activity-cube' || entry.assetId === 'prop.bridge-plank') {
          continue;
        }

        try {
          const variant = entry.assetId === 'prop.pedestal'
            ? { ...(entry.variant || {}), shape: entry.shape || entry.variant?.shape }
            : entry.variant;
          const asset = createAsset({
            THREE,
            assetId: entry.assetId,
            variant,
            resources
          });
          if (entry.position) {
            asset.root.position.set(...entry.position);
          }
          if (entry.rotationY) {
            asset.root.rotation.y = entry.rotationY;
          }
          if (entry.hideableFromCamera) {
            asset.root.userData.hideableFromCamera = true;
          }
          if (entry.optional) {
            asset.root.visible = false;
          }

          // Record pedestal top position for placing shapes
          if (entry.assetId === 'prop.pedestal' && entry.shape && entry.position) {
            const h = entry.variant?.height || 2.0;
            pedestalPositions[entry.shape] = {
              x: entry.position[0],
              y: (entry.position[1] || 0) + h,
              z: entry.position[2]
            };
          }

          // Map original portrait photos onto Gallery D 3D wall frames
          if (sceneId === 'D' && entry.assetId === 'prop.gallery-frame') {
            const m = entry.source?.match(/portrait-(\d+)/);
            if (m) {
              const portraitIndex = parseInt(m[1], 10);
              const portraitFiles = ['chet.jpg', 'josh.jpg', 'mike.jpg', 'erik.jpg', 'rich.jpg'];
              const fileName = portraitFiles[portraitIndex];
              if (fileName) {
                const texUrl = new URL(`../native/images/${fileName}`, import.meta.url).href;
                const tex = textureLoader.load(texUrl);
                tex.colorSpace = THREE.SRGBColorSpace;
                const slotMesh = asset.root.getObjectByName('M_gallery_portrait_slot');
                if (slotMesh) {
                  const planeGeo = new THREE.PlaneGeometry(0.85, 1.15);
                  const planeMat = new THREE.MeshBasicMaterial({ map: tex });
                  const planeMesh = new THREE.Mesh(planeGeo, planeMat);
                  planeMesh.position.set(0, 0, 0.068);
                  planeMesh.name = `M_portrait_photo_${portraitIndex}`;
                  asset.root.add(planeMesh);
                  slotMesh.visible = false;
                }
              }
            }
          }

          // Match interactive target (skip structural walls, floors, ceilings, and fx)
          const isStructural = entry.assetId.includes('wall') ||
                               entry.assetId.includes('floor') ||
                               entry.assetId.includes('ceiling') ||
                               entry.assetId.startsWith('fx.');
          if (!isStructural) {
            let tid = null;
            if (entry.source) {
              const m = entry.source.match(/targets#([a-zA-Z0-9_-]+)/);
              if (m && targetMap.has(m[1]) && !matchedTargets.has(m[1])) {
                tid = m[1];
              }
            }
            if (!tid) {
              if (targetMap.has('monitor') && entry.assetId === 'studio.monitor') tid = 'monitor';
              else if (targetMap.has('wardrobe') && entry.assetId === 'prop.wardrobe') tid = 'wardrobe';
              else if (targetMap.has('table') && entry.assetId === 'studio.table' && sceneId === 'D') tid = 'table';
              else if (targetMap.has('home') && entry.assetId === 'prop.house') tid = 'home';
              else if (targetMap.has('bel') && (entry.assetId === 'street.crossing' || entry.assetId === 'room.door')) tid = 'bel';
            }
            if (!tid && entry.position) {
              for (const t of targets) {
                if (!matchedTargets.has(t.id) && t.position) {
                  const dist = Math.hypot(entry.position[0] - t.position[0], entry.position[2] - t.position[1]);
                  if (dist < 0.6) {
                    tid = t.id;
                    break;
                  }
                }
              }
            }

            if (tid) {
              matchedTargets.add(tid);
              const targetDef = targetMap.get(tid);
              asset.root.userData.belTargetId = tid;
              asset.root.userData.belTargetType = targetDef?.type || entry.targetType || 'object';
              interactiveMeshes.push(asset.root);
            }
          }

          roomGroup.add(asset.root);
          roomParts.push(asset);
        } catch (e) {
          console.warn(`Failed to create assembly asset ${entry.assetId}:`, e);
        }
      }

      // Create target colliders for any remaining unmapped baseline targets (e.g. back doors)
      for (const t of targets) {
        if (!matchedTargets.has(t.id) && t.position) {
          const geo = new THREE.BoxGeometry(1.2, 2.0, 1.2);
          const mat = new THREE.MeshBasicMaterial({ visible: false });
          const collider = new THREE.Mesh(geo, mat);
          collider.position.set(t.position[0], 1.0, t.position[1]);
          collider.userData.belTargetId = t.id;
          collider.userData.belTargetType = t.type || 'door';
          roomGroup.add(collider);
          interactiveMeshes.push(collider);
          roomParts.push({
            dispose: () => {
              collider.removeFromParent();
              geo.dispose();
              mat.dispose();
            }
          });
          matchedTargets.add(t.id);
        }
      }
    } else {
      // Fallback floor plane
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

      if (sceneDef?.targets) {
        for (const t of sceneDef.targets) {
          const pos = logicalToWorld(t.x, t.y, 0.5);
          const geo = new THREE.BoxGeometry(1.0, 1.5, 1.0);
          const mat = new THREE.MeshBasicMaterial({ visible: false });
          const collider = new THREE.Mesh(geo, mat);
          collider.position.set(pos.x, pos.y, pos.z);
          collider.userData.belTargetId = t.id;
          collider.userData.belTargetType = t.type || 'object';
          roomGroup.add(collider);
          interactiveMeshes.push(collider);
          roomParts.push({
            dispose: () => {
              collider.removeFromParent();
              geo.dispose();
              mat.dispose();
            }
          });
        }
      }
    }

    currentSceneId = sceneId;

    // Re-fit the camera: every room has its own footprint and wall height.
    measureRoomBounds();
    frameRoom();
  }

  let lastTime = performance.now();

  const rendererInstance = {
    get mode() { return '3d'; },
    get canvas() { return canvas; },
    get scene() { return scene; },
    get camera() { return camera; },
    get activityProps() { return activityProps; },
    get interactiveMeshes() { return interactiveMeshes; },

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

      // Dynamic activity props (planks in F, cubes in J, shapes in B routes, cars on Street)
      if (me.scene === 'F' && world?.bridge?.planks) {
        for (const o of world.bridge.planks) {
          let item = activityProps[o.id];
          if (!item) {
            try {
              item = createAsset({
                THREE,
                assetId: 'prop.bridge-plank',
                variant: 'plank-' + o.index,
                resources
              });
              item.root.userData.belTargetId = o.id;
              item.root.userData.belTargetType = 'plank';
              activityGroup.add(item.root);
              interactiveMeshes.push(item.root);
              activityProps[o.id] = item;
            } catch (e) {
              console.warn('Failed to create plank asset:', e);
            }
          }
          if (item) {
            if (o.owner) {
              const carrier = world.players[o.owner];
              const av = avatars[o.owner];
              if (carrier) {
                if (av?.root) {
                  const fwdX = Math.sin(av.root.rotation.y) * 0.35;
                  const fwdZ = Math.cos(av.root.rotation.y) * 0.35;
                  item.root.position.set(av.root.position.x + fwdX, av.root.position.y + 0.65, av.root.position.z + fwdZ);
                  item.root.rotation.y = av.root.rotation.y;
                } else {
                  const cp = logicalToWorld(carrier.x, carrier.y, 0.65);
                  item.root.position.set(cp.x, cp.y, cp.z);
                }
                item.root.visible = true;
              } else {
                item.root.visible = false;
              }
            } else if (o.placed) {
              const p = plankPosition(o.index);
              const wp = logicalToWorld(p.x, p.y, 0.05);
              item.root.position.set(wp.x, wp.y, wp.z);
              item.root.visible = true;
            } else {
              const wp = logicalToWorld(o.x, o.y, 0.05);
              item.root.position.set(wp.x, wp.y, wp.z);
              item.root.visible = true;
            }
          }
        }
      } else if (me.scene === 'J' && world?.cubes?.cubes) {
        for (const o of world.cubes.cubes) {
          let item = activityProps[o.id];
          if (!item) {
            try {
              item = createAsset({
                THREE,
                assetId: 'prop.activity-cube',
                variant: 'cube-' + o.index,
                resources
              });
              item.root.userData.belTargetId = o.id;
              item.root.userData.belTargetType = 'cube';
              activityGroup.add(item.root);
              interactiveMeshes.push(item.root);
              activityProps[o.id] = item;
            } catch (e) {
              console.warn('Failed to create cube asset:', e);
            }
          }
          if (item) {
            if (o.owner) {
              const carrier = world.players[o.owner];
              const av = avatars[o.owner];
              if (carrier) {
                if (av?.root) {
                  const fwdX = Math.sin(av.root.rotation.y) * 0.35;
                  const fwdZ = Math.cos(av.root.rotation.y) * 0.35;
                  item.root.position.set(av.root.position.x + fwdX, av.root.position.y + 0.65, av.root.position.z + fwdZ);
                  item.root.rotation.y = av.root.rotation.y;
                } else {
                  const cp = logicalToWorld(carrier.x, carrier.y, 0.65);
                  item.root.position.set(cp.x, cp.y, cp.z);
                }
                item.root.visible = true;
              } else {
                item.root.visible = false;
              }
            } else {
              const wp = logicalToWorld(o.x, o.y, 0.05);
              item.root.position.set(wp.x, wp.y, wp.z);
              item.root.visible = true;
            }
          }
        }
      } else if (me.scene.startsWith('B') && world?.routes?.[me.scene]) {
        for (const o of world.routes[me.scene]) {
          let item = activityProps[o.id];
          if (!item) {
            try {
              item = createAsset({
                THREE,
                assetId: 'prop.route-shape',
                variant: o.shape,
                resources
              });
              item.root.userData.belTargetId = o.id;
              item.root.userData.belTargetType = 'shape';
              activityGroup.add(item.root);
              interactiveMeshes.push(item.root);
              activityProps[o.id] = item;
            } catch (e) {
              console.warn('Failed to create route shape asset:', e);
            }
          }
          if (item) {
            if (o.owner) {
              const carrier = world.players[o.owner];
              const av = avatars[o.owner];
              if (carrier) {
                if (av?.root) {
                  const fwdX = Math.sin(av.root.rotation.y) * 0.35;
                  const fwdZ = Math.cos(av.root.rotation.y) * 0.35;
                  item.root.position.set(av.root.position.x + fwdX, av.root.position.y + 0.65, av.root.position.z + fwdZ);
                  item.root.rotation.y = av.root.rotation.y;
                } else {
                  const cp = logicalToWorld(carrier.x, carrier.y, 0.65);
                  item.root.position.set(cp.x, cp.y, cp.z);
                }
                item.root.visible = true;
              } else {
                item.root.visible = false;
              }
            } else if (o.placed) {
              const pos = pedestalPositions[o.shape];
              if (pos) {
                item.root.position.set(pos.x, pos.y + 0.1, pos.z);
              } else {
                const sceneTargets = SCENES[me.scene]?.targets || [];
                const ped = sceneTargets.find(t => t.type === 'pedestal' && t.index === o.index);
                const wp = logicalToWorld(o.x, ped ? ped.topY : o.y, 2.05);
                item.root.position.set(wp.x, wp.y, wp.z);
              }
              item.root.visible = true;
            } else {
              const wp = logicalToWorld(o.x, o.y, 0.05);
              item.root.position.set(wp.x, wp.y, wp.z);
              item.root.visible = true;
            }
          }
        }
      } else if (me.scene === 'street') {
        const cars = carsAt(now);
        for (const c of cars) {
          let item = activityProps[c.id];
          if (!item) {
            try {
              item = createAsset({
                THREE,
                assetId: 'prop.car',
                variant: c.variant || 'car-0',
                resources
              });
              activityGroup.add(item.root);
              activityProps[c.id] = item;
            } catch (e) {
              console.warn('Failed to create car asset:', e);
            }
          }
          if (item) {
            const wp = logicalToWorld(c.x, c.y, 0);
            item.root.position.set(wp.x, wp.y, wp.z);
            item.root.rotation.y = c.dx > 0 ? Math.PI / 2 : -Math.PI / 2;
            item.root.visible = true;
          }
        }
      }

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

        const targetWorld = logicalToWorld(p.x, p.y, 0);

        // First frame initialization or teleport guard
        if (!av.initialized || av.root.position.distanceTo(targetWorld) > 2.0) {
          av.root.position.set(targetWorld.x, targetWorld.y, targetWorld.z);
          av.targetWorld.copy(av.root.position);
          av.prevWorld.copy(av.root.position);
          av.simTime = now;
          av.simDuration = 0.033;
          av.simProgress = 1.0;
          av.lastSimX = p.x;
          av.lastSimY = p.y;
          av.initialized = true;
        }

        // Detect simulation position update (new tick from host)
        const simChanged = (av.lastSimX !== p.x || av.lastSimY !== p.y);
        if (simChanged) {
          av.prevWorld.copy(av.root.position);
          av.targetWorld.set(targetWorld.x, targetWorld.y, targetWorld.z);
          if (av.simTime > 0) {
            const dtTick = (now - av.simTime) / 1000;
            av.simDuration = Math.max(0.016, Math.min(dtTick, 0.08));
          }
          av.simTime = now;
          av.simProgress = 0;

          const simDx = p.x - (av.lastSimX ?? p.x);
          const simDy = p.y - (av.lastSimY ?? p.y);
          if (Math.hypot(simDx, simDy) > 0.1) {
            av.targetRotation = Math.atan2(simDx, simDy);
            av.lastMoveTime = now;
          }
          av.lastSimX = p.x;
          av.lastSimY = p.y;
        }

        // Smoothly interpolate between ticks at constant velocity
        av.simProgress += dt / av.simDuration;
        const alpha = Math.min(av.simProgress, 1.0);
        av.root.position.lerpVectors(av.prevWorld, av.targetWorld, alpha);

        // Reliable movement detection: carrying pose in simulation is sticky, so check recent move
        const isCarrying = Boolean(p.carry);
        const isRiding = Boolean(p.ride);
        const isMoving = (p.pose === 'walking') ||
          (isRiding && (p.pose === 'riding' || (now - av.lastMoveTime < 100))) ||
          (isCarrying && (now - av.lastMoveTime < 120)) ||
          (now - av.lastMoveTime < 80);

        // Smooth rotation towards target direction
        const facingAngles = { down: 0, up: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 };
        if (!isMoving && facingAngles[p.facing] !== undefined) {
          av.targetRotation = facingAngles[p.facing];
        }
        if (av.targetRotation !== undefined) {
          let diff = av.targetRotation - av.root.rotation.y;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          av.root.rotation.y += diff * Math.min(dt * 20, 1);
        }

        // Determine target animation across full clip suite
        let targetAnim = 'Idle';
        if (p.waveUntil && p.waveUntil > now) {
          targetAnim = 'Wave';
        } else if (p.seat) {
          targetAnim = 'SeatedIdle';
        } else if (p.ride === 'scooter') {
          targetAnim = isMoving ? 'ScooterRide' : 'ScooterIdle';
        } else if (p.ride === 'skateboard') {
          targetAnim = isMoving ? 'SkateboardRide' : 'SkateboardIdle';
        } else if (p.follower) {
          targetAnim = isMoving ? 'HandholdWalk_L' : 'HandholdIdle_L';
        } else if (p.leader) {
          targetAnim = isMoving ? 'HandholdWalk_R' : 'HandholdIdle_R';
        } else if (isCarrying) {
          targetAnim = isMoving ? 'CarryWalk' : 'CarryIdle';
        } else if (isMoving) {
          targetAnim = 'Walk';
        } else {
          targetAnim = 'Idle';
        }

        // Smoothly transition animations without clipping or resetting in-flight clips
        if (av.currentAnim !== targetAnim) {
          const prev = av.actions[av.currentAnim] || (av.currentAnim === 'Idle' ? (av.actions.Idle || av.actions.idle) : (av.currentAnim === 'Walk' ? (av.actions.Walk || av.actions.walk) : null));
          const next = av.actions[targetAnim] || (targetAnim === 'Idle' ? (av.actions.Idle || av.actions.idle) : (targetAnim === 'Walk' ? (av.actions.Walk || av.actions.walk) : null));
          if (next) {
            const crossFadeDuration = (targetAnim === 'Idle' || targetAnim === 'CarryIdle' || targetAnim.includes('Idle')) ? 0.1 : 0.08;
            if (prev && prev !== next) {
              prev.fadeOut(crossFadeDuration);
            }
            if (!next.isRunning()) {
              next.reset();
            }
            next.fadeIn(crossFadeDuration).play();
            av.currentAnim = targetAnim;
          }
        }

        // Sync walk animation timeScale with nominal speed per CLIP_INFO specifications
        const activeAction = av.actions[av.currentAnim];
        if (activeAction) {
          activeAction.setEffectiveTimeScale(1.0);
        }

        av.mixer.update(dt);
      }

      // Render 3D scene
      renderer.render(scene, camera);
    },

    pick(point) {
      return picker.pick(point, interactiveMeshes);
    },

    resize({ cssWidth, cssHeight, devicePixelRatio = 1 }) {
      if (!renderer || !camera) return;
      camera.aspect = cssWidth / cssHeight;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(cssWidth, cssHeight, false);
      // The stage must keep filling the frame at any viewport shape.
      frameRoom();
    },

    dispose() {
      for (const a of Object.values(avatars)) {
        if (typeof a.dispose === 'function') a.dispose();
      }
      for (const part of roomParts) {
        if (typeof part.dispose === 'function') part.dispose();
      }
      roomParts.length = 0;
      for (const item of Object.values(activityProps)) {
        if (typeof item.dispose === 'function') item.dispose();
      }
      for (const key of Object.keys(activityProps)) delete activityProps[key];
      interactiveMeshes.length = 0;
      scene.clear();
      renderer.dispose();
      if (typeof resources.dispose === 'function') resources.dispose();
    }
  };

  if (typeof window !== 'undefined') {
    window._belRenderer3D = rendererInstance;
  }

  return rendererInstance;
}
