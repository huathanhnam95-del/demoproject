# Classroom Feature Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Build a repo-fit classroom system with CRM-backed enrollment, admin classwork management, student submissions with version history, and secure Firebase Storage access.

**Architecture:** Use a shared classroom router factory under `functions/src/routes/classrooms.js`, mount it in both `functions/src/apiApp.js` and local `server.js`, and store classroom read models in Firestore under `crmClassrooms/*`. Keep all classroom mutations server-authoritative through `/api`, while the browser reads classroom state from Firestore and uploads files directly to Storage under path-scoped rules.

**Tech Stack:** Express 5, Firebase Auth, Firestore, Firebase Storage, plain HTML/CSS/JS in `public/`, Node `assert` tests in `tests/`, Playwright-based smoke scripts in `scripts/`, Firebase Hosting + Cloud Functions.

---

**Path convention:** Shared classroom backend logic lives in `functions/src/`; local-dev adapters live in `src/routes/`; CRM admin UI stays in `public/crm-admin.*`; student classroom UI gets a dedicated `public/classroom.*` page; reusable browser helpers go in `public/js/`; verification scripts go in `tests/` or `scripts/`.

### Task 1: Shared Classroom API Skeleton

**Files:**
- Create: `functions/src/classroom-service.js`
- Create: `functions/src/routes/classrooms.js`
- Create: `src/routes/classrooms.js`
- Modify: `functions/src/apiApp.js`
- Modify: `server.js`
- Test: `tests/classroom-router.test.js`

**Step 1: Write the failing route-mount test**

```js
const assert = require('assert');
const createClassroomRouter = require('../functions/src/routes/classrooms');
const ClassroomService = require('../functions/src/classroom-service');

const noop = (_req, _res, next) => next();
const router = createClassroomRouter({
  db: {},
  admin: {},
  service: ClassroomService,
  authMiddleware: noop,
  sendSuccess: () => {},
  sendError: () => {},
  getStorageBucket: async () => null
});

assert.equal(typeof ClassroomService, 'object');
assert.equal(typeof createClassroomRouter, 'function');
assert.equal(typeof router, 'function');
assert(router.stack.some((layer) => layer.route?.path === '/'));
assert(router.stack.some((layer) => layer.route?.path === '/claim-memberships'));
assert(router.stack.some((layer) => layer.route?.path === '/:classId/classwork/:workId/attempts/start'));
```

**Step 2: Run test to verify it fails**

Run: `node tests/classroom-router.test.js`

Expected: FAIL with `Cannot find module '../functions/src/routes/classrooms'` or missing route assertions.

**Step 3: Write minimal implementation**

- Create `functions/src/classroom-service.js` with exported pure helpers:
  - `buildClassroomDoc`
  - `buildInviteDoc`
  - `buildModuleDoc`
  - `buildClassworkDoc`
  - `startAttemptState`
  - `finalizeAttemptState`
  - `returnAttemptState`
  - `gradeAttemptState`
- Export a router factory from `functions/src/routes/classrooms.js`.
- Add placeholder handlers for:
  - `GET /`
  - `POST /claim-memberships`
  - `POST /:classId/classwork/:workId/attempts/start`
- Mount the router in:
  - `functions/src/apiApp.js` at `/classrooms` and `/api/classrooms`
  - `server.js` using `src/routes/classrooms.js`
- Keep handlers stubbed with `NOT_IMPLEMENTED` responses except the health/list endpoint.

**Step 4: Run test to verify it passes**

Run: `node tests/classroom-router.test.js`

Expected: PASS with a final log line like `classroom router skeleton tests passed`.

**Step 5: Commit**

```bash
git add tests/classroom-router.test.js functions/src/classroom-service.js functions/src/routes/classrooms.js src/routes/classrooms.js functions/src/apiApp.js server.js
git commit -m "feat: add classroom api skeleton"
```

### Task 2: Firestore and Storage Security Foundation

**Files:**
- Modify: `firestore.rules`
- Modify: `firebase.json`
- Create: `storage.rules`
- Test: `tests/classroom-rules-shape.test.js`

**Step 1: Write the failing rules-shape test**

