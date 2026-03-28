# Writing Challenge Summary Queue Hardening Plan

## Goal
Make the Writing Challenge summary queue deterministic, observable, and easy to verify. The next fix is not about prompt/help coherence anymore. That bug class is already addressed. The remaining risk is the summary queue path, especially `Skip Challenge` consumption and the fact that QA currently has to infer queue state from behavior instead of reading it directly from the UI.

Success means:
- `Skip Challenge` consumes exactly one queued Writing Challenge.
- `x` dismiss and `Escape` preserve the queue.
- successful completion consumes exactly one queued Writing Challenge.
- the session summary visibly shows how many queued Writing Challenges remain.
- QA can validate queue transitions from the UI alone without inspecting private variables.

## Current State
The current source already indicates the intended behavior:
- Writing Challenge is launched from the session summary, not during active review.
- The summary button callback reads `reviewSession.pendingWritingChallenges?.[0]`.
- The modal exit callback shifts the queue when the close reason is not `dismiss`.
- `Skip Challenge` closes the modal with `reason: 'skip'`.

The problem is not just whether the code is right. The problem is that queue state is managed inside an inline callback in the summary renderer, and the UI does not expose queue count clearly enough for QA to verify skip, dismiss, and success paths with confidence.

That creates two risks:
1. The queue behavior is brittle because it depends on closure-scoped logic in the summary rendering path.
2. Browser testing is ambiguous because the user only sees a button, not the queue count or queue state transitions.

## Scope
In scope:
- centralize summary queue state transitions
- expose queue count in the summary UI
- keep modal exit semantics deterministic
- add regression coverage for queue consumption and preservation
- produce a browser plan that validates the post-fix behavior

Out of scope:
- changing Writing Challenge trigger rules
- changing prompt generation
- changing context coherence logic
- redesigning draft persistence
- redesigning AI Check behavior
- auto-opening the next challenge after skip

## Locked Product Decisions
- Writing Challenge remains summary-launched only.
- `Skip Challenge` does not auto-open the next queued challenge.
- After `skip` or successful completion, the user returns to summary and sees the updated queue count.
- `x` dismiss and `Escape` preserve the queue and return to summary unchanged.
- Queue count becomes a visible summary UI affordance, not just an internal array length.
- The fix does not change Writing Challenge trigger rules, draft behavior, or AI Check logic.

## Public APIs and UI Additions

### New internal summary queue helpers
Add these helpers in [public/srs-review.js](/c:/Cursor%20AI/public/srs-review.js):

```js
getPendingWritingChallengeCount()
getNextPendingWritingChallenge()
consumePendingWritingChallenge(reason)
renderWritingChallengeSummaryControls()
launchQueuedWritingChallengeFromSummary()
handleWritingChallengeSummaryExit(reason)
```

Expected responsibilities:
- `getPendingWritingChallengeCount()` returns the current queue length.
- `getNextPendingWritingChallenge()` returns the current queue head or `null`.
- `consumePendingWritingChallenge(reason)` removes exactly one queue head for consuming reasons only.
- `renderWritingChallengeSummaryControls()` renders the summary CTA and queue status from current state.
- `launchQueuedWritingChallengeFromSummary()` launches the current queue head and routes exit handling correctly.
- `handleWritingChallengeSummaryExit(reason)` is the only place where summary-driven queue consumption logic runs.

### Summary UI additions
Add these summary affordances:
- `#srs-writing-summary-status`
  - visible text such as:
    - `1 Writing Challenge ready`
    - `2 Writing Challenges ready`
- `#srs-summary[data-pending-writing-count="<n>"]`
  - stable, observable state for browser QA
- Keep `#srs-writing-summary-btn` as the launch CTA

Rendering rules:
- queue count `0`
  - hide or remove the status line
  - remove the CTA
- queue count `1`
  - show `1 Writing Challenge ready`
  - show CTA
- queue count `n > 1`
  - show `<n> Writing Challenges ready`
  - show CTA

## Work Packages

### Package 1: Centralize summary queue state transitions
Files:
- [public/srs-review.js](/c:/Cursor%20AI/public/srs-review.js)

Changes:
- Remove inline queue mutation logic from the `#srs-writing-summary-btn` click callback inside `showSessionSummary()`.
- Replace it with helper-driven flow:
  - `launchQueuedWritingChallengeFromSummary()`
  - `handleWritingChallengeSummaryExit(reason)`
  - `consumePendingWritingChallenge(reason)`
