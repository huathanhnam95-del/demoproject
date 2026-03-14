# Reading Journey Assessment QA

## Scope

Use this checklist when validating the hidden Reading Journey post-story assessment prototype on the local `server.js` path.

## Environment

- Start the local server with Reading Journey enabled:
  - `node server.js`
  - or `node scripts/smoke-reading-journey.js --start-server --port 8787`
- Open the hidden route:
  - `http://localhost:8443/readingjourney`
  - or the port used by the smoke script

## Desktop Flow

- Start a Reading Journey story and complete all five interactive beats plus the ending beat.
- Confirm the completion screen shows:
  - `Check Understanding`
  - `Skip for now`
  - `Copy Story`
  - `New Journey`
- Launch the quiz and confirm the header shows:
  - story title context
  - CEFR level
  - `Question X of 5`
- Complete the full quiz and confirm the result view shows:
  - score percent
  - strengths
  - review areas
  - next-step recommendation
  - retry CTA
  - continue-reading CTA

## Mobile Flow

- Repeat the full story-to-quiz flow at a narrow viewport around `390x844`.
- Confirm the quiz footer actions remain reachable without layout breakage.
- Confirm passage tokens remain tappable and do not overlap.
- Confirm result cards stack cleanly and summary cards collapse to one column.

## Keyboard-Only Passage Selection

- Navigate the quiz using only keyboard input.
- On `click_word_meaning`, confirm each word token can receive focus and be activated with keyboard.
- On `tap_evidence`, confirm the paragraph buttons can receive focus and be activated with keyboard.
- Confirm visible focus styles are present for:
  - word tokens
  - evidence paragraphs
  - MCQ options
  - sequence controls
  - footer buttons
- Confirm the live status message updates after correct and incorrect interactions.

## Retry Hint Behavior

- On a `click_word_meaning` item, click or activate the wrong word first.
- Confirm:
  - the wrong token shows an error state
  - the correct paragraph receives the hint highlight
  - the status message tells the learner to try again in the highlighted paragraph
- On the second incorrect try, confirm:
  - the correct answer is revealed
  - the explanation appears
- Repeat the same check for `tap_evidence`.

## Review Queue Persistence

- Finish a quiz with at least one wrong answer.
- Confirm the result screen says missed items were saved for later review.
- Refresh the page.
- In DevTools or console, inspect `localStorage["rj_assessment_review_v1"]`.
- Confirm:
  - only missed questions were queued
  - queue items include `reviewId`, `questionType`, `prompt`, `level`, `storyTitle`, and `reviewState`
  - the first interval is `1` day
- Repeat with another wrong-answer run and confirm duplicates are not added for the same `reviewId`.

## Disabled Feature Behavior

- Start the local server with Reading Journey disabled:
  - `READING_JOURNEY_ENABLED=false node server.js`
- Confirm:
  - `/api/reading-journey/health` returns `404`
  - `/api/reading-journey/setup` returns `404`
  - `/api/reading-journey/quiz` returns `404`
- Confirm the hidden route does not expose a working story or assessment flow when the backend is off.

## Smoke Command

- Run:
  - `node scripts/smoke-reading-journey.js --start-server --port 8787`
- Expected result:
  - `Reading Journey quiz mix: ...`
  - `Reading Journey smoke passed.`
