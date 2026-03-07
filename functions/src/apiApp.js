const express = require('express');
const cors = require('cors');
const { db, getAuth } = require('./utils/firebase_admin_init'); // Modular import

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// Helper to send success responses
const sendSuccess = (res, data, message = 'Success') => {
    res.json({ success: true, message, ...data });
};

// Helper to send error responses
const sendError = (res, status, error, message, details = null) => {
    res.status(status).json({ success: false, error, message, details });
};

// --- Middleware: Auth ---
const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return sendError(res, 401, 'UNAUTHORIZED', 'Missing or invalid token.');
        }
        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await getAuth().verifyIdToken(idToken);
        req.user = decodedToken;
        next();

    } catch (e) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Authentication failed.', e.message);
    }
};

const adminMiddleware = async (req, res, next) => {
    try {
        const uid = req.user.uid;
        const snap = await db.collection('users').doc(uid).get();
        const data = snap.exists ? snap.data() : null;

        if (data?.isAdmin) {
            next();
        } else {
            return sendError(res, 403, 'FORBIDDEN', 'Admin access required.');
        }
    } catch (e) {
        return sendError(res, 500, 'ADMIN_CHECK_ERROR', 'Failed to verify admin status.', e.message);
    }
};

// --- Student Identity Logic ---
const {
    generateClassCode,
    claimProfile,
    lookupUserByEmail,
    forceLinkProfile,
    mergeCustomClaims
} = require('./studentIdentity');

// --- Student Endpoints ---

// POST /api/students/claim-profile: Claim a profile via class code
app.post(['/students/claim-profile', '/api/students/claim-profile'], authMiddleware, async (req, res) => {
    try {
        const { classCode } = req.body;
        const result = await claimProfile(req.user.uid, classCode);
        sendSuccess(res, result, 'Profile claimed successfully.');
    } catch (e) {
        sendError(res, 400, 'CLAIM_FAILED', e.message);
    }
});

// --- Admin Student Management Endpoints ---

// POST /api/admin/students/:studentId/class-code: Generate a new class code
app.post(['/admin/students/:studentId/class-code', '/api/admin/students/:studentId/class-code'], authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { studentId } = req.params;
        const classCode = await generateClassCode();

        await db.collection('crmStudents').doc(studentId).update({
            class_code: classCode,
            updatedAt: new Date().toISOString()
        });

        sendSuccess(res, { classCode }, 'Class code generated.');
    } catch (e) {
        sendError(res, 500, 'CODE_GEN_FAILED', 'Failed to generate class code.', e.message);
    }
});

// GET /api/admin/users/lookup: Lookup user by email for manual linking
app.get(['/admin/users/lookup', '/api/admin/users/lookup'], authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { email } = req.query;
        if (!email) return sendError(res, 400, 'MISSING_EMAIL', 'Email query parameter is required.');

        const userData = await lookupUserByEmail(email);
        sendSuccess(res, { user: userData });
    } catch (e) {
        sendError(res, 404, 'USER_NOT_FOUND', e.message);
    }
});

// POST /api/admin/students/:studentId/force-link: Force link a user UID to a student record
app.post(['/admin/students/:studentId/force-link', '/api/admin/students/:studentId/force-link'], authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { studentId } = req.params;
        const { targetUid } = req.body;

        if (!targetUid) return sendError(res, 400, 'MISSING_UID', 'targetUid is required.');

        const result = await forceLinkProfile(studentId, targetUid);
        sendSuccess(res, result, 'User linked successfully.');
    } catch (e) {
        sendError(res, 500, 'LINK_FAILED', 'Failed to link user.', e.message);
    }
});

// --- Config Endpoint ---
app.get(['/config', '/api/config'], (req, res) => {

    res.json({
        success: true,
        config: {
            apiKey: process.env.CLIENT_FIREBASE_API_KEY,
            authDomain: process.env.CLIENT_FIREBASE_AUTH_DOMAIN,
            projectId: process.env.CLIENT_FIREBASE_PROJECT_ID,
            storageBucket: process.env.CLIENT_FIREBASE_STORAGE_BUCKET,
            messagingSenderId: process.env.CLIENT_FIREBASE_MESSAGING_SENDER_ID,
            appId: process.env.CLIENT_FIREBASE_APP_ID,
            measurementId: process.env.CLIENT_FIREBASE_MEASUREMENT_ID
        }
    });
});

// --- Admin Status Endpoint ---
app.get(['/admin/status', '/api/admin/status'], authMiddleware, async (req, res) => {

    try {
        const uid = req.user.uid;
        const snap = await db.collection('users').doc(uid).get();
        const data = snap.exists ? snap.data() : null;
        const isAdmin = !!data?.isAdmin;

        // Bootstrap if needed (as per original logic in src/routes/admin.js)
        let bootstrapped = false;
        if (!data?.isAdmin && (req.user.email === 'huathanhnam95@gmail.com' || req.user.email === 'admin@example.com')) {
            await db.collection('users').doc(uid).set({ isAdmin: true }, { merge: true });
            await mergeCustomClaims(uid, { isAdmin: true });
            bootstrapped = true;
        }

        sendSuccess(res, {
            isAdmin: isAdmin || bootstrapped,
            email: req.user.email,
            bootstrapped
        });
    } catch (e) {
        sendError(res, 500, 'ADMIN_CHECK_ERROR', 'Failed to check admin status.', e.message);
    }
});

module.exports = app;
