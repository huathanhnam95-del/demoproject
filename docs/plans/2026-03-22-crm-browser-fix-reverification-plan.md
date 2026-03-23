# CRM Browser Fix Re-Verification Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Reverify, in the browser, that the recent CRM fixes are actually applied and that the previously reported browser defects no longer reproduce.

**Architecture:** Use a layered browser pass instead of one long ad hoc clickthrough. Start with a scripted browser run to catch shell/runtime regressions, then run focused manual browser checks for each fixed area: entrance-test handoff, live-session workflow, attendance/classroom fit guidance, and finance-to-delivery guidance. Finish with cleanup and evidence review.

**Tech Stack:** Local Node/Express server, Firebase Auth, Firestore-backed CRM admin shell, Playwright script in `tmp/crm-browser-walkthrough.js`, manual browser verification in Chrome or Edge.

---

## Scope

This plan rechecks only the browser-facing fixes from the latest debug batch:

1. CRM shell loads without the deleted-helper regressions
2. Entrance-test learner link stays visible after refresh until the test is used
3. Entrance-test handoff UI is clear:
   - visible latest link
   - `Copy` button
   - `Open` button
   - explanatory status note
4. Live-session browser workflow works:
   - create scheduled session
   - start session
   - end session
   - summary text updates correctly
5. Attendance workflow guidance is coherent during a live session
6. Classwork workflow guidance is coherent after the session ends
7. Attendance classroom-fit note renders without shell errors
8. Browser walkthrough no longer fails on the prior timeout path

## Out Of Scope

- Full non-browser automation coverage
- Environment provisioning for missing secrets like `FIREBASE_API_KEY`
- Teacher/student UAT beyond the browser admin flow
- New feature work

## Test Environment

Run in:

- worktree: `C:\Cursor AI\_worktrees\crm-workflow-fixes`
- branch/commit under test: current HEAD plus uncommitted fix batch
- local base URL: `http://localhost:8787`

Preconditions:

- local server can start
- Firebase admin bootstrap works locally
- admin test account can sign in
- test classroom exists
- at least one test student exists

## Required Artifacts

Capture these artifacts during the run:

- terminal output from `node tmp/crm-browser-walkthrough.js`
- screenshot of student modal state
- screenshot of classroom modal live-delivery state
- short note of console errors and page errors
- note of whether smoke live-session records were cleaned up after the run

## Pass Criteria

This browser re-verification passes only if all are true:

- scripted browser walkthrough exits `0`
- `consoleMessages` is empty
- `pageErrors` is empty
- entrance-test handoff controls are present in the DOM
- live summary moves through `scheduled` -> `live` -> `ended`
- attendance note shows the live-session next step while the session is live
- classwork note shows the post-session next step after the session ends
- no previous regression reappears:
  - missing helper crash
  - stale entrance-test link state
  - live-summary timeout
  - missing attendance fit guidance function

## Fail Criteria

Mark the run failed if any of these occur:

- CRM shell throws a runtime error during init
- student modal fails to open
- classroom modal fails to open
- entrance-test link is not visible after refresh while still active
- `Open` entrance-test button is missing or disabled with an active link
- live-session start or end succeeds server-side but summary text does not update
- browser walkthrough exits nonzero

## Task 1: Scripted Walkthrough Re-Run

**Files:**
- Run: `tmp/crm-browser-walkthrough.js`
- Evidence: `tmp/crm-browser-walkthrough-student.png`
- Evidence: `tmp/crm-browser-walkthrough-classroom.png`

**Step 1: Run the walkthrough**

Run:

```bash
node tmp/crm-browser-walkthrough.js
```

Expected:

- exit code `0`
- JSON output with:
  - `financeWorkflowBadge`
  - `liveSummaryScheduled`
  - `liveSummaryStarted`
  - `liveSummaryEnded`
  - `attendanceLiveNote`
  - `classworkLiveNote`
  - `consoleMessages: []`
  - `pageErrors: []`

**Step 2: Record the output**

Write down:

- whether `consoleMessages` is empty
- whether `pageErrors` is empty
- whether the live-session summaries contain:
  - `Session is scheduled`
  - `Session is live`
  - `Session has ended`

**Step 3: Verify artifacts exist**

Check:

```bash
dir tmp\\crm-browser-walkthrough-*.png
```

Expected:

- both screenshots exist

## Task 2: Manual Entrance-Test Handoff Check

