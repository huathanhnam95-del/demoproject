# Survival Mode Review

## Scope
Runtime loop, spawning, collision, and rendering in `public/js/survival-game/SurvivalGame.js`, `EntityManager.js`, `Renderer.js`, and `GameConfig.js`.

## Source Of Truth
`public/js/survival-game/SurvivalGame.js`, `public/js/survival-game/EntityManager.js`, `public/js/survival-game/Renderer.js`, `public/js/survival-game/GameConfig.js`, `docs/specs/features/survival-mode.md`

## Files Reviewed
`public/js/survival-game/SurvivalGame.js`
`public/js/survival-game/EntityManager.js`
`public/js/survival-game/Renderer.js`
`public/js/survival-game/GameConfig.js`
`tests/survival-balance.test.mjs`
`tests/survival-config-balance.test.mjs`
`tests/survival-modal-input.test.mjs`

## Existing Automated Coverage
`node tests/survival-balance.test.mjs`
`node tests/survival-config-balance.test.mjs`
`node tests/survival-modal-input.test.mjs`

## Manual Or Runtime Scenarios
Not executed in this pass. Relevant scenarios are spawn cadence, wave increment, projectile/enemy removal, shield/buffer/overlap behavior, and modal/input isolation.

## Confirmed Findings
No confirmed gameplay defect from this review pass.

## Closed Concerns
The core loop advances `runTime`, decrements the wave timer, increments waves when the timer elapses, and routes spawns through `spawnEnemy()`. Modal typing is isolated through `handleModalTyping()`, and shield/buffer handling is explicitly modeled in `EntityManager`.

## Test Gaps
The runtime loop has no deterministic integration test.
Spawn and collision logic are not covered by direct tests.
No seeded RNG or fake clock seam is currently exposed for repeatable runtime verification.

## Recommended Fix Tasks
`RB-SURV-01 | Warning | Add deterministic seams for clock, RAF, RNG, and spawn scheduling before deeper runtime tests | public/js/survival-game/SurvivalGame.js; public/js/survival-game/EntityManager.js; public/js/survival-game/RhythmController.js | node | none`
`RB-SURV-02 | Warning | Add runtime tests for wave progression, ambient/beat spawn cadence, and boss-phase spawn gating | public/js/survival-game/SurvivalGame.js; public/js/survival-game/RhythmController.js | node | none`
`RB-SURV-03 | Warning | Add runtime tests for projectile collision, turret shots, player-hit transitions, and overlap resolution | public/js/survival-game/EntityManager.js | node | none`

## Severity Decision
Warning, because the review did not confirm a defect but the runtime-critical paths are under-covered.

## Approval Needed
None for test-seam or coverage follow-up.
