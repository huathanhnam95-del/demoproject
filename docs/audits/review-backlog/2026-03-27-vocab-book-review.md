# Vocabulary Book Review

## Source Of Truth
`public/vocab-book.js`, `docs/specs/features/vocabulary-book.md`, `docs/testing/2026-03-27-vocab-review-writing-challenge-browser-test-plan.md`

## Covered Vs Uncovered From 2026-03-27 Plan
Covered by the browser plan:
- Writing Challenge state coherence
- reopen-different-word stale-state regressions
- queue behavior from summary
- draft persistence
- AI Check success, fallback, and failure recovery

Uncovered by the browser plan:
- vocab capture from Type, Speak, Fill, or Collo-dictate
- Vocabulary Book management flows unrelated to Writing Challenge
- guest import login behavior
- local cache corruption and render-safety of bookmark / missed-word lists

## Files Reviewed
`public/vocab-book.js`
`docs/testing/2026-03-27-vocab-review-writing-challenge-browser-test-plan.md`
`public/srs-review.js`
`public/srs-review-scaffolding.js`

## Existing Automated Coverage
No direct Vocabulary Book tests were found.

## Manual Or Runtime Scenarios
Not executed in this pass. Relevant scenarios are guest/local profile cache behavior, unlock-state transitions, vocab-to-SRS sync, and dictionary boundary integration.

## Confirmed Findings
1. High, stored XSS risk in bookmark list rendering. `renderBookmarkedWords()` injects `w.word` directly into `innerHTML` without escaping. If a bookmarked word or imported record contains hostile markup, it can execute when the list renders. Relevant locations: `public/vocab-book.js:1768`, `public/vocab-book.js:1771`, `public/vocab-book.js:1790`.
2. High, stored XSS risk in frequently missed rendering. `renderFrequentlyMissed()` injects `w.originalWord` directly into `innerHTML` without escaping. A hostile value in the cache or imported state reaches the DOM unsanitized. Relevant locations: `public/vocab-book.js:1852`, `public/vocab-book.js:1861`, `public/vocab-book.js:1876`.

## Closed Concerns
The Writing Challenge browser plan already covers modal coherence, stale-state prevention, queue behavior, and draft persistence. The high-risk render paths above are outside that plan.

## Test Gaps
No direct regression test covers escaped rendering for bookmarked or frequently missed items.
No direct regression test covers local profile cache corruption in the vocab panel.
No direct regression test covers vocab-to-SRS sync edge cases.

## Recommended Fix Tasks
`RB-VOCAB-01 | High | Escape bookmark and missed-word render paths and remove unsafe HTML interpolation | public/vocab-book.js | jsdom | security_signoff`
`RB-VOCAB-02 | Medium | Add regression tests for hostile vocab entries and cache-corruption recovery | tests/vocab-book*.test.* | jsdom | none`

## Severity Decision
High, because there is a concrete stored XSS surface in two render paths.

## Approval Needed
`security_signoff` for the rendering fix. No approval needed for test-only follow-up.

