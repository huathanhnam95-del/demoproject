# CRM Browser Test Fixes Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Fix the P0 browser test blockers (A1, J3) and close the highest-signal P1 gaps (C1, E2) so the end-to-end CRM to student homework loop can be re-tested successfully.

**Architecture:** Add a student-safe classroom listing/read path (API-first), align student UI to the returned contract (`id`), and harden admin status resolution so deployments cannot accidentally grant admin access by default. Close conversion integrity gaps by explicitly propagating lead contact/source fields into the created or reused student record and by surfacing `acquisitionSource` in the student UI.

**Tech Stack:** Node.js (Express), Firebase Admin SDK (Firestore/Auth), Firebase web compat SDK (Auth/Firestore) in static admin/student pages, existing CRM router in `functions/src/routes/admin/create-crm-router.js`.

---

## Scope (From March 16, 2026 Browser Report)

Primary inputs:
- Browser report: `C:\\Users\\Admin\\.gemini\\antigravity\\brain\\2b3e886d-d80d-44f4-8ba2-b443639be0f5\\walkthrough.md.resolved`
- Evidence screenshots in the same directory (A1, J3, etc.)

Fix targets:
- **P0 J3** student classroom empty (blocks submissions, grading, revision loop)
- **P0 A1** admin access control confusion/risk (verify + harden)
- **P1 E2** conversion loses source/facebook in reviewer perception (likely missing UI + partial merge)
- **P1 C1** stage progression shows misleading “fill contact field” error (repro + fix or SOP correction)

Non-blocking, optional backlog:
- B4 duplicate detection / name/source validation (P2)
- H3 Zoom links and I3 “class completed” marker (P3)

---

## Task 1: Fix Student Classroom Visibility (J3)

**Files:**
- Modify: `C:\\Cursor AI\\public\\js\\classroom-api.js`
- Modify: `C:\\Cursor AI\\public\\js\\classroom.js`
- Create: `C:\\Cursor AI\\src\\middleware\\require-auth.js`
- Create: `C:\\Cursor AI\\src\\routes\\classrooms.js`
- Modify: `C:\\Cursor AI\\src\\server\\app.js`
- Test (static contract): `C:\\Cursor AI\\tests\\crm\\student-classroom-contract.test.js`

**Step 1: Write failing contract test (student code must not call admin classrooms endpoint)**

Create `tests/crm/student-classroom-contract.test.js` asserting:
- `public/js/classroom-api.js` references `GET /api/classrooms`
- `public/js/classroom-api.js` does not use `GET /api/admin/classrooms` as the student default
- `public/js/classroom.js` accepts both `id` and `classroomId` (to prevent future mismatch regressions)

Run: `node tests/crm/student-classroom-contract.test.js`
Expected: FAIL (current code uses `/api/admin/classrooms` and assumes `c.id`)

**Step 2: Add generic auth middleware for student endpoints**

Create `src/middleware/require-auth.js`:
- Verify `Authorization: Bearer <idToken>` via `admin.auth().verifyIdToken(idToken, true)`
- Set `req.user = decodedToken`
- Return `401 UNAUTHORIZED` on missing/invalid token

Run: `node -c src/middleware/require-auth.js`
Expected: exit code 0

**Step 3: Add student classrooms route**

Create `src/routes/classrooms.js` (Express router):
- `GET /classrooms`
  - Require auth via `require-auth`
  - Query `crmEnrollments` by `studentUid == req.user.uid` and status in `active` (and optionally `trial`)
  - Fetch each `crmClassrooms/{classId}` doc
  - Return a normalized list with stable keys:
    - `id` (classId), `name`, `courseId`, `status`, `schedule`
  - Always return `{ success: true, classrooms: [] }` when none

Note: Keep contract aligned with student UI expectations by returning `id`, even if internal admin APIs use `classroomId`.

**Step 4: Mount the student classrooms route**

