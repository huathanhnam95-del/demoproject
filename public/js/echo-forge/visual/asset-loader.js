const MANIFEST_URL = '/assets/echo-forge/v1/visual-manifest.v1.json';
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const EXPECTED_ASSET_IDS = Object.freeze(['ef-hero-idle', 'ef-enemy-idle', 'ef-analysis-hold', 'ef-combat-result']);

function assert(condition, message) { if (!condition) throw new Error(`visual asset manifest invalid: ${message}`); }
function toHex(bytes) { return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
function containedPath(baseUrl, assetPath) {
  const resolved = new URL(assetPath, baseUrl);
  assert(resolved.origin === baseUrl.origin, 'asset path must remain same-origin');
  assert(!resolved.pathname.split('/').includes('..'), 'asset path traversal is not allowed');
  assert(resolved.pathname.startsWith('/assets/echo-forge/v1/'), 'asset path must remain in the visual asset root');
  return resolved;
}
function pngInfo(bytes) {
  const data = new Uint8Array(bytes);
  assert(PNG_SIGNATURE.every((value, index) => data[index] === value), 'PNG signature');
  const view = new DataView(bytes);
  return { width: view.getUint32(16), height: view.getUint32(20), alpha: data[25] === 6 || data[25] === 4 };
}

export function validateVisualManifest(manifest) {
  assert(manifest && manifest.schemaVersion === 'echo-forge-visual-manifest-v1', 'schemaVersion');
  assert(manifest.manifestStage === 'production-ready', 'manifestStage');
  assert(manifest.provenance?.kind === 'project-authored-deterministic-vector', 'project provenance');
  assert(Array.isArray(manifest.assetIds) && Array.isArray(manifest.assets), 'asset collections');
  assert(new Set(manifest.assetIds).size === manifest.assetIds.length, 'duplicate asset IDs');
  assert(manifest.assetIds.length === EXPECTED_ASSET_IDS.length && EXPECTED_ASSET_IDS.every((assetId) => manifest.assetIds.includes(assetId)), 'unexpected or missing asset IDs');
  assert(manifest.assetIds.length === manifest.assets.length, 'asset ID list mismatch');
  const seenIds = new Set();
  for (const asset of manifest.assets) {
    assert(!seenIds.has(asset.assetId), `duplicate asset ID ${asset.assetId}`);
    seenIds.add(asset.assetId);
    assert(manifest.assetIds.includes(asset.assetId), `unlisted asset ${asset.assetId}`);
    assert(Array.isArray(asset.frames) && asset.frames.length > 0, `${asset.assetId} frames`);
    const frameIndices = asset.frames.map((frame) => frame.frameIndex);
    assert(new Set(frameIndices).size === frameIndices.length, `${asset.assetId} duplicate frame index`);
    assert(new Set(asset.frames.map((frame) => frame.name)).size === asset.frames.length, `${asset.assetId} duplicate frame name`);
    assert(frameIndices.every((index, position) => index === position), `${asset.assetId} frame order`);
    assert(asset.staticFallbackFrame < asset.frames.length, `${asset.assetId} fallback frame`);
    for (const frame of asset.frames) assert(frame.width === asset.canvas.width && frame.height === asset.canvas.height && /^[0-9a-f]{64}$/.test(frame.sha256), `${asset.assetId}/${frame.name} frame contract`);
  }
  return manifest;
}

export function createVisualAssetLoader({ fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto, URLApi = globalThis.URL, BlobClass = globalThis.Blob, manifestUrl = MANIFEST_URL } = {}) {
  let loaded = null;
  let disposed = false;
  const objectUrls = [];
  async function load() {
    if (loaded) return loaded;
    if (disposed) throw new Error('visual asset loader is disposed');
    const baseUrl = new URL(manifestUrl, globalThis.location?.href || 'http://localhost/');
    if (globalThis.location?.origin) assert(baseUrl.origin === globalThis.location.origin, 'manifest must be same-origin');
    const response = await fetchImpl(baseUrl.href);
    assert(response.ok, `manifest request failed (${response.status})`);
    const manifest = validateVisualManifest(await response.json());
    const assets = new Map();
    for (const asset of manifest.assets) {
      const frames = [];
      for (const frame of asset.frames) {
        const frameUrl = containedPath(baseUrl, frame.path);
        const bytes = await (await fetchImpl(frameUrl.href)).arrayBuffer();
        const digest = toHex(await cryptoImpl.subtle.digest('SHA-256', bytes));
        assert(digest === frame.sha256, `${asset.assetId}/${frame.name} SHA-256`);
        const info = pngInfo(bytes);
        assert(info.width === frame.width && info.height === frame.height && info.alpha === true, `${asset.assetId}/${frame.name} dimensions/alpha`);
        const objectUrl = URLApi.createObjectURL(new BlobClass([bytes], { type: 'image/png' }));
        objectUrls.push(objectUrl);
        frames.push(Object.freeze({ ...frame, url: objectUrl }));
      }
      assets.set(asset.assetId, Object.freeze({ ...asset, frames: Object.freeze(frames) }));
    }
    loaded = Object.freeze({ manifest, assets });
    return loaded;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const objectUrl of objectUrls.splice(0)) URLApi.revokeObjectURL(objectUrl);
    loaded = null;
  }
  return Object.freeze({ load, dispose, isReady: () => Boolean(loaded), getLoaded: () => loaded });
}
