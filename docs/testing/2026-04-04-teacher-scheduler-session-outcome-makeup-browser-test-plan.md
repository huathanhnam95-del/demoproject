# Teacher Scheduler Session Outcome (Make-up) Browser Test Plan (Chrome)

## Scope

Validate the teacher-side session outcome controls in `crm-admin.html#courses/teacher-schedule` and confirm they correctly affect the contracted recurrence count:

- `Completed` counts toward the contract target.
- `Absent (counts)` counts toward the contract target (student absent but still counts as a finished recurrence).
- `Absent (make-up)` does **not** count toward the contract target and should create a replacement recurrence after the last contracted session.
- `Cancelled` (teacher cancels the session) does **not** count toward the contract target and should create a replacement recurrence after the last contracted session.

This plan also validates the "next weekday in the schedule" behavior for a Tue/Wed/Sat pattern: when a contracted session stops counting, the replacement session should land on the next valid weekday after the previously-last session (Sat -> Tue).

## Browser

- Chrome only.

## Preconditions

1. Start the local app at `https://localhost:8443`.
2. Log in using the admin account in [browser-test-credentials.md](C:/Cursor%20AI/.local/browser-test-credentials.md).
3. Prefer the local Playwright workflow first (for faster repro and screenshots). Use Antigravity/browser-agent only as a second confirmation pass if needed.
4. Keep Chrome DevTools open on `Console` and `Network` during the steps below.

## Test Data Setup (One-Time Per Run)

Create a brand-new classroom owned by the logged-in user (so the teacher scheduler workspace can scope correctly).

Required classroom schedule config:

- Timezone: `Asia/Bangkok` (or your normal teacher scheduler timezone, but keep it consistent for the whole run)
- Session length: `120` minutes (2pm-4pm)
- Contract target session count: `9`

You can create the classroom either via the CRM UI (Class Management) or any existing seeding workflow you use for teacher scheduler checks.

## Date Range And Expected Occurrences

Use this exact date window so the 9 occurrences are deterministic:

- From: `2026-04-06`
- To: `2026-04-26`
- Pattern weekdays: Tue, Wed, Sat
- Start time: `14:00`
- Duration: 120 minutes

Expected 9 contracted occurrences (local date, 14:00 start):

1. Tue `2026-04-07`
2. Wed `2026-04-08`
3. Sat `2026-04-11`
4. Tue `2026-04-14`
5. Wed `2026-04-15` (this is the session we will mark as Completed/Absent/Cancelled)
6. Sat `2026-04-18`
7. Tue `2026-04-21`
8. Wed `2026-04-22`
9. Sat `2026-04-25` (baseline "last class")

If a contracted session is marked `Cancelled` or `Absent (make-up)` (does not count), the replacement session should appear on:

- Tue `2026-04-28` at `14:00` (Sat -> Tue)

## Baseline: Create The 9 Occurrences

1. Open `https://localhost:8443/crm-admin.html#courses/teacher-schedule`.
   Expected: the teacher scheduler workspace loads and at least one classroom card appears in the left rail.

2. Set `#teacher-scheduler-from-date` to `2026-04-06`, set `#teacher-scheduler-to-date` to `2026-04-26`, then click `#btn-teacher-scheduler-refresh`.
   Expected: the calendar grid refreshes for the selected window.

3. In the weekly pattern panel, select the new classroom in `#teacher-scheduler-pattern-class`, set `#teacher-scheduler-pattern-time` to `14:00`, select only Tue/Wed/Sat in `#teacher-scheduler-pattern-days`, then click `#btn-teacher-scheduler-place-week`.
   Expected: 9 session pills exist on the expected dates/times above, the classroom card meta shows `9/9 contracted scheduled`, and there is no session on Tue `2026-04-28` yet.

4. Click the Wed `2026-04-15` 14:00 session pill to open the session bubble.
   Expected: bubble meta includes `2026-04-15` and `Unit 5` (or the 5th contracted unit label), and `#teacher-scheduler-session-outcome` is editable.

## Case A: Completed (Counts)

1. In the session bubble for Wed `2026-04-15`, set `#teacher-scheduler-session-outcome` to `Completed`.
2. Click `#btn-teacher-scheduler-save-outcome`.
   Expected: toast shows "Outcome saved.", the classroom card meta remains `9/9 contracted scheduled` (no extension required), and no new session appears on Tue `2026-04-28`.

## Case B: Absent (Counts)

Run this case on a fresh classroom run (recommended), or reset outcomes before continuing.

1. Open the session bubble for Wed `2026-04-15`.
2. Set `#teacher-scheduler-session-outcome` to `Absent (counts)`.
3. Click `#btn-teacher-scheduler-save-outcome`.
   Expected: the classroom card meta remains `9/9 contracted scheduled`, and no new session appears on Tue `2026-04-28`.

## Case C: Absent (Make-up) (Does Not Count, Adds Replacement)

Run this case on a fresh classroom run (recommended), or reset outcomes before continuing.

1. Open the session bubble for Wed `2026-04-15`.
2. Set `#teacher-scheduler-session-outcome` to `Absent (make-up)`.
3. Click `#btn-teacher-scheduler-save-outcome`.
   Expected: the classroom card meta drops to `8/9 contracted scheduled` (one unit no longer counts).

4. Click `#btn-teacher-scheduler-activate-recurrences`.
   Expected: the activation summary (`#teacher-scheduler-activation-summary`) indicates a created session for this classroom.

5. Expand the window to verify the replacement session exists: set `#teacher-scheduler-to-date` to `2026-05-03`, then click `#btn-teacher-scheduler-refresh`.
   Expected: a new session pill exists on Tue `2026-04-28` at `14:00` for the same classroom, and the classroom card meta returns to `9/9 contracted scheduled`.

## Case D: Cancelled (Teacher Cancel, Does Not Count, Adds Replacement)

Run this case on a fresh classroom run (recommended), or reset outcomes before continuing.

1. Open the session bubble for Wed `2026-04-15`.
2. Click `#btn-teacher-scheduler-cancel-session`.
   Expected: toast shows "Session cancelled.", if you reopen the bubble on that session then `#teacher-scheduler-session-outcome` is disabled and the lock label reads "Outcome locked.", and the classroom card meta drops to `8/9 contracted scheduled`.

3. Click `#btn-teacher-scheduler-activate-recurrences`.
   Expected: the activation summary shows a created session for this classroom.

4. Expand the window and refresh: set `#teacher-scheduler-to-date` to `2026-05-03`, then click `#btn-teacher-scheduler-refresh`.
   Expected: a new session pill exists on Tue `2026-04-28` at `14:00` for the same classroom, and the classroom card meta returns to `9/9 contracted scheduled`.

## Console And Network Checks

1. Confirm there are no uncaught console errors during placing the weekly pattern, saving outcomes, cancelling a session, activating recurrences, and refreshing after extending the date window.

2. Confirm the expected API calls occur: outcomes use `POST /api/teacher/sessions/:sessionId/outcome`, cancelling uses `POST /api/teacher/sessions/:sessionId/cancel`, and activation uses `POST /api/teacher/scheduler/activate-recurrences`.

## Exit Criteria

- `Completed` and `Absent (counts)` do not change the contracted assigned count and do not create a replacement session.
- `Absent (make-up)` and `Cancelled` reduce contracted assigned count by 1, then `Activate recurrences` creates exactly one replacement session.
- For the Tue/Wed/Sat pattern above, the replacement lands on Tue `2026-04-28` 14:00 (Sat -> Tue).
- No uncaught console errors, and API failures (if any) are surfaced as a user-visible toast rather than silent failure.
