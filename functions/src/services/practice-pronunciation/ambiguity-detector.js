'use strict';

/**
 * Ambiguity Detector for Spoken Responses
 * Plan V3 §11.3 & User Mandate:
 * Preserves the distinction between ordinary uncertainty (handled automatically in UI)
 * and known ambiguous pronunciation targets (requiring targeted inline student confirmation).
 */

// Known material pronunciation minimal pairs common in ESL/PTE practice
const KNOWN_MINIMAL_PAIRS = [
  ['three', 'tree'],
  ['three', 'free'],
  ['think', 'sink'],
  ['thank', 'sank'],
  ['thick', 'sick'],
  ['ship', 'sheep'],
  ['chip', 'cheap'],
  ['slip', 'sleep'],
  ['fit', 'feet'],
  ['hit', 'heat'],
  ['bat', 'bad'],
  ['bet', 'bed'],
  ['pen', 'pan'],
  ['men', 'man'],
  ['light', 'right'],
  ['lead', 'read'],
  ['long', 'wrong'],
  ['vest', 'west'],
  ['vine', 'wine'],
  ['berry', 'very'],
  ['best', 'vest'],
  ['heart', 'hard'],
  ['cart', 'card'],
  ['climb', 'claim'],
  ['walk', 'work'],
  ['read', 'red']
];

// Lookup map: normalized word -> Set of counterpart minimal pair words
const MINIMAL_PAIR_MAP = new Map();
for (const [w1, w2] of KNOWN_MINIMAL_PAIRS) {
  const norm1 = w1.toLowerCase();
  const norm2 = w2.toLowerCase();

  if (!MINIMAL_PAIR_MAP.has(norm1)) MINIMAL_PAIR_MAP.set(norm1, new Set());
  MINIMAL_PAIR_MAP.get(norm1).add(norm2);

  if (!MINIMAL_PAIR_MAP.has(norm2)) MINIMAL_PAIR_MAP.set(norm2, new Set());
  MINIMAL_PAIR_MAP.get(norm2).add(norm1);
}

function cleanWord(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Evaluates tokens from unconditioned ASR transcription and extracts material ambiguities.
 *
 * @param {Array<{ index: number, word: string, confidence: number, startMs: number, endMs: number }>} tokens
 * @param {Object} options
 * @param {number} [options.ambiguityConfidenceThreshold=0.85] - Trigger clarification if word is a known minimal pair and confidence <= threshold
 * @returns {{ hasMaterialAmbiguity: boolean, ambiguities: Array<Object> }}
 */
function detectMaterialAmbiguities(tokens = [], options = {}) {
  const threshold = options.ambiguityConfidenceThreshold ?? 0.85;
  const ambiguities = [];

  for (const token of tokens) {
    const raw = cleanWord(token.word);
    if (!raw) continue;

    if (MINIMAL_PAIR_MAP.has(raw)) {
      const counterparts = Array.from(MINIMAL_PAIR_MAP.get(raw));
      const confidence = typeof token.confidence === 'number' ? token.confidence : 0.80;

      // Only flag as material ambiguity if confidence is not overwhelmingly decisive
      if (confidence <= threshold) {
        ambiguities.push({
          tokenIndex: token.index,
          spokenWord: token.word,
          candidates: [token.word.toLowerCase(), ...counterparts],
          startMs: token.startMs,
          endMs: token.endMs,
          confidence,
          contextSpan: {
            startMs: Math.max(0, token.startMs - 300),
            endMs: token.endMs + 300
          }
        });
      }
    }
  }

  return {
    hasMaterialAmbiguity: ambiguities.length > 0,
    ambiguities
  };
}

/**
 * Applies confirmed student disambiguations to the transcript tokens, returning updated text.
 *
 * @param {Array<{ index: number, word: string }>} tokens
 * @param {Record<string|number, string>} confirmations - e.g. { "2": "tree" }
 * @returns {{ resolvedText: string, appliedCount: number }}
 */
function applyDisambiguation(tokens = [], confirmations = {}) {
  const safeTokens = Array.isArray(tokens) ? tokens : [];
  const safeConfirmations = (confirmations && typeof confirmations === 'object') ? confirmations : {};
  let appliedCount = 0;
  const updatedTokens = safeTokens.map(t => {
    const key = String(t.index);
    if (safeConfirmations[key] && typeof safeConfirmations[key] === 'string') {
      appliedCount += 1;
      return {
        ...t,
        word: safeConfirmations[key].trim()
      };
    }
    return t;
  });

  const resolvedText = updatedTokens.map(t => t.word).join(' ');
  return {
    resolvedText,
    appliedCount,
    tokens: updatedTokens
  };
}

module.exports = {
  KNOWN_MINIMAL_PAIRS,
  MINIMAL_PAIR_MAP,
  detectMaterialAmbiguities,
  applyDisambiguation
};
