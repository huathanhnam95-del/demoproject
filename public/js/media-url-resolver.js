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

  const MODE_MAP = {
    'ra': 'RA',
    'sst': 'SST',
    'rfib': 'RFIB',
    'hiw': 'HIW',
    'highlight incorrect words': 'HIW',
    'take notes': 'Take-Notes',
    'take-notes': 'Take-Notes',
    'rl': 'Take-Notes',
    'collo-dictate': 'collo-dictate',
    'describe image': 'Describe-Image',
    'describe-image': 'Describe-Image',
    'di': 'Describe-Image',
    'lmcma': 'LMCMA',
    'lmcsa': 'LMCSA',
    'hcs': 'HCS',
    'type': 'type',
    'wfd': 'type',
    'smw': 'SMW',
    'speak': 'speak',
    'rs': 'speak',
    'extended': 'extended',
    'lfib': 'LFIB',
    'sgd': 'SGD',
    'quiz': 'quiz',
    'asq': 'quiz',
    'rts': 'RTS',
    'entrance test': 'Entrance-Test',
    'entrance-test': 'Entrance-Test',
    'echo-forge': 'echo-forge'
  };

  function _canonicalMode(modeStr) {
    if (!modeStr || typeof modeStr !== 'string') return 'unknown';
    const key = modeStr.trim().toLowerCase();
    return MODE_MAP[key] || modeStr;
  }

  function _detectMode(normalizedPath) {
    const parts = normalizedPath.split('/');
    if (parts.length >= 3 && parts[1] === 'database') {
      return _canonicalMode(parts[2]);
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
    const canonMode = _canonicalMode(mode);
    if (_shardCache.has(canonMode)) {
      return Promise.resolve(_shardCache.get(canonMode));
    }
    if (_shardPromises.has(canonMode)) {
      return _shardPromises.get(canonMode);
    }

    const promise = (async () => {
      try {
        const config = await init(options && options.config);
        const modeConfig = (config.modes && (config.modes[canonMode] || config.modes[mode])) || {};
        const publicationId = config.publicationId;
        const deliveryBaseUrl = config.deliveryBaseUrl || '';

        const shardKey = modeConfig.shardKey || ('catalogs/' + publicationId + '/' + canonMode + '.json');
        const shardUrl = deliveryBaseUrl ? (deliveryBaseUrl + shardKey) : ('/' + shardKey);

        let shardData;
        try {
          shardData = await _fetchWithRetry(shardUrl, {}, 1, 200);
        } catch (fetchErr) {
          const localShardUrl = '/' + shardKey;
          if (deliveryBaseUrl && shardUrl !== localShardUrl) {
            shardData = await _fetchWithRetry(localShardUrl, {}, 1, 100);
          } else {
            throw fetchErr;
          }
        }
        _shardCache.set(canonMode, shardData);
        return shardData;
      } finally {
        _shardPromises.delete(canonMode);
      }
    })();

    _shardPromises.set(canonMode, promise);
    return promise;
  }

  function _emitFallbackEvent(detail) {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent('bel:media-fallback', { detail }));
      } catch (_) {
        /* ignore event dispatch failure */
      }
    }
  }

  async function resolveAudioUrl(logicalPath, options) {
    const opts = options || {};
    if (!logicalPath || typeof logicalPath !== 'string') {
      return logicalPath;
    }

    const normalized = _normalizePath(logicalPath);
    const rawMode = opts.mode || _detectMode(normalized);
    const mode = _canonicalMode(rawMode);

    const config = await init(opts.config);
    const modeConfig = (config.modes && (config.modes[mode] || config.modes[rawMode])) || {};
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

  function resolveImageUrl(logicalPath, options) {
    return resolveAudioUrl(logicalPath, options);
  }

  function resolveMediaUrl(logicalPath, options) {
    return resolveAudioUrl(logicalPath, options);
  }

  function loadImage(imgEl, logicalPath, options) {
    const opts = options || {};
    if (!imgEl) return Promise.reject(new Error('imgEl is required'));

    const requestId = ++_requestCounter;
    imgEl.dataset.mediaResolverRequestId = String(requestId);

    return resolveImageUrl(logicalPath, opts).then((resolvedUrl) => {
      if (imgEl.dataset.mediaResolverRequestId !== String(requestId)) {
        return null;
      }

      const mode = _canonicalMode(opts.mode || _detectMode(_normalizePath(logicalPath)));
      const modeConfig = (_config && _config.modes && _config.modes[mode]) || {};
      const rolloutState = opts.rolloutState || modeConfig.state || (_config && _config.defaultRolloutState) || 'remote-with-fallback';

      if (rolloutState === 'remote-with-fallback' && resolvedUrl !== logicalPath) {
        const fallbackHandler = function() {
          if (imgEl.dataset.mediaResolverRequestId !== String(requestId)) return;
          console.warn('[MediaUrlResolver] Image load error on remote URL, falling back to legacy path:', resolvedUrl, '->', logicalPath);
          _emitFallbackEvent({
            logicalPath,
            mode,
            rolloutState,
            error: 'image_element_error',
            timestamp: Date.now()
          });
          imgEl.removeEventListener('error', fallbackHandler);
          imgEl.src = logicalPath;
        };
        imgEl.addEventListener('error', fallbackHandler, { once: true });
      }

      if (opts.crossOrigin) {
        imgEl.crossOrigin = opts.crossOrigin;
      } else if (resolvedUrl && (resolvedUrl.startsWith('http://') || resolvedUrl.startsWith('https://'))) {
        imgEl.crossOrigin = 'anonymous';
      }

      imgEl.src = resolvedUrl;
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
    resolveImageUrl,
    resolveMediaUrl,
    loadAudio,
    loadImage,
    _reset,
    _normalizePath,
    _detectMode,
    _canonicalMode,
    _getShardCache: () => _shardCache,
    _getConfig: () => _config
  };
});
