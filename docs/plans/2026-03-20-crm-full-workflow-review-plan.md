# CRM Full Workflow Review Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Review the complete CRM lifecycle from Facebook lead intake through course/class setup, entrance testing, payment, enrollment, class delivery, and homework feedback, and produce a clear pass/fail gap list with evidence.

**Architecture:** Run the review in layers instead of one long manual click-through: first verify shared CRM contracts and smoke coverage, then review each business stage in order using seeded test records, admin UI checks, and data-level verification in Firestore-backed flows. Treat Facebook Messenger context, live class hosting, and homework return/revision as explicit manual-gap areas because the repo already flags them as not fully implemented end to end.

**Tech Stack:** Node.js, Express 5, Firebase Auth, Firestore, Firebase Storage, plain HTML/CSS/JS admin UI, CRM route/service tests in `tests/crm/`, smoke scripts in `scripts/crm/`, entrance test routes in `src/routes/entrance-tests.js`.

---

**Path convention:** Store review evidence under `docs/audits/crm-full-workflow/2026-03-20/`. Save the baseline report as `baseline.md` or `baseline.json`, screenshots with the stage prefix (for example `01-lead-intake-form.png`), and the final defect log as `findings.md`.

**Critical scope notes before review starts:**
- Requested Facebook fields to verify: Facebook name, Facebook link, real name, email, phone, DOB, learning needs, preferred learning days/hours.
- Current lead service first-class fields are `name`, `label`, `phone`, `email`, `zalo`, `facebook`, `source`, `ownerUid`, `stage`, `probability`, `nextActionAt`, `lastContactAt`, `lossReason`, `notes`, and `studentId`.
- `DOB`, `learning needs`, and structured `preferred learning days/hours` are not first-class lead fields in `functions/src/crm/lead-service.js`; the review must determine whether these are captured elsewhere, stored in free text, or missing.
- The repo already marks these as manual review areas:
  - Facebook/Messenger conversation context beyond contact fields
  - live class hosting and join/start flow
  - homework return/revision/resubmission end to end

**Workflow logic checks that must be applied to every stage:**
- Verify the next step is obvious to staff after each action.
- Verify data entered once is reused downstream instead of retyped.
- Verify there is no illogical state transition or stage jump.
- Verify required approvals or confirmations happen before irreversible actions.
- Verify a staff member can tell what is pending, blocked, completed, or overdue.
- Verify the system does not force users through unnecessary duplicate steps.
- Verify each stage produces the data required by the next stage.
- Verify operational ownership is clear when a flow moves from counselor to finance to teacher.
- Verify fallbacks are safe when automation is absent.
- Classify each stage as:
  - `logical and efficient`
  - `logical but manual`
  - `works but incoherent`
  - `workflow blocker`

### Task 1: Establish Review Baseline And Evidence Folder

**Files:**
- Inspect: `docs/specs/features/admin-and-crm.md`
- Inspect: `docs/testing/2026-03-10-crm-browser-validation-plan.md`
- Inspect: `scripts/crm/run-workflow-review-baseline.js`
- Inspect: `scripts/crm/workflow-review-baseline-lib.js`
- Inspect: `scripts/crm/verify-crm-suite.js`

**Step 1: Confirm the review scope and evidence format**

- Read the CRM feature spec and browser validation plan.
- Create a one-page checklist for the exact workflow you want reviewed:
  - Facebook lead intake
  - course and classroom creation
  - entrance test generation and review
  - invoice and payment flow
  - payment-confirmed enrollment handoff
  - class delivery
  - homework create/submit/assess/return
- Expected artifact: a scope checklist mapped to those seven business stages.
- Add a second checklist called `logic checks` using the workflow logic rules above.

**Step 2: Run the automated CRM baseline**

Run:

```bash
node scripts/crm/run-workflow-review-baseline.js
```

Expected:
- a markdown report headed `# CRM Workflow Review Baseline`
- pass/fail counts by review area
- manual review areas listed at the end

**Step 3: Run the full CRM verification suite**

Run:

```bash
npm run verify:crm
```

Expected:
- all contract tests, service tests, smoke scripts, and lint complete
- if anything fails, capture the exact failing command before any manual review begins

**Step 4: Record known uncovered areas before manual testing**

- Copy the manual-gap areas from `scripts/crm/workflow-review-baseline-lib.js` into the evidence log.
- Mark them as `manual-only` rather than `not reviewed`.
- Expected artifact: `findings.md` starts with a known-gaps section so later reviewers do not misread missing automation as a pass.

### Task 2: Review Facebook Lead Intake And Lead Workspace

