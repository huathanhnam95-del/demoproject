# CRM Standardization And Expansion Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Stabilize the current CRM admin page, close the functional gaps found in review, and expand it into a standardized CRM covering leads, lifecycle management, enrollment, attendance, finance, communications, reporting, and governance.

**Architecture:** Replace the current split-brain CRM backend with one shared admin route and service layer mounted by both local `server.js` and Cloud Functions `api`. Keep Firestore as the source of truth, but normalize collections and domain contracts so the browser, local server, and deployed API all use the same entity model. Split the browser CRM into domain modules under `public/js/crm/`, deliver integrity fixes first, then add standardized CRM domains in phases.

**Tech Stack:** Express 5, Firebase Auth, Firestore, Firebase Storage, Cloud Functions `api`, plain HTML/CSS/JS in `public/`, Node `assert` tests in `tests/crm/`, Playwright smoke scripts in `scripts/crm/`, ESLint.

---

**Path convention:** Shared CRM services and contracts live in `functions/src/crm/`; shared admin route factories live in `functions/src/routes/admin/`; local-dev mounting remains in `src/routes/admin.js`; browser CRM modules live in `public/js/crm/`; migrations and smoke scripts live in `scripts/crm/`; CRM-focused tests live in `tests/crm/`.

**Domain model target:**
- `crmLeads/{leadId}` for pre-enrollment pipeline records
- `crmStudents/{studentId}` for enrolled or converted learners
- `crmCourses/{courseId}` for course catalog
- `crmClassrooms/{classId}` plus `members/{uid}` for operational classroom authorization
- `crmEnrollments/{enrollmentId}` for reporting-friendly student-course/class mappings
- `crmTasks/{taskId}` and `crmActivities/{activityId}` for next actions and timeline
- `crmAttendanceSessions/{sessionId}` and `crmAttendanceRecords/{recordId}` for attendance
- `crmInvoices/{invoiceId}`, `crmPayments/{paymentId}`, `crmCommissions/{commissionId}` for finance
- `crmAutomationRules/{ruleId}`, `crmAutomationQueue/{queueId}` for reminders and templates
- `crmAuditLogs/{logId}` and `crmMergeJobs/{jobId}` for governance

### Task 1: Shared CRM Admin Router Foundation

**Files:**
- Create: `functions/src/crm/collections.js`
- Create: `functions/src/crm/http-contracts.js`
- Create: `functions/src/routes/admin/create-crm-router.js`
- Create: `functions/src/routes/admin/students.js`
- Create: `functions/src/routes/admin/courses.js`
- Create: `functions/src/routes/admin/identity.js`
- Modify: `functions/src/apiApp.js`
- Modify: `src/routes/admin.js`
- Modify: `server.js`
- Test: `tests/crm/admin-router-contract.test.js`

**Step 1: Write the failing route-contract test**

- Assert that the mounted admin router exposes:
  - `GET /status`
  - `GET /students`
  - `POST /students`
  - `PATCH /students/:studentId`
  - `GET /courses`
  - `POST /courses`
  - `PATCH /courses/:courseId`
  - `POST /students/:studentId/class-code`
  - `GET /users/lookup`
  - `POST /students/:studentId/force-link`
- Assert that route modules import collection names from `functions/src/crm/collections.js` instead of hard-coded collection strings.

**Step 2: Run test to verify it fails**

Run: `node tests/crm/admin-router-contract.test.js`

Expected: FAIL because the shared router factory and collection contract modules do not exist yet.

**Step 3: Write minimal implementation**

- Create `functions/src/crm/collections.js` with exported constants for every CRM collection and subcollection name.
- Create `functions/src/crm/http-contracts.js` with helper response-shape builders so local and deployed backends return identical JSON.
- Move student, course, and identity route wiring into `functions/src/routes/admin/*.js`.
- Create `functions/src/routes/admin/create-crm-router.js` that accepts `db`, `admin`, `authMiddleware`, `adminMiddleware`, `sendSuccess`, `sendError`, and mounts all CRM route modules.
- Update `functions/src/apiApp.js` to mount the shared router at `/admin` and `/api/admin`.
- Replace the current `src/routes/admin.js` body with a local adapter that calls the same shared router factory.
- Keep existing classroom and entrance-test endpoints working through the shared router surface.

**Step 4: Run test to verify it passes**

