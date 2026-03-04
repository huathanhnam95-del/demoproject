# Journey Map + Funnel Notes — A2 Vietnamese PTE (Listening + Speaking weak)

**Audit date**: 2026-03-01  
**Environment**: local `https://localhost:8443` (Playwright + Lighthouse)  
**Primary evidence**:
- Onboarding matrix report: `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/reports/2026-03-01T17-44-40-561Z__audit-run.json`
- Auth + admin deep report: `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/reports/2026-03-01T18-59-31-793Z__auth-admin-audit.json`
- Performance (Lighthouse) summary: `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/perf/2026-03-01T17-20-23-723Z__lighthouse-summary.json`

## Persona (fixed)
- Vietnamese learner, CEFR **A2**
- Preparing for **PTE Academic**
- Weak in **Listening + Speaking**
- Typical context: noisy room, inconsistent network, Android mid-range
- Primary need: “Tell me what to do next in <10 seconds, and show exam-relevant progress.”

## Funnel map (events)
1. Landing view → CTA click
2. App loaded → entry decision (demo/guest/login)
3. First practice started → first result shown
4. First result → vocab captured
5. Vocab captured → SRS started
6. SRS complete → “return intent” created (plan/streak/due)

## Step-by-step journey (incentives + blockers)

### L1 — Landing hero comprehension (mobile, fast)
**User goal:** Decide in 5–10 seconds if this is for PTE listening/speaking.  
**Expectation:** Simple promise + exam mapping (WFD/RS/RL) + proof it’s real.  
**Actual:** Hero subtitle uses advanced concepts (“rolling accuracy”, “masking”, “forced listening time”), which is hard for A2 and not PTE-framed.  
**Incentives:** Clear “zone” metaphor; page looks modern; sections exist (How it works, Journey, Features).  
**Blockers:** Cognitive overload + unclear PTE relevance → bounce risk.  
**Severity:** **P0** (acquisition).  
**Evidence:** `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__L1_landing_hero.png`  
**Score (0–3):** Clarity 1 / Effort 1 / Confidence 1 / Momentum 1

### L1 (Slow 3G) — Landing load time patience test
**User goal:** “Does this load fast enough to trust it?”  
**Expectation:** Content visible quickly; no layout jumps; CTA reachable.  
**Actual:** Landing navigation took ~10.3s on Slow 3G (Playwright nav time).  
**Incentives:** If hero value is obvious, I might wait.  
**Blockers:** A2 + ad traffic = low patience → likely close tab.  
**Severity:** **P1** (acquisition friction).  
**Evidence:** `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__desktop_1366__slow3g__L1_landing_hero.png`  
**Score:** Clarity 1 / Effort 2 / Confidence 2 / Momentum 1

### L2 — Landing sections scan (proof + “what happens next”)
**User goal:** Confirm it’s real and see the “Day 0” path.  
**Expectation:** One obvious next step, simple words, and screenshots that match the app.  
**Actual:** Sections are present (Hero / How it works / Journey / Features / FAQ). Journey is visible but still not explicitly “PTE WFD/RS/RL”.  
**Incentives:** If “Day 0” checklist is concrete, I’ll try.  
**Blockers:** If “How it works” language stays technical, A2 may not click CTA.  
**Severity:** **P1**.  
**Evidence:** `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__L2_your_journey.png`  
**Score:** Clarity 2 / Effort 1 / Confidence 2 / Momentum 2

### A1 — CTA → App (fast): preloader appears before app
**User goal:** Start quickly (“free demo”).  
**Expectation:** App loads → I can immediately practice.  
**Actual:** A preloader screen appears briefly even on fast network.  
**Incentives:** If it resolves fast, I continue.  
**Blockers:** Any “security/certificate” wording here will cause panic (especially A2).  
**Severity:** **P1**.  
**Evidence:** `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__A1_preloader.png`  
**Score:** Clarity 2 / Effort 1 / Confidence 2 / Momentum 2

### A1/A2 (Slow 3G) — Preloader false-alarm trust break
**User goal:** Get into the app safely.  
**Expectation:** Slow load ≠ “security problem”.  
**Actual:** On Slow 3G, the preloader shows a scary security/certificate-style warning and offers a bypass button; audit had to press bypass to proceed.  
**Incentives:** None; this is pure fear + doubt.  
**Blockers:** “Enter anyway” framing looks like malware → high drop.  
**Severity:** **P0** (activation killer).  
**Evidence:**  
- `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__desktop_1366__slow3g__A1_preloader.png`  
- `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__desktop_1366__slow3g__A2_preloader.png`  
**Score:** Clarity 0 / Effort 3 / Confidence 0 / Momentum 0