```js
const assert = require('assert');
const fs = require('fs');

const firestoreRules = fs.readFileSync('firestore.rules', 'utf8');
const storageRules = fs.readFileSync('storage.rules', 'utf8');
const firebaseJson = JSON.parse(fs.readFileSync('firebase.json', 'utf8'));

assert(firestoreRules.includes('match /crmClassrooms/{classId}'));
assert(firestoreRules.includes('memberInvites'));
assert(firestoreRules.includes('submissionThreads/{studentUid}'));
assert(storageRules.includes('crmClassrooms/{classId}/classwork/{workId}/submissionThreads/{studentUid}/attempts/{attemptId}'));
assert.equal(firebaseJson.storage.rules, 'storage.rules');
```

**Step 2: Run test to verify it fails**

Run: `node tests/classroom-rules-shape.test.js`

Expected: FAIL because `storage.rules` is missing and the new classroom rule blocks do not exist yet.

**Step 3: Write minimal implementation**

- Add Firestore helper functions for:
  - platform admin lookup via `users/{uid}.isAdmin`
  - active classroom membership lookup via `crmClassrooms/{classId}/members/{uid}`
- Add Firestore match blocks for:
  - `crmClassrooms/{classId}`
  - `memberInvites`
  - `members`
  - `modules`
  - `classwork`
  - `submissionThreads`
  - nested `attempts`
  - nested `comments`
- Keep client writes disabled for classroom docs.
- Add `storage.rules` and register it in `firebase.json`.
- Storage rules must allow:
  - admin or staff writes to materials path
  - student-only writes to owned attempt path
  - uploads only when the matching draft attempt doc exists

**Step 4: Run test to verify it passes**

Run: `node tests/classroom-rules-shape.test.js`

Expected: PASS with a final log line like `classroom rules shape tests passed`.

**Step 5: Commit**

```bash
git add tests/classroom-rules-shape.test.js firestore.rules storage.rules firebase.json
git commit -m "feat: add classroom firestore and storage rules"
```

### Task 3: Admin Classroom and Invite Flow

**Files:**
- Modify: `functions/src/classroom-service.js`
- Modify: `functions/src/routes/classrooms.js`
- Test: `tests/classroom-admin-service.test.js`

**Step 1: Write the failing admin-service test**

```js
const assert = require('assert');
const service = require('../functions/src/classroom-service');

const classroom = service.buildClassroomDoc({
  name: 'B1 Evening',
  courseId: 'course-123',
  ownerUid: 'admin-1'
});

const invite = service.buildInviteDoc({
  role: 'student',
  crmStudentId: 'crm-42',
  email: 'Student@Example.com',
  createdByUid: 'admin-1'
});

const moduleDoc = service.buildModuleDoc({
  title: 'Week 1',
  orderIndex: 10,
  createdByUid: 'admin-1'
});

const classwork = service.buildClassworkDoc({
  type: 'assignment',
  title: 'Homework 1',
  moduleId: 'week-1',
  allowVoiceNote: true,
  createdByUid: 'admin-1'
});

assert.equal(classroom.status, 'draft');
assert.equal(invite.email, 'student@example.com');
assert.equal(invite.status, 'pending');
assert.equal(moduleDoc.publishState, 'draft');
assert.equal(classwork.attemptLimit, 4);
assert.equal(classwork.status, 'draft');
```

**Step 2: Run test to verify it fails**

Run: `node tests/classroom-admin-service.test.js`

Expected: FAIL because the service helpers do not exist yet.

**Step 3: Write minimal implementation**

- Implement the pure service helpers so they:
  - normalize invite emails to lowercase
  - stamp `createdAt` and `updatedAt`
  - default classroom `status` to `draft`
  - default module `publishState` to `draft`
  - force `attemptLimit` to `4`
  - reject invalid classwork types and missing titles with thrown errors
- Update route handlers so admin endpoints use the service helpers for:
  - create classroom docs under `crmClassrooms/{classId}`
  - create invite docs under `memberInvites`
  - create modules with `orderIndex`
  - create classwork drafts with `attemptLimit: 4`
  - patch classwork metadata and attachment refs
- list classrooms for admins with stable response shapes

**Step 4: Run test to verify it passes**

Run: `node tests/classroom-admin-service.test.js`

Expected: PASS with a final log line like `classroom admin service tests passed`.

**Step 5: Commit**

