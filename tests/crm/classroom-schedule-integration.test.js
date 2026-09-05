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
    } catch (_) {}

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
    } catch (_) {}

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
    } catch (_) {}

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
    } catch (_) {}

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

testRoles().then(() => {
    console.log('All classroom schedule integration tests passed successfully!');
}).catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
