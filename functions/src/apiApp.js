const express = require('express');
const cors = require('cors');
const { FieldValue } = require('firebase-admin/firestore');
const { db, getAuth } = require('./utils/firebase_admin_init');
const {
    sendSuccess,
    sendError
} = require('./crm/http-contracts');
const createCrmRouter = require('./routes/admin/create-crm-router');
const {
    generateClassCode,
    claimProfile,
    lookupUserByEmail,
    forceLinkProfile,
    mergeCustomClaims
} = require('./studentIdentity');

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

function getBootstrapAdminEmails() {
    return new Set([
        'huathanhnam95@gmail.com',
        'admin@example.com',
        String(process.env.ADMIN_EMAIL || '').trim().toLowerCase()
    ].filter(Boolean));
}

const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return sendError(res, 401, 'UNAUTHORIZED', 'Missing or invalid token.');
        }

        const idToken = authHeader.slice('Bearer '.length).trim();
        const decodedToken = await getAuth().verifyIdToken(idToken);
        req.user = decodedToken;
        return next();
    } catch (error) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Authentication failed.', error?.message || error);
    }
};

const adminMiddleware = async (req, res, next) => {
    try {
        const uid = req.user.uid;
        const snap = await db.collection('users').doc(uid).get();
        const data = snap.exists ? snap.data() : null;

        if (data?.isAdmin) {
            return next();
        }

        return sendError(res, 403, 'FORBIDDEN', 'Admin access required.');
    } catch (error) {
        return sendError(res, 500, 'ADMIN_CHECK_ERROR', 'Failed to verify admin status.', error?.message || error);
    }
};

async function resolveAdminStatus({ req }) {
    const uid = String(req.user.uid || '').trim();
    const email = String(req.user.email || '').trim().toLowerCase();
    const userRef = db.collection('users').doc(uid);
    const snap = await userRef.get();
    const data = snap.exists ? snap.data() : null;

    if (data?.isAdmin) {
        return {
            isAdmin: true,
            uid,
            email: req.user.email || null,
            bootstrapped: false
        };
    }

    if (!getBootstrapAdminEmails().has(email)) {
        return {
            isAdmin: false,
            uid,
            email: req.user.email || null,
            bootstrapped: false
        };
    }

    await userRef.set({
        isAdmin: true,
        email: req.user.email || null,
        adminBootstrappedAt: new Date()
    }, { merge: true });
    await mergeCustomClaims(uid, { isAdmin: true });

    return {
        isAdmin: true,
        uid,
        email: req.user.email || null,
        bootstrapped: true
    };
}

app.post(['/students/claim-profile', '/api/students/claim-profile'], authMiddleware, async (req, res) => {
    try {
        const classCode = String(req.body?.classCode || '').trim();
        const result = await claimProfile(req.user.uid, classCode);
        return sendSuccess(res, result, 'Profile claimed successfully.');
    } catch (error) {
        return sendError(res, 400, 'CLAIM_FAILED', error?.message || 'Failed to claim profile.');
    }
});

const crmRouter = createCrmRouter({
    db,
    authMiddleware,
    adminMiddleware,
    sendSuccess,
    sendError,
    serverTimestamp: () => FieldValue.serverTimestamp(),
    resolveAdminStatus,
    identity: {
        generateClassCode,
        lookupUserByEmail,
        forceLinkProfile
    }
});

app.use('/admin', crmRouter);
app.use('/api/admin', crmRouter);

app.get(['/config', '/api/config'], (req, res) => {
    return res.json({
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

// --- Reading Journey Endpoints ---
const readingJourneyRouter = require('./routes/reading-journey');
app.use(['/reading-journey', '/api/reading-journey'], readingJourneyRouter);

module.exports = app;
