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

  async function ensureRmcsaModeLoaded() {
    if (loadedModes.has('rmcsa') || window.RMCSAMode) {
      loadedModes.add('rmcsa');
      return;
    }
    await ensureXlsxLoaded();
    await loadScript('rmcsa-mode.js');
    loadedModes.add('rmcsa');
  }

  async function ensureRopModeLoaded() {
    if (loadedModes.has('rop') || window.ROPMode) {
      loadedModes.add('rop');
      return;
    }
    await ensureXlsxLoaded();
    await loadScript('rop-mode.js');
    loadedModes.add('rop');
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
    if (mode === 'rmcsa') {
      await ensureRmcsaModeLoaded();
      return true;
    }
    if (mode === 'rop') {
      await ensureRopModeLoaded();
      return true;
    }
    return false;
  }

  window.BELLazyLoader = {
    ensureModeScripts,
    ensureWatchModeLoaded,
    ensureNotesModeLoaded,
    ensureRfibModeLoaded,
    ensureDdModeLoaded,
    ensureRmcmaModeLoaded,
    ensureRmcsaModeLoaded,
    ensureRopModeLoaded,
    ensureCompromiseLoaded
  };
})();
