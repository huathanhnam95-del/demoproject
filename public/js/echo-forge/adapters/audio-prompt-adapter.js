const MANIFEST_URL = '/database/echo-forge/audio-manifest.v1.json';
const AUDIO_ROOT = '/database/echo-forge/audio/v1/';
const SHA256 = /^[a-f0-9]{64}$/i;
const PROVIDER_REVISION = 'kokoro-v1';
const GENERATOR_REVISION = 'echo-forge-listening-audio-v1';

function abortError(message = 'audio operation cancelled') {
  if (typeof DOMException === 'function') return new DOMException(message, 'AbortError');
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function sameOriginUrl(value, baseOrigin) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.includes('..') || value.includes('://')) {
    throw new Error('audio URL must be a same-origin, non-traversal path');
  }
  const parsed = new URL(value, baseOrigin);
  if (parsed.origin !== baseOrigin || parsed.pathname !== value || parsed.search || parsed.hash) {
    throw new Error('audio URL must be a same-origin, non-traversal path');
  }
  if (!value.startsWith(AUDIO_ROOT) || !/^\/database\/echo-forge\/audio\/v1\/(a1|a2|b1|b2|c1)\/listening\/\d{3}\.wav$/.test(value)) {
    throw new Error('audio URL is outside the Echo Forge audio root');
  }
  return parsed.href;
}

