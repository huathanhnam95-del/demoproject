const DEFAULT_ALLOWED_ORIGINS = new Set([
  'https://betterenglishlearning.com',
  'https://www.betterenglishlearning.com',
  'https://listening-tasks-3ae34.web.app',
  'https://listening-tasks-3ae34.firebaseapp.com',
]);

function parseAllowedOrigins(environment) {
  const configured = String(environment?.ECHO_FORGE_ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean);
  return new Set(configured.length ? configured : DEFAULT_ALLOWED_ORIGINS);
}

function normalizeOrigin(origin) {
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function isEmulatorOrigin(origin, environment) {
  return environment?.FUNCTIONS_EMULATOR === 'true'
    && /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);
}

function createEchoForgeOriginGuard({ environment = process.env } = {}) {
  const allowedOrigins = new Set([...parseAllowedOrigins(environment)].map(normalizeOrigin).filter(Boolean));
  return (req, res, next) => {
    const origin = normalizeOrigin(req.headers?.origin || '');
    if (!origin || (!allowedOrigins.has(origin) && !isEmulatorOrigin(origin, environment))) {
      return res.status(403).json({ success: false, error: 'ORIGIN_NOT_ALLOWED' });
    }
    return next();
  };
}

module.exports = { DEFAULT_ALLOWED_ORIGINS, createEchoForgeOriginGuard };
