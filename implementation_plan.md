---
ArtifactMetadata:
  RequestFeedback: true
---

# V3 Vowel-Measurement Correction Plan

## Review Findings

- The truncation diagnosis is valid, but the current patch also changes raw V3 syllable spans from gapped CTC coverage into contiguous partitions in `backend/phoneme_service/stress_alignment.py`. That silently changes UI and saved-comparison semantics.
- The changed test only verifies that syllable boundaries touch. It does not test vowel-nucleus extension, acoustic features, odd/even gaps, or contract compatibility.
- Focused evidence: 60 Python tests pass. On the local `photograph` recording, the patch expands the first nucleus from 20 ms to 121 ms and the second from 20 ms to 81 ms, changing the expected-stress duration margin from approximately 0 to 40 ms. This supports correcting measurement spans, but not redefining raw spans.
- The current production verifier artifact is count-only with stress scoring disabled. Validation must report acoustic-feature improvements without claiming a new learner stress verdict.

## Implementation Changes

- Preserve existing `start_*`/`end_*` syllable fields and `nucleus_*` fields as raw, half-open CTC token-coverage intervals.
- Replace `_close_ctc_gaps` with a non-mutating derivation that adds `measurement_start_*` and `measurement_end_*` fields:
  - Split each inter-syllable gap at `start + ceil(gap / 2)`.
  - Extend a preceding measurement nucleus only when its raw nucleus ends at the syllable edge.
  - Extend a following measurement nucleus only when its raw nucleus begins at the syllable edge.
  - Never allocate leading/trailing silence, change confidence, overlap measurements, or modify non-edge nuclei.
- Make acoustic extraction prefer `measurement_*`, then raw `nucleus_*`, then raw syllable spans.
- Add recognizer metadata:
  - `span_contract_version: "ctc-alignment-v2"`
  - `frame_interval: "half-open"`
  - `syllable_span_type: "ctc-token-coverage"`
  - `nucleus_span_type: "ctc-vowel-token-coverage"`
  - `measurement_span_type: "ctc-blank-midpoint-v1"`
- Propagate raw nucleus and measurement times through the V3 response. Keep UI boundary overlays on raw `startTime`/`endTime`; label them “CTC token coverage.”
- Persist the contract metadata with new comparison records. Treat records without it as legacy/unknown; do not rewrite historical records.

## Test and Acceptance Plan

- Add deterministic unit cases for zero, one, odd, and even blank gaps; open/open, open/onset, vowel-initial, and closed-syllable controls; multiple syllables; time conversion; bounds; and non-overlap.
- Assert raw spans and confidence remain unchanged while only eligible measurement fields change.
- Add downstream tests proving `aligned_acoustic_features` uses measurement spans and that the V3 adapter/UI preserves raw display boundaries.
- Pin the `photograph` regression to the current model revision:
  - Raw syllable frames remain `32–37`, `47–50`, and `56–73`.
  - Measurement nuclei become `36–42`, `49–53`, and unchanged `60–61`.
- Create a 12-recording vowel-nucleus benchmark with explicit `vowel-nucleus-acoustic` annotations: six open-syllable targets, three vowel-initial boundaries, and three closed/non-edge controls. Existing manifests with `verifiedSpans: null` are not ground truth.
- Acceptance gates:
  - Median nucleus-boundary error no worse than two model frames and p90 no worse than four frames.
  - Open-syllable median error improves by at least one frame over raw CTC coverage.
  - Control nuclei and all raw display spans remain unchanged.
  - No invalid, overlapping, zero-duration, or out-of-audio spans.
  - Focused Python tests, pronunciation logic tests, release-contract tests, and the Chrome Playwright comparison flow pass.

## Candidate Release and Promotion

- Release only from a clean, allowlisted worktree so unrelated current changes remain untouched.
- Build the phoneme-recognizer image, record Git SHA and immutable digest, then deploy it at 0% traffic using `scripts/release/pronunciation-v3.ps1`.
- Smoke-test the private candidate `/readyz` and `/recognize/v2` endpoints with an identity token whose audience is the base service URL. Run the fixed regression and 12-record benchmark against that exact revision.
- Exercise the candidate payload in the local Chrome Playwright admin comparison flow using `C:\Cursor AI\.local\browser-test-credentials.md`, verifying raw gapped overlays, explicit measurement provenance, screenshots, and console output.
- Stop for explicit approval before routing production traffic. After promotion, repeat the Chrome production flow and obtain browser-agent screenshot/console confirmation.
- Roll back immediately to the configured explicit recognizer revision if response contracts, benchmark gates, logs, or live UI evidence differ. Update declared current/rollback revisions only after successful live verification.

## Assumptions

- No production deployment or traffic promotion occurs without separate explicit authorization.
- Stress scoring remains disabled; retraining or enabling a stress model is a later task after the corrected measurement corpus is available.
- No historical comparison backfill is included.

Prepared: Sunday, August 9, 2026, 03:10:14 PM
