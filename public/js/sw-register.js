(() => {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (window.location.protocol !== 'https:' && !isLocalhost) return;

  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
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
