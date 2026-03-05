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

