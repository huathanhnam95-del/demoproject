# Drag & Drop Reading Mode Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Add a PTE Practice Reading mode named "Drag & Drop" where learners drag word boxes into inline blanks, submit their answer, and review correct answers, incorrect choices, their own attempt, and audited Gemma-generated explanations for every blank.

**Architecture:** Preserve `public/database/DD/DD/D&D.xlsx` as the source workbook. Build a generated JSON question bank from column C, enrich that JSON with local Ollama/Gemma explanations, audit and rewrite the generated explanations, then let the client UI load the audited JSON without calling AI during normal learner attempts.

**Tech Stack:** Vanilla JS, CSS, HTML5 drag/drop plus click fallback, Node.js, ExcelJS, local Ollama/Gemma (`OLLAMA_BASE_URL`, `OLLAMA_MODEL`), Playwright Chromium.

---

## Current Source Findings

- Source file: `public/database/DD/DD/D&D.xlsx`
- Sheet: `Questions`
- Headers: `ID`, `TITLE`, `ANSWER`, `ANSWER FOR COMPARE OR TRANSCRIPT`
- Column C contains 1,040 data rows after the header.
- The normal pattern is: passage with `__correct answer__` blanks, then `---`, then slash-separated distractors.
- Initial parse scan found 1,036 rows with at least one blank and 4 rows with no `__...__` blank markers: Excel rows 846, 879, 973, and 993.
- Blank counts range from 2 to 7 blanks per usable question. Distractor counts range from 2 to 10.
- One row appears to duplicate a correct answer in the distractor list, so the implementation must treat options as unique option objects, not just raw strings.

## Chosen Mode Contract

- Mode id: `dd`
- Global controller: `window.DDMode`
- Route: `/pte-practice/reading/dd`
- Panel id: `mode-dd`
- Hidden tab id: `tab-dd`
- Launcher card id: `mode-btn-dd`
- Main files:
  - `public/dd-mode.js`
  - `public/dd-mode.css`
  - `public/database/DD/dd-questions.json`
  - `public/database/DD/dd-dataset-report.json`
  - `public/database/DD/dd-explanation-audit.json`
  - `docs/audits/2026-05-21-dd-explanation-audit.md`

Default placement should be after `rfib` and before `rmcma` in Reading:

```javascript
modeIds: ['rfib', 'dd', 'rmcma', 'rop']
```

Add it to PTE Practice. Keep English Practice out of scope unless explicitly requested.

---

### Task 1: Parser Contract Tests

**Files:**
- Create: `tests/dd-dataset-parser.test.js`
- Create: `scripts/dd/dd-dataset-core.js`

**Step 1: Write failing parser tests**

Test the source format before implementing the parser:

```javascript
const assert = require('assert');
const {
  parseDragDropAnswerCell,
  buildQuestionRecord
} = require('../scripts/dd/dd-dataset-core');

const sample = [
  'In 1999, the nation __suffered__ its first budget deficit __because__ of a slump.',
  '---',
  'endure/while/enjoyed'
].join('\n');

const parsed = parseDragDropAnswerCell(sample);
assert.deepStrictEqual(parsed.correctAnswers, ['suffered', 'because']);
assert.deepStrictEqual(parsed.distractors, ['endure', 'while', 'enjoyed']);
assert.strictEqual(parsed.segments.filter(s => s.type === 'blank').length, 2);

const record = buildQuestionRecord({
  id: 1,
  title: '#1 Botswana',
  sourceRow: 2,
  answerCell: sample,
  compareText: 'In 1999, the nation suffered its first budget deficit because of a slump.'
});

assert.strictEqual(record.mode, 'dd');
assert.strictEqual(record.blanks.length, 2);
assert(record.options.every(option => option.optionId));
assert(record.validation.isUsable);
```

Also add tests for:

- Missing `---` separator.
- Missing blanks.
- Duplicate option text.
- Blanks with punctuation around them.
- A correct answer that appears more than once.

**Step 2: Run test to verify it fails**

Run:

```bash
node tests/dd-dataset-parser.test.js
```

Expected: FAIL because `scripts/dd/dd-dataset-core.js` does not exist yet.

---

### Task 2: Dataset Parser And JSON Builder

