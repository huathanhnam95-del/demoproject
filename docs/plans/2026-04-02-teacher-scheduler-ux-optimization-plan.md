# Teacher Scheduler UX Optimization Plan (Google Calendar-Inspired)

Date: 2026-04-02

## Summary
Make teacher scheduling feel as fast and obvious as Google Calendar by shifting to a calendar-first workflow (click/drag on the grid to schedule, edit in-place, and simple recurrence controls), while keeping our non-negotiables: classroom-backed sessions, contracted limits, teacher-conflict checks, locked-session rules, and auditability.

This plan intentionally avoids the "freeform illusion": teachers still schedule sessions for an existing classroom. The goal is a lighter interaction model, not a looser data model.

Reference for interaction patterns (recurrence and edit scope): a Google Calendar advanced guide PDF. (Link: https://alfredmiller.weebly.com/uploads/2/0/7/4/20746434/google_calendar_advanced.pdf)

## Council Review Notes
The local council workflow was invoked to review feasibility and UX risk. It flagged two major risks that this plan addresses:
1. Hiding the current "Add vs Replace" complexity inside a tiny popover recreates the same modal, just smaller.
2. Real-time validation on every click/keystroke can break perceived speed; validation should be commit-driven with clear feedback and safe optimistic UI where possible.

## Key UX Changes (Teacher-Facing)

### 1) Teacher Schedule Mode (Simple, Focused)
Add a dedicated teacher route/view (for example `#courses/teacher-schedule`) that:
1. Defaults to current week.
2. Hides Teacher UID input and auto-scopes to the logged-in teacher.
3. Shows only classrooms where `primaryTeacherUid == currentUser.uid`.
4. Hides admin-only controls (Seed, Regenerate, Change Future Pattern).

Success criteria:
1. A teacher can schedule the whole week without typing IDs or navigating admin panels.

### 2) Slot-First "Quick Add" Popover (Primary creation path)
Clicking an empty calendar slot opens a small anchored popover with:
1. Classroom picker (searchable over already-loaded teacher classrooms).
2. Date + start time (editable inline).
3. Duration display (read-only, derived from schedule config).
4. Primary CTA: Add session.
5. Secondary CTA: Cancel.

Commit behavior:
1. Do not preview on every change.
2. On Add session, call the teacher-scoped add endpoint.
3. On error, show an inline message, keep popover open, and allow quick correction.

### 3) "Placement Mode" (Paint the week fast)
Clicking a classroom card toggles an "armed" state.
1. While armed, single-click empty slots places that classroom immediately (no popover).
2. Escape exits placement mode.
3. If placement fails, show a small toast plus an inline slot indicator and allow retry.

### 4) Weekly Pattern Builder (Google-like day chips, contract-driven end)
Add "Set weekly pattern" per class:
1. Day-of-week chips (Mon to Sun).
2. Start time.
3. Shows "Ends after X occurrences" read-only (computed from contract/admin schedule config).

CTA: Place this week
1. Creates sessions in the visible week on selected days.
2. Uses one multi-create request or a short sequential add sequence (implementation choice based on API readiness).

Teachers then use Activate recurrences to schedule the remaining contracted sessions.

### 5) Activate Recurrences (Step 2, one click)
Keep the global Activate recurrences as the second half of the workflow.
1. Add a persistent 2-step banner: Place this week then Activate recurrences.
2. After activation, show one compact summary (success, blocked, error) with an expandable details list of blocked classes and reasons.

### 6) Edit Sessions: Lightweight bubble + drag reschedule (this session only)
Clicking a session opens a small bubble with:
1. Class name, time range, unit label, lock status.
2. Actions: Open attendance, Cancel (if allowed), optional Duplicate (teacher quick make-up).

Dragging a session:
1. Optimistically moves the pill and shows a Saving state.
2. On rejection (conflict or locked), snap back and show a clear reason.

No series prompts for teachers. Drag/reschedule means this session only. Series-wide edits remain admin-only.

### 7) Conflict UX: Suggested Times v1 (local-only)
When add/reschedule fails due to teacher conflict:
1. Show 3 to 5 suggested open slots within the currently visible week.
2. Compute suggestions client-side using already-loaded sessions to avoid latency.

Defer server-side "find time across weeks" to a later phase.

## API / Backend (Teacher-scoped, keep admin APIs)
We will keep existing `/api/admin/*` endpoints and add teacher-scoped endpoints that wrap the same scheduling logic with strict authorization.

### Teacher endpoints
1. `GET /api/teacher/scheduler/workspace?from&to`
2. `POST /api/teacher/classrooms/:classId/sessions/add`
3. `PATCH /api/teacher/sessions/:sessionId/reschedule`
4. `POST /api/teacher/scheduler/activate-recurrences`
5. `POST /api/teacher/classrooms/:classId/sessions/add-multi` (for Place this week)

### Authorization rules
1. Teacher can only read classrooms where `primaryTeacherUid == auth.uid`.
2. Teacher can only add sessions for classrooms they own.
3. Teacher can only reschedule or cancel sessions where `teacherUid == auth.uid` and the session belongs to a classroom they own.
4. Locked or attendance-started sessions remain immutable.

### Performance rules
1. Workspace queries are bounded by date range (no "load everything then filter").
2. Teacher UI avoids preview calls except where the workflow truly requires it (Activate recurrences and any optional Replace panel).

## Replacement / Make-up (Optional in this phase)
If teachers must do make-up replacements:
1. Keep it out of the default add path.
2. Provide a separate "Make-up / Replace" action that opens a larger side panel (not the tiny popover).
3. Use existing replace-preview and replace commit logic.

If not required, keep replacement admin-only for this phase.

## Test Plan

### Unit/API tests
1. Teacher authorization: cannot read or mutate other teachers' classrooms and sessions.
2. Add and reschedule: conflict and locked-session checks block correctly with clear messages.
3. Weekly pattern add-multi: creates exactly N sessions, blocks conflicts deterministically.
4. Activate recurrences: deterministic per-class outcomes and stale version handling.

### Browser automation (Playwright)
1. Teacher mode loads auto-scoped, no Teacher UID typing.
2. Click slot -> popover -> add session.
3. Placement mode: arm class -> click multiple slots -> multiple sessions created.
4. Weekly pattern builder -> Place this week -> sessions appear.
5. Activate recurrences -> schedules remaining -> single summary shown.
6. Drag reschedule optimistic UI, revert on conflict.

## Assumptions / Defaults
1. Session duration and timezone are admin-controlled; teacher UI displays them read-only.
2. Teachers cannot create overflow sessions in this phase (blocked with actionable guidance).
3. Teacher reschedule is this session only; series-wide edits remain admin-only.

