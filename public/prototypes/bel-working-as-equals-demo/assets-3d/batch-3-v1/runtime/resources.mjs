// Explicit, reference-counted cache for immutable shared GPU resources
// (geometries, materials) and immutable AnimationClips. The integration owner
// normally creates one cache per window and passes it to every createAsset()
// call; an asset created without one owns a private cache.
//
// Rules: shared values are read-only. A value is disposed exactly once, when
// its last holder releases it. Mutable per-instance state (for example an
// avatar's clothing material) never lives here.

function disposeValue(value) {
  if (!value) return;
  if (typeof value.dispose === 'function') { value.dispose(); return; }
  if (Array.isArray(value)) { value.forEach(disposeValue); return; }
  if (typeof value === 'object') for (const v of Object.values(value)) if (v && typeof v.dispose === 'function') v.dispose();
}

export function createResourceCache(THREE) {
  if (!THREE || typeof THREE.BufferGeometry !== 'function') throw new TypeError('createResourceCache requires the injected THREE namespace.');
  const entries = new Map();
  return {
    THREE,
    acquire(key, create) {
      let entry = entries.get(key);
      if (!entry) { entry = { value: create(), refs: 0 }; entries.set(key, entry); }
      entry.refs++;
      return entry.value;
    },
    release(key) {
      const entry = entries.get(key);
      if (!entry) return false;
      entry.refs--;
      if (entry.refs <= 0) { entries.delete(key); disposeValue(entry.value); }
      return true;
    },
    has: key => entries.has(key),
    refs: key => entries.get(key)?.refs ?? 0,
    stats: () => [...entries].map(([key, entry]) => ({ key, refs: entry.refs })),
    get size() { return entries.size; }
  };
}

// Per-instance bookkeeping: which shared keys this instance acquired and which
// resources it exclusively owns. dispose() is idempotent.
export function createInstanceScope(THREE, resources) {
  const privateCache = !resources;
  const cache = resources || createResourceCache(THREE);
  if (cache.THREE !== THREE) throw new TypeError('resources was created with a different THREE namespace than the one injected.');
  const keys = [], owned = [];
  let disposed = false;
  return {
    cache,
    shared(key, create) { const value = cache.acquire(key, create); keys.push(key); return value; },
    own(resource) { owned.push(resource); return resource; },
    get disposed() { return disposed; },
    dispose() {
      if (disposed) return false;
      disposed = true;
      for (const resource of owned.splice(0)) resource.dispose();
      for (const key of keys.splice(0)) cache.release(key);
      return true;
    },
    privateCache
  };
}
