const { admin } = require('../utils/firebase');
const { sendError } = require('../utils/response-helper');

const authUserMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization || '';

    if (!authHeader.startsWith('Bearer ')) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Missing or invalid authorization header.');
    }

    const idToken = authHeader.slice('Bearer '.length).trim();
    if (!idToken) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Missing bearer token.');
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('[AUTH] Token verification failed:', error.message);
        if (error.code === 'auth/id-token-revoked') {
            return sendError(res, 401, 'REVOKED_TOKEN', 'Session has been revoked.');
        }
        return sendError(res, 401, 'INVALID_TOKEN', 'Session expired or invalid.');
    }
};

module.exports = authUserMiddleware;
