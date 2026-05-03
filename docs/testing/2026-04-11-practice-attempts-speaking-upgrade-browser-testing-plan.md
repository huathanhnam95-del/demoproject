# Practice Attempts (Speaking Attempts Upgrade) Browser Testing Plan (Chrome Only)

Date: 2026-04-11  
Primary APIs: `functions/src/routes/practice-attempts.js`, `functions/src/routes/shared-practice-attempts.js`

This plan validates the "practice attempts" speaking subsystem end-to-end in the browser (Chrome only), including:
- Auth gating (guests cannot submit; logged-in users can)
- Prepare idempotency and mode constraints
- Upload contract expectations (canonical Storage paths + awaiting/submitted states)
- Complete validation (WAV content type, size, duration caps)
- Bookmarking + cap enforcement (5 bookmarks for non-students)
- Share create/revoke + public shared view privacy contract
- Feedback lifecycle (prepare, complete, list, edit, delete)
- Retention behavior differences (student vs non-student TTL rules) at the API level

Mode caps (server hard max seconds, and UI display):
- `read_aloud`: hard max 40s, UI 40s
- `repeat_sentence`: hard max 15s, UI 15s
- `retell_lecture`: hard max 45s, UI 40s
- Unknown valid mode: hard max 60s, UI 60s

Notes:
- Plan is written for local dev (`npm run dev`) with Firebase emulators.
- Storage reads should remain denied by rules; audio playback in UI relies on signed read URLs returned by server endpoints.
- Some steps use DevTools console snippets to exercise authenticated API calls directly if the UI does not yet expose all flows.

## Prerequisites
- Install deps: `npm install`
- Start app + emulators: `npm run dev`
- Open app: `https://localhost:8443`
- If any browser checks require login, use `C:\Cursor AI\.local\browser-test-credentials.md` (do not inline credentials in docs or commits).
- Optional: seed emulator admin identity and `/users/{uid}` doc:
  - `node scripts/seed-emulator-admin.js`
  - This script expects environment variables set for the emulator admin (see script header and `.env` usage).

## Test Personas
- Guest: not logged in.
- Logged-in non-student: any authenticated account without linked CRM student access.
- Logged-in student: authenticated account linked to a CRM student with an active access window.
- Teacher/admin reviewer: authenticated account with one of:
  - Custom claim `isAdmin` or `isTeacher`, or
  - Firestore `/users/{uid}` doc `isAdmin: true` or `crmRole: "teacher"`

Tip: Use Firebase Emulator UI (`http://localhost:4000`) for quick inspection and doc edits:
- Firestore: `speakingAttempts`, `speakingAttemptShares`, `speakingAttemptCounters`, `speakingAttemptEvents`
- Subcollections: `speakingAttempts/{attemptId}/feedback`

## Quick Preflight (Non-browser, Fast Regression)
Run these before doing any manual browser work:
```powershell
node tests/practice-attempts-router-contract.test.js
node tests/practice-attempts-share-contract.test.js
node tests/practice-attempts-shared-privacy-contract.test.js
node tests/practice-attempts-constraints-contract.test.js
node tests/practice-attempts-auth-limiter-contract.test.js
node tests/practice-attempts-storage-rules.test.js
```

## Pass A: Playwright (webapp-testing workflow, Chrome-only)
Goal: catch regressions quickly and validate security/contract behavior without depending on real microphone input.

Run existing generic smoke checks first:
```powershell
node tests/browser/practice-modes-browser-check.js
node tests/browser/practice-scope-toggle-browser-check.js
node tests/browser/practice-scope-logged-in-browser-check.js
```

Recommended new checks to add (if we want repeatable automation for this feature):

### A1. Practice Attempts API smoke (logged-in)
Create a new script (recommended name):
- `tests/browser/practice-attempts-api-browser-check.js`

Script behaviors:
1. Launch Chromium with `ignoreHTTPSErrors: true`.
2. Login using the helper in `tests/browser/helpers/browser-test-credentials.js`.
3. In page context, run authenticated `fetch` calls:
   - `POST /api/practice-attempts/prepare` for each mode key above.
   - Assert response includes `attemptId`, `status: awaiting_upload`, `audioPath`, and `constraints` with expected caps.
   - Call `POST /api/practice-attempts/prepare` again with `attemptId` and same mode, assert it returns the same attemptId and does not create a new attempt.
   - Call `POST /api/practice-attempts/prepare` with the same `attemptId` but a different mode, assert `409` with `ATTEMPT_ID_MODE_MISMATCH`.

