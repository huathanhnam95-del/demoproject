# RPG Progression & Economy Spec

**Status**: Implemented
**Owner**: Admin

## 1. Overview
>
> The RPG layer turns practice into progression: users earn **XP + Coins**, level up, and spend Coins on a **Skill Tree** (active assists + passive perks) that modifies how practice feels and how rewards are calibrated.

## 2. Goals (The "Why")

- Convert repetition into a satisfying long-term progression loop.
- Make assists explicit, priced, and *calibrated* so they help without invalidating proficiency.
- Prevent farming (repeat the same item for infinite rewards).

## 3. Requirements (The "What")

### Functional

- **Dual-track scoring**
  - Track A: XP + Coins ("grind")
  - Track B: Skill ratings / CEFR-like proficiency ("truth")
- **Level math (quadratic)**
  - XP required for a level is quadratic: `XP = 25 * level^2`.
  - Level is derived from total XP: `level = floor(sqrt(totalPoints / 25))`.
- **Coins**
  - Coins are earned from practice and spent on skills and items.
- **Skill Tree**
  - Four branches: Listening / Reading / Writing / Speaking.
  - See [Skill Catalog](skill-catalog.md) for the full roster of audited skills and status.
  - Active skills can have a per-use cost (coin cost per attempt).
  - Passive perks modify costs/rebates and unlock licenses for modes.
- **Anti-farm**
  - Repeating the same content has diminishing returns (server-side ledger).
- **Server authority**
  - Attempt scoring and rewards are computed server-side against canonical content.

### Non-Functional

- Economy computations must be deterministic and debuggable (loggable breakdowns).
- All write operations must be idempotent (avoid double-awarding on retries).
- Fail-closed requirement: failed purchases/attempt writes must not partially mutate coins/xp.
- Client-side practice flow must continue even when economy RPC calls fail/unavailable (no hard-stop on learning loop).

## 4. Data & Contracts (The "Contract")

- Level / Skill tree rendering (client): `public/js/modules/level-system.js`
  - Uses `users/{uid}.totalPoints` for overall level.
  - Uses `users/{uid}.skillPoints[branch]` for branch/core levels.
- Client submission wrapper: `public/script.js` (`handleDualTrackScoring`)
  - Skips cloud writes for guest/no-auth sessions.
  - Uses `attemptId` context and tolerates RPC failure without crashing mode UI.
- Attempt submission (server-authoritative): `functions/src/submitAttempt.js`
  - Idempotency key: `users/{uid}/pointsHistory/{attemptId}`.
  - Updates:
    - `users/{uid}.totalPoints` (Track A)
    - `users/{uid}.coins` (Track A)
    - `users/{uid}.skillRatings` (Track B)
  - Maintains an award ledger (`users/{uid}/awardLedger/{mode__contentId}`) for diminishing returns.
  - Extended-mode fallback scoring path accepts client counts when canonical gaps/answers are unavailable.
- Purchases:
  - Skills: `functions/src/purchaseSkill.js` (+ `functions/src/skillCatalog.js`)
  - Items: `functions/src/purchaseItem.js`
  - Both purchase functions execute in Firestore transactions and return explicit errors (`already_unlocked`, `insufficient_funds`, etc.).

## 5. Rewards & Calibration (Core Rules)

- Rewards scale with:
  - Accuracy and difficulty (server-side scoring).
  - Repeat multipliers (anti-farm).
  - Assist calibration multiplier (using assists reduces how much an attempt "counts").
- "Assisted" attempts should still give *some* credit, but less than clean attempts.

## 6. Verification

- Manual:
  - Complete a Type attempt -> verify XP/Coins increase.
  - Repeat the same content multiple times in a day -> verify diminishing rewards.
  - Use a paid assist (hint/reveal) -> verify calibrated rewards (lower multipliers).
  - Submit same `attemptId` twice -> verify second call returns idempotent `alreadyRecorded` behavior with no extra award.
  - Simulate submitAttempt RPC failure -> verify attempt UI still completes locally without app crash.
  - Attempt purchase with insufficient funds -> verify coins remain unchanged and error is explicit.