**Files:**
- Inspect: `functions/src/crm/lead-service.js`
- Inspect: `functions/src/routes/admin/leads.js`
- Inspect: `public/js/crm/leads.js`
- Test: `tests/crm/lead-service.test.js`
- Test: `scripts/crm/smoke-lead-pipeline.js`
- Test: `scripts/crm/smoke-activity-timeline.js`

**Step 1: Verify the lead data model against the business intake form**

- Compare the fields your admins actually need with the current lead-service contract.
- For each required field, classify it as:
  - `native field`
  - `stored indirectly`
  - `free-text only`
  - `missing`
- Special attention items:
  - Facebook name versus `name`/`label`
  - Facebook profile link versus `facebook`
  - real name if Facebook name is different
  - DOB
  - learning needs
  - preferred learning days and hours
- Expected artifact: a field-mapping matrix with one row per requested intake field.

**Step 2: Validate lead creation rules**

Run:

```bash
node tests/crm/lead-service.test.js
node scripts/crm/smoke-lead-pipeline.js
node scripts/crm/smoke-activity-timeline.js
```

Expected:
- lead create/update contract passes
- lead stage movement persists
- tasks and activities persist and reload

**Step 3: Perform the admin UI intake walkthrough**

- Log in as admin and open `crm-admin.html`.
- Go to `Enquiry`.
- Create a Facebook-origin lead with all fields your business expects.
- Reopen the lead and confirm each value is still visible after refresh.
- Expected evidence:
  - screenshot of create form
  - screenshot of saved lead detail
  - note for each missing field or overloaded field

**Step 4: Review duplicate, ownership, and follow-up behavior**

- Confirm duplicate detection if the same email or phone is entered again.
- Change stage from `new` to `contacted` to `test_scheduled`.
- Add one task and one activity to confirm counselor follow-up history works.
- Expected outcome:
  - duplicate handling is either explicit or absent
  - stage history and next action process are understandable to staff

**Step 5: Decide whether Facebook Messenger context is operationally sufficient**

- Check whether admins can store the Messenger thread URL, counselor notes, reply status, and last-message context in structured fields.
- If the answer is no and staff depend on that context, log a workflow gap even if basic lead capture passes.
- Verify whether the counselor can move from new lead to next action without leaving the CRM or manually reconstructing context.
- Expected artifact: a binary decision in `findings.md`:
  - `operationally sufficient`
  - `works but context is weak`
  - `workflow blocker`

### Task 3: Review Course Creation, Classroom Creation, And Scheduling

**Files:**
- Inspect: `functions/src/crm/course-service.js`
- Inspect: `functions/src/routes/admin/courses.js`
- Inspect: `public/js/crm/courses.js`
- Inspect: `public/js/crm/classrooms.js`
- Test: `tests/crm/course-classroom-service.test.js`
- Test: `scripts/crm/smoke-classroom-admin.js`

**Step 1: Validate the course and classroom contracts**

Run:

```bash
node tests/crm/course-classroom-service.test.js
node scripts/crm/smoke-classroom-admin.js
```

Expected:
- course create/edit passes
- classroom create/edit passes
- schedule normalization and expansion logic passes
- missing homework review items can be computed for class members

**Step 2: Perform the admin setup walkthrough**

- In CRM admin:
  - create a new course
  - create a new classroom tied to that course
  - set status and schedule slots
  - reopen both records after refresh
- Expected evidence:
  - course list reflects new course
  - classroom form persists course linkage
  - schedule slots are normalized correctly

**Step 3: Review scheduling against the sales use case**

- Compare the stored schedule format with the sales requirement to match a student's preferred days/hours to current classes.
- Confirm whether the UI makes this comparison easy or whether staff must manually compare free text.
- Verify whether the matching workflow is coherent:
  - can staff see learner preference and class schedule in the same decision flow
  - can they explain why a class was chosen
  - is duplicate re-entry needed
- Expected artifact: a note stating one of:
  - `schedule matching supported`
  - `schedule data exists but matching is manual`
  - `schedule matching insufficient`

**Step 4: Review classroom content setup**

- Inside a classroom, add:
  - one module
  - one classwork item
  - one announcement/post
- Reopen the classroom to verify all three persisted.
- Expected outcome:
  - admin setup for lesson delivery exists
  - content creation is separate from enrollment and can be reviewed independently

### Task 4: Review Entrance Test Creation, Delivery, Submission, And Result Review

**Files:**
- Inspect: `src/routes/entrance-tests.js`
- Inspect: `functions/src/routes/entrance-tests.js`
- Inspect: `public/entrance-test.html`
- Inspect: `public/entrance-test.js`
- Inspect: `public/crm-entrance-test-result.html`
- Inspect: `public/crm-entrance-test-result.js`
- Test: `npm run smoke:entrance-test`

