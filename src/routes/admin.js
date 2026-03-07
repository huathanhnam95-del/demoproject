const express = require('express');
const router = express.Router();
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { admin, db, getStorageBucket } = require('../utils/firebase');
const { sendError, sendSuccess } = require('../utils/response-helper');
const authMiddleware = require('../middleware/auth');
const { hashTokenToTestId, TEST_VERSION, buildPublicSession } = require('../entrance-test/test36plus');

// --- Tight Rate Limiter for Admin Actions ---
const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Max 10 attempts per IP
    message: {
        success: false,
        error: 'TOO_MANY_ADMIN_REQUESTS',
        message: 'Too many admin requests. Please try again later.'
    }
});

// --- Lighter Rate Limiter for CRM/Admin Reads/Writes ---
const crmLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    message: {
        success: false,
        error: 'TOO_MANY_REQUESTS',
        message: 'Too many requests. Please try again later.'
    }
});

// --- Middleware: Concurrency Lock ---
let isSyncing = false;
const syncLockMiddleware = (req, res, next) => {
    if (isSyncing) {
        return sendError(res, 429, 'SYNC_IN_PROGRESS', 'A database synchronization is already in progress.');
    }
    next();
};

/**
 * Admin status endpoint (server-verified)
 * - Confirms the requester is the admin (via authMiddleware)
 * - Bootstraps Firestore `users/{uid}.isAdmin = true` so client-side Firestore writes work
 */
router.get('/status', authMiddleware, async (req, res) => {
    if (!db) {
        return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
    }

    let bootstrapped = false;
    try {
        await db.collection('users').doc(String(req.user.uid)).set({
            isAdmin: true,
            email: req.user.email || null,
            adminBootstrappedAt: new Date()
        }, { merge: true });
        bootstrapped = true;
    } catch (error) {
        console.warn('[Admin] Failed to bootstrap isAdmin flag:', error?.message || error);
    }

    return sendSuccess(res, {
        isAdmin: true,
        uid: req.user.uid,
        email: req.user.email,
        bootstrapped
    }, bootstrapped ? 'Admin verified.' : 'Admin verified (bootstrap failed).');
});

/**
 * CRM: Create Student Profile (server-side)
 * Requires at least 1 field from Info tab.
 */
router.post('/students', crmLimiter, authMiddleware, async (req, res) => {
    try {
        if (!db) {
            return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
        }

        const input = req.body && typeof req.body === 'object' ? req.body : {};
        const fields = {
            name: String(input.name || '').trim() || null,
            label: String(input.label || '').trim() || null,
            phone: String(input.phone || '').trim() || null,
            email: String(input.email || '').trim() || null,
            zalo: String(input.zalo || '').trim() || null,
            facebook: String(input.facebook || '').trim() || null
        };

        const hasAny = Object.values(fields).some(v => !!v);
        if (!hasAny) {
            return sendError(res, 400, 'VALIDATION_ERROR', 'Please fill at least 1 field in Info tab before saving.');
        }

        const ref = db.collection('crmStudents').doc();
        await ref.set({
            ...fields,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdBy: req.user.uid,
            createdByEmail: req.user.email || null
        });

        return sendSuccess(res, { studentId: ref.id }, 'Student profile created.');
    } catch (e) {
        console.error('[CRM] Create student failed:', e);
        return sendError(res, 500, 'CREATE_STUDENT_ERROR', 'Failed to create student profile.', e?.message || e);
    }
});

/**
 * CRM: List student profiles (server-side)
 */
router.get('/students', crmLimiter, authMiddleware, async (req, res) => {
    try {
        if (!db) {
            return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
        }

        const requestedLimit = Number(req.query?.limit);
        const limit = Number.isFinite(requestedLimit)
            ? Math.min(500, Math.max(1, Math.floor(requestedLimit)))
            : 200;

        const snaps = await db
            .collection('crmStudents')
            .orderBy('createdAt', 'desc')
            .limit(limit)
            .get();

        const students = snaps.docs.map((doc) => {
            const data = doc.data() || {};
            return {
                studentId: doc.id,
                name: data.name || null,
                label: data.label || null,
                phone: data.phone || null,
                email: data.email || null,
                zalo: data.zalo || null,
                facebook: data.facebook || null,
                createdAt: data.createdAt || null,
                createdBy: data.createdBy || null,
                createdByEmail: data.createdByEmail || null
            };
        });

        return sendSuccess(res, { students, count: students.length });
    } catch (e) {
        console.error('[CRM] List students failed:', e);
        return sendError(res, 500, 'LIST_STUDENTS_ERROR', 'Failed to list student profiles.', e?.message || e);
    }
});

