# CRM Staff + Class Management Browser Test Plan (Chrome / Playwright)

This plan verifies the CRM admin staff surface and the class-management modal after the production-only error fixes:
- No automatic `http://localhost:11434` Ollama probe on production-like loads; use the authenticated Essay AI worker status endpoint instead
- No automatic `sync-from-prod` dev-tools fetches outside local runs
- Teacher list loads from `GET /api/admin/teachers`
- Teacher creation works from the Staff page
- Class-management teacher search and classroom save still work

## Preconditions
- Use Chrome only (`chromium`).
- Run from repo root: `C:\Cursor AI`.
- If you want to test the live CRM with real authentication, use `C:\Cursor AI\.local\browser-test-credentials.md` for the admin account.

## Automated Check

### 1) Staff + class-management browser check
- Command:
  - `node tests/browser/crm-staff-browser-check.js`
- Expected:
  - Passes in headless Chrome.
  - Loads `crm-admin.html#staff` on a production-like origin without requests to:
    - `http://localhost:11434/api/version`
    - `/api/admin/sync-from-prod/*`
  - Renders the staff teacher table from `GET /api/admin/teachers`.
  - Creates a teacher account with `POST /api/admin/teachers` and refreshes the list.
  - Opens `#courses/class-management`, loads classroom cards, and opens the classroom modal.
  - Fills the teacher search dropdown, selects a teacher, and saves the classroom with `PATCH /api/admin/classrooms/:classId`.
  - Exercises the Accounts table: search filtering, archive/restore via `PATCH /api/admin/accounts/:uid/status`,
    per-row delete via `DELETE /api/admin/accounts/:uid`, and select-all bulk delete via `POST /api/admin/accounts/bulk`.
  - Asserts the signed-in admin row exposes no selection checkbox (protected accounts cannot be bulk-targeted).

### 2) Accounts route guards (unit)
- Command:
  - `node tests/crm/accounts-role-management.test.js`
- Expected:
  - Promote/demote, archive/restore, delete and bulk routes all pass.
  - Bootstrap admin, self-mutation and still-admin deletion attempts are rejected with 403.

## Manual Checks

### 1) Staff page smoke
- Open:
  - `https://betterenglishlearning.com/crm-admin.html#staff`
- Expected:
  - The Staff panel loads.
  - The Ollama badge shows `Online (worker)` without a localhost CORS error.
  - Refreshing the badge re-checks `GET /api/admin/essay-ai/status`.
  - The console does not show `GET /api/admin/sync-from-prod/... 404`.
  - The teacher table shows at least one teacher row.

### 2) Teacher creation
- In Staff:
  - Fill email, display name, and temporary password.
  - Use `Generate`, `Show`, `Copy`, and `Create teacher`.
- Expected:
  - `Generate` fills a password.
  - `Show` toggles the password field type.
  - `Copy` copies the password.
  - The new teacher appears in the list after save.

### 3) Accounts cleanup and admin grants
- In Staff → Accounts:
  - Type part of a dummy email (e.g. `bel.audit`) in the search box.
  - Archive one row, switch the status filter to `Archived`, then restore it.
  - Tick several dummy rows and use the toolbar `Delete`.
  - Use `Grant admin` on a normal account, then `Revoke admin`.
- Expected:
  - Search narrows the table without losing focus between keystrokes.
  - Archived accounts leave the `Active` view, show an `Archived` badge under `Archived`, and cannot log in until restored.
  - Bulk delete removes only the ticked rows; the toolbar buttons are disabled when nothing is selected.
  - `huathanhnam95@gmail.com` and the signed-in admin show `Protected` with no checkbox.
  - An account holding admin shows a disabled `Delete` until admin access is revoked.

### 4) Class-management modal
- Open:
  - `#courses/class-management`
- Expected:
  - Classroom cards load.
  - The classroom modal opens for a classroom row.
  - The teacher search dropdown shows teacher names from `GET /api/admin/teachers`.
  - Selecting a teacher updates the hidden teacher UID field.
  - Saving the classroom refreshes the class list without console errors.