### A2 — App direct entry: forced decision modal
**User goal:** Start learning without commitment.  
**Expectation:** “Try now” without account is safe and explained.  
**Actual:** Entry modal asks me to choose Guest vs Log In. Good in principle, but it’s a hard decision before I see value.  
**Incentives:** “No account needed” label helps.  
**Blockers:** If guest mode can’t complete the core loop (save vocab → SRS), it feels like a trap.  
**Severity:** **P1**.  
**Evidence:** `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__A2_entry_modal.png`  
**Score:** Clarity 2 / Effort 1 / Confidence 2 / Momentum 2

### A11Y1 — Entry modal keyboard focus order (trust + accessibility)
**User goal:** If I’m on laptop, I want Tab/Enter to work predictably.  
**Expectation:** Focus starts inside the entry modal.  
**Actual:** Tab order begins on a “Give Feedback” toast link before the entry buttons.  
**Incentives:** Keyboard support exists (Tab navigates).  
**Blockers:** Focus starting outside the modal reduces clarity and can confuse screen-reader / keyboard users.  
**Severity:** **P2**.  
**Evidence:** `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__A11Y1_entry_tab.png`  
**Score:** Clarity 2 / Effort 1 / Confidence 2 / Momentum 2

### P1 — First practice (Type Mode): clean attempt feedback loop exists
**User goal:** “I want to feel improvement in 5 minutes.”  
**Expectation:** Play audio → type → instant correction + next step.  
**Actual:** A result screen is shown after submission.  
**Incentives:** Immediate result supports momentum.  
**Blockers:** If the feedback doesn’t tell me *what to fix next*, I stall.  
**Severity:** **P1** (core loop quality).  
**Evidence:** `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__P1_type_clean_result.png`  
**Score:** Clarity 2 / Effort 1 / Confidence 2 / Momentum 2

### P2 — Assisted attempt: hint ladder is blocked in guest mode
**User goal:** Get a small hint when stuck (A2 needs scaffolding).  
**Expectation:** Some baseline hints are available without an account, especially for Day 0.  
**Actual:** Hint drawer opens, but hint usage is flagged as “blocked by login” in the audit.  
**Incentives:** This is a strong “upgrade to save progress” nudge if phrased gently.  
**Blockers:** Hard-gating hints early pushes A2 into frustration zone → dropout.  
**Severity:** **P0** (first value loop).  
**Evidence:**  
- `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__P2_type_hint.png`  
- `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__P2_type_assisted_result.png`  
**Score:** Clarity 1 / Effort 2 / Confidence 1 / Momentum 0

### P3 — “Struggle” attempt: missed-word surfaces appear, but capture is unclear
**User goal:** Understand mistakes and save missed words.  
**Expectation:** After a weak attempt, I see “save these words” clearly.  
**Actual:** A vocab/missed-word surface is detected, but the “Add to vocab” modal did not appear in this guest run.  
**Incentives:** Mistakes → vocab is the retention hook.  
**Blockers:** If I can’t save anything (or don’t understand where it goes), the loop doesn’t close.  
**Severity:** **P0** (retention engine).  
**Evidence:** `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__P3_type_fail_panels.png`  
**Score:** Clarity 1 / Effort 2 / Confidence 1 / Momentum 0

### S1 — First SRS session attempt: “no words” dead end
**User goal:** Do a short review session right away.  
**Expectation:** Even 1 new word should be reviewable immediately to build habit.  
**Actual:** SRS panel did not open; screenshot shows a “no words” style message.  
**Incentives:** None (dead end).  
**Blockers:** Without vocab capture, SRS cannot start → no Day 0 retention.  
**Severity:** **P0**.  
**Evidence:** `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__S1_srs_start.png`  
**Score:** Clarity 1 / Effort 2 / Confidence 1 / Momentum 0

### AUTH4 — Signup success + level selection (commitment moment)
**User goal:** Save progress and get personalization.  
**Expectation:** Simple level mapping with guidance (“A2 → Beginner”).  
**Actual:** Level selection modal appears and can be dismissed; user panel shows logged-in email.  
**Incentives:** “Save progress across devices” is concrete value.  
**Blockers:** If CEFR/levels aren’t explained, A2 may choose wrong and feel “too hard”.  
**Severity:** **P1**.  
**Evidence:** `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__AUTH4_level_selection.png`  
**Score:** Clarity 2 / Effort 1 / Confidence 2 / Momentum 2

