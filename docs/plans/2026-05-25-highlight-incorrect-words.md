# Highlight Incorrect Words Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Implement the "Highlight Incorrect Words" (HIW) listening practice mode in PTE Practice, using local Kokoro TTS to generate multi-voice audio, rendering word-click interactive elements, and displaying feedback/scoring.

**Architecture:** 
- An offline generation script `scripts/kokoro/kokoro_batch_hiw.js` reads `HIW.xlsx` Column C, generates Column D (correct transcripts), calls the local Kokoro API to save 3 randomized voice MP3 versions per question, and saves a manifest.
- A lazy-loaded client component `hiw-mode.js` renders the text as interactive span elements, handles yellow highlights on click, plays the correct audio randomized on load, and shows post-submission boxes comparing incorrect vs. correct words with PTE scoring rules (+1 for correct click, -1 for incorrect click, min 0).
- Registered under Listening skills in PTE Practice scope.

**Tech Stack:** JavaScript (Vanilla JS), CSS (Vanilla CSS), exceljs, xlsx.full.min.js, Kokoro TTS Local API, Playwright (for E2E verification).

## Resolved Design Decisions

- **AI Explanation Generation (Column E)**: Create an offline Python script `scripts/generate_hiw_explanations.py` calling local GemmaAI/Ollama `gemma4:latest` to pre-generate premium HTML explanations for all questions, and save them in Column E (`EXPLANATION`) of `HIW.xlsx`.
- **Incorrect Click Penalty**: Clicking a correct word in the text passage will penalize the score by `-1`, with the total question score clamped to a minimum of `0` (Standard PTE scoring).
- **Punctuation Splitting**: The custom tokenizer will split trailing punctuation (commas, periods, etc.) and render them *outside* the clickable `<span>` element (e.g. `<span class="hiw-word">word</span>,`). This matches real PTE exams.
- **Audio Generation Footprint**: Generate 3 randomized voices' audios using the local Kokoro API (`http://localhost:8880/v1/audio/speech`).

---

## Proposed Changes

### Preprocessing & Asset Generation

#### [NEW] [generate_hiw_explanations.py](file:///c:/Cursor%20AI/scripts/generate_hiw_explanations.py)
A Python script calling local GemmaAI (`gemma4:latest`) via Ollama API to pre-generate premium HTML explanations detailing:
1. List of incorrect words with their correct equivalents.
2. Contextual/grammatical reasoning for each correction.
The explanations are saved in Column E (`EXPLANATION`) of `public/database/Highlight Incorrect Words/HIW/HIW.xlsx`.

#### [NEW] [kokoro_batch_hiw.js](file:///c:/Cursor%20AI/scripts/kokoro/kokoro_batch_hiw.js)
A script to read `public/database/Highlight Incorrect Words/HIW/HIW.xlsx`, parse Column C (`ANSWER`), write clean correct transcripts (replacing `__incorrect/correct__` with the correct/spoken word) to Column D (`ANSWER FOR COMPARE OR TRANSCRIPT`), generate 3 random voices' audios using local Kokoro API, save them under `public/database/Highlight Incorrect Words/audio/<id>/`, and generate `manifest.json`.
- Voice Pool: Same as other Kokoro modes (US Female, US Male, UK Male/Female).

---

### Core Frontend Integration

#### [MODIFY] [index.html](file:///c:/Cursor%20AI/public/index.html)
- Add `<link rel="stylesheet" href="hiw-mode.css">` in the head section.
- Add `<button id="tab-hiw" class="tab-btn" type="button">Highlight Incorrect Words</button>` in the hidden tab-headers list.
- Add a dashboard card inside the `.tutorial-grid` panel with `id="mode-btn-hiw"`, `data-practice-skill="listening"`, pointing to `window.switchToMode('hiw')`.
- Add `<div id="mode-hiw" class="mode-panel" style="display: none;">` implementing the UI layout:
  - Header: V7 question picker (previous/next buttons, jump pill, sheet list, and search input).
  - Main container: Split layout with Left panel (audio card, visualizer, timeline progress bar, voice accent selector, and speed controls) and Right panel (interactive passage text wrapper, submit/retry/explanation buttons, result/score banner, and AI explanations panel).