Run: `node tests/crm/admin-router-contract.test.js`

Expected: PASS with a final line like `crm admin router contract passed`.

**Step 5: Commit**

```bash
git add tests/crm/admin-router-contract.test.js functions/src/crm/collections.js functions/src/crm/http-contracts.js functions/src/routes/admin/create-crm-router.js functions/src/routes/admin/students.js functions/src/routes/admin/courses.js functions/src/routes/admin/identity.js functions/src/apiApp.js src/routes/admin.js server.js
git commit -m "refactor: unify crm admin router"
```

### Task 2: Collection Normalization And Data Migration

**Files:**
- Modify: `functions/src/routes/admin/courses.js`
- Modify: `public/js/classroom-api.js`
- Create: `scripts/crm/migrate-courses-to-crmCourses.js`
- Create: `tests/crm/collection-contracts.test.js`
- Modify: `public/js/crm/courses.js`

**Step 1: Write the failing collection-contract test**

- Assert that:
  - course writes use `crmCourses`
  - course reads use `crmCourses`
  - classroom linked-course dropdown reads `crmCourses`
  - no CRM browser module reads bare `courses`
- Add an assertion that the migration script can map `courses/*` docs into `crmCourses/*`.

**Step 2: Run test to verify it fails**

Run: `node tests/crm/collection-contracts.test.js`

Expected: FAIL because the browser still reads `courses` while the API writes `crmCourses`.

**Step 3: Write minimal implementation**

- Normalize all course reads and writes to `crmCourses`.
- Add a migration script that:
  - reads `courses`
  - upserts into `crmCourses`
  - preserves `createdAt`, `createdBy`, and teacher assignments where present
  - prints counts for migrated, skipped, and conflicted documents
- Update classroom dropdown and course catalog code to read `crmCourses`.
- Ensure any future collection name is sourced from the shared constant module, not literal strings.

**Step 4: Run test to verify it passes**

Run:

1. `node tests/crm/collection-contracts.test.js`
2. `node scripts/crm/migrate-courses-to-crmCourses.js --dry-run`

Expected:

- test exits `0`
- dry run prints a summary line like `dry-run complete: 12 migrate, 0 conflict`

**Step 5: Commit**

```bash
git add tests/crm/collection-contracts.test.js scripts/crm/migrate-courses-to-crmCourses.js functions/src/routes/admin/courses.js public/js/classroom-api.js public/js/crm/courses.js
git commit -m "fix: normalize crm course collection usage"
```

### Task 3: CRM Shell Integrity, Navigation Parity, And Browser Hygiene

**Files:**
- Modify: `public/crm-admin.html`
- Modify: `public/crm-admin.css`
- Create: `public/js/crm/index.js`
- Create: `public/js/crm/state.js`
- Create: `public/js/crm/dom.js`
- Create: `public/js/crm/utils.js`
- Create: `tests/crm/crm-shell-static.test.js`
- Modify: `package.json`

**Step 1: Write the failing CRM-shell test**

- Assert that every visible top-nav item and dropdown route either:
  - has a backing panel, or
  - is explicitly marked disabled / coming soon
- Assert that `public/crm-admin.html` loads:
  - `firebase-app-compat`
  - `firebase-auth-compat`
  - `firebase-firestore-compat`
  - `firebase-storage-compat`
- Assert that `public/crm-admin.js` or its replacement modules do not contain empty `catch {}` blocks.

**Step 2: Run test to verify it fails**

Run:

1. `node tests/crm/crm-shell-static.test.js`
2. `npm run lint:entrance-crm`

Expected:

- static test fails on missing `firebase-storage-compat` and nav/panel mismatch
- lint fails on empty `catch` blocks

**Step 3: Write minimal implementation**

- Add `firebase-storage-compat` to `public/crm-admin.html`.
- Move CRM bootstrapping from the monolithic `public/crm-admin.js` into `public/js/crm/index.js`, with shared helpers in `state.js`, `dom.js`, and `utils.js`.
- Keep existing page behavior, but change navigation so placeholder modules are either:
  - hidden until implemented, or
  - rendered as disabled with a visible “coming soon” state
- Remove empty catches; replace them with explicit `console.error` or toast-level failure handling.
- Add a dedicated `npm run lint:crm` script that targets all CRM browser modules and CRM route modules.

**Step 4: Run test to verify it passes**

