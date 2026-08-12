const express = require('express');
const {
  buildReferenceAudioKey,
  COLLECTION,
  resolveDiscoveryReason,
  upsertReferenceAudioNeed
} = require('../pronunciation-reference-audio/service');

const DEFAULT_BACKEND_URL = 'https://praat-api-1071929245506.us-central1.run.app';
const VARIANT_ID_RE = /^[0-9a-f]{16}$/;
const WORD_RE = /^[a-z][a-z' -]{0,79}$/;

class ReferenceAudioReportError extends Error {
  constructor(message, status = 400, code = 'REFERENCE_AUDIO_REPORT_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function fetchJson(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      throw new ReferenceAudioReportError('Authoritative pronunciation service unavailable.', 503, 'PRONUNCIATION_SERVICE_UNAVAILABLE');
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function defaultBackendUrl() {
  return String(process.env.PRAAT_BACKEND_URL || DEFAULT_BACKEND_URL).replace(/\/+$/, '');
}

async function defaultFetchReference(word) {
  return fetchJson(`${defaultBackendUrl()}/dictionary/v2/${encodeURIComponent(word)}`);
}

async function defaultAnalyzeVariant(variant) {
  return fetchJson(`${defaultBackendUrl()}/analyze-url/v2`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      audioUrl: variant.audioUrl,
      variantId: variant.id,
      expectedSyllableCount: variant.syllableCount,
      referenceIpa: variant.displayIpa,
      referencePrimaryStress: variant.primaryStress,
      referenceSyllables: variant.syllables,
      partOfSpeech: variant.partOfSpeech || null,
      audioSourceKind: 'dictionary'
    })
  }, 30000);
}

async function reportReferenceAudioNeed({
  db,
  word,
  variantId,
  fetchReference = defaultFetchReference,
  analyzeVariant = defaultAnalyzeVariant,
  now = new Date()
}) {
  const normalizedWord = String(word || '').trim().toLowerCase();
  const normalizedVariantId = String(variantId || '').trim();
  if (!WORD_RE.test(normalizedWord)) throw new ReferenceAudioReportError('Valid word is required.');
  if (!VARIANT_ID_RE.test(normalizedVariantId)) throw new ReferenceAudioReportError('Valid variantId is required.');

  const reference = await fetchReference(normalizedWord);
  if (String(reference?.word || '').trim().toLowerCase() !== normalizedWord) {
    throw new ReferenceAudioReportError('Authoritative word mismatch.', 409, 'REFERENCE_WORD_MISMATCH');
  }
  const variant = (reference?.variants || []).find((candidate) => candidate?.id === normalizedVariantId);
  if (!variant) throw new ReferenceAudioReportError('Authoritative pronunciation variant not found.', 404, 'REFERENCE_VARIANT_NOT_FOUND');

  const preliminaryReason = variant.audioUrl ? null : 'missing_source_audio';
  // Shared recordings are still measured against every attached variant. A
  // confidently compatible form keeps the source; contradictory forms queue.
  const analysis = preliminaryReason ? null : await analyzeVariant(variant);
  const reason = preliminaryReason || resolveDiscoveryReason(reference, variant, analysis);
  if (!reason) return { queued: false, reason: null };
  const record = await upsertReferenceAudioNeed({ db, reference, variant, reason, now });
  return { queued: true, reason, record };
}

async function resolveGeneratedReferenceAudio({ db, word, variantId, fetchReference = defaultFetchReference }) {
  const normalizedWord = String(word || '').trim().toLowerCase();
  const normalizedVariantId = String(variantId || '').trim();
  if (!WORD_RE.test(normalizedWord) || !VARIANT_ID_RE.test(normalizedVariantId)) {
    throw new ReferenceAudioReportError('Valid word and variantId are required.');
  }
  const reference = await fetchReference(normalizedWord);
  const variant = (reference?.variants || []).find((candidate) => candidate?.id === normalizedVariantId);
  if (!variant) throw new ReferenceAudioReportError('Authoritative pronunciation variant not found.', 404, 'REFERENCE_VARIANT_NOT_FOUND');
  const key = buildReferenceAudioKey(reference, variant);
  const record = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(db.collection(COLLECTION).doc(key));
    return snapshot.exists ? snapshot.data() : null;
  });
  if (
    record?.generationStatus !== 'generated'
    || record?.verificationStatus !== 'passed'
    || !record?.generatedAudio?.storagePath
    || !record?.referenceAnalysis
  ) return { available: false };
  return {
    available: true,
    generatedAudio: {
      ...record.generatedAudio,
      sourceKind: 'generated',
      url: `/api/pronunciation-reference-audio/${key}/audio`
    },
    referenceAnalysis: record.referenceAnalysis
  };
}

function createPronunciationReferenceAudioRouter({ db, sendSuccess, sendError, getStorageBucket, fetchReference, analyzeVariant }) {
  const router = express.Router();
  router.post('/pronunciation-reference-audio/report', async (req, res) => {
    try {
      const result = await reportReferenceAudioNeed({
        db,
        word: req.body?.word,
        variantId: req.body?.variantId,
        fetchReference,
        analyzeVariant
      });
      return sendSuccess(res, result);
    } catch (error) {
      return sendError(
        res,
        error?.status || 500,
        error?.code || 'REFERENCE_AUDIO_REPORT_ERROR',
        error?.message || 'Failed to report pronunciation reference audio.'
      );
    }
  });
  router.get('/pronunciation-reference-audio/resolve', async (req, res) => {
    try {
      return sendSuccess(res, await resolveGeneratedReferenceAudio({
        db,
        word: req.query?.word,
        variantId: req.query?.variantId,
        fetchReference
      }));
    } catch (error) {
      return sendError(res, error?.status || 500, error?.code || 'REFERENCE_AUDIO_RESOLVE_ERROR', error?.message || 'Failed to resolve generated pronunciation audio.');
    }
  });
  router.get('/pronunciation-reference-audio/:referenceAudioKey/audio', async (req, res) => {
    const key = String(req.params.referenceAudioKey || '').trim();
    if (!/^[a-f0-9]{40}$/.test(key)) return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid referenceAudioKey.');
    try {
      const snapshot = await db.collection(COLLECTION).doc(key).get();
      const record = snapshot.exists ? snapshot.data() : null;
      if (record?.verificationStatus !== 'passed' || !record?.generatedAudio?.storagePath) {
        return sendError(res, 404, 'AUDIO_NOT_FOUND', 'Generated pronunciation audio not found.');
      }
      const bucket = await getStorageBucket();
      const [bytes] = await bucket.file(record.generatedAudio.storagePath).download();
      res.set('Content-Type', 'audio/mpeg');
      res.set('Cache-Control', 'public, max-age=86400, immutable');
      return res.status(200).send(bytes);
    } catch (error) {
      return sendError(res, 500, 'REFERENCE_AUDIO_STREAM_ERROR', error?.message || 'Failed to stream generated pronunciation audio.');
    }
  });
  return router;
}

module.exports = createPronunciationReferenceAudioRouter;
module.exports.ReferenceAudioReportError = ReferenceAudioReportError;
module.exports.reportReferenceAudioNeed = reportReferenceAudioNeed;
module.exports.resolveGeneratedReferenceAudio = resolveGeneratedReferenceAudio;
