# SRS Browser Edge-Case Test Plan

## Objective

Validate the Vocab Review scheduling system in the live browser against the failure modes most likely to regress after the recent persistence and scheduler cleanup.

This plan is intentionally biased toward edge cases, not just happy paths.

## Scope

In scope:
- Algorithm persistence through onboarding, settings, and reloads
- Review scheduling parity between visible previews and persisted outcomes
- Legacy compatibility for older summary docs and pending-sync payloads
- Mastered-card exclusion
- Early-review state
- Sub-day learning and relearning labels
- Failed-save recovery
- Cross-algorithm migration on review

Out of scope:
- General app smoke coverage unrelated to SRS
- Non-SRS console noise from `api/admin/status` and `api/session-end`
- Writing Challenge behavior except where it can affect SRS persistence side effects

## Environment

Base URL:
- `https://localhost:8443`

Required runtime:
- Local app server running
- Firebase Admin credentials available for fixture seeding and cleanup
- Chromium or Chrome available

Recommended command:

```powershell
node scripts/audit/run-srs-browser-audit.js --base-url https://localhost:8443
```

## Test Data Strategy

Use a disposable Firebase Auth user per run.

Reason:
- Avoid polluting a shared account
- Keep due counts deterministic
- Allow destructive reset between scenarios

Fixture rules:
- Seed only one scenario at a time
- Use lemmas prefixed with `qa_srs_<runId>_<scenario>_`
- Reset `users/{uid}/srs_cards` before each scenario
- Reset `users/{uid}/vocabularyBook/data` before each scenario
- Do not rely on pre-existing user data

## Core Assertions

Every scenario should verify three layers when applicable:
- Browser UI state
- Browser localStorage state
- Firestore persisted state

For review-submit flows, persisted state is the source of truth.

## Pre-Run Checklist

1. Start the local app and confirm `https://localhost:8443` loads.
2. Confirm Firebase Admin initialization works locally.
3. Confirm the SRS audit runner can provision and destroy a disposable user.
4. Clear stale manifests in `tmp/srs-browser-audit/runs/` if cleanup previously failed.
5. Confirm screenshots will be written under `docs/audits/`.

## Scenario Matrix

### 1. Onboarding Local Persistence

Purpose:
- Verify first-time algorithm choice persists locally before server-backed settings are involved.

Setup:
- Fresh disposable user
- No `srsSettings.algorithm` in `users/{uid}/vocabularyBook/data`
- Clear:
  - `srs_algorithm_preference`
  - `srs_preferred_algorithm`
  - `srs_onboarding_complete`
  - `srs_tutorial_seen`
  - `srs_pending_data`

Steps:
1. Open the SRS panel.
2. Start SRS so onboarding appears.
3. Choose `FSRS`.
4. Reload the page.
5. Reopen SRS settings.

Expected:
- Onboarding modal appears exactly once.
- `FSRS` remains selected after reload.
- Firestore summary doc still does not need a server-selected algorithm for the first choice to survive reload.

Artifacts:
- Screenshot of onboarding modal
- Screenshot of settings after reload

### 2. Settings Firestore Persistence

Purpose:
- Verify the settings modal persists the algorithm through the canonical summary-doc path.

Setup:
- User starts with `FSRS` selected locally or in summary doc

Steps:
1. Open SRS settings.
2. Switch algorithm to `SM2`.
3. Save.
4. Poll `users/{uid}/vocabularyBook/data.srsSettings.algorithm`.
5. Reload the page.
6. Reopen settings.

Expected:
- Summary doc stores `srsSettings.algorithm = 'SM2'`.
- UI shows `SM2` after reload.
- No dependency on top-level `users/{uid}.srsSettings`.

Artifacts:
- Screenshot of settings before save
- Screenshot of settings after reload

### 3. SM2 Good-Path Preview/Appy Parity

Purpose:
- Verify the displayed `Good` interval matches the exact persisted card outcome.

Setup:
- One due reviewing SM2 card
- No other due cards

Steps:
1. Open review session.
2. Capture `window.SRSReview.getCurrentReviewSnapshot().ratingOutcomes.good`.
3. Reveal answer.
4. Submit `Good`.
5. Poll the stored card in Firestore.

Expected:
- The displayed `Good` label is non-empty and not `0m`.
- The persisted card matches the cached `good.nextCard`.

Artifacts:
- Screenshot before answer
- Screenshot after submit

### 4. FSRS Good-Path Preview/Apply Parity

Purpose:
- Same as the SM2 case, but for FSRS scheduling.

Setup:
- One due reviewing FSRS card

Steps:
- Same flow as Scenario 3

Expected:
- The persisted card matches the cached FSRS `good.nextCard`.

### 5. Mastered Hidden

Purpose:
- Ensure mastered cards stay out of the due queue and schedule preview.

Setup:
- One mastered card
- One future non-mastered card

Steps:
1. Open SRS.
2. Inspect due queue.
3. Inspect schedule table.

Expected:
- Mastered card never appears in `getWordsDueForReview()`.
- Mastered card is absent from the schedule table.
- Future non-mastered card still appears in the schedule table.

### 6. SM2 to FSRS Migration on Review

Purpose:
- Verify stored due state remains intact until answer, then the card adopts the current target algorithm.

Setup:
- Summary doc algorithm preference is `FSRS`
- Due card is stored as SM2

