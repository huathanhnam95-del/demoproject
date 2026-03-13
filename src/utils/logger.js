/**
 * Structured JSON logger
 * Source: 12-Factor App (Factor XI: Logs as event streams)
 * 
 * Usage:
 *   const logger = require('./utils/logger');
 *   logger.info('User logged in', { userId: '123', ip: req.ip });
 *   logger.warn('Slow query', { duration: 3200, collection: 'users' });
 *   logger.error('Failed to connect', { error: err.message });
 */

const LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4
};

const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL || 'info'];

// PII patterns to redact from logs
const PII_PATTERNS = [
  { regex: /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, replacement: '[EMAIL]' },
  { regex: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, replacement: 'Bearer [REDACTED]' },
  { regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replacement: '[JWT_REDACTED]' },
  { regex: /AIza[A-Za-z0-9_-]{35}/g, replacement: '[API_KEY_REDACTED]' },
  { regex: /ya29\.[A-Za-z0-9_-]+/g, replacement: '[OAUTH_TOKEN_REDACTED]' }
];

function sanitize(value) {
  if (typeof value !== 'string') return value;
  let sanitized = value;
  for (const { regex, replacement } of PII_PATTERNS) {
    sanitized = sanitized.replace(regex, replacement);
  }
  return sanitized;
}

function formatLog(level, message, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message: sanitize(message),
    ...meta
  };

  // Sanitize all string values in meta
  Object.keys(entry).forEach(key => {
    if (entry[key] === undefined) delete entry[key];
    else if (typeof entry[key] === 'string') entry[key] = sanitize(entry[key]);
  });

  return JSON.stringify(entry);
}

function shouldLog(level) {
  return (LEVELS[level] || 0) >= MIN_LEVEL;
}

const logger = {
  debug(message, meta) {
    if (shouldLog('debug')) console.debug(formatLog('debug', message, meta));
  },
  info(message, meta) {
    if (shouldLog('info')) console.log(formatLog('info', message, meta));
  },
  warn(message, meta) {
    if (shouldLog('warn')) console.warn(formatLog('warn', message, meta));
  },
  error(message, meta) {
    if (shouldLog('error')) console.error(formatLog('error', message, meta));
  },
  fatal(message, meta) {
    if (shouldLog('fatal')) console.error(formatLog('fatal', message, meta));
  },

  /**
   * Express middleware that adds requestId and logs request/response
   */
  requestMiddleware() {
    const crypto = require('crypto');
    return (req, res, next) => {
      req.requestId = crypto.randomUUID();
      res.setHeader('X-Request-Id', req.requestId);

      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        const logFn = res.statusCode >= 500 ? 'error'
          : res.statusCode >= 400 ? 'warn'
          : duration > 2000 ? 'warn'
          : 'info';

        logger[logFn](`${req.method} ${req.path}`, {
          requestId: req.requestId,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          duration: `${duration}ms`,
          ip: req.ip,
          userAgent: req.get('user-agent')
        });
      });

      next();
    };
  }
};

module.exports = logger;
