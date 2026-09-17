(function () {
  'use strict';

  const scriptPromises = new Map();
  const loadedModes = new Set();
  const SCRIPT_LOAD_TIMEOUT_MS = 20_000;

  function toAbsoluteUrl(src) {
    return new URL(src, window.location.href).href;
  }

  function findExistingScript(absoluteUrl) {
    const scripts = Array.from(document.querySelectorAll('script[src]'));
    return scripts.find((script) => {
      try {
        return toAbsoluteUrl(script.getAttribute('src')) === absoluteUrl;
      } catch {
        return false;
      }
    }) || null;
  }

  function waitForExistingScript(scriptElement, absoluteUrl) {
    return new Promise((resolve, reject) => {
      const readyState = scriptElement.readyState || '';
      if (
        scriptElement.dataset.belLoaded === 'true' ||
        scriptElement.dataset.belFailed === 'true' ||
        readyState === 'loaded' ||
        readyState === 'complete'
      ) {
        if (scriptElement.dataset.belFailed === 'true') {
          reject(new Error(`Failed to load script: ${absoluteUrl}`));
          return;
        }
        resolve();
        return;
      }

      let timeoutId = null;
      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      scriptElement.addEventListener('load', () => {
        cleanup();
        scriptElement.dataset.belLoaded = 'true';
        resolve();
      }, { once: true });

      scriptElement.addEventListener('error', () => {
        cleanup();
        scriptElement.dataset.belFailed = 'true';
        try { scriptElement.remove(); } catch { /* ignore */ }
        reject(new Error(`Failed to load script: ${absoluteUrl}`));
      }, { once: true });

      timeoutId = setTimeout(() => {
        scriptElement.dataset.belFailed = 'true';
        try { scriptElement.remove(); } catch { /* ignore */ }
        reject(new Error(`Timed out loading script: ${absoluteUrl}`));
      }, SCRIPT_LOAD_TIMEOUT_MS);
    });
  }

  function loadScript(src) {
    const absoluteUrl = toAbsoluteUrl(src);
    if (scriptPromises.has(absoluteUrl)) {
      return scriptPromises.get(absoluteUrl);
    }

    const existingScript = findExistingScript(absoluteUrl);
    if (existingScript) {
      if (existingScript.dataset.belFailed === 'true') {
        try { existingScript.remove(); } catch { /* ignore */ }
      } else {
        const promise = waitForExistingScript(existingScript, absoluteUrl)
          .catch((error) => {
            scriptPromises.delete(absoluteUrl);
            throw error;
          });
        scriptPromises.set(absoluteUrl, promise);
        return promise;
      }
    }

    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = false;

      let timeoutId = null;
      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      script.addEventListener('load', () => {
        cleanup();
        script.dataset.belLoaded = 'true';
        script.dataset.belFailed = 'false';
        resolve();
      }, { once: true });
      script.addEventListener('error', () => {
        cleanup();
        scriptPromises.delete(absoluteUrl);
        script.dataset.belFailed = 'true';
        try { script.remove(); } catch { /* ignore */ }
        reject(new Error(`Failed to load script: ${absoluteUrl}`));
      }, { once: true });
      document.head.appendChild(script);

      timeoutId = setTimeout(() => {
        scriptPromises.delete(absoluteUrl);
        script.dataset.belFailed = 'true';
        try { script.remove(); } catch { /* ignore */ }
        reject(new Error(`Timed out loading script: ${absoluteUrl}`));
      }, SCRIPT_LOAD_TIMEOUT_MS);
    });

    const wrapped = promise.catch((error) => {
      scriptPromises.delete(absoluteUrl);
      throw error;
    });
    scriptPromises.set(absoluteUrl, wrapped);
    return wrapped;
  }

  async function ensureCompromiseLoaded() {
    if (typeof window.nlp !== 'undefined' || typeof window.compromise !== 'undefined') {
      if (typeof window.nlp === 'undefined' && typeof window.compromise !== 'undefined') {
        window.nlp = window.compromise;
      }
      return;
    }
    await loadScript('https://cdn.jsdelivr.net/npm/compromise@14.10.0/builds/compromise.min.js');
    if (typeof window.nlp === 'undefined' && typeof window.compromise !== 'undefined') {
      window.nlp = window.compromise;
    }
  }

  async function ensureXlsxLoaded() {
    if (typeof window.XLSX !== 'undefined') return;
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
  }

  async function ensureYouTubePlayerLoaded() {
    if (window.YouTubePlayer) return;
    await loadScript('youtube-player.js');
  }

  async function ensureWatchModeLoaded() {
    if (loadedModes.has('watch') || window.WatchMode) {
      loadedModes.add('watch');
      return;
    }
    await ensureXlsxLoaded();
    await ensureYouTubePlayerLoaded();
    await loadScript('watch-mode.js');
    loadedModes.add('watch');
  }

  async function ensureNotesModeLoaded() {
    if (loadedModes.has('notes') || window.TakeNotesMode) {
      loadedModes.add('notes');
      return;
    }
    await ensureCompromiseLoaded();
    await ensureXlsxLoaded();
    await ensureYouTubePlayerLoaded();
    await loadScript('take-notes-mode.js');
    loadedModes.add('notes');
  }

  async function ensureRfibModeLoaded() {
    if (loadedModes.has('rfib') || window.RFIBMode) {
      loadedModes.add('rfib');
      return;
    }
    await loadScript('rfib-mode.js');
    loadedModes.add('rfib');
  }

  async function ensureRmcmaModeLoaded() {
    if (loadedModes.has('rmcma') || window.RMCMAMode) {
      loadedModes.add('rmcma');
      return;
    }
    await ensureXlsxLoaded();
    await loadScript('rmcma-mode.js');
    loadedModes.add('rmcma');
  }

  async function ensureLmcmaModeLoaded() {
    if (loadedModes.has('lmcma') || window.LMCMAMode) {
      loadedModes.add('lmcma');
      return;
    }
    await ensureXlsxLoaded();
    await loadScript('lmcma-mode.js');
    loadedModes.add('lmcma');
  }

  async function ensureLmcsaModeLoaded() {
    if (loadedModes.has('lmcsa') || window.LMCSAMode) {
      loadedModes.add('lmcsa');
      return;
    }
    await ensureXlsxLoaded();
    await loadScript('lmcsa-mode.js');
    loadedModes.add('lmcsa');
  }

  async function ensureSmwModeLoaded() {
    if (loadedModes.has('smw') || window.SMWMode) {
      loadedModes.add('smw');
      return;
    }
    await ensureXlsxLoaded();
    await loadScript('smw-mode.js');
    loadedModes.add('smw');
  }

  async function ensureSstModeLoaded() {
    if (loadedModes.has('sst') || window.SSTMode) {
      loadedModes.add('sst');
      return;
    }
    await ensureXlsxLoaded();
    await loadScript('sst-mode.js');
    loadedModes.add('sst');
  }

  async function ensureHcsModeLoaded() {
    if (loadedModes.has('hcs') || window.HCSMode) {
      loadedModes.add('hcs');
      return;
    }
    await ensureXlsxLoaded();
    await loadScript('hcs-mode.js');
    loadedModes.add('hcs');
  }

  const stylesheetPromises = new Map();
  function ensureStylesheet(href) {
    const url = new URL(href, document.baseURI).href;
    if (stylesheetPromises.has(url)) return stylesheetPromises.get(url);
    let link = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .find(node => node.href === url);
    if (link?.sheet) return Promise.resolve();
    if (link?.dataset.belCssFailed === 'true') {
      if (link.dataset.belManagedStyle === 'true') link.remove();
      link = null;
    }
    const created = !link;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      link.dataset.belManagedStyle = 'true';
    }
    const element = link;
    let timer;
    const promise = new Promise((resolve, reject) => {
      function cleanup() {
        clearTimeout(timer);
        element.removeEventListener('load', onLoad);
        element.removeEventListener('error', onError);
      }
      function onLoad() { cleanup(); resolve(); }
      function onError() {
        cleanup();
        element.dataset.belCssFailed = 'true';
        if (element.dataset.belManagedStyle === 'true') element.remove();
        reject(new Error(`Stylesheet failed: ${href}`));
      }
      element.addEventListener('load', onLoad, { once: true });
      element.addEventListener('error', onError, { once: true });
      timer = setTimeout(onError, 20000);
      if (created) {
        const anchor = document.querySelector('meta[name="bel-mode-styles-end"]');
        if (!anchor) { onError(); return; }
        anchor.before(element);
      }
    }).catch(error => { stylesheetPromises.delete(url); throw error; });
    stylesheetPromises.set(url, promise);
    return promise;
  }

  function whenDomReady() {
    if (document.readyState !== 'loading') return Promise.resolve();
    return new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  }

  async function ensureReadAloudModeLoaded() {
    if (loadedModes.has('read-aloud') || window.ReadAloudMode) {
      loadedModes.add('read-aloud');
      return;
    }
    // First migration: keep the shared speaking helpers and v7 picker CSS eager.
    // Moving the controller alone avoids guessing the shared dependency graph.
    await loadScript('/read-aloud-mode.js?v=2.0.6');
    await whenDomReady();
    if (typeof window.initReadAloudMode !== 'function') throw new Error('Read Aloud initializer is missing.');
    window.initReadAloudMode();
    if (!window.ReadAloudMode) throw new Error('Read Aloud did not initialize.');
    loadedModes.add('read-aloud');
  }

  async function ensureRmcsaModeLoaded() {
    await ensureStylesheet('/rmcsa-mode.css');
    if (loadedModes.has('rmcsa') || window.RMCSAMode) {
      loadedModes.add('rmcsa');
      return;
    }
    await loadScript('/js/rmcsa-content.js');
    await loadScript('/rmcsa-mode.js');
    if (!window.RMCSAMode) throw new Error('RMCSA did not initialize.');
    loadedModes.add('rmcsa');
  }

  const managedModes = new Set([
    'watch', 'notes', 'rfib', 'dd', 'rmcma', 'lmcma', 'lmcsa', 'hcs',
    'smw', 'sst', 'rmcsa', 'rop', 'hiw', 'read-aloud'
  ]);

  async function ensureRopModeLoaded() {
    if (loadedModes.has('rop') || window.ROPMode) {
      loadedModes.add('rop');
      return;
    }
    await ensureXlsxLoaded();
    await loadScript('rop-mode.js');
    loadedModes.add('rop');
  }

  async function ensureHiwModeLoaded() {
    if (loadedModes.has('hiw') || window.HIWMode) {
      loadedModes.add('hiw');
      return;
    }
    await ensureXlsxLoaded();
    await loadScript('hiw-mode.js');
    loadedModes.add('hiw');
  }

  async function ensureDdModeLoaded() {
    if (loadedModes.has('dd') || window.DDMode) {
      loadedModes.add('dd');
      return;
    }
    await loadScript('dd-mode.js');
    loadedModes.add('dd');
  }

  async function ensureModeScripts(mode) {
    if (mode === 'watch') {
      await ensureWatchModeLoaded();
      return true;
    }
    if (mode === 'notes') {
      await ensureNotesModeLoaded();
      return true;
    }
    if (mode === 'rfib') {
      await ensureRfibModeLoaded();
      return true;
    }
    if (mode === 'dd') {
      await ensureDdModeLoaded();
      return true;
    }
    if (mode === 'rmcma') {
      await ensureRmcmaModeLoaded();
      return true;
    }
    if (mode === 'lmcma') {
      await ensureLmcmaModeLoaded();
      return true;
    }
    if (mode === 'lmcsa') {
      await ensureLmcsaModeLoaded();
      return true;
    }
    if (mode === 'hcs') {
      await ensureHcsModeLoaded();
      return true;
    }
    if (mode === 'smw') {
      await ensureSmwModeLoaded();
      return true;
    }
    if (mode === 'sst') {
      await ensureSstModeLoaded();
      return true;
    }
    if (mode === 'rmcsa') {
      await ensureRmcsaModeLoaded();
      return true;
    }
    if (mode === 'rop') {
      await ensureRopModeLoaded();
      return true;
    }
    if (mode === 'hiw') {
      await ensureHiwModeLoaded();
      return true;
    }
    if (mode === 'read-aloud') {
      await ensureReadAloudModeLoaded();
      return true;
    }
    return false;
  }

  window.BELLazyLoader = {
    supportsMode: mode => managedModes.has(mode),
    ensureModeScripts,
    ensureWatchModeLoaded,
    ensureNotesModeLoaded,
    ensureRfibModeLoaded,
    ensureDdModeLoaded,
    ensureRmcmaModeLoaded,
    ensureLmcmaModeLoaded,
    ensureLmcsaModeLoaded,
    ensureSmwModeLoaded,
    ensureSstModeLoaded,
    ensureRmcsaModeLoaded,
    ensureRopModeLoaded,
    ensureHiwModeLoaded,
    ensureHcsModeLoaded,
    ensureCompromiseLoaded,
    ensureReadAloudModeLoaded,
    ensureStylesheet
  };
})();
