# Manual Recommendation Spec

**Status**: Approved
**Owner**: Admin

## 1. Overview

Add a `Recommended` action to question selection so users can either choose any visible question manually or jump to the best next match. This applies to:

- Type
- Speak
- Fill (`extended`)
- Notes

The recommendation engine is deterministic, local-only, and balances difficulty fit with vocabulary continuity.

## 2. Product Decisions

- Keep current Type/Speak/Fill toggle behavior (`Adaptive` vs `Manual`).
- Do not add a third selection mode.
- In Type/Speak/Fill:
  - show `Recommended` only when in manual mode.
  - keep `Next` and `Back` sequential.
- In Notes:
  - add `Recommended` without introducing a new manual/adaptive toggle.
  - keep `Next` and `Back` sequential.
- Recommendation explanation labels must stay generic.
- Do not explicitly list shared words in the UI.

## 3. Functional Requirements

- Add one `Recommended` button and one summary label per mode.
- Recommend only from currently visible dropdown options.
- Respect existing filters by design (status, length, difficulty, Notes status).
- Keep manual dropdown selection enabled at all times.
- Manual selection sets a new recommendation anchor and does not clear history.

### Ranking Signals

1. Difficulty fit
2. Vocabulary continuity
3. Anti-repetition penalty (recent window)

### Difficulty Mapping

`CEFR 1-2 => level 1`, `CEFR 3-4 => level 2`, `CEFR 5-6 => level 3`

### Mode Text Source

- Type: `correctSentence`
- Speak: `correctSentence`
- Fill (`extended`): `transcript` fallback to `correctSentence`
- Notes: `transcript`

## 4. Engine Contract

```ts
type PracticeMode = 'type' | 'speak' | 'extended' | 'notes';

interface RecommendationResult {
  nextQuestionId: number;
  reasonCode: 'level_and_continuity' | 'difficulty_only' | 'continuity_only' | 'fallback';
  score: number;
}

interface QuestionRecommendationEngine {
  buildIndex(mode: PracticeMode, items: unknown[]): unknown;
  recommendNext(params: {
    mode: PracticeMode;
    currentQuestionId: number;
    currentCefrLevel: number;
    visibleQuestionIds: number[];
    recentQuestionIds: number[];
    index: unknown;
  }): RecommendationResult | null;
}
```

## 5. Non-Functional Requirements

- Local-only computation (no network calls).
- Deterministic output for same input state.
- Fast enough for large Type/Speak pools.
- Missing item level defaults to `1`.
- No adaptive difficulty logic changes.

## 6. Verification

### Automated

- Engine test: `node tests/question-recommendation-engine.test.mjs`
- UI shape test: `node tests/recommendation-ui-shape.test.js`

### Manual

- Type manual recommendation flow
- Speak manual recommendation flow
- Fill manual recommendation flow
- Notes recommendation flow
- Filter-constrained recommendation behavior
- Repeat-avoidance behavior
