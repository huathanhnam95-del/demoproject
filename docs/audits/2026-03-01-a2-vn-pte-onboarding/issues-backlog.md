# Top Issues Backlog — A2 Vietnamese PTE onboarding audit

**Audit date**: 2026-03-01  
**Environment**: local `https://localhost:8443`  
**Evidence**:
- `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/reports/2026-03-01T17-44-40-561Z__audit-run.json`
- `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/reports/2026-03-01T18-59-31-793Z__auth-admin-audit.json`
- `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/perf/2026-03-01T17-20-23-723Z__landing_mobile.json`
- `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/perf/2026-03-01T17-20-23-723Z__app_mobile.json`

**Severity scale**
- **P0**: breaks or kills conversion/activation for target persona
- **P1**: major friction/confusion; reduces retention
- **P2**: nice-to-fix / polish / incomplete instrumentation

## P0 (conversion/activation killers)

| Issue | Where (step) | Persona impact | Evidence | Fix direction | Metric to validate |
|---|---|---|---|---|---|
| Preloader shows scary “security/certificate” style warning on Slow 3G and requires bypass | Activation (A1/A2, Slow 3G) | High mistrust → immediate bounce | `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__desktop_1366__slow3g__A1_preloader.png` | Only show security warnings on real TLS/cert failures; otherwise show “Still loading…” with retry + status. Remove “enter anyway” framing. | `preloader_bypass_clicked / app_load` < 0.1% |
| Landing hero copy is A2-unfriendly and not clearly PTE Listening/Speaking | Acquisition (L1) | “Not for me” in 5 seconds | `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__L1_landing_hero.png` | Rewrite hero subtitle in A2 English; add “PTE: WFD/RS/RL” mapping + one concrete Day 0 promise. Add VN helper text (tooltip or toggle). | `landing_cta_click / landing_view` +20% |
| Guest Type Mode hint ladder is blocked by login (hard gate) | Day 0 loop (P2) | A2 gets stuck → quits before value | `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__P2_type_assisted_result.png` | Allow baseline (free) hints for guests (or 1–3 free hint uses) and gate only persistence/paid assists. Show gentle “Save progress” upsell after the hint helps. | `guest_practice_complete_1` +15% |
| Day 0 retention loop breaks: missed-word capture doesn’t lead to “save → SRS” for guests | Day 0 loop (P3 + S1) | No loop closure → no habit, no return | `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__S1_srs_start.png` | Provide guest-local vocab+SRS (localStorage) OR a guided “Create account to review these words now” flow that opens signup with context preserved. | `srs_start / first_practice_complete` +10% |
| App home is very slow on mobile (Lighthouse FCP ~14.7s / LCP ~34.4s) | Activation (app load) | Slow load → drop before first attempt | `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/perf/2026-03-01T17-20-23-723Z__app_mobile.html` | Defer/lazy-load non-critical modules (Survival/Watch/Pronounce), reduce script count, optimize Firestore startup, preload only essential fonts/assets. | LCP (p75) < 4s; `practice_start / app_loaded` +10% |

## P1 (major friction / trust gaps)

