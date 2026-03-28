# Writing Challenge Summary Queue Browser Test Plan

## Purpose
This browser plan validates the next Writing Challenge fix after the context-coherence work. The target is the summary queue path: whether queue state is visible, whether `Skip Challenge` consumes exactly one queued item, and whether dismiss and success paths preserve or consume the queue correctly.

This plan also closes the deferred coverage gaps left by the earlier retest:
- phrase-card queue path
- missing-user-doc AI path
- mobile smoke
- Edge reruns

## Scope
In scope:
- session summary Writing Challenge queue state
- visible queue count and summary CTA behavior
- `x`, `Escape`, `Skip Challenge`, and successful completion semantics
- queue head advancement across multiple queued items
- phrase-card launch path
- missing-user-doc AI path
- mobile smoke
- Edge confidence reruns

Out of scope:
- full vocab capture regression
- guest-import flows
- Writing Challenge prompt/help coherence revalidation except where needed to confirm queue behavior
- backend unit testing

## Browser Matrix
- Chrome desktop latest: full pass
- Edge desktop latest: selected reruns only
- Chrome DevTools mobile emulation at `390x844`: smoke only

## Preconditions
- local app is running on the expected local origin
- latest build is loaded, not a stale cached bundle
- signed-in QA fixtures are available
- the summary UI includes:
  - `#srs-writing-summary-status`
  - `#srs-summary[data-pending-writing-count]`
  - `#srs-writing-summary-btn`

## Reset And Isolation
Run before each independent suite and before any queue-state retest:
1. Sign out.
2. Close extra app tabs.
3. Clear site data for the app origin.
4. Unregister service worker if present.
5. Clear Cache Storage and IndexedDB if present.
6. Clear local storage keys:
   - every key starting with `srs_draft_`
   - `SRS_SKIP_AI`
   - `srs_pending_data`
7. Hard refresh.
8. Sign back in to the intended fixture account.

Post-reset verification:
- no Writing Challenge modal is visible
- no stale summary CTA is visible unless the fixture intentionally starts at summary
- no stale draft is restored

## Fixture Contract
- `SQ-F1 One Queue`
  - signed-in fixture that reaches summary with exactly one queued Writing Challenge
- `SQ-F2 Two Queue`
  - signed-in fixture that reaches summary with two queued Writing Challenges
- `SQ-F3 Phrase Queue`
  - signed-in fixture that reaches summary with a phrase-derived Writing Challenge
- `SQ-F4 Missing User Doc`
  - authenticated account that can reach Writing Challenge and invoke `AI Check`, but does not yet have the expected Firestore user doc
- `SQ-F5 Mobile`
  - any fixture that reaches summary with one queued Writing Challenge

If deterministic fixtures are not available through normal UI, use seeded or DevTools-assisted setup and label the run clearly.

## Observability Rules
Every case must capture:
- one screenshot at the key end state
- one console note: `no errors` or exact error text
- one network note when relevant
- one queue-state note from visible UI

Queue-state proof must come from:
- the text in `#srs-writing-summary-status`
- the value of `#srs-summary[data-pending-writing-count]`
- presence or absence of `#srs-writing-summary-btn`

Do not use inferred private variables as evidence.

## Cases

### SQ-00 Preflight
Goal: confirm the queue-status UI exists and matches the fixture state.

Steps:
1. Complete reset.
2. Reach the summary state using the intended fixture.
3. Inspect the summary area.

Expected:
- if the queue is empty, the CTA is absent and the status line is hidden or absent
- if the queue is non-empty, the status line is visible and the CTA is present
- `data-pending-writing-count` matches the visible status

Evidence:
- screenshot of summary
- note of visible count text
- note of `data-pending-writing-count`

### SQ-01 One Queued Challenge
Goal: verify the summary renders the single-item state correctly.

Preconditions:
- `SQ-F1 One Queue`

Steps:
1. Reach summary with exactly one queued Writing Challenge.
2. Observe the summary controls.

Expected:
- status line says `1 Writing Challenge ready`
- `data-pending-writing-count="1"`
- `Try Writing Challenge` CTA is visible

Evidence:
- screenshot of summary controls

### SQ-02 Dismiss Preserves One
Goal: verify `x` preserves the queue.

Preconditions:
- `SQ-F1 One Queue`

Steps:
1. Open the Writing Challenge from summary.
2. Wait for the modal to finish opening.
3. Click the `x` close button.
4. Observe the summary again.
5. Reopen the challenge from summary.

Expected:
- modal closes
- status line still says `1 Writing Challenge ready`
- `data-pending-writing-count="1"`
- CTA remains visible
- reopen works

Evidence:
- screenshot with modal open
- screenshot after dismiss
- screenshot after reopen

### SQ-03 Escape Preserves One
Goal: verify `Escape` preserves the queue.

Preconditions:
- `SQ-F1 One Queue`

Steps:
1. Open the Writing Challenge from summary.
2. Click inside the modal body.
3. Press `Escape`.
4. Observe the summary.

Expected:
- modal closes
- summary remains visible
- queue state is unchanged
- CTA remains available

