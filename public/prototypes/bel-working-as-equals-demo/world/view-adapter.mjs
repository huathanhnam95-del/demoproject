// Unified View Adapter for BEL Working as Equals (Phase 05 / P05.1)
// Decouples application state from renderer representation.
// Manages 3D WebGL vs 2D Canvas lifecycle with transparent fallback.

export async function createView({ canvas, mode = 'auto', onFault } = {}) {
  const requestedMode = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('renderer')
    : null;

  // Allow explicit '3d' or '2d' via URL query, otherwise default to 2d until final release
  let use3D = requestedMode === '3d' || mode === '3d';

  let view = null;

  if (use3D) {
    try {
      const { createRenderer3D } = await import('./renderer3d.mjs');
      view = await createRenderer3D(canvas, {
        onFault: (err) => {
          console.warn('3D renderer fault, transitioning to 2D fallback:', err);
          if (typeof onFault === 'function') onFault(err);
        }
      });
    } catch (err) {
      console.warn('3D WebGL renderer unavailable, activating 2D fallback:', err);
      use3D = false;
    }
  }

  if (!use3D || !view) {
    const { createRenderer } = await import('./renderer.mjs');
    view = await createRenderer(canvas);
  }

  return {
    get mode() {
      return view.mode || (use3D ? '3d' : '2d');
    },
    draw(world, session, actor, now, source) {
      view.draw(world, session, actor, now, source);
    },
    pick(point) {
      if (typeof view.pick === 'function') {
        return view.pick(point);
      }
      return null;
    },
    resize(params) {
      if (typeof view.resize === 'function') {
        view.resize(params);
      }
    },
    dispose() {
      if (typeof view.dispose === 'function') {
        view.dispose();
      }
    }
  };
}
