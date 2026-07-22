# RFIB Cohesion Audit and Detailed Explanations Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load executing-plans to implement this plan task-by-task.

**Goal:** Audit Column I (`Cohesion Feature Details`) for all 1,128 RFIB questions and generate detailed, student-facing explanations for every blank with local `gemma4:latest` through Ollama.

**Architecture:** `scripts/enrich_rfib_cohesion.py` will read and update the workbook with `openpyxl`, validate every model response against the blank structure in `ANSWER`, and append two human-readable columns. A uniquely keyed JSONL sidecar will be the write-ahead record for recoverable checkpoints: save the sidecar atomically first, save the workbook atomically second, and reconcile either file on resume. Validation supports strict full-workbook coverage and selected-ID coverage for the ten-row quality gate.

**Tech Stack:** Python 3.14, standard-library `unittest`, `openpyxl`, `requests`, local Ollama (`gemma4:latest`).

---

## Scope and source facts

- Input: `public/database/RFIB/RFIB Final ver.xlsx`
- Worksheet: `Sheet1`
- Data rows: 1,128
- Existing columns: A–L
- `Cohesion Feature = True`: 1,010 rows
- `Cohesion Feature = False`: 118 rows
- Output columns, appended by header name rather than hard-coded position:
  - `Detailed Cohesion Explanation`
  - `Cohesion Verification`
- The new fields are database enrichment only. UI rendering and RFIB dataset mapping are outside this plan.

## Column I audit rubric

The prompt must receive the raw Column H value normalized to `TRUE` or `FALSE`.

| Status | Definition |
|---|---|
| `Correct` | Every cohesion claim in Column I is factually accurate and references the correct blank occurrence. |
| `Partially Correct` | All existing claims are accurate, but one or more blanks with genuine cohesion ties are omitted. Pure grammar or collocation blanks do not count as omissions. |
| `Incorrect` | At least one material claim is false, references the wrong blank occurrence, or asserts a cohesion tie that does not exist. |
| `No Cohesion` | Column H is `FALSE`, and Column I correctly states that none of the correct blanks demonstrates cohesion. |

ID 13 is the regression anchor: blank 1 is `all` in `all around Tokyo`; it is not the later `all` in `all of which`.

## CLI contract

```text
--input PATH          Input workbook; defaults to public/database/RFIB/RFIB Final ver.xlsx
--out PATH            Output workbook; defaults to replacing --input atomically
--sidecar PATH        Sidecar path; otherwise use the naming rules below
--test N              Curated sample selector
--ids 13,14,9         Explicit ID selector; also scopes --validate-only
--start N             Start at the Nth zero-based data row
--limit N             Maximum rows after the selected start
--no-resume           Reprocess selected rows even when workbook and sidecar agree
--reset-sidecar       Start the selected run with an empty sidecar map
--save-every N        Checkpoint interval; positive integer, default 25
--validate-only       Validate without Ollama calls
--baseline PATH       Optional original workbook for preservation comparison
--print-sample        Print the stratified human-review sample after validation
```

Selector rules:

- `--test`, `--ids`, and `--start` are mutually exclusive. `--limit` may accompany `--start` or the default full selection.
- In enrichment mode, an explicit selector that matches no rows exits `2`.
- In validation mode, `--ids` means selected-ID validation; without `--ids`, validation requires every workbook data-row ID exactly once.
- Zero attempted rows exits `0` only when every selected row was skipped because workbook and sidecar state already matched.
- Any failed enrichment or validation exits `1`.
- Retries are one loop with at most three total Ollama calls per row.

Sidecar naming rules:

- Default production input/output uses `public/database/RFIB/RFIB_cohesion_enrichment.jsonl`.
- A non-production output derives `<output-stem>.jsonl`; for example, `RFIB_cohesion_test.xlsx` uses `RFIB_cohesion_test.jsonl`.
- An explicit `--sidecar` always wins.
- The resolved sidecar path remains fixed for the run, including if the workbook switches to a locked-file fallback. The coverage report and rerun command must print both actual paths.

