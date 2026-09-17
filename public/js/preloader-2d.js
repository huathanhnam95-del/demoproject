/* REPLACEMENT CANDIDATE. Integrate the shell-ready signal and remove the
 * competing index.html watchdog as described in the implementation guide. */
(() => {
  'use strict';
  if (window.BELBoot) return;
  let shellReady = false;
  let failed = false;
  let slow = false;
  let domReady = false;
  let timer = null;
  let measured = false;
  let warmSession = false;
  try { warmSession = sessionStorage.getItem('bel_app_loaded') === '1'; } catch (_) {}

  function render() {
    if (!domReady) return;
    const preloader = document.getElementById('app-preloader');
    const status = document.getElementById('preloader-text');
    const wrapper = document.getElementById('page-layout-wrapper');
    const state = shellReady ? 'ready' : failed ? 'error' : 'loading';
    document.documentElement.dataset.bootStatus = state;
    wrapper?.setAttribute('aria-busy', String(!shellReady));

    if (shellReady) {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (preloader) {
        preloader.hidden = true;
        preloader.style.display = 'none';
        preloader.style.pointerEvents = 'none';
      }
      document.body.classList.remove('loading-active');
      try { sessionStorage.setItem('bel_app_loaded', '1'); } catch (_) {}
      if (!measured) {
        measured = true;
        window.BELPerf?.begin('shell', 0)('ok');
      }
      return;
    }

    // A warm session skips branding, not actual shell/task readiness.
    const showOverlay = !warmSession || failed || slow;
    if (preloader) {
      preloader.hidden = !showOverlay;
      preloader.style.display = showOverlay ? 'flex' : 'none';
      preloader.style.pointerEvents = showOverlay ? 'auto' : 'none';
      preloader.classList.toggle('reduced-motion',
        !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
      const progress = preloader.querySelector('.preloader-progress');
      if (progress) progress.hidden = true;
      const fill = document.getElementById('preloader-text-fill-wrapper');
      if (fill) fill.style.width = '100%';
    }
    document.body.classList.toggle('loading-active', showOverlay);
    if (status) {
      status.replaceChildren();
      const text = document.createElement('span');
      text.textContent = failed ? 'The application could not start. '
        : slow ? 'Starting is taking longer than expected. '
        : 'Opening practice…';
      status.append(text);
      if (failed || slow) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = 'Retry loading';
        // Only the boot shell is retried here. Do not reuse this for task saves.
        retry.addEventListener('click', () => window.location.reload());
        status.append(retry);
      }
    }
  }

  const api = Object.freeze({
    shellReady() { shellReady = true; failed = false; render(); },
    fail() { if (!shellReady) { failed = true; render(); } },
    getState() { return shellReady ? 'ready' : failed ? 'error' : 'loading'; }
  });
  window.BELBoot = api;
  // Compatibility alias exists immediately, before DOMContentLoaded.
  window.finishBelPreloader = () => api.shellReady();

  function initialize() {
    if (domReady) return;
    domReady = true;
    if (!shellReady) {
      timer = setTimeout(() => { slow = true; render(); }, 10000);
    }
    render();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else initialize();
})();
