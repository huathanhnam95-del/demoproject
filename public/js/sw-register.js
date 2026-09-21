(() => {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (window.location.protocol !== 'https:' && !isLocalhost) return;

  // Recording state is private in some legacy modes. Only a fresh dashboard,
  // before engagement, is a safe automatic update boundary. Later updates wait
  // for the next navigation; never infer safety just from returning to the menu.
  let engaged = false;
  let requestedWorker = null;
  let reloaded = false;
  const hadController = !!navigator.serviceWorker.controller;
  ['pointerdown', 'keydown', 'touchstart'].forEach((type) => {
    window.addEventListener(type, () => { engaged = true; }, { capture: true, passive: true });
  });

  function safeBoundary() {
    if (window.appState && window.appState.currentMode) engaged = true;
    const readAloudState = window.ReadAloudMode && window.ReadAloudMode.state;
    if ((window.ASQMode && window.ASQMode.isRecording) ||
        ['REQUESTING_MIC', 'RECORDING', 'STOPPING_RECORDING'].includes(readAloudState)) {
      engaged = true;
    }
    return !engaged && document.visibilityState === 'visible' &&
      window.appState && window.appState.currentMode === '';
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || !requestedWorker || reloaded ||
        navigator.serviceWorker.controller !== requestedWorker || !safeBoundary()) return;
    reloaded = true;
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      let retryScheduled = false;
      function activateWaiting() {
        if (!hadController || requestedWorker || !registration.waiting) return;
        if (!safeBoundary()) {
          // Auth/bootstrap may establish the dashboard after the load event.
          if (!engaged && !retryScheduled) {
            retryScheduled = true;
            setTimeout(() => { retryScheduled = false; activateWaiting(); }, 1000);
          }
          return;
        }
        requestedWorker = registration.waiting;
        try {
          requestedWorker.postMessage({ type: 'SKIP_WAITING' });
        } catch {
          requestedWorker = null;
        }
      }
      function watchInstalling() {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed') activateWaiting();
        });
      }
      registration.addEventListener('updatefound', watchInstalling);
      watchInstalling();
      activateWaiting();
      try {
        await navigator.serviceWorker.ready;
      } catch {
        // ignore
      }
    } catch {
      // ignore
    }
  });
})();
