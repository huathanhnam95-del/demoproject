# Write Essay Pilot Fixes + Mindmaps Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Fix pilot Write Essay samples to enforce stricter structure/connector rules (including always starting conclusions with "In conclusion") and add per-level mindmap + flowchart visuals coherent with each sample essay.

**Architecture:** Keep the existing dataset format (`sampleResponses.levels.{level}.variants[]`) and generation pipeline, but tighten generation prompts + QA rules and add deterministic post-processing that derives mindmaps/flowcharts from the final approved essay text. UI/exporter will render the new visuals when present.

**Tech Stack:** Python (Ollama generation + QA + export via `python-docx`), vanilla JS frontend (`public/write-essay-mode.js`), Playwright-based browser checks (`tests/browser/*`).

---

## Scope

- Pilot prompts only: `1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,18,22,23,53,66`
- Levels: `a2_b1`, `b2`, `c1`
- Variants: as defined in `scripts/generate_write_essay_samples_ollama.py` (`PILOT_VARIANTS`)

## Non-Goals (For This Pass)

- Scaling generation to all prompts.
- Adding full mermaid/SVG rendering. Visuals will be stored as plain text diagrams (safe for HTML + DOCX).

## Assumptions

- The canonical phrase bank in `public/database/knowledge-base/Essay Structure (Updated 28.08.2025).docx` contains transitional starters (Explain/Example/Effect/Link) that should be followed.
- A2–B1 must stay within the lexical gate (Oxford 5000) and therefore cannot use some B2+ phrase-bank words (e.g., "primarily", "exemplified", "outcome", "aligns", "evident"). For A2–B1 we will use simplified equivalents that preserve the same PEEL roles.
- "Do not use First/Second/Third" is enforced as: do not start any body sentence with those words (case-insensitive), and do not use them as standalone transitional starters (e.g., "First, ...").
- Word count remains strictly `200–300` (frontend-like count), so A2–B1 simplicity must be achieved by sentence structure, not by writing under 200 words.

## Hard Requirements To Enforce (Pilot)

Essay text (all levels):
- Word count strictly between `200` and `300`
- Exactly four paragraphs (split by blank lines)
- Intro: exactly three sentences
  - Sentence two fixed: `In my opinion, I strongly agree/disagree with ...`
  - Sentence three fixed: `This essay will provide two reasons supporting my idea.`
- Body one and body two: PEEL, with clear transitional starters (see below)
- Conclusion: one–two sentences only
- Conclusion paragraph must start with `In conclusion,` (case-insensitive, exact phrase)
- No digit `2` in essay text (use `two`)

Academic punctuation rules:
- Do not start a sentence with `And/But/Or/So/Because`
- Comma before `and/but/or/so` when likely joining two independent clauses (existing heuristic)
- If `however`/`therefore` appear, must be `; however,` / `; therefore,`

Connector rules:
- Do not use sentence-starters `First,` / `Second,` / `Third,` / `Firstly,` / `Secondly,` / `Thirdly,` in body paragraphs.
- Explanation sentences must use the transitional starters defined below (level-specific).

## Transitional Starters (Sentence Templates)

We will enforce a *five-sentence* body paragraph structure:
- Sentence one: **Point** (topic sentence; prompt-type marker rules still apply)
- Sentence two: **Explain**
- Sentence three: **Example**
- Sentence four: **Effect**
- Sentence five: **Link**

### B2 + C1 (use phrase bank)

Body one:
- Explain: `In other words, ...`
- Example: `For instance, ...`
- Effect: `As a result, ...`
- Link: `Hence, it becomes evident that ...`

Body two:
- Explain: `This is primarily due to the fact that ...`
- Example: `This can be exemplified by the fact that ...`
- Effect: `The outcome is that ...`
- Link: `This clearly aligns with the view that ...`

### A2–B1 (simplified equivalents; same PEEL roles)

Body one:
- Explain: `In other words, ...`
- Example: `For example, ...`
- Effect: `As a result, ...`
- Link: `This shows that ...`

Body two:
- Explain: `This is because ...`
- Example: `For example, ...`
- Effect: `As a result, ...`
- Link: `This supports the view that ...`

## Visuals (Mindmap + Flowchart)

