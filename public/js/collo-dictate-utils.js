/**
 * Collo-dictate utilities
 * Shared between:
 * - Browser mode (public/js/collo-dictate-mode.js)
 * - Offline audio generator (scripts/generate-collo-dictate-audio.ps1)
 */

/**
 * Normalization must match `scripts/generate-collo-dictate-audio.ps1`:
 * - lowercase
 * - normalize curly apostrophes to '
 * - remove ' and "
 * - replace non [a-z0-9 ] with spaces
 * - trim + collapse whitespace
 * @param {unknown} text
 * @returns {string}
 */
export function normalizeForCompare(text) {
  const raw = String(text ?? '');
  return raw
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * FNV-1a 32-bit hash (hex string), matching JS Math.imul semantics.
 * @param {string} text
 * @returns {string} 8-char lowercase hex
 */
export function fnv1a32Hex(text) {
  let hash = 0x811c9dc5;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i += 1) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
    hash >>>= 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Deterministic audio key for a phrase.
 * @param {unknown} phrase
 * @returns {string} cd_<hash>
 */
export function getColloAudioKey(phrase) {
  const normalized = normalizeForCompare(phrase);
  return `cd_${fnv1a32Hex(normalized)}`;
}

/**
 * Word count (post-normalization).
 * @param {unknown} phrase
 * @returns {number}
 */
export function countNormalizedWords(phrase) {
  const normalized = normalizeForCompare(phrase);
  if (!normalized) return 0;
  return normalized.split(' ').length;
}

const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'so', 'because',
  'to', 'of', 'in', 'on', 'at', 'for', 'from', 'with', 'by', 'into',
  'onto', 'through', 'over', 'under', 'between', 'about', 'after', 'before',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did',
  'have', 'has', 'had', 'will', 'would', 'can', 'could', 'should', 'may',
  'might', 'must', 'not', 'no', 'yes', 'this', 'that', 'these', 'those',
  'it', 'its', 'i', 'you', 'we', 'they', 'he', 'she', 'them', 'us', 'my',
  'your', 'our', 'their', 'his', 'her'
]);

function normalizeToken(token) {
  return normalizeForCompare(token).replace(/\s+/g, ' ').trim();
}

function tokenize(text) {
  const normalized = normalizeForCompare(text);
  return normalized ? normalized.split(' ') : [];
}

function isContentToken(token) {
  const normalized = normalizeToken(token);
  if (!normalized) return false;
  if (normalized.includes(' ')) return false;
  if (/^\d+$/.test(normalized)) return false;
  return !FUNCTION_WORDS.has(normalized);
}

export function derivePhraseFirstCapture(expectedPhrase, typedAnswer, wordMissCounts = {}) {
  const normalizedPhrase = normalizeForCompare(expectedPhrase);
  const expectedTokens = tokenize(expectedPhrase);
  const typedTokenSet = new Set(tokenize(typedAnswer));
  const missingContentTokens = [];
  const correctContentTokens = [];
  const seenTokens = new Set();

  for (const token of expectedTokens) {
    if (!isContentToken(token)) continue;
    if (seenTokens.has(token)) continue;
    seenTokens.add(token);

    if (typedTokenSet.has(token)) {
      correctContentTokens.push(token);
    } else {
      missingContentTokens.push(token);
    }
  }

  const phraseMissed = normalizedPhrase.length > 0 && normalizeForCompare(typedAnswer) !== normalizedPhrase;
  const phraseCandidate = phraseMissed
    ? {
        key: `phrase:${normalizedPhrase}`,
        entryType: 'phrase',
        displayText: String(expectedPhrase || '').trim(),
        normalizedText: normalizedPhrase,
        selectedByDefault: true,
        phraseAudioKey: getColloAudioKey(expectedPhrase)
      }
    : null;

  const wordCandidates = missingContentTokens.map((token) => ({
    key: token,
    entryType: 'word',
    displayText: token,
    normalizedText: token,
    selectedByDefault: Number(wordMissCounts[token] || 0) >= 2
  }));

  return {
    phraseMissed,
    candidates: [phraseCandidate, ...wordCandidates].filter(Boolean),
    tracking: {
      phraseMissed,
      missedWords: missingContentTokens,
      correctWords: correctContentTokens
    }
  };
}
