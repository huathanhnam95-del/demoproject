# Write Essay Batch Generation (Fifty Prompts Per Run)

This guide explains the current end-to-end workflow to generate the next batch of Write Essay samples and export the three DOCX files (A2-B1, B2, C1).

## What This Pipeline Produces

- Updates: `public/database/Write Essay/essay-questions-with-vocab.json`
  - Adds `sampleResponses.levels.{a2_b1,b2,c1}.variants[]` for each generated prompt ID (approved only).
- Exports: one DOCX per level (you choose the output filenames per batch).
- Runs UI smoke checks (optional but recommended).

## Prerequisites

1. Ollama is installed and running.
2. The target model exists locally (default is `gemma4:latest`).
3. Node.js is installed (for browser checks).

Quick checks:

```powershell
ollama list
```

If the server is not running:

```powershell
ollama serve
```

## Step One: Pick The Next Fifty Prompt IDs

Only twenty pilot prompts currently have approved samples. Most IDs are still missing.

Use this to print the next fifty missing IDs:

```powershell
python -c "import json; p=r'public/database/Write Essay/essay-questions-with-vocab.json'; data=json.load(open(p,'r',encoding='utf-8')); missing=[]; req=['a2_b1','b2','c1'];\nfor q in data:\n  qid=q.get('id');\n  if not isinstance(qid,int):\n    continue\n  sr=q.get('sampleResponses');\n  if not isinstance(sr,dict):\n    missing.append(qid); continue\n  levels=sr.get('levels');\n  if not isinstance(levels,dict):\n    missing.append(qid); continue\n  ok=True\n  for lvl in req:\n    lv=levels.get(lvl);\n    if not isinstance(lv,dict) or not isinstance(lv.get('variants'),list):\n      ok=False; break\n    approved=[v for v in lv['variants'] if isinstance(v,dict) and isinstance(v.get('qa'),dict) and v['qa'].get('status')=='approved']\n    if not approved:\n      ok=False; break\n  if not ok:\n    missing.append(qid)\nprint(','.join(str(x) for x in missing[:50]))"
```

Copy the printed comma-separated IDs. You will use them in `--ids`.

## Step Two: Classify Prompt Types (Run Once Or When Prompts Change)

This updates `promptType` in the JSON and also updates `PROMPT_TYPE` in the Excel question bank:

```powershell
python scripts/classify_write_essay_prompt_types.py
```

Output report:

- `tmp/write-essay-samples/prompt-type-classification-report.json`

## Step Three: Add Variant Mappings For New Prompt IDs

The generator currently requires a per-prompt variant mapping in:

- `scripts/generate_write_essay_samples_ollama.py` → `PILOT_VARIANTS`

If an ID has no mapping entry, generation will fail with `no_variant_mapping`.

For each new prompt ID, add:

- `promptType`: one of `agree_disagree`, `discuss_both_views`, `problems_solutions`, `advantages_disadvantages`, `choose_between`, `responsibility`
- `variants`: list of variant objects (`id`, `label`, `stance`, `stanceStatement`, optional `stanceStatementByLevel`)

Templates:

Agree/Disagree (two variants):

```python
16: {
  "promptType": "agree_disagree",
  "variants": [
    {"id": "agree", "label": "Version 1: AGREE", "stance": "agree", "stanceStatement": "the view that ..."},
    {"id": "disagree", "label": "Version 2: DISAGREE", "stance": "disagree", "stanceStatement": "the view that ..."},
  ],
},
```

Discuss Both Views (two variants, each supports one side):

```python
99: {
  "promptType": "discuss_both_views",
  "variants": [
    {"id": "view_a", "label": "Version 1: VIEW A", "stance": "agree", "stanceStatement": "the view that ..."},
    {"id": "view_b", "label": "Version 2: VIEW B", "stance": "agree", "stanceStatement": "the view that ..."},
  ],
},
```

Advantages/Disadvantages (two variants):