function assertHash(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} is not a SHA-256 hash`);
  return value.toLowerCase();
}

function listeningChallenges(catalog) {
  if (!catalog || catalog.locale !== 'en-US' || typeof catalog.sourceSha256 !== 'string') throw new Error('catalog binding is invalid');
  return catalog.challenges
    .filter((challenge) => challenge.challengeKind === 'listening' && challenge.unitType === 'listening')
    .sort((left, right) => left.challengeId.localeCompare(right.challengeId));
}

export function validatePromptManifest(manifest, catalog, { baseOrigin = globalThis.location?.origin || 'http://echo-forge.local' } = {}) {
  if (!manifest || manifest.schemaVersion !== 'echo-forge-audio-manifest-v1' || manifest.audioVersion !== 'v1' || manifest.provider !== 'kokoro') {
    throw new Error('audio manifest schema or provider is invalid');
  }
  if (manifest.contentVersion !== catalog.contentVersion || manifest.locale !== catalog.locale || manifest.catalogSourceSha256 !== catalog.sourceSha256) {
    throw new Error('audio manifest source/content binding is invalid');
  }
  if (manifest.providerRevision !== PROVIDER_REVISION || manifest.generatorRevision !== GENERATOR_REVISION
    || typeof manifest.generatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(manifest.generatedAt) || Number.isNaN(Date.parse(manifest.generatedAt))) {
    throw new Error('audio manifest revision metadata is invalid');
  }
  if (manifest.model?.id !== 'kokoro' || manifest.voice?.id !== 'af_heart') throw new Error('audio manifest model or voice is invalid');
  assertHash(manifest.model?.sha256, 'manifest model hash');
  assertHash(manifest.voice?.sha256, 'manifest voice hash');
  if (manifest.provenance?.license !== 'Apache-2.0') throw new Error('audio manifest provenance is invalid');
  const challenges = listeningChallenges(catalog);
  if (challenges.length !== 30 || !Array.isArray(manifest.entries) || manifest.entries.length !== challenges.length) {
    throw new Error('audio manifest must contain exactly 30 listening entries');
  }
  const seen = new Set();
  const entries = manifest.entries.map((entry, index) => {
    const challenge = challenges[index];
    if (!entry || entry.challengeId !== challenge.challengeId || seen.has(entry.challengeId)) throw new Error('audio manifest entries are not sorted or unique');
    seen.add(entry.challengeId);
    const expectedPath = `/database/echo-forge/audio/v1/${challenge.level.toLowerCase()}/listening/${challenge.challengeId.slice(-3)}.wav`;
    if (entry.level !== challenge.level || entry.sourceId !== challenge.provenance.sourceId || entry.contentHash !== challenge.contentHash || entry.audioIdentitySha256 !== challenge.audio.identitySha256) {
      throw new Error(`audio manifest identity binding failed for ${challenge.challengeId}`);
    }
    if (entry.path !== expectedPath) throw new Error(`audio manifest path binding failed for ${challenge.challengeId}`);
    sameOriginUrl(entry.path, baseOrigin);
    assertHash(entry.sha256, `${challenge.challengeId} audio hash`);
    if ((entry.artifactStatus != null && entry.artifactStatus !== 'generated') || entry.status !== 'verified' || entry.reviewStatus !== 'automated_verified' || entry.reviewMethod !== 'structural_audio_validation') {
      throw new Error(`audio manifest status is invalid for ${challenge.challengeId}`);
    }
    return Object.freeze({ ...entry });
  });
  return Object.freeze({ ...manifest, entries: Object.freeze(entries) });
}

export function createAudioPromptAdapter({
  fetchImpl = globalThis.fetch,
  AudioClass = globalThis.Audio,
  URLApi = globalThis.URL,
  BlobClass = globalThis.Blob,
  cryptoImpl = globalThis.crypto,
  manifestUrl = MANIFEST_URL,
  baseOrigin = globalThis.location?.origin || 'http://echo-forge.local',
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('audio prompt fetch implementation is required');
  if (!cryptoImpl?.subtle?.digest) throw new TypeError('Web Crypto subtle.digest is required');
  const resolvedManifestUrl = new URL(manifestUrl, baseOrigin);
  if (resolvedManifestUrl.origin !== baseOrigin || resolvedManifestUrl.pathname !== MANIFEST_URL || resolvedManifestUrl.search || resolvedManifestUrl.hash) {
    throw new Error('audio manifest URL must be same-origin');
  }
  const cache = new Map();
  let manifest = null;
  let catalog = null;
  let activeAudio = null;
  let activeReject = null;
  let operationGeneration = 0;
  let disposed = false;
  const pendingRequests = new Map();

  function stopActive(reason = 'audio operation cancelled') {
    const reject = activeReject;
    activeReject = null;
    if (activeAudio) {
      activeAudio.pause?.();
      activeAudio.removeAttribute?.('src');
      activeAudio.load?.();
      activeAudio = null;
    }
    reject?.(abortError(reason));
  }

  function abortPendingRequests(kind) {
    for (const [controller, requestKind] of pendingRequests) {
      if (!kind || kind === requestKind) controller.abort();
    }
  }

  async function fetchWithAbort(url, options, kind) {
    const controller = new AbortController();
    pendingRequests.set(controller, kind);
    try {
      return await fetchImpl(url, { ...options, signal: controller.signal });
    } finally {
      pendingRequests.delete(controller);
    }
  }

  async function digestHex(bytes) {
    const digest = await cryptoImpl.subtle.digest('SHA-256', bytes.slice().buffer);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  async function load(catalogInput) {
    if (disposed) throw abortError('audio adapter disposed');
    if (!catalogInput) throw new TypeError('catalog is required to bind audio manifest');
    const generation = operationGeneration;
    const response = await fetchWithAbort(resolvedManifestUrl.href, { headers: { accept: 'application/json' } }, 'manifest');
    if (generation !== operationGeneration || disposed) throw abortError();
    if (!response?.ok) throw new Error(`audio manifest request failed (${response?.status || 'unknown'})`);
    const loaded = await response.json();
    if (generation !== operationGeneration || disposed) throw abortError();
    manifest = validatePromptManifest(loaded, catalogInput, { baseOrigin });
    catalog = catalogInput;
    return manifest;
  }

  function entryFor(challenge) {
    if (!manifest || !catalog) throw new Error('audio manifest is not ready');
    const challengeId = typeof challenge === 'string' ? challenge : challenge?.challengeId;
    const entry = manifest.entries.find((candidate) => candidate.challengeId === challengeId);
    const expected = catalog.challenges.find((candidate) => candidate.challengeId === challengeId);
    if (!entry || !expected) throw new Error('listening challenge is not in the verified audio manifest');
    if (typeof challenge === 'object' && (challenge.contentHash !== expected.contentHash || challenge.audio?.identitySha256 !== expected.audio.identitySha256)) {
      throw new Error('challenge identity does not match the verified audio manifest');
    }
    return entry;
  }

  async function bytesFor(entry, generation) {
    const cached = cache.get(entry.challengeId);
    if (cached) return cached;
    const url = sameOriginUrl(entry.path, baseOrigin);
    const response = await fetchWithAbort(url, { headers: { accept: 'audio/wav' } }, 'audio');
    if (generation !== operationGeneration || disposed) throw abortError();
    if (!response?.ok) throw new Error(`audio request failed (${response?.status || 'unknown'})`);
    const mime = response.headers?.get?.('content-type')?.toLowerCase() || '';
    if (!/^audio\/(?:x-)?wav(?:\s*;|$)/.test(mime)) throw new Error('audio response MIME type is not audio/wav');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const actualHash = await digestHex(bytes);
    if (generation !== operationGeneration || disposed) throw abortError();
    if (actualHash !== entry.sha256) throw new Error(`audio hash mismatch for ${entry.challengeId}`);
    if (typeof BlobClass !== 'function' || typeof URLApi?.createObjectURL !== 'function') throw new Error('audio Blob URL support is unavailable');
    const blob = new BlobClass([bytes], { type: 'audio/wav' });
    const objectUrl = URLApi.createObjectURL(blob);
    const result = Object.freeze({ blob, objectUrl });
    cache.set(entry.challengeId, result);
    return result;
  }

  function play(challenge) {
    if (disposed) return Promise.reject(abortError('audio adapter disposed'));
    if (typeof AudioClass !== 'function') return Promise.reject(new Error('HTMLAudioElement is unavailable'));
    const generation = ++operationGeneration;
    stopActive('previous audio playback cancelled');
    abortPendingRequests();
    let entry;
    try { entry = entryFor(challenge); } catch (error) { return Promise.reject(error); }
    return bytesFor(entry, generation).then(({ objectUrl }) => new Promise((resolve, reject) => {
      if (generation !== operationGeneration || disposed) { reject(abortError()); return; }
      const audio = new AudioClass();
      activeAudio = audio;
      activeReject = reject;
      const clear = () => {
        audio.removeEventListener?.('ended', onEnded);
        audio.removeEventListener?.('error', onError);
        if (activeAudio === audio) { activeAudio = null; activeReject = null; }
      };
      const onEnded = () => { clear(); resolve({ challengeId: entry.challengeId }); };
      const onError = () => { clear(); reject(new Error('audio playback failed')); };
      audio.preload = 'auto';
      audio.src = objectUrl;
      audio.addEventListener?.('ended', onEnded, { once: true });
      audio.addEventListener?.('error', onError, { once: true });
      Promise.resolve(audio.play?.()).catch((error) => { clear(); reject(error); });
    }));
  }

  function cancel() {
    operationGeneration += 1;
    abortPendingRequests();
    stopActive();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancel();
    for (const cached of cache.values()) URLApi.revokeObjectURL?.(cached.objectUrl);
    cache.clear();
    manifest = null;
    catalog = null;
  }

  return Object.freeze({
    load,
    play,
    cancel,
    dispose,
    isReady: () => Boolean(manifest && !disposed),
    getManifest: () => manifest,
  });
}

export { AUDIO_ROOT, MANIFEST_URL, sameOriginUrl };
export const validateAudioManifest = validatePromptManifest;