Run:

1. `node tests/crm/crm-shell-static.test.js`
2. `npm run lint:crm`

Expected:

- both commands exit `0`
- lint prints no errors for CRM files

**Step 5: Commit**

```bash
git add tests/crm/crm-shell-static.test.js public/crm-admin.html public/crm-admin.css public/js/crm/index.js public/js/crm/state.js public/js/crm/dom.js public/js/crm/utils.js package.json
git commit -m "refactor: stabilize crm shell and browser dependencies"
```

### Task 4: Student Profile Persistence And Edit Flow

**Files:**
- Create: `functions/src/crm/student-service.js`
- Modify: `functions/src/routes/admin/students.js`
- Create: `public/js/crm/students.js`
- Modify: `public/crm-admin.html`
- Modify: `public/crm-admin.css`
- Test: `tests/crm/student-service.test.js`
- Test: `scripts/crm/smoke-student-profile.js`

**Step 1: Write the failing student-profile tests**

- Unit-test the service so it:
  - accepts both create and patch payloads
  - persists `learningProfile`
  - persists `entryLevel`
  - persists `testResultDueDate`
  - preserves existing values when patching partial payloads
  - rejects empty creates
- Write a smoke script that:
  - creates a student
  - reopens the student
  - edits learning-profile fields
  - saves
  - refreshes
  - verifies values still render

**Step 2: Run test to verify it fails**

Run:

1. `node tests/crm/student-service.test.js`
2. `node scripts/crm/smoke-student-profile.js --base-url http://localhost:8443`

Expected: FAIL because the CRM currently only stores the six Info-tab fields and blocks edits after initial save.

**Step 3: Write minimal implementation**

- Add `PATCH /api/admin/students/:studentId`.
- Extend the student document shape to include:
  - `lifecycleStage`
  - `ownerUid`
  - `learningProfile.overall`
  - `learningProfile.listening`
  - `learningProfile.reading`
  - `learningProfile.speaking`
  - `learningProfile.writing`
  - `learningProfile.entryLevel`
  - `learningProfile.testResultDueDate`
  - `notes`
  - `updatedAt`
  - `updatedBy`
- Update browser state so opening an existing student keeps Save enabled for edits.
- Split “Potential Students” and “Student Data” into filtered views instead of duplicating the same list:
  - potential = leads or students with pre-enrollment stages
  - student data = enrolled, paused, completed, alumni
- Preserve entrance-test and identity tab behavior during edits.

**Step 4: Run test to verify it passes**

Run:

1. `node tests/crm/student-service.test.js`
2. `node scripts/crm/smoke-student-profile.js --base-url http://localhost:8443`

Expected:

- unit test exits `0`
- smoke script prints `student profile smoke passed`

**Step 5: Commit**

```bash
git add tests/crm/student-service.test.js scripts/crm/smoke-student-profile.js functions/src/crm/student-service.js functions/src/routes/admin/students.js public/crm-admin.html public/crm-admin.css public/js/crm/students.js
git commit -m "feat: add persistent editable student profiles"
```

### Task 5: Course CRUD, Classroom CRUD, And Membership-Scoped Review Board

**Files:**
- Create: `functions/src/crm/course-service.js`
- Modify: `functions/src/routes/admin/courses.js`
- Modify: `functions/src/routes/admin/create-crm-router.js`
- Modify: `public/js/classroom-api.js`
- Create: `public/js/crm/classrooms.js`
- Modify: `public/js/crm/courses.js`
- Modify: `public/crm-admin.html`
- Test: `tests/crm/course-classroom-service.test.js`
- Test: `scripts/crm/smoke-classroom-admin.js`

**Step 1: Write the failing course/classroom tests**

- Assert that:
  - courses can be created, listed, and patched
  - classrooms can be created, listed, and patched
  - teacher assignments round-trip
  - classroom review board missing-state uses classroom membership, not all `crmStudents`
- Smoke an admin flow:
  - create course
  - create classroom linked to that course
  - add module
  - add classwork
  - view review board without unrelated students appearing

**Step 2: Run test to verify it fails**

Run:

1. `node tests/crm/course-classroom-service.test.js`
2. `node scripts/crm/smoke-classroom-admin.js --base-url http://localhost:8443`

Expected: FAIL because the current CRM is create-only for classrooms and calculates missing submissions against every linked student.

