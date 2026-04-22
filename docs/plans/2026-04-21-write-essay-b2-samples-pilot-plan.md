# Write Essay (PTE) B2 Sample Essays - Pilot Generation + Two-Step QA + JSON/Word Export

Date: 2026-04-21
Revised: 2026-04-22

## Status

Implemented (pilot scope: 20 prompts) on 2026-04-21

## Goal

Add **B2-level model answers** for Write Essay prompts (PTE Practice) that:

- Stay **strictly within 200-300 words** (Form=2 in the rubric).
- Follow a consistent **Intro (3 sentences) + Body 1 (PEEL) + Body 2 (PEEL) + Conclusion** structure.
- Never use the digit `2` inside the essay text (use the word `two` instead).
- Keep the conclusion paragraph to **one or two sentences only** (short wrap-up, no new ideas).
- Provide **1-2 sample variants per prompt** depending on what is natural for that prompt.
- Include a short **analysis block** (Point 1, Point 2, Vocabulary) with **English + Vietnamese** glosses.
- Are available in:
  - The learner web app (Write Essay mode)
  - A `.docx` export for offline study

## System Of Record (Inputs)

- Question bank (Excel): `public/database/Write Essay/ESSAY/Essay.xlsx`
  - Sheet: `Questions`
  - Columns: `ID`, `TITLE`, `ANSWER` (prompt text)
- Runtime dataset (JSON used by the app): `public/database/Write Essay/essay-questions-with-vocab.json`
  - Contains 453 items and `targetVocabulary` lists by CEFR (A2..C2).
- Rubric reference: `public/database/knowledge-base/Write Essay Score Guide.txt`
  - **Form=2** requires word count **200-300**.
- CEFR vocabulary guard list: `The_Oxford_5000.csv` (word + level A1..C2)

## Pilot Scope (20 Prompts)

Pilot IDs (diverse prompt families):

`1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 18, 22, 23, 53, 66`

## Outputs (Artifacts)

1. Updated runtime JSON:
   - `public/database/Write Essay/essay-questions-with-vocab.json`
   - Add `sampleResponses` only for the 20 pilot IDs.
2. Word export:
   - `public/database/Write Essay/ESSAY/Write Essay Samples Pilot.docx`
3. QA report (developer-facing):
   - `tmp/write-essay-samples/pilot-qa-report.json`
   - `tmp/write-essay-samples/pilot-failures.json`

## Non-Goals (For This Pilot)

- Generating samples for all 453 prompts.
- Replacing or modifying the existing AI Tutor / scoring workflow.
- Perfect Vietnamese translation quality; instead we enforce "present and reasonable" and allow manual review later.
- Perfect automatic prompt-type classification for all prompts; pilot uses **manual mapping**.

## Data Model (JSON Schema)

Extend each relevant entry in `essay-questions-with-vocab.json` with:

```json
{
  "sampleResponses": {
    "source": "ollama:gemma4:latest",
    "rubricVersion": "public/database/knowledge-base/Write Essay Score Guide.txt",
    "promptType": "agree_disagree",
    "variants": [
      {
        "id": "agree",
        "label": "Version 1: AGREE",
        "stance": "agree",
        "essay": "Four paragraphs... (no headings inside essay)",
        "wordCount": 244,
        "analysis": {
          "point1": "...",
          "point2": "...",
          "vocabulary": [
            { "term": "...", "enGloss": "...", "viGloss": "..." }
          ]
        },
        "qa": {
          "status": "approved",
          "assessmentPass1": { "passed": true, "issues": [] },
          "editPass1Applied": false,
          "assessmentPass2": { "passed": true, "issues": [] },
          "editPass2Applied": false
        }
      }
    ]
  }
}
```

Notes:

- `wordCount` must be computed using the **same algorithm as the frontend** (split on whitespace).
- Only variants with `qa.status="approved"` are written into the production JSON and exported to Word.

## Prompt Families And Variant Policy (Decision Complete)

Pilot mapping is manual (no auto-classification in the first pass). For each prompt:

