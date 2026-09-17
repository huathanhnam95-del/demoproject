/* Public, published question content only. Never use this cache for account data. */
(() => {
  'use strict';
  if (window.BELRmcsaContent) return;
  const MANIFEST = '/content/rmcsa/manifest.json';
  const MAX_BANK_BYTES = 8 * 1024 * 1024; // Proposed guard: validate against the real bank before rollout.
  let cached = null;
  let pending = null;
  class ContentError extends Error {
    constructor(code, message) { super(message); this.name = 'ContentError'; this.code = code; }
  }
  async function readJsonBytes(url, maxBytes, timeoutMs, cache) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, cache, credentials: 'omit' });
      if (!response.ok) throw new ContentError('HTTP', `Content request failed (${response.status}).`);
      if (!/\bjson\b/i.test(response.headers.get('Content-Type') || '')) {
        throw new ContentError('CONTENT_TYPE', 'Expected JSON, not an HTML fallback.');
      }
      const length = Number(response.headers.get('Content-Length'));
      if (Number.isFinite(length) && length > maxBytes) throw new ContentError('SIZE', 'Content exceeds its size budget.');
      let bytes;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        const chunks = [];
        let total = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
              await reader.cancel();
              throw new ContentError('SIZE', 'Content exceeds its size budget.');
            }
            chunks.push(value);
          }
          bytes = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        } finally { reader.releaseLock(); }
      } else {
        bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > maxBytes) throw new ContentError('SIZE', 'Content exceeds its size budget.');
      }
      return bytes;
    } catch (error) {
      if (controller.signal.aborted) throw new ContentError('TIMEOUT', 'The content request timed out.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  function decode(bytes) {
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch (_) { throw new ContentError('JSON', 'Content is not valid JSON.'); }
  }
  function validateManifest(m) {
    const hash = m?.sha256;
    if (m?.schemaVersion !== 1 || m.mode !== 'rmcsa' || !/^[a-f0-9]{64}$/.test(hash || '')
      || m.version !== hash || m.url !== `/content/rmcsa/rmcsa.${hash}.json`
      || !Number.isSafeInteger(m.questionCount) || m.questionCount < 1
      || !Number.isSafeInteger(m.bytes) || m.bytes < 1 || m.bytes > MAX_BANK_BYTES) {
      throw new ContentError('MANIFEST', 'Unsupported or invalid content manifest.');
    }
  }
  function validateBank(bank, manifest) {
    if (bank?.schemaVersion !== 1 || bank.mode !== 'rmcsa' || !Array.isArray(bank.questions)
      || bank.questions.length !== manifest.questionCount) {
      throw new ContentError('SCHEMA', 'Invalid question bank.');
    }
    const ids = new Set();
    let previous = 0;
    for (const q of bank.questions) {
      if (!Number.isSafeInteger(q.id) || q.id <= previous || ids.has(q.id)
        || !['title', 'passage', 'question'].every(k => typeof q[k] === 'string' && q[k].trim())
        || typeof q.explanation !== 'string' || !Array.isArray(q.choices) || q.choices.length < 2
        || q.choices.some(c => typeof c.text !== 'string' || !c.text.trim() || typeof c.isCorrect !== 'boolean')
        || q.choices.filter(c => c.isCorrect).length !== 1) {
        throw new ContentError('SCHEMA', 'Invalid question data.');
      }
      ids.add(q.id); previous = q.id;
      q.choices.forEach(Object.freeze);
      Object.freeze(q.choices); Object.freeze(q);
    }
    Object.freeze(bank.questions);
    return Object.freeze(bank);
  }
  async function fetchBank() {
    const manifest = decode(await readJsonBytes(MANIFEST, 65536, 8000, 'no-cache'));
    validateManifest(manifest);
    const bytes = await readJsonBytes(manifest.url, MAX_BANK_BYTES, 12000, 'default');
    if (bytes.byteLength !== manifest.bytes) throw new ContentError('SIZE', 'Published content size does not match.');
    if (!globalThis.crypto?.subtle) throw new ContentError('ENVIRONMENT', 'Secure content verification is unavailable.');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    if (hash !== manifest.sha256) throw new ContentError('HASH', 'Published content hash does not match.');
    return validateBank(decode(bytes), manifest);
  }
  function waitForCaller(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(new DOMException('Navigation cancelled.', 'AbortError'));
    return new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException('Navigation cancelled.', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
        error => { signal.removeEventListener('abort', abort); reject(error); });
    });
  }
  function load({ signal } = {}) {
    if (cached) return waitForCaller(Promise.resolve(cached), signal);
    if (!pending) {
      pending = fetchBank().then(bank => { cached = bank; pending = null; return bank; },
        error => { pending = null; throw error; });
    }
    // One caller cancelling must not abort another caller's shared read.
    return waitForCaller(pending, signal);
  }
  window.BELRmcsaContent = Object.freeze({ load, ContentError });
})();
