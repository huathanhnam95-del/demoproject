export const PRELOADER_DURATION_MS = 6200;
export const PRELOADER_MIN_DURATION_MS = 3500;

export function clampProgress(progress) {
  const numeric = Number(progress);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.min(1, Math.max(0, numeric));
}

export function getAnimationPhase(progress) {
  const normalized = clampProgress(progress);
  // Slightly stretch the hero phase to cover the 3.5s minimum time gracefully
  if (normalized < 0.25) {
    return 'approach';
  }
  if (normalized < 0.85) {
    return 'hero';
  }
  return 'resolve';
}

export function easeInOutCubic(progress) {
  const normalized = clampProgress(progress);
  if (normalized < 0.5) {
    return 4 * normalized * normalized * normalized;
  }
  return 1 - (Math.pow(-2 * normalized + 2, 3) / 2);
}

export function getCameraPose(progress) {
  const normalized = clampProgress(progress);
  const phase = getAnimationPhase(normalized);

  if (phase === 'approach') {
    const local = easeInOutCubic(normalized / 0.25);
    return {
      position: {
        x: -10.8 + (local * 5.4),
        y: 1.9 - (local * 0.55),
        z: 21.5 - (local * 7.2)
      },
      lookAt: {
        x: -1 + (local * 0.82),
        y: 0.22 - (local * 0.08),
        z: 0
      }
    };
  }

  if (phase === 'hero') {
    const local = easeInOutCubic((normalized - 0.25) / 0.6);
    return {
      position: {
        x: -4 + (local * 4.9),
        y: 1.02 + (Math.sin(local * Math.PI) * 0.32),
        z: 13.4 - (local * 1.9)
      },
      lookAt: {
        x: -0.48 + (local * 0.44),
        y: 0.18,
        z: 0
      }
    };
  }

  const local = easeInOutCubic((normalized - 0.85) / 0.15);
  return {
    position: {
      x: 0.28 - (local * 0.28),
      y: 0.92 - (local * 0.42),
      z: 9.2 - (local * 1.7)
    },
    lookAt: {
      x: -0.04 + (local * 0.04),
      y: 0.14 - (local * 0.06),
      z: 0
    }
  };
}

export function shouldFinishPreloader({ progress, appReady, logoReady, elapsed }) {
  const hasMetMinDuration = elapsed >= PRELOADER_MIN_DURATION_MS;
  const hasLoadedAssets = !!appReady && !!logoReady;
  const isAnimationFinished = clampProgress(progress) >= 1;
  return (hasLoadedAssets && hasMetMinDuration) || isAnimationFinished;
}

export function getFinishState(progress) {
  const eased = easeInOutCubic(progress);
  return {
    cameraZ: 7.2 - (eased * 1.5),
    logoScale: 1.04 + (eased * 0.3),
    overlayOpacity: Math.max(0, 1 - (eased * 1.15)),
    ringOpacity: Math.max(0, 0.16 - (eased * 0.16))
  };
}

export function getMotionProfile({ prefersReducedMotion }) {
  if (prefersReducedMotion) {
    return {
      durationMs: 0,
      allowAmbientMotion: false,
      allowExitMotion: false
    };
  }

  return {
    durationMs: PRELOADER_DURATION_MS,
    allowAmbientMotion: true,
    allowExitMotion: true
  };
}

export function getPreloaderQualityProfile({ devicePixelRatio, memoryGb, viewportWidth }) {
  const memory = Number.isFinite(memoryGb) ? memoryGb : 4;
  const width = Number.isFinite(viewportWidth) ? viewportWidth : 1280;
  const dpr = Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;

  if (memory <= 2 || width < 480) {
    return {
      particleCount: 0,
      enableAtmosphere: false,
      pixelRatioCap: 1
    };
  }

  if (memory <= 4 || width < 900) {
    return {
      particleCount: 0,
      enableAtmosphere: true,
      pixelRatioCap: Math.min(1.25, dpr)
    };
  }

  return {
    particleCount: 0,
    enableAtmosphere: true,
    pixelRatioCap: Math.min(1.75, dpr)
  };
}