#### [MODIFY] [lazy-loader.js](file:///c:/Cursor%20AI/public/js/lazy-loader.js)
- Implement `ensureHiwModeLoaded()` to load `hiw-mode.css` and `hiw-mode.js` dynamically.
- Register `hiw` in `ensureModeScripts(mode)` and export it in `window.BELLazyLoader`.

#### [MODIFY] [script.js](file:///c:/Cursor%20AI/public/script.js)
- Register `'hiw'` in `PRACTICE_LAUNCHER.skills.listening.modeIds`.
- Add `hiw` config under `PRACTICE_LAUNCHER.modes`:
  ```javascript
  hiw: {
    label: 'Highlight Incorrect Words',
    skill: 'listening',
    hasTutorial: false,
    isLive: true,
    launcherVisible: true
  }
  ```
- Register `hiw` in `PRACTICE_SCOPE_CONFIG[SCOPE_PTE].visibleModes`.
- Register `hiw` in `PRACTICE_SCOPE_CONFIG[SCOPE_PTE].modeOverrides`:
  ```javascript
  hiw: { label: 'Highlight Incorrect Words' }
  ```
- Ensure `'hiw'` is checked in `ensureModeAssets(mode)` and other active-mode validation helper arrays.

---

### HIW Logic & Style Sheets

#### [NEW] [hiw-mode.css](file:///c:/Cursor%20AI/public/hiw-mode.css)
- Layout structure matching the application design system.
- Spans `.hiw-word`: clickable cursor, transitions, yellow highlight on `.is-selected`.
- `.hiw-result-box`: rounded border, soft background:
  - Correct click: solid green border, soft green background.
  - Missed incorrect word: dashed red/orange border, soft red background.
  - Correct word incorrectly clicked: solid red background on `.hiw-word`.
- Red and green colors inside the box (`.hiw-incorrect-word` in red, `.hiw-correct-word` in green).

#### [NEW] [hiw-mode.js](file:///c:/Cursor%20AI/public/hiw-mode.js)
- Parses `HIW.xlsx` directly using `xlsx.full.min.js`.
- Custom tokenizer to parse Column C:
  - Matches `__([^_/]+)\/([^_/]+)__` to split text into plain words, spaces, and incorrect word tokens.
  - Keeps track of incorrect words and their correct equivalents.
- Click handler on each word: toggles index selection and highlights word yellow.
- Audio Player: Plays corresponding correct audio version. Randomizes active voice selection on load.
- Scoring rules: correct selections - incorrect selections, minimum 0.
- Post-submission: Re-renders the text passage wrapping incorrect words in red/green box formats.

---

### Verification and Automated Testing

#### [NEW] [hiw-data-guardrails.test.js](file:///c:/Cursor%20AI/tests/hiw-data-guardrails.test.js)
- Validates that `HIW.xlsx` exists.
- Confirms that Column D is successfully written.
- Validates the matching between manifest audio files and generated files.

#### [NEW] [hiw-mode-browser-check.js](file:///c:/Cursor%20AI/tests/browser/hiw-mode-browser-check.js)
- Automated Playwright E2E browser test:
  - Signs in using test credentials.
  - Opens the HIW practice mode card.
  - Plays the audio, selects a word to highlight it yellow.
  - Submits the answer and validates that the score banner and the highlighted boxes are formatted correctly.

---

## Step-by-Step Execution Plan

### Task 1: Create Preprocessors and Generate Database Explanations/Audio

**Files:**
- Create: `scripts/generate_hiw_explanations.py`
- Create: `scripts/kokoro/kokoro_batch_hiw.js`

**Step 1: Write and run explanation generator script**
Write `scripts/generate_hiw_explanations.py` calling local GemmaAI via Ollama to generate HTML explanations and save them to Column E (`EXPLANATION`) of `HIW.xlsx`.
Run: `python scripts/generate_hiw_explanations.py`
Expected: Column E populated for all questions in `HIW.xlsx`.

