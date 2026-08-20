const express = require('express');
const cors = require('cors');
const { FieldValue } = require('firebase-admin/firestore');
const { db, getAuth, getStorageBucket } = require('./utils/firebase_admin_init');
const {
    sendSuccess,
    sendError
} = require('./crm/http-contracts');
const { CRM_LEADS } = require('./crm/collections');
const { buildLeadStageSyncPatch } = require('./crm/lead-service');
const { buildEntranceTestAdminList } = require('./crm/entrance-test-link-recovery');
const createCrmRouter = require('./routes/admin/create-crm-router');
const createTeacherSchedulerRouter = require('./routes/teacher/scheduler');
const entranceTestRoutes = require('./routes/entrance-tests');
const createPracticeAttemptsRouter = require('./routes/practice-attempts');
const createSharedPracticeAttemptsRouter = require('./routes/shared-practice-attempts');
const createEssayAiAdminRouter = require('./essay-ai/admin-routes');
const readAloudRoutes = require('./routes/read-aloud');
const pronunciationTestRoutes = require('./routes/pronunciation-test');
const createPronunciationReferenceAudioRouter = require('./routes/pronunciation-reference-audio');
const {
    practiceAttemptsLimiterByUid,
    sharedPracticeAttemptsLimiter,
    azureAssessmentRateLimiter
} = require('./middleware/practice-attempts-rate-limiter');
const { TEST_VERSION } = require('./entrance-test/test36plus');
const {
    generateClassCode,
    claimProfile,
    lookupUserByEmail,
    forceLinkProfile,
    mergeCustomClaims
} = require('./studentIdentity');

const app = express();
app.set('trust proxy', true); // Cloud Functions runs behind Google's load balancer
app.use(cors({ origin: true }));
app.use(express.json());

// Expose public Firebase client configuration without rate-limiting blocks.
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

// Emails allowed to self-promote to admin on first sign-in. Keep this to real,
// controlled mailboxes only: any address listed here becomes an escalation path
// for whoever can register it. Placeholder/test addresses must never appear —
// tests inject their own resolver, and the emulator seeds admins through
// scripts/seed-emulator-admin.js.
function getBootstrapAdminEmails() {
    return new Set([
        'huathanhnam95@gmail.com',
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

const optionalAuthMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const idToken = authHeader.slice('Bearer '.length).trim();
            const decodedToken = await getAuth().verifyIdToken(idToken);
            req.user = decodedToken;
        }
    } catch (error) {
        console.warn('[RateLimiter] Optional auth token verification failed:', error?.message || error);
    }
    return next();
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

    // Bootstrap promotes on the strength of an email address alone, so the
    // address must be one Firebase has actually proven the caller controls.
    // Without this, anyone able to register an allowlisted address on an open
    // signup project would be granted admin on their first /admin/status call.
    if (!getBootstrapAdminEmails().has(email) || req.user.email_verified !== true) {
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
    getStorageBucket,
    serverTimestamp: () => FieldValue.serverTimestamp(),
    resolveAdminStatus,
    getBootstrapAdminEmails,
    identity: {
        generateClassCode,
        lookupUserByEmail,
        forceLinkProfile
    },
    registerExtraRoutes(router, deps) {
        if (process.env.ENABLE_LEGACY_DUPLICATE_ENTRANCE_TEST_ROUTES !== '1') {
            return;
        }

        const crypto = require('crypto');

        function hashTokenToTestId(token) {
            return crypto.createHash('sha256').update(String(token || '')).digest('hex');
        }

        // POST /students/:studentId/entrance-tests — create a new entrance test
        router.post('/students/:studentId/entrance-tests', ...deps.requireAdminHandlers, async (req, res) => {
            try {
                const studentId = String(req.params.studentId || '').trim();
                if (!studentId) return deps.sendError(res, 400, 'VALIDATION_ERROR', 'Missing studentId.');

                let token = null;
                let testId = null;
                for (let i = 0; i < 5; i++) {
                    const nextToken = crypto.randomBytes(32).toString('base64url');
                    const nextTestId = hashTokenToTestId(nextToken);
                    const existing = await deps.db.collection('entranceTests').doc(nextTestId).get();
                    if (!existing.exists) { token = nextToken; testId = nextTestId; break; }
                }

                if (!token || !testId) return deps.sendError(res, 500, 'TOKEN_ERROR', 'Failed to generate a unique token.');

                const studentRef = deps.db.collection('crmStudents').doc(studentId);
                const testRef = deps.db.collection('entranceTests').doc(testId);
                await deps.db.runTransaction(async (tx) => {
                    const studentSnap = await tx.get(studentRef);
                    if (!studentSnap.exists) {
                        throw new Error('STUDENT_NOT_FOUND');
                    }

                    const leadId = String(studentSnap.data()?.leadId || '').trim();
                    const leadRef = leadId ? deps.db.collection(CRM_LEADS).doc(leadId) : null;
                    const leadSnap = leadRef ? await tx.get(leadRef) : null;
                    const existingTestSnap = await tx.get(testRef);
                    if (existingTestSnap.exists) {
                        throw new Error('TOKEN_ERROR');
                    }

                    tx.set(testRef, {
                        studentId,
                        version: TEST_VERSION,
                        status: 'created',
                        deliveryToken: token,
                        createdAt: deps.serverTimestamp(),
                        createdBy: req.user.uid,
                        createdByEmail: req.user.email || null,
                        startedAt: null,
                        submittedAt: null
                    });

                    if (leadRef && leadSnap?.exists) {
                        const leadPatch = buildLeadStageSyncPatch(leadSnap.data() || {}, 'test_scheduled', {
                            user: req.user,
                            serverTimestamp: deps.serverTimestamp
                        });
                        if (leadPatch) {
                            tx.set(leadRef, leadPatch, { merge: true });
                        }
                    }
                });

                const links = buildEntranceTestLinks(req, { deliveryToken: token, testId });
                return deps.sendSuccess(res, {
                    testId,
                    testLink: links.testLink,
                    resultLink: links.resultLink
                }, 'Entrance test link created.');
            } catch (error) {
                if (error?.message === 'STUDENT_NOT_FOUND') {
                    return deps.sendError(res, 404, 'STUDENT_NOT_FOUND', 'Student profile not found.');
                }
                return deps.sendError(res, 500, 'CREATE_TEST_ERROR', 'Failed to create entrance test link.', error?.message || error);
            }
        });

        // GET /students/:studentId/entrance-tests — list entrance tests for a student
        router.get('/students/:studentId/entrance-tests', ...deps.requireAdminHandlers, async (req, res) => {
            try {
                const studentId = String(req.params.studentId || '').trim();
                if (!studentId) return deps.sendError(res, 400, 'VALIDATION_ERROR', 'Missing studentId.');

                const snaps = await deps.db.collection('entranceTests').where('studentId', '==', studentId).get();
                const tests = snaps.docs.map((doc) => {
                    const data = doc.data() || {};
                    const status = data.status || null;
                    const deliveryToken = String(data.deliveryToken || '').trim();
                    return {
                        testId: doc.id,
                        version: data.version || null,
                        status,
                        createdAt: data.createdAt || null,
                        startedAt: data.startedAt || null,
                        submittedAt: data.submittedAt || null,
                        deliveryToken: (status === 'created' || status === 'started') && deliveryToken
                            ? deliveryToken
                            : null
                    };
                });

                tests.sort((a, b) => {
                    const aMs = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
                    const bMs = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
                    return bMs - aMs;
                });

                const testsWithLinks = await buildEntranceTestAdminList(req, deps.db, tests);

                return deps.sendSuccess(res, { tests: testsWithLinks });
            } catch (error) {
                return deps.sendError(res, 500, 'LIST_TESTS_ERROR', 'Failed to list entrance tests.', error?.message || error);
            }
        });

        // GET /entrance-tests/:testId — get entrance test details
        router.get('/entrance-tests/:testId', ...deps.requireAdminHandlers, async (req, res) => {
            try {
                const testId = String(req.params.testId || '').trim();
                if (!testId || testId.length < 20) return deps.sendError(res, 400, 'VALIDATION_ERROR', 'Invalid testId.');

                const testSnap = await deps.db.collection('entranceTests').doc(testId).get();
                if (!testSnap.exists) return deps.sendError(res, 404, 'TEST_NOT_FOUND', 'Entrance test not found.');

                const test = testSnap.data() || {};
                const studentId = String(test.studentId || '').trim();
                const studentSnap = studentId ? await deps.db.collection('crmStudents').doc(studentId).get() : null;
                const student = studentSnap && studentSnap.exists ? (studentSnap.data() || {}) : null;

                return deps.sendSuccess(res, {
                    testId,
                    test,
                    student: student ? { id: studentId, ...student } : null
                });
            } catch (error) {
                return deps.sendError(res, 500, 'GET_TEST_ERROR', 'Failed to fetch entrance test details.', error?.message || error);
            }
        });
    }
});

