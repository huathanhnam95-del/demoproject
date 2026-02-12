# RPG Progression System (XP + Coins + Skill Trees + Calibration Penalties)
Last updated: 2026-02-09

## 0) Goals (agreed)
- Make the app feel like an RPG: practice = “farming” → earn **XP + Coins** → unlock **Active**/**Passive** skills.
- XP is **split across the 4 core skills**: **Listening, Writing, Reading, Speaking**.
- **All practice modes are available from day 1** (no unlocking modes). Skills unlock tools/perks only.
- **Active skills cost coins to use** (coin dump). No XP reduction for using skills.
- **Passive skills reduce coin costs** (discounts / permits / licenses).
- Prevent “assisted attempts” from inflating calibration:
  - Penalize **Adaptive Difficulty** calibration (client) so it won’t promote too fast.
  - Penalize **Track B proficiency rating** updates (server) so CEFR doesn’t rise too fast.

---

## 1) Current system snapshot (what exists today)

### 1.1 Coins earning (current)
Source: `C:\Users\Admin\.gemini\antigravity\brain\71021caf-209a-4e52-84c2-263f3d8aca06\coin_earning_methods.md.resolved`
- Coins are earned mainly by practice with **1 XP = 1 coin**.
- Base points are **10** with multipliers from **accuracy** and **difficulty**.
- Anti-farm diminishing returns (same content/mode per day):
  - Attempts 1–3: 100%
  - Attempts 4–6: 30%
  - Attempts 7+: 0 coins (but proficiency can still move slowly)
- Baseline: user is guaranteed a minimum of **100 coins** (starter/top-up).

### 1.2 Two separate “CEFR” systems (important)
There are **two different systems** currently labeled/behaving like “CEFR”:

1) **Track B Proficiency Rating (server authoritative)**
   - Stored in Firestore as `skillRatings.{listening,writing,reading,speaking}`.
   - Displayed in the Proficiency Dashboard (Account modal) using:
     - `public/auth-ui.js:668+` → `PointsLogic.getCefrLevel(rating)`
   - Updated in `functions/src/submitAttempt.js` using `functions/src/pointsLogic.js:updateAllRatings()`.
   - This one must be protected from “assist inflation”.

2) **Adaptive Difficulty Manager (client-side per mode)**
   - Stored in `localStorage` under `difficulty_profile`.
   - Updated by `public/js/performance-tracker.js` → `public/js/difficulty-manager.js:adjustDifficulty()`.
   - This one must also be protected from “assist inflation” (so difficulty doesn’t promote too fast).

### 1.3 Mode → skill XP contribution matrix (current)
This exists in both:
- Server: `functions/src/pointsLogic.js:52-59`
- Client mirror: `public/js/points-logic.js:61-68`

**Current values (today):**
- `type` → Listening 0.40, Writing 0.60
- `speak` → Listening 0.20, Speaking 0.80
- `extended` → Writing 0.40, Reading 0.60
- `watch` → Listening 0.50, Reading 0.50
- `notes` → Listening 0.40, Writing 0.60
- `writingChallenge` → Writing 1.00

**Required changes (agreed):**
- `extended` (Fill) must be: **Listening 0.60, Writing 0.40**
- `speak` must be: **Listening 0.60, Speaking 0.40**

---

## 2) Economy tuning baseline (so prices “feel right”)
Given current scoring:
- Base points ≈ 10, typical attempt yields ~8–18 coins (medium difficulty, non-perfect accuracy), and up to ~25–28 coins (expert + perfect).
- Therefore:
  - Minor assists should cost ~1–5 coins.
  - Medium assists ~4–10 coins.
  - Major assists ~8–20 coins.
  - Reveal-tier assists should be expensive ~16–40 coins.

---

## 3) Active skills: per-use coin sink + calibration penalty

### 3.1 Assistance calibration multiplier
Each active skill has a `calibMult` used only for calibration systems:
- Adaptive Difficulty attempt score (client)
- Track B rating update strength (server)

Per attempt:
- `attemptCalibMult = min(calibMult of all assists used on that attempt)`
- Floor: `attemptCalibMult = max(0.25, attemptCalibMult)`

### 3.2 Active skills table (tuned)
Notes:
- `D_eff = clamp(difficultyMultiplier, 1.0, 2.5)` (server-authoritative)
- “Stacking” = repeated use in same attempt becomes more expensive:
  - `cost_n = ceil(baseCost * (1.5^(n-1)))`

| Skill (ID) | What it does | Modes | Charged when | Coin cost | Tier | `calibMult` |
|---|---|---|---|---:|---|---:|
| `slow_audio` | Playback <1.0x | type/notes/extended/watch/speak | per attempt (if used) | `ceil(2*D_eff)` | Minor | 0.85 |
| `echo_loop` | Loop last 3–5s | type/notes/watch/speak | per press | `ceil(2*D_eff)` | Medium | 0.65 |
| `chunking` | Break into chunks + next/prev | type/notes | per attempt (if enabled) | `ceil(4*D_eff)` | Medium | 0.65 |
| `transcript_glimpse` | Reveal 1 short line briefly | watch/type/speak | per reveal (stacking) | `ceil(8*D_eff)` | Major | 0.40 |
| `hint_wc` | Show word/gap count | type/notes/extended | per press | `ceil(1*D_eff)` | Minor | 0.85 |
| `hint_fl` | Show first letters | type/notes/extended | per press | `ceil(4*D_eff)` | Medium | 0.65 |
| `hint_reveal` | Reveal a missing word/gap answer | type/notes/extended | per word/gap (stacking) | `ceil(16*D_eff)` | Reveal | 0.25 |
| `punct_ghost` | Show punctuation/structure placeholders | type/notes | per attempt (if used) | `ceil(2*D_eff)` | Minor | 0.85 |
| `typo_shield` | Allow +1 typo forgiveness | type/notes | per attempt (if enabled) | `ceil(5*D_eff)` | Medium | 0.65 |
| `dict_peek` | Definition + example | extended/watch | per lookup | `ceil(1*D_eff)` | Minor | 0.85 |
| `time_freeze` | Pause timer briefly | timed modes | per use | `ceil(4*D_eff)` | Medium | 0.65 |
| `evidence_highlight` | Post-answer: highlight proof sentence | extended/watch | per use | `ceil(2*D_eff)` | Post | 1.00 |
| `summary_scroll` | Post-answer summary + saved keywords | extended/watch | per passage | `ceil(4*D_eff)` | Post | 1.00 |
| `pron_rune` | IPA/stress + 1 tip before recording | speak | per prompt | `ceil(2*D_eff)` | Minor | 0.85 |
| `shadow_mode` | Speak-along timing + compare | speak | per attempt (if used) | `ceil(5*D_eff)` | Medium | 0.65 |
| `second_take` | Re-record once and keep best | speak | per attempt (if used) | `ceil(10*D_eff)` | Major | 0.40 |
| `streak_shield` | Prevent streak break (meta, not answer-help) | any | per use | `40` flat | Meta | 1.00 |

---

## 4) Passive skills: discounts + permits + licenses (assigned to LRWS trees)
Design rules:
- Passives **only reduce coin costs / add QoL**, they do **not** reduce calibration penalties (`calibMult` stays the same).
- Discounts are capped (recommended): total discount per active use ≤ **50%**.

### 4.1 Cost tiers (one-time purchases)
Use a simple “level → cost” curve (per core skill level):
- L2: 400
- L4: 900
- L6: 1,600
- L8: 2,400
- L10: 3,300
- L12: 4,500

> These are tuned to current coin income (~8–18 coins/attempt) so early passives are reachable, and late passives are meaningful sinks.

### 4.2 Listening tree passives (affects: type/watch/notes/speak assists)
| Req Lvl | Passive (ID) | Effect | Cost |
|---:|---|---|---:|
| 2 | `frugal_listener_1` | -10% cost on: `slow_audio`, `echo_loop`, `chunking`, `transcript_glimpse` | 400 |
| 4 | `audio_engineer` | Extra -15% on: `slow_audio`, `echo_loop` (stacks; still capped) | 900 |
| 6 | `frugal_listener_2` | Upgrade to -20% (replaces rank 1) | 1,600 |
| 8 | `transcript_permit` | -20% on `transcript_glimpse` **and** stacking exponent 1.5→1.3 | 2,400 |
| 10 | `clean_streak_saver` | After 5 correct attempts with **no actives**, next Minor/Medium active is 50% off (once) | 3,300 |
| 12 | `frugal_listener_3` | Upgrade to -30% (replaces rank 2) | 4,500 |

### 4.3 Writing tree passives (affects: type/notes/extended assists)
| Req Lvl | Passive (ID) | Effect | Cost |
|---:|---|---|---:|
| 2 | `frugal_writer_1` | -10% on: `hint_wc`, `hint_fl`, `hint_reveal`, `punct_ghost`, `typo_shield` | 400 |
| 4 | `hint_kit` | Extra -20% on `hint_wc` + `hint_fl` only (never on `hint_reveal`) | 900 |
| 6 | `frugal_writer_2` | Upgrade to -20% (replaces rank 1) | 1,600 |
| 8 | `coupon_book` | First active used each session is 50% off | 2,400 |
| 10 | `combo_coupon` | After 5 correct attempts with **no actives**, next active is 30% off (once; then resets) | 3,300 |
| 12 | `frugal_writer_3` | Upgrade to -30% (replaces rank 2) | 4,500 |

### 4.4 Reading tree passives (affects: watch/extended assists)
| Req Lvl | Passive (ID) | Effect | Cost |
|---:|---|---|---:|
| 2 | `frugal_reader_1` | -10% on: `dict_peek`, `evidence_highlight`, `summary_scroll` | 400 |
| 4 | `mode_license_watch` | -15% on all active costs used in **watch** mode | 900 |
| 6 | `frugal_reader_2` | Upgrade to -20% (replaces rank 1) | 1,600 |
| 8 | `no_reveal_rebate` | If you used **no Major/Reveal/SecondTake** and finish ≥90% accuracy, refund 25% of active spend for that attempt | 2,400 |
| 10 | `mode_license_extended` | -15% on all active costs used in **extended** mode | 3,300 |
| 12 | `frugal_reader_3` | Upgrade to -30% (replaces rank 2) | 4,500 |

### 4.5 Speaking tree passives (affects: speak assists)
| Req Lvl | Passive (ID) | Effect | Cost |
|---:|---|---|---:|
| 2 | `frugal_speaker_1` | -10% on: `pron_rune`, `shadow_mode`, `second_take` | 400 |
| 4 | `breath_control` | Extra -15% on `pron_rune` + `shadow_mode` | 900 |
| 6 | `frugal_speaker_2` | Upgrade to -20% (replaces rank 1) | 1,600 |
| 8 | `second_take_insurance` | -20% on `second_take` (still capped) | 2,400 |
| 10 | `mode_license_speak` | -15% on all active costs used in **speak** mode | 3,300 |
| 12 | `frugal_speaker_3` | Upgrade to -30% (replaces rank 2) | 4,500 |

---

## 5) Calibration protection plan (core requirement)

### 5.1 Server: Track B proficiency (skillRatings / CEFR badges)
Where ratings are updated today:
- `functions/src/submitAttempt.js:121-128` calls `pointsLogic.updateAllRatings(..., ratingMult)`
- `ratingMult` comes from anti-farm `computeRepeatMults()` (`functions/src/submitAttempt.js:435-448`)

Change (planned):
1) Read assist usage for this `attemptId` (server authoritative; see 6.2).
2) Compute `attemptCalibMult`.
3) Apply to rating movement **only**:
   - `effectiveRatingMult = ratingMult * attemptCalibMult`
   - Use `effectiveRatingMult` in `updateAllRatings()`.
4) Optional (recommended): apply the multiplier only to upward deltas:
   - If `performanceScore > currentRating` → scale delta
   - Else do not scale (assists shouldn’t make users “derank faster”)

Track A XP/coins stay unchanged.

### 5.2 Client: Adaptive Difficulty Manager (per-mode)
Where difficulty is adjusted today:
- `public/js/performance-tracker.js:34-39` → `DifficultyManager.adjustDifficulty(mode, attemptScore)`
- Attempt score already includes a hint penalty via `hintsUsed` (`public/js/performance-tracker.js:88-99`)

Change (planned):
1) Replace “hint penalty” with the same tiered assist model:
   - Compute `attemptCalibMult` from used active skills that attempt.
2) Send `adjustDifficulty(mode, attemptScore * attemptCalibMult)`.
3) Update Smurf fast-track in `public/js/difficulty-manager.js:332-345`:
   - Only allow SMURF promotion when the last five are **unassisted** (or `attemptCalibMult >= 0.9`).

---

## 6) Implementation details (data + security)

### 6.1 Skill definitions (single source of truth)
Create a canonical config object shared (or mirrored) client/server:
- `id`, `type` (active/passive), `tags` (L/R/W/S), `unlockLevel`
- For actives: `baseCost`, `stackingPolicy`, `calibMult`
- For passives: `discountRules`, `modeLicense`, etc.

### 6.2 Server-authoritative assist usage ledger
To prevent client cheating:
- Add an onCall function `useActiveSkill` (transaction):
  - Inputs: `{ attemptId, mode, contentId, skillId }`
  - Server loads canonical difficulty (same logic as scoring) to compute `D_eff`
  - Computes final coin cost with passive discounts + stacking
  - Deducts coins
  - Writes `assistLedger/{attemptId}`:
    - `skillsUsed: [{ skillId, tier, calibMult, cost, ts }]`
    - `attemptCalibMult` (derived)
    - `totalCost`

On `submitAttempt`, server reads `assistLedger/{attemptId}` to apply calibration penalties to Track B.

---

## 7) Step-by-step implementation plan (engineering checklist)

### Step 1 — Update contribution weights (server + client mirror)
- Update `functions/src/pointsLogic.js` MODE_WEIGHTS:
  - `extended` → listening 0.60, writing 0.40
  - `speak` → listening 0.60, speaking 0.40
- Mirror changes in `public/js/points-logic.js`.

### Step 2 — Remove mode unlocking (modes always available)
- Ensure `public/script.js` no longer blocks modes using `shopModule.isModeUnlocked(mode)` (search hits exist today).
- Keep skill purchases strictly for tools/perks, not access.

### Step 3 — Create skill config + user inventory model
- Add shared “skills catalog” (IDs from section 3 & 4).
- Add user fields:
  - `unlockedSkills: { [skillId]: true }`
  - `passives: { [passiveId]: { rank?: number, acquiredAt } }`

### Step 4 — Implement purchases
- `buySkill` onCall (transaction):
  - Verify requirement (core skill level, coins)
  - Deduct coins
  - Mark skill unlocked

### Step 5 — Implement `useActiveSkill` onCall (transaction)
- Verify:
  - skill unlocked
  - enough coins
  - stacking + caps + discounts
- Deduct coins and persist assist usage under `assistLedger/{attemptId}`.

### Step 6 — Apply calibration penalties (server Track B)
- In `functions/src/submitAttempt.js`:
  - Read `assistLedger/{attemptId}` (if any)
  - Compute `attemptCalibMult` (or use stored)
  - Apply `effectiveRatingMult = ratingMult * attemptCalibMult`
  - Keep Track A XP/coins unchanged
  - Store assist summary into points history for transparency

### Step 7 — Apply calibration penalties (client DifficultyManager)
- Track active skill usage per attempt in UI state.
- Multiply `attemptScore` by `attemptCalibMult` before calling `adjustDifficulty`.
- Update SMURF logic to only consider unassisted attempts.

### Step 8 — UI/UX
- Show active skills with:
  - coin cost (live)
  - disabled if insufficient coins
  - small “Calibration Impact” tooltip by tier
- Show passive discounts and cap behavior.

### Step 9 — Test plan
- Unit tests:
  - discount + cap math
  - stacking math
  - `attemptCalibMult` aggregation
- Integration tests:
  - `useActiveSkill` then `submitAttempt` applies reduced rating movement but full Track A XP/coins
  - assisted attempts do not trigger SMURF promotion in DifficultyManager

---

## 8) Skill-by-skill coding plan (detailed)
This section expands the engineering checklist into concrete, per-skill implementation steps.

### 8.0 Shared foundations (implement once; all skills depend on this)
**A) Attempt identity and lifecycle (critical)**
1) Generate a stable `attemptId` **at question load/start**, not at submit time.
   - Today, `public/script.js` generates `attemptId` inside `handleDualTrackScoring()` right before calling the Cloud Function.
   - Change: create `attemptId` when a new question is loaded (per mode), store it in a single place (e.g. `window.activeAttempt = { attemptId, mode, contentId, assistsUsed: {}, totalAssistCost: 0 }`).
2) Ensure all active-skill uses reference the same `{ attemptId, mode, contentId }` that will be passed to `submitAttempt`.
3) On question change/reset/retry, create a fresh `attemptId` and clear client-side assist state.

**B) Canonical Skill Catalog (single source of truth)**
1) Create a server-side catalog module (recommended path: `functions/src/skillCatalog.js`) containing:
   - `id`, `kind: 'active'|'passive'`, `tags: ['listening'|'writing'|'reading'|'speaking']`
   - `allowedModes`
   - Actives: `{ baseCost, costPolicy, stacking, calibMult, tier }`
   - Passives: `{ effectType, params }`
2) Create a client mirror (recommended path: `public/js/skill-catalog.js`) used for:
   - Rendering the skill trees
   - Showing estimated costs in the UI
   - Feature gating (disable buttons if locked)
   - (But never trusting client for coin deductions or ledger)

**C) User inventory data model**
Add to user doc (Firestore) as needed:
- `unlockedSkills: { [skillId]: true }` (or array; map is easier for reads)
- `skillPassives: { [passiveId]: { acquiredAt, rank? } }`
- `economyState` for stateful passives (coupon/rebate/streak-based):
  - `economyState.daily`: `{ date, couponBookUsed, ... }`
  - `economyState.noAssistStreak`: `{ count, updatedAt }`
  - `economyState.discountTokens`: `{ minorMedium50: number, nextActive30: number }` (optional tokenization)

**D) Cloud Functions**
1) `purchaseSkill` (or extend `purchaseItem`):
   - Validates: authenticated, skill exists, not already owned, has required core-skill level, has enough coins.
   - Writes: deduct coins, set `unlockedSkills[skillId]=true`, add purchase record.
2) `useActiveSkill` (new; server-authoritative assist ledger writer):
   - Inputs: `{ attemptId, mode, contentId, skillId, clientMeta? }`
   - Validates: authenticated, skill unlocked, skill is active, mode allowed, `attemptId` well-formed.
   - Resolves `D_eff` from canonical content (same source as scoring).
   - Computes coin cost using: baseCost * D_eff * stacking * (1 - discountPct), with caps.
   - Deducts coins in transaction and appends to `assistLedger/{attemptId}`.
   - Returns: `{ success, cost, newBalance, attemptCalibMult, assistSummary }`.

**E) Discount engine (used by `useActiveSkill`)**
Implement a single function (server-side) `computeActiveSkillFinalCost({ userData, attempt, skillId, priorUsesInAttempt })` that:
1) Reads relevant passive ownership from user data.
2) Computes discount components:
   - Frugal rank discounts (skill-tag based)
   - Mode license discounts (mode based)
   - Skill-specific permits/insurances (skillId based)
   - Token-based discounts (couponBook/comboCoupon/cleanStreakSaver) if implemented
3) Enforces: `totalDiscountPct = min(totalDiscountPct, 0.50)`.
4) Applies stacking rule if the skill is stackable:
   - Default exponent 1.5, transcript_permit exponent 1.3
5) Outputs: `{ finalCost, discountBreakdown }`.

**F) Calibration penalty plumbing**
1) Server Track B:
   - In `functions/src/submitAttempt.js`, read `assistLedger/{attemptId}` (if present).
   - Compute `attemptCalibMult`.
   - Apply: `effectiveRatingMult = ratingMult * attemptCalibMult` when calling `updateAllRatings()`.
2) Client Adaptive Difficulty:
   - Replace hint-count penalty with assist-based multiplier.
   - Track `attemptCalibMult` client-side (best source: the response from `useActiveSkill`).
   - Call `DifficultyManager.adjustDifficulty(mode, attemptScore * attemptCalibMult)`.
   - Update SMURF rule to require unassisted attempts (or `attemptCalibMult >= 0.9`).

---

### 8.1 Active skill implementation (each)

#### `slow_audio` (Active, Minor, `calibMult=0.85`)
**Feature:** allow playback speed < 1.0 (Type + other audio-based modes).
1) Catalog:
   - `costPolicy: per_attempt` (charge once if user ever sets speed < 1.0 this attempt).
2) UI:
   - Use existing speed controls (`public/index.html` has `#speed-toggle-btn`; extended has speed selects).
   - Gate: if not unlocked, disable controls and show tooltip “Unlock Slow Audio”.
3) Client:
   - On first transition to `< 1.0x` this attempt:
     1) Call `useActiveSkill({ attemptId, mode, contentId, skillId:'slow_audio' })`.
     2) If success, apply `audio.playbackRate = newSpeed` and mark `assistsUsed['slow_audio']=1`.
     3) If failure (insufficient coins), keep speed at `1.0x` and show “Need X coins”.
4) Server:
   - Use `D_eff` from canonical scoring source.
   - Discounts: Listener frugal ranks, Audio Engineer, mode licenses, coupon tokens.

#### `echo_loop` (Active, Medium, `calibMult=0.65`)
**Feature:** replay/loop assist.
1) Catalog:
   - Recommended `costPolicy: per_enable` (charge when turning loop on; no charge for turning off).
2) UI:
   - Use existing `#loop-btn`.
   - Gate: disable if locked.
3) Client:
   - When enabling loop:
     - Call `useActiveSkill(..., 'echo_loop')`; on success set `audio.loop = true`.
   - When disabling loop: set `audio.loop = false` without charge.
4) Server:
   - Stackable? (recommended: not stackable per attempt; keep it per-enable).
   - Discounts: Listener frugal ranks, Audio Engineer, mode licenses.

#### `chunking` (Active, Medium, `calibMult=0.65`)
**Feature:** split a sentence/audio into chunks.
1) Catalog:
   - `costPolicy: per_attempt` (charge once if enabled during attempt).
2) UI:
   - Add a toggle button in Type/Notes toolbars (“Chunk”).
3) Client:
   - On toggle ON:
     - Call `useActiveSkill(..., 'chunking')`.
     - On success: compute chunk boundaries (by punctuation, or every N words) and show “Chunk navigator”.
4) Server:
   - Discounts: Listener frugal ranks; mode licenses.

#### `transcript_glimpse` (Active, Major, `calibMult=0.40`)
**Feature:** reveal a short transcript snippet briefly.
1) Catalog:
   - `costPolicy: per_use` with stacking exponent (default 1.5).
2) UI:
   - Add a “Glimpse” button near hints in Type/Watch/Speak.
3) Client:
   - On click:
     - Call `useActiveSkill(..., 'transcript_glimpse')`.
     - On success: show 1 line/segment for ~2s; then hide.
4) Server:
   - Apply stacking: `cost_n = ceil(baseCost*D_eff*(exp^(n-1)))`.
   - If user has `transcript_permit`, change exponent 1.5→1.3 and apply -20% discount.

#### `hint_wc` (Active, Minor, `calibMult=0.85`)
**Feature:** show word/gap count (or word ghost).
1) Catalog:
   - `costPolicy: per_use` (cheap).
2) UI:
   - Keep the existing Hint button; internally map level-1 hint to `hint_wc`.
3) Client:
   - On request:
     - Call `useActiveSkill(..., 'hint_wc')`.
     - On success: render the word count / word ghost hint.
4) Server:
   - Discounts: Writer frugal ranks, Hint Kit (if applicable), mode licenses.

#### `hint_fl` (Active, Medium, `calibMult=0.65`)
**Feature:** show first letters.
1) Catalog:
   - `costPolicy: per_use`.
2) UI:
   - Map “next hint level” to `hint_fl`.
3) Client:
   - Call `useActiveSkill(..., 'hint_fl')` before revealing letters.
4) Server:
   - Discounts: Writer frugal ranks, Hint Kit (applies), mode licenses.

#### `hint_reveal` (Active, Reveal, `calibMult=0.25`)
**Feature:** reveal an answer token (word or gap).
1) Catalog:
   - `costPolicy: per_token` with stacking (expensive coin sink).
2) UI:
   - Extended: allow “Reveal this gap”.
   - Type/Notes: implement “Reveal next word” (or reveal one masked word).
3) Client:
   - Call `useActiveSkill(..., 'hint_reveal')` per revealed token.
   - Apply the reveal in UI only after success.
4) Server:
   - Enforce stacking and cap usage per attempt if desired (recommended: max 3 reveals/attempt).
   - Discounts: Writer frugal ranks only (explicitly exclude Hint Kit discounts here).

#### `punct_ghost` (Active, Minor, `calibMult=0.85`)
**Feature:** show punctuation/structure placeholders to guide typing.
1) Catalog:
   - `costPolicy: per_attempt` (charge once; toggle on/off free).
2) UI:
   - Add a toggle in Type/Notes.
3) Client:
   - On enable: call `useActiveSkill(..., 'punct_ghost')`.
   - Render a “structure line” (punctuation + underscores) above input.

#### `typo_shield` (Active, Medium, `calibMult=0.65`)
**Feature:** allow one “typo forgiveness” in client-side correctness/streak logic.
1) Catalog:
   - `costPolicy: per_attempt`.
2) UI:
   - Toggle near check button (“Typo Shield”).
3) Client:
   - On enable: call `useActiveSkill(..., 'typo_shield')`.
   - When computing `hasErrors` for local correctness, allow 1 non-match group before marking incorrect.
4) Server:
   - No changes to server scoring (still authoritative for XP/coins), but Track B calibration is penalized via `attemptCalibMult`.

#### `dict_peek` (Active, Minor, `calibMult=0.85`)
**Feature:** dictionary lookup.
1) Catalog:
   - `costPolicy: per_lookup`.
2) UI:
   - Extended/Watch: allow selecting a word and opening a definition popover.
3) Client:
   - On lookup action:
     - Call `useActiveSkill(..., 'dict_peek')`.
     - On success, fetch/show definition (existing services can be reused if present).

#### `time_freeze` (Active, Medium, `calibMult=0.65`)
**Feature:** pause a timer briefly (only if a mode is timed).
1) Catalog:
   - `costPolicy: per_use`.
2) UI:
   - Only render if the current mode has an active timer.
3) Client:
   - Call `useActiveSkill(..., 'time_freeze')` then pause timer for fixed seconds.

#### `evidence_highlight` (Active, Post, `calibMult=1.00`)
**Feature:** after answering, highlight the proof sentence.
1) Catalog:
   - `costPolicy: per_use`.
2) UI:
   - Watch/Extended results panel: “Show Evidence”.
3) Client:
   - Call `useActiveSkill(..., 'evidence_highlight')` then highlight relevant span(s).
4) Calibration:
   - No penalty; `calibMult=1.0`.

#### `summary_scroll` (Active, Post, `calibMult=1.00`)
**Feature:** generate and save a summary after passage.
1) Catalog:
   - `costPolicy: per_passage`.
2) UI:
   - Watch/Extended completion panel: “Generate Summary”.
3) Client:
   - Call `useActiveSkill(..., 'summary_scroll')`, then generate summary (AI or template) and save into user notes.
4) Calibration:
   - No penalty; `calibMult=1.0`.

#### `pron_rune` (Active, Minor, `calibMult=0.85`)
**Feature:** show IPA/stress tips before recording.
1) UI:
   - Speak mode: “Pronunciation Tip” button.
2) Client:
   - Call `useActiveSkill(..., 'pron_rune')` then show IPA/stress from existing pronunciation tooling (if available).

#### `shadow_mode` (Active, Medium, `calibMult=0.65`)
**Feature:** speak-along timing bars + compare.
1) UI:
   - Speak mode: toggle “Shadow Mode”.
2) Client:
   - On enable: call `useActiveSkill(..., 'shadow_mode')`.
   - Render timing bars; record; show feedback.

#### `second_take` (Active, Major, `calibMult=0.40`)
**Feature:** allow one re-record and keep best.
1) UI:
   - After scoring a speak attempt, show “Second Take” if unlocked.
2) Client:
   - On click: call `useActiveSkill(..., 'second_take')` then allow one more record and keep best local result.

#### `streak_shield` (Active, Meta, `calibMult=1.00`)
**Feature:** prevent streak break (does not help answer quality directly).
1) Define what streak is (recommended MVP):
   - “Practice streak” = consecutive days with >=1 attempt in any mode.
2) UI:
   - Only show when user is about to lose streak (or after a failed attempt).
3) Server:
   - `useActiveSkill('streak_shield')` records usage; `submitAttempt` (or a dedicated function) applies streak protection atomically.

---

### 8.2 Passive skill implementation (each family)

#### Frugal ranks (discount passives)
Skills:
- Listening: `frugal_listener_1`, `frugal_listener_2`, `frugal_listener_3`
- Writing: `frugal_writer_1`, `frugal_writer_2`, `frugal_writer_3`
- Reading: `frugal_reader_1`, `frugal_reader_2`, `frugal_reader_3`
- Speaking: `frugal_speaker_1`, `frugal_speaker_2`, `frugal_speaker_3`

Implementation:
1) Purchase: `purchaseSkill` sets the highest rank owned (store rank number).
2) Discount engine:
   - Map rank → pct: 10/20/30%.
   - Apply to active skills whose tags match the passive’s core skill.

#### Mode licenses (mode-wide discounts)
Skills:
- `mode_license_watch`, `mode_license_extended`, `mode_license_speak`

Implementation:
1) Discount engine:
   - If active use `mode` matches license mode, apply -15% discount to any active skill used in that mode.

#### Skill-specific discount passives
Skills:
- `audio_engineer`: extra -15% on `slow_audio` + `echo_loop`
- `hint_kit`: extra -20% on `hint_wc` + `hint_fl` (explicitly exclude `hint_reveal`)
- `transcript_permit`: -20% on `transcript_glimpse` + stacking exponent 1.5→1.3
- `breath_control`: extra -15% on `pron_rune` + `shadow_mode`
- `second_take_insurance`: -20% on `second_take`

Implementation:
1) Discount engine checks skillId and adds these discounts and/or stacking overrides.

#### Stateful passives (require server-tracked counters)
Skills:
- `coupon_book`: first active use per day is 50% off
- `combo_coupon`: after 5 correct attempts with no actives, next active is 30% off
- `clean_streak_saver`: after 5 correct attempts with no actives, next Minor/Medium active is 50% off (once)
- `no_reveal_rebate`: refund 25% of active spend for the attempt if accuracy >= 0.90 and no Major/Reveal/SecondTake was used

Implementation approach (recommended: token-based, server authoritative):
1) Server on `submitAttempt`:
   - Determine if attempt is unassisted (`assistLedger` absent or `skillsUsed.length===0`).
   - If unassisted and accuracy >= target, increment `economyState.noAssistStreak.count`.
   - When count reaches 5, grant discount token(s) based on owned passives and reset count (or decrement by 5).
2) Server on `useActiveSkill`:
   - If a relevant token exists and the active matches the token rule, apply token discount and consume token.
   - If `coupon_book` is owned and `couponBookUsed` is false for today, apply 50% and mark used.
3) Server on `submitAttempt` rebate:
   - Read assist ledger total spend and skill tiers used.
   - If conditions met and not already refunded, add coins = ceil(0.25 * totalAssistCost) and mark `refundIssued=true` in ledger.

