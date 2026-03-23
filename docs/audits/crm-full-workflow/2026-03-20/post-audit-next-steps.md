# CRM Post-Audit Next Steps

## Commit Batches

### Batch 1: Intake, testing, and student/class matching

Files:

- `functions/src/crm/lead-service.js`
- `functions/src/apiApp.js`
- `functions/src/routes/entrance-tests.js`
- `src/routes/admin.js`
- `src/routes/entrance-tests.js`
- `functions/src/crm/student-service.js`
- `functions/src/crm/course-service.js`
- `functions/src/crm/classroom-match-service.js`
- `functions/src/crm/schedule-normalizer.js`
- `functions/src/routes/admin/students.js`
- `public/js/crm/leads.js`
- `public/js/crm/student-360.js`
- `public/js/crm/classrooms.js`
- `tests/crm/lead-service.test.js`
- `tests/crm/lead-entrance-stage-sync.test.js`
- `tests/crm/student-service.test.js`
- `tests/crm/course-classroom-service.test.js`
- `tests/crm/classroom-match-service.test.js`
- `tests/crm/schedule-normalizer.test.js`

Suggested commit message:

```bash
feat: add structured intake and classroom matching
```

### Batch 2: Finance, enrollment handoff, and workflow guidance

Files:

- `functions/src/crm/finance-service.js`
- `functions/src/routes/admin/finance.js`
- `public/js/crm/finance.js`
- `public/crm-admin.html`
- `public/crm-admin.js`
- `tests/crm/finance-service.test.js`
- `tests/crm/finance-enrollment-handoff.test.js`
- `scripts/crm/smoke-finance.js`

Suggested commit message:

```bash
feat: guide payment to assignment workflow
```

### Batch 3: Homework lifecycle and live delivery

Files:

- `functions/src/crm/homework-service.js`
- `functions/src/crm/live-session-service.js`
- `functions/src/routes/admin/create-crm-router.js`
- `functions/src/crm/collections.js`
- `public/js/classroom-api.js`
- `public/js/classroom.js`
- `public/crm-admin.html`
- `public/crm-admin.js`
- `tests/crm/homework-service.test.js`
- `tests/crm/live-session-service.test.js`
- `scripts/crm/smoke-homework-flow.js`
- `scripts/crm/smoke-live-sessions.js`

Suggested commit message:

```bash
feat: complete homework and live delivery workflow
```

### Batch 4: Verification and environment support

Files:

- `src/utils/firebase.js`
- `src/utils/service-account-path.js`
- `tests/service-account-path.test.js`
- `scripts/crm/verify-crm-suite.js`
- `tests/crm/admin-router-contract.test.js`
- `tests/crm/crm-shell-static.test.js`

Suggested commit message:

```bash
test: harden crm verification and local auth bootstrap
```

## Staff UAT Checklist

### 1. Facebook lead intake

- Create a lead from the CRM with Facebook name, Facebook URL, real name, DOB, learning needs, preferred days/hours, and Messenger context.
- Verify the lead workspace shows the saved counseling context.

### 2. Entrance test

- Create an entrance test for the lead.
- Verify the lead moves to `test_scheduled`.
- Submit the test through the public link.
- Verify the lead moves to `test_completed`.

### 3. Billing before assignment

- Open the student finance tab with no enrollment yet.
- Create an invoice.
- Verify the finance banner says payment must be confirmed before assignment.
- Verify `Create Enrollment` stays disabled before payment.

### 4. Payment-confirmed assignment

- Record payment against the invoice.
- Verify the finance banner changes to classroom assignment guidance.
- Verify the recommended classroom panel becomes actionable.
- Create the enrollment.

### 5. Live delivery

- Create a scheduled live session.
- Start the session.
- Verify the attendance tab shows the live-session guidance.
- End the session.
- Verify the classwork tab shows the homework follow-up guidance.

### 6. Homework loop

- Create classwork.
- Submit homework as a student.
- Return it for revision.
- Resubmit from the student view.
- Grade the final submission.

### 7. Regression spot checks

- Confirm dashboard still loads.
- Confirm attendance summary still loads.
- Confirm communications and automation screens still load.
