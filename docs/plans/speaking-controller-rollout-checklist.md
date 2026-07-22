# Speaking Controller Rollout Checklist

Evidence tracking for the Unified Speaking Practice Controller migration.

Latest verification refresh (2026-07-21): speaking-controller-browser-check.js passes 140/140; Read Aloud lifecycle passes 20/20; the Read Aloud shared-controller DOM contract passes; Read Aloud and RTS legacy picker bars/sheets are removed.

Environment refresh (2026-07-22): Temurin JDK 21 is configured for Firebase CLI 15.2.1; Auth/Firestore emulators are listening; authenticated attempts-history browser checks pass.

## Wave 0 — Contract and Synthetic Fixture

| Check | Status | Date | Evidence |
|---|---|---|---|
| Synthetic adapter passes browser check | ✅ | 2026-07-21 | 138/138 assertions pass in speaking-controller-browser-check.js, including integrated production adapters |
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
| RTS picker bridge functional | ✅ | 2026-07-21 | 140/140 controller assertions confirm shared RTS Next navigation and custom picker bridge |
| ASQ random picker functional | ⬜ | | |
| No-toggle behavior (ASQ/RTS omit toggle) | ✅ | 2026-07-21 | Production adapter assertions pass in speaking-controller-browser-check.js |
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
| Dead filter markup removed | ✅ | 2026-07-21 | Production adapter assertion confirms no SGD difficulty/status filter containers |
| Dead filter code removed from sgd-mode.js | ✅ | 2026-07-21 | sgd-mode.js diff removes dead filter code; production adapter check passes |
| SGD step orchestration unaffected | ⬜ | | |
| sgd-mode-browser-check.js passes | ⬜ | | |
| practice-modes-browser-check.js updated/passes | ✅ | 2026-07-21 | node tests/browser/practice-modes-browser-check.js exits 0 |

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
| Shared picker replaces visible V7 picker | ✅ | 2026-07-21 | 138/138 controller assertions confirm shared picker adoption and legacy picker hiding |
| Filters in Advanced settings sheet | ✅ | 2026-07-21 | Controller production-adapter assertions confirm filter action/drawer adoption; audio test enters Advanced before settings checks |
| Voice settings in Advanced | ✅ | 2026-07-21 | Controller production-adapter assertions confirm Read Aloud advanced settings adoption |
| Guide controls Advanced-gated in-place | ✅ | 2026-07-21 | Controller production-adapter assertion confirms advanced-gated prompt guides remain in panel |
| read-aloud-question-picker-v7 DOM check passes | ✅ | 2026-07-21 | npm run test:read-aloud:v7:browser exits 0 |
| read-aloud-audio-matching-check passes | ⬜ | 2026-07-21 | Blocked by existing missing asset: /database/RA/Voice/audio/1181/RA_1181_bf_emma_100.mp3 returned 404 |

## Wave 4B — Read Aloud: Actions/History

| Check | Status | Date | Evidence |
|---|---|---|---|
| Media controls adopted (record/stop/check/retry) | ✅ | 2026-07-21 | 138/138 controller assertions confirm Read Aloud media/action adoption |
| History hosts created and used | ✅ | 2026-07-21 | 138/138 controller assertions confirm dedicated action/content host placement |
| Legacy history fallback works | ⬜ | | |
| read-aloud-check.js passes | ✅ | 2026-07-21 | node tests/browser/read-aloud-check.js exits 0 |
| practice-attempts-history-browser-check.js passes | ⬜ | | |

## Wave 4C — Read Aloud: Lifecycle Gate

| Check | Status | Date | Evidence |
|---|---|---|---|
| Record → Stop → RECORDED → playback → Check → results | ✅ | 2026-07-21 | npm run test:read-aloud:lifecycle:browser: 20/20 assertions pass |
| Retry and Next work | ✅ | 2026-07-21 | Same lifecycle gate verifies Retry clears staged audio and Next advances prompt lifecycle |
| History refreshes after attempt | ⬜ | | |
| Speech Coach interactions unaffected | ⬜ | | |
| Browser-agent lifecycle evidence | ⬜ | | |

## Wave 5 — Integrated Scope/Default Gate

| Check | Status | Date | Evidence |
|---|---|---|---|
| All targets enabled by default | ✅ | 2026-07-21 | Integrated default target assertions pass in speaking-controller-browser-check.js |
| PTE scope switching preserves state | ✅ | 2026-07-21 | Controller mounts in PTE without query override and remounts after returning from English |
| English scope switching preserves state | ✅ | 2026-07-21 | English Speak remains mounted; English Retell Lecture remains legacy/unmounted |
| All modes at 1440×1200 | ⬜ | | |
| All modes at 768×1024 | ⬜ | | |
| All modes at 390×844 | ⬜ | | |
| practice-scope-toggle-browser-check.js passes | ⬜ | | |
| practice-scope-logged-in-browser-check.js passes | ⬜ | | |

## Wave 6 — Legacy Cleanup

| Check | Status | Date | Evidence |
|---|---|---|---|
| Query override removed | ✅ | 2026-07-21 | speakingController query parsing/override removed; default target resolution is production-only |
| Obsolete layout wrappers removed | ⬜ | | |
| RA/RTS V7 picker markup removed | ⬜ | 2026-07-21 | RTS V7 markup removed; Read Aloud V7 filter/picker markup remains until its filter controls are migrated |
| Functional IDs preserved | ⬜ | | |
| #mode-speak preserved | ⬜ | | |
| ra-v7-* stylesheet preserved | ⬜ | | |
| Full regression suite passes | ⬜ | | |