## `--reset-sidecar` behavior

`--reset-sidecar` deletes the entire sidecar file before starting. This makes clean test runs deterministic.

Before clearing, the script must log:
- The resolved sidecar path.
- The number of records in the existing file (or "0 / file not found").

A partial re-test that preserves unrelated records should use `--ids <selected-ids> --no-resume` instead. Atomic ID upsert will replace only those IDs while preserving others.

## Recoverable checkpoint protocol

The workbook and sidecar cannot be replaced as one filesystem transaction. Make the sidecar a write-ahead record and define recovery explicitly.

1. Load the JSONL file as raw lines, reject malformed JSON and duplicate IDs, then build `dict[int, dict]`.
2. After a model response passes validation, update both the in-memory workbook cells and the in-memory sidecar record.
3. At each checkpoint, atomically rewrite the sidecar first using `<sidecar>.tmp` and `os.replace()`.
4. Atomically save the workbook second using `<workbook>.tmp` and `os.replace()`.
5. If the workbook target is locked, save the same in-memory workbook to a timestamped fallback, keep the resolved sidecar path, and update the active workbook path for all later checkpoints.
6. Before model calls on resume, reconcile each selected row:
   - Valid matching sidecar record plus missing/invalid Excel cells: render the Excel cells from the sidecar without an LLM call.
   - Valid matching Excel cells plus missing/invalid sidecar record: **reprocess from Ollama**. Do not attempt to reconstruct structured JSON from the human-readable Excel prose — it has lost structural information and parsing it back would be fragile. Do not erase the existing Excel cells until a replacement response passes validation. Log the reconciliation reason.
   - Valid matching Excel cells and sidecar record: skip.
   - Mismatched statuses or answers: reprocess from Ollama (same safeguards as above).
7. A fallback-aware rerun command must include `--input <actual-workbook> --out <actual-workbook> --sidecar <actual-sidecar> --ids <failed-ids>`.

Sidecar-first checkpoint ordering makes Excel-ahead state exceptional — normally caused by manual sidecar deletion, file corruption, or legacy output from a prior script version.

The JSONL record shape is:

```json
{"id":13,"status":"Incorrect","notes":"...","explanations":[],"model":"gemma4:latest","timestamp":"2026-07-16T10:30:00+00:00"}
```

## `--baseline` preservation comparison

The comparison is **semantic, not byte-for-byte**. openpyxl legitimately rewrites package metadata, ZIP compression, and internal XML ordering on save.

Compare these workbook features between the baseline and the enriched output:

| Category | What to compare |
|---|---|
| **Cell values** | Every cell in columns A–L: value, data type, and formula text (if formula) |
| **Cell styles** | Font (name, size, bold, italic, color), fill (pattern, foreground/background color), border (style and color per side), alignment (horizontal, vertical, wrap, indent), number format, and protection |
| **Sheet structure** | Sheet names, order, visibility, and data row count |
| **Layout** | Column widths and row dimensions (heights) |
| **Features** | Merged cell ranges, freeze panes, and autofilter settings |

Only the two appended columns (M and N) may differ from the baseline. Changes to anything else in A–L fail the comparison.

### Preflight check for unsupported advanced features

The current workbook has no conditional formatting, data validation, tables, charts, images, defined names, or external links. Before writing any changes, the script must run a preflight check:

```python
UNSUPPORTED_FEATURES = [
    ("conditional_formatting", ws.conditional_formatting),
    ("data_validations", ws.data_validations),
    ("tables", ws.tables),
    ("images", ws._images),
    ("charts", ws._charts),
]
# Also check workbook-level: wb.defined_names, wb._external_links
```

If any unsupported feature is non-empty, **abort before writing** with a clear error message listing the detected features. This prevents silent loss of features that openpyxl does not fully round-trip.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | All attempted rows succeeded, or all selected rows were already complete |
| `1` | One or more rows failed enrichment or validation |
| `2` | Configuration error: invalid arguments, no matching rows, `--save-every 0`, etc. |