**Step 3: Write minimal implementation**

- Add `GET /api/admin/courses`, `PATCH /api/admin/courses/:courseId`, `GET /api/admin/classrooms`, and `PATCH /api/admin/classrooms/:classId`.
- Introduce `crmClassrooms/{classId}/members/{uid}` as the source for classroom review-board scope.
- Keep `crmEnrollments` as the reporting entity, but do not use it for auth.
- Update the browser CRM to:
  - reopen and edit courses/classrooms
  - render course names instead of raw course IDs
  - use signed URLs or storage compat for protected submission audio
- Ensure the review board only computes Missing for members of the specific classroom.

**Step 4: Run test to verify it passes**

Run:

1. `node tests/crm/course-classroom-service.test.js`
2. `node scripts/crm/smoke-classroom-admin.js --base-url http://localhost:8443`

Expected:

- both commands exit `0`
- smoke script prints `classroom admin smoke passed`

**Step 5: Commit**

```bash
git add tests/crm/course-classroom-service.test.js scripts/crm/smoke-classroom-admin.js functions/src/crm/course-service.js functions/src/routes/admin/courses.js public/js/classroom-api.js public/js/crm/classrooms.js public/js/crm/courses.js public/crm-admin.html
git commit -m "feat: add editable courses and membership-scoped classrooms"
```

### Task 6: Lead Pipeline, Enquiry Management, And Lifecycle Conversion

**Files:**
- Create: `functions/src/crm/lead-service.js`
- Create: `functions/src/routes/admin/leads.js`
- Create: `public/js/crm/leads.js`
- Modify: `public/crm-admin.html`
- Modify: `public/crm-admin.css`
- Test: `tests/crm/lead-service.test.js`
- Test: `scripts/crm/smoke-lead-pipeline.js`

**Step 1: Write the failing lead-pipeline tests**

- Assert lead fields:
  - `source`
  - `ownerUid`
  - `stage`
  - `probability`
  - `nextActionAt`
  - `lastContactAt`
  - `lossReason`
- Assert conversion flow:
  - a lead can be converted into a student
  - the student inherits contact info and acquisition source
  - the lead becomes `converted` and links to `studentId`
- Smoke a pipeline flow through:
  - New
  - Contacted
  - Test Scheduled
  - Test Completed
  - Counseling
  - Won / Lost

**Step 2: Run test to verify it fails**

Run:

1. `node tests/crm/lead-service.test.js`
2. `node scripts/crm/smoke-lead-pipeline.js --base-url http://localhost:8443`

Expected: FAIL because the current CRM has no real lead entity or pipeline stages.

**Step 3: Write minimal implementation**

- Add `crmLeads`.
- Add routes:
  - `GET /api/admin/leads`
  - `POST /api/admin/leads`
  - `PATCH /api/admin/leads/:leadId`
  - `POST /api/admin/leads/:leadId/convert`
- Add board/list UI under Enquiry and Potential Students.
- Standardize lifecycle stages:
  - `new`
  - `contacted`
  - `test_scheduled`
  - `test_completed`
  - `counseling`
  - `trial`
  - `won`
  - `lost`
- Use the converted student record for the Student Data panel.

**Step 4: Run test to verify it passes**

Run:

1. `node tests/crm/lead-service.test.js`
2. `node scripts/crm/smoke-lead-pipeline.js --base-url http://localhost:8443`

Expected:

- both commands exit `0`
- smoke prints `lead pipeline smoke passed`

**Step 5: Commit**

```bash
git add tests/crm/lead-service.test.js scripts/crm/smoke-lead-pipeline.js functions/src/crm/lead-service.js functions/src/routes/admin/leads.js public/js/crm/leads.js public/crm-admin.html public/crm-admin.css
git commit -m "feat: add crm lead pipeline and conversion flow"
```

### Task 7: Activity Timeline, Tasks, And Communication Log

**Files:**
- Create: `functions/src/crm/activity-service.js`
- Create: `functions/src/routes/admin/activities.js`
- Create: `public/js/crm/activities.js`
- Modify: `public/crm-admin.html`
- Modify: `public/crm-admin.css`
- Test: `tests/crm/activity-service.test.js`
- Test: `scripts/crm/smoke-activity-timeline.js`

**Step 1: Write the failing activity tests**