```bash
git add tests/classroom-admin-service.test.js functions/src/classroom-service.js functions/src/routes/classrooms.js
git commit -m "feat: add classroom admin and invite routes"
```

### Task 4: Membership Claim and Submission Lifecycle

**Files:**
- Modify: `functions/src/classroom-service.js`
- Modify: `functions/src/routes/classrooms.js`
- Test: `tests/classroom-submissions.test.js`

**Step 1: Write the failing submission-lifecycle test**

```js
const assert = require('assert');
const service = require('../functions/src/classroom-service');

const firstAttempt = service.startAttemptState({
  currentThread: null,
  studentUid: 'student-1',
  crmStudentId: 'crm-42',
  attemptLimit: 4
});

assert.equal(firstAttempt.thread.attemptCount, 1);
assert.equal(firstAttempt.attempt.attemptNumber, 1);
assert.equal(firstAttempt.thread.status, 'draft');

const finalized = service.finalizeAttemptState({
  thread: firstAttempt.thread,
  attempt: firstAttempt.attempt,
  attachments: [{ storagePath: 'crmClassrooms/c1/classwork/w1/submissionThreads/student-1/attempts/a1/audio.webm' }]
});

assert.equal(finalized.thread.status, 'submitted');
assert.equal(finalized.attempt.status, 'submitted');

const returned = service.returnAttemptState({
  thread: finalized.thread,
  attempt: finalized.attempt,
  teacherComment: 'Please retry question 2'
});

assert.equal(returned.thread.status, 'returned');
assert.equal(returned.attempt.status, 'returned');

assert.throws(() => {
  service.startAttemptState({
    currentThread: { attemptCount: 4, status: 'returned' },
    studentUid: 'student-1',
    crmStudentId: 'crm-42',
    attemptLimit: 4
  });
}, /attempt limit/i);
```

**Step 2: Run test to verify it fails**

Run: `node tests/classroom-submissions.test.js`

Expected: FAIL because the claim, start, finalize, return, and grade handlers are not implemented yet.

**Step 3: Write minimal implementation**

- Extend `functions/src/classroom-service.js` so it can:
  - claim an invite into a `members/{uid}` payload
  - start a draft attempt
  - finalize an attempt into `submitted`
  - return an attempt for revision
  - grade the current attempt and thread
  - reject a fifth attempt
- Add student-authenticated handler:
  - `POST /claim-memberships`
- Add student submission handlers:
  - `POST /:classId/classwork/:workId/attempts/start`
  - `POST /:classId/classwork/:workId/attempts/:attemptId/finalize`
  - `POST /:classId/classwork/:workId/submissions/:studentUid/comments`
- Add staff review handlers:
  - `POST /admin/classrooms/:classId/classwork/:workId/submissions/:studentUid/return`
  - `POST /admin/classrooms/:classId/classwork/:workId/submissions/:studentUid/grade`
  - `GET /admin/classrooms/:classId/files/read-url`
- Business rules:
  - create thread doc on first attempt
  - draft attempt must exist before upload
  - only owner can finalize own attempt
  - max total attempts = 4
  - return sets thread status back to `returned`
  - grade sets both latest attempt and thread to `graded`

**Step 4: Run test to verify it passes**

Run: `node tests/classroom-submissions.test.js`

Expected: PASS with a final log line like `classroom submission lifecycle tests passed`.

**Step 5: Commit**

```bash
git add tests/classroom-submissions.test.js functions/src/classroom-service.js functions/src/routes/classrooms.js
git commit -m "feat: add classroom submission lifecycle routes"
```

### Task 5: Admin CRM Classroom UI

**Files:**
- Modify: `public/crm-admin.html`
- Modify: `public/crm-admin.css`
- Modify: `public/crm-admin.js`
- Create: `public/js/classroom-api.js`
- Test: `scripts/smoke-classroom-admin.js`

**Step 1: Write the failing admin smoke script**

```js
// Use Playwright.
// Verify an authenticated admin can:
// 1. open CRM Admin
// 2. navigate to the classroom area
// 3. create a classroom
// 4. add a module
// 5. create an assignment draft
// 6. see the review board container render
```

**Step 2: Run smoke to verify it fails**

Run: `node scripts/smoke-classroom-admin.js --base-url http://localhost:8443`

