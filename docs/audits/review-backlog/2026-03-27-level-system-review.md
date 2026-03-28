# Level-system Review

## Scope
Skill-tree rendering, unlock state, and interaction logic in `public/js/modules/level-system.js`, with consumer context from `public/auth-ui.js` and `public/shop-module.js`.

## Source Of Truth
`public/js/modules/level-system.js`, `public/auth-ui.js`, `public/shop-module.js`, `docs/specs/rpg-skill-tree-full-review.md`, `docs/specs/journey-skill-tree-filters-and-unlocks.md`

## Files Reviewed
`public/js/modules/level-system.js`
`public/auth-ui.js`
`public/shop-module.js`

## Existing Automated Coverage
No direct level-system tests were found.
Verified syntax with `node --check public/js/modules/level-system.js`.

## Manual Or Runtime Scenarios
Not executed in this pass. Relevant scenarios are multi-parent unlock logic, coin gating, detail-panel state, category switching, and zoom/pan interaction.

## Confirmed Findings
No confirmed defect from this review pass.

## Closed Concerns
The unlock-state derivation uses `parentIds` for branching trees, falls back to a primary `parentId` when needed, and gates unlocks on both parent availability and branch level. Detail rendering escapes node title text and uses event listeners for unlock actions.

## Test Gaps
No direct test proves multi-parent availability.
No direct test proves coin-gated unlock behavior.
No direct test proves category switching preserves expected viewport state.

## Recommended Fix Tasks
`RB-SKILL-01 | Warning | Add direct tests for unlock-state derivation, multi-parent availability, and viewport interaction state | public/js/modules/level-system.js; tests/level-system*.test.* | jsdom | none`

## Severity Decision
Warning, because the review did not confirm a bug but the branching-tree behavior is untested.

## Approval Needed
None for test-only follow-up.