- Assert creation and rendering of:
  - note
  - call log
  - message log
  - task
  - reminder
- Assert tasks support:
  - `assignedToUid`
  - `dueAt`
  - `status`
  - `completedAt`
- Assert timeline sorting is newest-first and entity-scoped.

**Step 2: Run test to verify it fails**

Run:

1. `node tests/crm/activity-service.test.js`
2. `node scripts/crm/smoke-activity-timeline.js --base-url http://localhost:8443`

Expected: FAIL because the CRM currently has no activity or task domain.

**Step 3: Write minimal implementation**

- Add top-level `crmActivities` and `crmTasks` with indexed references to:
  - `leadId`
  - `studentId`
  - `classId`
  - `actorUid`
- Add routes:
  - `GET /api/admin/activities`
  - `POST /api/admin/activities`
  - `GET /api/admin/tasks`
  - `POST /api/admin/tasks`
  - `PATCH /api/admin/tasks/:taskId`
- Add browser timeline widgets on lead and student detail views.
- Add “next action” and overdue reminder badges to lead and student list rows.

**Step 4: Run test to verify it passes**

Run:

1. `node tests/crm/activity-service.test.js`
2. `node scripts/crm/smoke-activity-timeline.js --base-url http://localhost:8443`

Expected:

- unit test exits `0`
- smoke prints `activity timeline smoke passed`

**Step 5: Commit**

```bash
git add tests/crm/activity-service.test.js scripts/crm/smoke-activity-timeline.js functions/src/crm/activity-service.js functions/src/routes/admin/activities.js public/js/crm/activities.js public/crm-admin.html public/crm-admin.css
git commit -m "feat: add crm activities and task timeline"
```

### Task 8: Enrollment, Attendance, And At-Risk Intervention

**Files:**
- Create: `functions/src/crm/enrollment-service.js`
- Create: `functions/src/routes/admin/enrollments.js`
- Create: `functions/src/routes/admin/attendance.js`
- Create: `public/js/crm/enrollments.js`
- Create: `public/js/crm/attendance.js`
- Modify: `public/crm-admin.html`
- Test: `tests/crm/enrollment-attendance.test.js`
- Test: `scripts/crm/smoke-attendance.js`

**Step 1: Write the failing enrollment/attendance tests**

- Assert that:
  - student-course/classroom enrollments are created once and deduplicated
  - classroom `members/{uid}` and top-level `crmEnrollments` stay consistent
  - attendance sessions and attendance records can be created and patched
  - absence reasons and intervention flags persist
  - at-risk status is computed from attendance and score thresholds

**Step 2: Run test to verify it fails**

Run:

1. `node tests/crm/enrollment-attendance.test.js`
2. `node scripts/crm/smoke-attendance.js --base-url http://localhost:8443`

Expected: FAIL because enrollment and attendance are not modeled separately today.

**Step 3: Write minimal implementation**

- Add `crmEnrollments`, `crmAttendanceSessions`, and `crmAttendanceRecords`.
- Add routes:
  - `POST /api/admin/enrollments`
  - `PATCH /api/admin/enrollments/:enrollmentId`
  - `POST /api/admin/attendance/sessions`
  - `POST /api/admin/attendance/records/bulk`
  - `GET /api/admin/attendance/summary`
- Use classroom membership for operational access and `crmEnrollments` for reporting and lifecycle.
- Add attendance view under Class Management with:
  - session date
  - present/absent/late
  - absence reason
  - intervention flag
- Surface at-risk indicators on student cards.

**Step 4: Run test to verify it passes**

Run:

1. `node tests/crm/enrollment-attendance.test.js`
2. `node scripts/crm/smoke-attendance.js --base-url http://localhost:8443`

Expected:

- both commands exit `0`
- smoke prints `attendance smoke passed`

**Step 5: Commit**

```bash
git add tests/crm/enrollment-attendance.test.js scripts/crm/smoke-attendance.js functions/src/crm/enrollment-service.js functions/src/routes/admin/enrollments.js functions/src/routes/admin/attendance.js public/js/crm/enrollments.js public/js/crm/attendance.js public/crm-admin.html
git commit -m "feat: add crm enrollments and attendance tracking"
```

### Task 9: Finance, Invoices, Payments, And Commissions