Expected: FAIL because the classroom admin UI is not rendered yet.

**Step 3: Write minimal implementation**

- Add a new classroom management subpanel to `public/crm-admin.html`.
- Extend `public/crm-admin.js` route handling and state to support:
  - classroom list
  - classroom editor
  - module list
  - classwork composer
  - review board view
- Keep API calls in `public/js/classroom-api.js`.
- Reuse existing CRM modal and tab patterns where practical instead of creating a second admin shell.

**Step 4: Run smoke to verify it passes**

Run: `node scripts/smoke-classroom-admin.js --base-url http://localhost:8443`

Expected: PASS with a final log line like `classroom admin smoke passed`.

**Step 5: Commit**

```bash
git add scripts/smoke-classroom-admin.js public/crm-admin.html public/crm-admin.css public/crm-admin.js public/js/classroom-api.js
git commit -m "feat: add crm classroom admin ui"
```

### Task 6: Student Classroom Page and Voice Submission UX

**Files:**
- Create: `public/classroom.html`
- Create: `public/classroom.css`
- Create: `public/classroom.js`
- Modify: `public/auth-ui.js`
- Modify: `public/js/classroom-api.js`
- Test: `scripts/smoke-classroom-student.js`

**Step 1: Write the failing student smoke script**

```js
// Use Playwright.
// Verify an authenticated student can:
// 1. open classroom.html
// 2. claim memberships
// 3. switch between Stream and Modules
// 4. open an assignment modal
// 5. see Start attempt and Record voice note controls
// 6. see To Do / Done state render
```

**Step 2: Run smoke to verify it fails**

Run: `node scripts/smoke-classroom-student.js --base-url http://localhost:8443`

Expected: FAIL because the student classroom page does not exist yet.

**Step 3: Write minimal implementation**

- Build a dedicated student page in `public/classroom.*`.
- On load:
  - wait for Firebase auth
  - call `POST /api/classrooms/claim-memberships`
  - subscribe to classroom/classwork Firestore reads
- Implement:
  - Stream view
  - Modules view
  - To Do / Done view
  - assignment modal
  - `MediaRecorder` capture for audio attachments
- Keep uploaded files as storage path metadata only; do not store public URLs.
- Add a navigation entry or redirect path in `public/auth-ui.js` so logged-in students can reach the page.

**Step 4: Run smoke to verify it passes**

Run: `node scripts/smoke-classroom-student.js --base-url http://localhost:8443`

Expected: PASS with a final log line like `classroom student smoke passed`.

**Step 5: Commit**

```bash
git add scripts/smoke-classroom-student.js public/classroom.html public/classroom.css public/classroom.js public/auth-ui.js public/js/classroom-api.js
git commit -m "feat: add student classroom experience"
```

### Task 7: Full Verification Bundle

**Files:**
- Create: `scripts/smoke-classroom-api.js`

**Step 1: Write the failing verification script**

```js
// Run the classroom-specific checks in sequence:
// - router tests
// - rules shape tests
// - admin route tests
// - submission lifecycle tests
// - admin smoke
// - student smoke
```

**Step 2: Run verification to verify it fails**

Run: `node scripts/smoke-classroom-api.js --base-url http://localhost:8443`

Expected: FAIL until every classroom-specific test and smoke script passes.

**Step 3: Write minimal implementation**

- Implement `scripts/smoke-classroom-api.js` as a thin orchestrator that exits non-zero on first failure.
- Print one line per completed check so failures are easy to localize.

**Step 4: Run full verification**

Run these commands:

1. `node tests/classroom-router.test.js`
2. `node tests/classroom-rules-shape.test.js`
3. `node tests/classroom-admin-service.test.js`
4. `node tests/classroom-submissions.test.js`
5. `node scripts/smoke-classroom-admin.js --base-url http://localhost:8443`
6. `node scripts/smoke-classroom-student.js --base-url http://localhost:8443`
7. `node scripts/smoke-classroom-api.js --base-url http://localhost:8443`
8. `npm run lint`

Expected:

- every command exits `0`
- smoke scripts print their respective `passed` lines
- `npm run lint` exits without errors

**Step 5: Commit**

```bash
git add scripts/smoke-classroom-api.js
git commit -m "test: add classroom verification bundle"
```
