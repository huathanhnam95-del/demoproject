const crypto = require('crypto');

const COLLECTION = 'pronunciationReferenceAudio';
const ALLOWED_REASONS = new Set([
  'missing_source_audio',
  'source_variant_conflict',
  'acoustic_unrateable'
]);

function clean(value) {
  return String(value || '').trim();
}

function buildReferenceAudioKey(reference, variant) {
  const identity = {
    algorithmVersion: clean(reference?.algorithmVersion),
    word: clean(reference?.word).toLowerCase(),
    variantId: clean(variant?.id),
    partOfSpeech: clean(variant?.partOfSpeech).toLowerCase() || null,
    displayIpa: clean(variant?.displayIpa),
    primaryStress: Number.isInteger(variant?.primaryStress) ? variant.primaryStress : null
  };
  return crypto.createHash('sha1').update(JSON.stringify(identity), 'utf8').digest('hex');
}

function stressSignature(variant) {
  return JSON.stringify({
    ipa: clean(variant?.displayIpa),
    primaryStress: Number.isInteger(variant?.primaryStress) ? variant.primaryStress : null,
    syllableCount: Number(variant?.syllableCount) || 0
  });
}

function resolveDiscoveryReason(reference, variant, analysis) {
  if (!variant?.audioUrl) return 'missing_source_audio';
  const sameAudio = (reference?.variants || []).filter((candidate) => candidate?.audioUrl === variant.audioUrl);
  if (new Set(sameAudio.map(stressSignature)).size > 1) {
    return analysis?.audioCompatibility?.status === 'compatible' ? null : 'source_variant_conflict';
  }
  if (analysis?.audioCompatibility?.status === 'conflict') return 'source_variant_conflict';
  if (
    analysis?.audioCompatibility?.status === 'unrateable'
    || analysis?.pitchProcessing?.status === 'unrateable'
  ) return 'acoustic_unrateable';
  return null;
}

function buildWaitingRecord(reference, variant, reason, now = new Date()) {
  if (!ALLOWED_REASONS.has(reason)) throw new Error('Invalid pronunciation reference audio reason.');
  const referenceAudioKey = buildReferenceAudioKey(reference, variant);
  return {
    referenceAudioKey,
    algorithmVersion: clean(reference?.algorithmVersion),
    word: clean(reference?.word).toLowerCase(),
    variantId: clean(variant?.id),
    partOfSpeech: clean(variant?.partOfSpeech) || null,
    displayIpa: clean(variant?.displayIpa),
    syllableCount: Number(variant?.syllableCount) || 0,
    primaryStress: Number.isInteger(variant?.primaryStress) ? variant.primaryStress : null,
    secondaryStress: Array.isArray(variant?.secondaryStress) ? [...variant.secondaryStress] : [],
    syllables: Array.isArray(variant?.syllables) ? variant.syllables.map((item) => ({ ...item })) : [],
    discoveryReason: reason,
    firstSeenAt: now,
    lastSeenAt: now,
    lookupCount: 1,
    generationStatus: 'waiting',
    verificationStatus: 'pending',
    generatedAudio: null,
    lastError: null,
    updatedAt: now
  };
}

async function upsertReferenceAudioNeed({ db, reference, variant, reason, now = new Date() }) {
  const incoming = buildWaitingRecord(reference, variant, reason, now);
  const ref = db.collection(COLLECTION).doc(incoming.referenceAudioKey);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.exists ? snapshot.data() : null;
    const record = existing ? {
      ...incoming,
      firstSeenAt: existing.firstSeenAt || incoming.firstSeenAt,
      lookupCount: Number(existing.lookupCount || 0) + 1,
      generationStatus: existing.generationStatus || 'waiting',
      verificationStatus: existing.verificationStatus || 'pending',
      generatedAudio: existing.generatedAudio || null,
      lastError: existing.lastError || null
    } : incoming;
    transaction.set(ref, record, { merge: false });
    return record;
  });
}

module.exports = {
  ALLOWED_REASONS,
  COLLECTION,
  buildReferenceAudioKey,
  buildWaitingRecord,
  resolveDiscoveryReason,
  upsertReferenceAudioNeed
};
