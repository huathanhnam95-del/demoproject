const { admin } = require('../utils/firebase');
const { sendError } = require('../utils/response-helper');

module.exports = async function requireAuth(req, res, next) {
  const authHeader = String(req.headers.authorization || '');

  if (!authHeader.startsWith('Bearer ')) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Missing or invalid authorization header.');
  }

  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Missing bearer token.');
  }

  try {
    if (!admin?.auth) {
      return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
    }

    // checkRevoked=true adds a revocation check.
    const decodedToken = await admin.auth().verifyIdToken(idToken, true);
    req.user = decodedToken;
    return next();
  } catch (error) {
    const code = error?.code;
    if (code === 'auth/id-token-revoked') {
      return sendError(res, 401, 'REVOKED_TOKEN', 'Session has been revoked.');
    }
    return sendError(res, 401, 'INVALID_TOKEN', 'Session expired or invalid.');
  }
};

