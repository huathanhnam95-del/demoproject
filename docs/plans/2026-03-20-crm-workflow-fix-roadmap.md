# CRM Workflow Fix Roadmap Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the workflow blockers and incoherent handoffs found in the CRM audit so the full lead-to-classroom process is logically consistent, operationally efficient, and less dependent on staff memory.

**Architecture:** Fix the workflow in dependency order. First normalize the intake and stage-state model so the CRM can store the right data and keep the pipeline truthful. Next improve cross-stage handoffs between testing, finance, and enrollment. Only after those foundations are reliable should the classroom delivery loop be hardened with a server-backed submission path, revision lifecycle, and live-delivery integration.

**Tech Stack:** Node.js, Express 5, Firebase Auth, Firestore, Firebase Storage, plain HTML/CSS/JS admin UI, CRM service tests in `tests/crm/`, smoke scripts in `scripts/crm/`, classroom browser code in `public/js/`, shared admin routes in `functions/src/routes/admin/`.

---

**Path convention:** CRM browser changes stay in `public/crm-admin.js`, `public/crm-admin.html`, and `public/js/crm/*.js`; shared server logic stays in `functions/src/crm/*.js` and `functions/src/routes/admin/*.js`; entrance-test changes stay in both `src/routes/entrance-tests.js` and `functions/src/routes/entrance-tests.js`; verification stays in `tests/crm/` and `scripts/crm/`.

**Priority order rationale:**
- Do not build more classroom workflow on top of incomplete lead data.
- Do not automate payment-to-enrollment until learner availability and lead/test states are trustworthy.
- Do not add revision features until student submission access is hardened server-side.
- Treat live delivery as last because it is a broader product decision, not just a CRUD fix.

### Task 1: Structured Lead Intake And Messenger Context

**Files:**
- Modify: `public/crm-admin.html`
- Modify: `public/crm-admin.js`
- Modify: `public/js/crm/leads.js`
- Modify: `functions/src/crm/lead-service.js`
- Modify: `functions/src/routes/admin/leads.js`
- Test: `tests/crm/lead-service.test.js`
- Test: `scripts/crm/smoke-lead-pipeline.js`

**Step 1: Write the failing lead-intake contract test**

- Extend the lead service test to require first-class support for:
  - `facebookDisplayName`
  - `facebookProfileUrl`
  - `realName`
  - `dateOfBirth`
  - `learningNeeds`
  - `preferredLearningDays`
  - `preferredLearningHours`
  - `messengerThreadUrl`
  - `messengerLastContactAt`
  - `messengerStatus`
- Add an assertion that old `facebook` continues to map cleanly for backward compatibility.

**Step 2: Run test to verify it fails**

Run: `node tests/crm/lead-service.test.js`

Expected: FAIL because those fields are not recognized by `lead-service`.

**Step 3: Write minimal implementation**

- Add the new lead fields to the service contract and map functions.
- Update the enquiry form in `public/crm-admin.html`.
- Update `public/js/crm/leads.js` and `public/crm-admin.js` to send and reload the new fields.
- Keep legacy fields readable so old records do not break.

**Step 4: Run test to verify it passes**

Run:

```bash
node tests/crm/lead-service.test.js
node scripts/crm/smoke-lead-pipeline.js
```

Expected:
- lead service passes
- lead smoke still passes

**Step 5: Commit**

```bash
git add public/crm-admin.html public/crm-admin.js public/js/crm/leads.js functions/src/crm/lead-service.js functions/src/routes/admin/leads.js tests/crm/lead-service.test.js scripts/crm/smoke-lead-pipeline.js
git commit -m "feat: add structured crm lead intake fields"
```

### Task 2: Entrance Test Stage Synchronization And Lead Handoff

**Files:**
- Modify: `public/crm-admin.js`
- Modify: `src/routes/entrance-tests.js`
- Modify: `functions/src/routes/entrance-tests.js`
- Modify: `functions/src/apiApp.js`
- Test: `tests/crm/lead-entrance-stage-sync.test.js`
- Test: `scripts/smoke-entrance-test.js`

**Step 1: Write the failing stage-sync test**

- Add a new test that proves:
  - creating a lead entrance test moves the lead to `test_scheduled`
  - submitting the test moves the lead to `test_completed`
  - no duplicate student is created if the lead already has a linked shadow student

**Step 2: Run test to verify it fails**

Run: `node tests/crm/lead-entrance-stage-sync.test.js`

Expected: FAIL because stage synchronization is not implemented.

**Step 3: Write minimal implementation**

- In the lead-side test creation flow, update the linked lead state to `test_scheduled`.
- In the entrance-test submit flow, if the test is linked to a lead through `studentId` or stored metadata, update the related lead to `test_completed`.
- Keep the existing single-use token behavior unchanged.
- Store enough metadata to make the linkage explicit and auditable.

**Step 4: Run test to verify it passes**

