# Journal

## 2026-03-05 - Verify Reading Journey Vertex AI migration

- Evidence (smoke test, cache-miss): ran `node scripts/smoke-reading-journey.js --start-server --port 8793 --fresh`
  - Result: `✅ Reading Journey smoke passed.`
- Evidence (primary model works; fallback not used): ran `READING_JOURNEY_GEMINI_FALLBACK_MODEL=definitely-not-a-model node scripts/smoke-reading-journey.js --start-server --port 8793 --fresh`
  - Output included: `Reading Journey model: {"model":"gemini-2.5-pro","effectiveModel":"gemini-2.5-pro","fallbackModel":"definitely-not-a-model"}`
  - Result: `✅ Reading Journey smoke passed.`

- Fixes required to make Vertex work in this project:
  - Granted Vertex permission to the service account used by `GOOGLE_APPLICATION_CREDENTIALS`:
    - `gcloud projects add-iam-policy-binding listening-tasks-3ae34 --member="serviceAccount:firebase-adminsdk-fbsvc@listening-tasks-3ae34.iam.gserviceaccount.com" --role="roles/aiplatform.user" --condition=None`
  - Updated default Vertex model names (project does not expose `gemini-1.5-*` publisher models; `gemini-3*` models returned 404 via the Vertex SDK in this project, so defaulted to `gemini-2.5-pro`).
  - Fixed Vertex SDK response parsing (`response.text()` is not present in `@google-cloud/vertexai` responses).

## 2026-03-05 - Switch audits to Vertex (no AI Studio key required)

- Evidence (RFIB cohesion audit, Vertex, 1-row dry run): ran `node scripts/audit/run-rfib-cohesion-audit.js --input "C:\\Cursor AI\\public\\database\\RFIB\\RFIB Final ver.cohesion_audit.20260305_105054.xlsx" --dry-run --limit 1 --provider vertex --no-resume --print-first 1`
  - Output included: `Provider: vertex`, `Model: gemini-2.5-pro`, `verdict=PASS`

- Evidence (Reading Journey sim runner no longer requires `GEMINI_API_KEY`): ran `node scripts/simulate-reading-journey-50.js --count 1 --port 8796 --output-root docs/audits/reading-journey-sim/2026-03-05/quick-check3`
  - Output included: `✅ Wrote:` with run/summary/README artifacts.

## 2026-03-05 - Reading Journey provider priority: AI Studio -> Vertex

- Evidence (AI Studio pro primary; smoke): ran `node scripts/smoke-reading-journey.js --start-server --port 8793 --fresh`
  - Output included: `Reading Journey model: {"model":"ai-studio:models/gemini-3.1-pro-preview",...}`
  - Result: `✅ Reading Journey smoke passed.`

- Evidence (Vertex Gemini 3.x not usable via SDK in this project): direct `@google-cloud/vertexai` call with `model=gemini-3.1-pro-preview` returned `404 Not Found` for the publisher model.

## 2026-07-30 - Pronounce V3 release implementation

- Restored the comprehensive phoneme-service packaging tests; backend pronunciation regression suite passed `104` tests.
- Added fail-closed V3 verification: independent CTC/Praat count disagreement abstains, and stress uses a relative acoustic prominence ranker without a guessed wrong-stress location.
- Added learner retry policy: initial recording plus two re-recordings, then advisory-only best effort; network/microphone errors do not consume attempts.
- Frontend and Chrome evidence passed:
  - `node --test tests/pronunciation-analyzer/analysis-pipeline.test.mjs tests/pronunciation-analyzer/praat-api-v2.test.mjs tests/pronunciation-analyzer/reference-ui-contract.test.mjs tests/pronunciation-analyzer/verification-attempt-policy.test.mjs`
  - `node tests/browser/pronounce-mode-browser-check.js`
  - `node tests/browser/pronounce-mode-syllable-playback-check.js`
- Promotion remains blocked by design: `backend/local_server/models/pronunciation-verifier-v1.json` is still an explicit `placeholder-untrained` artifact, and the learner feature flag remains off until fresh ranker feature extraction, model-candidate comparison, and untouched holdout gates are completed.

## 2026-07-31 - Fix localhost Pronounce reference loading

- Root cause evidence: the localhost page was hard-wired to Cloud Run, whose `/health` and `/dictionary/v2/photograph` responses report schema `9` / `pronunciation-reference-v3`; the current frontend validator requires schema `10` / `pronunciation-reference-v4`.
- Fix: `public/pronunciation-analyzer/config.js` now uses the local HTTPS Flask backend (`https://localhost:8081`) on localhost by default, while retaining Cloud Run for non-local hosts or an explicit override.
- Before/after Chrome evidence on `https://localhost:8443/practice/speaking/pronounce`: before showed `Invalid pronunciation reference: schema version mismatch` and `IPA Error`; after `/health` and `/dictionary/v2/photograph` returned `200`, the reference error was empty, IPA rendered `/ˈfoʊtəˌɡræf/`, and recording remained enabled.
- Validation: `npm run test:pronounce:logic` passed; `npm run test:pronounce:browser` passed (mode and syllable playback checks).

