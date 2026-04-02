# CRM Student Deep-Link Live Fix Test Plan

Date: 2026-04-01

## Goal

Validate that the CRM student deep-link feature works in the real local environment and that the live-fix changes prevent the stale-runtime and stale-asset failures seen earlier.

This plan covers:

- source-level contract checks
- live server and asset delivery checks
- real browser behavior for student deep links
- regression checks for new-student and lead-conversion flows

## Scope

The test target is:

- `https://localhost:8443/crm-admin.html`

The feature is considered correct when:

- student profiles use public `crmId` values in the hash
- the visible UI shows `crmId`, not internal Firestore document IDs
- direct loads on `#students/<crmId>` resolve correctly
- the live app serves the versioned CRM admin assets
- the old `student-workspace.js` page include is no longer part of the CRM shell

## Preconditions

1. Start the local server with `node server.js`.
2. Use the admin login documented in [browser-test-credentials.md](/c:/Cursor%20AI/.local/browser-test-credentials.md).
3. Use a fresh browser context for every live run.
4. Confirm `https://localhost:8443` is the active app under test.
5. Keep DevTools `Console` and `Network` available during the browser pass.

## Seed Data

Prepare or identify these records before the browser pass:

1. One potential student with a known public ID such as `a0001`
2. One enrolled student with a known public ID such as `a0002`
3. One legacy uppercase CRM ID row such as stored `A0003`
4. One lead that can be converted into a new student
5. Optionally one duplicate-CRM-ID case for integrity handling such as `a0004` / `A0004`

## Phase 1: Source And Contract Verification

Run these local checks first:

1. `node tests/crm/crm-shell-static.test.js`
   Expected:
   - passes
   - CRM admin HTML requires a shared version token on local assets
   - CRM admin HTML does not include `js/crm/student-workspace.js`

2. `node tests/crm/student-route-deep-link.test.js`
   Expected:
   - passes
   - CRM-ID lookup route resolves known students
   - student creation returns `crmId`

3. `node tests/crm/business-id-service.test.js`
   Expected:
   - passes
   - uppercase and invalid legacy CRM IDs normalize or backfill correctly

4. `node tests/crm/backfill-student-crm-ids.test.js`
   Expected:
   - passes
   - backfill behavior remains safe and deterministic

5. `node tests/browser/crm-student-profile-hash-browser-check.js`
   Expected:
   - passes
   - direct deep-link open/close flow works in the harness
   - stale async student refreshes do not overwrite the active profile

## Phase 2: Live Server And Asset Delivery Checks

Verify the running `8443` server before opening the browser:

1. Confirm port binding:
   - check that one `node server.js` process is listening on `8443`

2. Confirm the CRM admin page is served from the updated HTML:
   - request `https://localhost:8443/crm-admin.html`
   Expected:
   - status `200`
   - HTML contains `crm-admin.js?v=20260401-crm-admin-livefix`
   - HTML contains the shared `?v=20260401-crm-admin-livefix` token on local CRM assets
   - HTML does not contain `student-workspace.js`

3. Confirm the CRM-ID route is mounted in the live backend:
   - request `https://localhost:8443/api/admin/students/by-crm-id/a0001` without auth
   Expected:
   - response is blocked by auth such as `401`
   - response is not router-level `404 NOT_FOUND`

If any Phase 2 check fails, restart the local server and repeat Phase 2 before opening the browser.

## Phase 3: Live Browser Verification

### Students List And Visible ID

1. Open `https://localhost:8443/crm-admin.html#students/potential`.
   Expected:
   - page loads successfully
   - no fatal console errors
   - student list renders
   - visible column label is `CRM ID`

2. Inspect at least one student row.
   Expected:
   - visible ID matches a public CRM ID format such as `a0001`
   - no internal Firestore document ID is shown in the visible table

### Student Open And Close Flow

1. Click the known potential student.
   Expected:
   - modal opens
   - hash changes to `#students/<crmId>`
   - badge shows `ID: <crmId>`

2. Close the modal.
   Expected:
   - hash returns to `#students/potential`

3. Repeat from `#students/data` with an enrolled student.
   Expected:
   - hash becomes `#students/<crmId>` on open
   - hash returns to `#students/data` on close

### Direct Deep-Link Load

1. Hard-load `https://localhost:8443/crm-admin.html#students/a0001`.
   Expected:
   - the correct student opens after app initialization
   - badge shows `ID: a0001`

2. Refresh while still on that route.
   Expected:
   - the same student reopens

3. Close the modal.
   Expected:
   - potential students fall back to `#students/potential`

4. Repeat with an enrolled student such as `#students/a0002`.
   Expected:
   - close falls back to `#students/data`

### New Student And Lead Conversion

1. Open `New Student` from a students list route.
   Expected:
   - unsaved modal does not claim a student hash yet

2. Close the unsaved modal.
   Expected:
   - original hash stays unchanged

3. Create a new student with minimum valid info.
   Expected:
   - save succeeds
   - hash changes to `#students/<newCrmId>`
   - badge shows the public `crmId`

4. Convert the prepared lead into a student.
   Expected:
   - converted student opens
   - hash becomes `#students/<crmId>`
   - badge shows the public `crmId`

### Navigation And Race Conditions

1. Open a student from the list, then use browser `Back`.
   Expected:
   - modal closes
   - previous list hash is restored

2. Use browser `Forward`.
   Expected:
   - the same student reopens

3. Open one student, then quickly click another student.
   Expected:
   - second student remains active
   - first student does not overwrite the badge or form after its late response returns

## Phase 4: Error And Compatibility Cases

1. Load `#students/not-a-student`.
   Expected:
   - app does not blank out
   - safe fallback to a students list route
   - error or toast is shown

2. Load an unknown CRM ID such as `#students/a9999`.
   Expected:
   - safe fallback
   - no wrong student opens

3. Load a legacy uppercase route such as `#students/A0003`.
   Expected:
   - correct student still opens
   - visible CRM ID is canonicalized in the UI

4. If duplicate normalized CRM IDs exist, load that route.
   Expected:
   - app fails safely
   - no arbitrary student is chosen

5. If the fallback student list path is exercised, inspect the table.
   Expected:
   - `CRM ID` column still renders when data is available

## Network And Console Expectations

During the browser pass, confirm:

1. No uncaught console errors during:
   - first list load
   - direct CRM-ID load
   - modal close
   - back/forward navigation
   - new-student save
   - lead conversion

2. Network behavior matches intent:
   - list views use the student list endpoint
   - direct hash loads use `/api/admin/students/by-crm-id/:crmId`
   - existing-student saves still use internal `studentId` update endpoints
   - new-student save responses include both `studentId` and `crmId`

## Exit Criteria

The live fix is accepted when all of these are true:

- source-level contract tests pass
- live server serves the versioned CRM admin shell
- live backend returns auth-gated behavior rather than router-level 404 for CRM-ID lookup
- visible UI consistently shows `crmId`
- student profile hashes consistently use `#students/<crmId>`
- direct-load, close, back, and forward flows stay in sync
- invalid, missing, uppercase, and duplicate CRM ID routes fail safely
