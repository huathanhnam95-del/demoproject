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
const { FieldValue } = require('firebase-admin/firestore');

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

// POST /api/admin/students: Create a new Student Profile
app.post(['/admin/students', '/api/admin/students'], authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const input = req.body || {};
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
            createdAt: FieldValue.serverTimestamp(),
            createdBy: req.user.uid,
            createdByEmail: req.user.email || null
        });

        sendSuccess(res, { studentId: ref.id }, 'Student profile created.');
    } catch (e) {
        sendError(res, 500, 'CREATE_STUDENT_ERROR', 'Failed to create student profile.', e.message);
    }
});

// GET /api/admin/students: List student profiles
app.get(['/admin/students', '/api/admin/students'], authMiddleware, adminMiddleware, async (req, res) => {
    try {
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

        sendSuccess(res, { students, count: students.length });
    } catch (e) {
        sendError(res, 500, 'LIST_STUDENTS_ERROR', 'Failed to list student profiles.', e.message);
    }
});

// GET /api/admin/students/:studentId: Get a student profile
app.get(['/admin/students/:studentId', '/api/admin/students/:studentId'], authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const studentId = String(req.params.studentId || '').trim();
        if (!studentId || studentId === 'claim-profile') {
            // "claim-profile" is handled by the non-admin endpoint, but just in case
            return sendError(res, 400, 'VALIDATION_ERROR', 'Missing or invalid studentId.');
        }

        const snap = await db.collection('crmStudents').doc(studentId).get();
        if (!snap.exists) {
            return sendError(res, 404, 'STUDENT_NOT_FOUND', 'Student profile not found.');
        }

        const data = snap.data() || {};
        sendSuccess(res, {
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
        sendError(res, 500, 'GET_STUDENT_ERROR', 'Failed to fetch student profile.', e.message);
    }
});

// --- Admin Course Management Endpoints ---

// POST /api/admin/courses: Create Course
app.post(['/admin/courses', '/api/admin/courses'], authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const input = req.body || {};
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
            createdAt: FieldValue.serverTimestamp(),
            createdBy: req.user.uid,
            createdByEmail: req.user.email || null
        });

        sendSuccess(res, { courseId: ref.id }, 'Course created.');
    } catch (e) {
        sendError(res, 500, 'CREATE_COURSE_ERROR', 'Failed to create course.', e.message);
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

// --- Classroom Management Endpoints (Admin) ---

// POST /api/admin/classrooms: Create a new Classroom
app.post(['/admin/classrooms', '/api/admin/classrooms'], authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { name, courseId, status } = req.body || {};
        if (!name) return sendError(res, 400, 'VALIDATION_ERROR', 'Classroom name is required.');

        const ref = db.collection('crmClassrooms').doc();
        await ref.set({
            name,
            courseId: courseId || null,
            status: status || 'draft',
            createdAt: FieldValue.serverTimestamp(),
            createdBy: req.user.uid
        });

        sendSuccess(res, { classroomId: ref.id }, 'Classroom created.');
    } catch (e) {
        sendError(res, 500, 'CREATE_CLASSROOM_ERROR', 'Failed to create classroom.', e.message);
    }
});

// POST /api/admin/classrooms/:classId/modules: Add a Module to a Classroom
app.post(['/admin/classrooms/:classId/modules', '/api/admin/classrooms/:classId/modules'], authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { classId } = req.params;
        const { title, orderIndex } = req.body || {};
        if (!title) return sendError(res, 400, 'VALIDATION_ERROR', 'Module title is required.');

        const ref = db.collection('crmClassrooms').doc(classId).collection('modules').doc();
        await ref.set({
            title,
            orderIndex: orderIndex || Date.now(),
            createdAt: FieldValue.serverTimestamp()
        });

        sendSuccess(res, { moduleId: ref.id }, 'Module created.');
    } catch (e) {
        sendError(res, 500, 'CREATE_MODULE_ERROR', 'Failed to create module.', e.message);
    }
});

// POST /api/admin/classrooms/:classId/classwork: Add Classwork to a Classroom
app.post(['/admin/classrooms/:classId/classwork', '/api/admin/classrooms/:classId/classwork'], authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { classId } = req.params;
        const work = req.body || {};
        if (!work.title) return sendError(res, 400, 'VALIDATION_ERROR', 'Classwork title is required.');

        const ref = db.collection('crmClassrooms').doc(classId).collection('classwork').doc();
        await ref.set({
            ...work,
            createdAt: FieldValue.serverTimestamp()
        });

        sendSuccess(res, { classworkId: ref.id }, 'Classwork created.');
    } catch (e) {
        sendError(res, 500, 'CREATE_CLASSWORK_ERROR', 'Failed to create classwork.', e.message);
    }
});

// GET /api/admin/classrooms/:classId/submissions: Fetch Submissions for Review Board
app.get(['/admin/classrooms/:classId/submissions', '/api/admin/classrooms/:classId/submissions'], authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { classId } = req.params;

        const snap = await db.collection('crmSubmissions')
            .where('classId', '==', classId)
            .get();

        const submissions = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        sendSuccess(res, { submissions });
    } catch (e) {
        sendError(res, 500, 'FETCH_SUBMISSIONS_ERROR', 'Failed to fetch submissions.', e.message);
    }
});

// POST /api/admin/submissions/:submissionId/grade: Grade a Submission
app.post(['/admin/submissions/:submissionId/grade', '/api/admin/submissions/:submissionId/grade'], authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { submissionId } = req.params;
        const { grade, feedback } = req.body || {};

        await db.collection('crmSubmissions').doc(submissionId).update({
            grade,
            feedback,
            gradedAt: FieldValue.serverTimestamp(),
            gradedBy: req.user.uid,
            status: 'graded'
        });

        sendSuccess(res, null, 'Submission graded.');
    } catch (e) {
        sendError(res, 500, 'GRADE_ERROR', 'Failed to grade submission.', e.message);
    }
});

module.exports = app;
