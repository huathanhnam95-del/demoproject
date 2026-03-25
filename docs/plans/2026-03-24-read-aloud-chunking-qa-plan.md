# Read Aloud Chunking QA Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load `executing-plans` to run this plan task-by-task.

**Goal:** Verify that the new Read Aloud chunking system is correct at three levels:
- workbook/data integrity
- browser/UI behavior
- pedagogical quality of the inserted chunk boundaries

**Current State:**
- `public/database/RA/RA.xlsx` now contains `ANSWER CHUNKED` as column F
- all 1,449 rows are structurally valid under the shared validator
- chunking and linking are additive UI toggles in Read Aloud
- 12 previously auto-fallback rows were manually reviewed and re-chunked

---

## Test 1: Read Aloud UI Smoke Pass

**Purpose:** Confirm the browser correctly renders plain text, chunking, linking, and chunking+linking together with the live workbook.

**Scope:**
- default entry state
- chunking-only mode
- linking-only mode
- chunking + linking together
- unsupported-browser fallback

**Execution Steps:**
1. Launch the local app.
2. Open Read Aloud mode.
3. Confirm both guide toggles start off.
4. Toggle `Chunking` on and verify `/` and `//` appear inline.
5. Toggle `Chunking` off and `Linking sounds` on and verify linking hints render while prompt text stays readable.
6. Toggle both on and verify:
   - prompt text remains visible
   - slash markers remain visible
   - linking does not cross chunk boundaries
7. Resize to a narrow/mobile viewport and verify the linking fallback list still respects chunk boundaries.
8. Repeat one pass in unsupported-recording mode and confirm guide toggles still work visually.

**Pass Criteria:**
- no prompt disappears when linking is enabled
- no duplicate overlapping text layers appear
- chunk markers render only when chunking is on
- linking respects chunk boundaries when both guides are on
- both toggles are independent and keyboard reachable

**Suggested Commands:**
```powershell
node tests/read-aloud-mode-regression.test.js
node tests/browser/read-aloud-check.js
```

---

## Test 2: Manual Edge-Case Spot Check

**Purpose:** Review the hardest transcript rows in the actual workbook, especially the ones that previously failed auto-chunking.

**Priority IDs:**
- `710`
- `492`
- `1394`
- `576`
- `227`
- `618`
- `1184`
- `222`
- `606`
- `156`
- `1170`
- `513`

**Execution Steps:**
1. Load each target row from `ANSWER FOR COMPARE OR TRANSCRIPT` and `ANSWER CHUNKED`.
2. Confirm the wording and punctuation are identical apart from inserted `/` and `//`.
3. Read each prompt aloud and check whether the chunk boundaries sound natural.
4. Pay extra attention to:
   - smart quotes and apostrophes
   - em dashes and double-em-dash artifacts
   - odd spacing inherited from the source transcript
   - no chunk markers inserted inside quoted or dash-bound tokens
5. Record any row that feels structurally valid but pedagogically weak.

**Pass Criteria:**
- no altered wording
- no punctuation corruption
- chunk boundaries feel defensible for spoken phrasing
- manually reviewed rows are acceptable for shipping

**Artifacts:**
- append any questionable IDs to a short review note
- if needed, create a follow-up patch list for manual re-chunking

---

## Test 3: Migration Report Review

**Purpose:** Review the generated validation and drift outputs for quality signals the structural validator cannot judge on its own.

**Files:**
- `scripts/read-aloud-chunking-validation.json`
- `scripts/read-aloud-chunking-diff.json`

**Execution Steps:**
1. Confirm validation report shows zero invalid rows.
2. Inspect drift metrics against legacy `ANSWER`.
3. Review:
   - rows with high drift from legacy chunking
   - rows with zero chunk markers
   - rows with unusually dense chunking
   - rows containing dashes, quotes, abbreviations, decimals, or odd spacing
4. Spot-check a sample of high-drift rows to make sure the new chunking is actually better, not just different.

**Pass Criteria:**
- `invalidRowCount` is `0`
- no obviously broken clusters of high-drift rows
- zero-marker rows are intentionally minimal, not missed chunking
- the report does not reveal a recurring punctuation-placement pathology

**Suggested Commands:**
```powershell
node scripts/rechunk-read-aloud.js --validate-only
```

---

## Test 4: Final Regression And Release Readiness

**Purpose:** Reconfirm the surrounding Read Aloud system still works end-to-end after the workbook and renderer changes.

**Scope:**
- guide toggles
- prompt loading
- recording lifecycle guards
- assessment submission invariants
- audio-generation workbook compatibility

**Execution Steps:**
1. Run the unit and browser regressions for Read Aloud.
2. Re-run the audio workbook reader check.
3. Confirm no index-based consumer broke after adding column F.
4. Do one real manual Read Aloud attempt in the browser with:
   - chunking off
   - chunking on
   - linking on
   - both on

**Pass Criteria:**
- all Read Aloud tests pass
- assessment still uses canonical plain transcript
- audio generation still reads the clean transcript by header name
- no workbook consumer crashes on the new schema

**Suggested Commands:**
```powershell
node tests/read-aloud-prompt-grammar.test.js
node tests/read-aloud-prompt-renderer.test.js
node tests/read-aloud-linking.test.js
node tests/read-aloud-mode-regression.test.js
python scripts/generate_ra_audio.py --test
```

---

## Exit Criteria

This QA phase is complete when all four tests pass and there are no unresolved rows or browser regressions.

If all four tests pass:
- keep `ANSWER CHUNKED` as the production source for chunking
- treat the feature as ready for normal regression/commit flow

If any test fails:
- log exact row IDs or UI states
- patch the workbook or renderer
- rerun only the affected test first, then rerun Test 4
