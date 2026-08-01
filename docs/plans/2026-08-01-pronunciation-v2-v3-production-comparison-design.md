# Pronunciation V2/V3 Production Comparison Design

**Date:** August 1, 2026

**Status:** Approved
**Owner:** Authenticated production admin

## Goal

Let the production admin record a word once, inspect V2 and V3 pronunciation analyses side by side, optionally correct syllable boundaries manually, and permanently save a four-way accuracy judgment with the full recording and both analysis payloads.

## Scope

This is an admin testing workflow inside the existing Pronounce mode. It does not make V3 the default learner engine and does not remove or weaken the existing manual-syllable marking function.

The production workflow must support:

- one recording analyzed by both V2 and V3;
- V2 and V3 results displayed with the same labels and metrics;
- a shared waveform that can inspect either automatic boundary set;
- the existing manual boundary editor;
- four judgments: `v2`, `v3`, `tie`, and `neither`;
- explicit save rather than automatic save;
- permanent admin-only storage of the WAV, both raw results, metadata, judgment, and optional manual boundaries;
- preservation of partial failures for debugging.

## Architecture

### Comparison analysis

Add a comparison response to the pronunciation backend while global V3 remains in `shadow` mode. The comparison request uploads one WAV plus the target word, canonical reference IPA, expected syllable count, and variant ID. The backend runs the existing V2/Praat analysis and the V3 phoneme-plus-acoustic analysis from that same request and returns both versioned payloads.

The response is shaped for comparison rather than learner scoring:

```json
{
  "schemaVersion": "pronunciation-comparison-v1",
  "comparisonId": "...",
  "mode": "comparison",
  "v2": { "status": "available", "analysis": {} },
  "v3": { "status": "available", "analysis": {} },
  "context": {
    "targetWord": "photograph",
    "referenceIpa": "/.../",
    "expectedSyllables": 3,
    "variantId": "..."
  },
  "versions": {
    "serviceRevision": "...",
    "v2AnalysisVersion": "...",
    "v3AnalysisVersion": "...",
    "modelRevision": "..."
  }
}
```

One engine failing must not erase the other engine's result. A failed side returns a normalized unavailable state with a stable reason code. The endpoint is for comparison data only; it does not change the normal learner response path.

### Admin UI gate

The comparison interface is enabled by a dedicated feature flag and the existing `/api/admin/status` authorization check. An authenticated admin sees the dual workflow. Non-admin and future learner sessions retain the existing Pronounce behavior.

The analysis endpoint processes only audio supplied by the caller and exposes no stored data. Permanent saving remains protected by the existing Firebase admin middleware.

### Permanent storage

Add a separate admin-only route for comparison records. Do not write these experimental judgments into the segmentation corpus collection.

- Firestore collection: `pronunciation_analysis_comparisons`
- Storage prefix: `pronunciation-analysis-comparisons/<comparisonId>.wav`
- Route: `/api/admin/dev/save-analysis-comparison`

Each record contains:

- comparison ID and source hash;
- storage path and validated WAV metadata;
- word, reference IPA, expected count, and variant ID;
- complete V2 and V3 analysis payloads;
- concise derived count/timing/rateability metrics;
- judgment enum: `v2`, `v3`, `tie`, or `neither`;
- optional manually reviewed syllable spans;
- comparison status: `complete` or `partial_failure`;
- exact service, analysis, and model revisions;
- authenticated UID/email and server timestamps.

The route rejects missing audio, malformed WAV, unsupported judgments, oversized payloads, invalid spans, client-supplied identity fields, and unbounded analysis JSON.

## UI design

### Result comparison

Use the existing Pronounce results region. Avoid adding nested cards inside the current container. Present two aligned result columns:

- `V2 · Acoustic / Praat`
- `V3 · Phoneme + acoustic`

Each column uses the same row order:

1. availability and rateability;
2. observed syllable count;
3. syllable labels and time spans;
4. primary-stress evidence or explicit unavailable reason;
5. pitch/intensity/timing summary;
6. analysis/model revision.

Differences use restrained highlights rather than winner styling before the admin votes. On narrow screens, V2 stacks above V3 while labels remain identical.

### Waveform and manual boundaries

Keep one shared learner waveform below the comparison. Add `Inspect V2 boundaries` and `Inspect V3 boundaries` controls that reload the same audio with the selected automatic span set. Preserve the current manual-review entry point and editing behavior.

Manual spans are version-independent human evidence. Once edited, they remain intact while switching the automatic inspection source and are included in the saved comparison.

### Judgment and save

Show four large, keyboard-accessible choices:

- V2 is more accurate
- V3 is more accurate
- About the same
- Neither is accurate

The Save comparison button remains disabled until one judgment is selected. Saving reports progress, success with the comparison ID, or a recoverable error without discarding the recording or manual spans.

If either engine is unavailable, hide the accuracy vote and show `Save comparison failure`. The saved partial-failure record includes the successful payload and exact normalized error.

## Data flow

```text
Record once
  -> comparison analysis request
      -> V2/Praat result
      -> V3 phoneme + Praat result
  -> render aligned V2/V3 results
  -> inspect V2 or V3 automatic boundaries
  -> optionally mark manual boundaries
  -> choose V2 / V3 / tie / neither
  -> authenticated explicit save
      -> Firebase Function validates metadata and WAV
      -> Storage saves WAV
      -> Firestore saves comparison record
```

## Error handling

- A V2 failure does not suppress an available V3 result.
- A V3 failure does not suppress an available V2 result.
- A partial result is saved as a failure record rather than an accuracy vote.
- Authentication expiration prompts the admin to sign in again without clearing the local comparison state.
- Save failures retain the recording, results, vote, and manual spans for retry.
- A new recording clears the previous unsaved comparison only after an explicit confirmation when necessary.
- Backend reason codes remain visible in a technical details disclosure for debugging.

## Accessibility

- Use real buttons and fieldset/radio semantics for the judgment choices.
- Preserve visible focus states and full keyboard operation.
- Announce analysis and save state through existing polite live regions.
- Do not use color alone to distinguish V2, V3, available, unavailable, or selected states.
- Maintain readable order when the comparison stacks on mobile.

## Verification

### Automated

- Python unit and route tests for dual-result behavior, partial failures, stable reason codes, and shadow-mode isolation.
- JavaScript tests for comparison API serialization, result normalization, judgment state, save payload construction, and retry behavior.
- Firebase route tests for admin authorization, WAV validation, enum validation, size limits, span bounds, storage path, and Firestore record shape.
- Chrome-only Playwright tests for one recording, aligned V2/V3 rendering, four judgments, manual marking, successful save, partial failure, keyboard operation, and mobile stacking.

### Visual and production evidence

- Local Chrome screenshots at desktop and mobile widths.
- Interactive browser confirmation after the Playwright pass when richer waveform evidence is useful.
- Production smoke using `C:\Cursor AI\.local\browser-test-credentials.md` without copying credentials into artifacts.
- Verify deployed Hosting assets, Firebase Functions revision, Cloud Run revision, comparison save, stored Firestore record, signed audio retrieval, and unchanged non-admin Pronounce behavior.

## Deployment order

1. Deploy and verify the Cloud Run comparison response while keeping global V3 shadow mode.
2. Deploy and verify the admin-only Firebase save route.
3. Deploy Hosting with the comparison UI feature enabled for authenticated admins.
4. Run authenticated production Chrome comparison and save one clearly labeled smoke sample.
5. Confirm the stored record and audio, then retain or remove the smoke sample according to the audit procedure.

Each production layer has an independently recorded revision and rollback target. Learner-facing V3 activation remains a separate decision.
