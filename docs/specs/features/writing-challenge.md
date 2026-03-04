# Writing Challenge Spec

**Status**: Implemented
**Owner**: Admin

## 1. Overview
>
> The Writing Challenge asks the user to write a sentence using a **target word** in a **clear, contextual scenario**, with scaffolding from dictionary examples/collocations and optional AI feedback.

## 2. Goals (The "Why")

- Convert passive vocabulary knowledge into active usage.
- Teach "natural usage" via collocations and examples.
- Provide grammar + usage feedback without blocking the loop.

## 3. Requirements (The "What")

### Functional

- Triggered from SRS review as a deeper check for a target lemma.
- Shows a prompt + optional starter, with dictionary scaffolding:
  - definition
  - example sentence(s)
  - collocations ("common phrases")
- Supports multi-option collocation selection when multiple strong collocations exist.
- Saves user drafts locally so writing is never lost on close/reload.
- Provides AI-assisted feedback options:
  - Fast in-app assessment (streamed) for quick encouragement.
  - "AI Check" button for grammar/style corrections (with daily limits and fallback).
- Submitting writing awards rewards and can influence SRS scheduling.

### Non-Functional

- Prompt generation should be deterministic for a given input (word + level) unless explicitly randomized.
- The UX must remain usable offline (prompt falls back to templates; AI checks disabled).
- AI feedback is optional: submit flow and rewards must still complete when AI endpoints are unavailable.
- Draft persistence must survive modal close/reopen and page refresh so user writing is not lost.

## 4. Writing Prompt Generation (Current Behavior)

### 4.1 Prompt generator (hybrid)

- Entry point: `generateWritingPrompt(wordObj, userLevel)` in `public/srs-review.js`.
- Phases (in order):
  1) **Collocation selection prompt** (preferred)
     - If a *multi-option* prompt is returned, the generator returns immediately.
     - This creates a "choose a phrase to write about" step.
  2) **AI scenario prompt** (fallback)
     - When online, `generateAiPrompt` calls `POST /api/ai-proxy` to generate a short scenario.
  3) **Template/definition fallback**
     - If AI is unavailable, prompts fall back to collocation templates or definition-based prompts.

### 4.2 Prompt caching (cross-user)

- `POST /api/ai-proxy` caches AI responses in Firestore `ai_cache` with a **7-day TTL**.
- The cache key is derived from `prompt + model + max_tokens` (hash), and is **not user-scoped**.
- Result: if the **same prompt string** is generated for the same target word, later users can receive a cached scenario for up to 7 days.
- Offline/no-network path: `generateAiPrompt` returns `null` and flow falls back to template/definition prompt generation in `public/srs-review.js`.

## 5. AI Feedback (Current Behavior)

### 5.1 Fast assessment (streamed)

- `public/srs-review.js` supports `POST /api/ai-feedback-stream` (SSE) to generate HTML feedback based on:
  - target word
  - user sentence
  - a rubric that weights target vocabulary usage and grammar.

### 5.2 "AI Check" button (Gemini + LanguageTool fallback)

- UI module: `public/js/writing-challenge.js` (adds an "AI Check" button).
- Primary check: Firebase callable function `assessWriting` in `functions/src/assessWriting.js`
  - Model: `gemini-1.5-flash`
  - Output: JSON `{ score, feedback, corrections[] }`
  - Limit: 20 checks/day/user (returns `{ limited: true, fallback: true }` after limit)
  - Context currently includes the **target word** but **does not include the writing prompt/scenario**.
- Fallback check: LanguageTool public API (`https://api.languagetool.org/v2/check`)
- Submit path: `handleSubmit` in `public/js/writing-challenge.js` proceeds even if AI assessment is skipped/failed.

## 6. Rewards & SRS Hooks

- Writing Challenge submits a `writingChallenge` attempt to the dual-track scoring system.
- AI score can optionally tighten/boost SRS intervals (`applyAIScoreToSRS` in `public/srs-review.js`).
- Draft contract:
  - Save: `public/srs-review.js` -> `saveDraft` -> `localStorage['srs_draft_<word>']`
  - Restore: `loadDraft` on challenge open
  - Cleanup: stale draft cleanup routine in `public/srs-review.js`

## 7. Known Gaps (Documented)

- If the prompt generator returns a **multi-option** selection prompt, it can delay/avoid scenario generation; many "final prompts" are not fully contextual until after the user selects an option.
- Gemini "AI Check" does not currently verify coherence with the specific scenario prompt because that scenario is not passed into the callable function.

## 8. Verification

- Manual:
  - Trigger Writing Challenge for a word with collocations -> confirm multi-option flow.
  - Trigger Writing Challenge for a word without collocations -> confirm AI scenario fallback when online.
  - Press "AI Check" repeatedly -> confirm daily limit and LanguageTool fallback behavior.
  - Disable network -> open challenge -> confirm template/definition fallback prompt and successful submit path.
  - Reload during draft writing -> reopen challenge -> confirm draft restoration from local storage.
  - Force AI endpoint failure -> verify submit still succeeds and feedback path degrades without blocking completion.