Steps:
1. Open the due card.
2. Confirm the stored card is currently SM2.
3. Submit `Good`.
4. Poll Firestore card.

Expected:
- Before answer, card data still reflects SM2.
- After answer, persisted card algorithm is `FSRS`.

### 7. FSRS to SM2 Migration on Review

Purpose:
- Mirror Scenario 6 in the opposite direction.

Setup:
- Summary doc algorithm preference is `SM2`
- Due card is stored as FSRS

Expected:
- Before answer, card data still reflects FSRS.
- After answer, persisted card algorithm is `SM2`.

### 8. Sub-Day Relearning Labels

Purpose:
- Ensure minute-based learning labels are sane.

Setup:
- One due relearning card with `interval = 0`

Steps:
1. Open the card.
2. Reveal answer.
3. Read all visible rating labels and the cached review snapshot.

Expected:
- No label is empty.
- No label is `0m`.
- Labels remain consistent with snapshot outcomes.

### 9. Early Review Only

Purpose:
- Verify the UI enters the explicit early-review state when there are no due cards.

Setup:
- No due cards
- At least one future reviewing card

Steps:
1. Open SRS.
2. Start review.
3. Accept the early-review confirmation.

Expected:
- Due queue length is zero before entering review.
- Header or badge reads `Early review`.
- UI does not fall back to an idle zero-due message.

### 10. Failed Save Recovery

Purpose:
- Verify pending-sync persistence and replay.

Setup:
- One due card
- Localhost-only hooks:
  - `failNextCardSaveOnce = true`
  - `failNextSummarySaveOnce = true`

Steps:
1. Open the due card.
2. Submit a rating.
3. Confirm `srs_pending_data` exists in localStorage.
4. Confirm Firestore card is unchanged before replay.
5. Reload.
6. Wait for retry replay.
7. Confirm `srs_pending_data` clears.

Expected:
- Pending payload is written after the synthetic save failure.
- Card and summary replay exactly once.
- `reviewStats.totalReviews` increments once, not twice.

### 11. Legacy Summary Compatibility

Purpose:
- Verify legacy summary docs with root `algorithm` still load correctly.

Setup:
- Seed `users/{uid}/vocabularyBook/data.algorithm = 'FSRS'`
- Omit `srsSettings.algorithm`

Steps:
1. Open the app.
2. Open SRS settings.

Expected:
- UI still loads `FSRS`.
- Saving settings upgrades the summary doc to canonical `srsSettings.algorithm`.
- No breakage occurs if only the legacy root field exists.

### 12. Legacy Pending Payload Compatibility

Purpose:
- Verify older pending-sync payloads still restore algorithm state.

Setup:
- Seed localStorage `srs_pending_data` with:
  - `summary.algorithm = 'SM2'`
  - no `summary.srsSettings`

Steps:
1. Load the app as the matching user.
2. Allow `loadPendingData()` to restore state.
3. Reopen settings or start a review.
4. Allow sync replay.

Expected:
- UI adopts `SM2` from the legacy pending payload.
- Replay writes canonical `srsSettings.algorithm`.
- Legacy payload is cleared after successful replay.

### 13. Rapid Save-and-Reload Settings Race

Purpose:
- Catch timing bugs around settings changes.

Setup:
- Authenticated user

Steps:
1. Open settings.
2. Switch algorithm.
3. Save.
4. Immediately reload before waiting on idle UI.
5. Reopen settings.

Expected:
- Local state still reflects the selection immediately.
- Firestore eventually converges to the same value.
- No split state between localStorage and summary doc after reload.

## Negative Checks

Run these across the matrix where relevant:
- No card marked mastered becomes due again unless explicitly unenrolled and recreated.
- No preview label renders `0m`.
- No review submit creates a second duplicate card document.
- No settings change writes to top-level `users/{uid}.srsSettings`.
- No failed save leaves stale pending data after successful replay.

## Manual Inspection Checklist

For each scenario:
- Check the visible label text.
- Check browser console for SRS-specific errors.
- Check localStorage keys relevant to SRS.
- Check Firestore documents directly.
- Capture at least one screenshot at the assertion point.

## Pass Criteria

The plan passes when:
- Every scenario completes with expected UI and Firestore state.
- No SRS-specific console errors appear outside the intentional failure-injection scenario.
- Cleanup completes and the disposable user is deleted.

## Reporting Format

For each run, record:
- Scenario name
- Pass or fail
- Repro steps
- Actual vs expected
- Screenshot path
- Firestore evidence
- Console evidence

Recommended artifact root:
- `docs/audits/<date>-srs-browser-audit/artifacts/`

## Recommended Execution Order

1. Onboarding local persistence
2. Settings Firestore persistence
3. SM2 preview/apply parity
4. FSRS preview/apply parity
5. Mastered hidden
6. SM2 to FSRS migration
7. FSRS to SM2 migration
8. Sub-day relearning labels
9. Early review only
10. Failed save recovery
11. Legacy summary compatibility
12. Legacy pending payload compatibility
13. Rapid save-and-reload race

## Notes

The legacy compatibility scenarios matter because the current code intentionally preserves read compatibility for:
- Older summary docs with root `algorithm`
- Older pending-sync payloads with root `summary.algorithm`

That compatibility should stay until there is an explicit migration or a cleanup release that removes it intentionally.