Run:

```bash
node tests/crm/lead-entrance-stage-sync.test.js
npm run smoke:entrance-test
```

Expected:
- new sync test passes
- entrance smoke still passes end to end

**Step 5: Commit**

```bash
git add public/crm-admin.js src/routes/entrance-tests.js functions/src/routes/entrance-tests.js functions/src/apiApp.js tests/crm/lead-entrance-stage-sync.test.js scripts/smoke-entrance-test.js
git commit -m "fix: sync entrance test events with lead stages"
```

### Task 3: Structured Availability And Class Matching Support

**Files:**
- Modify: `public/crm-admin.html`
- Modify: `public/js/crm/student-360.js`
- Modify: `functions/src/crm/student-service.js`
- Modify: `public/crm-admin.js`
- Test: `tests/crm/student-360.test.js`
- Test: `tests/crm/course-classroom-service.test.js`

**Step 1: Write the failing availability-shape test**

- Require student preference to be stored structurally, not only as a single string.
- Suggested structure:
  - `preferredSchedule.days`
  - `preferredSchedule.timeRanges`
  - `preferredSchedule.notes`
- Add a helper test for comparing student preference against classroom schedule slots.

**Step 2: Run test to verify it fails**

Run:

```bash
node tests/crm/student-360.test.js
node tests/crm/course-classroom-service.test.js
```

Expected: FAIL on the new structured availability assertions.

**Step 3: Write minimal implementation**

- Replace the single free-text field with a structured editor in the student 360 UI.
- Extend student-service normalization to store structured preference data.
- Add a read-only match summary in CRM so staff can compare learner availability to classroom schedules in one place.

**Step 4: Run test to verify it passes**

Run:

```bash
node tests/crm/student-360.test.js
node tests/crm/course-classroom-service.test.js
```

Expected: PASS with schedule preference stored and compared structurally.

**Step 5: Commit**

```bash
git add public/crm-admin.html public/crm-admin.js public/js/crm/student-360.js functions/src/crm/student-service.js tests/crm/student-360.test.js tests/crm/course-classroom-service.test.js
git commit -m "feat: add structured availability and class matching support"
```

### Task 4: Payment-To-Enrollment Handoff Workflow

**Files:**
- Modify: `public/crm-admin.js`
- Modify: `public/js/crm/finance.js`
- Modify: `functions/src/routes/admin/finance.js`
- Modify: `functions/src/routes/admin/enrollments.js`
- Test: `tests/crm/finance-enrollment-handoff.test.js`
- Test: `scripts/crm/smoke-finance.js`
- Test: `scripts/crm/smoke-attendance.js`

**Step 1: Write the failing handoff test**

- Add a test that proves:
  - after a payment is recorded, the UI or API can compute the next required action
  - if the student is not enrolled, the next action is `assign_classroom`
  - if multiple classrooms match, the next action is `select_classroom`
  - if already enrolled, the next action is `start_attendance`

**Step 2: Run test to verify it fails**

Run: `node tests/crm/finance-enrollment-handoff.test.js`

Expected: FAIL because finance and enrollment are currently separate steps with no guided workflow state.

**Step 3: Write minimal implementation**

- Add a workflow-state helper that derives the correct post-payment next action.
- Surface the next action in the finance tab after payment recording.
- Do not auto-enroll blindly; require explicit class selection when schedule fit is ambiguous.
- Reuse the existing enrollment route once the class is selected.

**Step 4: Run test to verify it passes**

Run:

```bash
node tests/crm/finance-enrollment-handoff.test.js
node scripts/crm/smoke-finance.js
node scripts/crm/smoke-attendance.js
```

Expected:
- handoff test passes
- finance and attendance smokes still pass

**Step 5: Commit**

```bash
git add public/crm-admin.js public/js/crm/finance.js functions/src/routes/admin/finance.js functions/src/routes/admin/enrollments.js tests/crm/finance-enrollment-handoff.test.js scripts/crm/smoke-finance.js scripts/crm/smoke-attendance.js
git commit -m "feat: add guided payment to enrollment handoff"
```

### Task 5: Server-Backed Student Submission Path And Access Consistency

**Files:**
- Modify: `public/js/classroom-api.js`
- Modify: `public/js/classroom.js`
- Modify: `functions/src/routes/classrooms.js`
- Modify: `functions/src/classroom-service.js`
- Modify: `firestore.rules`
- Modify: `storage.rules`
- Test: `tests/classroom-router.test.js`
- Test: `tests/classroom-admin-service.test.js`
- Test: `scripts/test_classroom_flow.js`

**Step 1: Write the failing submission-route test**

- Require a dedicated student submission route instead of direct client writes to `crmSubmissions`.
- Require membership validation before submission write.
- Require submission status to be server-authored.

**Step 2: Run test to verify it fails**

Run:

```bash
node tests/classroom-router.test.js
node tests/classroom-admin-service.test.js
```