**Files:**
- Create: `functions/src/crm/finance-service.js`
- Create: `functions/src/routes/admin/finance.js`
- Create: `public/js/crm/finance.js`
- Modify: `public/crm-admin.html`
- Modify: `public/crm-admin.css`
- Test: `tests/crm/finance-service.test.js`
- Test: `scripts/crm/smoke-finance.js`

**Step 1: Write the failing finance tests**

- Assert support for:
  - invoice creation
  - partial payments
  - outstanding balance
  - refund status
  - discount tracking
  - commission splits for counselor / teacher / agent
- Assert linked student and enrollment references exist on invoice and payment records.

**Step 2: Run test to verify it fails**

Run:

1. `node tests/crm/finance-service.test.js`
2. `node scripts/crm/smoke-finance.js --base-url http://localhost:8443`

Expected: FAIL because finance records do not exist yet.

**Step 3: Write minimal implementation**

- Add `crmInvoices`, `crmPayments`, and `crmCommissions`.
- Add routes:
  - `GET /api/admin/invoices`
  - `POST /api/admin/invoices`
  - `PATCH /api/admin/invoices/:invoiceId`
  - `POST /api/admin/payments`
  - `GET /api/admin/finance/summary`
- Add student-level finance widgets:
  - invoiced
  - paid
  - outstanding
  - next due
- Add agent/staff commission reporting with explicit status fields:
  - `pending`
  - `approved`
  - `paid`

**Step 4: Run test to verify it passes**

Run:

1. `node tests/crm/finance-service.test.js`
2. `node scripts/crm/smoke-finance.js --base-url http://localhost:8443`

Expected:

- both commands exit `0`
- smoke prints `finance smoke passed`

**Step 5: Commit**

```bash
git add tests/crm/finance-service.test.js scripts/crm/smoke-finance.js functions/src/crm/finance-service.js functions/src/routes/admin/finance.js public/js/crm/finance.js public/crm-admin.html public/crm-admin.css
git commit -m "feat: add crm finance and commission tracking"
```

### Task 10: Student 360, Documents, Contacts, And Counseling Notes

**Files:**
- Modify: `functions/src/crm/student-service.js`
- Modify: `functions/src/routes/admin/students.js`
- Create: `public/js/crm/student-360.js`
- Modify: `public/crm-admin.html`
- Modify: `public/crm-admin.css`
- Test: `tests/crm/student-360.test.js`
- Test: `scripts/crm/smoke-student-360.js`

**Step 1: Write the failing Student 360 tests**

- Assert persistence of:
  - target exam
  - target score
  - score history
  - guardian/company contacts
  - document refs
  - counseling notes
  - preferred schedule
- Assert browser rendering groups these fields into a single student overview.

**Step 2: Run test to verify it fails**

Run:

1. `node tests/crm/student-360.test.js`
2. `node scripts/crm/smoke-student-360.js --base-url http://localhost:8443`

Expected: FAIL because current student records are narrow and modal-only.

**Step 3: Write minimal implementation**

- Extend student schema with:
  - `targets`
  - `scoreHistory[]`
  - `contacts.guardians[]`
  - `contacts.companies[]`
  - `documentRefs[]`
  - `counselingNotes`
- Add a Student 360 section in the CRM modal or a dedicated slide-over detail view.
- Store document refs as Storage metadata only, never public URLs.
- Use signed URLs when admins preview private documents.

**Step 4: Run test to verify it passes**

Run:

1. `node tests/crm/student-360.test.js`
2. `node scripts/crm/smoke-student-360.js --base-url http://localhost:8443`

Expected:

- both commands exit `0`
- smoke prints `student 360 smoke passed`

**Step 5: Commit**

```bash
git add tests/crm/student-360.test.js scripts/crm/smoke-student-360.js functions/src/crm/student-service.js functions/src/routes/admin/students.js public/js/crm/student-360.js public/crm-admin.html public/crm-admin.css
git commit -m "feat: add crm student 360 records"
```

### Task 11: Templates, Reminder Automations, And Communication Queue

**Files:**
- Create: `functions/src/crm/automation-service.js`
- Create: `functions/src/routes/admin/automations.js`
- Modify: `functions/src/index.js`
- Create: `public/js/crm/communications.js`
- Modify: `public/crm-admin.html`
- Test: `tests/crm/automation-service.test.js`
- Test: `scripts/crm/smoke-communications.js`

**Step 1: Write the failing automation tests**

