# Writing Challenge Browser Test Plan

## Summary
This plan covers browser verification for the Writing Challenge fix. The main bug to prove fixed is the state mismatch where the prompt, collocation pills, POS badge, and `Need more help?` panel could point at different words after reopening the modal or launching from session summary.

The browser pass should prove:
- the modal is internally coherent for a single challenge
- reopening a different challenge does not leak stale state
- queued Writing Challenge items behave correctly at summary time
- draft persistence still works
- AI Check succeeds, fails, and recovers without breaking the modal

## Scope
In scope:
- Daily Review to Writing Challenge launch flow
- summary CTA behavior
- multi-option and single-option Writing Challenge flows
- prompt, collocation, help-panel, and POS coherence
- modal close/reopen and stale-state prevention
- draft persistence
- AI Check success, fallback, and failure recovery
- keyboard dismissal and basic mobile smoke

Out of scope:
- vocab capture from Type, Speak, Fill, or Collo-dictate
- Vocabulary Book management flows unrelated to Writing Challenge
- guest import login behavior
- backend unit testing
- production AI quality evaluation

## Browser Matrix
- Chrome desktop latest: required, full pass
- Edge desktop latest: rerun only for one happy path and one failure path
- Chrome mobile emulation at `390x844`: smoke only

## Preconditions
- Local app is running and reachable
- The browser allowlist includes `localhost` and `127.0.0.1` if using browser-agent
- A signed-in review fixture account is available
- Test data includes:
  - one phrase-based Writing Challenge item
  - one multi-option collocation word
  - one different follow-up word for reopen regression
  - one AI-success path
  - one AI-failure or AI-limit path
  - one missing-user-doc path if available

## Reset And Isolation
Before each independent suite:
1. Sign out and sign back into the intended fixture account.
2. Close extra tabs.
3. Clear site data for the app origin.
4. Unregister the service worker if present.
5. Clear Cache Storage and IndexedDB if present.
6. Clear local storage keys starting with `srs_draft_`.
7. Clear `SRS_SKIP_AI`.
8. Hard refresh.

Post-reset check:
- no Writing Challenge modal is visible
- no scaffolding panel is visible
- no stale summary CTA is visible
- no draft text is restored unless the case explicitly expects it

## Fixture Contract
- `F0 Clean Signed-In Review`
  - signed-in user with at least one due review card and no pending Writing Challenge
- `F1 Phrase Queue Summary`
  - signed-in user whose session can produce a phrase-based Writing Challenge and at least one additional review card after it
  - needed to verify queue snapshot independence from current review index
- `F2 Multi-Option Word`
  - review word with multiple collocations so `#writing-option-container` appears
  - ideal example: the same kind of `apple` case used in the bug report
- `F3 Different Follow-Up Word`
  - a different word from `F2`, ideally something like `policy`, to verify reopen and no stale carryover
- `F4 AI Success`
  - signed-in user with working Firebase auth and backend access for `assessWriting`
- `F5 AI Limited or AI Failure`
  - seeded QA account or mocked failure path for `assessWriting`
- `F6 Missing User Doc`
  - authenticated account that can call the function but does not yet have a populated Firestore user doc
- If deterministic fixtures are not available through normal UI, mark the case `Seeded/DevTools`.

## Observability Rules
- Every case must capture:
  - visible UI state
  - console status
  - relevant network requests
  - relevant storage changes
- Required evidence:
  - screenshot at the key end state
  - console note: `no errors` or exact error
  - network note for:
    - `assessWriting`
    - LanguageTool fallback
    - any sentence or example fetch relevant to scaffolding
  - storage note for:
    - `srs_draft_<word>`
    - `SRS_SKIP_AI`
- Negative assertions must be proven with a reopen, reload, or second-word transition. Do not mark `no stale state` without forcing a state transition.

## Execution Order
1. Preflight and reset
2. Core queue and launch gating
3. Context-coherence happy paths
4. Reopen and stale-state regression
5. Draft persistence and close behaviors
6. AI success and AI fallback behaviors
7. Mobile smoke
8. Edge reruns