| Issue | Where (step) | Persona impact | Evidence | Fix direction | Metric to validate |
|---|---|---|---|---|---|
| Adaptive Engine modal doesn’t open (despite modal HTML existing) | Trust surface (AUTH5) | “Magic difficulty” distrust | `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__AUTH5_adaptive_engine.png` | Ensure the badge opens a real, readable modal (A2-friendly). Verify `public/index.html` loads the UI module or remove dead UI. | `adaptive_engine_open / badge_click` > 80% |
| Entry modal keyboard focus starts on a toast before the modal choices | Accessibility (A11Y1) | Keyboard/screen-reader confusion | `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__A11Y1_entry_tab.png` | When entry modal opens, move focus to first CTA; make background/toast unfocusable; add focus trap + `aria-modal`. | `entry_modal_keynav_success` |
| Level selection lacks “A2 → Beginner” guidance | Onboarding (AUTH4) | Wrong level → “too hard” frustration | `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__AUTH4_level_selection.png` | Add 1-line mapping and examples (“A2: simple sentences”). Consider a 30s mini placement instead. | `level_change_within_24h` ↓ |
| SRS “0 words due” shown while a session/card is visible | Retention UI (AUTH6) | Confusing: “Do I have reviews or not?” | `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__AUTH6_srs_panel.png` | Separate “Due today” vs “New words”; ensure newly added words can be reviewed immediately, or explain clearly. | `srs_session_complete / srs_start` ↑ |
| Offline experience is hard-fail (no offline shell) | Reliability (offline scenario) | Noisy/unstable network → churn | `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/reports/2026-03-01T17-44-40-561Z__audit-run.json` | Add offline fallback page or service worker shell; at minimum show clear “offline” UI rather than browser error. | `offline_load_success` |
| Admin panel doesn’t surface links to admin pages (even after admin verified) | Admin UX (ADMIN1) | Admin friction; discoverability | `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__ADMIN1_admin_panel.png` | Add an admin nav section when `isAdmin=true` with links to Watch Admin/CRM/Entrance Tests. | `admin_nav_clickthrough` |

## P2 (polish / incomplete coverage / instrumentation)

| Issue | Where (step) | Persona impact | Evidence | Fix direction | Metric to validate |
|---|---|---|---|---|---|
| Landing load time on Slow 3G is ~10s (needs “why wait?” reassurance) | Acquisition (L1 Slow 3G) | Impatience on ad traffic | `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__desktop_1366__slow3g__L1_landing_hero.png` | Add stronger above-the-fold proof + lightweight critical CSS to improve perceived speed; show skeleton/CTA fast. | `landing_bounce_rate` ↓ |
| Vocab “manual add” input was not visible in the automated guest flow (discoverability risk on small screens) | Vocab (V1) | Users may not find how to add words | `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/reports/2026-03-01T17-44-40-561Z__audit-run.json` | Ensure manual add CTA is visible when vocab panel opens; auto-scroll to input; provide “Add word” button above the fold. | `vocab_manual_add_open` |
| AI proxy returns HTTP 400 on “AI unavailable” (could be treated as an error path by clients) | AI services (AI1) | Minor; affects reliability perception if surfaced | `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/reports/2026-03-01T17-44-40-561Z__audit-run.json` | Consider returning 200 with `{ fallback: true }` and user-friendly message; ensure UI never shows raw error. | `% ai_proxy_4xx` ↓ |
| iPhone SE + Tablet only have entry flow coverage (no practice loop validation) | Coverage gap | Possible layout issues undetected | `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/reports/2026-03-01T17-44-40-561Z__audit-run.json` | Run full practice loop on iPhone SE and tablet breakpoints; verify modals fit and input isn’t blocked by keyboard. | `mobile_layout_regressions` |
| Speaking mic permission allow/deny flows were not validated on real devices | Coverage gap | High-risk for Speaking-first persona | `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__SP1_speak_mode.png` | Add scripted “deny mic” UX + run on a real Android/iOS device; provide clear fallback instructions. | `mic_permission_grant_rate` |
| Watch Mode video playback + question submission not validated | Coverage gap | Mode may fail silently on weak networks | `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__M3_watch_mode.png` | Add a “video ready” state + retry; validate YouTube blocked/slow behavior. | `watch_video_ready_rate` |
| Pronounce Mode analysis pipeline not validated | Coverage gap | Deep value feature may break in practice | `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__M4_pronounce_mode.png` | Add explicit “analysis unavailable” fallback; validate `POST /analyze` happy path + error path. | `pronounce_analysis_success_rate` |

## Quick wins shortlist (highest ROI for activation)
1. Replace the preloader “security warning” with a neutral loading state + real error detection.
2. Rewrite landing hero and first CTA around **PTE WFD/RS/RL** + “Day 0: 10 minutes”.
3. Allow baseline hints for guests (or limited free hints) so A2 can succeed in first 3 items.
4. Ensure Day 0 loop closes: after first struggle attempt, guide directly to “Save words → SRS now”.
5. Cut initial app load cost by deferring non-core modules and reducing startup work.
