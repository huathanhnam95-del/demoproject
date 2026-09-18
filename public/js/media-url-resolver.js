'use strict';

/**
 * BEL Media URL Resolver (Stage Three)
 * Resolves local practice media logical paths to content-addressed GCS URLs
 * based on pinned immutable catalog shards with observable fallback and concurrency control.
 */
(function(root, factory) {
  var api = factory();
  if (typeof exports !== 'undefined' && exports) {
    Object.assign(exports, api);
  }
  if (typeof module !== 'undefined' && module && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.MediaUrlResolver = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {

  let _config = null;
  let _initPromise = null;
  let _requestCounter = 0;

  const _shardCache = new Map();
  const _shardPromises = new Map();

  function _normalizePath(rawPath) {
    if (!rawPath || typeof rawPath !== 'string') return '';
    const clean = rawPath.split('?')[0].split('#')[0].trim();
    
    // Security check: reject path traversal and dangerous schemes
    if (clean.includes('..') || clean.startsWith('//') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(clean)) {
      throw new Error('[MediaUrlResolver] Invalid or malicious path rejected: ' + rawPath);
    }

    const withoutLeading = clean.replace(/^[/]+/, '');
    if (!withoutLeading.startsWith('public/')) {
      return 'public/' + withoutLeading;
    }
    return withoutLeading;
  }

  function _detectMode(normalizedPath) {
    const parts = normalizedPath.split('/');
    if (parts.length >= 3 && parts[1] === 'database') {
      return parts[2];
    }
    return 'unknown';
  }

  async function _fetchWithRetry(url, options, retries, delayMs) {
    const opts = options || {};
    const maxRetries = typeof retries === 'number' ? retries : 1;
    const delay = typeof delayMs === 'number' ? delayMs : 150;
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const fetchFn = typeof fetch !== 'undefined' ? fetch : globalThis.fetch;
        const res = await fetchFn(url, opts);
        if (!res.ok) {
          throw new Error('HTTP ' + res.status + ' ' + res.statusText);
        }
        return await res.json();
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, delay * (attempt + 1)));
        }
      }
    }
    throw lastError;
  }

  async function init(configOrUrl) {
    if (_config && !configOrUrl) return _config;
    if (_initPromise && !configOrUrl) return _initPromise;

    if (typeof configOrUrl === 'object' && configOrUrl !== null) {
      _config = configOrUrl;
      return _config;
    }

    const targetUrl = typeof configOrUrl === 'string' ? configOrUrl : '/media-release.json';

    _initPromise = (async () => {
      try {
        const data = await _fetchWithRetry(targetUrl, {}, 1, 100);
        _config = data;
        return _config;
      } catch (err) {
        console.warn('[MediaUrlResolver] Failed to load media release configuration:', err.message);
        _config = {
          defaultRolloutState: 'legacy',
          modes: {}
        };
        return _config;
      } finally {
        _initPromise = null;
      }
    })();

    return _initPromise;
  }

  function _loadShard(mode, options) {
    if (_shardCache.has(mode)) {
      return Promise.resolve(_shardCache.get(mode));
    }
    if (_shardPromises.has(mode)) {
      return _shardPromises.get(mode);
    }

    const promise = (async () => {
      try {
        const config = await init(options && options.config);
        const modeConfig = (config.modes && config.modes[mode]) || {};
        const publicationId = config.publicationId;
        const deliveryBaseUrl = config.deliveryBaseUrl || '';

        const shardKey = modeConfig.shardKey || ('catalogs/' + publicationId + '/' + mode + '.json');
        const shardUrl = deliveryBaseUrl ? (deliveryBaseUrl + shardKey) : ('/' + shardKey);

        const shardData = await _fetchWithRetry(shardUrl, {}, 1, 200);
        _shardCache.set(mode, shardData);
        return shardData;
      } finally {
        _shardPromises.delete(mode);
      }
    })();

    _shardPromises.set(mode, promise);
    return promise;
  }

  function _emitFallbackEvent(detail) {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent('bel:media-fallback', { detail }));
      } catch (_) {}
    }
  }

  async function resolveAudioUrl(logicalPath, options) {
    const opts = options || {};
    if (!logicalPath || typeof logicalPath !== 'string') {
      return logicalPath;
    }

    const normalized = _normalizePath(logicalPath);
    const mode = opts.mode || _detectMode(normalized);

    const config = await init(opts.config);
    const modeConfig = (config.modes && config.modes[mode]) || {};
    const rolloutState = opts.rolloutState || modeConfig.state || config.defaultRolloutState || 'remote-with-fallback';

    if (rolloutState === 'legacy') {
      return logicalPath;
    }

    if (opts.signal && opts.signal.aborted) {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }

    try {
      const shard = await _loadShard(mode, opts);
      if (opts.signal && opts.signal.aborted) {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }

      let asset = shard.assets && (shard.assets[normalized] || shard.assets[decodeURIComponent(normalized)]);

      if (!asset && shard.assets) {
        const decoded = decodeURIComponent(normalized);
        for (const [key, val] of Object.entries(shard.assets)) {
          if (key === normalized || key === decoded || decodeURIComponent(key) === decoded) {
            asset = val;
            break;
          }
        }
      }

      if (asset && asset.key) {
        const deliveryBaseUrl = config.deliveryBaseUrl || '';
        return deliveryBaseUrl + asset.key;
      }

      throw new Error('Asset unmapped in catalog for mode ' + mode + ': ' + normalized);
    } catch (err) {
      if (err.name === 'AbortError') throw err;

      if (rolloutState === 'remote-only') {
        throw new Error('[MediaUrlResolver] Remote resolution failed in remote-only mode: ' + err.message);
      }

      console.warn('[MediaUrlResolver] Fallback to legacy path for ' + logicalPath + ' (' + err.message + ')');
      _emitFallbackEvent({
        logicalPath,
        mode,
        rolloutState,
        error: err.message,
        timestamp: Date.now()
      });

      return logicalPath;
    }
  }

  function loadAudio(audioEl, logicalPath, options) {
    const opts = options || {};
    if (!audioEl) return Promise.reject(new Error('audioEl is required'));

    const requestId = ++_requestCounter;
    audioEl.dataset.mediaResolverRequestId = String(requestId);

    return resolveAudioUrl(logicalPath, opts).then((resolvedUrl) => {
      if (audioEl.dataset.mediaResolverRequestId !== String(requestId)) {
        return null;
      }

      const mode = opts.mode || _detectMode(_normalizePath(logicalPath));
      const modeConfig = (_config && _config.modes && _config.modes[mode]) || {};
      const rolloutState = opts.rolloutState || modeConfig.state || (_config && _config.defaultRolloutState) || 'remote-with-fallback';

      if (rolloutState === 'remote-with-fallback' && resolvedUrl !== logicalPath) {
        const fallbackHandler = function() {
          if (audioEl.dataset.mediaResolverRequestId !== String(requestId)) return;
          console.warn('[MediaUrlResolver] Audio playback error on remote URL, falling back to legacy path:', resolvedUrl, '->', logicalPath);
          _emitFallbackEvent({
            logicalPath,
            mode,
            rolloutState,
            error: 'audio_element_error',
            timestamp: Date.now()
          });
          audioEl.removeEventListener('error', fallbackHandler);
          audioEl.src = logicalPath;
          audioEl.load();
        };
        audioEl.addEventListener('error', fallbackHandler, { once: true });
      }

      audioEl.src = resolvedUrl;
      audioEl.load();
      return resolvedUrl;
    });
  }

  function _reset() {
    _config = null;
    _initPromise = null;
    _shardCache.clear();
    _shardPromises.clear();
    _requestCounter = 0;
  }

  return {
    init,
    resolveAudioUrl,
    loadAudio,
    _reset,
    _normalizePath,
    _detectMode,
    _getShardCache: () => _shardCache,
    _getConfig: () => _config
  };
});
