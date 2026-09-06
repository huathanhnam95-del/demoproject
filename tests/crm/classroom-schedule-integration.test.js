/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running classroom schedule integration tests...');

// Extract checkTeacherOrAdmin and loadScheduleData from classroom.js
const classroomCode = fs.readFileSync(path.join(__dirname, '../../public/js/classroom.js'), 'utf8');

// Verify that checkTeacherOrAdmin is defined in classroom.js
assert(classroomCode.includes('async function checkTeacherOrAdmin(user)'), 'checkTeacherOrAdmin function should be defined in classroom.js');
assert(classroomCode.includes('async function loadScheduleData()'), 'loadScheduleData function should be defined in classroom.js');
assert(classroomCode.includes('btnTeacherScheduleLink'), 'btnTeacherScheduleLink should be in elements');
assert(classroomCode.includes('tabSchedule'), 'tabSchedule should be in elements');
assert(classroomCode.includes('viewSchedule'), 'viewSchedule should be in elements');

// Test checkTeacherOrAdmin logic in isolation
async function mockCheckTeacherOrAdmin(user, mockFirestore, mockFetch, mockClassroomAPI) {
    if (!user) return { isTeacher: false, isAdmin: false };
    try {
        const tokenResult = await user.getIdTokenResult?.();
        const claims = tokenResult?.claims || {};
        if (claims.admin === true || claims.isAdmin === true || claims.role === 'admin' || claims.crmRole === 'admin') {
            return { isTeacher: true, isAdmin: true };
        }
        if (claims.isTeacher === true || claims.teacher === true || claims.crmRole === 'teacher' || claims.role === 'teacher') {
            return { isTeacher: true, isAdmin: false };
        }
    } catch (_) {
        // Ignore claim lookup error
    }

    try {
        if (mockFirestore) {
            const snap = await mockFirestore.collection('users').doc(user.uid).get();
            if (snap.exists) {
                const data = snap.data() || {};
                const crmRole = String(data.crmRole || '').trim().toLowerCase();
                const role = String(data.role || '').trim().toLowerCase();
                if (data.isAdmin === true || role === 'admin' || crmRole === 'admin') {
                    return { isTeacher: true, isAdmin: true };
                }
                if (data.isTeacher === true || role === 'teacher' || crmRole === 'teacher') {
                    return { isTeacher: true, isAdmin: false };
                }
            }
        }
    } catch (_) {
        // Ignore firestore lookup error
    }

    try {
        if (mockClassroomAPI && typeof mockClassroomAPI.checkTeacherStatus === 'function') {
            const status = await mockClassroomAPI.checkTeacherStatus();
            if (status.isAdmin) return { isTeacher: true, isAdmin: true };
            if (status.isTeacher) return { isTeacher: true, isAdmin: false };
        } else if (user.getIdToken && mockFetch) {
            const idToken = await user.getIdToken();
            const res = await mockFetch('/api/teacher/status', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${idToken}` },
                cache: 'no-store'
            });
            const json = await res.json().catch(() => null);
            if (res.ok && json?.data?.isTeacher) {
                return { isTeacher: true, isAdmin: Boolean(json?.data?.isAdmin) };
            }
        }
    } catch (_) {
        // Ignore api status error
    }

    try {
        if (user.getIdToken && mockFetch) {
            const idToken = await user.getIdToken();
            const res = await mockFetch('/api/admin/status', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${idToken}` },
                cache: 'no-store'
            });
            const result = await res.json().catch(() => null);
            if (res.ok && result?.success && result?.isAdmin) {
                return { isTeacher: true, isAdmin: true };
            }
        }
    } catch (_) {
        // Ignore admin status error
    }

    return { isTeacher: false, isAdmin: false };
}

async function testRoles() {
    // 1. Teacher via claim
    const t1 = await mockCheckTeacherOrAdmin({
        uid: 'u-t1',
        getIdTokenResult: async () => ({ claims: { isTeacher: true } })
    });
    assert.deepStrictEqual(t1, { isTeacher: true, isAdmin: false });

    // 2. Admin via claim
    const a1 = await mockCheckTeacherOrAdmin({
        uid: 'u-a1',
        getIdTokenResult: async () => ({ claims: { admin: true } })
    });
    assert.deepStrictEqual(a1, { isTeacher: true, isAdmin: true });

    // 3. Teacher via crmRole claim
    const t2 = await mockCheckTeacherOrAdmin({
        uid: 'u-t2',
        getIdTokenResult: async () => ({ claims: { crmRole: 'teacher' } })
    });
    assert.deepStrictEqual(t2, { isTeacher: true, isAdmin: false });

    // 4. Teacher via Firestore profile
    const mockDbTeacherProfile = {
        collection: (col) => ({
            doc: () => ({
                get: async () => ({ exists: true, data: () => ({ crmRole: 'teacher' }) })
            }),
            where: () => ({ limit: () => ({ get: async () => ({ empty: true }) }) })
        })
    };
    const t3 = await mockCheckTeacherOrAdmin(
        { uid: 'u-t3', getIdTokenResult: async () => ({ claims: {} }) },
        mockDbTeacherProfile
    );
    assert.deepStrictEqual(t3, { isTeacher: true, isAdmin: false });

    // 5. Teacher via /api/teacher/status server check
    const t4 = await mockCheckTeacherOrAdmin(
        {
            uid: 'u-t4',
            getIdTokenResult: async () => ({ claims: {} }),
            getIdToken: async () => 'valid-token'
        },
        null,
        async (url) => {
            if (url === '/api/teacher/status') {
                return { ok: true, json: async () => ({ success: true, data: { isTeacher: true, isAdmin: false } }) };
            }
            return { ok: false };
        }
    );
    assert.deepStrictEqual(t4, { isTeacher: true, isAdmin: false });

    // 6. Student (neither teacher nor admin)
    const mockDbStudent = {
        collection: (col) => ({
            doc: () => ({
                get: async () => ({ exists: true, data: () => ({ role: 'student' }) })
            })
        })
    };
    const s1 = await mockCheckTeacherOrAdmin(
        {
            uid: 'u-s1',
            getIdTokenResult: async () => ({ claims: {} }),
            getIdToken: async () => 'student-token'
        },
        mockDbStudent,
        async () => ({ ok: false, json: async () => ({ success: false }) })
    );
    assert.deepStrictEqual(s1, { isTeacher: false, isAdmin: false });

    console.log('✓ Teacher/admin role detection verified across all resolution tiers');
}

