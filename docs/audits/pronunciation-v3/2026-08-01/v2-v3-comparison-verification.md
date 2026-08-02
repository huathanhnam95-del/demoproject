# Pronunciation V2/V3 Production Comparison Verification

Date: 2026-08-01  
Branch: `codex/pronunciation-v2-v3-comparison`  
Source commit deployed: `86ed5752e0432ca071d0c9fe42f32d917db5cd73`

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

The production Chrome smoke used the local admin credentials file
`C:\\Cursor AI\\.local\\browser-test-credentials.md` without copying its
contents into this report. It verified `/api/admin/status` with HTTP 200 and
`isAdmin: true`, called the live comparison endpoint from the production page,
rendered the deployed V2/V3 columns, and saved one valid WAV comparison. The
saved smoke record is `799cc4827c8c866168156079be41cac2`.

Production screenshots (ignored test artifacts) are:

- `test-results/production-pronunciation-comparison/production-live-comparison-partial.png`
- `test-results/production-pronunciation-comparison/production-comparison-ui-fixture.png`

The first shows the live partial result. The second uses a non-persisted
complete fixture only to exercise the deployed side-by-side layout, boundary
switch, and four judgment controls; it is not accuracy evidence.

The focused Chrome contract recorded one comparison request, distinct V2/V3 counts (2 and 3), a V2 → V3 boundary switch with the manual span unchanged, all four keyboard-selectable judgments, complete and partial saves, the admin bearer token, and no page errors or horizontal overflow.

## Deployment record

Deployment completed with the explicit approval recorded in the task:

| System | Production result |
|---|---|
| Git | Branch pushed to `origin/codex/pronunciation-v2-v3-comparison`; source SHA `86ed5752e0432ca071d0c9fe42f32d917db5cd73` |
| Cloud Build | Build `122d6551-8eaa-4a1b-8487-a2b2009eb8ed`, `SUCCESS`; image `us-central1-docker.pkg.dev/parselmouth/cloud-run-source-deploy/praat-api:86ed5752e0432ca071d0c9fe42f32d917db5cd73` |
| Cloud Run | Candidate `praat-api-00043-fac` promoted to 100%; health `ok`; `PRONUNCIATION_V3_MODE=shadow`; learner V3 flag remains disabled in the web client |
| Firebase Functions | Project `listening-tasks-3ae34`; only `functions:api` deployed; current function hash `539ed0c952eaee2ebe18e1e4b1c273ac9b1c16eb`; URL `https://us-central1-listening-tasks-3ae34.cloudfunctions.net/api` |
| Firebase Hosting | Release `projects/listening-tasks-3ae34/sites/listening-tasks-3ae34/channels/live/releases/1785636754996000`; version `46a1d357c943b684`; finalized at `2026-08-02T02:12:34.996Z`; verified on both `https://listening-tasks-3ae34.web.app` and `https://betterenglishlearning.com` |
| Authenticated smoke | Admin status passed; live comparison returned V2 available and a structured V3 unavailable response; explicit save succeeded with comparison `799cc4827c8c866168156079be41cac2` |
| Stability window | `2026-08-02T02:34:15Z`-`2026-08-02T02:49:46Z`, 17 samples; all Cloud Run health checks were `ok/praat-api-00043-fac/shadow`, Hosting contained six comparison markers, and the unauthenticated save route remained `401` |

The V3 column was visible in production, but the existing phoneme recognizer
service returned `503 RECOGNIZER_BUSY` for the smoke recordings. The compare
contract correctly preserved V2 and marked V3 unavailable; this upstream
capacity condition is recorded for follow-up and was not treated as a reason
to roll back the approved comparison UI. It is separate from the temporarily
skipped Vnese 127 sample, which remains outside this release gate.

Rollback target: the pre-deployment Cloud Run revision was
`praat-api-00033-hq8`. Restore it with:

```text
gcloud run services update-traffic praat-api --project parselmouth --region us-central1 --to-revisions praat-api-00033-hq8=100
```
