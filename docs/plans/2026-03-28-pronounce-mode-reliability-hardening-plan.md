# Pronounce Mode Reliability Hardening Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load `executing-plans` to implement this plan task-by-task.

**Goal:** Fix Pronounce mode's recorder fallback bug, false-positive local scoring, inconsistent stress math, and misleading stress labeling without changing the mode's layout, styling, or visual structure.

**Architecture:** Split the Pronounce controller from the bootstrap entrypoint, introduce a single-stop audio capture contract, and route all analysis through one pure orchestration module that tries Praat first and falls back to local JS using the same recorded blob. Keep the current charts and result containers, but harden local rateability checks, unify stress heuristics in shared utilities, and add both pure logic tests and a browser regression harness for the controller path.

**Tech Stack:** Vanilla JS ES modules under `public/`, existing Express static server, browser APIs (`MediaRecorder`, `AudioContext`), Node `.mjs` tests, Playwright browser regression tests, existing repo lint/test scripts.

**Spec Reference:** `docs/specs/features/pronounce-mode.md`

---

## Path Convention

- Pronounce mode runtime code stays under `public/pronunciation-analyzer/`.
- Pure logic tests for Pronounce mode live under `tests/pronunciation-analyzer/`.
- Browser regressions for Pronounce mode live under `tests/browser/`.
- This hardening pass must not change Pronounce mode CSS, layout, or DOM structure in `public/index.html`; copy changes inside existing rendered containers are allowed.

## Constraints and Defaults

- Do not add Azure or any new speech-scoring dependency.
- Do not redesign the UI. Layout, spacing, colors, charts, and section ordering stay as-is.
- Keep the existing theoretical native-pattern fallback in `public/pronunciation-analyzer/word-reference-service.js`; this plan only makes its downstream scoring and labeling consistent.
- Use no new runtime dependencies. Reuse the current Node test runner and Playwright setup.

## Important Interface Changes

- Create `public/pronunciation-analyzer/app.js` and move the `PronunciationApp` class there so tests can import the controller directly.
- Keep `public/pronunciation-analyzer/main.js` as a thin bootstrap module only.
- Add `AudioCapture.stopCapture(): Promise<{ blob: Blob } | null>` in `public/pronunciation-analyzer/audio-capture.js` as the only stop API used by Pronounce mode.
- Add `AudioCapture.blobToAudioBuffer(blob): Promise<AudioBuffer>` in `public/pronunciation-analyzer/audio-capture.js`.
- Keep `stop()` and `stopAsBlob()` only as compatibility wrappers over `stopCapture()`; Pronounce mode itself must not call them directly anymore.
- Create `public/pronunciation-analyzer/analysis-pipeline.js` exporting a pure function:

```js
export async function analyzeRecordedAttempt({
  audioBlob,
  expectedSyllables,
  preferPraat,
  praatAnalyze,
  decodeBlob,
  pitchAnalyze,
  detectSyllables
}) {
  // returns:
  // {
  //   engine: 'praat' | 'local',
  //   usedPraatFallback: boolean,
  //   audioBuffer: AudioBuffer | null,
  //   analysis: object | null,
  //   analysisData: object | null,
  //   syllables: Array,
  //   noiseCount: number,
  //   quality: { rateable: boolean, reason: string | null, metrics: object }
  // }
}
```

- Extend `SyllableDetector.detect()` to always return:

```js
{
  syllables: Array,
  noiseCount: number,
  quality: {
    rateable: boolean,
    reason: 'no_speech' | 'too_short' | 'low_energy' | 'low_voicing' | null,
    metrics: {
      peakEnergy: number,
      activeSpeechDurationMs: number,
      voicedFrameRatio: number,
      activeFrameCount: number
    }
  }
}
```

- Make `compareWithNative()` return UI-facing stress metadata with 1-based indexing only:

```js
{
  nativeStressedSyllable: 1,
  userStressedSyllable: 2,
  syllables: [
    {
      syllable: 1,
      isTargetStressed: true,
      isUserStressed: false
    }
  ]
}
```

- Add package scripts in `package.json`:

```json
"test:pronounce:logic": "node --no-warnings tests/pronunciation-analyzer/analysis-pipeline.test.mjs && node --no-warnings tests/pronunciation-analyzer/syllable-detector.test.mjs && node --no-warnings tests/pronunciation-analyzer/stress-utils.test.mjs",
"test:pronounce:browser": "node tests/browser/pronounce-mode-browser-check.js",
"verify:pronounce": "npm run test:pronounce:logic && npm run test:pronounce:browser"
```

## Fixed Decisions From Plan Review