**Files:**
- Create: `scripts/dd/dd-dataset-core.js`
- Create: `scripts/dd/build-dd-dataset.js`
- Create generated output: `public/database/DD/dd-questions.json`
- Create generated output: `public/database/DD/dd-dataset-report.json`

**Step 1: Implement parser core**

`parseDragDropAnswerCell(text)` should:

- Split the cell on the first `---`.
- Extract correct answers with `/__([\s\S]+?)__/g` so a rare single underscore inside an answer does not break parsing.
- Replace each `__answer__` in the passage with a blank segment.
- Split distractors by `/`, trimming whitespace.
- Keep raw text and normalized text separately.
- Return parse warnings instead of throwing for row-level issues.

Each generated question should use this schema:

```json
{
  "id": 1,
  "mode": "dd",
  "title": "#1 Botswana",
  "sourceRow": 2,
  "plainText": "Although Botswana is rich...",
  "segments": [
    { "type": "text", "text": "In 1999, the nation " },
    { "type": "blank", "blankId": "q1-b1", "index": 0, "answer": "suffered" }
  ],
  "blanks": [
    {
      "blankId": "q1-b1",
      "index": 0,
      "answer": "suffered",
      "explanation": null
    }
  ],
  "options": [
    { "optionId": "q1-o1", "text": "suffered", "kind": "correct", "blankId": "q1-b1" },
    { "optionId": "q1-o2", "text": "endure", "kind": "distractor" }
  ],
  "validation": {
    "isUsable": true,
    "warnings": []
  }
}
```

**Step 2: Implement workbook builder**

Use `exceljs` to read `public/database/DD/DD/D&D.xlsx`, read only column C for the question/answer source, and use columns A/B/D for ids, titles, and validation metadata. `exceljs` is already present in `package.json` as of this plan (`^4.4.0`); if it is missing during execution, stop and confirm before adding a dependency.

The builder should:

- Sort by numeric `ID`.
- Skip unusable rows by default.
- Preserve skipped rows in `dd-dataset-report.json`.
- Write pretty JSON for review-friendly diffs.
- Include source metadata: workbook path, sheet name, row counts, generated timestamp, and parser version.

**Step 3: Run builder**

Run:

```bash
node scripts/dd/build-dd-dataset.js
```

Expected:

- `public/database/DD/dd-questions.json` exists.
- `public/database/DD/dd-dataset-report.json` lists total rows, usable rows, skipped rows, warnings, blank-count distribution, and option-count distribution.
- The four no-blank rows are either skipped or flagged for manual repair.

**Step 4: Run parser test**

Run:

```bash
node tests/dd-dataset-parser.test.js
```

Expected: PASS.

---

### Task 3: Local Gemma Explanation Generator

**Files:**
- Create: `scripts/dd/ollama-json-client.js`
- Create: `scripts/dd/generate-dd-explanations.js`
- Modify generated output: `public/database/DD/dd-questions.json`

**Step 1: Implement Ollama JSON client**

Reuse the existing local AI contract from `src/routes/ai-proxy.js`:

- Default `OLLAMA_BASE_URL=http://localhost:11434`.
- Default `OLLAMA_MODEL=gemma4:latest`.
- Reject non-local URLs unless `ALLOW_REMOTE_OLLAMA=1`.
- POST to `/api/chat`.
- Use `stream:false` and `format:"json"`.
- Parse JSON defensively by extracting the first JSON object if Gemma wraps the payload.
- Retry failed rows with short backoff.

**Step 2: Implement generator**

The generator should process one question at a time and produce explanation objects for every blank in that question:

```json
{
  "blankId": "q1-b1",
  "answer": "suffered",
  "explanation": "The verb 'suffered' fits because the sentence describes Botswana experiencing a budget deficit...",
  "coherenceCue": "The phrase 'budget deficit' needs a verb showing a negative event that happened to the nation.",
  "vocabGrammarCue": "'Suffered' collocates naturally with negative events such as losses, deficits, and setbacks.",
  "contextNote": "The later contrast beginning with 'Yet' supports a negative event before the positive statement.",
  "distractorNotes": [
    { "option": "endure", "reason": "The base verb does not fit the past-tense sentence pattern." }
  ],
  "model": "gemma4:latest",
  "status": "generated"
}
```

Prompt requirements:

