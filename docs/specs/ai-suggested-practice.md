# AI-Suggested Practice Spec

**Status**: Draft
**Owner**: Admin

## 1. Overview
>
> Add an **AI-Suggested Practice** option alongside the current manual question selection. When enabled, the app chooses the next question for the user using a deterministic, local suggestion engine that balances **difficulty** and **vocabulary continuity** (word overlap with previous questions). This should work across **Type**, **Speak**, **Fill (Extended)**, and **Notes** modes.

## 2. Goals (The "Why")

- [ ] Reduce user effort required to pick “the right next question”.
- [ ] Increase learning continuity by chaining questions with shared vocabulary when appropriate.
- [ ] Keep the system deterministic, debuggable, and fast (no network calls required).
- [ ] Extend the existing difficulty categorization to Fill + Notes so all practice modes can be difficulty-aware.

## 3. Requirements (The "What")

### Functional

- [ ] Add a per-mode UI control to toggle **Manual** vs **AI-Suggested** practice for:
  - [ ] Type
  - [ ] Speak
  - [ ] Fill (Extended)
  - [ ] Notes
- [ ] When AI-Suggested is enabled:
  - [ ] “Next” chooses the next suggested question and navigates there.
  - [ ] “Back” navigates to the previous suggestion in-session (history stack).
  - [ ] Manual dropdown selection either:
    - [ ] is disabled/read-only, **or**
    - [ ] acts as an override that resets the AI suggestion history (decision required).
- [ ] Suggestion ranking uses, in order:
  1) **Difficulty match**
     - Type/Speak: use existing per-item `level` (1–3) and user CEFR level (1–6) from `DifficultyManager`.
     - Fill/Notes: must also have a per-item `level` (1–3) with a defined derivation method.
  2) **Word overlap with the previous question**
     - Applies to Type/Speak/Fill/Notes.
     - If user CEFR is “high enough”, require at least **1** shared word.
     - If user CEFR is “low”, attempt to find questions that share **3–4** words.
     - If no candidates meet overlap criteria, **fallback to difficulty-only** selection.
  3) **Anti-repetition**
     - Avoid selecting from a “recently used” window (per-mode; default: last 10).
     - If the pool is exhausted, allow repeats as a last resort.
- [ ] Persist the practice-selection mode (Manual vs AI-Suggested) per user:
  - [ ] Use `authUI.getCurrentUserId()` when available; otherwise treat as `guest`.
  - [ ] Store in `localStorage` with a stable key name (to be defined).

### Non-Functional

- [ ] Performance: selecting a suggestion should run in **< 50ms** on typical hardware for Type/Speak (thousands of items).
  - Expect to precompute token sets and an inverted index for overlap search.
- [ ] Determinism: given the same state (mode, current id, CEFR level, recent list) the engine returns the same suggestion.
- [ ] Resilience: if difficulty data is missing for an item, treat it as `level=1` and continue.

## 4. Interface Schema (The "Contract")

```ts
type PracticeMode = 'type' | 'speak' | 'extended' | 'notes';
type PracticeSelectionMode = 'manual' | 'ai_suggested';

type QuestionLevel = 1 | 2 | 3; // per-item difficulty
type CefrLevel = 1 | 2 | 3 | 4 | 5 | 6; // DifficultyManager CEFR

interface SuggestionState {
  mode: PracticeMode;
  selectionMode: PracticeSelectionMode;
  history: number[];      // suggested question ids visited in this session
  historyIndex: number;   // pointer for Back/Next navigation
  recentIds: number[];    // sliding window to avoid repetition
}

interface SuggestionConfig {
  recentWindowSize: number;              // e.g., 10
  highCefrThreshold: CefrLevel;          // decision required
  overlapTargetHigh: number;             // default: 1
  overlapTargetLow: number;              // default: 3 or 4
  useContentWordsOnly: boolean;          // decision required
}

interface SuggestionEngine {
  suggestNext(params: {
    mode: PracticeMode;
    currentQuestionId: number;
    userCefrLevel: CefrLevel;
    state: SuggestionState;
  }): { nextQuestionId: number; reason: string };
}
```

**Difficulty mapping**

```ts
function mapCefrToQuestionLevel(cefr: CefrLevel): QuestionLevel;
// Proposed default:
// 1-2 => 1 (Easy), 3-4 => 2 (Medium), 5-6 => 3 (Hard)
```

**Tokenization (overlap)**

- Normalize: lowercase, strip punctuation, split on whitespace.
- Decide whether overlap counts:
  - content-words only (stopword removal), or
  - all words (includes function words) for better availability at higher overlap thresholds.

## 5. Taste Invariants (The "How")

- [ ] No network calls for suggestions (local-only).
- [ ] Reuse existing navigation buttons and page structure; minimal HTML/CSS changes.
- [ ] Keep state per-mode and avoid global “magic” flags; changes should be easy to inspect in DevTools.
- [ ] No “AI slop”: no dead code, no commented-out blocks, no unused globals.
- [ ] Do not change DifficultyManager’s leveling behavior as part of this feature.

## 6. Open Questions

- [ ] What is the exact CEFR cutoff for “high enough” (e.g., `>= 4` / B2)?
- [ ] Should overlap use content-words-only, all-words, or a hybrid (content-words first, relax to all-words)?
- [ ] For low-level users, is overlap computed against only the immediately previous question, or a sliding window of the last N questions?
- [ ] Which source of CEFR should Fill/Notes use (reuse Type CEFR, or add new DifficultyManager profiles)?
- [ ] How should Notes difficulty be stored:
  - [ ] add `level` column to the Excel + Firestore docs, or
  - [ ] maintain a separate `public/database/notes/index.json` similar to other modes?