- The canonical recorder-stop contract is `AudioCapture.stopCapture()`. Pronounce mode must stop exactly once through that method and must never recursively call `stopRecording()`.
- The canonical learner-stress heuristic is the shared weighted stress utility with a final-syllable duration penalty of `0.85` when `syllables.length > 1`.
- UI-facing stress indices are always 1-based. Internal utility indices may remain 0-based.
- Browser regressions cover the controller/orchestration path. Pure Node tests cover only pure logic modules.

## Task 1: Extract a Testable Controller and Single-Stop Analysis Pipeline

**Files:**
- Create: `public/pronunciation-analyzer/app.js`
- Create: `public/pronunciation-analyzer/analysis-pipeline.js`
- Modify: `public/pronunciation-analyzer/main.js`
- Modify: `public/pronunciation-analyzer/audio-capture.js`
- Test: `tests/pronunciation-analyzer/analysis-pipeline.test.mjs`

**Step 1: Write the failing pipeline tests**

Create `tests/pronunciation-analyzer/analysis-pipeline.test.mjs` covering:
- Praat success returns `engine: 'praat'` and never calls `decodeBlob`
- Praat failure falls back to local analysis using the exact same `audioBlob` object
- local-only mode returns `engine: 'local'` and `usedPraatFallback: false`

Each test should use injected stubs only; do not import DOM code.

**Step 2: Run the pipeline test to verify failure**

Run:

```bash
node --no-warnings tests/pronunciation-analyzer/analysis-pipeline.test.mjs
```

Expected:
- exit code `1`
- failure about missing `analysis-pipeline.js` or missing exported API

**Step 3: Add the single-stop capture contract**

Modify `public/pronunciation-analyzer/audio-capture.js` so:
- `stopCapture()` is the only method that directly stops `MediaRecorder`
- repeated calls while stop is already in flight return the same pending promise
- `stopCapture()` clears recorder state and stops tracks once
- `blobToAudioBuffer(blob)` performs decode only after capture is complete
- `stop()` becomes `stopCapture()` plus `blobToAudioBuffer()`
- `stopAsBlob()` becomes `stopCapture()` plus `capture.blob`

Do not remove the wrapper methods in this pass; only stop using them from Pronounce mode.

**Step 4: Split bootstrap from controller and add the pure analysis orchestrator**

Create `public/pronunciation-analyzer/app.js` and move the `PronunciationApp` class there.

Create `public/pronunciation-analyzer/analysis-pipeline.js` and implement `analyzeRecordedAttempt()` as a pure module with no DOM access and no direct imports from browser-only libraries.

Refactor `public/pronunciation-analyzer/main.js` into a thin bootstrap:

```js
import { PronunciationApp } from './app.js';

export function bootPronunciationApp() {
  if (!document.getElementById('pronunciation-analyzer-container')) return null;
  return new PronunciationApp();
}

document.addEventListener('DOMContentLoaded', bootPronunciationApp);
```

`PronunciationApp.stopRecording()` in `app.js` must call `stopCapture()` once, pass the returned blob into `analyzeRecordedAttempt()`, and never re-enter `stopRecording()` on fallback.

**Step 5: Re-run the pipeline test**

Run:

```bash
node --no-warnings tests/pronunciation-analyzer/analysis-pipeline.test.mjs
```

Expected:
- exit code `0`
- test output confirms Praat success and fallback behavior

**Step 6: Commit**

```bash
git add public/pronunciation-analyzer/app.js public/pronunciation-analyzer/analysis-pipeline.js public/pronunciation-analyzer/main.js public/pronunciation-analyzer/audio-capture.js tests/pronunciation-analyzer/analysis-pipeline.test.mjs
git commit -m "refactor: add pronounce analysis pipeline and single-stop capture"
```

## Task 2: Add Explicit Rateability Gates Before Any Guided Segmentation

**Files:**
- Modify: `public/pronunciation-analyzer/syllable-detector.js`
- Test: `tests/pronunciation-analyzer/syllable-detector.test.mjs`

**Step 1: Write the failing detector tests**

Create `tests/pronunciation-analyzer/syllable-detector.test.mjs` with synthetic `energies`, `pitches`, and `times` arrays covering:
- empty or all-zero audio returns `quality.reason = 'no_speech'`
- peak energy below floor returns `quality.reason = 'low_energy'`
- active speech shorter than threshold returns `quality.reason = 'too_short'`
- noisy/unvoiced active frames return `quality.reason = 'low_voicing'`
- valid rateable audio with `expectedCount = 2` still returns exactly two guided syllables

**Step 2: Run the detector test to verify failure**

