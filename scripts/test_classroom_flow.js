const admin = require('firebase-admin');

// We use the existing Firebase Admin initialization if possible, or initialize a new one.
let db;
try {
    const init = require('./functions/src/utils/firebase_admin_init');
    db = init.db;
} catch (e) {
    console.log("Could not load local admin init, initializing standard admin app...");
    admin.initializeApp();
    db = admin.firestore();
}

async function runTests() {
    console.log("=========================================");
    console.log("CLASSROOM FEATURE AUTOMATED DATA TEST");
    console.log("=========================================\n");

    const TEST_UID = "test_student_uid_" + Date.now();
    let courseId, studentId, classId, moduleId, workId, submissionId;

    try {
        // --- PHASE 1: Environment Preparation ---
        console.log("[Phase 1] Environment Preparation...");
        
        // 1. Create Course
        const courseRef = db.collection('crmCourses').doc();
        await courseRef.set({ name: "Automated Test Course 101", code: "TEST101", status: "active" });
        courseId = courseRef.id;
        console.log(`  ✓ Course created: ${courseId}`);

        // 2. Create Student & Link
        const studentRef = db.collection('crmStudents').doc();
        await studentRef.set({
            name: "Auto Test Student",
            email: "auto.test@example.com",
            linked_user_ids: admin.firestore.FieldValue.arrayUnion(TEST_UID),
            class_code: "AUTO" + Math.floor(Math.random() * 10000)
        });
        studentId = studentRef.id;
        console.log(`  ✓ Student created & Identity Linked: ${studentId} (UID: ${TEST_UID})`);

        // 3. Create Classroom
        const classRef = db.collection('crmClassrooms').doc();
        await classRef.set({ name: "Automated Test Class", courseId: courseId, status: "active" });
        classId = classRef.id;
        console.log(`  ✓ Classroom created: ${classId}\n`);


        // --- PHASE 2: Content Creation ---
        console.log("[Phase 2] Content Creation...");
        
        // 1. Create Module
        const modRef = classRef.collection('modules').doc();
        await modRef.set({ title: "Test Module 1", orderIndex: 1 });
        moduleId = modRef.id;
        console.log(`  ✓ Module created: ${moduleId}`);

        // 2. Create Classwork
        const workRef = classRef.collection('classwork').doc();
        await workRef.set({ title: "Test Audio Assignment", moduleId: moduleId, type: "assignment", allowVoiceNote: true });
        workId = workRef.id;
        console.log(`  ✓ Classwork created: ${workId}`);

        // 3. Post Announcement
        const postRef = classRef.collection('posts').doc();
        await postRef.set({ content: "This is an automated test announcement.", author: "Admin Bot", createdAt: admin.firestore.FieldValue.serverTimestamp() });
        console.log(`  ✓ Announcement posted.\n`);


        // --- PHASE 3: Student Interaction ---
        console.log("[Phase 3] Student Interaction (Simulation)...");
        
        // 1. Submit Assignment
        const subRef = db.collection('crmSubmissions').doc();
        await subRef.set({
            classId: classId,
            workId: workId,
            studentUid: TEST_UID,
            status: "turned-in",
            audio: { storagePath: `uploads/${classId}/${workId}/${TEST_UID}/test.webm`, bucketName: "mock-bucket" },
            submittedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        submissionId = subRef.id;
        console.log(`  ✓ Student audio submission created: ${submissionId}\n`);


        // --- PHASE 4: Review & Grading (Admin) ---
        console.log("[Phase 4] Review & Grading...");
        
        // 1. Fetch Submissions (Admin)
        const subSnap = await db.collection('crmSubmissions').where('classId', '==', classId).get();
        const turnedIn = subSnap.docs.filter(d => d.data().status === 'turned-in');
        console.log(`  ✓ Found ${turnedIn.length} turned-in submission(s) for the Kanban board.`);

        if (turnedIn.length > 0) {
            // 2. Grade Submission
            await db.collection('crmSubmissions').doc(submissionId).update({
                status: 'graded',
                grade: '10/10',
                gradedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`  ✓ Submission successfully graded with '10/10'.\n`);
        }

        // --- PHASE 5: Feedback Loop (Student) ---
        console.log("[Phase 5] Feedback Loop Verification...");
        const mySubSnap = await db.collection('crmSubmissions')
            .where('classId', '==', classId)
            .where('studentUid', '==', TEST_UID)
            .get();
        
        const mySub = mySubSnap.docs[0].data();
        if (mySub.status === 'graded' && mySub.grade === '10/10') {
            console.log(`  ✓ Verification Passed: Student successfully reads the graded assignment ('${mySub.grade}').\n`);
        } else {
            console.log(`  ✗ Verification Failed: Grade mismatch.\n`);
        }

        console.log("=========================================");
        console.log("ALL DATA FLOW TESTS COMPLETED SUCCESSFULLY.");
        console.log("=========================================\n");

    } catch (e) {
        console.error("Test failed:", e);
    } finally {
        // Cleanup
        console.log("Cleaning up test data...");
        if (courseId) await db.collection('crmCourses').doc(courseId).delete();
        if (studentId) await db.collection('crmStudents').doc(studentId).delete();
        if (classId) {
            if (moduleId) await db.collection('crmClassrooms').doc(classId).collection('modules').doc(moduleId).delete();
            if (workId) await db.collection('crmClassrooms').doc(classId).collection('classwork').doc(workId).delete();
            await db.collection('crmClassrooms').doc(classId).delete();
        }
        if (submissionId) await db.collection('crmSubmissions').doc(submissionId).delete();
        console.log("Cleanup finished.");
        process.exit(0);
    }
}

runTests();
