# Writing Challenge Retest Checklist

## Purpose
This checklist is a strict rerun for the disputed Writing Challenge results in the walkthrough report. It is designed to separate current-build regressions from stale-build or cached-bundle noise.

The primary disputed behaviors are:
- summary-only launch
- dismiss with `x` preserving the queued challenge
- `Escape` closing the modal
- skip consuming exactly one queued challenge

This checklist also reconfirms the actual high-value fix:
- prompt, collocation pills, POS badge, and `Need more help?` all stay on the same challenge context

## Rules
- Test only on the latest local build.
- Hard refresh before each independent case group.
- Record exact environment for every case:
  - branch or commit
  - URL
  - browser and version
  - account used
  - whether cache and site data were cleared
- For every failed case, capture:
  - one screenshot before the action
  - one screenshot after the unexpected result
  - console note
  - network note if relevant
- Do not mark a case failed unless the observed result contradicts the expected result written below.

## Reset Protocol
Run this before each major case group and before any case involving stale state:
1. Sign out.
2. Close all app tabs except one.
3. Clear site data for the app origin.
4. Unregister the service worker if present.
5. Clear Cache Storage and IndexedDB if present.
6. Clear localStorage keys:
   - every key starting with `srs_draft_`
   - `SRS_SKIP_AI`
   - `srs_pending_data`
7. Hard refresh.
8. Sign back in to the intended fixture account.
9. Confirm:
   - no Writing Challenge modal visible
   - no scaffolding panel visible
   - no summary CTA visible unless already at summary
   - no restored draft for the target word

## Fixture Requirements
Use these labels in the test notes:
- `F-A`: account or session that can produce a Writing Challenge from review
- `F-B`: multi-option word challenge
- `F-C`: different second word for reopen regression
- `F-D`: AI success account
- `F-E`: AI failure or throttled request setup
- `F-F`: optional missing-user-doc account

## Section 1: Sanity Check Current Build

### RT-00 Build Identity
Goal: prove the test is running against the current bundle, not a stale cached build.

Steps:
1. Open the app.
2. Hard refresh once more.
3. Open DevTools Network tab.
4. Confirm main JS assets are freshly loaded from the expected local origin.
5. Note timestamp, commit, or branch in the test log.

Expected:
- no ambiguity about which build is under test
- no obvious stale cached assets

Evidence:
- screenshot of app loaded
- short note with build identity

## Section 2: Revalidate The Reported Blockers

### RT-01 Summary-Only Launch
Goal: retest the report's `WC-01` blocker.

Preconditions:
- `F-A`
- clean reset completed

Steps:
1. Start Daily Review.
2. Complete one review card that should queue Writing Challenge.
3. Watch the UI immediately after rating or submitting that card.
4. Continue until session summary.

Expected:
- Writing Challenge does not auto-open during active review
- review continues normally
- `Try Writing Challenge` appears only at summary

Fail only if:
- the modal opens before summary while review is still active

Capture:
- screenshot right after the qualifying review action
- screenshot at summary showing CTA or absence of CTA
- console note

Notes to record:
- whether the qualifying card was phrase-based or word-based
- which rating path triggered it

### RT-02 Dismiss With X Preserves Queue
Goal: retest the report's `WC-04` blocker.

Preconditions:
- summary CTA visible from `RT-01`

Steps:
1. Click `Try Writing Challenge`.
2. Wait for the modal to fully appear.
3. Click the `x` close button only.
4. Observe the summary again.
5. Click `Try Writing Challenge` a second time.

Expected:
- modal closes
- summary CTA remains visible
- same queued challenge can be reopened

Fail only if:
- CTA disappears immediately after `x`
- reopen is impossible even though no skip or complete happened

Capture:
- screenshot with modal open
- screenshot after `x`
- screenshot after successful reopen

Important:
- do not use overlay click
- do not use `Skip Challenge`
- do not wait for auto-close after submit

### RT-03 Escape Closes Modal
Goal: retest the report's `WC-05` blocker.

Preconditions:
- modal is open from summary

Steps:
1. Click inside the modal body once to ensure focus is in the app.
2. Press `Escape` once.
3. Observe the result.
4. Reopen the modal.
5. Press `Escape` again with focus inside the textarea.

Expected:
- modal closes on Escape
- review summary remains visible
- queued item is preserved

Fail only if:
- Escape does nothing while modal is visibly open
- Escape closes the whole review panel first

Capture:
- screenshot before Escape
- screenshot after Escape
- console note

Notes:
- record where focus was when Escape was pressed

### RT-04 Skip Consumes Exactly One
Goal: correct the earlier partial verdict and test against the actual contract.

Preconditions:
- at least one queued challenge
- ideally two queued challenges for the second half

Steps:
1. Open the modal from summary.
2. Click `Skip Challenge`.
3. Observe summary state.
4. If a second queued challenge exists, click CTA again.

Expected:
- one queued challenge is consumed
- if only one existed, CTA disappears
- if two existed, CTA remains for the next one

Do not fail because:
- the next challenge does not auto-open immediately

Fail only if:
- skip does not consume the current queued item
- queue count behaves inconsistently

Capture:
- screenshot before skip
- screenshot after skip
- optional second screenshot if a second queued challenge exists

## Section 3: Reconfirm The Actual Fix

