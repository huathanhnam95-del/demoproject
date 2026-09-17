/* Reference implementation: local diagnostics only; no telemetry upload. */
(() => {
  'use strict';
  if (window.BELPerf) return;
  const allowed = new Set([
    'shell', 'rmcsa:activate', 'rmcsa:content', 'rmcsa:render',
    'read-aloud:activate', 'read-aloud:content', 'read-aloud:render',
    'microphone:request', 'audio:prepare', 'assessment:request', 'archive:save'
  ]);
  const records = [];
  const statuses = new Set(['ok', 'error', 'cancelled']);
  let sequence = 0;
  function begin(name, start = performance.now()) {
    if (!allowed.has(name) || !Number.isFinite(start)) return () => {};
    const id = ++sequence;
    let ended = false;
    return (status = 'ok') => {
      if (ended) return;
      ended = true;
      const end = performance.now();
      const safeStatus = statuses.has(status) ? status : 'error';
      const record = Object.freeze({ id, name, status: safeStatus,
        startTime: start, endTime: end, durationMs: Math.max(0, end - start) });
      records.push(record);
      if (records.length > 250) records.shift();
      const entryName = `bel:${name}:${id}`;
      try {
        performance.measure(entryName, { start, end, detail: { status: safeStatus } });
        performance.clearMeasures(entryName);
      } catch (_) { /* Diagnostics must not interrupt a task. */ }
    };
  }
  window.BELPerf = Object.freeze({
    begin,
    snapshot: () => records.map(record => ({ ...record })),
    clear: () => { records.length = 0; }
  });
})();
