/* eslint-disable no-use-before-define */
(function (root) {
  'use strict';

  const ENABLE_LINK_LABELS = false;
  const DESKTOP_MIN_WIDTH = 560;
  const LINE_TOLERANCE_PX = 8;
  const VOWEL_LETTERS = /[aeiou]/i;
  const OBVIOUS_WORD_PATTERN = /^[a-z]+(?:['-][a-z]+)*$/i;
  const ORTHOGRAPHIC_FALLBACK_BLOCKLIST = new Set(['hour']);
  const AMBIGUOUS_FINAL_SPELLING_PATTERNS = [/mb$/i, /bt$/i, /mn$/i, /gue$/i, /que$/i];
  const REDUCED_WORD_HINTS = new Set(['a', 'an', 'the', 'to', 'of', 'and', 'for', 'can', 'have', 'has', 'was', 'were']);
  const grammarApi = root.ReadAloudPromptGrammar || loadGrammarApi();
  const spokenFormsApi = root.ReadAloudSpokenForms || loadSpokenFormsApi() || root.ReadAloudSpokenForms;
  const connectedSpeechRulesApi = root.ReadAloudConnectedSpeechRules || loadConnectedSpeechRulesApi() || root.ReadAloudConnectedSpeechRules;

  function tokenizePrompt(text) {
    if (grammarApi?.tokenizePrompt) {
      return grammarApi.tokenizePrompt(text, { allowChunkMarkers: false }).map((token) => {
        if (token.type === 'spoken') {
          return {
            ...token,
            type: 'word',
            display: token.display || token.raw,
            normalized: token.normalized || String(token.raw || '').toLowerCase(),
            subtype: token.subtype || inferTokenSubtype(token.raw)
          };
        }
        if (token.type === 'linebreak') {
          return { ...token, type: 'linebreak' };
        }
        if (token.type === 'space') {
          return { ...token, type: 'space' };
        }
        if (token.type === 'word') {
          return {
            ...token,
            type: 'word',
            display: token.display || token.raw,
            normalized: token.normalized || String(token.raw || '').toLowerCase(),
            subtype: token.subtype || inferTokenSubtype(token.raw)
          };
        }
        return { ...token, type: 'punct' };
      });
    }

    return [];
  }

  function loadGrammarApi() {
    if (typeof require !== 'function') return null;
    try {
      return require('./read-aloud-prompt-grammar.js');
    } catch (_) {
      return null;
    }
  }

  function loadSpokenFormsApi() {
    if (typeof require !== 'function') return null;
    try {
      require('./read-aloud-spoken-forms.js');
      return typeof root !== 'undefined' ? root.ReadAloudSpokenForms : null;
    } catch (_) {
      return null;
    }
  }

  function loadConnectedSpeechRulesApi() {
    if (typeof require !== 'function') return null;
    try {
      require('./read-aloud-connected-speech-rules.js');
      return typeof root !== 'undefined' ? root.ReadAloudConnectedSpeechRules : null;
    } catch (_) {
      return null;
    }
  }

  function inferTokenSubtype(raw) {
    const value = String(raw || '');
    if (/^(?:[A-Za-z]{1,3}\.){2,}$/.test(value) || /^(?:[AaPp])\.[Mm]\.$/.test(value) || /^(?:Mr|Mrs|Ms|Dr|Prof)\./i.test(value) || /^[A-Z]{2,5}(?=\s|$|[.,!?;:])/.test(value)) {
      return 'abbreviation';
    }
    if (/^\d{1,2}:\d{2}$/.test(value)) return 'time';
    if (/^\d+\.\d+$/.test(value)) return 'decimal';
    if (/^\d+(?:st|nd|rd|th)?$/i.test(value)) return 'number';
    return 'word';
  }

  async function analyzePrompt(text, options = {}) {
    const tokens = tokenizePrompt(text);
    const wordTokens = tokens.filter((token) => token.type === 'word');
    const phoneticLookup = typeof options.phoneticLookup === 'function'
      ? options.phoneticLookup
      : getDefaultPhoneticLookup();
    const phoneticCache = new Map();
    const boundaries = [];
    const tokenAnnotations = [];
    const accentProfile = String(options.accentProfile || 'en-US');
    const connectedSpeechLevel = normalizeConnectedSpeechLevel(options.connectedSpeechLevel, options.enabledRuleSet);
    const enabledRuleSet = String(options.enabledRuleSet || getRuleSetForConnectedSpeechLevel(connectedSpeechLevel));
    const profileCache = new Map();
    const wordProfiles = new Map();

    for (const wordToken of wordTokens) {
      const profile = await getTokenProfile(wordToken, {
        accentProfile,
        phoneticLookup
      }, profileCache, phoneticCache);
      wordProfiles.set(wordToken.id, profile);
    }

    for (let i = 0; i < wordTokens.length - 1; i += 1) {
      const leftWord = wordTokens[i];
      const rightWord = wordTokens[i + 1];
      const between = collectInterveningTokens(tokens, leftWord.id, rightWord.id);
      const interveningRaw = between.map((token) => token.raw).join('');
      const hardBoundary = between.some((token) => token.type === 'punct' || token.type === 'linebreak');

      const boundary = {
        id: `b-${boundaries.length}`,
        leftWordIndex: leftWord.wordIndex,
        rightWordIndex: rightWord.wordIndex,
        leftWord: leftWord.normalized,
        rightWord: rightWord.normalized,
        leftDisplay: leftWord.display,
        rightDisplay: rightWord.display,
        interveningRaw,
        blocked: false,
        blockedReason: null,
        category: 'none',
        subtype: null,
        confidence: 'low',
        source: null,
        label: null,
        accentProfile,
        ruleSet: enabledRuleSet
      };

      if (hardBoundary) {
        boundary.blocked = true;
        boundary.blockedReason = 'hard_boundary';
        boundaries.push(boundary);
        continue;
      }

      const leftProfile = wordProfiles.get(leftWord.id);
      const rightProfile = wordProfiles.get(rightWord.id);
      const evaluated = evaluateBoundary(boundary, leftProfile, rightProfile, {
        accentProfile,
        enabledRuleSet
      });
      boundaries.push(evaluated);
    }

    if (connectedSpeechLevel !== 'off') {
      tokenAnnotations.push(...buildReducedWordAnnotations(tokens, wordTokens, wordProfiles, {
        connectedSpeechLevel,
        accentProfile
      }));
    }

    return {
      tokens,
      boundaries,
      tokenAnnotations,
      labelsEnabled: ENABLE_LINK_LABELS,
      connectedSpeechLevel
    };
  }

  function buildAccessibleSummary(analysis) {
    if (!analysis || !Array.isArray(analysis.boundaries)) {
      return '';
    }

    const eligible = analysis.boundaries.filter((boundary) => (
      !boundary.blocked && (boundary.confidence === 'high' || boundary.confidence === 'medium')
    ));
    const linkingBoundaries = eligible.filter((boundary) => String(boundary.layer || 'linking') !== 'assimilation');
    const soundChangeBoundaries = eligible.filter((boundary) => String(boundary.layer || '') === 'assimilation');
    const reducedWordAnnotations = Array.isArray(analysis.tokenAnnotations)
      ? analysis.tokenAnnotations.filter((annotation) => (
          annotation && annotation.layer === 'weak_forms'
        ))
      : [];

    if (eligible.length === 0 && reducedWordAnnotations.length === 0) {
      return 'No strong connected speech positions in this sentence.';
    }

    const linkingPhrases = linkingBoundaries.map((boundary) => {
      const leftText = boundary.leftDisplay || boundary.leftWord || '';
      const rightText = boundary.rightDisplay || boundary.rightWord || '';
      return `"${leftText} ${rightText}"`;
    });
    const soundChangePhrases = soundChangeBoundaries.map((boundary) => {
      const leftText = boundary.leftDisplay || boundary.leftWord || '';
      const rightText = boundary.rightDisplay || boundary.rightWord || '';
      return `"${leftText} ${rightText}"`;
    });

    const reducedWords = reducedWordAnnotations
      .map((annotation) => annotation.display || annotation.word || annotation.label || '')
      .filter(Boolean)
      .slice(0, 4);

    const summaryParts = [];
    if (linkingPhrases.length === 1) {
      summaryParts.push(`Possible linking between ${linkingPhrases[0]}.`);
    } else if (linkingPhrases.length > 1) {
      summaryParts.push(`Possible linking between ${linkingPhrases.slice(0, -1).join(', ')} and ${linkingPhrases[linkingPhrases.length - 1]}.`);
    }
    if (reducedWords.length > 0) {
      summaryParts.push(`Reduced words include ${formatWordList(reducedWords)}.`);
    }
    if (soundChangePhrases.length === 1) {
      summaryParts.push(`Sound changes may happen in ${soundChangePhrases[0]}.`);
    } else if (soundChangePhrases.length > 1) {
      summaryParts.push(`Sound changes may happen in ${soundChangePhrases.slice(0, -1).join(', ')} and ${soundChangePhrases[soundChangePhrases.length - 1]}.`);
    }
    if (summaryParts.length === 0) {
      return 'No strong connected speech positions in this sentence.';
    }
    return summaryParts.join(' ');
  }

  function filterAnalysisByBlockedBoundaries(analysis, blockedBoundarySet) {
    if (!analysis || !Array.isArray(analysis.boundaries) || !blockedBoundarySet?.size) {
      return analysis;
    }

    const filteredTokenAnnotations = Array.isArray(analysis.tokenAnnotations)
      ? analysis.tokenAnnotations.filter((annotation) => (
          !annotation?.boundaryKey || !blockedBoundarySet.has(annotation.boundaryKey)
        ))
      : [];

    return {
      ...analysis,
      boundaries: analysis.boundaries.map((boundary) => {
        const key = `${boundary.leftWordIndex}:${boundary.rightWordIndex}`;
        if (!blockedBoundarySet.has(key)) return boundary;
        return {
          ...boundary,
          blocked: true,
          blockedReason: boundary.blockedReason || 'chunk_boundary',
          confidence: 'low'
        };
      }),
      tokenAnnotations: filteredTokenAnnotations
    };
  }

  function renderLinkingLayer(container, analysis) {
    if (!container) return new Map();
    container.innerHTML = '';
    const wordMap = new Map();

    analysis.tokens.forEach((token) => {
      if (token.type === 'word') {
        const span = document.createElement('span');
        span.className = 'ra-link-word';
        span.dataset.wordIndex = String(token.wordIndex);
        span.dataset.tokenId = token.id;
        span.textContent = token.display;
        span.style.position = 'relative';
        span.style.display = 'inline';
        container.appendChild(span);
        wordMap.set(token.wordIndex, span);
        return;
      }

      if (token.type === 'linebreak') {
        container.appendChild(document.createElement('br'));
        return;
      }

      container.appendChild(document.createTextNode(token.raw));
    });

    return wordMap;
  }

  function renderOverlay(overlay, stage, analysis, wordMap, options = {}) {
    if (!overlay || !stage) return { renderedCount: 0, skippedCount: 0 };
    overlay.innerHTML = '';
    overlay.style.display = 'block';

    const stageRect = stage.getBoundingClientRect();
    const pathColor = options.strokeColor || '#2563eb';
    let renderedCount = 0;
    let skippedCount = 0;
    const hiddenBoundaries = [];

    analysis.boundaries.forEach((boundary) => {
      if (String(boundary.layer || '') === 'assimilation') {
        skippedCount += 1;
        return;
      }
      if (boundary.blocked || (boundary.confidence !== 'high' && boundary.confidence !== 'medium')) {
        skippedCount += 1;
        return;
      }

      const leftSpan = wordMap.get(boundary.leftWordIndex);
      const rightSpan = wordMap.get(boundary.rightWordIndex);
      if (!leftSpan || !rightSpan) {
        skippedCount += 1;
        hiddenBoundaries.push(boundary);
        return;
      }

      const leftRect = leftSpan.getBoundingClientRect();
      const rightRect = rightSpan.getBoundingClientRect();
      if (Math.abs(leftRect.top - rightRect.top) > LINE_TOLERANCE_PX) {
        skippedCount += 1;
        hiddenBoundaries.push(boundary);
        return;
      }

      const startX = leftRect.right - stageRect.left - 4;
      const endX = rightRect.left - stageRect.left + 4;
      const baseY = Math.max(leftRect.bottom, rightRect.bottom) - stageRect.top + 2;
      const controlX = (startX + endX) / 2;
      const controlY = baseY + 10;

      if (endX <= startX) {
        skippedCount += 1;
        hiddenBoundaries.push(boundary);
        return;
      }

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${startX} ${baseY} Q ${controlX} ${controlY} ${endX} ${baseY}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', pathColor);
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      overlay.appendChild(path);

      renderedCount += 1;
    });

    overlay.setAttribute('viewBox', `0 0 ${Math.max(stageRect.width, 1)} ${Math.max(stageRect.height, 1)}`);
    overlay.setAttribute('width', `${Math.max(stageRect.width, 1)}`);
    overlay.setAttribute('height', `${Math.max(stageRect.height, 1)}`);
    return { renderedCount, skippedCount, hiddenBoundaries };
  }

  function renderAssimilationBadges(container, stage, analysis, wordMap, options = {}) {
    if (!container || !stage) return { renderedCount: 0, skippedCount: 0 };
    container.innerHTML = '';
    container.style.display = 'block';

    const stageRect = stage.getBoundingClientRect();
    let renderedCount = 0;
    let skippedCount = 0;

    analysis.boundaries.forEach((boundary) => {
      if (String(boundary.layer || '') !== 'assimilation') {
        return;
      }
      if (boundary.blocked || (boundary.confidence !== 'high' && boundary.confidence !== 'medium')) {
        skippedCount += 1;
        return;
      }

      const leftSpan = wordMap.get(boundary.leftWordIndex);
      const rightSpan = wordMap.get(boundary.rightWordIndex);
      if (!leftSpan || !rightSpan) {
        skippedCount += 1;
        return;
      }

      const leftRect = leftSpan.getBoundingClientRect();
      const rightRect = rightSpan.getBoundingClientRect();
      if (Math.abs(leftRect.top - rightRect.top) > LINE_TOLERANCE_PX) {
        skippedCount += 1;
        return;
      }

      const startX = leftRect.right - stageRect.left - 4;
      const endX = rightRect.left - stageRect.left + 4;
      const baseY = Math.max(leftRect.bottom, rightRect.bottom) - stageRect.top + 12;
      if (endX <= startX) {
        skippedCount += 1;
        return;
      }

      const badge = document.createElement('div');
      badge.textContent = boundary.markerText || 'sound change';
      badge.title = boundary.legendLabel || 'Sound change';
      badge.style.cssText = [
        'position:absolute',
        `left:${(startX + endX) / 2}px`,
        `top:${baseY}px`,
        'transform:translate(-50%, 0)',
        'padding:2px 8px',
        'border-radius:999px',
        'background:rgba(180, 83, 9, 0.14)',
        'color:#b45309',
        'font-size:11px',
        'font-weight:700',
        'letter-spacing:0.02em',
        'box-shadow:0 1px 2px rgba(180, 83, 9, 0.12)',
        'white-space:nowrap'
      ].join(';');
      container.appendChild(badge);
      renderedCount += 1;
    });

    if (renderedCount === 0) {
      container.style.display = 'none';
    }
    container.setAttribute('viewBox', `0 0 ${Math.max(stageRect.width, 1)} ${Math.max(stageRect.height, 1)}`);
    return { renderedCount, skippedCount };
  }

  function renderFallbackList(container, analysis, options = {}) {
    if (!container) return 0;
    container.innerHTML = '';
    const sourceBoundaries = Array.isArray(options.boundaries) ? options.boundaries : analysis.boundaries;
    const eligible = sourceBoundaries.filter((boundary) => (
      !boundary.blocked && (boundary.confidence === 'high' || boundary.confidence === 'medium')
    ));

    if (eligible.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No strong connected speech positions in this sentence.';
      container.appendChild(empty);
      return 0;
    }

    const linkingBoundaries = eligible.filter((boundary) => String(boundary.layer || 'linking') !== 'assimilation');
    const soundChangeBoundaries = eligible.filter((boundary) => String(boundary.layer || '') === 'assimilation');

    const appendSection = (headingText, boundaries, palette) => {
      if (!boundaries.length) return 0;
      const section = document.createElement('div');
      section.style.cssText = 'display:flex; flex-direction:column; gap:6px; width:100%;';
      const heading = document.createElement('div');
      heading.dataset.role = 'fallback-heading';
      heading.textContent = headingText;
      heading.style.cssText = 'font-size:0.78rem; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.05em;';
      section.appendChild(heading);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; flex-wrap:wrap; gap:8px; align-items:center;';
      boundaries.forEach((boundary) => {
        const item = document.createElement('div');
        item.textContent = `${boundary.leftDisplay} ${boundary.rightDisplay}`;
        item.style.padding = '6px 10px';
        item.style.borderRadius = '999px';
        item.style.background = palette.background;
        item.style.color = palette.color;
        item.style.fontWeight = '600';
        row.appendChild(item);
      });
      section.appendChild(row);
      container.appendChild(section);
      return boundaries.length;
    };

    let renderedCount = 0;
    renderedCount += appendSection('Linking', linkingBoundaries, {
      background: 'rgba(37, 99, 235, 0.08)',
      color: '#1d4ed8'
    });
    renderedCount += appendSection('Sound changes', soundChangeBoundaries, {
      background: 'rgba(180, 83, 9, 0.10)',
      color: '#b45309'
    });

    return renderedCount;
  }

  function applyTokenAnnotations(wordMap, analysis) {
    if (!wordMap || typeof wordMap.get !== 'function' || !analysis || !Array.isArray(analysis.tokenAnnotations)) {
      return 0;
    }

    let appliedCount = 0;
    analysis.tokenAnnotations.forEach((annotation) => {
      if (!annotation || annotation.layer !== 'weak_forms') return;
      const span = wordMap.get(annotation.wordIndex);
      if (!span) return;
      span.classList.add('ra-connected-speech-token', 'ra-connected-speech-token--weak');
      span.dataset.connectedSpeechLayer = annotation.layer;
      if (annotation.subtype) {
        span.dataset.connectedSpeechSubtype = annotation.subtype;
      }
      span.title = annotation.legendLabel || 'Reduced word';
      span.style.borderBottom = '2px solid #d97706';
      span.style.background = 'rgba(217, 119, 6, 0.12)';
      span.style.borderRadius = '4px';
      span.style.padding = '0 1px';
      appliedCount += 1;
    });

    return appliedCount;
  }

  function clearLinkingRender(linkingLayer, overlay, fallbackList) {
    if (linkingLayer) linkingLayer.innerHTML = '';
    if (overlay) {
      overlay.innerHTML = '';
      overlay.style.display = 'none';
    }
    if (fallbackList) {
      fallbackList.innerHTML = '';
      fallbackList.style.display = 'none';
    }
  }

  function collectInterveningTokens(tokens, leftId, rightId) {
    const leftIndex = tokens.findIndex((token) => token.id === leftId);
    const rightIndex = tokens.findIndex((token) => token.id === rightId);
    if (leftIndex === -1 || rightIndex === -1 || rightIndex <= leftIndex) return [];
    return tokens.slice(leftIndex + 1, rightIndex);
  }

  function getDefaultPhoneticLookup() {
    if (typeof root === 'undefined' || !root.Phonetics || typeof root.Phonetics.getIPAWithSource !== 'function') {
      return null;
    }
    return (word) => root.Phonetics.getIPAWithSource(word);
  }

  function normalizeConnectedSpeechLevel(level, enabledRuleSet) {
    const candidate = String(level || '').trim();
    if (candidate) {
      return candidate;
    }
    if (String(enabledRuleSet || '') === 'linking-v1') {
      return 'v1_linking';
    }
    return 'v1_linking';
  }

  function getRuleSetForConnectedSpeechLevel(level) {
    const normalized = String(level || '').trim();
    if (normalized === 'off') return 'none';
    if (normalized === 'v3_sound_changes') return 'connected-speech-v3';
    return 'linking-v1';
  }

  function buildReducedWordAnnotations(tokens, wordTokens, wordProfiles, options = {}) {
    const connectedSpeechLevel = String(options.connectedSpeechLevel || 'v1_linking');
    if (connectedSpeechLevel !== 'v2_reduced_words' && connectedSpeechLevel !== 'v3_sound_changes') {
      return [];
    }

    const annotations = [];
    wordTokens.forEach((token, index) => {
      const normalized = String(token?.normalized || token?.raw || '').toLowerCase();
      if (!REDUCED_WORD_HINTS.has(normalized)) return;
      const nextWordBoundary = findNextWordBoundary(tokens, token.id, index < wordTokens.length - 1 ? wordTokens[index + 1] : null);
      if (!nextWordBoundary || nextWordBoundary.hardBoundary || !nextWordBoundary.nextWord) return;

      const profile = wordProfiles.get(token.id);
      if (profile?.ambiguous) return;

      annotations.push({
        id: `token-${token.id}`,
        wordIndex: token.wordIndex,
        boundaryKey: `${token.wordIndex}:${nextWordBoundary.nextWord.wordIndex}`,
        word: normalized,
        display: token.display || token.raw || normalized,
        layer: 'weak_forms',
        category: 'reduced_word',
        subtype: normalized,
        confidence: 'medium',
        legendLabel: `Reduced word: ${token.display || token.raw || normalized}`,
        explanationKey: `weak_form_${normalized}`
      });
    });

    return annotations;
  }

  function findNextWordBoundary(tokens, currentTokenId, fallbackNextWord = null) {
    const currentIndex = Array.isArray(tokens)
      ? tokens.findIndex((token) => token.id === currentTokenId)
      : -1;

    if (currentIndex === -1) {
      return fallbackNextWord ? { nextWord: fallbackNextWord, hardBoundary: false } : null;
    }

    let hardBoundary = false;
    for (let index = currentIndex + 1; index < tokens.length; index += 1) {
      const candidate = tokens[index];
      if (!candidate) continue;
      if (candidate.type === 'punct' || candidate.type === 'linebreak') {
        hardBoundary = true;
        continue;
      }
      if (candidate.type === 'word') {
        return {
          nextWord: candidate,
          hardBoundary
        };
      }
    }
    return null;
  }

  function formatWordList(items) {
    const list = items.filter(Boolean);
    if (list.length <= 1) {
      return list[0] ? `"${list[0]}"` : '';
    }
    if (list.length === 2) {
      return `"${list[0]}" and "${list[1]}"`;
    }
    return `${list.slice(0, -1).map((item) => `"${item}"`).join(', ')}, and "${list[list.length - 1]}"`;
  }

  async function getTokenProfile(token, options, profileCache, phoneticCache) {
    const normalized = String(token?.normalized || token?.raw || '').toLowerCase();
    const subtype = String(token?.subtype || 'word');
    const cacheKey = `${subtype}:${normalized}:${String(options?.accentProfile || 'en-US')}`;

    if (profileCache.has(cacheKey)) {
      return profileCache.get(cacheKey);
    }

    if (spokenFormsApi && typeof spokenFormsApi.resolveTokenProfile === 'function') {
      const profile = await Promise.resolve(spokenFormsApi.resolveTokenProfile(token, {
        accentProfile: options?.accentProfile || 'en-US',
        phoneticLookup: async (word) => {
          const cacheKeyForLookup = String(word || '').toLowerCase();
          if (phoneticCache.has(cacheKeyForLookup)) {
            return phoneticCache.get(cacheKeyForLookup);
          }
          if (typeof options?.phoneticLookup !== 'function') return null;
          const result = await options.phoneticLookup(word);
          phoneticCache.set(cacheKeyForLookup, result);
          return result;
        }
      }));
      profileCache.set(cacheKey, profile);
      return profile;
    }

    const profile = await getWordProfile(normalized, options?.phoneticLookup, phoneticCache);
    profileCache.set(cacheKey, profile);
    return profile;
  }

  async function getWordProfile(word, phoneticLookup, cache) {
    if (cache.has(word)) {
      return cache.get(word);
    }

    let source = null;
    let ipa = '';
    if (phoneticLookup) {
      try {
        const result = await phoneticLookup(word);
        if (result && typeof result === 'object') {
          source = result.source || null;
          ipa = result.ipa || '';
        } else if (typeof result === 'string') {
          ipa = result;
        }
      } catch (_) {
        source = null;
        ipa = '';
      }
    }

    const profile = {
      word,
      source,
      ipa,
      startsWithVowelSound: inferStartsWithVowelSound(word, ipa),
      endsWithConsonantSound: inferEndsWithConsonantSound(word, ipa),
      startsWithGlideY: false,
      startsWithGlideW: false,
      endsWithVowelSound: false,
      endsWithPotentialLinkingR: false,
      initialSoundClass: inferStartsWithVowelSound(word, ipa) ? 'vowel' : 'consonant',
      initialSoundKey: String(word || '').slice(0, 1).toLowerCase() || null,
      finalSoundClass: inferEndsWithConsonantSound(word, ipa) ? 'consonant' : 'vowel',
      finalSoundKey: String(word || '').slice(-1).toLowerCase() || null,
      kind: 'word'
    };
    cache.set(word, profile);
    return profile;
  }

  function evaluateBoundary(boundary, leftProfile, rightProfile, options = {}) {
    if (connectedSpeechRulesApi && typeof connectedSpeechRulesApi.evaluateBoundary === 'function') {
      return connectedSpeechRulesApi.evaluateBoundary(boundary, leftProfile, rightProfile, options);
    }

    if (
      leftProfile.source === 'cmu' &&
      rightProfile.source === 'cmu' &&
      leftProfile.endsWithConsonantSound &&
      rightProfile.startsWithVowelSound
    ) {
      return {
        ...boundary,
        blocked: false,
        category: 'consonant_to_vowel',
        confidence: 'high',
        source: 'cmu'
      };
    }

    if (
      isObviousOrthographicLink(leftProfile.word, rightProfile.word) &&
      (leftProfile.source !== 'cmu' || rightProfile.source !== 'cmu')
    ) {
      return {
        ...boundary,
        blocked: false,
        category: 'consonant_to_vowel',
        confidence: 'medium',
        source: 'orthographic'
      };
    }

    return {
      ...boundary,
      blocked: true,
      blockedReason: 'low_confidence',
      category: 'none',
      confidence: 'low',
      source: leftProfile.source || rightProfile.source || null
    };
  }

  function isObviousOrthographicLink(leftWord, rightWord) {
    if (!OBVIOUS_WORD_PATTERN.test(leftWord) || !OBVIOUS_WORD_PATTERN.test(rightWord)) {
      return false;
    }
    if (ORTHOGRAPHIC_FALLBACK_BLOCKLIST.has(leftWord)) {
      return false;
    }
    if (!VOWEL_LETTERS.test(rightWord[0] || '')) {
      return false;
    }
    const lastChar = leftWord[leftWord.length - 1] || '';
    if (VOWEL_LETTERS.test(lastChar)) {
      return false;
    }
    if (AMBIGUOUS_FINAL_SPELLING_PATTERNS.some((pattern) => pattern.test(leftWord))) {
      return false;
    }
    if (/\d/.test(leftWord + rightWord)) {
      return false;
    }
    return true;
  }

  function inferStartsWithVowelSound(word, ipa) {
    const normalizedIpa = (ipa || '').replace(/^\/|\/$/g, '').replace(/^[ˈˌ'ˌ.]+/g, '');
    if (normalizedIpa) {
      return /^[ɑæʌɔaɛeɪɪiəoʊuʊɚɝ]/.test(normalizedIpa);
    }
    return VOWEL_LETTERS.test((word || '')[0] || '');
  }

  function inferEndsWithConsonantSound(word, ipa) {
    const normalizedIpa = (ipa || '').replace(/^\/|\/$/g, '').replace(/[ˈˌ'ˌ.ː]+$/g, '');
    if (normalizedIpa) {
      return /[bcdfghjklmnpqrstvwxyzðθʃʒŋlr]$/i.test(normalizedIpa);
    }
    const lastChar = (word || '').slice(-1);
    return !!lastChar && !VOWEL_LETTERS.test(lastChar);
  }

  const api = {
    ENABLE_LINK_LABELS,
    DESKTOP_MIN_WIDTH,
    tokenizePrompt,
    analyzePrompt,
    buildAccessibleSummary,
    filterAnalysisByBlockedBoundaries,
    renderLinkingLayer,
    applyTokenAnnotations,
    renderOverlay,
    renderFallbackList,
    clearLinkingRender
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.ReadAloudLinking = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
