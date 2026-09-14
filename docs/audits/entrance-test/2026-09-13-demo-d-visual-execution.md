# Demo D visual execution report

Date: 2026-09-13
Candidate worktree: `C:\Users\Admin\.codex\worktrees\entrance-test-ui-demo-release-20260913\Cursor AI`
Base SHA: `3157c6c40eb7669e9ee22f339877ac668feaa92c`
Design inputs: `C:\Cursor AI\docs\plans\2026-09-13-entrance-test-demo-d-visual-redesign.md`, `C:\Cursor AI\docs\audits\entrance-test\2026-09-13-demo-d-visual-reaudit.md`, and the supplied Signal/Noto artboards.

## Implemented

- Reworked Demo D only toward the refined Signal direction: black shell chrome, white canvas, square geometry, 2px charcoal structure, burnt-orange rule/current marker, and offset primary actions.
- Kept the existing Noto Sans assets and added the `signal-noto-v2` visual revision marker while retaining the existing `REVISION_ID` contract.
- Restored all three canonical speaking passages before their recorders and replaced generic English instructions with section-specific guidance.
- Added compact part navigation, stable accessible blank labels, human-readable review labels, explicit section units, complete flagged-group reachability, and missing-blank disclosures.
- Added a live microphone analyzer path with cleanup, separated elapsed-time updates from full renders, and kept one native audio player per saved take.
- Preserved listening seek continuity through `[data-audio-action="seek"]`, plus dialog, disclosure, media position, playback rate, the exact listening audio node, and focused-field selection across rerenders.
- Removed the mobile sticky task overlay, wrapped listening transport controls, added short-height behavior, 44px touch targets, a focus-visible skip link, a single live region, neutral filled-answer styling, globally numbered review targets, an immediate busy finishing state, and clear saved mic-check retry copy without duplicate duration text.
- Extended the browser harness to run Demo D at desktop, 390px mobile, and 390px short-height mobile widths and to emit external screenshots/manifests for the regression checks.

## Verification

All checks were run in the isolated candidate worktree; no deployment, merge, or push was performed.

| Check | Result |
| --- | --- |
| `npm run test:entrance-test-ui` | PASS — 29/29 |
| `npm run lint:crm` | PASS |
| `npm run test:structure` | PASS — 45/45 |
| Contract-bound structure check against base SHA, external contract, and external before snapshot | PASS — status 0, blocking findings 0 |
| JavaScript syntax checks and `git diff --check` | PASS |
| Chrome browser harness, `--case all` | PASS — candidate desktop/mobile/short-height mobile, synthetic audio, and evaluator host |

Chrome browser evidence:

- Chrome `153.0.8010.36`
- Desktop viewport `1440x1000`
- Mobile viewport `390x844`
- Short-height mobile viewport `390x640`
- Console errors: 0
- Page errors: 0
- All candidate viewports: Noto Sans loaded, visual marker present, every checked screen stayed within the viewport width, mobile task dock did not overlap the task stage, control geometry passed, the single live region and skip-link checks passed, audio-node/playback/caret continuity passed, all four parts were visible, and the full local receipt path passed
- Host: four skins visible, Demo D rated through the ordinary `4/5` path, historical A/B frames revisited
- No `/api/` or Firestore request was observed from the candidate

External evidence root:
`C:\Users\Admin\.codex\audits\entrance-test-d-visual-correction-20260913-01a09b16`

Final all-case manifest:
`browser-correction-all-2\manifest.json`

Final screenshots include:

- `browser-correction-all-2\candidate-desktop-intro.png`
- `browser-correction-all-2\candidate-desktop-speaking.png`
- `browser-correction-all-2\candidate-desktop-review-partial.png`
- `browser-correction-all-2\candidate-desktop-review.png`
- `browser-correction-all-2\candidate-desktop-done.png`
- `browser-correction-all-2\candidate-mobile-intro.png`
- `browser-correction-all-2\candidate-mobile-speaking.png`
- `browser-correction-all-2\candidate-mobile-review-partial.png`
- `browser-correction-all-2\candidate-mobile-review.png`
- `browser-correction-all-2\candidate-mobile-done.png`
- `browser-correction-all-2\candidate-mobile-short-speaking.png`
- `browser-correction-all-2\candidate-miccheck.png`
- `browser-correction-all-2\evaluator-demo-d.png`

## Integrity and scope audit

- The worktree delta contains only the 11 paths declared in `execution-structure-contract.json` plus this declared report output; no generated cache remains.
- Demo D `demo-data.js`, `state.js`, `persistence.js`, `qa.js`, and Noto Sans font assets have no diff from the base SHA.
- The CRM host diff is limited to the Demo D label changing from `D · Noto Focus` to `D · Signal Noto`; A/B/C markup and route behavior remain untouched.
- The external ratings snapshot remains outside the worktree and was not mutated. The implementation continues to use the normal five-star route and does not write synthetic D ratings during the browser run.
- `implementation_plan.md` was not modified.

## Limitations

- This is a local synthetic Demo D evaluator fixture. It does not prove live CRM authentication, production Hosting/Functions behavior, persisted production records, or release provenance.
- Synthetic QA recordings and Chrome fake microphone input verify lifecycle and UI wiring, not speech quality or human listening quality.
- The browser manifest records only expected aborted media/font requests caused by page teardown/navigation; there were no HTTP responses at or above 400, console errors, or page errors in the final run.
- Human accessibility certification and cross-browser behavior remain outside this Chrome-only execution scope.
