# CRM Scheduling UI Redesign — Browser Test Plan (Chrome / Playwright)

This plan verifies the CRM admin shell regressions fixed during the scheduling UI redesign:
- UTF-8 text correctness (no mojibake)
- Correct default-hidden suggestion banner behavior
- Safe legacy deep-link routing from `#courses/classes` → Teacher Schedule
- Teacher Schedule interactions (place + reschedule + conflict guard)
- Classroom Scheduling modal flows remain functional

## Preconditions
- Use Chrome only (Playwright’s `chromium`).
- Run from repo root: `C:\Cursor AI`.
- Use the existing harness tests where possible (preferred), then do a light manual pass for visual sanity.

## Automated (Playwright) Checks

### 1) CRM shell static contract (HTML/JS/CSS correctness)
- Command:
  - `node tests/crm/crm-shell-static.test.js`
- Expected:
  - Passes.
  - Fails if any mojibake markers reappear in `public/crm-admin.html`.
  - Confirms the Teacher Schedule containers exist and legacy scheduler panel is not required.

### 2) Teacher Schedule browser check (end-to-end interactions)
- Command:
  - `node tests/browser/crm-scheduler-browser-check.js`
- Expected:
  - Passes.
  - Asserts all of:
    - Navigation uses `#courses/teacher-schedule`.
    - Class cards render under `#teacher-scheduler-class-list`.
    - Calendar slots render under `#teacher-scheduler-calendar`.
    - Placement mode places a session and logs `POST /api/teacher/classrooms/:id/sessions/add`.
    - Dragging a session pill to a safe slot logs `PATCH /api/teacher/sessions/:sessionId/reschedule`.
    - Dragging to a conflicting slot does not log reschedule and the pill stays put.

### 3) Entrance test result PDF export browser check (smoke)
- Command:
  - `node tests/browser/crm-entrance-test-result-pdf-browser-check.js`
- Expected:
  - Passes.
  - Confirms the PDF export produces a `.pdf` download in headless Chrome.

### 4) Full CRM verification sweep (optional but recommended before merge)
- Command:
  - `npm run lint:crm`
  - `npm run verify:crm`
- Expected:
  - Both pass.

## Manual Checks (Chrome)

### 1) Legacy deep-link redirect
- Open:
  - `crm-admin.html#courses/classes`
- Expected:
  - The hash canonicalizes to `#courses/teacher-schedule` without landing on a blank panel.

### 2) Suggestion banner default visibility
- Navigate:
  - Classroom Scheduling tab in CRM admin (`public/crm-admin.html`).
- Expected:
  - `#scheduling-suggestion-banner` is hidden on initial render.
  - When shown by `crm-admin.js` logic, it becomes visible via `style.display = 'flex'`.

### 3) UTF-8 text correctness
- Corruption markers (should NOT appear anywhere in CRM admin):
  - `ðŸ`, `â€¦`, `â†`, `â–`, `âœ`, `â€”`, `Â·`, `Ã…`, `�`
- Expected:
  - Characters render correctly (no mojibake / replacement characters).

### 4) Classroom Scheduling workflow sanity
- In a classroom modal:
  - Set schedule inputs (seed weekdays, session minutes).
  - Run preview/regeneration actions that rely on preserved form `id`s.
- Expected:
  - No console errors.
  - Preview/regeneration calls still bind correctly to the form elements.

