# Corpus Sample Analysis UI Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Let an authenticated CRM admin analyze and verify every saved pronunciation sample directly from the Pronunciation Verification page.

**Architecture:** Add an admin-protected same-origin audio proxy for a saved corpus sample, then use the existing browser `PraatAPI` client to submit that WAV to the deployed target-aligned V2 analyzer. Add an Analyze & Verify control and a per-sample result region in the Saved Samples list; keep each result tied to its sample ID and display count, rateability, stress, timing, and verification status.

**Tech Stack:** Express/Firebase Functions CRM router, Firebase Storage, vanilla CRM JavaScript/HTML, existing `public/pronunciation-analyzer/praat-api.js`, Playwright Chrome tests, Node route-contract tests.

---

### Task 1: Define the protected audio retrieval contract

**Files:**
- Modify: `functions/src/routes/admin/pronunciation-corpus.js`
- Modify: `tests/crm/pronunciation-corpus-production-route.test.js`

**Steps:**

1. Add a failing route-contract test for `GET /dev/corpus-samples/:sampleId/audio` that rejects invalid IDs, returns 404 for missing samples, and returns the stored WAV bytes with `audio/wav` and `Cache-Control: no-store` for an existing admin-owned corpus record.
2. Run `node tests/crm/pronunciation-corpus-production-route.test.js`; expect failure because the route is not registered.
3. Implement the route using the existing admin middleware, `SAMPLE_ID_RE`, Firestore record lookup, and `getStorageBucket().file(sample.storagePath).download()`. Never derive a storage path from an unchecked request string.
4. Run the route test and confirm it passes.

### Task 2: Add per-sample analysis controls and result rendering

**Files:**
- Modify: `public/crm-admin.js`
- Modify: `public/crm-admin.html` only if a shared result style/container is needed

**Steps:**

1. Add a failing browser assertion that each saved sample has an `Analyze & Verify` button and a result container keyed by sample ID.
2. Implement an `analysisBySampleId` map and an `analyzeSavedSample(sample, row)` handler. The handler must fetch the same-origin audio proxy, dynamically import `PraatAPI`, call V2 with `targetSyllableCount`, and prevent duplicate clicks while running.
3. Render only text nodes/DOM properties (no untrusted `innerHTML`) showing: target count, expected observed count, observed count, rateable/quality status, segmentation method, primary stress, confidence, and each syllable’s start/end/duration/pitch/intensity/stress.
4. Compute a transparent verification label: clean samples require rateable audio and target-count agreement; other categories compare against their recorded expected count and are labeled for review when automatic interpretation is insufficient.
5. Add retryable error text beside the affected sample without breaking the rest of the saved-sample list.

### Task 3: Add regression coverage for the complete UI flow

**Files:**
- Modify: `tests/browser/crm-pronunciation-samples-browser-check.js`

**Steps:**

1. Extend the mocked corpus response with `targetSyllableCount`, `expectedObservedCount`, and a matching mocked audio-proxy response containing a valid WAV fixture.
2. Add assertions that the Analyze & Verify button appears, sends `GET /api/admin/dev/corpus-samples/<id>/audio`, calls `/analyze/v2` only, and renders the two-syllable result and verification status.
3. Run the Chrome browser test and confirm the full CRM flow still passes with zero page errors and zero console errors (the known ScriptProcessorNode deprecation warning is not treated as an error).

### Task 4: Verify production readiness

**Files:**
- No production files beyond the implementation above.

**Steps:**

1. Run `node tests/crm/pronunciation-corpus-production-route.test.js`.
2. Run `node tests/browser/crm-pronunciation-samples-browser-check.js`.
3. Run `node scripts/crm/verify-crm-suite.js`.
4. Run the live Chrome production check against `https://betterenglishlearning.com/crm-admin.html#pronunciation-samples`, using the local credentials file and a real saved sample, and verify the result is rendered per attempt.
5. Deploy the Functions/Hosting changes only after all checks pass; record the deployed backend revision and keep the existing rollback revision.