For each approved sample (per level + variant):
- Generate **mindmap text** by extracting paragraph/sentence roles from the essay:
  - Topic paraphrase (intro sentence one)
  - Opinion (intro sentence two)
  - Reason one (body one point) + Explain/Example/Effect/Link
  - Reason two (body two point) + Explain/Example/Effect/Link
  - Conclusion (full conclusion)
- Generate **flowchart text** that follows the same order using ASCII arrows.

Storage:
- Add a new optional field on each variant:
  - `ideaFlow: { mindmap: string, flowchart: string }`

Rendering:
- UI: render `ideaFlow` inside the sample panel under collapsible `<details>` sections.
- DOCX: include "Mindmap" and "Flowchart" sections per variant, using a monospaced font run.

---

## Execution Plan

### Task 1: Update QA Rules For Conclusion + Connector Constraints

**Files:**
- Modify: `scripts/generate_write_essay_samples_ollama.py`

**Steps:**
1. Add a hard QA check: conclusion paragraph must start with `In conclusion` (case-insensitive) and should include a comma after it.
2. Add a hard QA check: disallow body sentence starters `First/Second/Third/Firstly/Secondly/Thirdly` (case-insensitive) after trimming.
3. Add hard QA checks for body sentence starters for Explain/Example/Effect/Link based on `level_id` (A2–B1 simplified, B2/C1 phrase bank).
4. Add an A2–B1 hard QA check: max words per sentence (e.g., `<= 22`) to prevent upper-B1 style long sentences while staying within the 200–300 word constraint.

**Run:**
- `python -m py_compile scripts/generate_write_essay_samples_ollama.py`

**Expected:**
- Exit code `0`

### Task 2: Tighten Generation Prompts To Produce The Target Sentence Pattern

**Files:**
- Modify: `scripts/generate_write_essay_samples_ollama.py`
- Modify: `public/database/knowledge-base/Write Essay Academic Writing Rules.md`

**Steps:**
1. Update `build_system_prompt()` and `build_user_prompt()`:
   - Remove guidance that recommends `First/Second`.
   - Explicitly require body paragraphs to be **exactly five sentences** in the defined order with the specified starters.
   - Require conclusion to start with `In conclusion,`.
2. Update `repair_prompt()` to include the same constraints and add lexical replacement guidance when A2–B1 lexical gate trips.
3. Expand the academic rules doc with the additional body connector constraints (sentence-starter bans + required starters).
4. Update `coerce_payload()` word-count repair so that if the essay is under 200 words it expands existing body sentences (adds a short phrase) instead of inserting new sentences, to preserve the exact five-sentence PEEL pattern.

**Run:**
- `python -m py_compile scripts/generate_write_essay_samples_ollama.py`

**Expected:**
- Exit code `0`

### Task 3: Add Deterministic IdeaFlow Generation (Mindmap + Flowchart)

**Files:**
- Modify: `scripts/generate_write_essay_samples_ollama.py`

**Steps:**
1. Implement `build_idea_flow(essay_text, level_id, variant_ctx)` to:
   - Split into paragraphs and sentences
   - Produce `mindmap` and `flowchart` strings
2. Attach `ideaFlow` to each approved variant before writing to production JSON.
3. Add a small validator for ideaFlow: must contain at least the strings `Topic`, `Opinion`, `Reason one`, `Reason two`, `Conclusion`.

**Run:**
- `python -m py_compile scripts/generate_write_essay_samples_ollama.py`

**Expected:**
- Exit code `0`

### Task 4: Update Web UI To Render IdeaFlow

**Files:**
- Modify: `public/write-essay-mode.js`
- Modify (if needed): `public/style.css`

**Steps:**
1. Extend `renderSampleVariantHtml()` to render:
   - `Idea mindmap` (`variant.ideaFlow.mindmap`) in a `<pre>`
   - `Idea flowchart` (`variant.ideaFlow.flowchart`) in a `<pre>`
   - Wrap each in `<details>` to avoid UI bloat.
2. Keep HTML escaping for all dynamic text.
3. Add minimal CSS to keep `<pre>` readable on mobile (wrap long lines, smaller font, scroll if needed).