Expected:
- Constraint caps match `functions/src/practice-attempts/attempt-constraints.js`.
- Idempotent prepare works.

### A2. Shared attempt privacy contract (public)
Create a new script (recommended name):
- `tests/browser/practice-attempts-shared-view-browser-check.js`

Script behaviors:
1. Create or reuse a submitted attempt and share link via API (can be done by calling the share endpoint once the attempt is submitted).
2. Load `GET /api/shared/practice-attempts/:shareId?token=...` without being logged in.
3. Assert:
   - Headers include `Cache-Control: no-store` and `X-Robots-Tag: noindex`.
   - Payload contains only the public attempt shape and `feedback[]` items (no access snapshots, retention internals, or owner identifiers beyond `attemptId` and `practiceMode`).
4. Repeat with an invalid token and assert a uniform 404 response shape.

## Pass B: Manual Chrome (Interactive)
Goal: validate behavior in the real browser, including auth, API responses, emulator data visibility, and share link behavior.

### B1. Guest gating (cannot submit)
1. Open `https://localhost:8443` in Chrome.
2. Ensure you are logged out.
3. In DevTools Console, run:
   - `fetch('/api/practice-attempts/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ practiceMode: 'read_aloud' }) })`
4. Expected:
   - `401 UNAUTHORIZED` (or equivalent error indicating missing user identity).

### B2. Logged-in prepare returns correct constraints
1. Login using the admin account in `C:\Cursor AI\.local\browser-test-credentials.md`.
2. In DevTools Console, get an auth token:
```js
const token = await firebase.auth().currentUser.getIdToken();
```
3. Call prepare for each mode:
```js
async function prepare(practiceMode, attemptId) {
  const token = await firebase.auth().currentUser.getIdToken();
  const res = await fetch('/api/practice-attempts/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ practiceMode, attemptId, promptSnapshot: { promptId: 'local', title: 'Local', text: 'hello' } })
  });
  return { status: res.status, body: await res.json() };
}
await prepare('read_aloud');
await prepare('repeat_sentence');
await prepare('retell_lecture');
await prepare('some_future_mode_key');
```
4. Expected:
   - `constraints.hardMaxSeconds` matches the caps listed at the top of this doc.
   - `constraints.uiMaxSeconds` is 40 for `retell_lecture` and equals `hardMaxSeconds` for the others.
   - Returned `audioPath` is `practice-attempts/{uid}/{attemptId}/student.wav`.

### B3. Prepare idempotency (same attemptId, same mode)
1. Pick an `attemptId` from B2.
2. Call prepare again:
```js
const first = await prepare('repeat_sentence');
const attemptId = first.body?.data?.attemptId || first.body?.attemptId;
await prepare('repeat_sentence', attemptId);
```
3. Expected:
   - The second call returns the same `attemptId` and does not create a new attempt record.

### B4. Upload + complete (happy path) (optional if upload wiring is not exposed yet)
This verifies the strict complete-time WAV validation and duration caps. It requires writing a WAV file into Storage at the returned `audioPath`.

