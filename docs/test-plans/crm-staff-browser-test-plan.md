# CRM Staff + Class Management Browser Test Plan (Chrome / Playwright)

This plan verifies the CRM admin staff surface and the class-management modal after the production-only error fixes:
- No automatic `http://localhost:11434` Ollama probe on production-like loads
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

## Manual Checks

### 1) Staff page smoke
- Open:
  - `https://betterenglishlearning.com/crm-admin.html#staff`
- Expected:
  - The Staff panel loads.
  - The Ollama badge shows `Offline` without a localhost CORS error.
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

### 3) Class-management modal
- Open:
  - `#courses/class-management`
- Expected:
  - Classroom cards load.
  - The classroom modal opens for a classroom row.
  - The teacher search dropdown shows teacher names from `GET /api/admin/teachers`.
  - Selecting a teacher updates the hidden teacher UID field.
  - Saving the classroom refreshes the class list without console errors.

