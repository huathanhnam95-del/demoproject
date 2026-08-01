# Pronunciation V2/V3 Production Comparison Verification

Date: 2026-08-01  
Branch: `codex/pronunciation-v2-v3-comparison`  
Pre-deployment commit: `9fb4fb494357ff93489f3a56fabf632d90ca6c63`

## Scope

The approved change adds an authenticated admin comparison path. One recording is sent once to `/analyze/compare`; the response contains independently labelled V2 and V3 envelopes. The global learner flag remains `usePronunciationV3LearnerAnalysis: false`, and the existing global V3 behavior remains shadow-compatible. Comparison samples are saved only to `pronunciation_analysis_comparisons` with storage prefix `pronunciation-analysis-comparisons/`.

The temporarily skipped Vnese 127 sample is not a gate for this release and is not used in this verification.

## Required behavior verified

- V2 and V3 are shown side by side for an admin session.
- The shared waveform can switch between V2 and V3 automatic boundaries.
- Manual spans, pending manual state, and the existing `Save to cloud` manual-review workflow are preserved.
- Complete comparisons allow exactly `v2`, `v3`, `tie`, or `neither`.
- Partial failures hide the winner fieldset and save with `judgment: null`.
- Save is explicit, retryable, and guarded against duplicate in-flight submissions.
- WAV bytes, both raw analysis envelopes, context, revisions, judgment, manual spans, and server-derived identity/timestamps are persisted separately from the segmentation corpus.
- Unauthenticated/non-admin requests remain fail-closed at the admin comparison route.

## Commands and results

| Layer | Command | Result |
|---|---|---|
| Backend syntax | `python -m py_compile backend/local_server/server.py` | PASS (exit 0) |
| Backend/API/alignment/phoneme | `python -m unittest backend.test_pronunciation_api_v2 backend.test_pronunciation_alignment_v2 backend.test_phoneme_client -v` | PASS: 108 tests, 1 skipped fixture-only industrial test (exit 0) |
| Pronunciation logic | `npm run test:pronounce:logic` | PASS (exit 0) |
| Chrome Pronounce suite | `npm run test:pronounce:browser` | PASS: legacy, comparison, playback, and manual-review checks (exit 0) |
| Comparison route | `node tests/crm/pronunciation-comparison-production-route.test.js` | PASS (exit 0) |
| Existing corpus route | `node tests/crm/pronunciation-corpus-production-route.test.js` | PASS (exit 0) |
| Router contract | `node tests/crm/sync-from-prod-router-contract.test.js` | PASS (exit 0) |
| Changed CRM route lint | `npx eslint functions/src/routes/admin/pronunciation-comparisons.js functions/src/routes/admin/pronunciation-corpus.js functions/src/routes/admin/create-crm-router.js --quiet` | PASS (exit 0) |

`npm run lint:crm` was also run. It remains blocked by five existing `no-console` errors in `public/crm-admin.js` (lines 7964, 7968, 7972, 8073, and 8182); this change does not modify that file.

## Browser evidence

Chrome-only comparison artifacts were captured under `test-results/pronunciation-v2-v3-comparison/`:

- `pronunciation-v2-v3-comparison-desktop.png`
- `pronunciation-v2-v3-comparison-mobile.png`
- Existing Pronounce reference screenshots were also captured by the legacy harness.

The focused Chrome contract recorded one comparison request, distinct V2/V3 counts (2 and 3), a V2 → V3 boundary switch with the manual span unchanged, all four keyboard-selectable judgments, complete and partial saves, the admin bearer token, and no page errors or horizontal overflow.

## Deployment record

Deployment has not yet been executed in this pre-deployment report. The authorized deployment sequence is:

1. Push this branch and record the remote SHA.
2. Build and verify an immutable Cloud Run image using `backend/cloudbuild.pronunciation.yaml`; preserve `PRONUNCIATION_V3_MODE=shadow`.
3. Promote the exact verified Cloud Run revision.
4. Deploy only Firebase `functions:api`.
5. Deploy Firebase Hosting.
6. Run the authenticated Chrome smoke flow and record the comparison ID, live revisions, monitoring window, and rollback targets here.

No production approval is inferred from the passing local suite alone.
