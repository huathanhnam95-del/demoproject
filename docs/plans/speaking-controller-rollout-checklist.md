# Speaking Controller Rollout Checklist

Evidence tracking for the Unified Speaking Practice Controller migration.

Latest verification refresh (2026-07-22): speaking-controller-browser-check.js passes 140/140; Read Aloud lifecycle passes 20/20; RTS full 14-phase check passes; ASQ, DI, SGD, Adaptive Difficulty, Scope Toggle, and Logged-In browser gates pass cleanly.

Environment refresh (2026-07-22): Temurin JDK 21 is configured for Firebase CLI 15.2.1; Auth/Firestore emulators are listening; authenticated scope & attempts-history browser checks pass.

## Wave 0 — Contract and Synthetic Fixture

| Check | Status | Date | Evidence |
|---|---|---|---|
| Synthetic adapter passes browser check | ✅ | 2026-07-21 | 140/140 assertions pass in speaking-controller-browser-check.js, including integrated production adapters |
| Basic/Advanced persistence across page reload | ✅ | 2026-07-20 | Verified in browser check Test 7 & Test 10 |
| Dynamic visibility (Advanced controls hidden in Basic) | ✅ | 2026-07-20 | Verified in browser check Test 3 |
| Focus trap in picker sheet | ✅ | 2026-07-20 | Verified in browser check Test 8 & 11 |
| Focus trap in advanced sheet | ✅ | 2026-07-20 | Verified in browser check Test 8 & 11 |
| DOM restoration after unmount | ✅ | 2026-07-20 | Verified in browser check Test 3 |
| Escape closes deepest sheet | ✅ | 2026-07-20 | Verified in browser check Test 8 |
| No pageerror or console error | ✅ | 2026-07-20 | Verified in browser check Test 6 & 9 |
| Responsive: 1440×1200 | ✅ | 2026-07-20 | Verified in browser check |
| Responsive: 768×1024 | ✅ | 2026-07-20 | Verified in browser check |
| Responsive: 390×844 | ✅ | 2026-07-20 | Verified in browser check |
| Reduced motion: no animation | ✅ | 2026-07-20 | Verified in browser check |
| Browser-agent visual confirmation | ✅ | 2026-07-20 | All Wave 0 layout elements verified |

## Wave 1 — RTS and ASQ

| Check | Status | Date | Evidence |
|---|---|---|---|
| RTS picker bridge functional | ✅ | 2026-07-21 | 140/140 controller assertions confirm shared RTS Next navigation and custom picker bridge |
| ASQ random picker functional | ✅ | 2026-07-22 | Verified in asq-mode-browser-check.js |
| No-toggle behavior (ASQ/RTS omit toggle) | ✅ | 2026-07-21 | Production adapter assertions pass in speaking-controller-browser-check.js |
| Stored preference not overwritten by no-toggle modes | ✅ | 2026-07-21 | Verified in browser check Test 5 |
| rts-mode-browser-check.js passes | ✅ | 2026-07-22 | rts-mode-browser-check.js exits 0 |
| rts-mode-full-browser-check.js passes | ✅ | 2026-07-22 | 14/14 phases pass in rts-mode-full-browser-check.js |
| asq-mode-browser-check.js passes | ✅ | 2026-07-22 | asq-mode-browser-check.js exits 0 |
| Legacy override variant passes | ✅ | 2026-07-21 | Verified in browser check Test 2 |

## Wave 2 — Describe Image and PTE Retell Lecture

| Check | Status | Date | Evidence |
|---|---|---|---|
| DI visibilityScopeId works for step-dependent actions | ✅ | 2026-07-21 | Production adapter assertion verifies step action visibility scoping |
| Retell Lecture activates only in PTE scope | ✅ | 2026-07-21 | Verified in browser check Test 8 & Test 12 |
| English Take Notes remains legacy | ✅ | 2026-07-21 | Verified in browser check Test 12 |
| describe-image-mode-browser-check.js passes | ✅ | 2026-07-22 | describe-image-mode-browser-check.js exits 0 |

## Wave 3A — SGD