/**
 * CRM: Get a student profile (server-side)
 */
router.get('/students/:studentId', crmLimiter, authMiddleware, async (req, res) => {
    try {
        if (!db) {
            return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
        }

        const studentId = String(req.params.studentId || '').trim();
        if (!studentId) {
            return sendError(res, 400, 'VALIDATION_ERROR', 'Missing studentId.');
        }

        const snap = await db.collection('crmStudents').doc(studentId).get();
        if (!snap.exists) {
            return sendError(res, 404, 'STUDENT_NOT_FOUND', 'Student profile not found.');
        }

        const data = snap.data() || {};
        return sendSuccess(res, {
            student: {
                studentId,
                name: data.name || null,
                label: data.label || null,
                phone: data.phone || null,
                email: data.email || null,
                zalo: data.zalo || null,
                facebook: data.facebook || null,
                createdAt: data.createdAt || null,
                createdBy: data.createdBy || null,
                createdByEmail: data.createdByEmail || null
            }
        });
    } catch (e) {
        console.error('[CRM] Get student failed:', e);
        return sendError(res, 500, 'GET_STUDENT_ERROR', 'Failed to fetch student profile.', e?.message || e);
    }
});

/**
 * CRM: Create Course (server-side)
 * Accepts basic course info + list of teacher emails.
 */
router.post('/courses', crmLimiter, authMiddleware, async (req, res) => {
    try {
        if (!db) {
            return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
        }

        const input = req.body && typeof req.body === 'object' ? req.body : {};
        const fields = {
            name: String(input.name || '').trim(),
            code: String(input.code || '').trim(),
            label: String(input.label || '').trim(),
            level: String(input.level || '').trim(),
            category: String(input.category || '').trim(),
            status: String(input.status || '').trim() || 'active',
            description: String(input.description || '').trim()
        };

        if (!fields.name) {
            return sendError(res, 400, 'VALIDATION_ERROR', 'Please provide a course name before saving.');
        }

        let teachers = [];
        if (Array.isArray(input.teachers)) {
            teachers = input.teachers
                .map(t => String(t || '').trim().toLowerCase())
                .filter(Boolean);
        }

        const ref = db.collection('crmCourses').doc();
        await ref.set({
            ...fields,
            teachers,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdBy: req.user.uid,
            createdByEmail: req.user.email || null
        });

        return sendSuccess(res, { courseId: ref.id }, 'Course created.');
    } catch (e) {
        console.error('[CRM] Create course failed:', e);
        return sendError(res, 500, 'CREATE_COURSE_ERROR', 'Failed to create course.', e?.message || e);
    }
});

function getBaseUrl(req) {
    const fromEnv = String(process.env.PUBLIC_BASE_URL || '').trim();
    if (fromEnv) return fromEnv.replace(/\/+$/, '');
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').toString().split(',')[0].trim();
    return `${proto}://${req.get('host')}`;
}

/**
 * CRM: Create a new entrance test link for a student
 * Returns a single-use link (token not stored).
 */