- Focus on coherence and cohesion first.
- Include vocabulary and grammar fit.
- Explain why the correct option is right in context.
- Explain only the relevant distractors for that question.
- Do not invent facts outside the passage unless adding a short context note needed for comprehension.
- Return JSON only.

Command examples:

```bash
node scripts/dd/generate-dd-explanations.js --limit 3
node scripts/dd/generate-dd-explanations.js --resume
node scripts/dd/generate-dd-explanations.js --question-id 1
```

Expected:

- `--limit 3` enriches three questions.
- `--resume` skips blanks that already have valid explanations.
- Failed questions get `status:"generation_failed"` plus an error message, without corrupting valid rows.

---

### Task 4: Explanation Audit And Rewrite Pass

**Files:**
- Create: `scripts/dd/audit-dd-explanations.js`
- Create generated output: `public/database/DD/dd-explanation-audit.json`
- Create: `docs/audits/2026-05-21-dd-explanation-audit.md`
- Modify generated output when rewriting: `public/database/DD/dd-questions.json`

**Step 1: Implement full audit**

Audit every blank explanation, not a sample only. Checks:

- Every usable blank has an explanation.
- Explanation mentions the correct answer.
- Explanation does not claim a distractor is correct.
- Explanation covers coherence/cohesion and vocabulary/grammar.
- Explanation length is useful but not bloated: target 45-130 words.
- No markdown fences, raw JSON, HTML, or unsupported characters.
- `blankId`, answer, and option references match the source dataset.
- Repeated answers and duplicate options are handled by id, not string position.

**Step 2: Implement rewrite mode**

For failed audit items, call local Gemma again with:

- The original passage.
- The blank id and correct answer.
- The learner-facing option list.
- The failed explanation.
- The audit failure reasons.

Command examples:

```bash
node scripts/dd/audit-dd-explanations.js --check
node scripts/dd/audit-dd-explanations.js --rewrite --max-rewrites 200
node scripts/dd/audit-dd-explanations.js --check --report-md docs/audits/2026-05-21-dd-explanation-audit.md
```

Expected:

- `--check` exits non-zero if any explanation fails.
- `--rewrite` rewrites only failing explanations.
- Final markdown report includes total blanks, pass count, rewrite count, unresolved failures, and representative examples.

---

### Task 5: Register The Mode In The Practice Shell

**Files:**
- Modify: `public/index.html`
- Modify: `public/script.js`
- Modify: `public/js/lazy-loader.js`

**Step 1: Add hidden tab and dashboard card**

In `public/index.html`:

- Add `<link rel="stylesheet" href="dd-mode.css">` near the other reading mode CSS links.
- Add `<button id="tab-dd" class="tab-btn" type="button">Drag & Drop</button>` in the hidden tabs header.
- Add a Reading card under `#panel-tutorials .tutorial-grid`:
  - `id="mode-btn-dd"`
  - `data-practice-skill="reading"`
  - `onclick="window.switchToMode('dd')"`
  - `aria-label="Drag & Drop mode"`
- Add `<div id="mode-dd" class="mode-panel" style="display:none;">...</div>`.

Required panel elements:

- `dd-v7-picker-bar`
- `dd-v7-prev-btn`
- `dd-v7-question-pill`
- `dd-v7-next-btn`
- `dd-v7-backdrop`
- `dd-v7-sheet`
- `dd-v7-jump-search`
- `dd-v7-jump-list`
- `dd-passage`
- `dd-word-bank`
- `dd-submit-btn`
- `dd-retry-btn`
- `dd-next-question-btn`
- `dd-result-summary`
- `dd-results`

**Step 2: Register launcher metadata**

In `public/script.js`:

- Add `dd` to `PRACTICE_LAUNCHER.skills.reading.modeIds` after `rfib`.
- Add `dd` to `PRACTICE_LAUNCHER.modes`.
- Add `dd` to `PRACTICE_SCOPE_CONFIG[SCOPE_PTE].visibleModes`.
- Add `dd: { label: 'Drag & Drop' }` to PTE mode overrides.
- Do not add it to `SCOPE_ENGLISH.visibleModes` unless the product decision changes.
- Add `dd` to the `ensureModeAssets(mode)` whitelist:
  ```javascript
  if (!['watch', 'notes', 'rfib', 'rmcma', 'rop', 'dd'].includes(mode)) return true;
  ```