Run:

```bash
node --no-warnings tests/pronunciation-analyzer/syllable-detector.test.mjs
```

Expected:
- exit code `1`
- failures because `quality` metadata and early aborts do not exist yet

**Step 3: Implement `assessRateability()` with exact thresholds**

Modify `public/pronunciation-analyzer/syllable-detector.js` to add a dedicated pre-segmentation gate with these constants:

```js
const QUALITY_GATES = {
  absolutePeakEnergyFloor: 0.012,
  relativeSpeechThresholdRatio: 0.18,
  absoluteSpeechThresholdFloor: 0.006,
  minActiveSpeechDurationMs: 180,
  minVoicedFrameRatio: 0.22,
  minVoicedPitchHz: 70,
  maxVoicedPitchHz: 400
};
```

Implement the gate in this exact order:
1. if `energies.length === 0` or all energies are `0`, return `no_speech`
2. smooth energy with the existing smoothing helper before gating
3. compute `peakEnergy`; if `< 0.012`, return `low_energy`
4. compute `activeThreshold = max(peakEnergy * 0.18, 0.006)`
5. compute active frames above `activeThreshold`; if none, return `no_speech`
6. compute `activeSpeechDurationMs` from the first and last active frame using the observed `times` spacing; if `< 180`, return `too_short`
7. compute `voicedFrameRatio` across active frames using pitch between `70` and `400` Hz; if `< 0.22`, return `low_voicing`
8. only if all gates pass, continue into blind or guided segmentation

The gate must run before both `detectWithExpectedCount()` and peak-based detection so silence/noise cannot be force-segmented into fake syllables.

**Step 4: Return consistent quality metadata**

When audio is not rateable, return:

```js
{
  syllables: [],
  noiseCount: 0,
  quality: {
    rateable: false,
    reason: '...',
    metrics: {
      peakEnergy,
      activeSpeechDurationMs,
      voicedFrameRatio,
      activeFrameCount
    }
  }
}
```

When audio is rateable, return the same `quality` object with `rateable: true` and `reason: null`.

**Step 5: Re-run the detector tests**

Run:

```bash
node --no-warnings tests/pronunciation-analyzer/syllable-detector.test.mjs
```

Expected:
- exit code `0`
- all four unrateable reasons and the valid guided segmentation case pass

**Step 6: Commit**

```bash
git add public/pronunciation-analyzer/syllable-detector.js tests/pronunciation-analyzer/syllable-detector.test.mjs
git commit -m "feat: add pronounce rateability gates"
```

## Task 3: Unify Stress Math and Comparison Semantics on One Canonical Model

**Files:**
- Modify: `public/pronunciation-analyzer/stress-utils.js`
- Modify: `public/pronunciation-analyzer/word-reference-service.js`
- Test: `tests/pronunciation-analyzer/stress-utils.test.mjs`

**Step 1: Write the failing stress tests**

Create `tests/pronunciation-analyzer/stress-utils.test.mjs` covering:
- `calculateStressScore()` uses `pitch: 0.50`, `duration: 0.30`, `intensity: 0.20`
- learner stress detection applies a final-syllable duration penalty of `0.85`
- `compareWithNative()` returns 1-based `nativeStressedSyllable` and `userStressedSyllable`
- per-syllable comparison objects expose `isTargetStressed` and `isUserStressed`
- pattern correlation uses `STRESS_WEIGHTS`, not a separate hard-coded set

**Step 2: Run the stress test to verify failure**

Run:

```bash
node --no-warnings tests/pronunciation-analyzer/stress-utils.test.mjs
```

Expected:
- exit code `1`
- failures around index convention, duplicated heuristics, or mismatched weights

**Step 3: Make the shared utility canonical**

Modify `public/pronunciation-analyzer/stress-utils.js` so:
- comments match the actual weighting model
- `findStressedSyllable()` accepts:

```js
findStressedSyllable(syllables, {
  finalSyllableDurationPenalty = 0.85
} = {})
```

- the helper returns a 0-based index internally
- final-syllable penalty is applied only when `syllables.length > 1`

**Step 4: Remove ambiguous stress fields from comparison data**

Modify `public/pronunciation-analyzer/word-reference-service.js` so:
- `compareWithNative()` computes `userStressedIndex` with the shared utility
- the returned comparison object exposes:
  - `nativeStressedSyllable` as 1-based
  - `userStressedSyllable` as 1-based
  - `syllables[].isTargetStressed`
  - `syllables[].isUserStressed`
- the old ambiguous `syllables[].isStressed` field is removed from the UI-facing comparison object
- `compareStressPattern()` uses `STRESS_WEIGHTS` instead of hard-coded `0.45/0.35/0.20`

