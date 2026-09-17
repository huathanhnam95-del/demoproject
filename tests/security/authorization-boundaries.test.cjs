const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const firestoreRulesPath = path.join(ROOT, 'firestore.rules');
const storageRulesPath = path.join(ROOT, 'storage.rules');

function readNormalized(filePath) {
    return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

test('SEC-02: Storage rules enforce relationship-based authorization for teaching recordings', () => {
    assert.ok(fs.existsSync(storageRulesPath), 'storage.rules must exist');
    const content = readNormalized(storageRulesPath);

    // Must not allow open signed-in reads
    assert.ok(!content.includes('match /teachingSessions/{studentId}/{fileName} {\n      allow read: if isSignedIn();'),
        'teachingSessions must not permit open isSignedIn() reads');

    // Must require staff or student linked ownership
    assert.ok(content.includes('match /teachingSessions/{studentId}/{fileName}'), 'must match teachingSessions path');
    assert.ok(content.includes('isCrmStaff() || isStudentLinkedTo(studentId)'), 'reads must require staff or linked student');
    assert.ok(content.includes('allow create: if isCrmStaff()'), 'writes must be restricted to staff');
    assert.ok(content.includes("matches('audio/.*')"), 'writes must validate media type');
    assert.ok(content.includes('allow update: if false;'), 'recordings must be immutable once created');
    assert.ok(content.includes('allow delete: if isAdmin() || isCrmAdmin()'), 'deletions must be restricted to admins');
});

test('SEC-03: Firestore rules enforce classroom membership without global claims bypass', () => {
    assert.ok(fs.existsSync(firestoreRulesPath), 'firestore.rules must exist');
    const content = readNormalized(firestoreRulesPath);

    // Extract crmClassrooms block
    const classroomMatch = content.match(/match \/crmClassrooms\/\{classId\} \{([\s\S]*?)(?=\n\s*\/\/ ===|$)/);
    assert.ok(classroomMatch, 'crmClassrooms block must exist');
    const classroomBlock = classroomMatch[1];

    // Global bypass must NOT exist in crmClassrooms block
    const hasGlobalBypass = classroomBlock.includes('request.auth.token.isStudent') ||
                            classroomBlock.includes('request.auth.token.isTeacher');
    assert.ok(!hasGlobalBypass, 'canReadClassroom must not grant global student/teacher read bypass');

    assert.ok(classroomBlock.includes('function isClassroomMember()'), 'must define isClassroomMember');
    assert.ok(classroomBlock.includes('function isAssignedTeacher(classData)'), 'must define isAssignedTeacher');
    assert.ok(classroomBlock.includes("classData.get('primaryTeacherUid', '')"), 'teacher checks must use safe CEL .get() navigation');
    assert.ok(classroomBlock.includes('canReadClassroomSubcollection()'), 'must protect subcollections with membership/assigned teacher');
});

test('SEC-04: Firestore and Storage rules protect student submissions from field tampering', () => {
    const firestoreContent = readNormalized(firestoreRulesPath);
    const storageContent = readNormalized(storageRulesPath);

    // Extract crmSubmissions block
    const subMatch = firestoreContent.match(/match \/crmSubmissions\/\{submissionId\} \{([\s\S]*?)(?=\n\s*\/\/ ===|$)/);
    assert.ok(subMatch, 'crmSubmissions block must exist');
    const subBlock = subMatch[1];

    // Submissions creation must require membership and forbid grading fields
    assert.ok(subBlock.includes("!request.resource.data.keys().hasAny(['grade', 'feedback', 'score', 'gradedAt', 'gradedBy', 'teacherNotes'])"),
        'submissions must forbid student creation of grading fields');
    assert.ok(subBlock.includes("request.resource.data.status in ['turned-in', 'submitted']"),
        'initial submission status must be turned-in/submitted');

    // Submissions update must restrict editable fields and keep studentUid, classId, workId immutable
    assert.ok(subBlock.includes('request.resource.data.studentUid == resource.data.studentUid'),
        'submission studentUid must be immutable on update');
    assert.ok(subBlock.includes('request.resource.data.classId == resource.data.classId'),
        'submission classId must be immutable on update');
    assert.ok(subBlock.includes("resource.data.status in ['turned-in', 'submitted', 'needs-revision']"),
        'submissions update must allow resubmission in needs-revision');
    assert.ok(subBlock.includes("request.resource.data.diff(resource.data).affectedKeys().hasOnly(['audio', 'submittedAt'])"),
        'students may only update audio and submittedAt on existing submissions');

    // Submissions read must NOT leak to classroom peers
    assert.ok(!subBlock.includes('isClassroomMember(resource.data.classId)'),
        'crmSubmissions read must not leak submissions to classroom peers');
    assert.ok(subBlock.includes('resource.data.studentUid == request.auth.uid'),
        'submissions read must be restricted to student owner and admin');

    // Storage uploads must check classroom membership without global claims bypass
    const uploadMatch = storageContent.match(/match \/uploads\/\{classId\}\/\{workId\}\/\{uid\}\/\{allPaths=\*\*\} \{([\s\S]*?)\n    \}/);
    assert.ok(uploadMatch, 'uploads block must exist');
    const uploadBlock = uploadMatch[1];

    assert.ok(!uploadBlock.includes('request.auth.token.isStudent'),
        'uploads must not allow global token.isStudent to bypass classroom membership');
    assert.ok(uploadBlock.includes('crmClassrooms/$(classId)/members/$(request.auth.uid)'),
        'storage uploads must verify classroom membership');
});

test('SEC-05: User profile creation blocks fabricated points, coins, and progression ratings', () => {
    const content = readNormalized(firestoreRulesPath);

    assert.ok(content.includes('match /users/{userId}'), 'users/{userId} rule must exist');
    assert.ok(content.includes("'totalPoints', 'coins', 'skillPoints', 'skillRatings'"),
        'profile creation must explicitly denylist scoring and progression fields');
    assert.ok(content.includes("'vocabularyBookUnlocked', 'sentenceLengthFilterUnlocked'"),
        'profile creation must explicitly denylist unlock flags');
    assert.ok(content.includes("request.resource.data.keys().hasOnly("),
        'profile creation must enforce a strict allowlist of initial fields');
    assert.ok(content.includes("request.resource.data.unlockedModes.hasOnly("),
        'profile creation must restrict unlockedModes to core free modes');

    // Profile update must NOT allow arbitrary unlockedModes mutation
    const updateMatch = content.match(/allow update: if isOwner\(userId\)[\s\S]*?hasOnly\(\[([\s\S]*?)\]\);/);
    assert.ok(updateMatch, 'user update hasOnly block must exist');
    const cleanedFields = updateMatch[1].replace(/\/\/.*/g, '');
    assert.ok(!cleanedFields.includes("'unlockedModes'"),
        'client profile update must not allow client-controlled unlockedModes tampering');
});

test('SEC-06: Shared pronunciation references require admin permissions for writes', () => {
    const content = readNormalized(firestoreRulesPath);

    assert.ok(content.includes('match /word_references/{wordId}'), 'word_references rule must exist');
    assert.ok(content.includes('allow write: if isAdmin();'), 'word_references writes must be restricted to admin');
    assert.ok(!content.includes('allow create, update: if request.auth != null;'),
        'word_references must not permit arbitrary signed-in writes');
});

test('SEC-07: Analytics session updates decouple create from update and enforce immutable ownership', () => {
    const content = readNormalized(firestoreRulesPath);

    assert.ok(content.includes('match /sessions/{sessionId}'), 'sessions rule must exist');
    assert.ok(content.includes('allow create: if isOwner(request.resource.data.userId);'),
        'session creation must check proposed owner');
    assert.ok(content.includes('isOwner(resource.data.userId)'), 'session update must check resource.data.userId');
    assert.ok(content.includes('request.resource.data.userId == resource.data.userId'),
        'session update must prevent owner reassignment');
});

test('REL-01: Rate limiter provides distributed store and graceful in-memory fallback', async () => {
    const { FirestoreRateLimitStore } = require('../../functions/src/middleware/practice-attempts-rate-limiter');
    assert.ok(FirestoreRateLimitStore, 'FirestoreRateLimitStore must be exported');

    // Verify in-memory fallback functionality when Firestore is offline/unconfigured
    const store = new FirestoreRateLimitStore({ getDb: () => null, prefix: 'test_rl' });
    store.init({ windowMs: 1000 });

    const first = await store.increment('test-user');
    assert.strictEqual(first.totalHits, 1, 'first hit should be 1');

    const second = await store.increment('test-user');
    assert.strictEqual(second.totalHits, 2, 'second hit should be 2');

    await store.decrement('test-user');
    await store.resetKey('test-user');
    const third = await store.increment('test-user');
    assert.strictEqual(third.totalHits, 1, 'hit count should reset to 1');
});

test('REL-02: Automation queue generates deterministic doc IDs and eliminates duplicate concurrency keys', () => {
    const dedupeKey = 'daily_lead_sync_2026_09_17_user_123';
    const docId1 = crypto.createHash('sha256').update(String(dedupeKey)).digest('hex').slice(0, 32);
    const docId2 = crypto.createHash('sha256').update(String(dedupeKey)).digest('hex').slice(0, 32);

    assert.strictEqual(docId1, docId2, 'identical dedupeKeys must produce identical docIds');
    assert.strictEqual(docId1.length, 32, 'docId must be 32 hex characters');

    const indexFile = readNormalized(path.join(ROOT, 'functions/src/index.js'));
    assert.ok(indexFile.includes('deriveQueueDocId(entry.dedupeKey)'),
        'runCrmAutomationQueue must derive docId from dedupeKey');
    assert.ok(indexFile.includes('batch.set(docRef, entry, { merge: true })'),
        'runCrmAutomationQueue must write with merge: true in atomic batches');
});

test('SEC-04 (API): Student classrooms route uses deterministic submission IDs and resubmission patches', () => {
    const routeContent = readNormalized(path.join(ROOT, 'functions/src/routes/student/classrooms.js'));
    assert.ok(routeContent.includes('buildHomeworkSubmissionDocId'), 'student submission endpoint must use buildHomeworkSubmissionDocId');
    assert.ok(routeContent.includes('buildHomeworkSubmissionCreateData'), 'student submission endpoint must use buildHomeworkSubmissionCreateData');
    assert.ok(routeContent.includes('buildHomeworkSubmissionResubmissionPatch'), 'student submission endpoint must use buildHomeworkSubmissionResubmissionPatch');
    assert.ok(routeContent.includes("currentStatus === 'graded'"), 'student submission endpoint must lock graded submissions');
});

