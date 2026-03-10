# BEL Onboarding + Full Feature Journey Audit — Summary (A2 Vietnamese PTE)

**Audit run date:** 2026-03-01  
**Local environment:** `https://localhost:8443`  
**Persona:** Vietnamese learner (CEFR A2), preparing for PTE, weak in Listening + Speaking, noisy environment, unstable network, low patience.

## Re-validation (2026-03-02 to 2026-03-03)

- P0 gate run (pass):  
  `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/reports/2026-03-02T14-03-27-909Z__audit-run.json`
- Full journey smoke run (pass on desktop + Pixel 5):  
  `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/reports/2026-03-03T02-25-31-651Z__audit-run.json`
- Refreshed multi-scenario matrix run (devices/networks/offline):  
  `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/reports/2026-03-03T02-48-39-274Z__audit-run.json`
- Current status:
  - Desktop full-flow smoke completes across all audited learner/admin steps.
  - Pixel 5 full-flow now also completes all audited learner/admin steps.
  - Mobile Notes coverage uses a card-level smoke fallback in automation to avoid mode-switch deadlocks while preserving journey continuity.
  - Entry scenarios on iPhone SE, tablet, and desktop Slow 3G pass in the refreshed matrix.
  - Offline entry scenario now loads via cached service-worker fallback (no hard browser navigation failure).

## Deliverables (what was produced)

- Journey Map + Funnel Notes: `docs/audits/2026-03-01-a2-vn-pte-onboarding/journey-map.md`
- Feature Coverage Checklist: `docs/audits/2026-03-01-a2-vn-pte-onboarding/feature-coverage-checklist.md`
- Issues Backlog (P0/P1/P2): `docs/audits/2026-03-01-a2-vn-pte-onboarding/issues-backlog.md`
- Metrics & Instrumentation Wishlist: `docs/audits/2026-03-01-a2-vn-pte-onboarding/metrics-wishlist.md`

## Evidence index (source of truth)

- Onboarding matrix report (devices + networks + offline):  
  `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/reports/2026-03-03T02-48-39-274Z__audit-run.json`
- Auth + admin deep flow report:  
  `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/reports/2026-03-01T18-59-31-793Z__auth-admin-audit.json`
- Lighthouse (mobile emulation) summary + HTML/JSON reports:  
  `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/perf/2026-03-01T17-20-23-723Z__lighthouse-summary.json`

## What was tested (high level)

### Acquisition → activation → first value

- Landing load + section scan (fast + Slow 3G).
- CTA → app entry with demo/guest paths.
- Entry choice modal behavior + a minimal keyboard navigation check.
- Type Mode first attempts (clean/assisted/struggle).
- Vocab capture + first SRS session attempts (guest + logged-in).

### Feature smoke coverage (learner-facing)

- Speak / Fill / Notes / Watch / Pronounce / Survival modes (smoke load).
- Dictionary Vietnamese translation (and caching behavior).
- AI proxy fallback behavior + cache behavior.

### Admin/CRM coverage

- Non-admin blocked from admin pages (access control).
- Admin can load Watch Admin + CRM Admin.
- Entrance test create → submit → result view.

## Key findings (most load-bearing)

### P0 — Conversion/activation killers (fix first)

1. **Slow 3G preloader shows a scary “security/certificate” style warning and requires a bypass.**  
   Evidence:
   - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__desktop_1366__slow3g__A1_preloader.png`
   - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__desktop_1366__slow3g__A2_preloader.png`

2. **Landing hero copy is A2-unfriendly and not clearly mapped to PTE (WFD/RS/RL).**  
   Evidence:
   - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__L1_landing_hero.png`

3. **Guest hint ladder is blocked by login in Type Mode (A2 gets stuck early).**  
   Evidence:
   - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__P2_type_assisted_result.png`

4. **Day 0 loop doesn’t reliably close (practice → save words → SRS).**  
   Evidence:
   - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__S1_srs_start.png`

5. **Mobile app home performance is very slow (high drop risk before first practice).**  
   Lighthouse (mobile emulation): perf 35, FCP ~14.7s, LCP ~34.4s, TBT 810ms.  
   Evidence:
   - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/perf/2026-03-01T17-20-23-723Z__app_mobile.html`

### P1 — Major friction/trust gaps (next)

- Adaptive Engine modal did not open in audit (trust-critical “why did difficulty change?” surface). Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__AUTH5_adaptive_engine.png`
- Entry modal focus starts on a toast before the modal CTAs (a11y/keynav confusion). Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__A11Y1_entry_tab.png`
- Level selection lacks “A2 → Beginner” mapping guidance (risk of seeding too hard). Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__AUTH4_level_selection.png`
- SRS UI shows “0 words due” while a session is visible (concept clarity issue). Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__AUTH6_srs_panel.png`

## What worked well (keep and amplify)

- Logged-in loop closure can be very strong for VN learners: vocab add + SRS + Vietnamese translation appears on card. Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__AUTH6_srs_vietnamese.png`
- Dictionary Vietnamese translation is fast and cached (repeat lookup is faster). Evidence:
  - `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__D1_dictionary.png`
- Admin/CRM access control and entrance test flow are functioning end-to-end. Evidence:
  - Non-admin blocked: `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__ADM1_crm-admin.png`
  - Entrance result: `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__ADMIN4_entrance_result.png`

## Coverage gaps (known “not tested” areas)

These are explicitly marked as ⚠️/⏭️ in `feature-coverage-checklist.md`:

- Mic permission allow/deny flows on real Android/iOS + STT scoring quality.
- Watch Mode YouTube playback + question submission + scoring.
- Pronounce Mode audio analysis pipeline (`POST /analyze`) + visualization rendering.
- Rewards/economy validation: XP/coins deltas, purchases/unlocks, anti-farm diminishing returns.
- Full-flow practice loop on iPhone SE + tablet breakpoints (beyond entry).

## Recommended next actions (practical order)

1. **Fix preloader trust messaging + detection** (stop false “security” warning; add neutral slow-load UI).
2. **Rewrite landing above-the-fold for A2 + PTE mapping** (WFD/RS/RL + “Day 0: 10 minutes”).
3. **Give guests baseline scaffolding** (free hints / limited trial hints) so they can succeed immediately.
4. **Force Day 0 loop closure** (after first struggle, guided “Save 1–3 words → Review now”).
5. **Reduce app home startup cost** (defer non-core modules; target LCP under 4s p75).

## Metrics plan (how to prove improvements)

Implement and dashboard the event set in:

- `docs/audits/2026-03-01-a2-vn-pte-onboarding/metrics-wishlist.md`

Minimum “north star” ratios for Day 0:

- `landing_cta_click / landing_view`
- `practice_start / app_loaded_ready`
- `attempt_scored / practice_start`
- `vocab_words_added / attempt_scored`
- `srs_session_started / vocab_words_added`
- `srs_session_completed / srs_session_started`