**Files:**
- Review: `public/crm-admin.html`
- Review: `public/crm-admin.js`
- Review: `public/js/crm/student-modal.js`
- Review: `public/js/crm/student-workspace.js`

**Step 1: Open a student profile**

In browser:

- sign in as admin
- open `Student Data`
- open a student modal
- switch to `Learning Profile`

Expected:

- entrance-test panel is visible
- controls include:
  - `Add new test`
  - learner-link input
  - `Copy`
  - `Open`
  - status note

**Step 2: Create a new entrance test**

In browser:

- click `Add new test`

Expected:

- learner-link input is populated
- `Copy` is enabled
- `Open` is enabled
- note reads that the latest single-use link is ready to send

**Step 3: Refresh and re-open**

In browser:

- refresh the page
- reopen the same student
- return to `Learning Profile`

Expected:

- latest active learner link is still shown
- `Copy` is still enabled
- `Open` is still enabled
- entrance-tests table shows the active link

**Step 4: Optional used-link check**

If safe to consume a test link in this environment:

- submit the learner test once
- reopen the student

Expected:

- latest active-link field is empty
- note says the latest link has already been used and a new test is required

## Task 3: Manual Live-Delivery State Check

**Files:**
- Review: `public/js/crm/live-delivery.js`
- Review: `public/js/crm/classroom-workspace.js`
- Review: `public/js/crm/classroom-modal.js`

**Step 1: Open classroom live-delivery tab**

In browser:

- open `Courses` -> `Class Management`
- open a classroom
- switch to `Live Delivery`

Expected:

- live-session summary renders
- create/save/start/end controls are present

**Step 2: Create a scheduled session**

In browser:

- click `Create Session`
- fill:
  - title
  - start time
  - end time
  - join link
  - optional host link
- save

Expected:

- summary shows `scheduled`
- summary note says session is scheduled and should be started when class begins
- join link is visible
- `Start Live Session` enabled
- `End Session` disabled

**Step 3: Start the session**

In browser:

- click `Start Live Session`

Expected:

- summary shows `live`
- note says to take attendance and manage class from the Attendance tab
- `Start Live Session` disabled
- `End Session` enabled

**Step 4: End the session**

In browser:

- click `End Session`

Expected:

- summary shows `ended`
- note says to move to classwork and review submissions
- `End Session` disabled

## Task 4: Manual Attendance And Classwork Guidance Check

**Files:**
- Review: `public/js/crm/live-delivery.js`
- Review: `public/js/crm/classroom-workspace.js`

**Step 1: Check attendance during live session**

In browser:

- after starting a live session, switch to `Attendance`

Expected:

- attendance note reads: `Take attendance and manage class while the session is live.`
- no console errors

**Step 2: Check classroom-fit guidance**

In browser:

- if a student option is available, select it

Expected:

- fit note renders
- no runtime error

If no student option is available:

- record that the classroom has no active roster
- note that this is acceptable only if no page error occurs

**Step 3: Check classwork after ending session**

In browser:

- after ending the session, switch to `Classwork`

Expected:

- note reads: `Live session ended. Next step: assign homework and review student submissions.`

## Task 5: Cleanup

**Files:**
- Data cleanup only

**Step 1: Remove smoke live sessions**

Delete any live-session records created with titles starting with:

- `[Smoke] Live Session`

Expected:

- no smoke session records remain in the test classroom

**Step 2: Record final evidence**

Collect:

- walkthrough terminal output
- screenshots
- console/page error summary
- cleanup confirmation

## Suggested Evidence Log Format

Use this format for the final note:

```markdown
## Browser Reverification Result

- Walkthrough: PASS | FAIL
- Console errors: none | list
- Page errors: none | list
- Entrance-test handoff: PASS | FAIL
- Live-delivery states: PASS | FAIL
- Attendance guidance: PASS | FAIL
- Classwork guidance: PASS | FAIL
- Cleanup: PASS | FAIL

Notes:
- ...
```

## Expected Current Result

If the fix batch is still intact, the expected result is:

- browser walkthrough passes
- no console/page errors
- entrance-test link handoff remains visible until consumed
- live-delivery transitions render correctly
- attendance fit guidance no longer crashes the shell

## Known Environment Caveat

The separate entrance-test smoke script still requires `FIREBASE_API_KEY` for full execution. That is not part of this browser-only plan.