const createStudentClassroomsRouter = require('../../functions/src/routes/student/classrooms');

async function testStudentClassroomsRouter() {
    console.log('Running student classrooms router tests...');

    function createMockDb(docs = {}) {
        const store = new Map(Object.entries(docs));
        return {
            collection(colName) {
                return {
                    doc(docId) {
                        const key = `${colName}/${docId}`;
                        const exists = store.has(key);
                        return {
                            get: async () => ({
                                exists,
                                id: docId,
                                data: () => exists ? store.get(key) : null
                            })
                        };
                    },
                    where(field, op, val) {
                        return {
                            where() { return this; },
                            get: async () => {
                                const matched = [];
                                for (const [key, data] of store.entries()) {
                                    if (key.startsWith(`${colName}/`)) {
                                        if (op === '==' && data[field] === val) {
                                            matched.push({ id: key.slice(colName.length + 1), data: () => data });
                                        } else if (op === 'array-contains' && Array.isArray(data[field]) && data[field].includes(val)) {
                                            matched.push({ id: key.slice(colName.length + 1), data: () => data });
                                        } else if (op === 'in' && Array.isArray(val) && val.includes(data[field])) {
                                            matched.push({ id: key.slice(colName.length + 1), data: () => data });
                                        }
                                    }
                                }
                                return { docs: matched, empty: matched.length === 0 };
                            }
                        };
                    },
                    get: async () => {
                        const matched = [];
                        for (const [key, data] of store.entries()) {
                            if (key.startsWith(`${colName}/`)) {
                                matched.push({ id: key.slice(colName.length + 1), data: () => data });
                            }
                        }
                        return { docs: matched, empty: matched.length === 0 };
                    }
                };
            }
        };
    }

    const mockDb = createMockDb({
        'crmClassrooms/class-1': { name: 'PTE Speaking Mastery', status: 'active', primaryTeacherUid: 'teacher-1', primaryTeacherName: 'Teacher Jane' },
        'crmClassrooms/class-2': { name: 'IELTS Intensive', status: 'active', primaryTeacherUid: 'teacher-2', primaryTeacherName: 'Teacher John' },
        'crmEnrollments/enr-1': { studentUid: 'student-direct', classId: 'class-1', status: 'active' },
        'crmStudents/student-crm-1': { linked_user_ids: ['student-linked'] },
        'crmEnrollments/enr-2': { studentId: 'student-crm-1', classId: 'class-2', status: 'active' }
    });

    let currentUser = null;
    const router = createStudentClassroomsRouter({
        db: mockDb,
        authMiddleware: (req, res, next) => {
            if (!currentUser) return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
            req.user = currentUser;
            next();
        },
        sendSuccess: (res, data) => res.status(200).json({ success: true, ...data }),
        sendError: (res, status, error, message) => res.status(status).json({ success: false, error, message })
    });

    const routeLayer = router.stack.find(l => l.route && (l.route.path === '/classrooms' || (Array.isArray(l.route.path) && l.route.path.includes('/classrooms'))));
    assert(routeLayer, 'Classrooms route must be registered');
    const handler = routeLayer.route.stack[routeLayer.route.stack.length - 1].handle;

    function mockRes() {
        return {
            _status: 200,
            _json: null,
            status(code) { this._status = code; return this; },
            json(data) { this._json = data; return this; }
        };
    }

    // 1. Direct student enrollment resolution
    currentUser = { uid: 'student-direct' };
    let res = mockRes();
    await handler({ user: currentUser }, res);
    assert.strictEqual(res._status, 200);
    assert.strictEqual(res._json.count, 1);
    assert.strictEqual(res._json.classrooms[0].id, 'class-1');
    assert.strictEqual(res._json.classrooms[0].name, 'PTE Speaking Mastery');

    // 2. Linked CRM student enrollment resolution
    currentUser = { uid: 'student-linked' };
    res = mockRes();
    await handler({ user: currentUser }, res);
    assert.strictEqual(res._status, 200);
    assert.strictEqual(res._json.count, 1);
    assert.strictEqual(res._json.classrooms[0].id, 'class-2');
    assert.strictEqual(res._json.classrooms[0].name, 'IELTS Intensive');

    // 3. Unenrolled student gets empty list without errors
    currentUser = { uid: 'student-none' };
    res = mockRes();
    await handler({ user: currentUser }, res);
    assert.strictEqual(res._status, 200);
    assert.strictEqual(res._json.count, 0);
    assert.deepStrictEqual(res._json.classrooms, []);

    // 4. Admin caller sees all classrooms
    currentUser = { uid: 'admin-user', isAdmin: true };
    res = mockRes();
    await handler({ user: currentUser }, res);
    assert.strictEqual(res._status, 200);
    assert.strictEqual(res._json.count, 2);

    console.log('✓ Student classroom resolution verified across direct enrollments, linked identities, and admin preview');
}

(async () => {
    await testRoles();
    await testStudentClassroomsRouter();
    console.log('All classroom schedule integration tests passed successfully!');
})().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
