const { admin } = require('../utils/firebase');
const { sendError } = require('../utils/response-helper');

module.exports = async function teacherAuthMiddleware(req, res, next) {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Missing or invalid authorization header.');
    }

    const idToken = authHeader.slice('Bearer '.length).trim();
    if (!idToken) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Missing bearer token.');
    }

    if (!admin || typeof admin.auth !== 'function') {
        return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin is not initialized.');
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken, true);
        req.user = decodedToken;
        return next();
    } catch (error) {
        if (error?.code === 'auth/id-token-revoked') {
            return sendError(res, 401, 'REVOKED_TOKEN', 'Session has been revoked.');
        }
        return sendError(res, 401, 'INVALID_TOKEN', 'Session expired or invalid.');
    }
};
