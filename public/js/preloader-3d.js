import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
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
    color: 0x1a73e8,
    emissive: 0x1a73e8,
    emissiveIntensity: 0.12,
    metalness: 0.85,
    roughness: 0.25
  });
}

function createEdgeMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x8ab4f8,
    emissive: 0x4285f4,
    emissiveIntensity: 0.15,
    metalness: 0.5,
    roughness: 0.3
  });
}

// createRoundedRectGeometry removed as we use TextGeometry now

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
    this.progressBar = document.getElementById('preloader-progress-fill');

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
    this.scene.fog = new THREE.FogExp2(0x0f172a, 0.035);

    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);

    const ambient = new THREE.AmbientLight(0x1a1a2e, 0.2);
    this.scene.add(ambient);

    this.keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
    this.keyLight.position.set(5, 8, 5);
    this.scene.add(this.keyLight);

    const brandAccent = new THREE.PointLight(0x1a73e8, 1.2, 30, 2);
    brandAccent.position.set(0, 2, 4);
    this.scene.add(brandAccent);

    const fillLight = new THREE.DirectionalLight(0x8ab4f8, 0.3);
    fillLight.position.set(-5, -2, -5);
    this.scene.add(fillLight);

    this.logoGroup = new THREE.Group();
    this.scene.add(this.logoGroup);
    this.loadFontAndCreateText();

    this.energyRing = null;

    this.floor = this.createFloor();
    this.scene.add(this.floor);

    this.atmosphereGlow = this.qualityProfile.enableAtmosphere ? this.createAtmosphereGlow() : null;
    if (this.atmosphereGlow) {
      this.scene.add(this.atmosphereGlow);
    }

    this.particles = this.createParticles();
    if (this.particles) {
      this.scene.add(this.particles);
    }
  }

  loadFontAndCreateText() {
    const loader = new FontLoader();
    loader.load('https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json', (font) => {
      const geometry = new TextGeometry('BEL', {
        font: font,
        size: 4.5,
        height: 0.8,
        curveSegments: 4,
        bevelEnabled: true,
        bevelThickness: 0.1,
        bevelSize: 0.05,
        bevelOffset: 0,
        bevelSegments: 3
      });
      geometry.center();

      const material = createBodyMaterial();
      const edgeMaterial = createEdgeMaterial();

      const textMesh = new THREE.Mesh(geometry, [material, edgeMaterial]);

      this.logoGroup.add(textMesh);

      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(5.9, 6.8, 0.45, 40),
        new THREE.MeshStandardMaterial({
          color: 0x0f172a,
          emissive: 0x1a73e8,
          emissiveIntensity: 0.08,
          metalness: 0.6,
          roughness: 0.5
        })
      );
      base.position.set(0, -3.35, -0.35);
      this.logoGroup.add(base);

      this.logoGroup.rotation.x = -0.08;
    });
  }

  createFloor() {
    const floor = new THREE.Group();

    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(8.4, 64),
      new THREE.MeshBasicMaterial({
        color: 0x1a73e8,
        transparent: true,
        opacity: 0.06
      })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(0, -3.55, 0.5);
    floor.add(disc);

    const glow = new THREE.Mesh(
      new THREE.RingGeometry(5.2, 8.6, 80),
      new THREE.MeshBasicMaterial({
        color: 0x4285f4,
        transparent: true,
        opacity: 0.1,
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
        opacity: 0.2,
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
        opacity: 0.25,
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
        color: 0x4285f4,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending
      })
    );
    ring.position.set(0, -0.2, -1.2);
    ring.rotation.x = Math.PI / 2.35;
    return ring;
  }

  createParticles() {
    const count = this.qualityProfile.particleCount;
    if (!count) {
      return null;
    }
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
        color: 0x4285f4,
        size: 0.08,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
  }

  enableFallback() {
    this.isFallback = true;
    this.logoReady = true;
    this.preloader.classList.add('preloader-fallback-active');
    if (this.wordmark) {
      this.wordmark.setAttribute('data-ready', 'true');
    }
    if (this.progressBar) {
      this.progressBar.style.width = '100%';
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

  updateProgressBar(elapsed) {
    if (!this.progressBar) return;
    const minMs = 3500; // Match PRELOADER_MIN_DURATION_MS
    if (elapsed < minMs) {
      const fakePct = Math.min((elapsed / minMs) * 100, 99);
      this.progressBar.style.width = `${fakePct}%`;
    } else {
      this.progressBar.style.width = `100%`;
    }
  }

  animate(now = performance.now()) {
    if (this.isFinished || this.isFallback || !this.renderer) {
      return;
    }

    this.rafId = window.requestAnimationFrame((nextNow) => this.animate(nextNow));

    const elapsed = now - this.startTime;
    this.updateProgressBar(elapsed);

    const progress = this.motionProfile.durationMs <= 0
      ? 1
      : Math.min(elapsed / this.animationDuration, 1);
    const phase = getAnimationPhase(progress);
    const pose = getCameraPose(progress);

    this.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    this.camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);

    this.logoGroup.rotation.y = -0.08;
    this.logoGroup.rotation.z = 0;
    this.logoGroup.position.y = 0;
    this.logoGroup.position.z = 0;
    this.floor.children[0].material.opacity = 0.18;
    this.floor.children[1].material.opacity = 0.07;

    if (this.atmosphereGlow) {
      this.atmosphereGlow.children[0].material.opacity = 0.2;
      this.atmosphereGlow.children[1].material.opacity = 0.25;
      this.atmosphereGlow.rotation.z = 0;
    }

    if (phase === 'resolve') {
      this.logoGroup.scale.setScalar(1.01 + ((progress - 0.82) * 0.12));
      this.logoGroup.rotation.y = -0.06;
    } else {
      this.logoGroup.scale.setScalar(1);
    }

    this.renderer.render(this.scene, this.camera);

    if (shouldFinishPreloader({
      progress,
      appReady: window._appReady,
      logoReady: this.logoReady,
      elapsed
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
    if (this.energyRing) {
      this.energyRing.material.opacity = finishState.ringOpacity;
    }
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
