/**
 * ReadAloudStressRhythm — Syllable-Level Metric Prominence & Stress Typography Engine
 *
 * Implements dual-level prosodic prominence highlighting for PTE Read Aloud:
 * 1. Sentence Stress: Distinguishes stressed content words vs unstressed function words.
 * 2. Word Stress: Within polysyllabic content words, ONLY the primary stressed syllable
 *    is wrapped in `.ra-stress-peak` (font-weight: 700), while unstressed syllables
 *    and function words remain standard weight (font-weight: 400).
 *
 * Designed for 0-latency execution in browser client and Node.js build pipelines.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.ReadAloudStressRhythm = api;
  if (typeof globalThis !== 'undefined') {
    globalThis.ReadAloudStressRhythm = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Standard English function words (unaccented / unstressed in default prosody)
  const FUNCTION_WORDS = new Set([
    'a', 'an', 'the',
    'and', 'but', 'or', 'nor', 'for', 'so', 'yet',
    'to', 'of', 'in', 'on', 'at', 'by', 'with', 'from', 'into', 'onto', 'about', 'as', 'than',
    'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did',
    'can', 'could', 'shall', 'should', 'will', 'would', 'may', 'might', 'must',
    'it', "it's", 'its', 'them', 'their', 'theirs', 'him', 'his', 'her', 'hers', 'us', 'our', 'ours', 'me', 'my',
    'that', 'which', 'who', 'whom', 'whose',
    'if', 'when', 'while', 'because', 'although', 'whether',
    'some', 'any', 'put'
  ]);

  // Common lexical stress and syllable segment overrides
  const LEXICAL_OVERRIDES = {
    'combine': { syls: ['com', 'bine'], stressIdx: 1 },
    'compostable': { syls: ['com', 'pos', 'ta', 'ble'], stressIdx: 1 },
    'spearmint': { syls: ['spear', 'mint'], stressIdx: 0 },
    'peppermint': { syls: ['pep', 'per', 'mint'], stressIdx: 0 },
    'cinnamon': { syls: ['cin', 'na', 'mon'], stressIdx: 0 },
    'tablespoons': { syls: ['ta', 'ble', 'spoons'], stressIdx: 0 },
    'tablespoon': { syls: ['ta', 'ble', 'spoon'], stressIdx: 0 },
    'toothbrush': { syls: ['tooth', 'brush'], stressIdx: 0 },
    'essential': { syls: ['es', 'sen', 'tial'], stressIdx: 1 },
    'fifteen': { syls: ['fif', 'teen'], stressIdx: 1 },
    'twenty': { syls: ['twen', 'ty'], stressIdx: 0 },
    'coconut': { syls: ['co', 'co', 'nut'], stressIdx: 0 },
    'baking': { syls: ['ba', 'king'], stressIdx: 0 },
    'soda': { syls: ['so', 'da'], stressIdx: 0 },
    'super': { syls: ['su', 'per'], stressIdx: 0 },
    'easy': { syls: ['ea', 'sy'], stressIdx: 0 },
    'under': { syls: ['un', 'der'], stressIdx: 0 },
    'water': { syls: ['wa', 'ter'], stressIdx: 0 },
    'minutes': { syls: ['min', 'utes'], stressIdx: 0 },
    'minute': { syls: ['min', 'ute'], stressIdx: 0 },
    'icehouse': { syls: ['ice', 'house'], stressIdx: 0 },
    'storage': { syls: ['sto', 'rage'], stressIdx: 0 },
    'structures': { syls: ['struc', 'tures'], stressIdx: 0 },
    'located': { syls: ['lo', 'ca', 'ted'], stressIdx: 0 },
    'supplies': { syls: ['sup', 'plies'], stressIdx: 1 },
    'provide': { syls: ['pro', 'vide'], stressIdx: 1 },
    'center': { syls: ['cen', 'ter'], stressIdx: 0 },
    'city': { syls: ['ci', 'ty'], stressIdx: 0 }
  };

  /**
   * Split an English word into orthographic syllables using onset-nucleus division rules
   */
  function splitOrthographicSyllables(word, targetCount) {
    if (targetCount <= 1 || word.length <= 3) {
      return [word];
    }

    const vowelRegex = /[aeiouy]+/g;
    let match;
    const nuclei = [];
    while ((match = vowelRegex.exec(word)) !== null) {
      // Ignore silent final e when preceded by other vowels
      if (match.index === word.length - 1 && match[0] === 'e' && nuclei.length > 0) {
        continue;
      }
      nuclei.push({ start: match.index, end: match.index + match[0].length });
    }

    if (nuclei.length <= 1) {
      return [word];
    }

    const splitPoints = [];
    for (let i = 0; i < nuclei.length - 1; i += 1) {
      const n1 = nuclei[i];
      const n2 = nuclei[i + 1];
      const consonantCount = n2.start - n1.end;

      if (consonantCount <= 0) {
        // Hiatus / separate vowel nuclei (e.g. di-et)
        splitPoints.push(n1.end);
      } else if (consonantCount === 1) {
        // V-CV open syllable onset maximization (e.g. su-per, ba-king)
        splitPoints.push(n1.end);
      } else {
        // VC-CV divide between consonants (e.g. com-bine, fif-teen, twen-ty)
        splitPoints.push(n1.end + 1);
      }
    }

    const syls = [];
    let lastIdx = 0;
    for (const pt of splitPoints) {
      syls.push(word.slice(lastIdx, pt));
      lastIdx = pt;
    }
    syls.push(word.slice(lastIdx));

    return syls.filter((s) => s.length > 0);
  }

  /**
   * Determine stress metadata for a word
   * @param {string} rawToken
   * @param {string} [prevWord]
   * @param {string} [nextWord]
   * @param {Object} [dictionary]
   * @returns {Object}
   */
  function getWordStress(rawToken, prevWord = '', nextWord = '', dictionary = null) {
    const cleanWord = String(rawToken || '').replace(/^[^A-Za-z0-9’']+|[^A-Za-z0-9’']+$/g, '');
    if (!cleanWord) {
      return {
        word: rawToken,
        isContent: false,
        syllables: [rawToken],
        primaryStressIndex: -1,
        stressedPart: null
      };
    }

    const lower = cleanWord.toLowerCase();
    const prevLower = String(prevWord || '').toLowerCase();
    const nextLower = String(nextWord || '').toLowerCase();

    // Contrastive / emphatic checks
    let forceStress = false;
    if (lower === 'i' && (nextLower === 'like' || nextLower === 'can' || nextLower === 'think' || nextLower === 'believe')) {
      forceStress = true;
    } else if (lower === 'you' && (prevLower === 'but' || nextLower === 'can')) {
      forceStress = true;
    } else if (lower === 'use' && prevLower === 'to') {
      // Deaccented infinitive collocation "to use"
      return {
        word: cleanWord,
        isContent: false,
        syllables: [cleanWord],
        primaryStressIndex: -1,
        stressedPart: null
      };
    }

    // Check function words
    if (!forceStress && FUNCTION_WORDS.has(lower)) {
      return {
        word: cleanWord,
        isContent: false,
        syllables: [cleanWord],
        primaryStressIndex: -1,
        stressedPart: null
      };
    }

    // Check lexical overrides
    if (LEXICAL_OVERRIDES[lower]) {
      const o = LEXICAL_OVERRIDES[lower];
      return {
        word: cleanWord,
        isContent: true,
        syllables: o.syls,
        primaryStressIndex: o.stressIdx,
        stressedPart: o.syls[o.stressIdx]
      };
    }

    // Check dictionary if available
    const dict = dictionary || (typeof globalThis !== 'undefined' ? globalThis.__cmudict : null);
    if (dict && (dict[lower] || dict[lower.replace(/'s$/, '')])) {
      const entry = dict[lower] || dict[lower.replace(/'s$/, '')];
      const phones = String(entry).split(' ');
      const vowels = [];
      phones.forEach((p) => {
        const m = p.match(/^([A-Z]+)([012])$/);
        if (m) vowels.push({ phone: m[1], stress: parseInt(m[2], 10) });
      });

      if (vowels.length <= 1) {
        return {
          word: cleanWord,
          isContent: true,
          syllables: [cleanWord],
          primaryStressIndex: 0,
          stressedPart: cleanWord
        };
      }

      let primaryIdx = vowels.findIndex((v) => v.stress === 1);
      if (primaryIdx === -1) primaryIdx = vowels.findIndex((v) => v.stress === 2);
      if (primaryIdx === -1) primaryIdx = 0;

      const syls = splitOrthographicSyllables(lower, vowels.length);
      const validIdx = Math.min(primaryIdx, syls.length - 1);
      return {
        word: cleanWord,
        isContent: true,
        syllables: syls,
        primaryStressIndex: validIdx,
        stressedPart: syls[validIdx]
      };
    }

    // Orthographic heuristic fallback
    const vowelGroups = lower.match(/[aeiouy]+/g) || ['a'];
    const sylCount = Math.max(1, vowelGroups.length);
    if (sylCount <= 1) {
      return {
        word: cleanWord,
        isContent: true,
        syllables: [cleanWord],
        primaryStressIndex: 0,
        stressedPart: cleanWord
      };
    }

    const syls = splitOrthographicSyllables(lower, sylCount);
    return {
      word: cleanWord,
      isContent: true,
      syllables: syls,
      primaryStressIndex: 0,
      stressedPart: syls[0]
    };
  }

  /**
   * Format a single word or token with <span class="ra-stress-peak">...</span> around its primary stressed syllable
   */
  function formatWordHtml(rawToken, prevWord = '', nextWord = '', dictionary = null) {
    const match = String(rawToken || '').match(/^([^A-Za-z0-9’']*?)([A-Za-z0-9’']+)([^A-Za-z0-9’']*?)$/);
    if (!match) return rawToken;

    const [, leading, word, trailing] = match;
    const info = getWordStress(word, prevWord, nextWord, dictionary);

    if (!info || !info.isContent || info.primaryStressIndex < 0) {
      return rawToken;
    }

    if (!info.syllables || info.syllables.length <= 1) {
      return `${leading}<span class="ra-stress-peak">${word}</span>${trailing}`;
    }

    const targetSyl = info.stressedPart || info.syllables[info.primaryStressIndex];
    const lower = word.toLowerCase();
    const startInWord = lower.indexOf(targetSyl.toLowerCase());

    if (startInWord !== -1) {
      const prefix = word.slice(0, startInWord);
      const boldPart = word.slice(startInWord, startInWord + targetSyl.length);
      const suffix = word.slice(startInWord + targetSyl.length);
      return `${leading}${prefix}<span class="ra-stress-peak">${boldPart}</span>${suffix}${trailing}`;
    }

    return `${leading}<span class="ra-stress-peak">${word}</span>${trailing}`;
  }

  /**
   * Format an entire sentence or prompt passage
   */
  function formatPromptHtml(text, dictionary = null) {
    if (!text || typeof text !== 'string') return '';
    const tokens = text.split(/(\b[A-Za-z0-9’']+\b)/g);
    let result = '';

    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (!/^[A-Za-z0-9’']+$/.test(token)) {
        result += token;
        continue;
      }

      const prev = i > 1 ? tokens[i - 2] : '';
      const next = i + 2 < tokens.length ? tokens[i + 2] : '';
      result += formatWordHtml(token, prev, next, dictionary);
    }

    return result;
  }

  return {
    FUNCTION_WORDS,
    LEXICAL_OVERRIDES,
    splitOrthographicSyllables,
    getWordStress,
    formatWordHtml,
    formatPromptHtml
  };
}));