On exit `1` from enrichment, the script must print a ready-to-copy rerun command with the failed IDs.

---

## Test framework

Use `unittest` exclusively. Do not add `pytest` as a dependency.

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_enrich_rfib_cohesion.py" -v
```

All tests use temporary workbooks and mocked HTTP calls. No test may call Ollama or modify the production workbook.

---

### Task 1: Add core parsing, rubric, CLI, and response-validation tests

**Files:**
- Create: `tests/test_enrich_rfib_cohesion.py`
- Modify: `scripts/enrich_rfib_cohesion.py`

**Step 1: Write failing `unittest` cases**

Cover:

- Blank extraction returns sequential indexes and the first option as the expected answer.
- Boolean `False` becomes `FALSE`; boolean `True` becomes `TRUE`.
- The prompt includes Column H and the four-tier rubric.
- Response validation rejects an invalid status, wrong explanation count, duplicate/out-of-order indexes, wrong answer, non-string fields, and empty student explanation.
- `--save-every 0` is rejected with exit code `2`.
- Mutually exclusive selectors are rejected.
- An explicit selector matching no workbook ID exits `2`.
- The curated sample is exactly `[13, 14, 9, 15, 3, 4, 1, 2, 5, 6]`.
- Retry exhaustion makes at most three Ollama calls.

Use temporary workbooks and mocked HTTP calls; unit tests must not call Ollama or modify the production workbook.

**Step 2: Run tests and confirm failure**

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_enrich_rfib_cohesion.py" -v
```

Expected: failures for the new CLI, prompt, and validation contracts.

**Step 3: Implement the minimum core changes**

Refactor `scripts/enrich_rfib_cohesion.py` so parsing, selection, prompt construction, response validation, and argument parsing are independently testable. Do not add another dependency; `pytest` is not installed in the workspace virtual environment.

**Step 4: Run tests and confirm success**

Run the Step 2 command.

Expected: all Task 1 tests pass; no network calls occur.

**Step 5: Commit**

```powershell
git add scripts/enrich_rfib_cohesion.py tests/test_enrich_rfib_cohesion.py
git commit -m "test: define RFIB cohesion enrichment contracts"
```

---

### Task 2: Implement atomic sidecar upsert and checkpoint recovery

**Files:**
- Modify: `tests/test_enrich_rfib_cohesion.py`
- Modify: `scripts/enrich_rfib_cohesion.py`

**Step 1: Add failing recovery tests**

Cover:

- Raw duplicate sidecar IDs are detected before conversion to a dictionary.
- Atomic sidecar rewrite leaves one record per ID and replaces an older record.
- Checkpoint order is sidecar first, workbook second.
- A sidecar-ahead crash is recovered by rendering missing Excel cells without an Ollama call.
- Excel-ahead state triggers reprocessing from Ollama (not reconstruction from prose). Existing Excel cells are preserved until a replacement response passes validation. The reconciliation reason is logged.
- A locked workbook returns a fallback path and later checkpoints continue there.
- The generated rerun command includes actual input, output, sidecar, and failed IDs.
- `--reset-sidecar` logs the sidecar path and record count, then clears the entire file.

**Step 2: Run the focused recovery tests**

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_enrich_rfib_cohesion.py" -v
```

Expected: failures because atomic upsert and reconciliation are not implemented yet.

**Step 3: Implement the checkpoint coordinator**

Replace append-only JSONL writes with:

- Strict raw-line loader with duplicate detection
- In-memory ID-keyed record map
- Deterministic JSONL ordering by workbook row/ID
- Temp-file atomic rewrite
- Sidecar-first/workbook-second checkpoint function
- Resume reconciliation using the rules above (reprocess Excel-ahead, render sidecar-ahead)
- Stateful fallback workbook path

**Step 4: Run all unit tests**

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_enrich_rfib_cohesion.py" -v
```

Expected: all tests pass.

**Step 5: Commit**

```powershell
git add scripts/enrich_rfib_cohesion.py tests/test_enrich_rfib_cohesion.py
git commit -m "feat: add recoverable RFIB enrichment checkpoints"
```