router.post('/students/:studentId/entrance-tests', crmLimiter, authMiddleware, async (req, res) => {
    try {
        if (!db) {
            return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
        }

        const studentId = String(req.params.studentId || '').trim();
        if (!studentId) {
            return sendError(res, 400, 'VALIDATION_ERROR', 'Missing studentId.');
        }

        const studentSnap = await db.collection('crmStudents').doc(studentId).get();
        if (!studentSnap.exists) {
            return sendError(res, 404, 'STUDENT_NOT_FOUND', 'Student profile not found.');
        }

        // Generate token and avoid any weird collision (extremely unlikely, but safe)
        let token = null;
        let testId = null;
        let isUniqueToken = false;
        for (let i = 0; i < 5; i++) {
            const nextToken = crypto.randomBytes(32).toString('base64url');
            const nextTestId = hashTokenToTestId(nextToken);
            const existing = await db.collection('entranceTests').doc(nextTestId).get();
            if (!existing.exists) {
                token = nextToken;
                testId = nextTestId;
                isUniqueToken = true;
                break;
            }
        }

        if (!isUniqueToken || !token || !testId) {
            return sendError(res, 500, 'TOKEN_ERROR', 'Failed to generate a unique token.');
        }

        await db.collection('entranceTests').doc(testId).set({
            studentId,
            version: TEST_VERSION,
            status: 'created',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdBy: req.user.uid,
            createdByEmail: req.user.email || null,
            startedAt: null,
            submittedAt: null
        }, { merge: false });

        const baseUrl = getBaseUrl(req);
        const testLink = `${baseUrl}/entrance-test.html?token=${encodeURIComponent(token)}`;
        const resultLink = `${baseUrl}/crm-entrance-test-result.html?testId=${encodeURIComponent(testId)}`;

        return sendSuccess(res, { testId, testLink, resultLink }, 'Entrance test link created.');
    } catch (e) {
        console.error('[CRM] Create entrance test failed:', e);
        return sendError(res, 500, 'CREATE_TEST_ERROR', 'Failed to create entrance test link.', e?.message || e);
    }
});

/**
 * CRM: List entrance tests for a student (token is NOT retrievable)
 */
router.get('/students/:studentId/entrance-tests', crmLimiter, authMiddleware, async (req, res) => {
    try {
        if (!db) {
            return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
        }

        const studentId = String(req.params.studentId || '').trim();
        if (!studentId) {
            return sendError(res, 400, 'VALIDATION_ERROR', 'Missing studentId.');
        }

        const snaps = await db.collection('entranceTests').where('studentId', '==', studentId).get();
        const tests = snaps.docs.map(d => {
            const data = d.data() || {};
            return {
                testId: d.id,
                version: data.version || null,
                status: data.status || null,
                createdAt: data.createdAt || null,
                startedAt: data.startedAt || null,
                submittedAt: data.submittedAt || null
            };
        });

        // Sort newest first (without requiring Firestore index)
        tests.sort((a, b) => {
            const aMs = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
            const bMs = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
            return bMs - aMs;
        });

        const baseUrl = getBaseUrl(req);
        const testsWithLinks = tests.map(t => ({
            ...t,
            resultLink: `${baseUrl}/crm-entrance-test-result.html?testId=${encodeURIComponent(t.testId)}`
        }));

        return sendSuccess(res, { tests: testsWithLinks });
    } catch (e) {
        console.error('[CRM] List entrance tests failed:', e);
        return sendError(res, 500, 'LIST_TESTS_ERROR', 'Failed to list entrance tests.', e?.message || e);
    }
});

/**
 * CRM: Get entrance test details + scoring (admin-only)
 */
router.get('/entrance-tests/:testId', crmLimiter, authMiddleware, async (req, res) => {
    try {
        if (!db) {
            return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
        }

        const testId = String(req.params.testId || '').trim();
        if (!testId || testId.length < 20) {
            return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid testId.');
        }

        const testSnap = await db.collection('entranceTests').doc(testId).get();
        if (!testSnap.exists) {
            return sendError(res, 404, 'TEST_NOT_FOUND', 'Entrance test not found.');
        }

        const test = testSnap.data() || {};
        const studentId = String(test.studentId || '').trim();
        const studentSnap = studentId ? await db.collection('crmStudents').doc(studentId).get() : null;
        const student = studentSnap && studentSnap.exists ? (studentSnap.data() || {}) : null;
        const session = buildPublicSession(testId);

        return sendSuccess(res, {
            testId,
            test: {
                ...test,
                // never return token; it's not stored anyway
            },
            student: student ? { id: studentId, ...student } : null,
            session
        });
    } catch (e) {
        console.error('[CRM] Get entrance test failed:', e);
        return sendError(res, 500, 'GET_TEST_ERROR', 'Failed to fetch entrance test details.', e?.message || e);
    }
});

