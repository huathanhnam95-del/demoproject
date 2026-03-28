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
        readyState === 'loaded' ||
        readyState === 'complete'
      ) {
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
        reject(new Error(`Failed to load script: ${absoluteUrl}`));
      }, { once: true });

      timeoutId = setTimeout(() => {
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
      const promise = waitForExistingScript(existingScript, absoluteUrl);
      scriptPromises.set(absoluteUrl, promise);
      return promise;
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
        resolve();
      }, { once: true });
      script.addEventListener('error', () => {
        cleanup();
        reject(new Error(`Failed to load script: ${absoluteUrl}`));
      }, { once: true });
      document.head.appendChild(script);

      timeoutId = setTimeout(() => {
        reject(new Error(`Timed out loading script: ${absoluteUrl}`));
      }, SCRIPT_LOAD_TIMEOUT_MS);
    });

    scriptPromises.set(absoluteUrl, promise);
    return promise;
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
    return false;
  }

  window.BELLazyLoader = {
    ensureModeScripts,
    ensureWatchModeLoaded,
    ensureNotesModeLoaded,
    ensureRfibModeLoaded,
    ensureCompromiseLoaded
  };
})();
