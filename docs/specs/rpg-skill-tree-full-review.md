# Evaluation & Review of the RPG Skill Tree

> [!NOTE]
> This review has been finalized and implemented. For the official audited skill roster, see [RPG Skill Catalog](features/skill-catalog.md).

Based on a comprehensive review of the `rpg_progression_skill_tree_plan.md` and the `shop-expansion-feature-matrix.md`, here is a detailed analysis of the skill tree's viability, potential conflicts, and pedagogical value.

## 1. Skill Concept & Design Cohesion

The split between **Active Skills (Coin Sinks)** and **Passive Skills (Coin Discounts/Perks)** is exceptionally well-designed for a continuous learning loop. Earning coins via XP (Track A) and burning them for immediate assistance creates a satisfying gamification loop. The penalty to the Adaptive/Track B calibration ensures the integrity of the user's actual proficiency rating.

## 2. Skill-by-Skill Viability and Conflict Analysis

### A. The "Hint" Class Skills (Overlap Warning)

- **`wordGhost` (Stage 1 / Implemented)** vs **`hint_wc` (Word Count)** vs **`punct_ghost`**:
  - *Conflict*: `wordGhost` provides `_ _ _` placeholders. This inherently tells the user exactly how many words/gaps there are, rendering `hint_wc` obsolete. Furthermore, `punct_ghost` shows punctuation/structure, which can easily be combined with `wordGhost` (e.g., `___ , ___ .`).
  - *Recommendation*: Merge `hint_wc` and `punct_ghost` into a single upgraded **"Structure Ghost"** skill stream. Base level shows word slots (`wordGhost`), upgraded level reveals punctuation.
- **`firstLetterPeek` (Implemented)**: Excellent timed mechanism (800ms) to unblock without fully giving away the answer. High pedagogical value.
- **`hint_reveal`**: The ultimate fallback. Essential for progression, perfectly balanced by its massive calibration penalty (`calibMult=0.25`).

### B. Audio Comprehension Skills (Excellent Synergy)

- **`slow_audio` (Implemented)** & **`echo_loop` (Implemented)**: Foundational tools for dictation (`Type`) and `Speak` modes.
- **`chunking`**: Breaks sentences into semantic chunks.
  - *Analysis*: Highly valuable for long sentences. Does not conflict with slow/loop, but complements them. This requires sentence tokenization logic on the frontend.
- **`transcript_glimpse`**: Reveals 1 short line of a transcript briefly.
  - *Analysis*: Highly valuable for `Watch` mode.

### C. Reading & Context Skills

- **`dict_peek` (Dictionary Lookup)**:
  - *Analysis*: Immense pedagogical value for vocabulary acquisition.
  - *Risk*: Requires a dictionary API integration (e.g., Free Dictionary API) or pre-computed definitions in the database.
- **`evidence_highlight`** & **`summary_scroll`**:
  - *Analysis*: Great for post-reading reflection.
  - *Risk*: Requires either pre-computed metadata in the database or an active LLM call. If relying on LLMs, this introduces latency and variable costs.

### D. Speaking / Pronunciation Skills

- **`pron_rune` (IPA/Stress tips)** & **`shadow_mode` (Timing bars)** & **`second_take`**:
  - *Analysis*: This is a linear, highly effective progression for Speech mode. `pron_rune` (Pre-recording prep) -> `shadow_mode` (Real-time tracking) -> `second_take` (Post-recording fix).
  - *Risk*: `shadow_mode` requires significant frontend UI effort to map audio timing to text visually (like karaoke).

### E. Gamification / Meta Skills (Questionable Usability)

- **`time_freeze`**: Pauses a timer briefly.
  - *Conflict/Risk*: The current core loop does not heavily rely on strict countdown timers that fail the user. Unless a "Blitz" or "Survival" mode is active, this skill is unusable.
  - *Recommendation*: **Deprecate** or shelve until a true "Survival" mode is implemented.
- **`typo_shield`**: Forgives 1 typo.
  - *Analysis*: Low direct learning value, but high frustration-mitigating value for fast typists. Very usable.
- **`streak_shield`**:
  - *Analysis*: Standard gamification. Highly demanded by users.

### F. Passive Skill Tree (Economic Flow)

- The passives (Frugal tiers, Mode Licenses, Coupon Books) mathematically balance out correctly. They are capped at a 50% max discount, preventing the economy from breaking while providing long-term goals.

---

## 3. Recommended Adjustments (Rationalization)

1. **Remove `time_freeze`**: Do not implement until timers are an explicit failing mechanic.
2. **Merge `hint_wc` and `punct_ghost` into `wordGhost`**: Make it a tiered upgrade rather than separate buttons cluttering the UI.
3. **Phase-gate LLM features**: Delay `evidence_highlight` and `summary_scroll` unless pre-computed data is readily available in the content objects.

*(The detailed implementation plan for the surviving skills follows in the next document).*
