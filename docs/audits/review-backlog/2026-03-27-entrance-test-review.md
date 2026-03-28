# Entrance Test Review

## Scope
Learner flow in `public/entrance-test.js`, the public page shell in `public/entrance-test.html`, and route/link tests that exercise the flow.

## Source Of Truth
`public/entrance-test.js`, `public/entrance-test.html`, `src/routes/entrance-tests.js`, `tests/entrance-test-review-regressions.test.js`

## Files Reviewed
`public/entrance-test.js`
`public/entrance-test.html`
`src/routes/entrance-tests.js`
`tests/entrance-test-review-regressions.test.js`
`tests/crm/entrance-test-link-origin.test.js`
`tests/crm/entrance-test-link-runtime.test.js`

## Existing Automated Coverage
`node tests/entrance-test-review-regressions.test.js`
`node tests/crm/entrance-test-link-origin.test.js`
`node tests/crm/entrance-test-link-runtime.test.js`

## Manual Or Runtime Scenarios
Not executed in this pass. Relevant scenarios are draft restore after reload, recording cleanup on step change, upload retry after failure, skip-missing-blanks behavior, and final-submit idempotence.

## Confirmed Findings
1. P1, stale remote progress can override a fresher local draft on reload. The client hydrates server progress first and only falls back to local draft if the server has no progress at all, so a newer local draft is discarded whenever `/session` returns any older saved progress. Relevant locations: `public/entrance-test.js:58`, `public/entrance-test.js:60`, `public/entrance-test.js:227`, `public/entrance-test.js:232`, `src/routes/entrance-tests.js:55`, `src/routes/entrance-tests.js:61`, `src/routes/entrance-tests.js:135`.
2. P1, final submit failure on the last MC/fill question leaves the learner with a disabled submit button and no in-page retry path. `finalizeSubmit()` disables the button before the network call and never restores it on error; the MC/fill handlers only surface a modal. Relevant locations: `public/entrance-test.js:519`, `public/entrance-test.js:558`, `public/entrance-test.js:1161`, `public/entrance-test.js:1164`, `public/entrance-test.js:1178`.

## Closed Concerns
Recording cleanup on step change is present and targeted. The renderer tears down any active recorder when the step changes or no longer matches the speaking question.
Speaking upload failure does preserve a retry path. `submitSpeaking()` clears `appState.uploading`, re-renders the same question, and rethrows so the modal can explain the error.
Server-side final-submit idempotence exists. The submit route rejects already-submitted or revoked tests inside the transaction before writing.
Skip-missing-blanks "stay on page" behavior works: declining skip returns focus to the first missing blank.

## Test Gaps
No automated coverage for learner interactions in `public/entrance-test.js`.
No direct route tests for `/session`, `/progress`, `/speaking/upload`, or `/submit`.
No regression proving the last-question MC/fill submit button is restored after failure.
No regression proving the newest draft source wins when local and remote progress diverge.
No scenario coverage for speaking last-question failure followed by a successful retry.

## Recommended Fix Tasks
`RB-ENT-01 | P1 | Fix draft restore precedence by preserving comparable timestamps in the session payload and choosing the newest draft source | public/entrance-test.js; src/routes/entrance-tests.js | node/jsdom | none`
`RB-ENT-02 | P1 | Restore final-submit controls after MC/fill submit failure and add a retry regression | public/entrance-test.js | jsdom/headless_browser | none`
`RB-ENT-03 | P2 | Add public route tests for /session, /progress, /speaking/upload, and /submit contracts | src/routes/entrance-tests.js | node | none`
`RB-ENT-04 | P2 | Add learner-flow regressions for skip-missing, recording cleanup, upload failure/retry, and last-question submit behavior | public/entrance-test.js | jsdom/headless_browser | none`

## Severity Decision
P1, because the review found two reproducible learner-flow regressions that can block progress or lose draft state.

## Approval Needed
None for test-only follow-up.
