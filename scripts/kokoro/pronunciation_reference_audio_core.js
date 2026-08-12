const VOICE = 'af_heart';

function optionValue(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  return index >= 0 ? String(argv[index + 1] || '') : fallback;
}

function parseArgs(argv) {
  const limitRaw = optionValue(argv, '--limit', '100');
  return {
    apiBase: optionValue(argv, '--api-base', process.env.CRM_API_BASE || 'http://127.0.0.1:5001/listening-tasks-3ae34/us-central1/api'),
    token: optionValue(argv, '--token', process.env.CRM_ADMIN_TOKEN || ''),
    limit: Math.max(0, Number(limitRaw) || 0),
    key: optionValue(argv, '--key', ''),
    dryRun: argv.includes('--dry-run'),
    startServer: !argv.includes('--no-server')
  };
}

function buildControlledPhonemes(item) {
  const ipa = String(item?.displayIpa || item?.rawIpa || '').trim();
  if (!ipa) throw new Error('Authoritative IPA is required for controlled generation.');
  const controlled = ipa
    .replace(/^\/+|\/+$/g, '')
    .replace(/[.·\s-]+/g, '')
    .trim();
  if (!controlled || controlled.length > 300) throw new Error('Authoritative IPA cannot be converted to controlled phonemes.');
  return controlled;
}

function selectWaitingItems(items, options = {}) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item?.generationStatus === 'waiting')
    .filter((item) => !options.key || item.referenceAudioKey === options.key || item.id === options.key)
    .slice(0, options.limit == null ? 100 : options.limit);
}

function buildGenerationMetadata(item, provenance) {
  return {
    schemaVersion: 'pronunciation-reference-audio-generation-v1',
    referenceAudioKey: item.referenceAudioKey || item.id,
    variantId: item.variantId,
    voice: VOICE,
    modelRevision: provenance.modelRevision,
    generatorRevision: provenance.generatorRevision,
    controlledPhonemes: provenance.controlledPhonemes,
    durationMs: Math.round(Number(provenance.durationMs))
  };
}

module.exports = {
  VOICE,
  buildControlledPhonemes,
  buildGenerationMetadata,
  parseArgs,
  selectWaitingItems
};
