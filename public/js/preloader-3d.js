import * as THREE from 'three';
import {
  PRELOADER_DURATION_MS,
  getAnimationPhase,
  getCameraPose,
  getFinishState,
  getMotionProfile,
  getPreloaderQualityProfile,
  shouldFinishPreloader
} from './preloader-3d-core.js';

const HIDE_DELAY_MS = 760;

function createBodyMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xf5f8ff,
    emissive: 0x14345e,
    emissiveIntensity: 0.22,
    metalness: 0.5,
    roughness: 0.18
  });
}

function createGlowMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0x1a73e8,
    transparent: true,
    opacity: 0.12,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false
  });
}

function createEdgeMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x7db4ff,
    emissiveIntensity: 0.14,
    metalness: 0.68,
    roughness: 0.14
  });
}

function createRoundedRectGeometry(width, height, depth, radius) {
  const shape = new THREE.Shape();
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const cornerRadius = Math.min(radius, halfWidth, halfHeight);

  shape.moveTo(-halfWidth + cornerRadius, -halfHeight);
  shape.lineTo(halfWidth - cornerRadius, -halfHeight);
  shape.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + cornerRadius);
  shape.lineTo(halfWidth, halfHeight - cornerRadius);
  shape.quadraticCurveTo(halfWidth, halfHeight, halfWidth - cornerRadius, halfHeight);
  shape.lineTo(-halfWidth + cornerRadius, halfHeight);
  shape.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - cornerRadius);
  shape.lineTo(-halfWidth, -halfHeight + cornerRadius);
  shape.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + cornerRadius, -halfHeight);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: Math.min(cornerRadius * 0.38, 0.09),
    bevelThickness: Math.min(depth * 0.12, 0.1),
    curveSegments: 14
  });
  geometry.center();
  return geometry;
}

function createGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
}

class Preloader3D {
  constructor() {
    this.preloader = document.getElementById('app-preloader');
    this.container = document.getElementById('three-container');
    this.overlay = this.preloader?.querySelector('.preloader-overlay') || null;
    this.wordmark = document.getElementById('preloader-wordmark');
    this.status = document.getElementById('preloader-text');
    this.kicker = document.getElementById('preloader-kicker');

    if (!this.preloader || !this.container) {
      return;
    }

    this.startTime = performance.now();
    this.motionProfile = getMotionProfile({
      prefersReducedMotion: !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    });
    this.qualityProfile = getPreloaderQualityProfile({
      devicePixelRatio: window.devicePixelRatio || 1,
      memoryGb: navigator.deviceMemory,
      viewportWidth: window.innerWidth
    });
    this.animationDuration = this.motionProfile.durationMs || PRELOADER_DURATION_MS;
    this.logoReady = false;
    this.isFinished = false;
    this.isFallback = false;
    this.rafId = 0;
    this.finishStart = 0;
    this.onResize = () => this.handleResize();

    try {
      this.setupRenderer();
      this.setupScene();
      this.logoReady = true;
      this.preloader.classList.add('three-ready');
      if (!this.motionProfile.allowAmbientMotion) {
        this.preloader.classList.add('reduced-motion');
      }
      this.handleResize();
      window.addEventListener('resize', this.onResize);
      this.animate();
    } catch (error) {
      console.error('BEL preloader fallback activated:', error);
      this.enableFallback();
    }
  }

