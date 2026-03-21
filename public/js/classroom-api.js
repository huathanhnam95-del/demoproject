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

    // Admin: Read CRM course catalog from crmCourses via server API to avoid Firestore permission issues.
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
        const res = await fetch(`/api/admin/classrooms/${classId}/submissions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                workId,
                audio: audioData
            })
        });

        if (!res.ok) {
            const message = await res.text().catch(() => '');
            throw new Error(message || `HTTP Error: ${res.status}`);
        }

        return res.json();
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

    async function fetchReviewBoard(classId) {
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/classrooms/${classId}/review-board`, {
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

    async function fetchClassroomMatches(studentId, params = {}) {
        const headers = await getHeaders();
        const search = new URLSearchParams();
        if (params && Object.prototype.hasOwnProperty.call(params, 'courseId')) {
            const courseId = String(params.courseId || '').trim();
            if (courseId) search.set('courseId', courseId);
        }
        const suffix = search.toString() ? `?${search.toString()}` : '';
        const res = await fetch(`/api/admin/students/${encodeURIComponent(studentId)}/classroom-matches${suffix}`, {
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

    return {
        fetchCourses,
        fetchClassrooms,
        createClassroom,
        updateClassroom,
        loadModules,
        createModule,
        loadClasswork,
        createClasswork,
        fetchLiveSessions,
        createLiveSession,
        updateLiveSession,
        startLiveSession,
        endLiveSession,
        submitAssignment,
        fetchMySubmissions,
        fetchSubmissions,
        fetchReviewBoard,
        createEnrollment,
        createAttendanceSession,
        saveAttendanceRecords,
        fetchAttendanceSummary,
        fetchClassroomMatches,
        gradeSubmission,
        returnSubmissionForRevision
    };
})();
