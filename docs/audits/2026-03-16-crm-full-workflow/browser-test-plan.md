# CRM Full Workflow Browser Test Plan

## Purpose

This document is the browser-execution version of the CRM full workflow audit. It is written for a reviewer who will open the application in a browser, switch between admin/teacher/student accounts, and collect evidence for each stage of the workflow.

This is not a generic QA checklist. It is designed to answer:

- what works in the browser right now
- what is visible but depends on an external/manual process
- what is missing or broken
- where the browser flow diverges from the intended business workflow

## Test Outcome Categories

For every step, record exactly one result:

- `PASS`: the expected state is reached in-browser
- `FAIL`: the expected state is not reached
- `PARTIAL`: some browser behavior exists, but the workflow still depends on an external/manual step
- `N/A`: the system does not support the step in-browser and it must be recorded as out of scope for the current product

## Browser Preflight

Before any browser work, verify these prerequisites.

### 1. Browser agent prerequisites

Record the status in this format:

`Chrome extension: installed / NOT installed | Allowlist: domain confirmed / domain NOT listed`

Expected values for this audit:

- `Chrome extension: installed`
- `Allowlist: domain confirmed`

Allowed domains should include:

- `localhost`
- `127.0.0.1`

### 2. Local/staging app status

Confirm the app is reachable in the browser.

Primary URLs to test:

- `https://localhost:8443/`
- `https://localhost:8443/crm-admin.html`
- `https://localhost:8443/classroom.html`

Record:

- which base URL was used
- whether login works
- whether any certificate/interstitial appears

### 3. Required browser sessions

Prepare these sessions:

- Session A: Admin
- Session B: Teacher
- Session C: Student 1
- Session D: Student 2
- Session E: Non-admin control user

Recommended setup:

- normal window for admin
- separate profiles/incognito windows for teacher/students/non-admin

### 4. Required devtools panels

Keep these open for every mutation step:

- `Console`
- `Network`

For every mutation step, capture:

- one screenshot
- one network request/response
- one persisted-record verification note

## Seed Data Setup

Before starting the browser flow, make sure the environment contains:

- 2 Facebook-origin leads
- 1 course
- 1 classroom
- 1 teacher account
- 2 student accounts
- 1 class schedule with at least 2 slots
- 2 classwork items, or the ability to create them during the run

If any required data is missing, record it immediately in the findings log before continuing.

## Browser Test Sequence

## Section A: Access Control and Shell Availability

### A1. Non-admin access control

1. Open `crm-admin.html` in Session E.
2. Wait for page load to settle.
3. Confirm whether the page:
   - redirects away
   - shows an access-denied state
   - incorrectly loads the CRM shell

Expected:

- non-admin access is blocked

Evidence:

- screenshot of the final state
- visible URL
- any auth or access network response

### A2. Admin shell load

1. Open `crm-admin.html` in Session A.
2. Wait for network to go idle.
3. Confirm the main shell loads.
4. Verify visible navigation for:
   - `Dashboard`
   - `Student Management`
   - `Courses & Classes`
   - `Enquiry`

Expected:

- shell loads without fatal console errors
- admin-only shell is visible

Evidence:

- screenshot of loaded shell
- response for the shell’s initial status/load call
- console check

## Section B: Facebook / Messenger Intake

### B1. Lead creation from Facebook source

1. In Session A, open `Enquiry`.
2. Click the new-lead action.
3. Enter realistic first-contact data only:
   - name or alias
   - Facebook handle if available
   - phone/email only if realistically known
   - `source = facebook`
4. Save the lead.

Expected:

- lead is created
- lead appears in the enquiry board and table
- stage defaults correctly

Evidence:

- screenshot of created lead
- network request to lead-create endpoint
- note on saved record shape

### B2. Refresh persistence check

1. Hard refresh the page.
2. Return to `Enquiry`.
3. Find the same lead again.

Expected:

- source and contact fields survive refresh

### B3. Intake gap check

Inspect whether the browser flow stores any Messenger context beyond:

- source
- Facebook handle
- generic notes

Record one classification:

- `PASS` if business context is meaningfully preserved
- `PARTIAL` if only basic attribution exists
- `N/A` if Messenger context is entirely off-platform

### B4. Negative intake checks

Run each one separately:

1. create a lead with no contact information
2. create a lead with Facebook handle only
3. create a lead without source
4. attempt a duplicate lead with same contact details

Expected:

- invalid cases are blocked or clearly handled
- duplicate behavior is observable and documented

## Section C: Lead Qualification and Counseling

### C1. Stage progression

1. Open the created lead.
2. Progress through:
   - `new`
   - `contacted`
   - `test_scheduled`
   - `test_completed`
   - `counseling`
3. Save each transition deliberately.

Expected:

- stage persists after each change

### C2. Task and activity tracking

1. Add one task for the lead.
2. Add one activity entry.
3. Refresh and reopen the lead.

Expected:

- task persists
- activity persists
- ownership or actor information is visible

### C3. Manual handoff detection

While moving through these stages, record whether the browser supports:

- Messenger follow-up context
- counselor notes
- manual reminder visibility
- teacher involvement before conversion

Mark each item as:

- `system-supported`
- `system-visible-but-external`
- `manual`

## Section D: Entrance Test

### D1. Entrance test generation

1. From the lead or student-linked flow, create an entrance test link.
2. Copy or open the generated public test URL.

Expected:

- link is created and usable

### D2. Public submission

1. Open the entrance test URL in a separate browser context.
2. Submit a realistic test attempt.
3. Finish the full public flow.

Expected:

- submission succeeds

### D3. Admin result visibility

1. Return to Session A.
2. Open the corresponding admin result view.
3. Confirm the submitted result appears.

Expected:

- result is visible in admin
- result can be tied to the original lead/student context

### D4. Negative entrance-test checks

Run if feasible:

1. reuse same test link after submission
2. open incomplete or abandoned test
3. try to find a lead with no linked test result

## Section E: Lead Conversion

### E1. Convert lead to student

1. In Session A, click the lead conversion action.
2. Wait for the student record to be created.

Expected:

- lead becomes `converted`
- student record is created

### E2. Conversion data integrity

Verify in the browser UI that these fields are preserved:

- acquisition source = `facebook`
- contact fields
- notes
- lead linkage

### E3. Conversion negative checks

Run if feasible:

1. try converting the same lead again
2. convert a lead with incomplete counseling context
3. convert an already-linked or duplicate contact

## Section F: Student Profile and Identity

### F1. Student profile completion

Open the student modal and complete:

- Info
- Learning Profile
- Student 360
- Identity
- Finance view inspection

Use realistic values for:

- target exam
- target score
- preferred schedule
- guardian contacts
- company contacts
- counseling notes

Expected:

- all edited sections persist after save and reopen

### F2. Identity linking

1. Generate class code.
2. Run handshake lookup with a real or seeded account.
3. If supported, force-link the account.

Expected:

- class code appears
- handshake preview resolves correctly
- linked UID list updates after confirmation

### F3. Identity negative checks

Run if feasible:

1. profile with no email
2. mismatched identity
3. repeat force-link
4. profile exists before auth account exists

## Section G: Course, Classroom, and Enrollment

### G1. Course setup

1. Open `Courses & Classes`.
2. Create or confirm the target course.
3. Reopen it and verify persistence.

### G2. Classroom setup

1. Create or select the target classroom.
2. Reopen classroom settings.
3. Confirm course linkage and classroom status.

### G3. Enrollment

1. Enroll Student 1 into the classroom.
2. Enroll Student 2 if needed for later attendance/submission comparisons.
3. Refresh and reopen the classroom.

Expected:

- enrollment appears in class management and membership-related views
- duplicate enrollment is blocked or deduped

## Section H: Schedule and Live-Class Readiness

### H1. Schedule configuration

1. Open the classroom schedule tab.
2. Add at least two schedule slots.
3. Include:
   - day
   - start time
   - end time
   - teacher
   - timezone
4. Save the schedule.

Expected:

- schedule persists
- calendar view reflects saved slots

### H2. Schedule calendar validation

1. Open `Schedule Calendar`.
2. Confirm the classroom schedule expands into visible events.
3. Open at least one event if the UI supports it.

Expected:

- calendar matches saved schedule

### H3. Live-class hosting readiness

Inspect these browser surfaces:

- `Zoom Links`
- `Schedule Calendar`
- `Class Management`

Answer explicitly from browser evidence:

- where is the meeting/join link stored
- how does the teacher know what to host
- how is class completion recorded
- what happens on last-minute schedule changes

Expected current-state interpretation:

- schedule is likely `PASS`
- live hosting is likely `PARTIAL` or `N/A`

## Section I: Attendance and Class Delivery

### I1. Attendance session creation

1. Open attendance for the classroom.
2. Create an attendance session for the scheduled date.

