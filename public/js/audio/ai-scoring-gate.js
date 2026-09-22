'use strict';

/**
 * AI Scoring Gate Client Helper
 * Coordinates preflight quotes, student consent confirmation, and atomic job confirmation.
 * Works seamlessly across Read Aloud, Repeat Sentence, Retell Lecture, SGD, RTS, and Writing modes.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AiScoringGate = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  let confirmationModalInstance = null;

  function getConfirmationModal() {
    if (!confirmationModalInstance && window.AiCreditConfirmation?.AiCreditConfirmationModal) {
      confirmationModalInstance = new window.AiCreditConfirmation.AiCreditConfirmationModal();
    }
    return confirmationModalInstance;
  }

  /**
   * Requests a server quote, prompts for student confirmation, and confirms the quote.
   *
   * @param {Object} options
   * @param {string} options.mode - Practice mode ('read_aloud', 'sgd', 'rts', 'retell_lecture', etc.)
   * @param {Object} options.inputMeta - Input metadata (e.g. { sampleCount, sampleRateHz, referenceText, textResponse })
   * @param {string} [options.questionId] - ID of the question/prompt
   * @param {string} [options.preferredPackageId] - Optional requested package ID
   * @returns {Promise<{ allowed: boolean, quote?: Object, assessmentId?: string, cancelled?: boolean, unmetered?: boolean, error?: string }>}
   */
  async function requestConsentAndConfirm({ mode, inputMeta = {}, questionId = null, preferredPackageId = null }) {
    try {
      // 1. Fetch preflight quote from server
      const quoteRes = await fetch('/api/ai-scoring/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          inputMeta,
          questionId,
          preferredPackageId
        })
      });

      if (quoteRes.status === 503) {
        // Feature disabled: allow unmetered fallback so students are never blocked
        return { allowed: true, unmetered: true };
      }

      if (!quoteRes.ok) {
        const errPayload = await quoteRes.json().catch(() => null);
        console.warn('[AiScoringGate] Quote request rejected:', errPayload);
        return {
          allowed: false,
          error: errPayload?.message || `Quote request failed (${quoteRes.status})`
        };
      }

      const quote = await quoteRes.json();

      // If already completed or zero-credit preview in shadow mode
      if (quote.state === 'already_completed') {
        return { allowed: true, assessmentId: quote.assessmentId, quote };
      }

      if (quote.shadow) {
        console.log('[AiScoringGate] AI scoring in shadow mode; proceeding without charging.');
        return { allowed: true, unmetered: true, quote };
      }

      // 2. Open confirmation modal
      const modal = getConfirmationModal();
      if (!modal) {
        console.warn('[AiScoringGate] AiCreditConfirmationModal not found, proceeding.');
        return { allowed: true, unmetered: true };
      }

      const { confirmed } = await modal.requestConfirmation(quote);
      if (!confirmed) {
        return { allowed: false, cancelled: true };
      }

      // 3. Confirm quote on server
      const confirmRes = await fetch(`/api/ai-scoring/quotes/${quote.quoteId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputRevision: inputMeta.inputHash || quote.inputHash || 'v1'
        })
      });

      if (!confirmRes.ok) {
        const confirmErr = await confirmRes.json().catch(() => null);
        return {
          allowed: false,
          error: confirmErr?.message || confirmErr?.error || 'Failed to confirm credit reservation',
          code: confirmErr?.error || 'CONFIRM_FAILED'
        };
      }

      const confirmData = await confirmRes.json();
      return {
        allowed: true,
        quote,
        assessmentId: confirmData.assessmentId,
        quoteId: quote.quoteId
      };
    } catch (err) {
      console.error('[AiScoringGate] Error in scoring gate flow:', err);
      return {
        allowed: false,
        error: err.message || 'Scoring consent error'
      };
    }
  }

  /**
   * Helper to convert an Audio Blob to Base64 string for audioBuffer transport.
   * @param {Blob} blob
   * @returns {Promise<string|null>}
   */
  async function blobToBase64(blob) {
    if (!blob) return null;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        if (typeof result === 'string') {
          const base64 = result.includes(',') ? result.split(',')[1] : result;
          resolve(base64);
        } else {
          resolve(null);
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Polls the scoring job until completion or error.
   * @param {string} assessmentId
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async function pollAssessmentResult(assessmentId, { timeoutMs = 60000, intervalMs = 1500, signal } = {}) {
    if (!assessmentId) throw new Error('assessmentId is required for polling');
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (signal?.aborted) {
        throw new Error('Assessment polling aborted');
      }
      const res = await fetch(`/api/ai-scoring/assessments/${encodeURIComponent(assessmentId)}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal
      });
      if (res.status === 401 || res.status === 403) {
        const authErr = new Error('Authentication required for scoring status');
        authErr.code = 'UNAUTHORIZED';
        throw authErr;
      }
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'ready' || data.status === 'completed' || data.stage === 'completed') {
          return data.result || data;
        }
        if (data.status === 'failed') {
          const err = new Error(data.error || 'AI scoring failed');
          err.code = 'SCORING_JOB_FAILED';
          throw err;
        }
      }
      await new Promise(r => setTimeout(r, intervalMs));
    }
    const timeoutErr = new Error('AI scoring timed out. Results will be saved to your history.');
    timeoutErr.code = 'SCORING_TIMEOUT';
    throw timeoutErr;
  }

  return {
    requestConsentAndConfirm,
    getConfirmationModal,
    blobToBase64,
    pollAssessmentResult
  };
});
