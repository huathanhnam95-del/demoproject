const { admin } = require('../utils/firebase');
const { sendError } = require('../utils/response-helper');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization || '';

    if (!authHeader.startsWith('Bearer ')) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Missing or invalid authorization header.');
    }

    const idToken = authHeader.slice('Bearer '.length).trim();
    if (!idToken) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Missing bearer token.');
    }

    try {
        // checkRevoked=true adds a revocation check (important for admin actions)
        const decodedToken = await admin.auth().verifyIdToken(idToken, true);

        if (!decodedToken.email) {
            return sendError(res, 403, 'FORBIDDEN', 'Email is required for admin access.');
        }

        if (!decodedToken.email_verified) {
            return sendError(res, 403, 'FORBIDDEN', 'Verified email required for admin access.');
        }

        // Check if user is admin (using the whitelist)
        if (decodedToken.email !== ADMIN_EMAIL) {
            console.warn(`[AUTH] Unauthorized access attempt by ${decodedToken.email}`);
            return sendError(res, 403, 'FORBIDDEN', 'Admin privileges required.');
        }

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

module.exports = authMiddleware;