### AUTH5 — Skill Tree visible; Adaptive Engine modal not reachable
**User goal:** Understand progress systems (coins/skills/difficulty) without feeling lost.  
**Expectation:** “Adaptive Engine” explanation opens and tells me what changed and why.  
**Actual:** Skill tree / shop UI appears, but Adaptive Engine modal did not open in the audit.  
**Incentives:** RPG layer can motivate if clearly tied to Listening/Speaking goals.  
**Blockers:** “Hidden system” distrust; too many concepts at once.  
**Severity:** **P1**.  
**Evidence:**  
- `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__AUTH5_skill_tree.png`  
- `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__AUTH5_adaptive_engine.png`  
**Score:** Clarity 1 / Effort 2 / Confidence 1 / Momentum 1

### AUTH6 — Vocab add + SRS review (best “loop closure” moment)
**User goal:** Capture a word → immediately review → see Vietnamese help.  
**Expectation:** One clear loop: Practice → Save → Review (with VN translation).  
**Actual:** Vocab add modal appears; manual add succeeds; SRS panel opens and Vietnamese translation text is present on a card.  
**Incentives:** This is the strongest retention hook for an A2 Vietnamese learner.  
**Blockers:** The UI still shows “0 words due” while a session is visible (possible concept confusion).  
**Severity:** **P1** (make it more intuitive).  
**Evidence:**  
- `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__AUTH6_vocab_add_modal.png`  
- `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__AUTH6_srs_panel.png`  
- `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T18-59-31-793Z__desktop_1366__fast__auth_admin__AUTH6_srs_vietnamese.png`  
**Score:** Clarity 2 / Effort 1 / Confidence 2 / Momentum 3

### D1 — Dictionary VN translation is fast and cached
**User goal:** Understand a word immediately without leaving the app.  
**Expectation:** VN translation appears quickly and stays fast on repeat.  
**Actual:** VN translation for “believe” is returned quickly and repeat lookup is faster (cache hit).  
**Incentives:** Strong support for VN learners; reduces dropout during practice.  
**Blockers:** If dictionary UI is hidden or too “advanced”, A2 won’t use it.  
**Severity:** **P1** (discoverability).  
**Evidence:** `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__D1_dictionary.png`  
**Score:** Clarity 2 / Effort 0 / Confidence 3 / Momentum 2

### Cross-mode exploration — “What else can I do?”
**User goal:** Verify there’s enough content/modes for daily routine.  
**Expectation:** Each mode explains what it trains (PTE mapping), then offers a simple first action.  
**Actual:** Modes load in smoke checks (Speak/Fill/Notes/Watch/Pronounce/Survival), but deeper “first task” guidance wasn’t validated.  
**Severity:** **P2** (needs more guided onboarding).  
**Evidence (mode smoke screenshots):**
- Speak: `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__SP1_speak_mode.png`
- Fill: `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__M1_fill_mode.png`
- Notes: `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__M2_notes_mode.png`
- Watch: `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__M3_watch_mode.png`
- Pronounce: `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__M4_pronounce_mode.png`
- Survival: `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/screenshots/2026-03-01T17-44-40-561Z__pixel5__fast__M5_survival_mode.png`

## Performance & reliability notes (what the learner experiences)

### Lighthouse (mobile emulation)
- Landing: perf **75**, FCP ~2.85s, LCP ~4.99s (acceptable for ad traffic). Source: `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/perf/2026-03-01T17-20-23-723Z__landing_mobile.json`
- App home: perf **35**, FCP ~14.7s, LCP ~34.4s, TBT 810ms (high dropout risk). Source: `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/perf/2026-03-01T17-20-23-723Z__app_mobile.json`

### Offline behavior (acquisition/activation)
In “offline” throttling, landing/app routes fail to load (no offline shell). Evidence: offline scenario errors in `docs/audits/2026-03-01-a2-vn-pte-onboarding/artifacts/reports/2026-03-01T17-44-40-561Z__audit-run.json` (`desktop_1366__offline`).

## “Why I would continue” (A2 VN PTE)
- If you show **PTE mapping** early (WFD/RS/RL labels) + a **Day 0 checklist** I can follow.
- If I can **safely speak** (no shame, easy retry) and get **one concrete fix** each attempt.
- If the loop closes on Day 0: **practice → save 1–3 words → SRS review** (with Vietnamese help).

## “Why I would quit”
- Any scary security warning (“enter anyway”) during loading.
- Hints/scaffolding blocked before I feel value.
- “0 words due / no words” dead ends with no guided next step.
- Home screen feels slow or “stuck loading”.