const teacherSchedulerRouter = createTeacherSchedulerRouter({
    db,
    authMiddleware,
    sendSuccess,
    sendError,
    serverTimestamp: () => FieldValue.serverTimestamp()
});

const practiceAttemptsRouter = createPracticeAttemptsRouter({
    db,
    sendSuccess,
    sendError,
    getStorageBucket,
    serverTimestamp: () => FieldValue.serverTimestamp()
});

const sharedPracticeAttemptsRouter = createSharedPracticeAttemptsRouter({
    db,
    sendSuccess,
    sendError,
    getStorageBucket
});

const essayAiAdminRouter = createEssayAiAdminRouter({
    db,
    authMiddleware,
    adminMiddleware,
    sendSuccess,
    sendError
});
const pronunciationReferenceAudioRouter = createPronunciationReferenceAudioRouter({
    db,
    sendSuccess,
    sendError,
    getStorageBucket
});

app.use('/api/admin/essay-ai', essayAiAdminRouter);
app.use('/admin', crmRouter);
app.use('/api/admin', crmRouter);
app.use('/api/teacher', teacherSchedulerRouter);
app.use('/api/entrance-tests', entranceTestRoutes);
app.use('/api/practice-attempts', authMiddleware, practiceAttemptsLimiterByUid, practiceAttemptsRouter);
app.use('/api/shared/practice-attempts', sharedPracticeAttemptsLimiter, sharedPracticeAttemptsRouter);
app.use('/api/read-aloud/assess', optionalAuthMiddleware, azureAssessmentRateLimiter);
app.use('/api/pronunciation-test/assess', optionalAuthMiddleware, azureAssessmentRateLimiter);
app.use('/api/pronunciation-test/vowel-hint', optionalAuthMiddleware, azureAssessmentRateLimiter);
app.use('/api', optionalAuthMiddleware, readAloudRoutes);
app.use('/api', optionalAuthMiddleware, pronunciationTestRoutes);
app.use('/api', pronunciationReferenceAudioRouter);


// --- Reading Journey Endpoints ---
const readingJourneyRouter = require('./routes/reading-journey');
app.use(['/reading-journey', '/api/reading-journey'], readingJourneyRouter);

module.exports = app;
