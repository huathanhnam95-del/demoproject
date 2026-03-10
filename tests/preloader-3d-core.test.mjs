import assert from 'node:assert/strict';
import {
  PRELOADER_DURATION_MS,
  easeInOutCubic,
  getMotionProfile,
  getPreloaderQualityProfile,
  getFinishState,
  getAnimationPhase,
  getCameraPose,
  shouldFinishPreloader
} from '../public/js/preloader-3d-core.js';

console.log('Starting preloader core tests...');

assert.equal(PRELOADER_DURATION_MS, 6200, 'Preloader duration should match the premium timing target');

assert.equal(getAnimationPhase(0), 'approach', 'Animation should start in approach phase');
assert.equal(getAnimationPhase(0.24), 'approach', 'Early progress should stay in approach phase');
assert.equal(getAnimationPhase(0.5), 'hero', 'Mid progress should be in hero phase');
assert.equal(getAnimationPhase(0.95), 'resolve', 'Late progress should be in resolve phase');
assert.equal(easeInOutCubic(0), 0, 'Easing should start at zero');
assert.equal(easeInOutCubic(1), 1, 'Easing should end at one');
assert.ok(easeInOutCubic(0.25) < 0.25, 'Early easing should move more gently than linear');
assert.ok(easeInOutCubic(0.75) > 0.75, 'Late easing should settle more deliberately than linear');

const heroPose = getCameraPose(0.5);
assert.equal(typeof heroPose.position.x, 'number', 'Camera pose should return numeric x coordinate');
assert.equal(typeof heroPose.position.y, 'number', 'Camera pose should return numeric y coordinate');
assert.equal(typeof heroPose.position.z, 'number', 'Camera pose should return numeric z coordinate');
assert.equal(typeof heroPose.lookAt.z, 'number', 'Camera pose should provide a lookAt vector');
assert.ok(heroPose.position.z > 0, 'Hero camera should stay in front of the logo');
assert.ok(heroPose.position.z >= 11, 'Hero camera should hold farther back for a premium slower reveal');

const resolvePose = getCameraPose(0.95);
assert.ok(resolvePose.position.z < heroPose.position.z, 'Resolve phase should push closer to the logo');
assert.ok(resolvePose.position.y <= heroPose.position.y, 'Resolve phase should settle vertically');
assert.ok(resolvePose.position.z >= 7.2, 'Resolve phase should avoid an overly aggressive push-in');
assert.ok(Math.abs(resolvePose.position.x) < 0.35, 'Resolve phase should settle near center');

const finishStart = getFinishState(0);
assert.equal(finishStart.overlayOpacity, 1, 'Exit transition should begin fully visible');
assert.ok(finishStart.logoScale > 1, 'Exit transition should start with a subtle hero scale');

const finishMid = getFinishState(0.5);
assert.ok(finishMid.overlayOpacity < 0.5, 'Exit transition should fade overlay noticeably by midpoint');
assert.ok(finishMid.cameraZ < finishStart.cameraZ, 'Exit transition should continue pushing camera forward');

const finishEnd = getFinishState(1);
assert.equal(finishEnd.overlayOpacity, 0, 'Exit transition should end with hidden overlay');
assert.ok(finishEnd.logoScale > finishMid.logoScale, 'Exit transition should keep carrying the logo forward');

assert.deepEqual(
  getMotionProfile({ prefersReducedMotion: true }),
  { durationMs: 0, allowAmbientMotion: false, allowExitMotion: false },
  'Reduced-motion users should receive a static loader profile'
);
assert.deepEqual(
  getMotionProfile({ prefersReducedMotion: false }),
  { durationMs: PRELOADER_DURATION_MS, allowAmbientMotion: true, allowExitMotion: true },
  'Default motion profile should preserve the cinematic sequence'
);

const highQuality = getPreloaderQualityProfile({ devicePixelRatio: 2, memoryGb: 8, viewportWidth: 1440 });
assert.equal(highQuality.particleCount, 0, 'High-quality profile should remove particles for a cleaner preloader');
assert.equal(highQuality.enableAtmosphere, true, 'High-quality profile should keep atmosphere layers');

const lowQuality = getPreloaderQualityProfile({ devicePixelRatio: 1, memoryGb: 2, viewportWidth: 390 });
assert.equal(lowQuality.particleCount, 0, 'Low-quality profile should also remove particles entirely');
assert.equal(lowQuality.enableAtmosphere, false, 'Low-quality profile should disable expensive atmosphere layers');
assert.equal(lowQuality.pixelRatioCap, 1, 'Low-quality profile should clamp pixel ratio aggressively');

assert.equal(
  shouldFinishPreloader({ progress: 1, appReady: true, logoReady: true }),
  true,
  'Preloader should finish only when progress is complete and app/logo are ready'
);
assert.equal(
  shouldFinishPreloader({ progress: 1, appReady: true, logoReady: false }),
  false,
  'Preloader should wait for the logo to be ready'
);
assert.equal(
  shouldFinishPreloader({ progress: 0.99, appReady: true, logoReady: true }),
  false,
  'Preloader should not finish before the cinematic sequence completes'
);
assert.equal(
  shouldFinishPreloader({ progress: 1, appReady: false, logoReady: true }),
  false,
  'Preloader should wait for application readiness'
);

console.log('Preloader core tests passed');