  setupRenderer() {
    if (!window.WebGLRenderingContext) {
      throw new Error('WebGL unavailable');
    }

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.qualityProfile.pixelRatioCap));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.96;
    this.container.appendChild(this.renderer.domElement);
  }

  setupScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x09131f, 0.05);

    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);

    const ambient = new THREE.AmbientLight(0xf4f8ff, 0.82);
    this.scene.add(ambient);

    this.keyLight = new THREE.DirectionalLight(0xb7d4ff, 2.9);
    this.keyLight.position.set(-5.4, 5.6, 9.4);
    this.scene.add(this.keyLight);

    this.fillLight = new THREE.PointLight(0x1a73e8, 24, 34, 2);
    this.fillLight.position.set(5.4, 2.2, 8.2);
    this.scene.add(this.fillLight);

    this.rimLight = new THREE.PointLight(0xf9ab00, 10, 22, 2);
    this.rimLight.position.set(-6.2, 3.1, -2.4);
    this.scene.add(this.rimLight);

    this.accentLight = new THREE.PointLight(0x1e8e3e, 5.5, 18, 2);
    this.accentLight.position.set(0.8, -1.6, 7.6);
    this.scene.add(this.accentLight);

    this.logoGroup = this.createLogoGroup();
    this.scene.add(this.logoGroup);

    this.energyRing = this.createEnergyRing();
    this.scene.add(this.energyRing);

    this.floor = this.createFloor();
    this.scene.add(this.floor);

    this.atmosphereGlow = this.qualityProfile.enableAtmosphere ? this.createAtmosphereGlow() : null;
    if (this.atmosphereGlow) {
      this.scene.add(this.atmosphereGlow);
    }

    this.particles = this.createParticles();
    this.scene.add(this.particles);
  }

  createLogoGroup() {
    const group = new THREE.Group();
    const material = createBodyMaterial();
    const glowMaterial = createGlowMaterial();
    const edgeMaterial = createEdgeMaterial();

    const letterB = this.createLetterB(material, glowMaterial, edgeMaterial);
    const letterE = this.createLetterE(material, glowMaterial, edgeMaterial);
    const letterL = this.createLetterL(material, glowMaterial, edgeMaterial);

    letterB.position.x = -4.2;
    letterE.position.x = 0;
    letterL.position.x = 4.1;

    group.add(letterB, letterE, letterL);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(5.9, 6.8, 0.45, 40),
      new THREE.MeshStandardMaterial({
        color: 0x10233b,
        emissive: 0x123c72,
        emissiveIntensity: 0.16,
        metalness: 0.24,
        roughness: 0.62
      })
    );
    base.position.set(0, -3.35, -0.35);
    group.add(base);

    group.rotation.x = -0.08;
    return group;
  }

  createFloor() {
    const floor = new THREE.Group();

    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(8.4, 64),
      new THREE.MeshBasicMaterial({
        color: 0x0f2747,
        transparent: true,
        opacity: 0.22
      })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(0, -3.55, 0.5);
    floor.add(disc);

    const glow = new THREE.Mesh(
      new THREE.RingGeometry(5.2, 8.6, 80),
      new THREE.MeshBasicMaterial({
        color: 0x78adff,
        transparent: true,
        opacity: 0.08,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(0, -3.5, 0.4);
    floor.add(glow);

    return floor;
  }

  createAtmosphereGlow() {
    const group = new THREE.Group();
    const texture = createGlowTexture();

    const primaryGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        color: 0x1a73e8,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    primaryGlow.scale.set(11.5, 11.5, 1);
    primaryGlow.position.set(0, -0.4, -2.8);
    group.add(primaryGlow);

    const secondaryGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        color: 0x8fc2ff,
        transparent: true,
        opacity: 0.08,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    secondaryGlow.scale.set(7.2, 7.2, 1);
    secondaryGlow.position.set(0.4, -0.1, -1.8);
    group.add(secondaryGlow);

    return group;
  }

  createEnergyRing() {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(7.4, 0.13, 18, 120),
      new THREE.MeshBasicMaterial({
        color: 0x6eb0ff,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending
      })
    );
    ring.position.set(0, -0.2, -1.2);
    ring.rotation.x = Math.PI / 2.35;
    return ring;
  }

  createParticles() {
    const count = this.qualityProfile.particleCount;
    const positions = new Float32Array(count * 3);

    for (let index = 0; index < count; index += 1) {
      const stride = index * 3;
      positions[stride] = (Math.random() - 0.5) * 22;
      positions[stride + 1] = (Math.random() - 0.2) * 12;
      positions[stride + 2] = (Math.random() - 0.5) * 18;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    return new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0xd9e8ff,
        size: 0.06,
        transparent: true,
        opacity: 0.46,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
  }

  createLetterB(material, glowMaterial, edgeMaterial) {
    return this.createLetterFromSegments(
      [
        [-0.98, 0, 0.56, 3.82],
        [0.28, 1.64, 2.34, 0.46],
        [0.34, 0.14, 2.08, 0.4],
        [0.28, -1.54, 2.28, 0.46],
        [1.24, 0.94, 0.46, 1.42],
        [1.2, -1.04, 0.46, 1.56]
      ],
      material,
      glowMaterial,
      edgeMaterial
    );
  }

  createLetterE(material, glowMaterial, edgeMaterial) {
    return this.createLetterFromSegments(
      [
        [-0.9, 0, 0.54, 3.82],
        [0.34, 1.64, 2.42, 0.44],
        [0.16, 0.14, 2.02, 0.36],
        [0.3, -1.56, 2.46, 0.44]
      ],
      material,
      glowMaterial,
      edgeMaterial
    );
  }

  createLetterL(material, glowMaterial, edgeMaterial) {
    return this.createLetterFromSegments(
      [
        [-0.84, 0, 0.54, 3.82],
        [0.44, -1.56, 2.4, 0.46]
      ],
      material,
      glowMaterial,
      edgeMaterial
    );
  }

  createLetterFromSegments(segments, material, glowMaterial, edgeMaterial) {
    const letter = new THREE.Group();

    segments.forEach(([x, y, width, height]) => {
      const geometry = createRoundedRectGeometry(width, height, 0.82, Math.min(width, height) * 0.18);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, 0);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      letter.add(mesh);

      const glow = new THREE.Mesh(geometry, glowMaterial);
      glow.position.copy(mesh.position);
      glow.scale.set(1.08, 1.08, 1.28);
      letter.add(glow);

      const frontPlate = new THREE.Mesh(
        createRoundedRectGeometry(Math.max(0.18, width - 0.08), Math.max(0.18, height - 0.08), 0.1, Math.min(width, height) * 0.14),
        edgeMaterial
      );
      frontPlate.position.set(x, y, 0.38);
      letter.add(frontPlate);
    });

    return letter;
  }

  enableFallback() {
    this.isFallback = true;
    this.logoReady = true;
    this.preloader.classList.add('preloader-fallback-active');
    if (this.wordmark) {
      this.wordmark.setAttribute('data-ready', 'true');
    }
  }

  handleResize() {
    if (!this.camera || !this.renderer) {
      return;
    }
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  setAppReady() {
    window._appReady = true;
    if (this.isFallback) {
      this.finish();
    }
  }

  animate(now = performance.now()) {
    if (this.isFinished || this.isFallback || !this.renderer) {
      return;
    }

    this.rafId = window.requestAnimationFrame((nextNow) => this.animate(nextNow));

    const elapsed = now - this.startTime;
    const progress = this.motionProfile.durationMs <= 0
      ? 1
      : Math.min(elapsed / this.animationDuration, 1);
    const phase = getAnimationPhase(progress);
    const pose = getCameraPose(progress);

    this.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    this.camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);

    if (this.motionProfile.allowAmbientMotion) {
      const drift = elapsed * 0.00055;
      this.logoGroup.rotation.y = -0.18 + (Math.sin(drift * 0.55) * 0.06);
      this.logoGroup.rotation.z = Math.sin(drift * 0.26) * 0.016;
      this.logoGroup.position.y = Math.sin(drift * 0.78) * 0.08;
      this.logoGroup.position.z = Math.cos(drift * 0.34) * 0.1;

      this.energyRing.rotation.z += 0.0024;
      this.energyRing.material.opacity = 0.14 + (Math.sin(drift * 1.1) * 0.03);

      this.fillLight.position.x = 5.2 + (Math.sin(drift * 0.8) * 1.4);
      this.fillLight.position.y = 2.4 + (Math.cos(drift * 1.25) * 0.45);
      this.rimLight.position.x = -6.1 + (Math.cos(drift * 0.68) * 0.9);
      this.rimLight.intensity = 8.5 + (Math.sin(drift * 1.05) * 1.2);
      this.accentLight.intensity = 4.2 + (Math.cos(drift * 0.92) * 0.65);

      this.particles.rotation.y += 0.00034;
      this.particles.rotation.x = Math.sin(drift * 0.2) * 0.03;
      this.floor.children[0].material.opacity = 0.18 + (Math.sin(drift * 0.8) * 0.02);
      this.floor.children[1].material.opacity = 0.07 + (Math.cos(drift * 0.9) * 0.015);

      if (this.atmosphereGlow) {
        this.atmosphereGlow.children[0].material.opacity = 0.12 + (Math.sin(drift * 0.9) * 0.025);
        this.atmosphereGlow.children[1].material.opacity = 0.06 + (Math.cos(drift * 1.15) * 0.02);
        this.atmosphereGlow.rotation.z = Math.sin(drift * 0.16) * 0.04;
      }
    } else {
      this.logoGroup.rotation.y = -0.12;
      this.logoGroup.rotation.z = 0;
      this.logoGroup.position.y = 0;
      this.logoGroup.position.z = 0;
      this.energyRing.material.opacity = 0.1;
    }

    if (phase === 'resolve') {
      this.logoGroup.scale.setScalar(1.01 + ((progress - 0.82) * 0.18));
      this.logoGroup.rotation.y *= 0.992;
      if (this.kicker) {
        this.kicker.style.opacity = String(Math.max(0.2, 1 - ((progress - 0.82) * 2.2)));
      }
    } else if (this.kicker) {
      this.kicker.style.opacity = '0.96';
    }

    this.renderer.render(this.scene, this.camera);

    if (shouldFinishPreloader({
      progress,
      appReady: window._appReady,
      logoReady: this.logoReady
    })) {
      this.finish();
    }
  }

  finish() {
    if (this.isFinished || !this.preloader) {
      return;
    }

    this.isFinished = true;
    this.preloader.classList.add('finishing', 'fade-out');

    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }

    if (!this.isFallback && this.renderer && this.motionProfile.allowExitMotion) {
      this.finishStart = performance.now();
      this.animateFinish();
    }

    window.setTimeout(() => {
      this.preloader.style.display = 'none';
      this.destroy();
    }, HIDE_DELAY_MS);
  }

  animateFinish(now = performance.now()) {
    if (!this.renderer || !this.camera || !this.logoGroup) {
      return;
    }

    const elapsed = Math.min((now - this.finishStart) / HIDE_DELAY_MS, 1);
    const finishState = getFinishState(elapsed);

    this.camera.position.z = finishState.cameraZ;
    this.logoGroup.scale.setScalar(finishState.logoScale);
    this.logoGroup.rotation.y *= 0.94;
    this.logoGroup.position.y *= 0.94;
    this.energyRing.material.opacity = finishState.ringOpacity;
    if (this.atmosphereGlow) {
      this.atmosphereGlow.children[0].material.opacity = Math.max(0, 0.12 - (elapsed * 0.12));
      this.atmosphereGlow.children[1].material.opacity = Math.max(0, 0.06 - (elapsed * 0.06));
    }

    if (this.overlay) {
      this.overlay.style.opacity = String(finishState.overlayOpacity);
      this.overlay.style.transform = `translateY(${elapsed * 18}px)`;
      this.overlay.style.filter = `blur(${elapsed * 8}px)`;
    }

    this.renderer.render(this.scene, this.camera);

    if (elapsed < 1) {
      window.requestAnimationFrame((nextNow) => this.animateFinish(nextNow));
    }
  }

  destroy() {
    window.removeEventListener('resize', this.onResize);

    if (this.renderer) {
      this.renderer.dispose();
      this.container.textContent = '';
    }

    if (this.particles?.geometry) {
      this.particles.geometry.dispose();
    }
    if (this.particles?.material) {
      this.particles.material.dispose();
    }
    if (this.atmosphereGlow) {
      this.atmosphereGlow.traverse((node) => {
        if (node.material?.map) node.material.map.dispose?.();
        node.material?.dispose?.();
      });
    }
    if (this.overlay) {
      this.overlay.style.opacity = '';
      this.overlay.style.transform = '';
      this.overlay.style.filter = '';
    }
  }
}

window._appReady = false;
window._finish3DPreloader = () => {
  window._appReady = true;
  if (window.belPreloader && typeof window.belPreloader.setAppReady === 'function') {
    window.belPreloader.setAppReady();
    return;
  }

  const preloader = document.getElementById('app-preloader');
  if (preloader) {
    preloader.classList.add('fade-out');
    window.setTimeout(() => {
      preloader.style.display = 'none';
    }, HIDE_DELAY_MS);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.belPreloader = new Preloader3D();
});