**Step 5: Re-run the stress tests**

Run:

```bash
node --no-warnings tests/pronunciation-analyzer/stress-utils.test.mjs
```

Expected:
- exit code `0`
- the canonical learner-stress heuristic, index convention, and weight reuse are verified

**Step 6: Commit**

```bash
git add public/pronunciation-analyzer/stress-utils.js public/pronunciation-analyzer/word-reference-service.js tests/pronunciation-analyzer/stress-utils.test.mjs
git commit -m "fix: unify pronounce stress scoring semantics"
```

## Task 4: Refactor the Controller and Summary Copy Without Changing UI Design

**Files:**
- Modify: `public/pronunciation-analyzer/app.js`
- Modify: `public/pronunciation-analyzer/ai-summary-service.js`
- Test: `tests/browser/pronounce-mode-browser-check.js`

**Step 1: Write the failing browser regression**

Create `tests/browser/pronounce-mode-browser-check.js` using the existing Playwright pattern with a custom harness route that:
- serves a minimal Pronounce DOM containing every ID used by `app.js` and `stress-visualizer.js`
- stubs `window.Chart`, `window.Logger`, and `window.SyllableVerifier`
- intercepts constructor-time backend requests for health, dictionary lookup, and native-analysis lookup so the harness never hits the real cloud backend
- imports `PronunciationApp` from `public/pronunciation-analyzer/app.js`
- assigns the instance to `window.__pronounceApp`

After construction, each browser scenario must stub collaborators directly on `window.__pronounceApp` instead of using a real microphone:
- `audioCapture.stopCapture`
- `audioCapture.blobToAudioBuffer`
- `praatAPI.analyze`
- `pitchAnalyzer.analyze`
- `syllableDetector.detect`
- `wordRefService.compareWithNative`
- visualizer draw methods as spies or no-ops

Add three regression scenarios:
- Praat analyze failure falls back to local analysis and `stopCapture()` is called exactly once
- unrateable local audio shows an existing summary-area error, skips chart rendering, and re-enables the record button
- comparison rendering shows `Prosody Match Score`, marks the stress badge from `isUserStressed`, and includes `Target stress: syllable X` plus `Your strongest stress cue: syllable Y`

**Step 2: Run the browser regression to verify failure**

Run:

```bash
node tests/browser/pronounce-mode-browser-check.js
```

Expected:
- exit code `1`
- failure around missing exports, duplicate stop behavior, or outdated summary text

**Step 3: Refactor `PronunciationApp.stopRecording()` around the pipeline result**

Modify `public/pronunciation-analyzer/app.js` so:
- stop state is cleaned up in one place, not repeated across Praat/local branches
- `stopRecording()` obtains `{ blob }` from `stopCapture()` exactly once
- the method passes that blob into `analyzeRecordedAttempt()`
- Praat fallback is handled by pipeline return data, not recursive `await this.stopRecording()`
- the controller stores whether a Praat fallback occurred only for logging/status text; it does not alter the stop contract

**Step 4: Render unrateable outcomes through existing containers only**

Add a dedicated helper in `app.js`, for example `generateUnrateableSummary(reason, quality)`, that uses the current `resultsSummary` area and exact reason mapping:
- `no_speech`: "No speech detected. Speak once after pressing Record and reduce background noise."
- `too_short`: "Recording too short to analyze reliably. Say the full word once at a normal pace."
- `low_energy`: "Speech was too quiet to analyze reliably. Speak a little louder and closer to the microphone."
- `low_voicing`: "The recording did not contain enough clear vowel sound to locate syllables. Hold each vowel a bit more clearly."

When `quality.rateable === false`:
- do not call `drawPitchContour()`
- do not call `drawDurationChart()`
- do not call `compareWithNative()`
- clear prior charts with the existing visualizer API
- re-enable the record button and return to idle status

**Step 5: Fix wording and stress labeling semantics**

Modify the rendered copy in `app.js` and `public/pronunciation-analyzer/ai-summary-service.js` so:
- `Overall Match Score` becomes `Prosody Match Score`
- the fallback summary says `Detected strongest stress cue` instead of implying full pronunciation accuracy
- the syllable table stress badge keys off `comparison.syllables[i].isUserStressed`
- the old `comparison.stressScore` branch is removed and any stress-strength threshold uses `comparison.patternCorrelation`
- the detailed stress row includes:
  - `Target stress: syllable ${comparison.nativeStressedSyllable}`
  - `Your strongest stress cue: syllable ${comparison.userStressedSyllable}`