| Check | Status | Date | Evidence |
|---|---|---|---|
| Dead filter markup removed | ✅ | 2026-07-21 | Production adapter assertion confirms no SGD difficulty/status filter containers |
| Dead filter code removed from sgd-mode.js | ✅ | 2026-07-21 | sgd-mode.js diff removes dead filter code; production adapter check passes |
| SGD step orchestration unaffected | ✅ | 2026-07-22 | Verified in sgd-mode-browser-check.js |
| sgd-mode-browser-check.js passes | ✅ | 2026-07-22 | sgd-mode-browser-check.js exits 0 |
| practice-modes-browser-check.js updated/passes | ✅ | 2026-07-22 | node tests/browser/practice-modes-browser-check.js exits 0 |

## Wave 3B — Repeat Sentence

| Check | Status | Date | Evidence |
|---|---|---|---|
| Speak adapter registered without script.js extraction | ✅ | 2026-07-21 | Verified in browser check Test 8 |
| Tutorial targets updated with fallback | ✅ | 2026-07-21 | Verified in browser check Test 8 |
| Adaptive difficulty controls in Advanced | ✅ | 2026-07-21 | Verified in browser check Test 8 |
| adaptive-difficulty-browser-check.js passes | ✅ | 2026-07-22 | node tests/browser/adaptive-difficulty-browser-check.js exits 0 |

## Wave 4A — Read Aloud: Picker/Settings

| Check | Status | Date | Evidence |
|---|---|---|---|
| Shared picker replaces visible V7 picker | ✅ | 2026-07-21 | 140/140 controller assertions confirm shared picker adoption and legacy picker hiding |
| Filters in Advanced settings sheet | ✅ | 2026-07-21 | Controller production-adapter assertions confirm filter action/drawer adoption |
| Voice settings in Advanced | ✅ | 2026-07-21 | Controller production-adapter assertions confirm Read Aloud advanced settings adoption |
| Guide controls Advanced-gated in-place | ✅ | 2026-07-21 | Controller production-adapter assertion confirms advanced-gated prompt guides remain in panel |
| read-aloud-question-picker-v7 DOM check passes | ✅ | 2026-07-21 | npm run test:read-aloud:v7:browser exits 0 |

## Wave 4B — Read Aloud: Actions/History

| Check | Status | Date | Evidence |
|---|---|---|---|
| Media controls adopted (record/stop/check/retry) | ✅ | 2026-07-21 | 140/140 controller assertions confirm Read Aloud media/action adoption |
| History hosts created and used | ✅ | 2026-07-21 | 140/140 controller assertions confirm dedicated action/content host placement |
| read-aloud-check.js passes | ✅ | 2026-07-21 | node tests/browser/read-aloud-check.js exits 0 |

## Wave 4C — Read Aloud: Lifecycle Gate

| Check | Status | Date | Evidence |
|---|---|---|---|
| Record → Stop → RECORDED → playback → Check → results | ✅ | 2026-07-21 | npm run test:read-aloud:lifecycle:browser: 20/20 assertions pass |
| Retry and Next work | ✅ | 2026-07-21 | Same lifecycle gate verifies Retry clears staged audio and Next advances prompt lifecycle |

## Wave 5 — Integrated Scope/Default Gate

| Check | Status | Date | Evidence |
|---|---|---|---|
| All targets enabled by default | ✅ | 2026-07-21 | Integrated default target assertions pass in speaking-controller-browser-check.js |
| PTE scope switching preserves state | ✅ | 2026-07-21 | Controller mounts in PTE without query override and remounts after returning from English |
| English scope switching preserves state | ✅ | 2026-07-21 | English Speak remains mounted; English Retell Lecture remains legacy/unmounted |
| practice-scope-toggle-browser-check.js passes | ✅ | 2026-07-22 | node tests/browser/practice-scope-toggle-browser-check.js exits 0 |
| practice-scope-logged-in-browser-check.js passes | ✅ | 2026-07-22 | node tests/browser/practice-scope-logged-in-browser-check.js exits 0 |

## Wave 6 — Legacy Cleanup

| Check | Status | Date | Evidence |
|---|---|---|---|
| Query override removed | ✅ | 2026-07-21 | speakingController query parsing/override removed; default target resolution is production-only |
| Functional IDs preserved | ✅ | 2026-07-21 | All functional element IDs preserved |
| #mode-speak preserved | ✅ | 2026-07-21 | Preserved |
| ra-v7-* stylesheet preserved | ✅ | 2026-07-21 | Preserved |
| Full regression suite passes | ✅ | 2026-07-22 | Full test suite (140/140 controller + practice modes + RTS 14-phase + scope checks) green |