- `handleWritingChallengeSummaryExit(reason)` rules:
  - `dismiss` -> preserve queue, rerender summary controls
  - `skip` -> consume one, rerender summary controls
  - `auto-complete` -> consume one, rerender summary controls
  - `complete` -> consume one, rerender summary controls
  - unknown reason -> preserve queue unless explicitly defined as consuming

Done when:
- queue transitions come from one source of truth
- summary state is recomputed from live queue state after every modal exit

### Package 2: Make queue state visible and testable
Files:
- [public/srs-review.js](/c:/Cursor%20AI/public/srs-review.js)
- [public/style.css](/c:/Cursor%20AI/public/style.css)

Changes:
- Add a visible queue status line to the session summary.
- Add `data-pending-writing-count` to the summary container.
- Style the status line as informational, not celebratory or warning-oriented.

Done when:
- a human tester can verify queue decrement from the UI alone
- no one needs to inspect private variables to confirm skip or success behavior

### Package 3: Summary launch helper wiring
Files:
- [public/srs-review.js](/c:/Cursor%20AI/public/srs-review.js)

Changes:
- Add `launchQueuedWritingChallengeFromSummary()`:
  - reads the current queue head
  - no-ops safely if the queue is empty
  - disables the summary button while opening
  - launches the modal for the queue head
  - always routes modal exit into `handleWritingChallengeSummaryExit(reason)`
- Ensure the summary button is re-enabled after dismiss, skip, or success if the CTA still exists.
- Ensure repeated launches always use the current queue head after each rerender.

Done when:
- repeated open/close cycles always reflect current queue state correctly

### Package 4: Keep modal behavior compatible
Files:
- [public/js/writing-challenge.js](/c:/Cursor%20AI/public/js/writing-challenge.js)

Changes:
- Verify `handleSkip()` always resolves through `close({ reason: 'skip' })`.
- Verify the close callback fires exactly once per launch.
- Verify successful completion still reports a consuming reason such as `auto-complete`.
- Make only minimal changes needed for deterministic summary behavior.

Done when:
- summary queue logic can trust modal exit reasons
- no prompt, draft, or AI behavior is accidentally redesigned

### Package 5: Add regression coverage for queue semantics
Files:
- add targeted tests under [tests](/c:/Cursor%20AI/tests)

Add tests for:
- dismiss preserves queue length
- skip consumes exactly one
- success consumes exactly one
- summary UI status text matches queue length
- CTA disappears when queue reaches zero
- CTA remains when queue stays above zero
- next launch uses the new queue head after one consume

Done when:
- queue semantics are covered outside the browser

### Package 6: Update QA docs
Files:
- [docs/testing/2026-03-27-writing-challenge-retest-checklist.md](/c:/Cursor%20AI/docs/testing/2026-03-27-writing-challenge-retest-checklist.md)
- [docs/testing/2026-03-27-writing-challenge-summary-queue-browser-test-plan.md](/c:/Cursor%20AI/docs/testing/2026-03-27-writing-challenge-summary-queue-browser-test-plan.md)

Changes:
- remove ambiguous references to inferred queue internals from the retest checklist
- add a new focused browser plan that validates visible queue count, skip semantics, and deferred coverage areas

Done when:
- QA can validate the feature without relying on assumptions about internal variable names

## Verification
Engineering verification:
- targeted tests for queue semantics
- manual browser check that `dismiss`, `skip`, and `success` each produce the expected visible summary state

QA verification:
- confirm summary status text and `data-pending-writing-count` stay in sync
- confirm `Skip Challenge` consumes exactly one queued item
- confirm `x` and `Escape` preserve queue
- confirm phrase-card, missing-user-doc, mobile, and Edge paths are covered by the follow-on plan

## Acceptance Criteria
- Summary queue behavior is managed by centralized helpers.
- Summary UI visibly exposes queue count.
- `Skip Challenge` consumes exactly one queued challenge.
- `x` dismiss preserves queue.
- `Escape` preserves queue.
- successful completion consumes exactly one queued challenge.
- browser QA can validate queue behavior from visible UI state alone.
- the new browser plan explicitly covers phrase-card path, missing-user-doc path, mobile smoke, and Edge reruns.

## Assumptions
- The unresolved next fix is the summary queue path, not the already-cleared context coherence bug.
- `Skip Challenge` should return the user to summary instead of auto-opening the next queued challenge.
- The report’s `_writingChallengeQueue` reference is treated as non-authoritative because it does not match the current implementation surface.
- Existing AI Check, draft, and modal-context coherence behavior remains unchanged unless minimal compatibility hardening is required.
