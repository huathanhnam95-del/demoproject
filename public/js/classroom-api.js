/**
 * ClassroomAPI
 * 
 * Provides an abstraction layer for interacting with the Classroom backend.
 * Uses Firebase Firestore compat SDK for reads, and Custom API endpoints for writes.
 */
window.ClassroomAPI = (function () {
    function getDb() {
        return typeof firebase !== 'undefined' ? firebase.firestore() : null;
    }

    function getAuth() {
        return typeof firebase !== 'undefined' ? firebase.auth() : null;
    }

    async function getHeaders() {
        const auth = getAuth();
        if (!auth || !auth.currentUser) return { 'Content-Type': 'application/json' };
        const token = await auth.currentUser.getIdToken();
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };
    }

    async function parseJsonResponse(res) {
        const json = await res.json().catch(() => null);
        if (res.ok) {
            return json;
        }

        const error = new Error(
            json?.message
            || json?.error
            || `HTTP Error: ${res.status}`
        );
        error.status = res.status;
        error.code = json?.error || null;
        error.details = json?.details || null;
        throw error;
    }

    function createSchedulingOperationId(prefix = 'operation') {
        const safePrefix = String(prefix || 'operation')
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'operation';
        const randomPart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
        return `sched_${safePrefix}_${Date.now().toString(36)}_${randomPart}`;
    }

    async function sendSchedulingMutation(url, { method = 'POST', data = {}, prefix = 'operation' } = {}) {
        const body = data && typeof data === 'object' ? { ...data } : {};
        const suppliedOperationId = String(body.operationId || '').trim();
        body.operationId = suppliedOperationId || createSchedulingOperationId(prefix);
        const headers = {
            ...(await getHeaders()),
            'Idempotency-Key': body.operationId
        };
        const res = await fetch(url, {
            method,
            headers,
            body: JSON.stringify(body)
        });
        return parseJsonResponse(res);
    }

    // Admin: Read local classroom docs
    async function fetchClassrooms() {
        const headers = await getHeaders();
        const res = await fetch('/api/admin/classrooms', {
            method: 'GET',
            headers
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        const json = await res.json();
        return json.classrooms || [];
    }

    // Student: Read classrooms student is enrolled in
    async function fetchStudentClassrooms() {
        const headers = await getHeaders();
        const res = await fetch('/api/student/classrooms', {
            method: 'GET',
            headers
        });
        if (!res.ok) {
            const fallbackRes = await fetch('/api/classrooms', {
                method: 'GET',
                headers
            });
            if (!fallbackRes.ok) throw new Error(`HTTP Error: ${fallbackRes.status}`);
            const json = await fallbackRes.json();
            return json.classrooms || [];
        }
        const json = await res.json();
        return json.classrooms || [];
    }

    // Admin: Read CRM course catalog (crmCourses via server API to avoid Firestore permission issues)
    async function fetchCourses() {
        const headers = await getHeaders();
        const res = await fetch('/api/admin/courses', {
            method: 'GET',
            headers
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        const json = await res.json();
        const courses = json.courses || [];
        courses.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        return courses;
    }

    // Admin: Create classroom via API
    async function createClassroom(data) {
        const headers = await getHeaders();
        const res = await fetch('/api/admin/classrooms', {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        return res.json();
    }

    async function updateClassroom(classId, data) {
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/classrooms/${classId}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        return res.json();
    }

    // Admin: Read modules
    async function loadModules(classId) {
        const db = getDb();
        if (!db) throw new Error("Firebase DB not initialized");
        const snapshot = await db.collection("crmClassrooms").doc(classId).collection("modules").orderBy("orderIndex").get();
        const modules = [];
        snapshot.forEach(doc => modules.push({ id: doc.id, ...doc.data() }));
        return modules;
    }

    // Admin: Create module via API
    async function createModule(classId, data) {
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/classrooms/${classId}/modules`, {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        return res.json();
    }

    // Admin/Student: Read classwork
    async function loadClasswork(classId) {
        const db = getDb();
        if (!db) throw new Error("Firebase DB not initialized");
        const snapshot = await db.collection("crmClassrooms").doc(classId).collection("classwork").get();
        const classworks = [];
        snapshot.forEach(doc => classworks.push({ id: doc.id, ...doc.data() }));
        return classworks;
    }

    // Admin: Create classwork via API
    async function createClasswork(classId, data) {
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/classrooms/${classId}/classwork`, {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        return res.json();
    }

    async function createSubmission(classId, data) {
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/classrooms/${classId}/submissions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        return res.json();
    }

    // Student: Submit work
    async function submitAssignment(classId, workId, audioBlob) {
        const auth = getAuth();
        if (!auth || !auth.currentUser) throw new Error("Not logged in");
        const uid = auth.currentUser.uid;
        const headers = await getHeaders();

        let audioData = null;
        let uploadIntentId = null;
        if (audioBlob) {
            if (!(audioBlob instanceof Blob)) {
                console.error("submitAssignment: audioBlob is not a Blob", audioBlob);
                throw new Error("Invalid audio data");
            }
            const prepareRes = await fetch(`/api/student/classrooms/${encodeURIComponent(classId)}/classwork/${encodeURIComponent(workId)}/submissions/upload-intent`, {
                method: 'POST',
                headers,
                body: '{}'
            });
            const prepared = await prepareRes.json().catch(() => ({}));
            if (!prepareRes.ok || !prepared.success || !prepared.uploadIntentId || !prepared.storagePath) {
                throw new Error(prepared.message || `Unable to prepare audio upload (HTTP ${prepareRes.status})`);
            }

            uploadIntentId = String(prepared.uploadIntentId);
            const filename = String(prepared.filename || uploadIntentId);
            const path = String(prepared.storagePath);
            const expectedPrefix = `uploads/${String(classId)}/${String(workId)}/${uid}/`;
            if (!path.startsWith(expectedPrefix) || filename !== uploadIntentId || path !== `${expectedPrefix}${uploadIntentId}`) {
                throw new Error('Server returned an invalid audio upload slot.');
            }
            const storageRef = firebase.storage().ref(path);
            await storageRef.put(audioBlob);
            audioData = {
                storagePath: path,
                bucketName: firebase.app().options.storageBucket,
                filename
            };
        }

        // Server-authoritative submission endpoint enforcing deterministic ID, classroom checks, and status guards
        const submit = () => fetch(`/api/student/classrooms/${encodeURIComponent(classId)}/classwork/${encodeURIComponent(workId)}/submissions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ audio: audioData, uploadIntentId })
        });
        let res;
        try {
            res = await submit();
        } catch (firstNetworkError) {
            // Retry the same intent once. If the first response was lost after a
            // successful write, the backend returns the deterministic submission.
            res = await submit().catch(() => { throw firstNetworkError; });
        }
        if (res.ok) {
            const json = await res.json();
            if (json.success) {
                return { success: true, submissionId: json.submissionId };
            }
            throw new Error(json.message || 'Submission failed.');
        }
        const json = await res.json().catch(() => ({}));
        throw new Error(json.message || `Submission error (HTTP ${res.status})`);
    }

    // Student: Fetch my submissions
    async function fetchMySubmissions(classId) {
        const db = getDb();
        if (!db) throw new Error("Firebase DB not initialized");
        const auth = getAuth();
        if (!auth || !auth.currentUser) throw new Error("Not logged in");

        const snapshot = await db.collection("crmSubmissions")
            .where("classId", "==", classId)
            .where("studentUid", "==", auth.currentUser.uid)
            .get();

        const submissions = [];
        snapshot.forEach(doc => submissions.push({ id: doc.id, ...doc.data() }));
        return submissions;
    }

    // Admin: Fetch submissions
    async function fetchSubmissions(classId) {
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/classrooms/${classId}/submissions`, {
            method: 'GET',
            headers
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        const json = await res.json();
        return json.submissions || [];
    }

    async function fetchClassroomMatches(studentId, params = {}) {
        const headers = await getHeaders();
        const search = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== null && value !== undefined && String(value).trim() !== '') {
                search.set(key, String(value).trim());
            }
        });
        const suffix = search.toString() ? `?${search.toString()}` : '';
        const res = await fetch(`/api/admin/students/${studentId}/classroom-matches${suffix}`, {
            method: 'GET',
            headers
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        return res.json();
    }

    async function fetchLiveSessions(classId) {
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/classrooms/${classId}/live-sessions`, {
            method: 'GET',
            headers
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        const json = await res.json();
        return json.sessions || [];
    }

    async function fetchReviewBoard(classId) {
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/classrooms/${classId}/review-board`, {
            method: 'GET',
            headers
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        return res.json();
    }

    async function createEnrollment(data) {
        const headers = await getHeaders();
        const res = await fetch('/api/admin/enrollments', {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        return res.json();
    }

    async function createAttendanceSession(data) {
        const headers = await getHeaders();
        const res = await fetch('/api/admin/attendance/sessions', {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        return res.json();
    }

    async function createLiveSession(classId, data) {
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/classrooms/${classId}/live-sessions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        return res.json();
    }

    async function updateLiveSession(classId, sessionId, data) {
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/classrooms/${classId}/live-sessions/${sessionId}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        return res.json();
    }

    async function startLiveSession(classId, sessionId) {
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/classrooms/${classId}/live-sessions/${sessionId}/start`, {
            method: 'POST',
            headers
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        return res.json();
    }

    async function endLiveSession(classId, sessionId) {
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/classrooms/${classId}/live-sessions/${sessionId}/end`, {
            method: 'POST',
            headers
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        return res.json();
    }

    async function saveAttendanceRecords(data) {
        const headers = await getHeaders();
        const res = await fetch('/api/admin/attendance/records/bulk', {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        return res.json();
    }

    async function fetchAttendanceSummary(params = {}) {
        const headers = await getHeaders();
        const search = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== null && value !== undefined && String(value).trim() !== '') {
                search.set(key, String(value).trim());
            }
        });
        const suffix = search.toString() ? `?${search.toString()}` : '';
        const res = await fetch(`/api/admin/attendance/summary${suffix}`, {
            method: 'GET',
            headers
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        return res.json();
    }

    async function fetchSchedulerWorkspace(params = {}) {
        const headers = await getHeaders();
        const search = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== null && value !== undefined && String(value).trim() !== '') {
                search.set(key, String(value).trim());
            }
        });
        const suffix = search.toString() ? `?${search.toString()}` : '';
        const res = await fetch(`/api/admin/scheduler/workspace${suffix}`, {
            method: 'GET',
            headers
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        return res.json();
    }

    async function updateClassroomScheduleConfig(classId, data) {
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/classrooms/${classId}/schedule-config`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(data)
        });
        return parseJsonResponse(res);
    }

    async function seedClassroomSessions(classId, data) {
        return sendSchedulingMutation(`/api/admin/classrooms/${classId}/sessions/seed`, {
            data,
            prefix: 'admin-seed'
        });
    }

    async function addClassroomSession(classId, data) {
        return sendSchedulingMutation(`/api/admin/classrooms/${classId}/sessions/add`, {
            data,
            prefix: 'admin-add'
        });
    }

    async function teacherAddClassroomSession(classId, data) {
        return sendSchedulingMutation(`/api/teacher/classrooms/${classId}/sessions/add`, {
            data,
            prefix: 'teacher-add'
        });
    }

    async function previewClassroomSessionAdd(classId, data) {
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/classrooms/${classId}/sessions/add-preview`, {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        return parseJsonResponse(res);
    }

    async function addClassroomSessionBatch(classId, data) {
        return sendSchedulingMutation(`/api/admin/classrooms/${classId}/sessions/add-batch`, {
            data,
            prefix: 'admin-add-batch'
        });
    }

    async function teacherAddClassroomSessionMulti(classId, data) {
        return sendSchedulingMutation(`/api/teacher/classrooms/${classId}/sessions/add-multi`, {
            data,
            prefix: 'teacher-add-multi'
        });
    }

    async function replaceClassroomSession(classId, data) {
        return sendSchedulingMutation(`/api/admin/classrooms/${classId}/sessions/replace`, {
            data,
            prefix: 'admin-replace'
        });
    }

    async function previewClassroomSessionReplace(classId, data) {
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/classrooms/${classId}/sessions/replace-preview`, {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        return parseJsonResponse(res);
    }

    async function rescheduleScheduledSession(sessionId, data) {
        return sendSchedulingMutation(`/api/admin/sessions/${sessionId}/reschedule`, {
            method: 'PATCH',
            data,
            prefix: 'admin-reschedule'
        });
    }

    async function teacherRescheduleScheduledSession(sessionId, data) {
        return sendSchedulingMutation(`/api/teacher/sessions/${sessionId}/reschedule`, {
            method: 'PATCH',
            data,
            prefix: 'teacher-reschedule'
        });
    }

    async function teacherRescheduleSessionSeries(sessionId, data = {}) {
        return sendSchedulingMutation(`/api/teacher/sessions/${sessionId}/reschedule-series`, {
            data,
            prefix: 'teacher-reschedule-series'
        });
    }

    async function teacherBulkRescheduleSessions(data = {}) {
        return sendSchedulingMutation('/api/teacher/scheduler/sessions/bulk-reschedule', {
            data,
            prefix: data?.undoOf ? 'teacher-undo' : 'teacher-bulk-reschedule'
        });
    }

    async function cancelScheduledSession(sessionId, data = {}) {
        return sendSchedulingMutation(`/api/admin/sessions/${sessionId}/cancel`, {
            data,
            prefix: 'admin-cancel'
        });
    }

    async function teacherCancelScheduledSession(sessionId, data = {}) {
        return sendSchedulingMutation(`/api/teacher/sessions/${sessionId}/cancel`, {
            data,
            prefix: 'teacher-cancel'
        });
    }

    async function teacherSetScheduledSessionOutcome(sessionId, data = {}) {
        const headers = await getHeaders();
        const res = await fetch(`/api/teacher/sessions/${sessionId}/outcome`, {
            method: 'POST',
            headers,
            body: JSON.stringify(data || {})
        });
        return parseJsonResponse(res);
    }

    async function teacherActivateRecurrences(data = {}) {
        return sendSchedulingMutation('/api/teacher/scheduler/activate-recurrences', {
            data,
            prefix: 'teacher-activate-recurrences'
        });
    }

    async function previewClassroomScheduleRegeneration(classId, data) {
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/classrooms/${classId}/schedule/regenerate-preview`, {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        if (!res.ok) {
            const json = await res.json().catch(() => null);
            throw new Error(json?.message || `HTTP Error: ${res.status}`);
        }
        return res.json();
    }

    async function regenerateClassroomSchedule(classId, data) {
        return sendSchedulingMutation(`/api/admin/classrooms/${classId}/schedule/regenerate`, {
            data,
            prefix: 'admin-regenerate'
        });
    }

    async function openScheduledAttendanceSession(scheduledSessionId) {
        const headers = await getHeaders();
        const res = await fetch('/api/admin/attendance/sessions/open-from-scheduled', {
            method: 'POST',
            headers,
            body: JSON.stringify({ scheduledSessionId })
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        return res.json();
    }

    // Admin: Grade submission
    async function gradeSubmission(submissionId, data) {
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/submissions/${submissionId}/grade`, {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        return res.json();
    }

    async function fetchTeacherSchedulerWorkspace(params = {}) {
        const headers = await getHeaders();
        const search = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== null && value !== undefined && String(value).trim() !== '') {
                search.set(key, String(value).trim());
            }
        });
        const suffix = search.toString() ? `?${search.toString()}` : '';
        const res = await fetch(`/api/teacher/scheduler/workspace${suffix}`, {
            method: 'GET',
            headers
        });
        return parseJsonResponse(res);
    }

    async function returnSubmissionForRevision(submissionId, data) {
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/submissions/${submissionId}/return-for-revision`, {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        return res.json();
    }

    // Admin: Fetch teacher/admin users via server API (bypasses Firestore rules)
    async function fetchTeachers() {
        const headers = await getHeaders();
        const res = await fetch('/api/admin/teachers', {
            method: 'GET',
            headers
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        const json = await res.json();
        return json.teachers || [];
    }

    // Check teacher status via authenticated server endpoint
    async function checkTeacherStatus() {
        const headers = await getHeaders();
        const res = await fetch('/api/teacher/status', {
            method: 'GET',
            headers,
            cache: 'no-store'
        });
        if (!res.ok) return { isTeacher: false, isAdmin: false, uid: null };
        const json = await res.json().catch(() => null);
        return {
            isTeacher: Boolean(json?.data?.isTeacher),
            isAdmin: Boolean(json?.data?.isAdmin),
            uid: json?.data?.uid || null
        };
    }

    return {
        fetchCourses,
        fetchClassrooms,
        fetchStudentClassrooms,
        createClassroom,
        updateClassroom,
        loadModules,
        createModule,
        loadClasswork,
        createClasswork,
        createSubmission,
        submitAssignment,
        fetchMySubmissions,
        fetchSubmissions,
        fetchClassroomMatches,
        fetchLiveSessions,
        fetchReviewBoard,
        createEnrollment,
        createAttendanceSession,
        createLiveSession,
        updateLiveSession,
        startLiveSession,
        endLiveSession,
        saveAttendanceRecords,
        fetchAttendanceSummary,
        createSchedulingOperationId,
        fetchSchedulerWorkspace,
        fetchTeacherSchedulerWorkspace,
        updateClassroomScheduleConfig,
        seedClassroomSessions,
        addClassroomSession,
        teacherAddClassroomSession,
        previewClassroomSessionAdd,
        addClassroomSessionBatch,
        teacherAddClassroomSessionMulti,
        replaceClassroomSession,
        previewClassroomSessionReplace,
        rescheduleScheduledSession,
        teacherRescheduleScheduledSession,
        teacherRescheduleSessionSeries,
        teacherBulkRescheduleSessions,
        cancelScheduledSession,
        teacherCancelScheduledSession,
        teacherSetScheduledSessionOutcome,
        teacherActivateRecurrences,
        previewClassroomScheduleRegeneration,
        regenerateClassroomSchedule,
        openScheduledAttendanceSession,
        gradeSubmission,
        returnSubmissionForRevision,
        fetchTeachers,
        checkTeacherStatus
    };
})();
