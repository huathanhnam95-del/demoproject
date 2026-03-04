# Fill Mode (Extended) Spec

**Status**: Implemented
**Owner**: Admin

## 1. Overview
>
> Fill Mode trains contextual usage: the user completes a sentence or short context with missing pieces. Scaffolding includes "ghost word" hints and collocation-driven prompting.

## 2. Goals (The "Why")

- Train context sensitivity (not just transcription).
- Teach common patterns and collocations explicitly.

## 3. Requirements (The "What")

### Functional

- Present a context with blanks/cloze slots.
- Allow users to fill in missing words/phrases.
- Provide scaffolding hints (ghost word, collocation prompts).
- Score against canonical answers and award rewards.

### Non-Functional

- Keep prompts understandable at low levels (A1-B1) and progressively remove scaffolding.
- If audio/transcript assets are missing, surface a recoverable error and keep navigation/mode switching functional.
- Result rendering must remain available even when reward/scoring backend calls fail (best-effort persistence).

## 4. Data & Contracts (The "Contract")

- Content items: Firestore `contentItems/{extended_<id>}`.
- Attempt scoring + rewards: `functions/src/submitAttempt.js` (`mode = 'extended'`).
- Local dataset: `public/database/extended/index.json`.
  - Each item must include `level: 1 | 2 | 3` for difficulty-aware flows (same level scale as Type/Speak).
- Client orchestration + fallback behavior: `public/script.js` (gap generation, local correctness rendering, retry/randomize controls).
- Audio loader contract: try `mp3`, `wav`, `m4a` under `public/database/extended/audio/` before failing with explicit user-facing error.

### 4.1 Fill Difficulty Categorization (Level 1-3)

Fill difficulty is computed from three signals and mapped to the same level semantics used in Type/Speak:

- `level = 1`: easy
- `level = 2`: medium
- `level = 3`: hard

Signals:

- Concept difficulty (gap words): rarity of missing words using `wordfreq.zipf_frequency`.
- Collocation difficulty (gap context): rarity of local 2-3 word phrases around each gap.
- Load difficulty: number of gaps in the item.

Scoring:

- Concept score `0..2` from `gap_min_zipf` and `gap_rare2_avg` (+ abstract-word suffix bump).
- Collocation score `0..2` from `colloc_min_zipf` and `colloc_rare2_avg`.
- Load score `0..2` from `gap_count`.
- `core = 2*concept + 2*collocation + load`
- Mapping:
  - `level = 3` when `core >= 6` (or concept is max and collocation is at least medium)
  - `level = 2` when `core >= 3`
  - `level = 1` otherwise

Canonical regeneration script:

- `python scripts/classify_extended_levels.py --dry-run`
- `python scripts/classify_extended_levels.py --write`

## 5. Verification

- Manual:
  - Complete a correct fill -> verify scoring and rewards.
  - Use scaffolding -> verify calibration/reward changes (if applicable).
  - Simulate missing audio file for an item -> verify explicit error feedback appears and app shell remains usable.
  - Simulate scoring endpoint failure -> verify gap/phrase correctness feedback still renders and user can continue.
- Data:
  - Run `python scripts/classify_extended_levels.py --dry-run` and confirm level distribution is reasonable.
  - Run `node tests/extended-levels.test.mjs` and confirm all extended items have valid `level`.
