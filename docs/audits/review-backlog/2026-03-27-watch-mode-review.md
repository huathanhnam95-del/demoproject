# Watch Mode Review

## Scope
Learner-side watch mode rendering and workbook loading in `public/watch-mode.js`, with admin comparison in `public/watch-admin.js`.

## Source Of Truth
`public/watch-mode.js`, `public/watch-admin.js`, `public/sw.js`, `docs/specs/features/watch-mode.md`

## Files Reviewed
`public/watch-mode.js`
`public/watch-admin.js`
`public/watch-admin.html`
`public/index.html`
`public/js/lazy-loader.js`
`public/script.js`
`public/sw.js`

## Existing Automated Coverage
No direct learner-side watch tests were found.

## Manual Or Runtime Scenarios
Not executed in this pass. Relevant scenarios are hostile workbook strings, admin-to-learner freshness after workbook update, question-marker rendering, and MC/open-ended submission.

## Confirmed Findings
1. High, stored XSS risk in learner rendering. `renderVideoGrid()`, `renderMCOptions()`, and `updateQuestionMarkers()` build HTML strings with dynamic workbook/question data and inline handlers. The learner path does not consistently escape interpolated fields, so hostile `id`, `title`, `option`, or question text can reach `innerHTML` or `onclick` attributes. Relevant locations: `public/watch-mode.js:233`, `public/watch-mode.js:234`, `public/watch-mode.js:521`, `public/watch-mode.js:522`, `public/watch-mode.js:858`, `public/watch-mode.js:864`.
2. Medium, stale workbook fetch behavior. Learner mode fetches `EXCEL_PATH` without cache-busting or `cache: 'no-store'`, while admin mode already uses a timestamp query string for `Videos.xlsx`. The learner request also sits behind a cache-first service worker path for non-navigation GETs, so learners can be served stale workbook content after admin updates. Relevant locations: `public/watch-mode.js:154`, `public/sw.js:84`, `public/sw.js:104`, `public/watch-admin.js:288`.

## Closed Concerns
Admin rendering already escapes the same classes of fields with `escapeHTML()`. The mismatch is specific to the learner path, not the admin editor.

## Test Gaps
No direct regression test covers learner rendering safety.
No direct regression test covers workbook freshness after admin sync.

## Recommended Fix Tasks
`RB-WATCH-01 | High | Replace learner string-built cards/options/markers with escaped DOM rendering and delegated events | public/watch-mode.js | jsdom | security_signoff`
`RB-WATCH-02 | Medium | Align learner workbook fetch with admin freshness policy | public/watch-mode.js | node | none`
`RB-WATCH-03 | Medium | Add regression tests for hostile workbook strings and workbook refresh behavior | tests/watch-mode*.test.* | jsdom | none`

## Severity Decision
High, because the learner path has a concrete XSS surface and the freshness mismatch can show stale content after admin changes.

## Approval Needed
`security_signoff` for the rendering fix. No approval needed for the freshness or test-only follow-ups.