Expected:

- session is created successfully

### I2. Attendance record entry

1. Save a mix of:
   - `present`
   - `late`
   - `absent`
2. If available, set at least one intervention flag.

Expected:

- roster refreshes
- summary updates
- risk indicators update

### I3. Delivery proxy assessment

Determine whether the browser flow treats attendance as the practical proof that class was hosted.

Record:

- `PASS` if class completion is explicit
- `PARTIAL` if attendance acts as the operational proxy
- `N/A` if class delivery completion is not represented at all

### I4. Negative attendance checks

Run if feasible:

1. attendance for non-member
2. duplicate session same day
3. edit attendance after completion
4. student moved between classrooms

## Section J: Homework / Classwork Assignment

### J1. Announcement creation

1. In classroom management, create one announcement.
2. Refresh and reopen the classroom.

Expected:

- announcement persists in the classroom stream

### J2. Assignment creation

1. Create one assignment/classwork item.
2. Set due date and module if available.
3. Enable voice note only if part of your actual teaching flow.

Expected:

- assignment persists after reopen
- assignment is visible in the correct classroom sections

### J3. Student visibility

1. Open student-facing classroom view in Session C.
2. Confirm the assignment appears.

Expected:

- assignment is visible to student

### J4. Homework terminology check

Record whether the browser behavior for `classwork` actually matches your business meaning of:

- homework
- classwork
- announcement
- revision task

## Section K: Student Submission

### K1. Student submission flow

1. In Session C, open the assignment.
2. Submit using the expected format:
   - text
   - file
   - voice note if used
3. Wait for completion state to appear.

Expected:

- submission appears as turned in or equivalent

### K2. Admin review visibility

1. Return to Session A.
2. Open review board or submission list.
3. Confirm the student submission appears.

Expected:

- student, assignment, and status are visible

### K3. Student persistence check

1. Refresh Session C.
2. Reopen the student classroom/assignment view.

Expected:

- submission state persists

### K4. Negative submission checks

Run if feasible:

1. upload failure
2. duplicate submit
3. submit to wrong item
4. late submission
5. second attempt or resubmission path

## Section L: Assessment

### L1. Review board open

1. In Session A, open the review board.
2. Confirm pending and graded sections are visible if supported.

### L2. Grade the submission

1. Grade the student submission.
2. If the UI supports it, add feedback text.
3. Save the grade.

Expected:

- graded state persists
- student item moves to graded bucket or equivalent

### L3. Student graded-state check

1. In Session C, refresh the student classroom view.
2. Confirm the student can see graded status.

Expected:

- grade/status is visible to student

### L4. Negative assessment checks

Run if feasible:

1. missing student in review board
2. wrong item in queue
3. no way to distinguish latest vs older submission
4. feedback saved server-side but not shown in UI

## Section M: Homework Return and Revision Loop

### M1. Return with feedback

1. In Session A, attempt to return work instead of final-grading it.
2. If the UI does not expose a return action, stop and record the exact limitation.

Expected:

- either a real return workflow exists, or the absence is clearly documented as a product gap

### M2. Student returned-state check

1. In Session C, look for:
   - returned status
   - teacher feedback
   - revision required state

Expected:

- if implemented, returned state is visible to student
- if not implemented, record `FAIL` or `N/A`

### M3. Revision / resubmission

1. Attempt one revision and resubmission.
2. Confirm whether the browser supports the full loop.

Expected:

- current repo evidence suggests this may be unsupported or partial

## Final Browser Audit Wrap-Up

At the end of the run, produce these final outputs:

### 1. Stage result table

For each major stage, record:

- stage name
- result
- owner
- classification
- evidence link or filename

### 2. Defect summary

Group all failures into:

- broken in-browser
- partial/manual dependency
- missing browser feature
- data consistency issue

### 3. Workflow conclusion

Answer these final questions:

1. Can the workflow be completed end to end in-browser today?
2. Which exact stages still depend on off-platform work?
3. Which stages are misleading because the UI implies support but does not finish the workflow?
4. What is the highest-risk gap for real operations?

## Expected Current-State Risks To Watch For

These are the highest-probability browser findings based on current repo evidence:

- Facebook lead context is shallow beyond attribution fields
- live class hosting is not built into the product
- attendance likely acts as an operational proxy for class delivery
- classroom course data has one failing collection-contract baseline
- student submission flow is transitional
- return/revision homework flow is not implemented end to end