- `agree_disagree`: generate `agree` and `disagree`.
- `discuss_both_views`: generate 2 variants, each supporting a different side, but still using the same PEEL backbone.
- `advantages_disadvantages`: generate 1 balanced version by default; generate 2 only if a natural "overall positive vs overall negative" stance exists.
- `problems_solutions`: generate 1 balanced version by default; generate 2 only if the prompt explicitly frames competing causes/actors/solutions.
- `choose_between` / `responsibility`: generate 1 version per choice if the prompt is truly either/or; otherwise generate 1 "best choice" version.

Hard requirement across all families:

- The **essay text** is always 4 paragraphs: Intro, Body 1, Body 2, Conclusion.
- The intro is always **exactly 3 sentences**.
- The body paragraphs follow PEEL.
- The conclusion restates the position and paraphrases both body points in **one or two sentences only**.
- The essay must not contain the digit `2` anywhere (use `two`).

## Prompt Type Categorization (All Questions)

In addition to pilot generation, we want to categorize all Write Essay prompts by prompt signals so the question bank can be filtered and the correct essay template can be applied.

Primary categories (current product):

- `agree_disagree`
- `discuss_both_views`
- `problems_solutions`
- `advantages_disadvantages`

Additional categories (needed for prompts that do not fit the four above):

- `choose_between` (pick between options like "A or B")
- `responsibility` (a `choose_between` subtype: "who should be mainly responsible...")
- `other` (fallback bucket for manual review)

Implementation notes:

- Add a new script: `scripts/classify_write_essay_prompt_types.py`
- Update `public/database/Write Essay/essay-questions-with-vocab.json`: add a top-level `promptType` per question.
- Update `public/database/Write Essay/ESSAY/Essay.xlsx`: add a new column `PROMPT_TYPE` (and fill for all rows).
- Use deterministic keyword heuristics first (based on the structure reference doc), then keep a small manual override map for edge cases.

## Generation Engine (Local)

- Provider: local Ollama
- Model: `gemma4:latest`
- Endpoint: `http://localhost:11434/api/generate`

Health gate before doing any work:

- Call `GET http://localhost:11434/api/version` and fail fast with a clear message if unavailable.

## Generation Prompts (Structure + B2 Guardrails)

For each prompt/variant, request a **single JSON object** with:

- `essay` (string)
- `analysis.point1`, `analysis.point2` (strings)
- `analysis.vocabulary[]` (array of `{term,enGloss,viGloss}`)

Prompt must include:

- Strict structure rules (Intro=3 sentences, 4 paragraphs, PEEL).
- Word count target: **230-260** (to reliably land inside 200-300 after repairs).
- A "no-slop" rule: no markdown, no headings inside essay, no bullet points, no extra keys.
- A numeric rule: do not use the digit `2` in the essay text (use `two`).
- B2 vocabulary cap:
  - Allowed topic words: from `targetVocabulary.A2/B1/B2` for that prompt.
  - Avoid: `targetVocabulary.C1/C2` and Oxford 5000 words labeled `C1/C2`.
- Safety and cleanliness:
  - No personal data, no real names, no phone/email, no offensive content.
  - No copying large chunks of the prompt text.

## QA Procedure (Mandatory, Immediately After Generation)

No production file writes happen until QA completes.

### Staging Rules

- Raw model outputs and QA artifacts may be written to `tmp/write-essay-samples/` for crash-resume.
- Production outputs (runtime JSON + `.docx`) are written **only after** 2-pass QA approval.

### Word Count Definition (Source Of Truth)

Use the same logic as `public/write-essay-mode.js`:

`text.trim().split(/\\s+/).filter(w => w.length > 0).length`

Validation rule:

- `200 <= wordCount <= 300` is required.

### Assessment Pass 1 (Deterministic Checks)

Produce a machine-readable issue list. Fail if any "hard" item fails.

Hard checks:

- Word count is within 200-300.
- Exactly 4 paragraphs (split by blank lines, normalize multiple blank lines).
- Intro is exactly 3 sentences (sentence split by `. ! ?` with simple heuristics).
- Essay does not contain the digit `2` as a standalone token (must use `two`).
- Body 1 and Body 2 each contain:
  - a topic sentence (first sentence),
  - an explanation sentence,
  - an example/effect sentence,
  - a linking sentence back to the topic.
