# Speaking Controller Rollout Checklist

Evidence tracking for the Unified Speaking Practice Controller migration.

## Wave 0 — Contract and Synthetic Fixture

| Check | Status | Date | Evidence |
|---|---|---|---|
| Synthetic adapter passes browser check | ✅ | 2026-07-20 | 75/75 assertions pass in speaking-controller-browser-check.js |
| Basic/Advanced persistence across page reload | ✅ | 2026-07-20 | Verified in browser check Test 7 |
| Dynamic visibility (Advanced controls hidden in Basic) | ✅ | 2026-07-20 | Verified in browser check Test 3 |
| Focus trap in picker sheet | ✅ | 2026-07-20 | Verified in browser check Test 8 (remediation contract) |
| Focus trap in advanced sheet | ✅ | 2026-07-20 | Verified in browser check Test 8 (remediation contract) |
| DOM restoration after unmount | ✅ | 2026-07-20 | Verified in browser check Test 3 |
| Escape closes deepest sheet | ✅ | 2026-07-20 | Verified in browser check Test 8 |
| No pageerror or console error | ✅ | 2026-07-20 | Verified in browser check Test 6 |
| Responsive: 1440×1200 | ✅ | 2026-07-20 | Verified in browser check |
| Responsive: 768×1024 | ✅ | 2026-07-20 | Verified in browser check |
| Responsive: 390×844 | ✅ | 2026-07-20 | Verified in browser check |
| Reduced motion: no animation | ✅ | 2026-07-20 | Verified in browser check |
| Browser-agent visual confirmation | ✅ | 2026-07-20 | All Wave 0 layout elements verified |

## Wave 1 — RTS and ASQ

| Check | Status | Date | Evidence |
|---|---|---|---|
| RTS picker bridge functional | ⬜ | | |
| ASQ random picker functional | ⬜ | | |
| No-toggle behavior (ASQ/RTS omit toggle) | ⬜ | | |
| Stored preference not overwritten by no-toggle modes | ⬜ | | |
| rts-mode-browser-check.js passes | ⬜ | | |
| rts-mode-full-browser-check.js passes | ⬜ | | |
| asq-mode-browser-check.js passes | ⬜ | | |
| Legacy override variant passes | ⬜ | | |

## Wave 2 — Describe Image and PTE Retell Lecture

| Check | Status | Date | Evidence |
|---|---|---|---|
| DI visibilityScopeId works for step-dependent actions | ⬜ | | |
| Retell Lecture activates only in PTE scope | ⬜ | | |
| English Take Notes remains legacy | ⬜ | | |
| describe-image-mode-browser-check.js passes | ⬜ | | |
| retell-lecture-mode-browser-check.js passes | ⬜ | | |

## Wave 3A — SGD

| Check | Status | Date | Evidence |
|---|---|---|---|
| Dead filter markup removed | ⬜ | | |
| Dead filter code removed from sgd-mode.js | ⬜ | | |
| SGD step orchestration unaffected | ⬜ | | |
| sgd-mode-browser-check.js passes | ⬜ | | |
| practice-modes-browser-check.js updated/passes | ⬜ | | |

## Wave 3B — Repeat Sentence

| Check | Status | Date | Evidence |
|---|---|---|---|
| Speak adapter registered without script.js extraction | ⬜ | | |
| Tutorial targets updated with fallback | ⬜ | | |
| Adaptive difficulty controls in Advanced | ⬜ | | |
| repeat-sentence-mode-browser-check.js passes | ⬜ | | |
| adaptive-difficulty-browser-check.js passes | ⬜ | | |

## Wave 4A — Read Aloud: Picker/Settings

| Check | Status | Date | Evidence |
|---|---|---|---|
| Shared picker replaces visible V7 picker | ⬜ | | |
| Filters in Advanced settings sheet | ⬜ | | |
| Voice settings in Advanced | ⬜ | | |
| Guide controls Advanced-gated in-place | ⬜ | | |
| read-aloud-question-picker-v7 DOM check passes | ⬜ | | |
| read-aloud-audio-matching-check passes | ⬜ | | |

## Wave 4B — Read Aloud: Actions/History

| Check | Status | Date | Evidence |
|---|---|---|---|
| Media controls adopted (record/stop/check/retry) | ⬜ | | |
| History hosts created and used | ⬜ | | |
| Legacy history fallback works | ⬜ | | |
| read-aloud-check.js passes | ⬜ | | |
| practice-attempts-history-browser-check.js passes | ⬜ | | |

## Wave 4C — Read Aloud: Lifecycle Gate

| Check | Status | Date | Evidence |
|---|---|---|---|
| Record → Stop → RECORDED → playback → Check → results | ⬜ | | |
| Retry and Next work | ⬜ | | |
| History refreshes after attempt | ⬜ | | |
| Speech Coach interactions unaffected | ⬜ | | |
| Browser-agent lifecycle evidence | ⬜ | | |

## Wave 5 — Integrated Scope/Default Gate

| Check | Status | Date | Evidence |
|---|---|---|---|
| All targets enabled by default | ⬜ | | |
| PTE scope switching preserves state | ⬜ | | |
| English scope switching preserves state | ⬜ | | |
| All modes at 1440×1200 | ⬜ | | |
| All modes at 768×1024 | ⬜ | | |
| All modes at 390×844 | ⬜ | | |
| practice-scope-toggle-browser-check.js passes | ⬜ | | |
| practice-scope-logged-in-browser-check.js passes | ⬜ | | |

## Wave 6 — Legacy Cleanup

| Check | Status | Date | Evidence |
|---|---|---|---|
| Query override removed | ⬜ | | |
| Obsolete layout wrappers removed | ⬜ | | |
| RA/RTS V7 picker markup removed | ⬜ | | |
| Functional IDs preserved | ⬜ | | |
| #mode-speak preserved | ⬜ | | |
| ra-v7-* stylesheet preserved | ⬜ | | |
| Full regression suite passes | ⬜ | | |