```python
123: {
  "promptType": "advantages_disadvantages",
  "variants": [
    {"id": "positive", "label": "Version 1: MORE POSITIVE", "stance": "agree", "stanceStatement": "the view that ... has more positive impacts than negative impacts"},
    {"id": "negative", "label": "Version 2: MORE NEGATIVE", "stance": "agree", "stanceStatement": "the view that ... has more negative impacts than positive impacts"},
  ],
},
```

Problems/Solutions (one variant):

```python
150: {
  "promptType": "problems_solutions",
  "variants": [
    {"id": "solutions", "label": "Version 1: SOLUTIONS", "stance": "agree", "stanceStatement": "the view that ... can be solved by ..."},
  ],
},
```

Choose Between (two variants):

```python
200: {
  "promptType": "choose_between",
  "variants": [
    {"id": "option_a", "label": "Version 1: OPTION A", "stance": "agree", "stanceStatement": "the view that ... option A is better than option B"},
    {"id": "option_b", "label": "Version 2: OPTION B", "stance": "agree", "stanceStatement": "the view that ... option B is better than option A"},
  ],
},
```

Responsibility (often three variants):

```python
250: {
  "promptType": "responsibility",
  "variants": [
    {"id": "government", "label": "Version 1: GOVERNMENT", "stance": "agree", "stanceStatement": "the view that governments have the main responsibility to ..."},
    {"id": "companies", "label": "Version 2: COMPANIES", "stance": "agree", "stanceStatement": "the view that companies have the main responsibility to ..."},
    {"id": "individuals", "label": "Version 3: INDIVIDUALS", "stance": "agree", "stanceStatement": "the view that individuals have the main responsibility to ..."},
  ],
},
```

Notes:

- Use `two` in `label` text if needed. Avoid the digit `2` in essay text (the generator already enforces this), but labels are fine.
- For A2-B1, add `stanceStatementByLevel: {"a2_b1": "..."}` when the base statement contains difficult vocabulary.

## Step Four: Generate The Batch (All Levels)

Run generation for the selected IDs:

```powershell
python scripts/generate_write_essay_samples_ollama.py --levels a2_b1,b2,c1 --ids "<comma-separated-ids>" --staging-dir "tmp/write-essay-samples/batch-one"
```

If you want a clean staging run (no resume):

```powershell
python scripts/generate_write_essay_samples_ollama.py --no-resume --levels a2_b1,b2,c1 --ids "<comma-separated-ids>" --staging-dir "tmp/write-essay-samples/batch-one"
```

Artifacts:

- `<staging-dir>/pilot-qa-report.json`
- `<staging-dir>/pilot-failures.json`
- `<staging-dir>/pilot-staging.json`

The run is successful when `pilot-failures.json` is empty and the production JSON is updated.

## Step Five: Export DOCX For This Batch

Export three DOCX files using custom `--out` names so you do not overwrite the pilot docs:

```powershell
python scripts/export_write_essay_samples_docx.py --level a2_b1 --ids "<comma-separated-ids>" --out "public/database/Write Essay/ESSAY/Write Essay Samples Batch - A2-B1.docx"
python scripts/export_write_essay_samples_docx.py --level b2    --ids "<comma-separated-ids>" --out "public/database/Write Essay/ESSAY/Write Essay Samples Batch - B2.docx"
python scripts/export_write_essay_samples_docx.py --level c1    --ids "<comma-separated-ids>" --out "public/database/Write Essay/ESSAY/Write Essay Samples Batch - C1.docx"
```

Windows file-lock edge case:

- If Word has the output file open, the exporter writes `(... (new).docx)` instead.

## Step Six: Browser Smoke Checks (Recommended)

Chrome-only Playwright checks:

```powershell
node tests/browser/write-essay-samples-browser-check.js
node tests/browser/practice-modes-browser-check.js
```

## Troubleshooting

- Ollama not reachable:
  - Start it with `ollama serve`, then rerun.
- Timeouts:
  - Increase `--timeout-s` on the generator.
- `no_variant_mapping`:
  - Add the missing prompt ID under `PILOT_VARIANTS` in `scripts/generate_write_essay_samples_ollama.py` and rerun.