- Assert support for:
  - reminder template creation
  - rule creation
  - queue entry generation
  - idempotent processing
  - delivery status updates
- Assert sample rules for:
  - overdue next action
  - upcoming test result due date
  - unpaid invoice reminder
  - class attendance intervention

**Step 2: Run test to verify it fails**

Run:

1. `node tests/crm/automation-service.test.js`
2. `node scripts/crm/smoke-communications.js --base-url http://localhost:8443`

Expected: FAIL because there is no automation or communication queue.

**Step 3: Write minimal implementation**

- Add `crmTemplates`, `crmAutomationRules`, and `crmAutomationQueue`.
- Add routes:
  - `GET /api/admin/templates`
  - `POST /api/admin/templates`
  - `GET /api/admin/automations`
  - `POST /api/admin/automations`
  - `POST /api/admin/automations/:ruleId/run-now`
- Add a scheduled Cloud Function in `functions/src/index.js` that:
  - scans active rules
  - enqueues due reminder jobs
  - marks queue records `pending`, `sent`, or `failed`
- Start with provider-agnostic queueing and email-capable payloads; log manual channels like Zalo/Facebook as communication records until providers are wired.
- Add browser UI for template management and communication history.

**Step 4: Run test to verify it passes**

Run:

1. `node tests/crm/automation-service.test.js`
2. `node scripts/crm/smoke-communications.js --base-url http://localhost:8443`

Expected:

- both commands exit `0`
- smoke prints `communications smoke passed`

**Step 5: Commit**

```bash
git add tests/crm/automation-service.test.js scripts/crm/smoke-communications.js functions/src/crm/automation-service.js functions/src/routes/admin/automations.js functions/src/index.js public/js/crm/communications.js public/crm-admin.html
git commit -m "feat: add crm templates and reminder automations"
```

### Task 12: Dashboard Reporting, Auditability, Roles, Dedupe, And Import/Export

**Files:**
- Create: `functions/src/crm/reporting-service.js`
- Create: `functions/src/crm/governance-service.js`
- Create: `functions/src/routes/admin/reporting.js`
- Create: `functions/src/routes/admin/governance.js`
- Create: `public/js/crm/dashboard.js`
- Create: `public/js/crm/governance.js`
- Modify: `public/crm-admin.html`
- Modify: `docs/specs/features/admin-and-crm.md`
- Create: `tests/crm/reporting-governance.test.js`
- Create: `scripts/crm/export-crm-data.js`
- Create: `scripts/crm/import-crm-data.js`
- Create: `scripts/crm/smoke-dashboard.js`

**Step 1: Write the failing reporting/governance tests**

- Assert dashboard metrics exist for:
  - funnel conversion
  - source ROI
  - counselor productivity
  - class fill rate
  - attendance risk
  - revenue by course
  - collections / outstanding balances
- Assert governance features exist for:
  - audit log write on every mutation
  - duplicate detection by email/phone/name
  - merge job state
  - role checks for admin / counselor / teacher / finance
  - export and import command contracts

**Step 2: Run test to verify it fails**

Run:

1. `node tests/crm/reporting-governance.test.js`
2. `node scripts/crm/smoke-dashboard.js --base-url http://localhost:8443`

Expected: FAIL because dashboard, audit log, and governance tooling do not exist yet.

**Step 3: Write minimal implementation**

- Add `crmAuditLogs` and log every CRM mutation from the shared route layer.
- Add `crmMergeJobs` and duplicate-detection helpers.
- Add admin roles stored under `users/{uid}.crmRole`.
- Add reporting endpoints:
  - `GET /api/admin/dashboard/summary`
  - `GET /api/admin/dashboard/funnel`
  - `GET /api/admin/dashboard/revenue`
- Add governance endpoints:
  - `GET /api/admin/duplicates`
  - `POST /api/admin/merge-jobs`
  - `GET /api/admin/audit-logs`
- Add import/export CLI scripts for CSV/JSON snapshots.
- Update the dashboard panel so it becomes the real default landing page instead of a placeholder.
- Update `docs/specs/features/admin-and-crm.md` with the final route surface, data model, and verification checklist.

**Step 4: Run test to verify it passes**

Run:

