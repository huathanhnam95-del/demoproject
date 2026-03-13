Browser checks in this folder use Playwright directly. `reading-journey-quiz-browser-check.js`
starts its own local harness server so it can mount the Reading Journey frontend in isolation and
stub only the APIs needed for the assessment flow.
