/**
 * Retry utility with exponential backoff
 * Source: Azure Self-Healing design principles
 * 
 * Usage:
 *   const data = await withRetry(() => db.doc('users/123').get(), { maxRetries: 3 });
 */

const logger = require('./logger');

const DEFAULT_OPTIONS = {
  maxRetries: 3,
  baseDelay: 1000,    // 1 second
  maxDelay: 30000,    // 30 seconds
  backoffFactor: 2,
  retryableErrors: [
    'UNAVAILABLE',
    'DEADLINE_EXCEEDED',
    'RESOURCE_EXHAUSTED',
    'ABORTED',
    'INTERNAL',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND'
  ]
};

/**
 * Determines if an error is retryable
 */
function isRetryable(err, retryableErrors) {
  if (!err) return false;
  const code = err.code || '';
  const message = err.message || '';
  return retryableErrors.some(e =>
    code === e || code.toString() === e || message.includes(e)
  );
}

/**
 * Execute a function with exponential backoff retry
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @returns {Promise} Result of fn()
 */
async function withRetry(fn, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLastAttempt = attempt === opts.maxRetries;
      const shouldRetry = !isLastAttempt && isRetryable(err, opts.retryableErrors);

      if (!shouldRetry) {
        throw err;
      }

      const delay = Math.min(
        opts.baseDelay * Math.pow(opts.backoffFactor, attempt),
        opts.maxDelay
      );
      // Add jitter (±25%) to prevent thundering herd
      const jitter = delay * (0.75 + Math.random() * 0.5);

      logger.warn(`[RETRY] Attempt ${attempt + 1}/${opts.maxRetries} failed, retrying in ${Math.round(jitter)}ms`, {
        attempt: attempt + 1,
        maxRetries: opts.maxRetries,
        error: err.message,
        delayMs: Math.round(jitter)
      });

      await new Promise(resolve => setTimeout(resolve, jitter));
    }
  }
}

module.exports = { withRetry, isRetryable };