1. `node tests/crm/reporting-governance.test.js`
2. `node scripts/crm/smoke-dashboard.js --base-url http://localhost:8443`
3. `node scripts/crm/export-crm-data.js --dry-run`
4. `node scripts/crm/import-crm-data.js --dry-run`

Expected:

- all commands exit `0`
- smoke prints `dashboard smoke passed`
- dry runs print counts without mutating data

**Step 5: Commit**

```bash
git add tests/crm/reporting-governance.test.js scripts/crm/export-crm-data.js scripts/crm/import-crm-data.js scripts/crm/smoke-dashboard.js functions/src/crm/reporting-service.js functions/src/crm/governance-service.js functions/src/routes/admin/reporting.js functions/src/routes/admin/governance.js public/js/crm/dashboard.js public/js/crm/governance.js public/crm-admin.html docs/specs/features/admin-and-crm.md
git commit -m "feat: add crm dashboard reporting and governance"
```

### Task 13: Full Verification Bundle

**Files:**
- Create: `scripts/crm/verify-crm-suite.js`

**Step 1: Write the failing verification orchestrator**

- Run, in order:
  - router contract test
  - collection contract test
  - shell static test
  - student service test
  - course/classroom service test
  - lead service test
  - activity service test
  - enrollment/attendance test
  - finance service test
  - student 360 test
  - automation test
  - reporting/governance test
  - all smoke scripts
  - `npm run lint:crm`

**Step 2: Run verification to verify it fails**

Run: `node scripts/crm/verify-crm-suite.js --base-url http://localhost:8443`

Expected: FAIL until every prior task has been completed.

**Step 3: Write minimal implementation**

- Implement the orchestrator as a thin process runner.
- Exit non-zero on the first failure.
- Print one concise line per completed check so failures are easy to localize in CI.

**Step 4: Run full verification**

Run these commands:

1. `node tests/crm/admin-router-contract.test.js`
2. `node tests/crm/collection-contracts.test.js`
3. `node tests/crm/crm-shell-static.test.js`
4. `node tests/crm/student-service.test.js`
5. `node tests/crm/course-classroom-service.test.js`
6. `node tests/crm/lead-service.test.js`
7. `node tests/crm/activity-service.test.js`
8. `node tests/crm/enrollment-attendance.test.js`
9. `node tests/crm/finance-service.test.js`
10. `node tests/crm/student-360.test.js`
11. `node tests/crm/automation-service.test.js`
12. `node tests/crm/reporting-governance.test.js`
13. `node scripts/crm/smoke-student-profile.js --base-url http://localhost:8443`
14. `node scripts/crm/smoke-classroom-admin.js --base-url http://localhost:8443`
15. `node scripts/crm/smoke-lead-pipeline.js --base-url http://localhost:8443`
16. `node scripts/crm/smoke-activity-timeline.js --base-url http://localhost:8443`
17. `node scripts/crm/smoke-attendance.js --base-url http://localhost:8443`
18. `node scripts/crm/smoke-finance.js --base-url http://localhost:8443`
19. `node scripts/crm/smoke-student-360.js --base-url http://localhost:8443`
20. `node scripts/crm/smoke-communications.js --base-url http://localhost:8443`
21. `node scripts/crm/smoke-dashboard.js --base-url http://localhost:8443`
22. `node scripts/crm/verify-crm-suite.js --base-url http://localhost:8443`
23. `npm run lint:crm`

Expected:

- every command exits `0`
- every smoke script prints its `passed` line
- the verification orchestrator prints a final line like `crm verification suite passed`
- `npm run lint:crm` exits without errors

**Step 5: Commit**

```bash
git add scripts/crm/verify-crm-suite.js
git commit -m "test: add crm verification bundle"
```

## Delivery Order

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5
6. Task 6
7. Task 7
8. Task 8
9. Task 9
10. Task 10
11. Task 11
12. Task 12
13. Task 13

## Notes For Execution

- Do not skip Task 1 through Task 5. They remove current defects and establish the data contracts all later features depend on.
- Reuse the existing classroom design in `docs/plans/2026-03-07-classroom-feature-design.md` where it aligns, but treat this plan as the controlling sequence for implementation.
- Keep all admin mutations audit-logged from Task 12 onward; if governance lands later than reporting, backfill audit logging before rollout.
- If scope needs to be cut, cut after Task 8. Tasks 9 through 12 are standard CRM expansion layers; Tasks 1 through 8 are the operational core.