## Core Deterministic Cases

### WC-00 Preflight
Goal: confirm a clean start.
Steps:
1. Open the app.
2. Sign in with `F0`.
3. Verify the review dashboard is visible and no challenge modal is open.
Expected:
- clean dashboard state
- no stale modal or help panel

### WC-01 Queue Appears Only At Summary
Goal: verify Writing Challenge does not auto-open during active review.
Steps:
1. Start Daily Review.
2. Complete an eligible review card correctly.
3. Continue until the session summary appears.
Expected:
- no Writing Challenge modal during review
- summary shows `Try Writing Challenge`

### WC-02 Multi-Option Coherence
Goal: verify prompt, collocation pills, POS, and help content all refer to the same challenge word.
Steps:
1. Open the Writing Challenge from summary for a multi-option word.
2. Confirm the selection cards appear.
3. Choose one collocation.
4. Open `Need more help?`.
Expected:
- prompt text matches the selected collocation
- highlighted collocation matches the selected phrase
- POS badge matches the active challenge word
- example sentences and extras belong to that same challenge word

### WC-03 Reopen Different Word Without Stale Carryover
Goal: verify the original apple/policy desync is gone.
Steps:
1. Open a challenge for word A and select a collocation.
2. Close the modal.
3. Open a different challenge for word B.
4. Open `Need more help?`.
Expected:
- no prompt, pill, starter, POS, or examples from word A remain
- word B content is internally consistent

### WC-04 Dismiss Keeps Queue
Goal: verify `x` dismissal does not consume the queued Writing Challenge.
Steps:
1. Open the summary CTA.
2. Close the modal with `x`.
3. Return to the summary.
Expected:
- CTA remains available
- challenge can be reopened

### WC-05 Escape Keeps Queue
Goal: verify `Escape` behaves like dismiss.
Steps:
1. Open the modal.
2. Press `Escape`.
Expected:
- modal closes
- summary CTA remains
- review panel stays open

### WC-06 Skip Consumes Exactly One
Goal: verify `Skip Challenge` advances the queue one item at a time.
Steps:
1. Open the modal.
2. Click `Skip Challenge`.
Expected:
- if one item was queued, the CTA disappears
- if multiple items were queued, only the next one remains

### WC-07 Single-Option Flow
Goal: verify single-option prompts open directly into input mode.
Steps:
1. Open a challenge that resolves to a single option.
Expected:
- no selection cards are visible
- prompt, input, hints, and controls are visible immediately

### WC-08 Help Panel Before And After Selection
Goal: verify the help panel tracks the active modal context.
Steps:
1. Open a multi-option challenge.
2. Open `Need more help?` before choosing an option.
3. Close the help panel.
4. Choose a collocation.
5. Reopen help.
Expected:
- help content is consistent with the active challenge word before and after selection
- no stale prior-word content appears

## Draft Cases

### WC-09 Draft Persists For Same Challenge
Goal: verify closing and reopening restores the draft.
Steps:
1. Type a partial response.
2. Close the modal.
3. Reopen the same challenge.
Expected:
- the draft text returns in the input

### WC-10 Draft Does Not Leak Across Words
Goal: verify draft isolation by word.
Steps:
1. Save a draft in challenge A.
2. Open challenge B.
Expected:
- challenge B does not preload challenge A’s draft

### WC-11 Successful Submit Clears Draft
Goal: verify successful submit removes the saved draft.
Steps:
1. Enter a valid sentence.
2. Click `Check Sentence`.
3. Wait for success feedback and auto-close.
4. Reopen the same challenge if still available.
Expected:
- draft is gone after success
- corresponding `srs_draft_*` entry is removed

## AI Check Cases

### WC-12 AI Check Success
Goal: verify AI Check works and evaluates the displayed task.
Steps:
1. Open a challenge with a selected collocation.
2. Enter a valid sentence using that phrase.
3. Click `AI Check`.
Expected:
- `Thinking...` appears
- AI result renders
- the request includes prompt/collocation context