## 2026-07-31 - Add localhost-only Pronounce sample capture

- Added a local-only `Save sample locally` control to Pronounce. It appears only for `localhost` / `127.0.0.1`, converts the browser recording to WAV, and preserves the target reference, observed syllable spans, analysis output, and error state.
- Added loopback-only Flask route `POST /debug/pronounce-samples`. It writes `test-results/pronounce-local-samples/<sampleId>.wav` and matching JSON metadata; production origins are rejected with `LOCAL_ONLY`.
- Chrome evidence on `https://localhost:8443/practice/speaking/pronounce`: `backend_control_visible=true`, `control_count=1`, status `Saved locally: test-results/pronounce-local-samples/industrial-local-check.wav`, IPA `/ˈfoʊtəˌɡræf/`, and `page_errors=[]`. Screenshot: `C:\Users\Admin\AppData\Local\Temp\codex-pronounce-local-save-20260731.png`.
- Validation: `npm run test:pronounce:logic` passed; `npm run test:pronounce:browser` passed; `python -m unittest backend.test_local_pronounce_samples` passed (`Ran 2 tests ... OK`); targeted ESLint and Python/JavaScript syntax checks passed.

## 2026-07-31 - Add Pronounce manual syllable review

- Added an explicit Manual review mode to the learner waveform. Each pair of waveform clicks creates an ordered start/end span; Undo, Clear, and a saved-state indicator prevent accidental duplicate submissions. WaveSurfer 7 shadow-root clicks are captured after audio is ready.
- Removed the verifier A/B control and comparison playback code. Native reference playback remains available in the separate reference player.
- Manual review saves use the existing authenticated admin corpus endpoint. The upload includes the original WAV, manual spans, automatic spans, review reason, target/reference metadata, and `needsManualReview=true`; anonymous/learner requests fail closed at the admin boundary. Local emulator saves also write `verifiedSpans` to the existing manifest contract.
- Validation: `npm run test:pronounce:logic` passed; `npm run test:pronounce:browser` passed (including `tests/browser/pronounce-manual-review-browser-check.js`); `node tests/crm/pronunciation-corpus-production-route.test.js` passed; `python -m unittest backend.test_local_pronounce_samples` passed; JavaScript syntax checks passed.
- Chrome evidence on `https://localhost:8443/practice/speaking/pronounce`: three direct waveform segment pairs were captured and the verifier showed `Saved to cloud: local-chrome-manual-check`; `.sv-btn-compare` was absent. Screenshot: `C:\Users\Admin\AppData\Local\Temp\codex-pronounce-manual-review-20260731.png`.

## 2026-08-18 - RFIB Multi-LLM 3-Model Quality Audit & Consensus Debate Pass

### Objective
- Audit RFIB explanation quality across local LLMs (`deepseek-r1:14b`, `qwen3:14b`, `gemma4:latest`).
- Enforce >=2/3 majority approval threshold and multi-round debate loop until 3/3 mutual consent for contested explanations.
- Complete initial 20% random sample (221 questions), analyze edge cases, and launch audit for remaining 80% (884 questions).

### Accomplished
- Completed 20% sample audit (221 questions): 89.6% direct approval, 9.5% resolved via debate to unanimous consensus (99.1% total quality pass rate).
- Documented 2 unresolved debate cases (Q146, Q520) with root cause and gold solutions in `RFIB_unresolved_audit_analysis.md`.
- Patched Q146 and Q520 in revision and sample datasets via `scripts/patch_unresolved.py`.
- Resumed full remaining 80% audit run (task-2987); reached **370 / 1,105 questions (33.5% total pool, crossing 1/3 milestone)** with atomic per-question saving.
- Provided deep linguistic analysis for Heavy NP Shift (Q146) and Catenative Verbs (Q520).
- Successfully reconciled multiple multi-round debates (e.g. Q98, Q114, Q156) to 3/3 unanimous mutual consent.
- Updated Task Tracker (Task 680 Done, Task 681 Done, Task 682 In Progress).

### Verification
- [x] Empirically validated 20% sample with JSON debate report (`public/database/RFIB/RFIB_audit_debate_report.json`).
- [x] Verified patch execution for Q146 Blank 3 and Q520 Blank 4 across all database files.
- [x] Verified 370 audited records in `public/database/RFIB/RFIB_audited_full.jsonl`.
- [ ] Complete remaining 66.5% of audit run (735 questions remaining).

### Paused Because
- User requested session pause.