Evidence:
- screenshot after Escape
- focus note

### SQ-04 Skip Consumes Last One
Goal: verify `Skip Challenge` consumes the final queued item.

Preconditions:
- `SQ-F1 One Queue`

Steps:
1. Open the Writing Challenge from summary.
2. Click `Skip Challenge`.
3. Observe the summary.

Expected:
- queue count becomes zero
- CTA disappears
- status line is hidden or removed
- `data-pending-writing-count="0"`

Evidence:
- screenshot before skip
- screenshot after skip

### SQ-05 Skip Consumes First Of Two
Goal: verify `Skip Challenge` consumes exactly one item when two are queued.

Preconditions:
- `SQ-F2 Two Queue`

Steps:
1. Reach summary with two queued Writing Challenges.
2. Open the first challenge.
3. Click `Skip Challenge`.
4. Observe the summary.
5. Open Writing Challenge again.

Expected:
- status line updates to `1 Writing Challenge ready`
- `data-pending-writing-count="1"`
- CTA remains visible
- second launch opens the next queued item, not the skipped one

Evidence:
- screenshot before skip
- screenshot after skip
- screenshot of second launch

### SQ-06 Success Consumes One
Goal: verify successful completion consumes exactly one queued item.

Preconditions:
- `SQ-F1 One Queue` or `SQ-F2 Two Queue`

Steps:
1. Open a queued Writing Challenge from summary.
2. Complete it successfully.
3. Let the modal close and return to summary.

Expected:
- queue count decrements by one
- summary status updates accordingly
- CTA remains only if more queued items remain

Evidence:
- screenshot of success state
- screenshot of returned summary

### SQ-07 Queue Head Advances Correctly
Goal: verify the queue head changes after one item is consumed.

Preconditions:
- `SQ-F2 Two Queue`
- two distinguishable queued challenges, such as different target words or phrases

Steps:
1. Open the first queued challenge.
2. Skip it or complete it successfully.
3. Return to summary.
4. Launch Writing Challenge again.

Expected:
- the second launch opens the next queued challenge
- the first challenge does not reappear

Evidence:
- screenshot of first launch
- screenshot of second launch

### SQ-08 Phrase Card Queue Path
Goal: validate the phrase-card summary queue path.

Preconditions:
- `SQ-F3 Phrase Queue`

Steps:
1. Complete the phrase review card correctly.
2. Reach session summary.
3. Observe queue status.
4. Open the queued Writing Challenge.
5. Skip it or complete it.

Expected:
- phrase success creates visible queue state at summary
- opening the challenge works through the same summary queue controls
- skip and success update queue state correctly

Evidence:
- screenshot of phrase-card summary state
- screenshot of open challenge
- screenshot after skip or success

### SQ-09 Missing User Doc Path
Goal: verify missing-user-doc AI behavior does not break summary return flow.

Preconditions:
- `SQ-F4 Missing User Doc`

Steps:
1. Reach summary with one queued challenge.
2. Open the challenge.
3. Run `AI Check`.
4. Observe the result.
5. Dismiss, skip, or complete and return to summary.

Expected:
- no fatal modal break
- AI succeeds or degrades gracefully
- queue state updates only based on close reason, not AI request status

Evidence:
- screenshot of AI result or graceful degradation state
- network note for `assessWriting`
- screenshot of returned summary

### SQ-10 Mobile Smoke
Goal: verify queue state remains usable on mobile layout.

Preconditions:
- `SQ-F5 Mobile`
- Chrome DevTools emulation at `390x844`

Steps:
1. Reach summary with one queued challenge.
2. Observe summary queue status.
3. Open the challenge.
4. Dismiss once.
5. Reopen and skip or complete once.

Expected:
- queue status is readable
- CTA is tappable
- close and action controls remain reachable
- queue state updates correctly after dismiss and after skip or success

Evidence:
- screenshot of mobile summary
- screenshot of mobile modal
- screenshot of mobile summary after exit

### SQ-11 Edge Rerun
Goal: rerun the most important queue semantics in Edge.

Run these cases in Edge desktop:
- `SQ-02 Dismiss Preserves One`
- `SQ-04 Skip Consumes Last One`
- `SQ-06 Success Consumes One`

Expected:
- same queue semantics as Chrome

Evidence:
- one screenshot per rerun
- one short note confirming browser/version

## Pass Criteria
This fix passes browser QA when all of the following are true:
- summary queue count is visibly exposed and consistent
- `x` preserves queue
- `Escape` preserves queue
- `Skip Challenge` consumes exactly one queued item
- successful completion consumes exactly one queued item
- queue head advances correctly when multiple items are queued
- phrase-card queue path works
- missing-user-doc AI path does not break queue return behavior
- mobile smoke passes
- Edge reruns match Chrome behavior

## Assumptions
- Queue status becomes visible in the summary UI as part of the next fix.
- `Skip Challenge` returns the user to summary instead of auto-opening the next item.
- Chrome desktop is the source-of-truth pass.
- Edge and mobile are confidence passes, not separate release gates.