---

### Task 3: Implement selected/full validation and preservation checks

**Files:**
- Modify: `tests/test_enrich_rfib_cohesion.py`
- Modify: `scripts/enrich_rfib_cohesion.py`

**Step 1: Add failing validator tests**

Cover:

- Selected validation with ten IDs passes when those ten records and Excel cells are valid even though the workbook still contains 1,128 rows.
- Selected validation fails for any missing or extra selected ID.
- Full validation fails unless the sidecar ID set exactly equals the workbook ID set.
- Validation rejects malformed JSON, duplicate IDs, invalid statuses, incorrect answers, blank-count mismatches, empty explanations, and Excel/sidecar status-prefix mismatches.
- `--baseline` semantic comparison detects changes to existing A–L values, formulas, cell styles (font, fill, border, alignment, number format, protection), sheet names/order/visibility, row count, column widths, row dimensions, merged cells, freeze panes, and autofilter state.
- `--baseline` comparison passes when only the two appended columns (M and N) differ.
- Preflight check aborts if conditional formatting, data validation, tables, charts, images, defined names, or external links are detected.
- Preflight check passes on the current workbook (none of those features present).

**Step 2: Run focused validator tests**

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_enrich_rfib_cohesion.py" -v
```

Expected: failures for selected scope, baseline comparison, and preflight check.

**Step 3: Implement validation modes**

- `--validate-only --ids ...`: expected ID set is exactly the requested IDs.
- `--validate-only` without IDs: expected ID set is every workbook data-row ID.
- Validate the JSON record and corresponding Excel row together.
- When `--baseline` is present, perform semantic comparison per the table above and allow only the two appended columns to differ.
- Run the preflight check before any write operation.
- Print per-row failures, unique failed IDs, expected/actual coverage, and exit `1` on any discrepancy.

**Step 4: Run all unit tests**

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_enrich_rfib_cohesion.py" -v
```

Expected: all tests pass.

**Step 5: Commit**

```powershell
git add scripts/enrich_rfib_cohesion.py tests/test_enrich_rfib_cohesion.py
git commit -m "feat: validate RFIB enrichment coverage and preservation"
```

---

### Task 4: Run the ten-row quality gate

**Files:**
- Create locally: `public/database/RFIB/RFIB_cohesion_test.xlsx`
- Create locally: `public/database/RFIB/RFIB_cohesion_test.jsonl`
- Read: `public/database/RFIB/RFIB Final ver.xlsx`

The test workbook remains a full 1,128-row copy. Only the ten selected rows are enriched, so deterministic validation must use selected-ID scope.

**Step 1: Run the curated enrichment**

```powershell
.\.venv\Scripts\python.exe scripts\enrich_rfib_cohesion.py `
  --test 10 `
  --out "public\database\RFIB\RFIB_cohesion_test.xlsx" `
  --sidecar "public\database\RFIB\RFIB_cohesion_test.jsonl" `
  --reset-sidecar `
  --no-resume
```

Expected: ten attempted, ten succeeded, zero failed, exit `0`; the report prints measured per-row time.

**Step 2: Run deterministic selected-ID validation**

```powershell
.\.venv\Scripts\python.exe scripts\enrich_rfib_cohesion.py `
  --validate-only `
  --input "public\database\RFIB\RFIB_cohesion_test.xlsx" `
  --sidecar "public\database\RFIB\RFIB_cohesion_test.jsonl" `
  --ids 13,14,9,15,3,4,1,2,5,6 `
  --baseline "public\database\RFIB\RFIB Final ver.xlsx"
```

Expected: exactly ten unique selected IDs pass; preservation comparison passes; exit `0`.

**Step 3: Blocking quality handoff**

**Stop execution.** Present the following to the user:

1. Test workbook and sidecar file paths.
2. Deterministic validation result (pass/fail).
3. A summary table:

   | ID | Status | Blanks | Key excerpt |
   |---|---|---|---|
   | 13 | (actual) | (actual) | First 80 chars of blank 1 explanation |
   | 14 | (actual) | (actual) | First 80 chars of blank 1 explanation |
   | 9 | (actual) | (actual) | First 80 chars of blank 1 explanation |
   | ... | ... | ... | ... |

