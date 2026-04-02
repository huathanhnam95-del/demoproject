# CRM Student Deep-Link Browser Test Plan

Date: 2026-04-02

## Goal

Validate that student profile deep-linking uses public `crmId` hashes, works from both student lists and direct URL entry, behaves correctly with browser navigation, and integrates correctly with the Enquiry (lead conversion) workflow.

This plan also verifies the recent optimizations:

- Uppercase hashes canonicalize to lowercase.
- Opening a student by `crmId` prefers cached list data (fewer API calls).
- Student list hydration is performant and stable in the live app.

## Scope

Target page:

- `https://localhost:8443/crm-admin.html`

In-scope routes:

- `#students/potential`
- `#students/data`
- `#students/<crmId>`
- `#enquiry`

## Preconditions

- Local server is running and reachable on `https://localhost:8443`.
- Use admin login from `C:\Cursor AI\.local\browser-test-credentials.md` (do not inline credentials into notes).
- Use a fresh browser context for each run to avoid stale cache/state.

## Phase 1: Live Delivery Sanity (Before UI)

1. Load `https://localhost:8443/crm-admin.html` (no hash).
   Expected:
   - HTTP 200
   - CRM admin page loads without a blank screen

2. Confirm CRM admin assets are versioned.
   Expected:
   - `crm-admin.js` and CRM `js/` assets are loaded with a consistent `?v=...` token

3. Confirm the backend route exists (auth-gated).
   Expected:
   - `GET https://localhost:8443/api/admin/students/by-crm-id/a0001` returns auth-gated response (typically 401 when not logged in), not router-level 404

## Phase 2: Students List UI (Potential + Data)

1. Navigate to `https://localhost:8443/crm-admin.html#students/potential`.
   Expected:
   - Students table renders
   - Table header includes `CRM ID`
   - Table cells show values like `a0001` and not internal Firestore IDs

2. Click a known student row from the list.
   Expected:
   - Student modal opens
   - URL hash becomes `#students/<crmId>` for that student
   - Badge shows `ID: <crmId>`

3. Close the student modal.
   Expected:
   - Hash returns to `#students/potential`

4. Navigate to `https://localhost:8443/crm-admin.html#students/data`.
   Expected:
   - Student Data table renders
   - Clicking any student opens modal and hash becomes `#students/<crmId>`

5. Close the student modal (opened from the data list).
   Expected:
   - Hash returns to `#students/data`

## Phase 3: Direct Deep-Link Load

1. Hard-load `https://localhost:8443/crm-admin.html#students/<existingCrmId>`.
   Expected:
   - Modal opens after initialization
   - Badge shows `ID: <existingCrmId>`

2. Refresh the page while on `#students/<existingCrmId>`.
   Expected:
   - Same student profile reopens
   - Hash remains `#students/<existingCrmId>`

3. Close the modal after a direct deep-link open.
   Expected:
   - Potential-stage students fall back to `#students/potential`
   - Enrolled-stage students fall back to `#students/data`

## Phase 4: Hash Compatibility and Safety

1. Uppercase hash canonicalization:
   - Load `https://localhost:8443/crm-admin.html#students/A0001` (or another valid uppercase CRM ID).
   Expected:
   - Modal opens to the correct student
   - Hash is canonicalized to lowercase `#students/a0001`
   - Press browser Back once.
   Expected:
   - The app returns to the prior route without getting stuck in a canonicalization loop
   - Modal and hash remain consistent (no rapid flicker between `A0001` and `a0001`)

2. Invalid student token:
   - Load `https://localhost:8443/crm-admin.html#students/not-a-student`
   Expected:
   - App does not blank out
   - Hash falls back to a safe list route (`#students/potential`)
   - Error toast may appear, but UI remains usable

3. Unknown CRM ID:
   - Load `https://localhost:8443/crm-admin.html#students/a9999`
   Expected:
   - Safe fallback to `#students/potential`
   - No incorrect student opens

4. Malformed hash shapes:
   - Load `https://localhost:8443/crm-admin.html#students/` (missing token)
   - Load `https://localhost:8443/crm-admin.html#students//` (empty token)
   - Load `https://localhost:8443/crm-admin.html#students/%20a0001` (leading whitespace)
   - Load `https://localhost:8443/crm-admin.html#students/a0001/` (trailing slash)
   Expected:
   - App stays usable and does not blank out
   - The router falls back safely to a list route (typically `#students/potential`)
   - It never opens the wrong student profile

## Phase 5: Enquiry Integration (Leads)

1. Navigate to `https://localhost:8443/crm-admin.html#enquiry`.
   Expected:
   - Leads list renders

2. Convert an unconverted lead:
   - Click `Convert` on a lead that is not yet converted.
   Expected:
   - Student modal opens automatically
   - Hash becomes `#students/<newCrmId>`
   - Badge shows `ID: <newCrmId>`

3. Close the student modal opened via conversion.
   Expected:
   - Hash returns to `#enquiry`

4. Converted lead click-through:
   - Click the name of a converted lead (shows `Converted` status).
   Expected:
   - Opens the linked student profile (modal)
   - Closing returns to `#enquiry`

## Phase 6: Navigation and Race Conditions

1. Back/Forward:
   - From `#students/potential`, click a student (hash becomes `#students/<crmId>`).
   - Press browser Back.
   Expected:
   - Modal closes
   - Hash returns to the previous list route

2. Forward:
   - Press browser Forward.
   Expected:
   - Same student reopens
   - Badge and form match that student

3. Rapid switch:
   - Open a student, then quickly open a second student (via hash change or list click after closing).
   Expected:
   - Final badge and form reflect the second student only
   - Late responses do not overwrite the active student

4. Hash-switch while modal is open:
   - Open a student from `#students/potential` so the modal is open on `#students/<crmIdA>`.
   - In the address bar, replace the hash with `#students/<crmIdB>` for another known student and press Enter.
   Expected:
   - The same modal view updates to the second student
   - The final hash remains `#students/<crmIdB>`
   - No stale fields from the first student remain visible after the second finishes loading

## Phase 7: Network Expectations (Optimization Verification)

Use DevTools Network panel (or Playwright HAR capture) during the steps above.

1. Cached deep-link open (after lists are loaded):
   - While on `#students/potential` (list has loaded), open a student by setting the hash to `#students/<crmId>` for a student visible in the list.
   Expected:
   - The app opens the modal quickly using cached list data
   - It should not require a `/api/admin/students/by-crm-id/<crmId>` call in the common case

2. Uncached deep-link open:
   - Open `#students/<crmId>` in a fresh context before lists have loaded.
   Expected:
   - One `/api/admin/students/by-crm-id/<crmId>` call happens
   - The modal still opens correctly

## Artifacts to Capture

- One screenshot of:
  - `#students/<crmId>` open with badge visible
  - `#enquiry` after closing a converted student (hash confirms return)
- Optional:
  - a screenshot of the canonicalization case (`#students/A0001` resolving to lowercase)
  - a screenshot of an invalid token fallback (`#students/not-a-student` returning to a list route)
- Optional: console error log export if any uncaught errors occur.

## Exit Criteria

The feature passes when all are true:

- Student modal hashes are always `#students/<crmId>` (not doc IDs)
- Uppercase hashes canonicalize to lowercase
- Invalid/unknown hashes fall back safely
- Enquiry convert opens student modal and closes back to `#enquiry`
- Clicking a converted lead name opens its student profile and closes back to `#enquiry`
- Back/Forward keep modal state and hash consistent
- Cached deep-link open does not require unnecessary `/by-crm-id/` calls in the common case
