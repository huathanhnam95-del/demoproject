const { admin } = require('../utils/firebase');
const { sendError } = require('../utils/response-helper');

const IS_EMULATOR = !!process.env.FIREBASE_AUTH_EMULATOR_HOST;

/**
 * Decode an emulator JWT (alg: "none") without calling the Admin SDK.
 * firebase-admin v13 verifyIdToken hangs indefinitely against the Auth Emulator,
 * so we manually decode the token when in emulator mode.
 */
function decodeEmulatorToken(token) {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    try {
        const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
        if (header.alg !== 'none') return null;
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        if (!payload.sub && !payload.user_id) return null;
        payload.uid = payload.sub || payload.user_id;
        return payload;
    } catch (_) {
        return null;
    }
}

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
        let decodedToken;
        if (IS_EMULATOR) {
            decodedToken = decodeEmulatorToken(idToken);
            if (!decodedToken) {
                return sendError(res, 401, 'INVALID_TOKEN', 'Emulator token decode failed.');
            }
        } else {
            decodedToken = await admin.auth().verifyIdToken(idToken);
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

module.exports = authUserMiddleware;