**Step 1: Verify entrance test route and token behavior**

- Review the route logic for:
  - session start
  - progress save
  - speaking upload
  - submitted/revoked link handling
- Expected artifact: a short checklist confirming whether links are single-use, token-gated, and resumable.

**Step 2: Run the entrance test smoke flow**

Run:

```bash
npm run smoke:entrance-test
```

Expected:
- test link creation works
- public session loads
- submission can complete without auth
- result is visible to admin

**Step 3: Perform the human review of the test workflow**

- From admin, create an entrance test for the lead.
- Send or copy the generated link.
- Complete a sample submission as if you were the learner.
- Return to admin and review the result page.
- Expected evidence:
  - generated link screenshot
  - learner-facing test screenshot
  - admin result screenshot

**Step 4: Check the business handoff from test result to counseling**

- Verify whether the test result updates lead stage, student profile, or learning profile automatically.
- If not automatic, verify the manual counseling workflow is explicit and safe.
- Verify that the handoff logic is coherent:
  - no duplicate student creation
  - no unclear owner between counselor and admin
  - no need to copy test results by hand unless explicitly designed
- Expected artifact: a handoff note:
  - `automatic handoff`
  - `manual but clear`
  - `manual and error-prone`

### Task 5: Review Invoice, Payment, And Finance Integrity

**Files:**
- Inspect: `functions/src/crm/finance-service.js`
- Inspect: `functions/src/routes/admin/finance.js`
- Inspect: `public/js/crm/finance.js`
- Test: `tests/crm/finance-service.test.js`
- Test: `scripts/crm/smoke-finance.js`
- Test: `scripts/crm/smoke-dashboard.js`

**Step 1: Validate finance service rules**

Run:

```bash
node tests/crm/finance-service.test.js
node scripts/crm/smoke-finance.js
```

Expected:
- invoice requires valid student and amount data
- payment requires invoice and positive amount
- partial payment updates invoice totals correctly
- outstanding balance and next due date calculate correctly

**Step 2: Review invoice creation in the admin UI**

- Use a student with one real enrollment and create an invoice.
- Confirm the UI attaches the real `enrollmentId` and `courseId`.
- Repeat with:
  - a student with multiple enrollments
  - a student with no enrollments
- Expected outcome:
  - one-enrollment case auto-selects correctly
  - multi-enrollment case forces a choice
  - no-enrollment case is clearly marked manual fallback

**Step 3: Review payment confirmation flow**

- Record:
  - one partial payment
  - one full payment
- Confirm totals update immediately and persist after refresh.
- Verify any commission records or downstream reporting if your team uses them.
- Verify finance logic coherence:
  - payment cannot be recorded against the wrong enrollment context
  - invoice state transitions are understandable
  - staff can see what action comes next after payment is confirmed
- Expected evidence:
  - finance summary before payment
  - finance summary after payment
  - invoice status transition from unpaid to partial to paid

**Step 4: Review finance visibility at dashboard level**

Run:

```bash
node scripts/crm/smoke-dashboard.js
```

Expected:
- revenue metrics refresh after payment changes
- finance data remains scoped correctly to the selected student and to dashboard aggregates

### Task 6: Review Payment-Confirmed Enrollment And Classroom Assignment

**Files:**
- Inspect: `functions/src/crm/enrollment-service.js`
- Inspect: `functions/src/routes/admin/enrollments.js`
- Inspect: `public/js/crm/enrollments.js`
- Inspect: `public/js/crm/students.js`
- Test: `tests/crm/enrollment-attendance.test.js`
- Test: `scripts/crm/smoke-attendance.js`
- Test: `scripts/crm/smoke-student-profile.js`
- Test: `scripts/crm/smoke-student-360.js`

**Step 1: Confirm the lead-to-student conversion fields carry over**

- Convert a lead to a student.
- Verify that contact fields, acquisition source, notes, and lead linkage are retained.
- Compare the converted student profile to the original lead data.
- Expected artifact: conversion checklist showing which fields survive and which are lost.

**Step 2: Review post-payment enrollment creation**

Run:

```bash
node tests/crm/enrollment-attendance.test.js
node scripts/crm/smoke-student-profile.js
node scripts/crm/smoke-student-360.js
```

Expected:
- enrollment requires `studentId` and `classId`
- linked student UID can be resolved for classroom access
- student profile and student 360 fields persist

**Step 3: Perform the admin handoff walkthrough**

