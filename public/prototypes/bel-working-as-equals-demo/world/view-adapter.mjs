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
  let activeMode = use3D ? '3d' : '2d';

  async function fallbackTo2D(err) {
    if (activeMode === '2d') return;
    console.warn('3D WebGL fault, transitioning to 2D canvas fallback:', err);
    try {
      if (view && typeof view.dispose === 'function') {
        view.dispose();
      }
    } catch (e) {
      console.warn('Error disposing 3D view during fallback:', e);
    }
    const { createRenderer } = await import('./renderer.mjs');
    view = await createRenderer(canvas);
    activeMode = '2d';
    if (typeof onFault === 'function') onFault(err);
  }

  if (use3D) {
    try {
      const { createRenderer3D } = await import('./renderer3d.mjs');
      view = await createRenderer3D(canvas, {
        onFault: (err) => {
          fallbackTo2D(err);
        }
      });
      activeMode = '3d';
    } catch (err) {
      console.warn('3D WebGL renderer unavailable, activating 2D fallback:', err);
      use3D = false;
    }
  }

  if (!use3D || !view) {
    const { createRenderer } = await import('./renderer.mjs');
    view = await createRenderer(canvas);
    activeMode = '2d';
  }

  return {
    get mode() {
      return activeMode;
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
