# Reading Journey Assessment Spec

**Status:** Planned prototype extension
**Owner:** Admin
**Depends on:** Hidden Reading Journey route in `src/routes/reading-journey.js`

## 1. Overview

Reading Journey Assessment adds a post-story learning check after a user finishes a Reading Journey story. The assessment is formative, not exam-secure. Its job is to improve retention, vary retrieval demands, and feed a lightweight spaced-review queue for missed items.

## 2. Goals

- Break the current single completion screen into a completion summary plus optional assessment flow.
- Test both comprehension and vocabulary without relying on MCQ-only mechanics.
- Keep the assessment aligned to the story's CEFR level (`A2`, `B1`, `B2`, `C1`).
- Give immediate, explanatory feedback with one scaffolded retry for locate-the-text questions.
- Save only missed items into a local spaced-review queue on a `1 day -> 3 day -> 7 day` cadence.

## 3. MVP Question Types

- `mcq_main_idea`
  - Checks main idea, sequence, cause/effect, or simple inference.
- `click_word_meaning`
  - Prompt: "Click the word that means..."
  - If wrong on first try, highlight the paragraph that contains the correct word and allow one retry.
- `tap_evidence`
  - Prompt: "Tap the sentence/paragraph that proves..."
  - Keeps the learner anchored in the text.
- `sequence_events`
  - Learner orders 3-4 events from the story.
- `short_answer`
  - One short typed response for gist, character goal, or reflection.

## 4. Best-Practice Product Rules

- Use exactly 5 scored questions per quiz.
- Every quiz must contain at least 1 vocabulary item and at least 1 comprehension item.
- Every quiz must contain at least 1 interactive text-location item.
- No speed-based scoring.
- No grid word-search interactions.
- No more than 1 short-answer item at `A2`.
- Keep all answers defensible from the story text.

## 5. CEFR Guidance

### A2

- Use concrete vocabulary and direct detail questions.
- Keep prompts short.
- Prefer paragraph-level evidence over sentence-level ambiguity.

### B1

- Allow light inference and paraphrase recognition.
- Keep vocabulary rooted in context clues from the story.

### B2

- Allow stronger inference and phrase-level vocabulary questions.
- Sequence questions may include turning-point logic, not just literal order.

### C1

- Allow nuance, tone, and stronger inference.
- Still require one clearly defensible answer in the text.

## 6. Feedback Rules

- Correct answer:
  - show success state
  - show the answer and a short explanation
- Incorrect answer on `click_word_meaning` or `tap_evidence`:
  - show soft error state
  - provide one scaffolded retry
  - for click-word, highlight the paragraph containing the target word
- Incorrect answer after retry:
  - reveal the answer and explanation

## 7. Accessibility Rules

- All clickable words, paragraphs, and sequence controls must be keyboard-operable.
- All correctness and hint messages must be announced through an `aria-live` region.
- Do not rely on color alone to communicate correctness.
- Keep visible focus states on all interactive tokens.

## 8. Storage Rules

- Use `localStorage` first for the review queue.
- Store only missed items.
- Storage key: `rj_assessment_review_v1`
- Payload must be versioned for future migration.
- Invalid or stale queue entries must fail soft and not break the reading flow.

## 9. Backend Contract

`POST /api/reading-journey/quiz`

Required input:
- `outlineId`
- `path`
- `level`

Response:
- `quizId`
- `outlineId`
- `level`
- `storySnapshot`
- `questions`
- `recommendedReviewCount`

The backend reconstructs the story from cached beats. The browser does not send the full transcript.

## 10. Non-Goals

- Secure exam delivery
- Teacher analytics
- Firebase persistence for attempts in MVP
- `functions/src/` parity before local validation

## 11. Promotion Gate

This feature stays formative and is not exam-secure in the hidden prototype. Client-side grading is acceptable at this stage because the goal is fast explanatory feedback, not secure scoring.

Do not mirror this assessment flow into `functions/src/` or expose it beyond the hidden route until all of the following are true:

- browser test passes for the post-story quiz flow
- smoke test passes for setup, ending beat, and `POST /api/reading-journey/quiz`
- no critical accessibility blockers remain for keyboard-only text selection and live-region feedback
- the local review queue survives reload and preserves missed-item scheduling
- generated decks remain valid across `A2`, `B1`, `B2`, and `C1`

If any of those checks fail, keep the feature behind the current hidden-route prototype gate.