- After payment confirmation:
  - assign the student to the correct course/classroom
  - confirm enrollment exists
  - confirm classroom membership exists
  - confirm the student appears in attendance and classroom review views
- Verify handoff logic:
  - finance confirmation leads naturally into enrollment assignment
  - no duplicate records are created
  - teacher-facing class roster uses the same assigned student record
- Expected evidence:
  - enrollment record screenshot
  - classroom membership screenshot
  - student 360 screenshot showing the assigned schedule or notes

**Step 4: Review whether preferred schedule is actually used**

- Compare the student's preferred schedule to the classroom schedule you created earlier.
- Determine whether assignment is:
  - system-assisted
  - admin-assisted with visible data
  - completely manual and error-prone
- Expected artifact: a scheduling-handoff assessment in `findings.md`.

### Task 7: Review Class Delivery, Attendance, Homework Submission, Assessment, And Return

**Files:**
- Inspect: `public/js/classroom-api.js`
- Inspect: `public/js/classroom.js`
- Inspect: `functions/src/routes/admin/create-crm-router.js`
- Inspect: `scripts/test_classroom_flow.js`
- Test: `scripts/crm/smoke-classroom-admin.js`
- Test: `scripts/crm/smoke-attendance.js`

**Step 1: Review attendance and at-risk delivery controls**

Run:

```bash
node scripts/crm/smoke-attendance.js
```

Expected:
- attendance session creation works
- present/late/absent records persist
- `interventionFlag` and low attendance/score can mark a student at risk

**Step 2: Review the classroom content flow as admin**

- In the classroom:
  - create classwork
  - verify the submission review surface exists
  - verify the grading endpoint exists
- Confirm the route support in `functions/src/routes/admin/create-crm-router.js` for:
  - classwork creation
  - submission review listing
  - submission grading
- Expected artifact: admin-side capability checklist for homework management.

**Step 3: Run the standalone classroom flow test**

Run:

```bash
node scripts/test_classroom_flow.js
```

Expected:
- course, student, and classroom test data are created
- module and classwork are created
- submission is written
- grading updates status to `graded`
- student can read the graded result

**Step 4: Manually review the student-facing homework path**

- Use a real or test student account to verify:
  - student sees assigned classwork
  - student can submit homework
  - teacher/admin can assess it
  - student can see returned grade/feedback
- Expected evidence:
  - student to-do screenshot
  - submission confirmation screenshot
  - graded/returned homework screenshot

**Step 5: Explicitly test the unimplemented or weak areas**

- Check whether the product supports all of these as first-class steps:
  - live class hosting or meeting launch
  - returning homework with revision comments
  - resubmission after feedback
- Verify whether the overall teaching workflow is coherent even where product support is partial:
  - can teacher identify next action
  - can student understand current status
  - can admin track whether the learning loop is actually closed
- If any of those exist only partially or outside the CRM, mark them as workflow gaps instead of burying them inside general notes.
- Expected artifact: a `delivery-and-homework gaps` section in `findings.md`.

### Task 8: Produce Final Review Output And Sign-Off Decision

**Files:**
- Inspect: `scripts/crm/workflow-review-baseline-lib.js`
- Inspect: `docs/testing/2026-03-10-crm-browser-validation-plan.md`

**Step 1: Consolidate results by workflow stage**

- For each of the seven business stages, assign:
  - `pass`
  - `pass with caveats`
  - `fail`
- Require at least one evidence item for each decision.
- Also assign one workflow-logic rating:
  - `logical and efficient`
  - `logical but manual`
  - `works but incoherent`
  - `workflow blocker`
- Expected artifact: a stage-by-stage summary table.

**Step 2: Separate defects from product gaps**

- Classify every issue as one of:
  - bug
  - missing field/data model
  - weak admin UX
  - manual operational workaround
  - out-of-scope / not implemented
- Expected artifact: a defect triage table ordered by severity.

**Step 3: Write the final recommendation**

- Conclude with one of:
  - `CRM workflow is ready for production use`
  - `CRM workflow is usable with operational workarounds`
  - `CRM workflow needs fixes before rollout`
- The recommendation must reference the three most important blockers or caveats.
- Expected artifact: a final sign-off paragraph for leadership or product review.

**Step 4: Define immediate next actions if gaps are found**

- If Facebook intake fields are incomplete, create a follow-up item for structured intake data.
- If schedule matching is manual, create a follow-up item for counselor matching tools.
- If homework return/revision is partial, create a follow-up item for end-to-end submission lifecycle completion.
- If live class hosting is external, document the operational handoff clearly.
- Expected artifact: a prioritized next-actions list with owner and severity.