Modify `src/server/app.js` to mount:
- `app.use('/api', routes.classroomsRoutes)` (create this in the `routes` default map)

Run (smoke): start server and fetch:
- `node server.js`
- In another shell: `powershell -c \"(Invoke-WebRequest -UseBasicParsing https://localhost:8443/api/health).StatusCode\"`
Expected: `200`

**Step 5: Update the student ClassroomAPI to use the new endpoint**

Modify `public/js/classroom-api.js`:
- Change `fetchClassrooms()` to call `GET /api/classrooms` (student-safe)
- Keep admin usage separate by introducing `fetchAdminClassrooms()` if the admin UI still needs `GET /api/admin/classrooms`

**Step 6: Make classroom.js resilient to ID shape**

Modify `public/js/classroom.js`:
- When rendering the class switcher, use `const classId = c.id || c.classroomId`
- When choosing a default class, set `activeClassId` from that resolved ID

**Step 7: Re-run the contract test**

Run: `node tests/crm/student-classroom-contract.test.js`
Expected: PASS

**Step 8: Manual browser verification for J3**

Using `https://localhost:8443/classroom.html`:
- Log in as the enrolled student (linked UID)
- Confirm the class switcher is populated
- Confirm Stream shows the announcement from J1
- Confirm Todo/Classwork lists the assignment from J2

Expected: J3 becomes PASS and K/L/M are unblocked for re-test.

---

## Task 2: Harden Admin Status Handling and Re-Validate A1

**Files:**
- Modify: `C:\\Cursor AI\\functions\\src\\routes\\admin\\create-crm-router.js`
- Modify: `C:\\Cursor AI\\src\\routes\\admin.js`
- Test: `C:\\Cursor AI\\tests\\crm\\admin-status-security.test.js` (new)
- Optional UI clarity: `C:\\Cursor AI\\public\\crm-admin.js` (show current user email in header, add logout)

**Step 1: Write failing test for “safe default” when resolveAdminStatus is missing**

Create `tests/crm/admin-status-security.test.js` that constructs `createCrmRouter()` with:
- `authMiddleware` stub that sets `req.user = { uid, email }` and calls `next()`
- No `resolveAdminStatus` provided
- `sendSuccess` / `sendError` stubs capturing status code and payload

Then call the `/status` handler and assert:
- Response is `403 FORBIDDEN` (not admin) by default
- No attempt is made to write admin flags to Firestore in the “missing resolver” case

Run: `node tests/crm/admin-status-security.test.js`
Expected: FAIL (current default resolver returns `isAdmin: true` and attempts to write `users/{uid}.isAdmin = true`)

**Step 2: Change create-crm-router default resolver to deny-by-default**

Modify `functions/src/routes/admin/create-crm-router.js`:
- If `deps.resolveAdminStatus` is not supplied:
  - Return `{ isAdmin: false, uid, email, bootstrapped: false }`
  - Do not write to Firestore

This prevents accidental “everyone is admin” deployments.

**Step 3: Make local server explicitly resolve admin status**

Modify `src/routes/admin.js` (local HTTPS server wiring):
- Provide `resolveAdminStatus` that returns admin=true when `authMiddleware` already passed.
  - Example: `({ req }) => ({ isAdmin: true, uid: req.user.uid, email: req.user.email, bootstrapped: false })`

This keeps `localhost:8443` working while removing the insecure default behavior.

**Step 4: Re-run tests**

Run:
- `node tests/crm/admin-status-security.test.js`
- `node tests/crm/admin-router-contract.test.js`

Expected: PASS

**Step 5: Re-run the A1 scenario correctly (avoid false positives)**

Manual procedure:
- Use an incognito profile or clear site data for `https://localhost:8443`
- Visit `https://localhost:8443/crm-admin.html`
Expected:
- Not logged in: gate message appears and redirects to `index.html`
- Logged in as a non-admin (different email): gate shows “Access denied” then redirects

