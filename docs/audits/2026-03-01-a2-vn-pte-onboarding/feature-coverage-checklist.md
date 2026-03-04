# Feature Coverage Checklist — A2 Vietnamese PTE onboarding audit

**Audit date**: 2026-03-01  
**Environment**: local `https://localhost:8443`  
**Evidence sources**:
- Onboarding matrix report: `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/reports/2026-03-01T17-44-40-561Z__audit-run.json`
- Auth + admin deep report: `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/reports/2026-03-01T18-59-31-793Z__auth-admin-audit.json`
- Lighthouse summary: `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/perf/2026-03-01T17-20-23-723Z__lighthouse-summary.json`

**Legend**: ✅ Pass · ⚠️ Partial · ❌ Fail · ⏭️ Not tested

## Coverage matrix (devices + networks)

### Devices / viewports
- ✅ Pixel 5 (393×851): full journey + feature smoke (fast)  
- ✅ Desktop (1366×768): full journey + feature smoke (fast)  
- ⚠️ iPhone SE (375×667): landing + app entry only (fast)  
- ⚠️ Tablet (768×1024): landing + app entry only (fast)

### Networks
- ✅ Fast: full journey + feature smoke on Pixel 5 + Desktop
- ⚠️ Slow 3G: landing + app entry only (Desktop)
- ✅ Offline (targeted): landing/app fail-to-load behavior captured (Desktop)

## Spec coverage (by `docs/specs/features/*`)

### Authentication & Onboarding (`docs/specs/features/auth-and-onboarding.md`)
- ✅ Entry choice modal renders (guest vs login). Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__A2_entry_modal.png`
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__AUTH1_entry_modal.png`
- ✅ Guest-first playability: Type Mode attempt produces results. Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__AUTH2_guest_type_result.png`
- ✅ Signup error state shows clear message (“Passwords do not match”). Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__AUTH3_signup_error.png`
- ✅ Signup success + level selection modal appears and dismisses. Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__AUTH4_level_selection.png`
- ⚠️ Guest → logged-in continuity for local caches (difficulty/dictionary/drafts): not directly validated (no before/after comparisons).
- ❌ Offline usability as guest (spec says “keep session usable”): in offline throttling, landing/app do not load. Evidence: offline errors in `desktop_1366__offline` scenario within `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/reports/2026-03-01T17-44-40-561Z__audit-run.json`.

### Smart Difficulty Engine (`docs/specs/features/smart-difficulty-engine.md`)
- ⚠️ Hint ladder UI exists, but guest usage is blocked by login (hard gate). Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__P2_type_hint.png`
- ⚠️ Replay limit consistency across Type/Speak: not empirically validated (no multi-replay exhaustion tests).
- ❌ Adaptive Engine modal expected by spec is not reachable in the audited UI (modal did not open). Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__AUTH5_adaptive_engine.png`
  - (Code signal) `public/index.html` includes `js/difficulty-manager.js` but not `js/adaptive-engine-ui.js`.

### RPG Progression & Economy (`docs/specs/features/rpg-progression-and-economy.md`)
- ✅ Skill tree / shop UI opens. Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__AUTH5_skill_tree.png`
- ⚠️ XP/coins increase after attempt: not validated (no before/after numeric assertions captured).
- ⏭️ Purchase/unlock flow: not validated (no “purchase success”/coin deduction evidence).
- ⏭️ Anti-farm diminishing returns: not validated.

### Dictionary & Phonetics (`docs/specs/features/dictionary-and-phonetics.md`)
- ✅ Vietnamese translation lookup works and shows caching speedup. Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__D1_dictionary.png`
- ⚠️ Definitions/examples/collocations: not validated in UI (translation-only check).
- ⏭️ IPA/phonetics helpers: not validated.

### Vocabulary Book (`docs/specs/features/vocabulary-book.md`)
- ✅ Vocab add modal appears (logged-in flow). Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__AUTH6_vocab_add_modal.png`
- ✅ Manual add can populate bookmarks list (logged-in flow). Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__AUTH6_vocab_panel.png`
- ⚠️ “Frequently missed” promotion: not validated (requires repeated mistakes).
- ⏭️ Search/sort/remove from bookmarks: not validated.

### SRS Review (`docs/specs/features/srs-review.md`)
- ✅ SRS panel opens (logged-in flow). Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__AUTH6_srs_panel.png`
- ✅ Vietnamese translation visible on an SRS card. Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__AUTH6_srs_vietnamese.png`
- ⚠️ Due count mechanics: audited UI shows “0 words due” while session is visible (needs clarification in UX). Evidence: same as above.
- ⏭️ Algorithm toggle comprehension (SM-2 vs FSRS) and schedule change: not validated.
- ⏭️ Session summary / due decreases: not validated.

### Type Mode (`docs/specs/features/type-mode.md`)
- ✅ Clean attempt result shown (guest). Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__P1_type_clean_result.png`
- ⚠️ Hint ladder integration: UI exists but is login-gated in guest. Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__P2_type_assisted_result.png`
- ⚠️ “Save missed words” from type: surfaced, but guest flow did not show add modal in this run. Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__P3_type_fail_panels.png`
- ⏭️ Server-authoritative rewards (XP/coins) + calibration multipliers: not validated.

