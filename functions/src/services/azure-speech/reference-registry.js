'use strict';

const crypto = require('crypto');
const registry = require('../../data/speech-reference-registry.v3.json');
const { normalizePracticeMode } = require('../../practice-attempts/attempt-constraints');

function resolveFixedReference(mode, questionId, suppliedText = null) {
  const canonical = normalizePracticeMode(mode);
  if (!['read_aloud', 'repeat_sentence'].includes(canonical)) throw new Error('FIXED_REFERENCE_MODE_REQUIRED');
  const id = String(questionId || '').trim();
  const text = registry.entries[canonical]?.[id];
  if (!text) throw new Error('REFERENCE_NOT_FOUND');
  if (suppliedText != null && String(suppliedText).trim() !== text) throw new Error('REFERENCE_MISMATCH');
  const revision = crypto.createHash('sha256').update(`${canonical}:${id}:${text}`).digest('hex');
  return Object.freeze({
    kind: 'fixed_reference',
    text,
    displayText: text,
    hash: crypto.createHash('sha256').update(text).digest('hex'),
    source: 'server_question_registry',
    questionId: id,
    revision,
    sourceHash: registry.sourceHashes[canonical]
  });
}

module.exports = { resolveFixedReference };