4. Full detailed output for IDs 13 and 14 (all blanks, all fields).
5. Measured average runtime per row.

Confirm before the production run:

- ID 13 is `Incorrect` and identifies the `all around Tokyo` versus `all of which` error.
- ID 14 explains all four blanks; its status depends only on genuine cohesion claims or omissions.
- IDs 9 and 15 are `No Cohesion` but still receive per-blank selection explanations.
- IDs 3, 4, 5, and 6 have the correct number of sequential explanations.
- Explanations are clear and useful for B1–B2 learners.

**Production starts only after the user explicitly replies with approval such as "Approved—run production." Silence or partial feedback is not approval.**

---

### Task 5: Run production enrichment, recover failures, and verify completion

**Files:**
- Modify: `public/database/RFIB/RFIB Final ver.xlsx`
- Create: `public/database/RFIB/RFIB_cohesion_enrichment.jsonl`
- Create: timestamped backup reported by the script

#### Production run operational model

Launch the process as a **monitored hidden background task** with stdout/stderr redirected to timestamped logs.

Before launching, ensure:
- Excel is closed (the workbook must not be locked).
- Ollama is running with `gemma4:latest` loaded.
- Windows is configured to stay awake (no sleep/hibernate).

Record and report:
- Process PID and start time.
- Resolved workbook, sidecar, backup, and log file paths.

Monitor progress from the log file and sidecar record count rather than holding one blocking terminal call open. Checkpoint every 25 attempted rows.

If interrupted, rerun using the reported paths; reconciliation resumes safely.

**Step 1: Run the full batch after Task 4 approval**

```powershell
.\.venv\Scripts\python.exe scripts\enrich_rfib_cohesion.py
```

Expected: all 1,128 rows attempted or reconciled, periodic checkpoints every 25 attempted rows, actual output/sidecar/backup paths printed, and exit `0` only when no IDs failed.

**Step 2: Rerun any failures using the exact printed command**

Expected command shape:

```powershell
.\.venv\Scripts\python.exe scripts\enrich_rfib_cohesion.py `
  --input "<actual-workbook-path>" `
  --out "<actual-workbook-path>" `
  --sidecar "<actual-sidecar-path>" `
  --ids <comma-separated-failed-ids>
```

Expected: failed ID list becomes empty. If no failures occurred, skip this step.

**Step 3: Run strict full validation**

Use the timestamped backup path printed in Step 1:

```powershell
.\.venv\Scripts\python.exe scripts\enrich_rfib_cohesion.py `
  --validate-only `
  --input "<actual-workbook-path>" `
  --sidecar "<actual-sidecar-path>" `
  --baseline "<backup-path-from-step-1>"
```

Expected: exactly 1,128 unique workbook IDs equal exactly 1,128 unique sidecar IDs; all structural, Excel consistency, and A–L preservation checks pass; exit `0`.

**Step 4: Print and inspect the human-review sample**

```powershell
.\.venv\Scripts\python.exe scripts\enrich_rfib_cohesion.py `
  --validate-only `
  --input "<actual-workbook-path>" `
  --sidecar "<actual-sidecar-path>" `
  --print-sample
```

Expected: up to five `Incorrect`, up to five `Partially Correct`, three `Cohesion Feature = FALSE`, and three five-plus-blank records. Avoid duplicate sample IDs where possible and report when a requested stratum has fewer records.

**Step 5: Final acceptance**

Done means all of the following are true:

- Full validator exits `0`.
- Coverage is 1,128/1,128 with no duplicate or failed IDs.
- Existing A–L workbook content and formatting pass automated comparison.
- The two appended columns contain valid enrichment for every row.
- The JSONL sidecar contains exactly one validated record per RFIB ID.
- The human quality sample is approved.

Do not push or deploy; production deployment is outside this plan.
