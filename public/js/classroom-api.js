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

        let audioData = null;
        if (audioBlob) {
            if (!(audioBlob instanceof Blob)) {
                console.error("submitAssignment: audioBlob is not a Blob", audioBlob);
                throw new Error("Invalid audio data");
            }
            // Double check IDs are strings
            const cId = String(classId);
            const wId = String(workId);

            // Upload to storage: uploads/{classId}/{workId}/{uid}/{filename}
            const filename = `submission_${Date.now()}.webm`;
            const path = `uploads/${cId}/${wId}/${uid}/${filename}`;
            const storageRef = firebase.storage().ref(path);
            await storageRef.put(audioBlob);
            audioData = {
                storagePath: path,
                bucketName: firebase.app().options.storageBucket,
                filename
            };
        }

        const headers = await getHeaders();
        // Since we don't have a dedicated student submission endpoint yet, 
        // and we want to keep it simple, we'll write directly to a top-level collection 
        // but we'll use a server endpoint if possible for security.
        // For Phase 3, let's add a submission endpoint to a new route if needed, 
        // OR reuse admin.js if we allow students (unlikely safe).
        // Let's assume we have a /api/classrooms/:id/submit route.
        // FOR NOW: We'll use Firestore directly for the submission write if rules allow, 
        // otherwise I need to add a student route.

        const db = getDb();
        const submissionRef = db.collection('crmSubmissions').doc();
        await submissionRef.set({
            classId,
            workId,
            studentUid: uid,
            studentEmail: auth.currentUser.email,
            audio: audioData,
            status: 'turned-in',
            submittedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        return { success: true, submissionId: submissionRef.id };
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
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/classrooms/${classId}/sessions/seed`, {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        return parseJsonResponse(res);
    }

    async function addClassroomSession(classId, data) {
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/classrooms/${classId}/sessions/add`, {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        return res.json();
    }

    async function teacherAddClassroomSession(classId, data) {
        const headers = await getHeaders();
        const res = await fetch(`/api/teacher/classrooms/${classId}/sessions/add`, {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        return parseJsonResponse(res);
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
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/classrooms/${classId}/sessions/add-batch`, {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        return parseJsonResponse(res);
    }

    async function teacherAddClassroomSessionMulti(classId, data) {
        const headers = await getHeaders();
        const res = await fetch(`/api/teacher/classrooms/${classId}/sessions/add-multi`, {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        return parseJsonResponse(res);
    }

    async function replaceClassroomSession(classId, data) {
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/classrooms/${classId}/sessions/replace`, {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        return parseJsonResponse(res);
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
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/sessions/${sessionId}/reschedule`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(data)
        });
        return parseJsonResponse(res);
    }

    async function teacherRescheduleScheduledSession(sessionId, data) {
        const headers = await getHeaders();
        const res = await fetch(`/api/teacher/sessions/${sessionId}/reschedule`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(data)
        });
        return parseJsonResponse(res);
    }

    async function cancelScheduledSession(sessionId) {
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/sessions/${sessionId}/cancel`, {
            method: 'POST',
            headers
        });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        return res.json();
    }

    async function teacherCancelScheduledSession(sessionId) {
        const headers = await getHeaders();
        const res = await fetch(`/api/teacher/sessions/${sessionId}/cancel`, {
            method: 'POST',
            headers
        });
        return parseJsonResponse(res);
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
        const headers = await getHeaders();
        const res = await fetch('/api/teacher/scheduler/activate-recurrences', {
            method: 'POST',
            headers,
            body: JSON.stringify(data)
        });
        return parseJsonResponse(res);
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
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/classrooms/${classId}/schedule/regenerate`, {
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

    return {
        fetchCourses,
        fetchClassrooms,
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
        cancelScheduledSession,
        teacherCancelScheduledSession,
        teacherSetScheduledSessionOutcome,
        teacherActivateRecurrences,
        previewClassroomScheduleRegeneration,
        regenerateClassroomSchedule,
        openScheduledAttendanceSession,
        gradeSubmission,
        returnSubmissionForRevision,
        fetchTeachers
    };
})();
