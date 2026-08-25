import { normalizeAzureAnalysis } from './azure-analysis-adapter.js';
import { assertV3WordChallenge, normalizeV3Analysis } from './v3-analysis-adapter.js';

function nowDefault() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function failedEnvelope(code) {
  return { success: false, error: code };
}

export function createAnalysisClient({
  fetchImpl = globalThis.fetch,
  azureEndpoint = '/api/echo-forge/assess',
  v3BaseUrl,
  clock = nowDefault,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  const v3Root = String(v3BaseUrl || '').replace(/\/+$/, '');

  return Object.freeze({
    async prewarmV3() {
      if (!v3Root) return Object.freeze({ durationMs: 0, available: false, httpCode: null, errorCode: 'V3_BASE_URL_MISSING' });
      const startedAt = clock();
      try {
        const response = await fetchImpl(`${v3Root}/warm/v3`, { method: 'POST', keepalive: true });
        return Object.freeze({ durationMs: Math.max(0, clock() - startedAt), available: response.ok, httpCode: response.status, errorCode: response.ok ? null : 'V3_PREWARM_FAILED' });
      } catch {
        return Object.freeze({ durationMs: Math.max(0, clock() - startedAt), available: false, httpCode: null, errorCode: 'V3_PREWARM_FAILED' });
      }
    },
    async analyze({ blob, challenge, signal } = {}) {
      if (!(blob instanceof Blob)) throw new TypeError('WAV blob is required');
      const isV3 = challenge?.evaluationMode === 'v3_word';
      if (isV3) assertV3WordChallenge(challenge);
      if (isV3 && !v3Root) throw new Error('V3 base URL is required');
      const formData = new FormData();
      formData.append('audio', blob, `${challenge.challengeId}.wav`);
      let url;
      if (isV3) {
        url = `${v3Root}/analyze/v3`;
        formData.append('reference_ipa', challenge.pronunciation.ipa);
        formData.append('expected_syllables', String(challenge.pronunciation.expectedSyllableCount));
        formData.append('target_word', challenge.text);
        formData.append('variant_id', challenge.pronunciation.variantId);
      } else {
        url = azureEndpoint;
        formData.append('referenceText', challenge.text);
        formData.append('challengeId', challenge.challengeId);
        formData.append('evaluationMode', challenge.evaluationMode);
      }

      const requestStarted = clock();
      let response;
      let payload;
      let requestEnded;
      let responseEnded;
      try {
        response = await fetchImpl(url, { method: 'POST', body: formData, signal });
        requestEnded = clock();
        payload = await response.json().catch(() => ({}));
        responseEnded = clock();
        if (!response.ok) payload = { ...payload, success: false, error: payload.error || payload.code || `HTTP_${response.status}` };
      } catch (error) {
        requestEnded = clock();
        responseEnded = requestEnded;
        payload = failedEnvelope(error?.name === 'AbortError' ? 'CANCELLED' : 'REQUEST_FAILED');
        response = null;
      }
      const normalizationStarted = clock();
      const analysis = isV3
        ? normalizeV3Analysis(payload, challenge)
        : normalizeAzureAnalysis(payload, challenge);
      const normalizationEnded = clock();
      return Object.freeze({
        analysis,
        timing: Object.freeze({
          requestDurationMs: Math.max(0, requestEnded - requestStarted),
          responseDurationMs: Math.max(0, responseEnded - requestEnded),
          normalizationDurationMs: Math.max(0, normalizationEnded - normalizationStarted),
          httpCode: response?.status ?? null,
          errorCode: analysis.reasonCode,
        }),
      });
    },
  });
}