### WC-13 AI Failure Fallback
Goal: verify backend failure does not corrupt the modal.
Steps:
1. Open a challenge.
2. Click `AI Check`.
3. Force backend failure or block the request.
Expected:
- warning message appears
- fallback grammar path starts or remains available
- modal stays open and input remains intact

### WC-14 AI Limit Path
Goal: verify limit handling is non-blocking.
Steps:
1. Use the AI-limit fixture.
2. Click `AI Check`.
Expected:
- limit message appears
- fallback is available
- submit still works

### WC-15 Missing User Doc Recovery
Goal: verify a missing Firestore user doc does not break the flow.
Steps:
1. Sign in with the missing-doc fixture.
2. Open a challenge.
3. Click `AI Check`.
Expected:
- AI Check either succeeds or degrades gracefully
- the modal does not collapse into a broken state

## Async Regression Cases

### WC-16 Close During In-Flight AI Check
Goal: verify late AI results do not paint a closed or reopened modal.
Steps:
1. Open challenge A.
2. Start `AI Check`.
3. Close the modal before the request returns.
4. Open challenge B.
Expected:
- challenge B does not show challenge A’s AI result

### WC-17 Reopen Different Challenge Before Late Response Returns
Goal: verify request scoping blocks cross-challenge contamination.
Steps:
1. Open challenge A and trigger help loading or AI check.
2. Close it immediately.
3. Open challenge B.
4. Wait for the delayed response from A.
Expected:
- no old collocation pills, help examples, or feedback appear in challenge B

### WC-18 Rapid Reopen Help Safety
Goal: verify help content does not flash stale examples.
Steps:
1. Open help in challenge A.
2. Close the modal.
3. Open challenge B and immediately open help.
Expected:
- only challenge B’s help content is visible

## Review-Gating Cases

### SRS-WC-01 Wrong Answer Plus Manual Good Does Not Queue
Goal: verify a wrong answer plus manual rating does not trigger Writing Challenge.
Steps:
1. Answer a review card incorrectly.
2. Apply a manual positive rating if available.
3. Finish the session.
Expected:
- no Writing Challenge CTA appears for that path

### SRS-WC-02 Ordinary Correct Word Does Not Queue Unless Eligible
Goal: verify ordinary correct answers do not over-trigger Writing Challenge.
Steps:
1. Answer a standard word correctly.
2. Finish the session.
Expected:
- no Writing Challenge CTA from that card

### SRS-WC-03 Phrase Success Queues Summary CTA
Goal: verify phrase success still queues Writing Challenge.
Steps:
1. Complete a phrase card correctly.
2. Finish the session.
Expected:
- summary shows `Try Writing Challenge`

## Mobile Smoke
Run only after desktop passes.

Cases:
1. Open the summary CTA on mobile emulation.
2. Open a challenge.
3. Choose a collocation if available.
4. Open `Need more help?`.
5. Type into the textarea.
6. Click `Check Sentence` or `AI Check`.

Expected:
- close button is reachable
- textarea and primary actions remain visible
- help panel does not trap the user off-screen

## Edge Reruns
Rerun only:
1. WC-02
2. WC-03
3. WC-12 or WC-13

## Pass / Fail Gate
Blockers:
- prompt/help desync across words
- queue item consumed on dismiss
- stale AI or help response appears in a new modal
- missing-doc AI path breaks the modal
- draft leaks between different challenge words

Non-blocking but log:
- minor visual spacing issues
- console warnings unrelated to Writing Challenge behavior
- copy polish issues that do not affect correctness

## Assumptions And Defaults
- The plan assumes signed-in QA fixtures are available.
- If deterministic fixtures are not available through normal UI, use seeded or DevTools-assisted setup and mark those cases clearly.
- Chrome desktop is the source-of-truth pass.
- Edge and mobile are confidence reruns, not separate release gates.
- Guest import is out of scope for this focused plan.

## File Name
`docs/testing/2026-03-27-vocab-review-writing-challenge-browser-test-plan.md`