### RT-05 Multi-Option Coherence
Goal: reconfirm the original prompt/help mismatch is fixed.

Preconditions:
- `F-B`

Steps:
1. Open a multi-option Writing Challenge.
2. Confirm selection cards are visible.
3. Choose one collocation.
4. Open `Need more help?`

Expected:
- prompt matches selected collocation
- common phrases match the active word
- POS badge matches the active word
- example sentences and extras match the same word and challenge context

Fail only if:
- prompt, pills, and help panel reference different words

Capture:
- screenshot after option selection
- screenshot with help panel open

### RT-06 Reopen On Different Word
Goal: retest stale-carryover prevention.

Preconditions:
- `F-B` then `F-C`

Steps:
1. Open challenge for word A.
2. Select a collocation.
3. Close modal with `x`.
4. Open challenge for word B.
5. Open `Need more help?`

Expected:
- no text, pills, POS, starter, or examples from word A remain

Fail only if:
- any visible content from A appears in B

Capture:
- screenshot of word A state
- screenshot of word B state

### RT-07 Help Before And After Selection
Goal: verify help follows the active modal context both before and after a collocation choice.

Preconditions:
- multi-option challenge

Steps:
1. Open challenge.
2. Open `Need more help?` before selecting an option.
3. Close help.
4. Select a collocation.
5. Reopen help.

Expected:
- help belongs to the active challenge word in both states
- no stale prior-word content

Capture:
- screenshot before selection with help open
- screenshot after selection with help open

## Section 4: Draft And Persistence Retest

### RT-08 Draft Persists On Same Challenge
Goal: verify close and reopen preserves work.

Steps:
1. Type a partial sentence.
2. Click `x`.
3. Reopen the same challenge.

Expected:
- draft is restored

Capture:
- screenshot before close
- screenshot after reopen
- localStorage note for matching `srs_draft_*`

### RT-09 Draft Isolation Across Words
Goal: verify no cross-word leakage.

Steps:
1. Save draft for word A.
2. Open challenge for word B.

Expected:
- B input does not contain A's draft

Capture:
- screenshot of B input
- storage note

### RT-10 Submit Clears Draft
Goal: verify success path removes stored draft.

Steps:
1. Type a valid sentence.
2. Click `Check Sentence`.
3. Wait for success and auto-close.
4. Reopen the same challenge if possible.

Expected:
- draft is gone
- matching `srs_draft_*` entry is removed

Capture:
- screenshot of success state
- storage note

## Section 5: AI Check Retest

### RT-11 AI Check Success
Goal: reconfirm success path with the current context-aware request.

Preconditions:
- `F-D`

Steps:
1. Open a challenge with a chosen collocation if applicable.
2. Enter a valid sentence.
3. Click `AI Check`.

Expected:
- `Thinking...` appears
- AI result renders
- modal stays stable

Capture:
- screenshot of result
- network note for `assessWriting`

### RT-12 AI Failure Fallback
Goal: verify failure does not corrupt the modal.

Preconditions:
- `F-E` or blocked request

Steps:
1. Open a challenge.
2. Enter a valid sentence.
3. Click `AI Check`.
4. Force backend failure.

Expected:
- warning shown
- fallback path remains available or starts
- modal remains open

Capture:
- screenshot of warning or fallback
- console and network note

### RT-13 Close During In-Flight AI
Goal: verify late response cannot mutate a new modal.

Steps:
1. Open challenge A.
2. Trigger AI Check under throttling.
3. Close modal before response returns.
4. Open challenge B.
5. Wait for A's request to finish.

Expected:
- no stale AI result appears in challenge B

Capture:
- screenshot of B after delayed completion
- throttling note

## Section 6: Review-Gating Retest

### RT-14 Wrong Answer Does Not Queue
Goal: reconfirm incorrect review path does not trigger Writing Challenge.

Steps:
1. Answer a review card incorrectly.
2. Continue to summary if needed.

Expected:
- no Writing Challenge CTA from that card

Capture:
- summary screenshot

### RT-15 Ordinary Correct Word Does Not Over-Trigger
Goal: confirm regular correct answers do not queue unexpectedly.

Steps:
1. Complete a normal due word correctly.
2. Continue to summary.

Expected:
- no Writing Challenge CTA unless the item is explicitly eligible

Capture:
- summary screenshot
- note whether the item was phrase or mastery-trigger candidate

## Section 7: Deferred But Valuable
Run only after the three disputed blockers are resolved or disproven:
- `RT-16` Missing-user-doc account
- `RT-17` Phrase-card queue path if a suitable fixture exists
- `RT-18` Mobile smoke
- `RT-19` Edge reruns

## Failure Template
Use this exact structure for any failure:
- `Case ID`
- `Build / branch`
- `Browser / version`
- `Fixture account`
- `Reset completed: yes/no`
- `Observed behavior`
- `Expected behavior`
- `Exact action sequence`
- `Screenshot paths`
- `Console note`
- `Network note`
- `Storage note`

## Interpretation Rule
- If `RT-01`, `RT-02`, or `RT-03` pass on a clean current build, the walkthrough report is stale or invalid on those blockers.
- If one fails, rerun the exact same case once after a full reset before accepting it as real.
- If it fails twice with the same evidence, treat it as confirmed.
