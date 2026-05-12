# Practice Dashboard URL Regression — Browser Test Plan (Chrome / Playwright)

This plan verifies the dashboard no longer auto-rewrites the URL to a question deep-link (for example, `.../practice/speaking/describe-image/1`) when the UI is still on the dashboard.

## Preconditions
- Use Chrome only (Playwright’s `chromium`).
- Run from repo root: `C:\Cursor AI`.

## Automated (Playwright) Check

### 1) PracticeRouter back/popstate regression suite
- Command:
  - `node tests/browser/practice-router-back-popstate-browser-check.js`
- Expected:
  - Passes.
  - On initial dashboard load, `window.location.pathname` is NOT a mode deep-link like `/practice/<skill>/<mode>` or `/pte-practice/<skill>/<mode>`.
  - Back/forward works between modes without unexpected URL rewrites.

## Manual Checks (Chrome)

### 1) Root URL stays on dashboard
- Open:
  - `https://betterenglishlearning.com/`
- Expected:
  - Dashboard UI is visible (Choose a Skill / launcher cards).
  - URL stays at `/` or the dashboard route (for example `/practice`), and does NOT jump to `/practice/<skill>/<mode>/<id>`.

### 2) Dashboard does not deep-link while idle
- From the dashboard (without clicking any mode):
  - Wait ~5–10 seconds.
- Expected:
  - URL does not change into a question deep-link (guards against background mode scripts calling `PracticeRouter.replaceRoute()`).

### 3) Deep-link still works when explicitly visited
- Open:
  - `https://betterenglishlearning.com/practice/speaking/read-aloud/1019`
- Expected:
  - Read Aloud mode loads (not the dashboard).
  - Refresh keeps you on the same deep-link.

### 4) Return to dashboard uses dashboard route
- From any practice mode:
  - Click the in-app Back to Dashboard control.
- Expected:
  - Dashboard UI is visible.
  - URL becomes the dashboard route (for example `/practice`), not a question deep-link.

