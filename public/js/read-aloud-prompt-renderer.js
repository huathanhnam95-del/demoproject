(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }
  root.ReadAloudPromptRenderer = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function renderPrompt(options) {
    const {
      visibleContainer,
      accessibleContainer,
      plainText,
      chunkedText,
      chunkingEnabled,
      grammar
    } = options || {};

    if (!visibleContainer || !accessibleContainer || !grammar) {
      return {
        wordMap: new Map(),
        blockedBoundarySet: new Set(),
        chunkingAvailable: false,
        renderDiagnostics: { reason: 'missing_container_or_grammar' }
      };
    }

    const safePlainText = typeof plainText === 'string' ? plainText : '';
    const safeChunkedText = typeof chunkedText === 'string' ? chunkedText : '';
    accessibleContainer.textContent = safePlainText;

    const validation = safeChunkedText && typeof grammar.validateChunkedPrompt === 'function'
      ? grammar.validateChunkedPrompt(safePlainText, safeChunkedText)
      : { ok: false, reason: 'missing_chunked_text' };
    const comparison = validation.ok
      ? grammar.compareCanonicalPrompt(safePlainText, safeChunkedText)
      : { ok: false, reason: validation.reason, diagnostics: validation.diagnostics || null };
    const useChunking = !!chunkingEnabled && validation.ok;
    const renderSource = useChunking ? safeChunkedText : safePlainText;
    const tokens = grammar.tokenizePrompt(renderSource, { allowChunkMarkers: useChunking });
    const boundaryState = grammar.buildSpokenBoundaryKeys(tokens);
    const wordMap = new Map();

    visibleContainer.innerHTML = '';
    visibleContainer.setAttribute('aria-hidden', 'true');
    visibleContainer.style.whiteSpace = 'pre-wrap';
    visibleContainer.style.wordBreak = 'break-word';

    tokens.forEach((token) => {
      if (token.type === 'spoken') {
        const span = document.createElement('span');
        span.className = 'ra-prompt-word';
        span.dataset.wordIndex = String(token.wordIndex);
        span.textContent = token.display || token.raw;
        visibleContainer.appendChild(span);
        wordMap.set(token.wordIndex, span);
        return;
      }

      if (token.type === 'chunk_short' || token.type === 'chunk_long') {
        const marker = document.createElement('span');
        marker.className = `ra-chunk-marker ${token.type === 'chunk_long' ? 'ra-chunk-long' : 'ra-chunk-short'}`;
        marker.textContent = token.type === 'chunk_long' ? ' // ' : ' / ';
        marker.setAttribute('aria-hidden', 'true');
        marker.style.color = token.type === 'chunk_long' ? '#1d4ed8' : '#2563eb';
        marker.style.fontWeight = '700';
        visibleContainer.appendChild(marker);
        return;
      }

      if (token.type === 'linebreak') {
        visibleContainer.appendChild(document.createElement('br'));
        return;
      }

      visibleContainer.appendChild(document.createTextNode(token.raw));
    });

    return {
      wordMap,
      blockedBoundarySet: boundaryState.blockedBoundarySet,
      chunkingAvailable: validation.ok,
      renderDiagnostics: {
        validation,
        comparison,
        usedChunking: useChunking,
        tokenCount: tokens.length
      }
    };
  }

  return {
    renderPrompt
  };
}));