- Conclusion exists and restates stance + both main points.
- Conclusion must be **one or two sentences only**.
- Not all caps; contains punctuation.
- No bullet-point formatting; no numbered list prefixes.
- No HTML/JS injection strings (e.g., `<script`, `onerror=`, etc.).
- `analysis` exists and:
  - `point1` and `point2` are non-empty and match body content,
  - vocabulary list has at least 6 items,
  - missing vocabulary `term` matches are allowed as a **soft** issue in the pilot (do not block approval on this).

Lexical cap checks (B2 guard):

- Tokenize essay words; look up tokens in `The_Oxford_5000.csv`.
- Fail if any matched token is labeled `C2`.
- For `C1` tokens, allow up to 2 unique tokens as a **soft** warning; fail if more than 2.
- Fail if the essay includes any exact term from `targetVocabulary.C1/C2` (case-insensitive substring match).

### Edit Pass 1 (Targeted Repair)

If Pass 1 fails, call Gemma4 again with:

- The exact issue list,
- The original JSON output,
- A strict instruction: "return the same JSON shape with corrected `essay` and/or `analysis` only".

Optimization (edge cases found during execution):

- If **all hard issues are analysis-only** (e.g., vocabulary list too short), do an **analysis-only repair** that regenerates `analysis` without rewriting the essay.
- If Pass 1 still fails after Edit Pass 1, run **Edit Pass 2** and re-assess Pass 1 before giving up (do not stop after a single edit).

### Assessment Pass 2 (Stricter Quality Checks)

Re-run all Pass 1 checks, plus:

- Distinctness: Point 1 and Point 2 are clearly different (no paraphrase duplicates).
- Relevance: examples/effects relate to the point and prompt (basic keyword overlap heuristic).
- Coherence: intro stance matches conclusion stance.
- Vietnamese gloss quality heuristics:
  - `viGloss` non-empty and not identical to `enGloss` (case-insensitive).
  - Contains at least one non-ASCII character in at least 50% of entries (weak signal for Vietnamese diacritics; not a correctness proof).

### Edit Pass 2 (Final Repair)

If Pass 2 fails, do one last targeted repair call with the Pass 2 issues.

### Final Gate

- If all required checks pass: mark `qa.status="approved"`.
- If still failing after Edit Pass 2:
  - mark `qa.status="needs_manual_review"`,
  - exclude from production JSON and `.docx`,
  - write the failure entry to `tmp/write-essay-samples/pilot-failures.json` with:
    - prompt id, variant id, issues, last model output.

## Persistence (Writing The Final Files)

Only after all variants for a prompt have either:

- `approved`, or
- `needs_manual_review` (excluded),

write to:

1. `public/database/Write Essay/essay-questions-with-vocab.json` (approved only)
2. `public/database/Write Essay/ESSAY/Write Essay Samples Pilot.docx` (approved only)

Resume / rerun rule (edge case found during execution):

- The generator must be safe to rerun even if the staging file is missing or truncated.
- Reuse already-approved variants from the production JSON (re-validate them) and only generate missing variants.

## App Integration (Write Essay Mode)

Files:

- `public/write-essay-mode.js`
- `public/index.html`
- `public/style.css`

UI behavior:

- In the Results step, render a collapsible **Sample Essays** panel if `currentEntry.sampleResponses` has at least one `approved` variant.
- The panel supports:
  - Variant selector (tabs or dropdown)
  - Essay display (4 paragraphs)
  - Analysis display (Point 1, Point 2, Vocabulary list with EN+VI)
- Escape all strings before injecting into the DOM.

Critical HTML/JS wiring edge cases (found during execution):

- Ensure `#mode-essay` is not nested inside another hidden mode panel (e.g., `#mode-sgd`), otherwise the entire mode becomes non-interactive.
- Ensure entering Write Essay calls `WriteEssayMode.init()` at least once (not only `loadEntries()`), otherwise event listeners and DOM caching never attach and samples will not render.

Performance note (edge case for future scale):

- Storing 453 x (1-2 essays) inline will bloat the JSON and slow initial load.
- After the pilot, split samples into a separate file and lazy-load by prompt id.

## Word Export (DOCX)

Output:

- `public/database/Write Essay/ESSAY/Write Essay Samples Pilot.docx`

Layout per prompt:

- Heading 1: `TITLE` (Excel column B)
- Prompt text (Excel column C / JSON `prompt`)
- For each approved variant:
  - Variant label
  - Essay text (paragraphs preserved)
  - Analysis: Point 1, Point 2
  - Vocabulary table (Term | EN | VI)