Recommended approach for manual validation:
1. Use Chrome to record a short WAV file (or export a WAV file externally).
2. Upload it to Storage emulator path `practice-attempts/{uid}/{attemptId}/student.wav` using a one-off tool of your choice.
3. Then call complete:
```js
async function complete(attemptId) {
  const token = await firebase.auth().currentUser.getIdToken();
  const res = await fetch(`/api/practice-attempts/${encodeURIComponent(attemptId)}/complete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  return { status: res.status, body: await res.json() };
}
await complete('<attemptId>');
```
4. Expected:
   - `status` becomes `submitted` in Firestore `speakingAttempts/{attemptId}`.
   - Attempt doc includes immutable audio metadata: `audio.sizeBytes`, `audio.contentType`, `audio.durationMs`, `audio.validatedAt`.
   - Duration above cap returns `400 AUDIO_DURATION_EXCEEDED` with details.

### B5. Bookmark toggle + cap (non-student rules)
Goal: confirm the 5-bookmark cap enforcement and transactional consistency.

1. Ensure the logged-in account is treated as non-student (no active CRM access window).
2. Create 6 submitted attempts (or reuse existing ones).
3. Bookmark 5 of them:
```js
async function bookmark(attemptId, active) {
  const token = await firebase.auth().currentUser.getIdToken();
  const res = await fetch(`/api/practice-attempts/${encodeURIComponent(attemptId)}/bookmark`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ active })
  });
  return { status: res.status, body: await res.json() };
}
```
4. Attempt to bookmark a 6th.
5. Expected:
   - 6th bookmark is rejected with a cap error (and a list of existing bookmarked attempts is returned for UX decisions).
   - Firestore `speakingAttemptCounters/{uid}` reflects the bookmarked count.

### B6. Share create/revoke and public viewing
1. Create a share link:
   - `POST /api/practice-attempts/:attemptId/share` (authenticated)
2. Open the returned `shareUrl` in an incognito Chrome window.
3. Expected:
   - `200` with public payload only.
   - `Cache-Control: no-store` and `X-Robots-Tag: noindex`.
4. Revoke the share link:
   - `DELETE /api/practice-attempts/:attemptId/share` (authenticated)
5. Reload the share link in incognito.
6. Expected:
   - Uniform `404 NOT_FOUND`.

### B7. Feedback lifecycle (reviewer + shared visibility)
1. Ensure you have a reviewer user (admin or teacher).
2. As reviewer, prepare feedback:
   - `POST /api/practice-attempts/:attemptId/feedback/prepare`
3. Complete feedback:
   - `POST /api/practice-attempts/:attemptId/feedback/:feedbackId/complete`
   - Include text and optionally audio (audio path is enforced as `practice-attempt-feedback/{attemptId}/{feedbackId}/{uid}.wav`).
4. List feedback (owner or reviewer):
   - `GET /api/practice-attempts/:attemptId/feedback`
5. Edit feedback (author or admin):
   - `PATCH /api/practice-attempts/:attemptId/feedback/:feedbackId`
6. Delete feedback (author or admin):
   - `DELETE /api/practice-attempts/:attemptId/feedback/:feedbackId`
7. If feedback visibility is `shared`, confirm it appears in the public shared endpoint response.

## Retention Verification (Emulator / Data Inspection)
This feature’s retention is largely a server-side policy decision stored on the attempt doc.

### Student vs non-student retention state
1. Submit one attempt as a non-student.
2. In Firestore, confirm:
   - `retentionState: nonstudent_ttl`
   - `deleteAfterAt` is set to about `now + 10 days`
3. Make the same user a student (create CRM student doc with `linked_user_ids: [uid]` and an active enrollment window).
4. Run reconcile job (if exposed) or wait for the job runner to process.
5. Confirm older attempts are promoted to permanent retention state (and are not deleted by cleanup).

### Access expiry behavior
1. Set an enrollment with `practiceAccessEndAt` in the past.
2. Submit a new attempt after the expiry.
3. Confirm retention applies non-student TTL rules for submissions after expiry, while older permanent attempts remain permanent.

## Debug Checklist (Common Failures)
- `401 UNAUTHORIZED` when logged in:
  - Confirm `Authorization: Bearer <idToken>` is being sent.
  - Confirm emulators are running and the app is using emulator auth (see console warning from `public/js/firebase-init.js`).
- Share link returns 404:
  - Confirm the share doc exists and `status: active`.
  - Confirm token query param is present and correct.
- Complete fails with `UPLOAD_MISSING`:
  - Confirm audio was uploaded to the exact canonical `audioPath` returned by prepare.
  - Confirm Storage rules allow the write for `awaiting_upload` attempts.
- Complete fails with duration cap:
  - Confirm the submitted WAV duration is within mode cap.
- Reviewer actions forbidden:
  - Confirm the user has `isAdmin` or `isTeacher` claim, or `/users/{uid}` contains `isAdmin: true` or `crmRole: "teacher"`.

