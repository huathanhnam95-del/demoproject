/**
 * Circuit Breaker wrapper for external API calls
 * Source: Martin Fowler's Circuit Breaker pattern
 * 
 * Usage:
 *   const { createBreaker } = require('../middleware/circuit-breaker');
 *   const aiBreaker = createBreaker('vertex-ai', { timeout: 30000 });
 *   const result = await aiBreaker.fire(async () => callVertexAI(prompt));
 */

const CircuitBreaker = require('opossum');
const logger = require('../utils/logger');

const DEFAULT_OPTIONS = {
  timeout: 30000,               // 30s — AI calls can be slow
  errorThresholdPercentage: 50, // Open after 50% failures
  resetTimeout: 30000,          // Try again after 30s
  rollingCountTimeout: 60000,   // Track errors over 60s window
  rollingCountBuckets: 6,       // 10s buckets within the window
  volumeThreshold: 5            // Need at least 5 requests to trip
};

// Store breakers by name for reuse
const breakers = new Map();

/**
 * Create or retrieve a named circuit breaker
 * @param {string} name - Identifier for this breaker (e.g., 'vertex-ai', 'openai')
 * @param {Object} options - Override default options
 * @returns {CircuitBreaker}
 */
function createBreaker(name, options = {}) {
  if (breakers.has(name)) {
    return breakers.get(name);
  }

  const opts = { ...DEFAULT_OPTIONS, ...options };

  // The breaker wraps a generic async function
  const breaker = new CircuitBreaker(async (fn) => fn(), opts);

  // --- Event logging ---
  breaker.on('open', () => {
    logger.warn(`[CIRCUIT-BREAKER] ${name}: OPEN — failing fast, not calling service`);
  });
  breaker.on('halfOpen', () => {
    logger.info(`[CIRCUIT-BREAKER] ${name}: HALF-OPEN — testing with next request`);
  });
  breaker.on('close', () => {
    logger.info(`[CIRCUIT-BREAKER] ${name}: CLOSED — service recovered`);
  });
  breaker.on('fallback', () => {
    logger.warn(`[CIRCUIT-BREAKER] ${name}: Serving fallback response`);
  });
  breaker.on('timeout', () => {
    logger.warn(`[CIRCUIT-BREAKER] ${name}: Request timed out`);
  });

  breakers.set(name, breaker);
  return breaker;
}

/**
 * Get health status of all breakers
 */
function getBreakerStatus() {
  const status = {};
  for (const [name, breaker] of breakers) {
    const stats = breaker.stats;
    status[name] = {
      state: breaker.opened ? 'open' : breaker.halfOpen ? 'half-open' : 'closed',
      successes: stats.successes,
      failures: stats.failures,
      timeouts: stats.timeouts,
      fallbacks: stats.fallbacks,
      rejected: stats.rejects
    };
  }
  return status;
}

module.exports = { createBreaker, getBreakerStatus };