/**
 * CRM: Get short-lived signed URL for a speaking audio file (admin-only)
 */
router.get('/entrance-tests/:testId/speaking/:questionId/audio-url', crmLimiter, authMiddleware, async (req, res) => {
    try {
        if (!db) {
            return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
        }
        const defaultBucket = await getStorageBucket();

        const testId = String(req.params.testId || '').trim();
        const questionId = String(req.params.questionId || '').trim();

        if (!testId || !questionId) {
            return sendError(res, 400, 'VALIDATION_ERROR', 'Missing testId or questionId.');
        }

        const testSnap = await db.collection('entranceTests').doc(testId).get();
        if (!testSnap.exists) {
            return sendError(res, 404, 'TEST_NOT_FOUND', 'Entrance test not found.');
        }

        const test = testSnap.data() || {};
        const speaking = test.speaking && typeof test.speaking === 'object' ? test.speaking : {};
        const entry = speaking[questionId] || null;
        const storagePath = entry?.audio?.storagePath || null;

        if (!storagePath) {
            return sendError(res, 404, 'AUDIO_NOT_FOUND', 'Speaking audio not found for this question.');
        }

        const bucketName = String(entry?.audio?.bucketName || '').trim();
        const targetBucket = bucketName ? admin.storage().bucket(bucketName) : defaultBucket;
        if (!targetBucket) {
            return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Storage not initialized.');
        }

        const [url] = await targetBucket.file(storagePath).getSignedUrl({
            action: 'read',
            expires: Date.now() + 10 * 60 * 1000
        });

        return sendSuccess(res, { url });
    } catch (e) {
        console.error('[CRM] Audio URL failed:', e);
        return sendError(res, 500, 'AUDIO_URL_ERROR', 'Failed to generate audio URL.', e?.message || e);
    }
});

router.post('/sync-database', adminLimiter, authMiddleware, syncLockMiddleware, async (req, res) => {
    const { type } = req.body;

    if (!['watch', 'notes'].includes(type)) {
        return sendError(res, 400, 'INVALID_TYPE', 'Sync type must be "watch" or "notes".');
    }

    if (!db) {
        return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
    }

    isSyncing = true;
    try {
        // Lazy load ExcelJS only when needed
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();

        if (type === 'watch') {
            const filePath = path.join(process.cwd(), 'public', 'database', 'watch', 'Videos.xlsx');
            await workbook.xlsx.readFile(filePath);
            const worksheet = workbook.getWorksheet(1);
            const batch = db.batch();
            let count = 0;

            worksheet.eachRow((row, rowNumber) => {
                if (rowNumber === 1) return;
                const videoId = row.getCell(1).value;
                const title = row.getCell(2).value;
                const level = row.getCell(3).value;
                const url = row.getCell(5).value;

                if (videoId && url) {
                    const videoRef = db.collection('watchVideos').doc(String(videoId));
                    batch.set(videoRef, {
                        id: String(videoId),
                        title: title || 'Untitled Video',
                        level: level || 'Beginner',
                        url: url,
                        updatedAt: new Date(),
                        syncedFromExcel: true
                    }, { merge: true });
                    count++;
                }
            });
            await batch.commit();
            return sendSuccess(res, { count }, `Synced ${count} videos.`);

        } else if (type === 'notes') {
            const filePath = path.join(process.cwd(), 'public', 'database', 'Take Notes', 'RL', 'RL.xlsx');
            await workbook.xlsx.readFile(filePath);
            const worksheet = workbook.getWorksheet(1);
            const batch = db.batch();
            let count = 0;

            worksheet.eachRow((row, rowNumber) => {
                if (rowNumber === 1) return;
                const id = row.getCell(1).value;
                const transcript = row.getCell(2).value;
                const videoUrl = row.getCell(3).value;

                if (id) {
                    const entryRef = db.collection('takeNotesEntries').doc(String(id));
                    batch.set(entryRef, {
                        id: String(id),
                        transcript: transcript || '',
                        videoUrl: videoUrl || '',
                        updatedAt: new Date(),
                        syncedFromExcel: true
                    }, { merge: true });
                    count++;
                }
            });
            await batch.commit();
            return sendSuccess(res, { count }, `Synced ${count} notes.`);
        }
    } catch (error) {
        console.error('[Admin-Sync] Full Error:', error);
        return sendError(res, 500, 'SYNC_ERROR', 'Failed to sync database.', error.message);
    } finally {
        isSyncing = false;
    }
});

