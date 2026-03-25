(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }
  root.ReadAloudPromptGrammar = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TOKEN_PATTERNS = {
    chunkLong: /^\/\/(?=\s|$)/,
    chunkShort: /^\/(?=\s|$)/,
    abbreviation: /^(?:[A-Za-z]{1,3}\.){2,}|^(?:[AaPp])\.[Mm]\.|^(?:Mr|Mrs|Ms|Dr|Prof)\.|^[A-Z]{2,5}(?=\s|$|[.,!?;:])/,
    time: /^\d{1,2}:\d{2}/,
    decimal: /^\d+\.\d+/,
    word: /^[A-Za-z0-9]+(?:['\u2019-][A-Za-z0-9]+)*/,
    linebreak: /^\r?\n+/,
    space: /^[^\S\r\n]+/
  };

  function tokenizePrompt(text, options = {}) {
    const source = typeof text === 'string' ? text : '';
    const allowChunkMarkers = options.allowChunkMarkers !== false;
    const tokens = [];
    let index = 0;
    let spokenIndex = 0;

    while (index < source.length) {
      const rest = source.slice(index);

      if (allowChunkMarkers) {
        const longMatch = rest.match(TOKEN_PATTERNS.chunkLong);
        if (longMatch && hasChunkBoundaryContext(source, index, longMatch[0].length)) {
          tokens.push(buildToken(tokens.length, 'chunk_long', longMatch[0], null));
          index += longMatch[0].length;
          continue;
        }

        const shortMatch = rest.match(TOKEN_PATTERNS.chunkShort);
        if (shortMatch && hasChunkBoundaryContext(source, index, shortMatch[0].length)) {
          tokens.push(buildToken(tokens.length, 'chunk_short', shortMatch[0], null));
          index += shortMatch[0].length;
          continue;
        }
      }

      const linebreakMatch = rest.match(TOKEN_PATTERNS.linebreak);
      if (linebreakMatch) {
        tokens.push(buildToken(tokens.length, 'linebreak', linebreakMatch[0], null));
        index += linebreakMatch[0].length;
        continue;
      }

      const spaceMatch = rest.match(TOKEN_PATTERNS.space);
      if (spaceMatch) {
        tokens.push(buildToken(tokens.length, 'space', spaceMatch[0], null));
        index += spaceMatch[0].length;
        continue;
      }

      const abbreviationMatch = rest.match(TOKEN_PATTERNS.abbreviation);
      if (abbreviationMatch) {
        const raw = abbreviationMatch[0];
        tokens.push(buildToken(tokens.length, 'spoken', raw, 'abbreviation', spokenIndex));
        spokenIndex += 1;
        index += raw.length;
        continue;
      }

      const timeMatch = rest.match(TOKEN_PATTERNS.time);
      if (timeMatch) {
        const raw = timeMatch[0];
        tokens.push(buildToken(tokens.length, 'spoken', raw, 'time', spokenIndex));
        spokenIndex += 1;
        index += raw.length;
        continue;
      }

      const decimalMatch = rest.match(TOKEN_PATTERNS.decimal);
      if (decimalMatch) {
        const raw = decimalMatch[0];
        tokens.push(buildToken(tokens.length, 'spoken', raw, 'decimal', spokenIndex));
        spokenIndex += 1;
        index += raw.length;
        continue;
      }

      const wordMatch = rest.match(TOKEN_PATTERNS.word);
      if (wordMatch) {
        const raw = wordMatch[0];
        const subtype = /\d/.test(raw) ? 'number' : 'word';
        tokens.push(buildToken(tokens.length, 'spoken', raw, subtype, spokenIndex));
        spokenIndex += 1;
        index += raw.length;
        continue;
      }

      tokens.push(buildToken(tokens.length, 'punct', rest[0], null));
      index += 1;
    }

    return tokens;
  }

  function buildToken(sequence, type, raw, subtype, spokenIndex) {
    const token = {
      id: `tok-${sequence}`,
      type,
      raw
    };

    if (type === 'spoken') {
      token.subtype = subtype;
      token.display = raw;
      token.normalized = raw.toLowerCase();
      token.wordIndex = spokenIndex;
    }

    return token;
  }

  function hasChunkBoundaryContext(source, startIndex, length) {
    const before = source[startIndex - 1] || ' ';
    const after = source[startIndex + length] || ' ';
    return /\s/.test(before) && /\s/.test(after);
  }

  function stripChunkMarkers(text) {
    const tokens = tokenizePrompt(text, { allowChunkMarkers: true });
    return tokens
      .filter((token) => token.type !== 'chunk_short' && token.type !== 'chunk_long')
      .map((token) => token.raw)
      .join('');
  }

  function compareCanonicalPrompt(plainText, chunkedText) {
    const plainTokens = normalizeComparableTokens(tokenizePrompt(plainText, { allowChunkMarkers: false }));
    const chunkedTokens = normalizeComparableTokens(
      tokenizePrompt(chunkedText, { allowChunkMarkers: true })
        .filter((token) => token.type !== 'chunk_short' && token.type !== 'chunk_long')
    );

    const max = Math.max(plainTokens.length, chunkedTokens.length);
    for (let index = 0; index < max; index += 1) {
      const leftToken = plainTokens[index] || null;
      const rightToken = chunkedTokens[index] || null;
      if (!leftToken || !rightToken) {
        return {
          ok: false,
          reason: 'length_mismatch',
          firstMismatchIndex: index,
          leftToken,
          rightToken
        };
      }
      if (leftToken.type !== rightToken.type || leftToken.value !== rightToken.value) {
        return {
          ok: false,
          reason: 'token_mismatch',
          firstMismatchIndex: index,
          leftToken,
          rightToken
        };
      }
    }

    return {
      ok: true,
      reason: null,
      firstMismatchIndex: -1,
      leftToken: null,
      rightToken: null
    };
  }

  function validateChunkedPrompt(plainText, chunkedText) {
    const safePlainText = typeof plainText === 'string' ? plainText : '';
    const safeChunkedText = typeof chunkedText === 'string' ? chunkedText : '';
    if (!safePlainText) {
      return { ok: false, reason: 'missing_plain_text' };
    }
    if (!safeChunkedText) {
      return { ok: false, reason: 'missing_chunked_text' };
    }

    const tokens = tokenizePrompt(safeChunkedText, { allowChunkMarkers: true });
    const meaningfulTokens = tokens.filter((token) => token.type !== 'space' && token.type !== 'linebreak');
    if (meaningfulTokens[0]?.type === 'chunk_short' || meaningfulTokens[0]?.type === 'chunk_long') {
      return { ok: false, reason: 'leading_or_trailing_marker' };
    }
    if (meaningfulTokens[meaningfulTokens.length - 1]?.type === 'chunk_short' || meaningfulTokens[meaningfulTokens.length - 1]?.type === 'chunk_long') {
      return { ok: false, reason: 'leading_or_trailing_marker' };
    }

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token.type !== 'chunk_short' && token.type !== 'chunk_long') continue;

      const previousMeaningful = findNearestMeaningful(tokens, index, -1);
      const nextMeaningful = findNearestMeaningful(tokens, index, 1);
      if (!previousMeaningful || !nextMeaningful) {
        return { ok: false, reason: 'leading_or_trailing_marker' };
      }
      if (
        previousMeaningful.type === 'chunk_short'
        || previousMeaningful.type === 'chunk_long'
        || nextMeaningful.type === 'chunk_short'
        || nextMeaningful.type === 'chunk_long'
      ) {
        return { ok: false, reason: 'consecutive_markers' };
      }

      const leftSpoken = findNearestSpoken(tokens, index, -1);
      const rightSpoken = findNearestSpoken(tokens, index, 1);
      if (!leftSpoken || !rightSpoken) {
        return { ok: false, reason: 'empty_chunk_segment' };
      }
    }

    const comparison = compareCanonicalPrompt(safePlainText, safeChunkedText);
    if (!comparison.ok) {
      return {
        ok: false,
        reason: comparison.reason,
        diagnostics: comparison
      };
    }

    return {
      ok: true,
      reason: null,
      diagnostics: null
    };
  }

  function normalizeComparableTokens(tokens) {
    const comparable = [];
    let pendingSpace = false;

    tokens.forEach((token) => {
      if (token.type === 'space' || token.type === 'linebreak') {
        pendingSpace = comparable.length > 0;
        return;
      }

      if (pendingSpace) {
        comparable.push({ type: 'space', value: ' ' });
        pendingSpace = false;
      }

      if (token.type === 'spoken') {
        comparable.push({ type: 'spoken', value: normalizeComparableValue(token.raw) });
        return;
      }

      comparable.push({ type: token.type, value: normalizeComparableValue(token.raw) });
    });

    if (comparable[comparable.length - 1]?.type === 'space') {
      comparable.pop();
    }

    return comparable;
  }

  function buildSpokenBoundaryKeys(tokens) {
    const blockedBoundarySet = new Set();
    const spokenTokens = tokens.filter((token) => token.type === 'spoken');
    const spokenByIndex = new Map(spokenTokens.map((token) => [token.wordIndex, token]));

    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token.type !== 'chunk_short' && token.type !== 'chunk_long') continue;

      const left = findNearestSpoken(tokens, i, -1);
      const right = findNearestSpoken(tokens, i, 1);
      if (!left || !right) continue;
      blockedBoundarySet.add(`${left.wordIndex}:${right.wordIndex}`);
    }

    return {
      blockedBoundarySet,
      spokenTokens,
      spokenByIndex
    };
  }

  function findNearestSpoken(tokens, startIndex, step) {
    let index = startIndex + step;
    while (index >= 0 && index < tokens.length) {
      if (tokens[index].type === 'spoken') return tokens[index];
      index += step;
    }
    return null;
  }

  function findNearestMeaningful(tokens, startIndex, step) {
    let index = startIndex + step;
    while (index >= 0 && index < tokens.length) {
      const token = tokens[index];
      if (token.type !== 'space' && token.type !== 'linebreak') return token;
      index += step;
    }
    return null;
  }

  function normalizeComparableValue(value) {
    return String(value || '')
      .replace(/[\u2018\u2019]/g, '\'')
      .replace(/[\u201C\u201D]/g, '"');
  }

  return {
    tokenizePrompt,
    stripChunkMarkers,
    compareCanonicalPrompt,
    validateChunkedPrompt,
    buildSpokenBoundaryKeys
  };
}));
