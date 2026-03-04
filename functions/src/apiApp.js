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