Optional usability fix:
- Add a visible “Logged in as <email>” label and a Logout button to reduce test confusion.

---

## Task 3: Fix Conversion Data Integrity Perception (E2)

**Files:**
- Modify: `C:\\Cursor AI\\functions\\src\\routes\\admin\\leads.js`
- Modify: `C:\\Cursor AI\\public\\crm-admin.html`
- Modify: `C:\\Cursor AI\\public\\crm-admin.js`
- Modify: `C:\\Cursor AI\\public\\js\\crm\\students.js`
- Test: `C:\\Cursor AI\\tests\\crm\\lead-service.test.js` (extend)

**Step 1: Extend tests to assert conversion carries acquisition + facebook**

In `tests/crm/lead-service.test.js`, add assertions for `buildLeadConversion()`:
- `student.acquisitionSource === lead.source`
- `student.facebook === lead.facebook`

Run: `node tests/crm/lead-service.test.js`
Expected: PASS already for the pure service layer, but keeps future regressions out.

**Step 2: Ensure conversion updates reused student with missing contact fields**

In `functions/src/routes/admin/leads.js`, in the `existingStudentId` reuse branch:
- When setting fields on the existing student, also merge:
  - `facebook` (and optionally `phone`, `zalo`, `label`, `name`) when missing on the student record
- Keep “do not overwrite non-null student fields” behavior to avoid clobbering edits

**Step 3: Surface acquisitionSource in Student Info UI**

Modify student modal:
- Add an “Acquisition Source” field in `public/crm-admin.html` Info tab
- Update `public/js/crm/students.js`:
  - Include `acquisitionSource` in payload builder
  - Populate the input on modal open

**Step 4: Manual verification**

Run conversion path again:
- Create lead with `source=facebook` and `facebook=@handle`
- Convert to student
- Confirm Student Info shows the facebook handle and acquisition source

---

## Task 4: Reproduce and Resolve Stage Progression Error (C1)

**Files:**
- Likely modify: `C:\\Cursor AI\\public\\crm-admin.js`
- Optional modify: `C:\\Cursor AI\\functions\\src\\routes\\admin\\leads.js`
- Doc update: `C:\\Cursor AI\\docs\\audits\\2026-03-16-crm-full-workflow\\workflow-review-runbook.md`

**Step 1: Reproduce with DevTools Network**

In `crm-admin.html`:
- Use the lead table stage dropdown + Update button
- Confirm request is `PATCH /api/admin/leads/:leadId` with body `{ stage: "..." }`

If the observed request is instead `POST /api/admin/leads`, the issue is user flow confusion or UI wiring, not backend patching.

**Step 2: Fix based on observed root cause**

Possible outcomes:
- If PATCH is correct and backend returns a validation error:
  - Capture response JSON and map to server code path
  - Add a targeted guard in `functions/src/routes/admin/leads.js` to return a clearer message for stage-only patch failures
- If the UI is calling lead creation (POST) during stage updates:
  - Fix event wiring so stage updates never go through `saveLead()` validations
- If this is an SOP confusion:
  - Update the runbook to specify the supported stage progression UI and the correct operator steps

---

## Task 5: Retest the Full Flow

**Files:**
- Use existing plan: `C:\\Cursor AI\\docs\\audits\\2026-03-16-crm-full-workflow\\browser-test-plan.md`
- Optional update: `C:\\Cursor AI\\docs\\audits\\2026-03-16-crm-full-workflow\\findings-log.md`

**Step 1: Automated sanity**

Run:
- `node tests/crm/collection-contracts.test.js`
- `node scripts/crm/run-workflow-review-baseline.js`

Expected: PASS

**Step 2: Manual browser re-run (focus on previously blocked sections)**

Re-run:
- A1 (incognito, logged out, non-admin logged in)
- J3 (student sees class + assignment)
- K/L/M (submission, grading, returned feedback, resubmission)

Expected: K/L/M no longer BLOCKED.

