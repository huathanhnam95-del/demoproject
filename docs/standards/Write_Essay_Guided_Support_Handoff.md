# Write Essay Guided Support — Handoff Plan

## Current status

The engineering implementation is complete on branch `codex/write-essay-guided-support` at:

`C:\Cursor AI-write-essay-guided-support`

Commit: `c3dda1e2`

The original `C:\Cursor AI` worktree was not merged, pushed, or deployed. Its unrelated dirty changes remain preserved.

The feature is not release-complete because the content publication gate has not passed.

## Completed engineering

- Guided Practice selector alongside Exam Practice.
- Exam countdown preserved at 20 minutes.
- Guided count-up timer and assisted-attempt metadata.
- Adaptive level resolution: writing CEFR profile → onboarding level → B2 fallback.
- Manual level override and local language/level preferences.
- English/Vietnamese support rail with:
  - prompt breakdown;
  - prompt requirements and traps;
  - defensible angles;
  - vocabulary, collocations, grammar, and cohesion;
  - thesis/body plans;
  - progressive sentence scaffolds;
  - FAQ;
  - tutor handoff context;
  - pre-submission checklist;
  - recycled target display.
- Optional model sentences are revealed only at the deepest hint level and are never inserted into the editor.
- Stale pack requests can be aborted; missing, corrupt, incompatible, and unpublished packs show retryable unavailable state.
- Manifest is network-first; hash-named packs are cache-first; all packs are not pre-cached.
- Backward-compatible archive guidance metadata stores IDs/counts rather than revealed sentence text.
- Existing Gemini and queued local-scoring actions remain separate.

## Content pipeline status

The pipeline is implemented in `scripts/write_essay_support/`.

- Authoritative source reconciliation found 453 IDs.
- Question 370 has a blank prompt in the authoritative workbook and is marked `SOURCE_INVALID` with `missing_prompt`.
- A deterministic template-only run processed 453 records and validated 452 packs. This output is test evidence only and must not be copied to the production support path.
- The only three-model smoke run processed question 1. DeepSeek, Qwen, and Gemma produced audit artifacts, but all seven components were quarantined because the independent audit requirement was not met.
- No publishable production manifest or pack set has been generated.

## Required next work

### 1. Repair the source blocker

Resolve question 370 in the authoritative source workbook and the corresponding question JSON. The prompt must be confirmed against the intended source; do not invent replacement text.

Re-run source reconciliation and confirm:

- 453 question IDs;
- no missing prompts;
- workbook/JSON prompt equality;
- task type and topic equality;
- sample metadata for all three support levels.

### 2. Run a representative three-model generation

Use question IDs that cover each task type and a question with approved samples. Inspect:

- DeepSeek plan output;
- Qwen bilingual material output;
- Gemma review output;
- all independent audit votes;
- raw artifacts and hashes;
- any debate and revised component decisions.

Do not convert a failed or malformed model response into PASS. Fix prompts or parsing when needed, then rerun the representative set.

### 3. Run full generation

Use the production output directory only after the representative run is clean:

```powershell
python -m scripts.write_essay_support.cli `
  --output-root "public/database/Write Essay/support/v1"
```

The CLI uses the local Ollama endpoint at `http://127.0.0.1:11434` and the installed models:

- `deepseek-r1:14b`
- `qwen3:14b`
- `gemma4:latest`

### 4. Handle quarantine safely

For a failed component, preserve the initial votes, raw artifacts, debate history, prior hashes, and aggregate report. Use a targeted rerun only after the cause is understood:

```powershell
python -m scripts.write_essay_support.cli `
  --quarantine-only `
  --output-root "public/database/Write Essay/support/v1"
```

A debated revision must receive fresh 3/3 PASS. Otherwise it remains quarantined and is excluded from the manifest.

### 5. Validate the release gate

```powershell
python -m scripts.write_essay_support.cli `
  --validate-only `
  --output-root "public/database/Write Essay/support/v1"
```

Release requires:

- 453 manifest entries;
- all three levels in every pack;
- zero source-invalid questions;
- zero generation errors;
- zero quarantined questions;
- zero stale components;
- valid prompt hashes;
- official collocations only;
- bilingual fields present;
- no unsafe HTML or fabricated evidence;
- aggregate totals reconciled from sidecars.

## Resume and dry-run commands

Representative dry run:

```powershell
python -m scripts.write_essay_support.cli `
  --ids 1,370 `
  --template-only `
  --output-root tmp/write-essay-support-smoke
```

Full deterministic coverage without publication:

```powershell
python -m scripts.write_essay_support.cli `
  --template-only `
  --output-root tmp/write-essay-support-full-template
```

Resume an existing sidecar while skipping published questions:

```powershell
python -m scripts.write_essay_support.cli `
  --resume `
  --output-root "public/database/Write Essay/support/v1"
```

Targeted reruns write `reports/rerun-*.json` and do not overwrite the full `report.json`.

## Verification checklist

Run from `C:\Cursor AI-write-essay-guided-support`:

```powershell
python -m pytest -q --import-mode=importlib `
  tests/write_essay_support_contract.test.py `
  tests/write_essay_support_pipeline.test.py

node --test tests/write-essay-support-runtime.test.mjs
node --check public/write-essay-mode.js
node --check public/js/write-essay-support.js

$env:NODE_PATH='C:\Cursor AI\node_modules'
node tests/browser/write-essay-guided-support-browser-check.js
node tests/browser/write-essay-filters-browser-check.js
node tests/browser/write-essay-samples-browser-check.js
```

The focused suite currently passes: 15 Python tests, 3 Node runtime tests, and the Guided/filters/samples Chrome checks.

The repository has no `npm test` script. Do not describe the missing script as a product test failure; use the focused commands above.

## Important safety rules

- Do not publish template-only output.
- Do not silently fill question 370 with invented text.
- Do not treat a local test pass as deployment or live evidence.
- Do not expose raw audit artifacts through the learner tutor handoff.
- Do not store revealed sentence text in archived attempt metadata.
- Do not deploy or push without explicit approval.

## Final handoff decision

The next owner should repair question 370, complete a successful representative three-model run, then run the full generation and validation gates. Only after the manifest contains all 453 publishable entries should the branch be reviewed for merge or deployment.