**Step 2: Write and run Kokoro TTS preprocessor script**
Write `scripts/kokoro/kokoro_batch_hiw.js` to parse Column C, write clean correct transcripts (spoken words) to Column D (`ANSWER FOR COMPARE OR TRANSCRIPT`), generate 3 random voices using local Kokoro API (`http://localhost:8880/v1/audio/speech`), save them under `public/database/Highlight Incorrect Words/audio/<id>/`, and generate `manifest.json`.
Run: `node scripts/kokoro/kokoro_batch_hiw.js`
Expected: Column D written, audio files generated, `manifest.json` saved.

**Step 3: Commit**
`git add scripts/generate_hiw_explanations.py scripts/kokoro/kokoro_batch_hiw.js public/database/Highlight\ Incorrect\ Words/`
`git commit -m "feat: add batch preprocessors and assets for HIW mode"`

---

### Task 2: Implement Data Guardrails Test

**Files:**
- Create: `tests/hiw-data-guardrails.test.js`

**Step 1: Write guardrails test**
Write validation assertions checking that `HIW.xlsx` contains Column D and Column E with expected values, and that generated audios match the manifest entries.

**Step 2: Run test**
Run: `node tests/hiw-data-guardrails.test.js`
Expected: PASS

**Step 3: Commit**
`git add tests/hiw-data-guardrails.test.js`
`git commit -m "test: add data guardrails validation for HIW"`

---

### Task 3: Modify Routing, Tabs and Lazy Loader

**Files:**
- Modify: `public/index.html` (add stylesheet link, tab link, and launcher card)
- Modify: `public/js/lazy-loader.js` (map `hiw` to `hiw-mode.js`)
- Modify: `public/script.js` (register `hiw` launcher metadata)

**Step 1: Apply edits to HTML and JS files**
Implement the routing configuration, launcher UI card, and registration hooks.

**Step 2: Verify launcher card rendering**
Run local server and inspect that the card for "Highlight Incorrect Words" appears in the Listening section when PTE Practice scope is selected.

**Step 3: Commit**
`git add public/index.html public/js/lazy-loader.js public/script.js`
`git commit -m "feat: register HIW mode in launcher dashboard and lazy-loader"`

---

### Task 4: Create HIW CSS Layout Styles

**Files:**
- Create: `public/hiw-mode.css`

**Step 1: Write CSS styling**
Write complete CSS rules defining `.hiw-word`, yellow highlights, green/red boxes, and overall layout styling.

**Step 2: Commit**
`git add public/hiw-mode.css`
`git commit -m "style: add hiw-mode layout styling"`

---

### Task 5: Implement HIW Logic and UI Rendering

**Files:**
- Create: `public/hiw-mode.js`
- Modify: `public/index.html` (append the `<div id="mode-hiw">` panel block)

**Step 1: Append the Mode Panel to HTML**
Write and insert the HTML DOM structure for the HIW mode panel inside `public/index.html`.

**Step 2: Write HIW Mode logic script**
Write `public/hiw-mode.js` including:
- Direct parsing of `HIW.xlsx` with `xlsx.full.min.js`.
- Custom tokenizer to split text: matches `__incorrect/correct__`, separating plain text into words.
- Trailing punctuation splitting logic (e.g. `word,` -> `<span class="hiw-word">word</span>,`), ensuring punctuation is rendered outside the clickable `<span>`.
- Yellow highlighting on click.
- Audio play with randomized voice accents.
- Scoring calculation (+1 correct click, -1 incorrect click, min 0).
- Post-submission results mapping with green/red boxes and the pre-generated HTML explanation.

**Step 3: Commit**
`git add public/index.html public/hiw-mode.js`
`git commit -m "feat: implement HIW practice mode core interactive logic"`

---

### Task 6: E2E Playwright Browser Testing

**Files:**
- Create: `tests/browser/hiw-mode-browser-check.js`

**Step 1: Write browser test**
Create E2E test executing sign-in, card navigation, word highlighting, audio selection, submission, and visual validation.

**Step 2: Execute browser test**
Run: `npx playwright test tests/browser/hiw-mode-browser-check.js`
Expected: PASS

**Step 3: Commit**
`git add tests/browser/hiw-mode-browser-check.js`
`git commit -m "test: add E2E browser tests for Highlight Incorrect Words mode"`