- In the leaving-mode block near the existing `rmcma` and `rop` exit hooks, add:
  ```javascript
  if (leavingMode === 'dd' && mode !== 'dd') {
    if (window.DDMode?.shouldConfirmExit?.() && !window.confirm('Leaving Drag & Drop will discard your current attempt. Continue?')) {
      return;
    }
    window.DDMode?.onExit?.();
  }
  ```
- In the mode activation chain, add the `dd` branch after the `rop` branch and before `essay`:
  ```javascript
  } else if (mode === 'dd' && window.DDMode && typeof window.DDMode.activate === 'function') {
    await window.DDMode.activate();
  }
  ```

**Step 3: Register lazy loader**

In `public/js/lazy-loader.js`:

- Add `ensureDDModeLoaded()`.
- Load `dd-mode.js`.
- Add a `mode === 'dd'` branch in `ensureModeScripts(mode)`.
- Export `ensureDDModeLoaded`.

**Step 4: Run syntax/lint check**

Run:

```bash
npx eslint public/script.js public/js/lazy-loader.js
```

Expected: PASS.

---

### Task 6: Build The Drag & Drop UI Controller

**Files:**
- Create: `public/dd-mode.js`

**Step 1: Implement state**

Use a self-contained module:

```javascript
window.DDMode = {
  activate,
  onExit,
  shouldConfirmExit,
  loadQuestionById
};
```

Internal state:

- `questions`
- `currentQuestionIndex`
- `currentQuestion`
- `placements` as `Map(blankId, optionId)`
- `selectedOptionId` for click/tap fallback
- `submitted`
- `questionIndexById`

**Step 2: Load data**

Fetch:

```text
/database/DD/dd-questions.json
```

Validate that at least one usable question exists. If not, show a friendly error in the panel and log the detailed reason to console.

**Step 3: Render passage**

Render `segments` into a passage where blanks are real drop targets:

- Before submit: empty slot or selected word chip.
- After submit: correct blanks green, incorrect blanks red, missing blanks neutral warning.
- Each blank has `data-blank-id`.
- Each filled chip has a remove button before submit.

**Step 4: Render word bank**

Render all correct options plus distractors as shuffled draggable word boxes.

Rules:

- Use stable option ids.
- Keep duplicate text as separate option objects.
- Disable word boxes after submit.
- Support mouse drag/drop, keyboard focus, and click-to-place fallback.
- On touch screens, click a word then click a blank.
- Keyboard contract:
  - Word chips and blank slots are reachable by `Tab`.
  - `Enter` or `Space` selects a focused word chip.
  - `Enter` or `Space` on a focused blank places the selected chip.
  - `Escape` clears the current selected chip.
  - Filled blank remove buttons are keyboard reachable before submit.

**Step 5: Submit behavior**

Submit should be disabled until every blank has a placement.

On submit:

- Compare placed option text and the target blank answer using normalized text.
- Keep exact original text for display.
- Show score as `correct / total`.
- Show the completed passage with learner choices.
- Call `window.handleDualTrackScoring?.('dd', questionId, { answers })` if available.
- Call `window.recordPracticeAttempt?.(questionId, isPerfect, 'dd')` if available.
- Show a per-blank result card:
  - Blank number.
  - User answer.
  - Correct answer.
  - Status: correct, incorrect, or missing.
  - Correct option and incorrect option labels.
  - Explanation from the audited dataset.
  - Distractor notes for the selected wrong option and other options when available.

**Step 6: Navigation**

Implement:

- Previous/next question.
- V7 question picker sheet.
- Search by id/title/passage snippet.
- `practice-route-question` deep-link handling.
- URL replace for question id, matching RFIB/ROP behavior.

**Step 7: Exit behavior**

If the learner has unsubmitted placements, confirm before leaving the mode. After submit, allow navigation without prompt.

**Step 8: Lightweight local progress**

Persist the last opened DD question id in `localStorage` so returning learners resume near where they left off. Do not build full attempt-history persistence in v1; scored history should use existing practice-attempt plumbing if that product need is later confirmed.

---

### Task 7: Build The Stylesheet

**Files:**
- Create: `public/dd-mode.css`

**Step 1: Style the practice area**

Use the existing Reading mode visual language: focused, scan-friendly, not a landing page.

Required states:

