# AI-Suggested Practice Execution Plan

**Spec Reference**: `docs/specs/ai-suggested-practice.md`

## 1. Analysis

- [ ] Review spec and get it to **Approved** (resolve Open Questions).
- [ ] Confirm current data sources:
  - Practice modes load JSON from `public/database/*/index.json`.
  - Notes loads Firestore or Excel (`database/Take%20Notes/RL/RL.xlsx`).
- [ ] Decide storage model for Notes difficulty (`level`) before coding.

## 2. Implementation Steps

### Step 1: Difficulty data for Fill (Extended)

- [ ] **Action**: Add `level: 1|2|3` to all items in `public/database/extended/index.json` (bulk update).
- [ ] **Files**: `public/database/extended/index.json` (+ any helper script under `scripts/`).
- [ ] **Verification**: Load the app and confirm extended items include `level` (no runtime errors; future filter/suggester can read it).

### Step 2: Difficulty data for Notes

- [ ] **Action**: Choose one:
  - A) Add `level` to Notes Firestore docs and Excel source; update loader to read it, or
  - B) Create a dedicated `public/database/notes/index.json` and update Notes mode to use it.
- [ ] **Files**: `public/take-notes-mode.js` (+ data source file(s)).
- [ ] **Verification**: Notes mode loads entries and exposes `level` per entry (log + UI sanity).

### Step 3: Suggestion engine module

- [ ] **Action**: Implement a shared `PracticeSuggestionEngine` that:
  - maps CEFR 1–6 → question level 1–3
  - builds token sets + inverted index per mode
  - selects candidates by difficulty, then overlap, then fallback
  - maintains per-mode state: history stack + recent window
- [ ] **Files**: new module under `public/js/` (exact path TBD), minimal glue in `public/script.js`.
- [ ] **Verification**: Add fast unit tests for tokenization + overlap selection + fallbacks (Node-run test file under `tests/` or `scripts/`).

### Step 4: UI toggle + persistence

- [ ] **Action**: Add “Manual / AI Suggested” control in each mode’s question selector header and persist selection per user.
- [ ] **Files**: `public/index.html`, `public/script.js`, `public/take-notes-mode.js`, `public/style.css` (if needed).
- [ ] **Verification**: Reload page and confirm the toggle persists (guest and logged-in).

### Step 5: Hook navigation to suggestions

- [ ] **Action**: When AI-Suggested is enabled, make Next/Back use suggestion history rather than the dropdown order.
  - Type/Speak/Extended: integrate with existing `navigateQuestion()` flow.
  - Notes: integrate with `goToNext()/goToPrevious()`.
- [ ] **Files**: `public/script.js`, `public/take-notes-mode.js`.
- [ ] **Verification**: Manual QA:
  - toggling modes doesn’t break manual selection
  - Next advances via suggestions; Back returns to the prior suggestion
  - no infinite loops; recent-window prevents immediate repeats

## 3. Review

- [ ] Self-review vs spec + Taste invariants.
- [ ] Ensure no unused globals / debug logs left behind.
- [ ] Add/update docs if the data pipeline for `level` changed (where to edit difficulty going forward).
