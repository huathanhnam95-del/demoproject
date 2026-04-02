# CRM Student Deep-Link Browser Test Plan

## Scope

Validate the student deep-link workflow in `crm-admin.html` so each student profile is addressable by public `crmId` in the hash, not the internal Firestore document ID.

This plan focuses on browser-visible behavior plus the most important legacy-data edge cases:

- list click opens the correct student and updates the hash
- lead conversion opens the created student on a `crmId` route
- direct loads on `#students/<crmId>` resolve the correct profile
- closing the modal returns to the correct list route
- browser back/forward keeps modal state and hash in sync
- malformed, missing, duplicate, and legacy-case `crmId` values fail safely

## Preconditions

1. Start the local app and admin backend.
2. Use the admin login documented in [browser-test-credentials.md](C:/Cursor%20AI/.local/browser-test-credentials.md).
3. Prefer the local Playwright-based workflow first. Use Antigravity/browser-agent only as a second confirmation pass if needed.
4. Keep browser DevTools open on `Console` and `Network`.

## Seed Data

Prepare at least these records before running the plan:

1. `student-potential`
   Expected public ID: `a0001`
   Lifecycle stage: pre-enrollment or `potential`
2. `student-enrolled`
   Expected public ID: `a0002`
   Lifecycle stage: `enrolled`
3. `student-uppercase-legacy`
   Stored `crmId`: uppercase or non-canonical case variant such as `A0003`
4. `student-duplicate-a`
   Stored `crmId`: `a0004`
5. `student-duplicate-b`
   Stored `crmId`: `A0004` or another normalized duplicate
6. One lead that can be converted into a brand-new student

## Primary Flow

1. Log in as admin and open `https://localhost:8443/crm-admin.html#students/potential`.
   Expected: student list renders, no fatal console errors, and each row shows a public `CRM ID` column.

2. Click `student-potential`.
   Expected: student modal opens and the address bar becomes `#students/a0001`.

3. Confirm the student badge inside the modal shows `ID: a0001`.
   Expected: no internal Firestore doc ID is shown in the visible UI.

4. Close the modal.
   Expected: the hash returns to `#students/potential`.

5. Navigate to `https://localhost:8443/crm-admin.html#students/data`.
   Expected: enrolled/student-data list renders normally.

6. Click `student-enrolled`.
   Expected: student modal opens and the address bar becomes `#students/a0002`.

7. Close the modal.
   Expected: the hash returns to `#students/data`.

## Direct Deep-Link Load

1. Hard-load `https://localhost:8443/crm-admin.html#students/a0001`.
   Expected: the correct student profile opens immediately after app initialization.

2. Refresh the page while still on `#students/a0001`.
   Expected: the same student reopens and the UI remains usable after reload.

3. Close the modal after the direct load.
   Expected: pre-enrollment students fall back to `#students/potential`.

4. Hard-load `https://localhost:8443/crm-admin.html#students/a0002`.
   Expected: the enrolled student profile opens correctly.

5. Close the modal after the direct load.
   Expected: enrolled students fall back to `#students/data`.

## Lead Conversion

1. Open the lead workspace and convert the prepared lead.
   Expected: conversion succeeds, a student profile opens automatically, and the new hash uses the returned public `crmId`.

2. Refresh the page on the converted student route.
   Expected: the same converted student reopens correctly.

3. Close the modal.
   Expected: the shell returns to the lead/list context that opened the student, or to the correct student list fallback if the product intentionally routes that way.

## Navigation Sync

1. Open `student-potential` from the students list.
2. Use browser `Back`.
   Expected: modal closes and the hash returns to the prior students list route.

3. Use browser `Forward`.
   Expected: the same student modal reopens on the same `crmId` route.

4. Open `student-potential`, then quickly click `student-enrolled`.
   Expected: the second student remains open and no stale data from the first student overwrites the badge or form.

## New Student Flow

1. Click `New Student` from a non-profile route.
   Expected: modal opens without assigning a student hash yet.

2. Close the unsaved modal.
   Expected: the original page hash stays unchanged.

3. Open `New Student` again, enter minimum valid info, and save.
   Expected: the newly created profile receives a public `crmId` and the hash changes from the list route to `#students/<newCrmId>`.

4. Refresh the page on the new student route.
   Expected: the same student profile reopens successfully.

## Legacy And Error Cases

1. Hard-load `https://localhost:8443/crm-admin.html#students/a0003` for `student-uppercase-legacy`.
   Expected: the correct student opens even if the stored Firestore value started as uppercase.

2. Reopen the same legacy student from the students list and inspect the visible ID.
   Expected: the UI shows the canonical lowercase `crmId`.

3. Hard-load `https://localhost:8443/crm-admin.html#students/not-a-student`.
   Expected: the app does not open a random profile; it falls back safely to `#students/potential` and surfaces an error/toast.

4. Hard-load `https://localhost:8443/crm-admin.html#students/a9999` when no such student exists.
   Expected: safe fallback to a students list route with an error/toast.

5. Hard-load `https://localhost:8443/crm-admin.html#students/a0004` when duplicate normalized IDs exist.
   Expected: the app fails safely, does not pick one record arbitrarily, and returns to a safe list route with an integrity-style error.

6. Hard-load `https://localhost:8443/crm-admin.html#students/A0001`.
   Expected: the correct student still opens; the important requirement is successful resolution without opening the wrong profile.

## Compatibility Check

Run this only if you are validating fallback behavior against an older or partially upgraded backend.

1. Force the student list API path to fail or run against the older fallback path.
   Expected: the student table still shows the `CRM ID` column from Firestore data when available.

2. Click a student from that fallback-rendered list.
   Expected: the modal still resolves to the correct `crmId` route after the student detail fetch completes.

## Console And Network Checks

1. Confirm no uncaught console errors appear during:
   - initial load on a list route
   - initial load on a `crmId` route
   - modal close
   - back/forward navigation
   - lead conversion

2. Confirm these network behaviors:
   - list routes use the normal students list request
   - direct hash loads use the CRM-ID lookup route
   - existing-student saves continue to use internal `studentId` update routes
   - new-student saves return both internal `studentId` and public `crmId`

## Exit Criteria

- All deep-link open/close flows behave deterministically.
- No student profile route opens the wrong student.
- Duplicate or invalid `crmId` paths fail safely.
- Legacy uppercase `crmId` records are still reachable by deep link.
- Browser back/forward does not desynchronize the modal and the hash.
- No visible UI surfaces the internal Firestore doc ID as the public student identifier.