- `.dd-blank-slot`
- `.dd-blank-slot.is-filled`
- `.dd-blank-slot.is-correct`
- `.dd-blank-slot.is-incorrect`
- `.dd-option-chip`
- `.dd-option-chip.is-selected`
- `.dd-option-chip.is-used`
- `.dd-option-chip.is-dragging`
- `.dd-result-card`
- `.dd-result-card.is-correct`
- `.dd-result-card.is-incorrect`

Responsive requirements:

- No text overlap on mobile.
- Word chips wrap cleanly.
- Passage line height stays readable with inline blanks.
- Result cards are single-column on narrow screens and two-column on desktop only when space allows.

---

### Task 8: Browser Test The Full Learner Flow

**Files:**
- Create: `tests/browser/dd-mode-browser-check.js`
- Modify: `tests/browser/practice-modes-browser-check.js`
- Modify: `tests/browser/practice-launcher-clickpath-browser-check.js`

**Step 1: Write Chrome-only Playwright check**

This workspace uses Chrome-only browser planning unless explicitly requested otherwise. The test should:

- Start a local static Express server on a free port.
- Apply `sessionStorage` mock to bypass the onboarding welcome modal.
- Navigate to `/index.html`.
- Select the Reading skill.
- Click `#mode-btn-dd`.
- Wait for `#mode-dd.active`.
- Verify the question picker pill shows a DD question.
- Drag or click word boxes into blanks.
- Submit one perfect attempt and assert score `N / N`.
- Retry, create one incorrect placement, submit, and assert:
  - User answer is visible.
  - Correct answer is visible.
  - Incorrect option is visible.
  - Explanation is visible for the affected blank.
- Test previous/next and question picker search.
- Assert no page errors except intentionally ignored static-resource noise.

Run:

```bash
node tests/browser/dd-mode-browser-check.js
```

Expected: `DD browser check passed successfully.`

**Step 2: Update launcher regression tests**

Add `dd` to Reading-mode expectations in:

- `tests/browser/practice-modes-browser-check.js`
- `tests/browser/practice-launcher-clickpath-browser-check.js`

Run:

```bash
node tests/browser/practice-modes-browser-check.js
node tests/browser/practice-launcher-clickpath-browser-check.js
```

Expected: PASS.

---

### Task 9: Final Verification Gate

Run these in order:

```bash
node tests/dd-dataset-parser.test.js
node scripts/dd/build-dd-dataset.js
node scripts/dd/generate-dd-explanations.js --limit 3
node scripts/dd/audit-dd-explanations.js --check --limit 3
npx eslint public/dd-mode.js public/script.js public/js/lazy-loader.js scripts/dd/*.js tests/browser/dd-mode-browser-check.js
node tests/browser/dd-mode-browser-check.js
node tests/browser/practice-modes-browser-check.js
node tests/browser/practice-launcher-clickpath-browser-check.js
git diff --check
```

Full completion gate after the small Gemma smoke pass:

```bash
node scripts/dd/generate-dd-explanations.js --resume
node scripts/dd/audit-dd-explanations.js --rewrite
node scripts/dd/audit-dd-explanations.js --check --report-md docs/audits/2026-05-21-dd-explanation-audit.md
node tests/browser/dd-mode-browser-check.js
git diff --check
```

Expected final state:

- All usable DD questions have audited explanations.
- Any skipped workbook rows are documented.
- Drag/drop, click fallback, submit, retry, navigation, and explanation display work in Chrome.
- No local credentials are needed for this test pass.

---

## Risks And Edge Cases

- Local Gemma generation over roughly 1,036 questions may take a long time. The generator must support resume and id-specific repair.
- Production users cannot reach a developer machine's `localhost:11434`. This plan avoids that issue by generating and auditing explanations before release.
- Duplicate option text must be represented by unique option ids.
- Rows with no blank markers should be skipped or manually repaired before final completion.
- Long passages need responsive blank slots that do not break line flow or overlap text.
- HTML5 drag/drop alone is weak on touch devices, so click-to-place is required.
- Keyboard accessibility is part of v1, not polish: the mode must be fully usable through focus, `Enter`/`Space`, and visible focus states.
- Explanations must be sanitized as text unless the dataset explicitly stores approved safe markup.
- Full localStorage attempt history is future scope; v1 should only remember the last question id and rely on the existing attempt hooks when available.