- Page break between prompts

Validation:

- Primary: load the produced `.docx` with `python-docx` (fails fast if malformed).
  - `python -c "from docx import Document; Document(r'public/database/Write Essay/ESSAY/Write Essay Samples Pilot.docx')"`
- Windows edge case: if the target `.docx` is open in Word, saving can fail with a file lock. In that case the exporter should write a fallback file like `Write Essay Samples Pilot (new).docx`.
- Optional (if LibreOffice is installed and `soffice` is available): convert to PDF for a quick rendering sanity check.
  - `soffice --headless --convert-to pdf --outdir tmp/write-essay-samples "public/database/Write Essay/ESSAY/Write Essay Samples Pilot.docx"`

## Scripts To Implement (Names Locked)

1. Generator + QA pipeline:
   - `scripts/generate_write_essay_samples_ollama.py`
2. DOCX exporter:
   - `scripts/export_write_essay_samples_docx.py`

Both scripts must:

- Use UTF-8 for all reads/writes.
- Be restartable (can resume from staging files in `tmp/write-essay-samples/`).
- Never write to production JSON or `.docx` until QA is complete.

## Edge Cases (Must Be Handled)

- Prompt text contains curly quotes, long sentences, or multiple questions (ensure JSON encoding and paragraphing survives).
- Prompts where "agree/disagree" framing is unnatural (use prompt-family templates).
- Essays accidentally include headings like "Introduction:" inside the essay (reject in QA).
- Essays start with digits or list-like formatting that could be interpreted as bullet points (reject).
- Word count drift after edits (always re-count after each repair).
- Vietnamese glosses copied from English (reject in Pass 2).
- Model returns non-JSON or extra text (extract first JSON object; strict schema validation).
- Ollama offline mid-run (health re-check; clean failure with resume).
- `public/index.html` nesting bugs: `#mode-essay` accidentally placed inside `#mode-sgd` (or any hidden panel) will make the Write Essay UI invisible and non-interactive.
- Initialization wiring: calling `WriteEssayMode.loadEntries()` without `WriteEssayMode.init()` will not attach event listeners and will not load data.
- Browser automation: onboarding/preloader overlays may intercept pointer events; Playwright checks should prefer `window.switchToMode('essay')` and DOM `.click()` when necessary.

## Test Plan (Chrome Only)

### Data/QA Verification

- Run generator for the 20 pilot IDs.
- Confirm:
  - All persisted variants are `approved`.
  - Every essay word count is 200-300 using the frontend algorithm.
  - No Oxford-5000 `C2` tokens are present, and there are at most 2 unique `C1` tokens per essay.

### Web App (Playwright First)

Use the local Playwright-based `webapp-testing` workflow for verification (Chrome only).

- Navigate to Write Essay mode.
- Select a pilot prompt.
- Submit any draft essay to reach Results.
- Verify **Sample Essays** panel appears and renders variant content.

Automation implementation notes (found during execution):

- Prefer `window.switchToMode('essay')` for navigation in Playwright checks.
- If overlays intercept pointer events, use DOM `.click()` in `page.evaluate()` for critical buttons.
- Suggested smoke scripts:
  - `node tests/browser/write-essay-samples-browser-check.js`
  - `node tests/browser/practice-modes-browser-check.js`

If a login is required in the environment, use `C:\\Cursor AI\\.local\\browser-test-credentials.md` (do not inline credentials).

### Optional Second Pass (Interactive Confirmation)

If richer artifacts or interactive repro is needed, use the Antigravity `browser-agent` workflow after Playwright.

## Acceptance Criteria

- For the 20 pilot prompts:
  - All requested variants in the pilot mapping are approved (e.g., agree+disagree where applicable), with correct structure and 200-300 word count.
  - The app displays approved samples without breaking prompts without samples.
  - The `.docx` export opens cleanly and matches the JSON content.
  - A QA report exists listing approvals and any failures.

## Follow-Ups (After Pilot Approval)

- Scale generation to all 453 prompts in batches with resume.
- Split sample responses into a separate JSON file (lazy-loaded) for performance.
- Add a small teacher/admin UI to manually edit flagged samples and re-run QA.