**Run:**
- `node -c public/write-essay-mode.js`

**Expected:**
- No syntax errors

### Task 5: Update DOCX Export To Include IdeaFlow

**Files:**
- Modify: `scripts/export_write_essay_samples_docx.py`

**Steps:**
1. After Analysis/Vocabulary, add:
   - Heading: `Mindmap`
   - Mindmap text (monospace run)
   - Heading: `Flowchart`
   - Flowchart text (monospace run)

**Run:**
- `python -m py_compile scripts/export_write_essay_samples_docx.py`

**Expected:**
- Exit code `0`

### Task 6: Regenerate Pilot Samples With New Constraints

**Files:**
- Modify: `public/database/Write Essay/essay-questions-with-vocab.json` (via generator)
- Write: `tmp/write-essay-samples/pilot-qa-report.json`
- Write: `tmp/write-essay-samples/pilot-failures.json`
- Write: `tmp/write-essay-samples/pilot-staging.json`

**Run:**
- `python scripts/generate_write_essay_samples_ollama.py --no-resume --levels a2_b1,b2,c1`

**Expected:**
- `pilot-failures.json` is `[]`
- All pilot prompts have complete `sampleResponses.levels` with approved variants at all three levels

### Task 7: Export Updated DOCX (One Per Level)

**Files:**
- Write: `public/database/Write Essay/ESSAY/Write Essay Samples Pilot - A2-B1.docx`
- Write: `public/database/Write Essay/ESSAY/Write Essay Samples Pilot - B2.docx`
- Write: `public/database/Write Essay/ESSAY/Write Essay Samples Pilot - C1.docx`

**Run:**
- `python scripts/export_write_essay_samples_docx.py --level all`
- Sanity load:
  - `python -c "from docx import Document; Document(r'public/database/Write Essay/ESSAY/Write Essay Samples Pilot - B2.docx'); print('ok')"`

**Expected:**
- Docs save successfully (or `(new)` fallback if locked)

### Task 8: Browser Verification (Chrome Only)

**Files:**
- Modify (if needed): `tests/browser/write-essay-samples-browser-check.js`

**Run:**
- `node tests/browser/write-essay-samples-browser-check.js`
- `node tests/browser/practice-modes-browser-check.js`

**Expected:**
- Both scripts complete without errors

---

## Edge-Case Review Pass 1 (Before Execution)

- Word-count floor: if generator produces essays at 197–199 words, post-processing must expand *without* introducing banned sentence starters or digit `2`.
- Sentence-count invariants: if we enforce exactly five body sentences, any word-count repair must NOT add sentences (avoid current filler-insert behavior).
- Phrase-bank vs lexical gate: A2–B1 cannot use phrase-bank tokens (`primarily`, `exemplified`, `outcome`, `aligns`, `evident`). The validator must enforce simplified equivalents for A2–B1 while allowing phrase-bank starters for B2/C1.
- Prompt contains B2+ tokens: A2–B1 prompt paraphrase must avoid copying them (e.g., "industrial revolution", "culture shock"). Generation prompt should explicitly ban B2+ prompt tokens when possible.
- Repairs dropping keys: model edits sometimes omit `parts` or `analysis`; generator must merge missing blocks from prior payload.

## Edge-Case Review Pass 2 (Before Execution)

- Discuss-both-views and advantages/disadvantages markers: Ensure the enforced sentence starters do not conflict with required first-sentence markers (`On the one hand,` etc). The Point sentence marker remains prompt-type-specific; the enforced starters begin from sentence two.
- Responsibility/choose-between prompt types: they currently use agree-style bodies; ensure point markers are consistent and do not introduce `First/Second`.
- Mindmap/flowchart coherence: generation must derive from the *final* essay text after coercion and repairs, not from raw model output.
- B2 phrase-bank tokens: If the enforced B2 starters introduce unexpectedly advanced words that trigger B2 lexical gating (C1/C2), downgrade to the closest B2-safe alternative while keeping the same functional role (Explain/Example/Effect/Link).
- Regression risk: tightening QA can cause regeneration loops. Keep repair prompts explicit about sentence starters and sentence counts, and preserve `parts`/`analysis` blocks during edits via merge logic.
