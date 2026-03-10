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

    // Admin: Read CRM course catalog
    async function fetchCourses() {
        const db = getDb();
        if (!db) throw new Error("Firebase DB not initialized");

        const snapshot = await db.collection("crmCourses").get();
        const courses = [];
        snapshot.forEach(doc => courses.push({ id: doc.id, ...doc.data() }));
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
            // Upload to storage: uploads/{classId}/{workId}/{uid}/{filename}
            const filename = `submission_${Date.now()}.webm`;
            const path = `uploads/${classId}/${workId}/${uid}/${filename}`;
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

    async function fetchReviewBoard(classId) {
        const headers = await getHeaders();
        const res = await fetch(`/api/admin/classrooms/${classId}/review-board`, {
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

    return {
        fetchCourses,
        fetchClassrooms,
        createClassroom,
        updateClassroom,
        loadModules,
        createModule,
        loadClasswork,
        createClasswork,
        submitAssignment,
        fetchMySubmissions,
        fetchSubmissions,
        fetchReviewBoard,
        gradeSubmission
    };
})();
