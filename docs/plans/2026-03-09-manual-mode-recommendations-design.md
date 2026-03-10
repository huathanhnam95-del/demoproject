# Design: Manual Mode Recommendations

Date: 2026-03-09
Status: Approved

## 1. Objective

Add a deterministic `Recommended` jump to manual question selection so users can either pick any visible question themselves or jump to the system's best next match. This applies to Type, Speak, Fill (`extended`), and Notes without changing adaptive difficulty behavior.

## 2. Product Shape

### 2.1 Existing Mode Semantics Stay Intact

- Type, Speak, and Fill already expose a two-state toggle backed by `DifficultyManager.globalSettings.autoAdjustEnabled`.
- Adaptive mode remains unchanged.
- Manual mode remains user-controlled; the new feature is an extra action inside manual, not a third navigation mode.
- Notes does not currently participate in the manual/adaptive toggle system, so it gets the same `Recommended` action without introducing a new toggle in this phase.

### 2.2 Recommendation Controls

- Add a `Recommended` button for:
  - Type
  - Speak
  - Fill (`extended`)
  - Notes
- Add a short explanation label beside or below the button.
- The label must stay generic, for example:
  - `Recommended next: #214`
  - `Recommended next: #214 - strong match`
  - `Recommended next: #214 - level + continuity fit`
- The label must not list shared words explicitly.

### 2.3 Candidate Pool Rules

- Recommendations are chosen only from the questions currently visible in the active dropdown.
- This means existing filters continue to work automatically:
  - Type/Speak status filters
  - Type/Speak length filters
  - Type/Speak/Fill/Notes difficulty filters
  - Notes status filter
- The current question is excluded unless it is the only remaining candidate.

## 3. Recommendation Engine

### 3.1 Inputs

- Active mode: `type | speak | extended | notes`
- Current question id
- Current visible dropdown options
- Effective CEFR level from `DifficultyManager` when available
- Per-mode recent history

### 3.2 Scoring

The engine is local-only and deterministic.

Primary signals:

1. Difficulty fit
2. Vocabulary continuity
3. Recent-repeat avoidance

Proposed behavior:

- Map CEFR `1..6` to question level `1..3`
  - `1-2 => 1`
  - `3-4 => 2`
  - `5-6 => 3`
- Difficulty score
  - `1.0` for exact match
  - `0.5` for one-level gap
  - `0.0` otherwise
- Vocabulary continuity score
  - normalized overlap based on cleaned tokens
  - prefer content-bearing words when possible
  - fall back gracefully if overlap is sparse
- Repeat avoidance
  - penalize items inside a recent per-mode window
  - default recent window: 10

### 3.3 Text Sources By Mode

- Type: `correctSentence`
- Speak: `correctSentence`
- Fill (`extended`): `transcript`, falling back to `correctSentence` if needed
- Notes: `transcript`

### 3.4 Engine Output

The engine should return structured metadata, not a user-facing sentence.

Example shape:

```js
{
  nextQuestionId: 214,
  reasonCode: 'level_and_continuity',
  score: 0.84
}
```

UI code formats `reasonCode` into a generic human label. This prevents raw token lists from leaking into the interface.

## 4. Session Behavior

### 4.1 Manual Override

- Manual dropdown selection stays enabled.
- If the user manually selects a different question, that question becomes the new anchor for recommendation.
- Manual selection does not wipe the entire recent-history buffer.

### 4.2 Next and Back

- In manual mode, existing `Next` and `Back` buttons remain sequential.
- The new `Recommended` button performs the smart jump.
- Notes follows the same rule: keep existing previous/next behavior, add the smart jump as a separate action.

## 5. Technical Shape

### 5.1 Shared Helper

Create a shared browser helper under `public/js/` that:

- precomputes cleaned token sets per item
- stores minimal per-mode recent history
- exposes pure functions for:
  - CEFR mapping
  - token extraction
  - index creation
  - recommendation scoring
  - recent-history updates

The helper should be importable in tests and also assign a browser global so both `public/script.js` and `public/take-notes-mode.js` can consume it without duplicating logic.

### 5.2 Integration Split

- `public/script.js`
  - Type
  - Speak
  - Fill (`extended`)
- `public/take-notes-mode.js`
  - Notes-specific state, UI updates, and button wiring

## 6. Non-Goals

- No third `AI Suggested` toggle state
- No changes to adaptive difficulty promotion/demotion logic
- No network-backed recommendation service
- No explicit explanation of shared vocabulary in UI text

## 7. Verification Strategy

- Add a Node test for the shared recommendation helper
- Add a small markup-shape test for the new control ids
- Manually verify:
  - Type manual mode
  - Speak manual mode
  - Fill manual mode
  - Notes mode
  - filter-aware candidate selection
  - repeat avoidance