Expected: FAIL on the new student submission route assertions.

**Step 3: Write minimal implementation**

- Add a student submission endpoint under the classroom router.
- Move submission creation out of direct Firestore client writes.
- Tighten Firestore/Storage rules so only valid student attempts are accepted.
- Update the classroom browser client to use the new route.

**Step 4: Run test to verify it passes**

Run:

```bash
node tests/classroom-router.test.js
node tests/classroom-admin-service.test.js
node scripts/test_classroom_flow.js
```

Expected:
- route and service tests pass
- classroom flow script passes once credentials/environment are available

**Step 5: Commit**

```bash
git add public/js/classroom-api.js public/js/classroom.js functions/src/routes/classrooms.js functions/src/classroom-service.js firestore.rules storage.rules tests/classroom-router.test.js tests/classroom-admin-service.test.js scripts/test_classroom_flow.js
git commit -m "fix: harden classroom submission path"
```

### Task 6: Homework Revision Lifecycle

**Files:**
- Modify: `functions/src/routes/admin/create-crm-router.js`
- Modify: `public/js/classroom-api.js`
- Modify: `public/js/classroom.js`
- Modify: `public/crm-admin.js`
- Test: `tests/crm/homework-revision-lifecycle.test.js`
- Test: `scripts/test_classroom_flow.js`

**Step 1: Write the failing lifecycle test**

- Require a real status model:
  - `assigned`
  - `turned-in`
  - `graded`
  - `returned_for_revision`
  - `resubmitted`
  - `completed`
- Require feedback and revision notes to persist.

**Step 2: Run test to verify it fails**

Run: `node tests/crm/homework-revision-lifecycle.test.js`

Expected: FAIL because only simple grading is currently modeled.

**Step 3: Write minimal implementation**

- Add admin actions for return-for-revision and completion.
- Add student resubmission behavior.
- Update student and admin UI so both sides can see current status and next action clearly.

**Step 4: Run test to verify it passes**

Run:

```bash
node tests/crm/homework-revision-lifecycle.test.js
node scripts/test_classroom_flow.js
```

Expected:
- lifecycle test passes
- classroom flow script passes through returned and resubmitted states once environment is available

**Step 5: Commit**

```bash
git add functions/src/routes/admin/create-crm-router.js public/js/classroom-api.js public/js/classroom.js public/crm-admin.js tests/crm/homework-revision-lifecycle.test.js scripts/test_classroom_flow.js
git commit -m "feat: add homework revision lifecycle"
```

### Task 7: Live Delivery Decision And Implementation

**Files:**
- Modify: `public/crm-admin.html`
- Modify: `public/crm-admin.js`
- Modify: `functions/src/routes/admin/create-crm-router.js`
- Test: `tests/crm/live-delivery-contract.test.js`

**Step 1: Write the failing live-delivery contract test**

- Choose one product direction and encode it:
  - either a real in-CRM meeting link workflow
  - or an explicit external-handoff workflow with required fields and status markers
- Require classroom records to expose the chosen delivery state clearly.

**Step 2: Run test to verify it fails**

Run: `node tests/crm/live-delivery-contract.test.js`

Expected: FAIL because `Zoom Links` is still effectively a placeholder.

**Step 3: Write minimal implementation**

- If using external delivery, add:
  - meeting platform
  - meeting URL
  - host owner
  - join instructions
  - delivery status
- If building in-CRM delivery, create the same contract first before UI polish.
- Remove the misleading disabled placeholder once a real path exists.

**Step 4: Run test to verify it passes**

Run: `node tests/crm/live-delivery-contract.test.js`

Expected: PASS with a real delivery contract instead of a placeholder tab.

**Step 5: Commit**

```bash
git add public/crm-admin.html public/crm-admin.js functions/src/routes/admin/create-crm-router.js tests/crm/live-delivery-contract.test.js
git commit -m "feat: add live delivery workflow contract"
```

### Task 8: Final Full-Flow Regression

**Files:**
- Modify: `scripts/crm/run-workflow-review-baseline.js`
- Modify: `scripts/crm/workflow-review-baseline-lib.js`
- Test: `scripts/crm/verify-crm-suite.js`

**Step 1: Add the new workflow logic checks to the regression suite**

- Add the new tests and any new smoke commands into the workflow baseline list.
- Add manual-area updates only for issues that remain intentionally external.

**Step 2: Run test to verify the full suite behavior**

Run:

```bash
node scripts/crm/run-workflow-review-baseline.js --json
npm run verify:crm
```

Expected:
- new tests appear in the baseline report
- the full CRM verification suite passes

**Step 3: Commit**

```bash
git add scripts/crm/run-workflow-review-baseline.js scripts/crm/workflow-review-baseline-lib.js scripts/crm/verify-crm-suite.js
git commit -m "test: expand crm workflow regression coverage"
```