### Speak Mode (`docs/specs/features/speak-mode.md`)
- ⚠️ Mode loads; “record” click works; speech recognition availability is detected. Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__SP1_speak_mode.png`
- ⏭️ Mic permission flows (allow/deny) on real devices: not validated.
- ⏭️ STT scoring + actionable feedback: not validated.
- ⏭️ Replay limit exhaustion: not validated.

### Fill Mode (Extended) (`docs/specs/features/fill-mode.md`)
- ⚠️ Mode loads (smoke). Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__M1_fill_mode.png`
- ⏭️ Cloze scoring, hint scaffolding, and reward calibration: not validated.
- ⏭️ Data-level verification (extended items have `level: 1|2|3`): not validated in this audit artifact set.

### Notes Mode (`docs/specs/features/notes-mode.md`)
- ⚠️ Mode loads (smoke). Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__M2_notes_mode.png`
- ⏭️ Notes submission scoring (short vs meaningful) + diminishing returns: not validated.

### Watch Mode (`docs/specs/features/watch-mode.md`)
- ⚠️ Mode loads (smoke). Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__M3_watch_mode.png`
- ⏭️ YouTube playback + timestamped questions + submission scoring: not validated.

### Pronounce Mode (`docs/specs/features/pronounce-mode.md`)
- ⚠️ Mode loads (smoke). Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__M4_pronounce_mode.png`
- ⏭️ Audio analysis pipeline (`POST /analyze`) + visual contour rendering: not validated.

### Writing Challenge (`docs/specs/features/writing-challenge.md`)
- ⚠️ Writing Challenge opens/closes in smoke. Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__AUTH7_writing_challenge.png`
- ⏭️ Triggered-from-SRS behavior: not validated (opened directly via UI hooks).
- ⏭️ Collocation multi-option prompt flow: not validated.
- ⏭️ Draft persistence across reload: not validated.
- ⏭️ “AI Check” quota + LanguageTool fallback: not validated.

### Survival Mode (`docs/specs/features/survival-mode.md`)
- ⚠️ Mode loads (smoke). Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__M5_survival_mode.png`
- ⏭️ Start a run, HUD updates, lose/restart speed: not validated.

### Admin & CRM (`docs/specs/features/admin-and-crm.md`)
- ✅ Non-admin users blocked from admin pages (access control). Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__ADM1_crm-admin.png`
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__ADM1_watch-admin.png`
- ✅ Admin can load Watch Admin and CRM Admin pages. Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__ADMIN2_watch_admin.png`
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__ADMIN3_crm_admin.png`
- ✅ Entrance test create → submit → result view. Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__ADMIN4_entrance_public.png`
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__ADMIN4_entrance_result.png`
- ⏭️ Watch admin CRUD: not validated in this audit (to avoid mutating production-like data).

### AI Services (`docs/specs/features/ai-services.md`)
- ✅ AI proxy returns structured “unavailable” response when external calls are disabled (fallback path). Evidence:
  - See `AI1_ai_proxy_smoke` in `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/reports/2026-03-01T17-44-40-561Z__audit-run.json`
- ✅ Cache behavior observed (`fromCache: true`). Evidence:
  - See `AI2_ai_proxy_cache_behavior` in `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/reports/2026-03-01T18-59-31-793Z__auth-admin-audit.json`
- ⏭️ Streaming feedback endpoint (SSE) stability: not validated.

## Cross-cutting checks (plan-required)

### Accessibility (minimal)
- ✅ Entry modal supports Tab order capture (but focus starts on toast). Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__A11Y1_entry_tab.png`
- ⚠️ Modal focus trapping/Escape-to-close across other modals: not validated.
- ✅ Lighthouse accessibility score (mobile emulation): Landing 100, App 96. Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/perf/2026-03-01T17-20-23-723Z__landing_mobile.json`
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/perf/2026-03-01T17-20-23-723Z__app_mobile.json`

### Performance
- ✅ Lighthouse captured for landing + app home (mobile emulation). Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/perf/2026-03-01T17-20-23-723Z__landing_mobile.html`
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/perf/2026-03-01T17-20-23-723Z__app_mobile.html`

### Mobile UX
- ⚠️ Layout sanity checked via Pixel 5 screenshots for core loop, but touch-target sizing/orientation testing was not exhaustively validated.
