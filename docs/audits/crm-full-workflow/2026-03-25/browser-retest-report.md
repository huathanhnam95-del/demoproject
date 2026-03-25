# CRM Browser Retest Execution Report

**Reviewer:** Codex
**Date:** 2026-03-25

## Test Target Environment
- **Worktree path:** `c:\Cursor AI`
- **Branch tested:** current workspace branch
- **Commit tested:** current workspace state
- **Base URL:** `http://127.0.0.1:8787`

## Corrected Diagnosis
- The active entrance-test link was not being reconstructed from persisted API data after refresh/reopen.
- The CRM UI now prefers `testLink` from `GET /api/admin/students/:studentId/entrance-tests` and only falls back to the in-memory cache for the current session.
- The backend persistence path was not the blocker for this regression.

## Verification Results

### Targeted Automated Checks
- `node tests/crm/local-admin-entrance-tests.test.js` - PASS
- `node tests/crm/crm-shell-static.test.js` - PASS
- `npm run lint:crm` - PASS
- `npm run smoke:entrance-test` - PASS

### Smoke Evidence
- `POST /students` created a smoke student successfully.
- `POST /students/:studentId/entrance-tests` returned a non-empty `testLink`.
- `GET /students/:studentId/entrance-tests` returned the active learner link before submit.
- `POST /submit` completed successfully.
- A follow-up `GET /students/:studentId/entrance-tests` showed the submitted state, and the session endpoint returned `410` after submission.

### Suite-Level Note
- `node scripts/crm/verify-crm-suite.js` still fails on an unrelated pre-existing contract assertion in `tests/crm/admin-router-contract.test.js`:
  - missing mounted route `POST /classrooms/:classId/submissions`

## Final View

### Result: PASS WITH EXTERNAL SUITE BLOCKER

The entrance-test refresh/reopen regression is fixed and verified by targeted tests, lint, and smoke.
The broader CRM verification suite still has an unrelated route-contract failure outside this change set.