- AI summary prompt/template wording talks about melody, rhythm, and emphasis matching rather than overall pronunciation correctness

These are copy-only changes inside existing rendered blocks. Do not add new sections or change layout.

**Step 6: Re-run the browser regression**

Run:

```bash
node tests/browser/pronounce-mode-browser-check.js
```

Expected:
- exit code `0`
- console prints `pronounce mode browser check passed`

**Step 7: Commit**

```bash
git add public/pronunciation-analyzer/app.js public/pronunciation-analyzer/ai-summary-service.js tests/browser/pronounce-mode-browser-check.js
git commit -m "fix: harden pronounce controller and summaries"
```

## Task 5: Wire Scripts, Update the Feature Spec, and Run Full Verification

**Files:**
- Modify: `package.json`
- Modify: `docs/specs/features/pronounce-mode.md`
- Verify: `tests/pronunciation-analyzer/analysis-pipeline.test.mjs`
- Verify: `tests/pronunciation-analyzer/syllable-detector.test.mjs`
- Verify: `tests/pronunciation-analyzer/stress-utils.test.mjs`
- Verify: `tests/browser/pronounce-mode-browser-check.js`

**Step 1: Add Pronounce verification scripts**

Modify `package.json` and add:

```json
"test:pronounce:logic": "node --no-warnings tests/pronunciation-analyzer/analysis-pipeline.test.mjs && node --no-warnings tests/pronunciation-analyzer/syllable-detector.test.mjs && node --no-warnings tests/pronunciation-analyzer/stress-utils.test.mjs",
"test:pronounce:browser": "node tests/browser/pronounce-mode-browser-check.js",
"verify:pronounce": "npm run test:pronounce:logic && npm run test:pronounce:browser"
```

Do not add `"type": "module"` to `package.json`; the repo already runs `.mjs` tests successfully and this plan should avoid package-wide module-mode churn.

**Step 2: Update the Pronounce feature spec**

Modify `docs/specs/features/pronounce-mode.md` to document:
- `Prosody Match Score` as the headline metric
- the single-stop fallback contract
- the four unrateable reasons
- the rule that local guided segmentation cannot run on unrateable audio
- the distinction between target stress and learner strongest stress cue

**Step 3: Run the full verification set**

Run:

```bash
npm run verify:pronounce
npx eslint "public/pronunciation-analyzer/*.js" "tests/browser/pronounce-mode-browser-check.js" --quiet
```

Expected:
- `npm run verify:pronounce` exits `0`
- browser test prints `pronounce mode browser check passed`
- ESLint exits `0`

**Step 4: Commit**

```bash
git add package.json docs/specs/features/pronounce-mode.md
git commit -m "docs: add pronounce hardening verification workflow"
```

---

## Test Cases and Scenarios

The implementation is not complete until these cases are explicitly covered by tests:

### Recorder and fallback behavior

- Praat success path stops capture once and never decodes locally
- Praat failure stops capture once, decodes the same blob locally, and still renders results
- no recursive `stopRecording()` calls after an analysis error
- record button returns to usable state on both success and failure

### Local rateability

- silence-only audio returns `no_speech`
- quiet audio below peak floor returns `low_energy`
- clipped utterance shorter than `180ms` of active speech returns `too_short`
- noisy or mostly unvoiced speech returns `low_voicing`
- valid audio with an expected syllable count still uses guided segmentation

### Stress semantics

- fallback summary and native comparison both use the same weighted stress helper
- final-syllable duration penalty prevents false last-syllable wins
- table stress badge follows learner stress, not target stress
- detailed row distinguishes target stress from learner strongest stress cue

### UI semantics without redesign

- comparison headline reads `Prosody Match Score`
- unrateable results use the existing summary container only
- no fake charts appear for unrateable local audio
- AI teacher note uses prosody wording rather than general pronunciation-accuracy wording

## Acceptance Criteria

- Pronounce mode no longer stops the recorder twice during Praat fallback.
- Silent or unusable local recordings cannot produce fabricated syllable charts or scores.
- All stress/prosody calculations use one shared weighting model and one learner-stress heuristic.
- UI text correctly distinguishes target stress from learner stress without changing layout.
- `npm run verify:pronounce` passes.

## Assumptions and Defaults Chosen

- UI-facing stress numbers are 1-based; shared utility internals remain 0-based.
- The final-syllable duration penalty is fixed at `0.85` for this hardening pass.
- Copy changes inside the current result blocks are allowed; structural HTML/CSS changes are not.
- Theoretical native patterns remain as the non-audio fallback for reference data; this pass does not replace that system.
