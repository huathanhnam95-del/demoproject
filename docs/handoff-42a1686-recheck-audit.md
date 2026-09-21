# Senior Code Audit & Remediation Handoff: 42a1686 Findings

**Date:** September 20, 2026  
**Auditor / Author:** Senior Code Auditor & Orchestrator (Antigravity Boost Routine)  
**Baseline Commit:** `42a1686c07d617b72cf031e953c0a658f416c83a`  
**Current Branch:** `feat/projects-subtasks-people`  
**Reference Report:** `C:\Users\Admin\Downloads\DEMOPROJECT_RECHECK_42a1686.md`  
**Status:** Substantially remediated; **3 high-severity defects + 1 test suite regression require immediate developer resolution**.

---

## 1. Executive Summary & Purpose

This handoff document provides the next agent with a forensic audit of the working tree after remediating the senior code recheck findings in [`DEMOPROJECT_RECHECK_42a1686.md`](file:///C:/Users/Admin/Downloads/DEMOPROJECT_RECHECK_42a1686.md).

Significant progress was made:
- Eager script tags removed; on-demand lazy loading synchronized with release tools.
- Client-side direct writes to Firestore removed; rules made server-authoritative.
- Service worker precache stripped by >2.5MB; uncoordinated takeovers removed.
- Paid Azure speech assessment rate limiter configured to `failClosed: true`.
- CI updated with push triggers and performance/content gates.

However, an independent, skeptical deep audit revealed **critical architectural gaps** that must be resolved prior to release.

---

## 2. Forensic Audit Findings: Verified vs. Defective

### Topic 1: Read Aloud Eager Download & Single-Source Versioning (P1)
- **Status:** ✅ **VERIFIED CLEAN**
- **Verified Code:**
  - `<script src="/read-aloud-mode.js?v=2.0.13"></script>` deleted from [`public/index.html`](file:///c:/Cursor%20AI/public/index.html).
  - [`public/js/lazy-loader.js`](file:///c:/Cursor%20AI/public/js/lazy-loader.js#L338) lazy-loads `/read-aloud-mode.js?v=2.0.13` on demand.
  - [`scripts/sync-version.js`](file:///c:/Cursor%20AI/scripts/sync-version.js) and [`scripts/release/firebase-release.cjs`](file:///c:/Cursor%20AI/scripts/release/firebase-release.cjs) keep `lazy-loader.js` synchronized with `package.json` version.
  - `node --test tests/read-aloud-version-sync.test.mjs` passed (1/1).

---

### Topic 2: Failed Eager Script Recovery & Dependency Pipeline (P1)
- **Status:** ✅ **VERIFIED CLEAN**
- **Verified Code:**
  - `xlsx.full.min.js` in [`public/index.html#L139`](file:///c:/Cursor%20AI/public/index.html#L139) now has inline `onerror="this.dataset.belFailed='true'" onload="this.dataset.belLoaded='true'"`.
  - [`public/js/lazy-loader.js`](file:///c:/Cursor%20AI/public/js/lazy-loader.js#L101-L121) checks `document.readyState !== 'loading'` on parser-inserted scripts; detects spent/failed tags immediately and evicts them without waiting for the 20-second timeout.
  - Compromise is lazy-loaded on demand via `ensureCompromiseLoaded()` (not eager in `index.html`).
  - `ensureNotesModeLoaded()` parallelized with `Promise.all([ensureCompromiseLoaded(), ensureXlsxLoaded()])` and removed unused `ensureYouTubePlayerLoaded()`.
  - `node --test tests/performance/reference.test.cjs` passed (19/19).

---

### Topic 3: Student Submissions & Audio Storage Authorization (P1)
- **Status:** 🚨 **CRITICAL DEFECTS IDENTIFIED**
- **Verified Clean:**
  - In [`public/js/classroom-api.js`](file:///c:/Cursor%20AI/public/js/classroom-api.js), the client-side direct fallback write `db.collection('crmSubmissions').doc().set(...)` was completely deleted.
  - [`firestore.rules#L248-L260`](file:///c:/Cursor%20AI/firestore.rules#L248-L260) blocks all client writes: `allow create, update, delete: if isAdmin();`.
  - [`storage.rules#L116`](file:///c:/Cursor%20AI/storage.rules#L116) enforces immutability for uploaded audio: `allow update: if false;`.
- **🚨 Defect 3.1: Document ID Scheme Mismatch (Rules Silently Fail Open):**
  - In [`storage.rules#L111-L114`](file:///c:/Cursor%20AI/storage.rules#L111-L114):
    ```rules
    && (
      !firestore.exists(/databases/(default)/documents/crmSubmissions/$(classId + '_' + workId + '_' + uid))
      || firestore.get(/databases/(default)/documents/crmSubmissions/$(classId + '_' + workId + '_' + uid)).data.status != 'graded'
    );
    ```
  - But in [`functions/src/crm/homework-service.js#L23-L28`](file:///c:/Cursor%20AI/functions/src/crm/homework-service.js#L23-L28):
    ```javascript
    function buildHomeworkSubmissionDocId({ classId, workId, studentUid }) {
        return crypto
            .createHash('sha256')
            .update([classId, workId, studentUid].map((v) => String(v || '').trim()).join('::'))
            .digest('hex');
    }
    ```
  - **Impact:** Firebase Security Rules CEL engine does not support SHA-256 hashing. The document path checked by Storage rules **never exists**. Therefore `!firestore.exists(...)` always evaluates to `true`. Students can upload new audio even after an assignment has been graded.
- **🚨 Defect 3.2: Missing Classwork Existence Check in Storage:**
  - [`storage.rules#L107-L114`](file:///c:/Cursor%20AI/storage.rules#L107-L114) checks classroom enrollment, but does **not** check whether the assignment document exists at `/databases/(default)/documents/crmClassrooms/$(classId)/classwork/$(workId)`.
  - In [`public/js/classroom-api.js#L210`](file:///c:/Cursor%20AI/public/js/classroom-api.js#L210), the client uploads the audio blob to Storage *before* calling the backend submission endpoint.
  - **Impact:** An enrolled student can upload 50MB files under arbitrary/deleted `workId` strings. The backend API then rejects with 404 `WORK_NOT_FOUND`, leaving orphaned files in Storage and draining storage quotas.

---

### Topic 4: Fail-Closed Rate Limiting for Paid Endpoints (P2)
- **Status:** ⚠️ **FUNCTIONALLY IMPLEMENTED; TEST GAP IDENTIFIED**
- **Verified Code:**
  - `FirestoreRateLimitStore` in [`functions/src/middleware/practice-attempts-rate-limiter.js`](file:///c:/Cursor%20AI/functions/src/middleware/practice-attempts-rate-limiter.js) supports `failClosed: Boolean`.
  - All paid Azure speech endpoints in [`functions/src/apiApp.js#L422`](file:///c:/Cursor%20AI/functions/src/apiApp.js#L422) mount `azureAssessmentRateLimiter` with `failClosed: true`, rejecting requests with HTTP 503 (`RATE_LIMITER_UNAVAILABLE`) when Firestore is unreachable.
  - Unpaid attempts retain `failClosed: false` to avoid blocking learners on transient glitches.
  - Distributed `decrement()` and `resetKey()` are implemented in Firestore.
- **Testing Gap:**
  - [`tests/security/rate-limiter-fail-closed.test.cjs`](file:///c:/Cursor%20AI/tests/security/rate-limiter-fail-closed.test.cjs) only tests with `getDb: () => null`. The distributed transaction path (`db.runTransaction`) lacks a simulated multi-instance mock test.

---

### Topic 5: Service Worker Precaching & Activation Lifecycle (P2)
- **Status:** ⚠️ **PRECACHE TRIMMED; LIFECYCLE DEFECTS DETECTED**
- **Verified Code:**
  - Removed `/write-essay-mode.js`, `/js/write-essay-support.js`, and heavy `/ipa-dict.json` (>2MB) from `SHELL_URLS` in [`public/sw.js`](file:///c:/Cursor%20AI/public/sw.js).
  - Removed uncoordinated `skipWaiting()` and `clients.claim()` on install/activate; added `{ type: 'SKIP_WAITING' }` listener.
- **Defect 5.1: Hardcoded Cache Version Decoupled from Release Tooling:**
  - [`public/sw.js#L1`](file:///c:/Cursor%20AI/public/sw.js#L1) hardcodes `const CACHE_VERSION = 'bel-offline-v28-v1-8-128'`.
  - [`scripts/sync-version.js`](file:///c:/Cursor%20AI/scripts/sync-version.js) does not update it.
  - **Impact:** On version releases, the `activate` event in `sw.js` never purges obsolete runtime caches because the cache key never changes.
- **Defect 5.2: Indefinite Worker Update Stall:**
  - With `skipWaiting()` removed from `sw.js`, and no update listener or user reload prompt in [`public/js/sw-register.js`](file:///c:/Cursor%20AI/public/js/sw-register.js), any updated service worker will wait indefinitely in the `waiting` state until all browser tabs are closed.

---

### Topic 6: CI Workflow & Test Suite Regressions
- **Status:** ❌ **CI HARDENED, BUT CRM TEST SUITE HAS REGRESSION**
- **Verified Code:**
  - [`.github/workflows/verify.yml`](file:///c:/Cursor%20AI/.github/workflows/verify.yml) updated with `feat/**` push triggers and reference test steps.
- **Suite Regression:**
  - Running `npm run test:crm:selection` fails with 2 assertion errors:
    ```text
    ✖ runner list preserves the frozen baseline, existing scheduling additions and approved lint roots
      AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: 75 !== 69
    ✖ runner list inserts registered unit tests by feature and path before legacy checks
      AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: 76 !== 70
    ```
  - In [`tests/crm/verification-selection.test.cjs#L20`](file:///c:/Cursor%20AI/tests/crm/verification-selection.test.cjs#L20), `EXPECTED_CURRENT_CHECK_COUNT` is 69, but 6 new checks were added to `scripts/crm/verify-crm-suite.js`.

---

## 3. Concrete Implementation Action Plan for Next Agent

The next agent must implement the following 4 targeted fixes:

### Task 1: Harmonize Homework Submission Doc ID with `storage.rules`
1. **Modify `functions/src/crm/homework-service.js`:**
   Change `buildHomeworkSubmissionDocId` from SHA-256 to a clean delimiter-based ID that can be reconstructed in CEL Security Rules without hashing:
   ```javascript
   function buildHomeworkSubmissionDocId({ classId, workId, studentUid }) {
       const clean = (v) => String(v || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
       return `${clean(classId)}__${clean(workId)}__${clean(studentUid)}`;
   }
   ```
   *(Ensure backward compatibility: backend lookups should check the new doc ID, falling back to legacy doc ID if necessary).*

2. **Modify `storage.rules`:**
   Update lines 107–115 to:
   ```rules
   allow create: if request.auth != null
     && request.auth.uid == uid
     && firestore.exists(/databases/(default)/documents/crmClassrooms/$(classId)/members/$(request.auth.uid))
     && firestore.exists(/databases/(default)/documents/crmClassrooms/$(classId)/classwork/$(workId))
     && isAllowedAttemptMediaUpload(50 * 1024 * 1024)
     && (
       !firestore.exists(/databases/(default)/documents/crmSubmissions/$(classId + '__' + workId + '__' + uid))
       || firestore.get(/databases/(default)/documents/crmSubmissions/$(classId + '__' + workId + '__' + uid)).data.status != 'graded'
     );
   ```

3. **Update Security Test:**
   In [`tests/security/authorization-boundaries.test.cjs`](file:///c:/Cursor%20AI/tests/security/authorization-boundaries.test.cjs), update regex assertions to match the `__` delimiter and the classwork assignment existence check.

---

### Task 2: Synchronize Service Worker `CACHE_VERSION`
1. **Modify `scripts/sync-version.js`:**
   Add logic to update `CACHE_VERSION` in `public/sw.js`:
   ```javascript
   const swPath = path.join(__dirname, '..', 'public', 'sw.js');
   if (fs.existsSync(swPath)) {
     let content = fs.readFileSync(swPath, 'utf8');
     const updated = content.replace(
       /const CACHE_VERSION = 'bel-offline-[^']+';/,
       `const CACHE_VERSION = 'bel-offline-v${version}';`
     );
     fs.writeFileSync(swPath, updated, 'utf8');
   }
   ```

2. **Modify `scripts/release/firebase-release.cjs`:**
   In `validateVersionOracle`, verify that `public/sw.js` contains `bel-offline-v${version}`.

3. **Update `public/js/sw-register.js`:**
   Add an update listener or dispatch `{ type: 'SKIP_WAITING' }` on page reload / navigation when not recording.

---

### Task 3: Reconcile CRM Verification Selection Check Count
1. **Modify `tests/crm/verification-selection.test.cjs`:**
   Update `EXPECTED_CURRENT_CHECK_COUNT` on line 20:
   ```javascript
   const EXPECTED_CURRENT_CHECK_COUNT = 75; // was 69
   ```
2. Verify by running `npm run test:crm:selection`.

---

### Task 4: Enhance Rate Limiter Tests
1. **Modify `tests/security/rate-limiter-fail-closed.test.cjs`:**
   Add a test case with a simulated Firestore mock exercising `db.runTransaction` for both increment and decrement, and document deletion for `resetKey`.

---

## 4. Verification Commands Reference

Once the fixes are implemented, run the following verification suite:

```bash
# 1. Performance Reference (19 tests)
node --test tests/performance/reference.test.cjs

# 2. Read Aloud Version Sync (1 test)
node --test tests/read-aloud-version-sync.test.mjs

# 3. Security Boundaries & Rate Limiting (11+ tests)
npm run test:security

# 4. CRM Verification Selection (16 tests)
npm run test:crm:selection

# 5. Content Integrity
npm run check:content:rmcsa

# 6. Structure Policy (45 tests)
npm run test:structure

# 7. Release CLI & Predeploy Hooks (22 tests)
npm run test:release
```

---

## 5. Working Tree Change Inventory

The following files are currently modified in the working tree for this remediation:
- [`public/index.html`](file:///c:/Cursor%20AI/public/index.html) — Removed eager Read Aloud script; added dataset hooks.
- [`public/js/lazy-loader.js`](file:///c:/Cursor%20AI/public/js/lazy-loader.js) — Read Aloud lazy loader, spent tag eviction, parallelized Notes mode.
- [`public/js/classroom-api.js`](file:///c:/Cursor%20AI/public/js/classroom-api.js) — Removed direct Firestore fallback.
- [`firestore.rules`](file:///c:/Cursor%20AI/firestore.rules) — Admin-only writes for `/crmSubmissions/{id}`.
- [`storage.rules`](file:///c:/Cursor%20AI/storage.rules) — Immutability and graded submission guard.
- [`functions/src/middleware/practice-attempts-rate-limiter.js`](file:///c:/Cursor%20AI/functions/src/middleware/practice-attempts-rate-limiter.js) — `failClosed: true` support & distributed decrement/reset.
- [`public/sw.js`](file:///c:/Cursor%20AI/public/sw.js) — Stripped heavy files from precache; removed uncoordinated takeovers.
- [`.github/workflows/verify.yml`](file:///c:/Cursor%20AI/.github/workflows/verify.yml) — Push triggers and reference test steps.
- [`scripts/sync-version.js`](file:///c:/Cursor%20AI/scripts/sync-version.js) — Lazy loader & fixture index token sync.
- [`scripts/release/firebase-release.cjs`](file:///c:/Cursor%20AI/scripts/release/firebase-release.cjs) — Lazy loader version oracle validation.
- [`tests/read-aloud-version-sync.test.mjs`](file:///c:/Cursor%20AI/tests/read-aloud-version-sync.test.mjs) — Version sync assertions.
- [`tests/security/authorization-boundaries.test.cjs`](file:///c:/Cursor%20AI/tests/security/authorization-boundaries.test.cjs) — SEC-04 rule assertions.
- [`tests/security/rate-limiter-fail-closed.test.cjs`](file:///c:/Cursor%20AI/tests/security/rate-limiter-fail-closed.test.cjs) — Fail-closed rate limiter tests.
- [`TASK_TRACKER.csv`](file:///c:/Cursor%20AI/TASK_TRACKER.csv) — Task 1236 status.