/**
 * CRM: Create a new Classroom
 */
router.post('/classrooms', crmLimiter, authMiddleware, async (req, res) => {
    try {
        if (!db) return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
        const { name, courseId, status } = req.body || {};
        if (!name) return sendError(res, 400, 'VALIDATION_ERROR', 'Classroom name is required.');

        const ref = db.collection('crmClassrooms').doc();
        await ref.set({
            name,
            courseId: courseId || null,
            status: status || 'draft',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdBy: req.user.uid
        });

        return sendSuccess(res, { classroomId: ref.id }, 'Classroom created.');
    } catch (e) {
        return sendError(res, 500, 'CREATE_CLASSROOM_ERROR', 'Failed to create classroom.', e.message);
    }
});

/**
 * CRM: Add a Module to a Classroom
 */
router.post('/classrooms/:classId/modules', crmLimiter, authMiddleware, async (req, res) => {
    try {
        if (!db) return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
        const { classId } = req.params;
        const { title, orderIndex } = req.body || {};
        if (!title) return sendError(res, 400, 'VALIDATION_ERROR', 'Module title is required.');

        const ref = db.collection('crmClassrooms').doc(classId).collection('modules').doc();
        await ref.set({
            title,
            orderIndex: orderIndex || Date.now(),
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return sendSuccess(res, { moduleId: ref.id }, 'Module created.');
    } catch (e) {
        return sendError(res, 500, 'CREATE_MODULE_ERROR', 'Failed to create module.', e.message);
    }
});

/**
 * CRM: Add Classwork to a Classroom
 */
router.post('/classrooms/:classId/classwork', crmLimiter, authMiddleware, async (req, res) => {
    try {
        if (!db) return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
        const { classId } = req.params;
        const work = req.body || {};
        if (!work.title) return sendError(res, 400, 'VALIDATION_ERROR', 'Classwork title is required.');

        const ref = db.collection('crmClassrooms').doc(classId).collection('classwork').doc();
        await ref.set({
            ...work,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return sendSuccess(res, { classworkId: ref.id }, 'Classwork created.');
    } catch (e) {
        return sendError(res, 500, 'CREATE_CLASSWORK_ERROR', 'Failed to create classwork.', e.message);
    }
});

/**
 * CRM: Fetch Submissions for Review Board
 */
router.get('/classrooms/:classId/submissions', crmLimiter, authMiddleware, async (req, res) => {
    try {
        if (!db) return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
        const { classId } = req.params;

        // Fetch all submissions for this classroom from a top-level collection for easier management
        const snap = await db.collection('crmSubmissions')
            .where('classId', '==', classId)
            .get();

        const submissions = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return sendSuccess(res, { submissions });
    } catch (e) {
        return sendError(res, 500, 'FETCH_SUBMISSIONS_ERROR', 'Failed to fetch submissions.', e.message);
    }
});

/**
 * CRM: Grade a Submission
 */
router.post('/submissions/:submissionId/grade', crmLimiter, authMiddleware, async (req, res) => {
    try {
        if (!db) return sendError(res, 500, 'SERVER_CONFIG_ERROR', 'Firebase Admin not initialized.');
        const { submissionId } = req.params;
        const { grade, feedback } = req.body || {};

        await db.collection('crmSubmissions').doc(submissionId).update({
            grade,
            feedback,
            gradedAt: admin.firestore.FieldValue.serverTimestamp(),
            gradedBy: req.user.uid,
            status: 'graded'
        });

        return sendSuccess(res, null, 'Submission graded.');
    } catch (e) {
        return sendError(res, 500, 'GRADE_ERROR', 'Failed to grade submission.', e.message);
    }
});

module.exports = router;
