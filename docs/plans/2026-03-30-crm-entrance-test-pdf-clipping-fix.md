# CRM Entrance Test PDF Clipping Fix Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load `@executing-plans` to implement this plan task-by-task.

**Goal:** Export the CRM entrance-test result PDF without clipping text or tables across page boundaries, while showing only the student name in the PDF header.

**Architecture:** Keep the current result renderer and cache-busted export shell, but stop using html2pdf to auto-slice one long canvas. The fix is to paginate semantic blocks into fixed PDF pages, render each page independently, and assemble the final document with the jsPDF object exposed by the html2pdf worker. That removes the last raster-slicing step that is still cutting lines in half.

**Tech Stack:** Vanilla JS, html2pdf.js, jsPDF via html2pdf worker internals, CSS, Node-based PDF inspection.

---

### Task 1: Lock the current failure in tests

**Files:**
- Modify: `tests/entrance-test-review-regressions.test.js`
- Modify: `tests/browser/crm-entrance-test-result-pdf-browser-check.js`

**Step 1: Write the failing test**
- Update the static regression so it rejects the current `html2pdf().set(opt).from(exportShell).save()` flow and requires a per-page composition path.
- Update the browser stub so it records `addPage` and `addImage` calls from the PDF object.
- Keep the 1920px viewport browser run and assert that the PDF source excludes the `Enquiry` and `Student` cards, while still showing the student name in the export header.

**Step 2: Run the tests to confirm the failure**
- Run `node tests/entrance-test-review-regressions.test.js`
- Run `node tests/browser/crm-entrance-test-result-pdf-browser-check.js`
- Expected: the tests fail until the export path is rewritten to compose PDF pages explicitly.

**Step 3: Do not implement yet**
- This task is test-only. The point is to make the current failure unmistakable before changing the exporter.

**Step 4: Re-run after implementation**
- Expected later: both tests pass once the export path switches to per-page PDF composition.

### Task 2: Replace auto-slicing with explicit PDF composition

**Files:**
- Modify: `public/crm-entrance-test-result.js`

**Step 1: Write the failing test**
- N/A. The failing coverage is already in Task 1.

**Step 2: Implement the pagination and composition layer**
- Keep `cloneResultRootForPdf()` as the starting point, but make it build logical export blocks only.
- Remove the top metadata grid from the PDF export completely; the PDF header should show only the student name.
- Expand `buildPdfBlocks()` so it creates page-friendly fragments for:
  - the score summary,
  - each section intro,
  - each question header,
  - each paragraph/transcript,
  - each table row, with the table header repeated when a table spans pages.
- Replace the current `paginatePdfBlocks()` with a real paginator that measures the visible body height of each page before appending the next block.
- Add a split path for oversized fragments:
  - split long prose by sentence or clause boundaries first,
  - split tables by rows and repeat the column headers,
  - if a fragment is still too tall, force it onto its own page instead of letting html2pdf clip it.
- Stop calling `html2pdf().set(opt).from(exportShell).save()` on the whole shell.
- Instead, render each completed `.crm-result-pdf-page` separately, then compose the final PDF with the worker's `pdf` object using `addImage()` and `addPage()`, and call `pdf.save(filename)` at the end.
- Keep the existing `window.__exportResultPdf` entrypoint and the current filename format.

**Step 3: Verify the implementation locally**
- Use the browser stub test from Task 1 to confirm the export now adds one PDF page per rendered page and no longer relies on html2pdf auto-pagination.

**Step 4: Re-run after implementation**
- Expected: the PDF is assembled page-by-page, and the clipped line breaks disappear because page boundaries now come from our paginator, not html2pdf.

### Task 3: Tighten the PDF shell styling and header content

**Files:**
- Modify: `public/crm-entrance-test-result.css`
- Modify: `public/crm-entrance-test-result.html`

**Step 1: Write the failing test**
- Covered by Task 1.

**Step 2: Update the styling contract**
- Keep `.crm-result-pdf-page` as the printable page wrapper, but use it only as a visual page shell.
- Keep the export shell in normal flow so measurement still works, but do not rely on CSS page breaks for correctness.
- Preserve the repeated page header/footer styling, but remove the `Enquiry` and `Student` card styles from the PDF export path entirely.
- Keep only the student name in the PDF subtitle area.
- Keep the existing cache-busting query strings in the HTML export page and bump them again if the JS/CSS changes require a fresh reload.

**Step 3: Verify the implementation locally**
- Re-open the result page in a fresh tab or hard-refresh so the new asset version is loaded before exporting again.

**Step 4: Re-run after implementation**
- Expected: the PDF page shells still look consistent, but the exported PDF no longer contains the removed cards or hidden width hacks.

### Task 4: Prove the fix with real exports

**Files:**
- Modify: `tests/browser/crm-entrance-test-result-pdf-browser-check.js` if the new composition needs extra probes
- No repo changes expected for the verification command itself

**Step 1: Write the failing test**
- N/A. This task is verification.

**Step 2: Run the automated checks**
- Run `node tests/entrance-test-review-regressions.test.js`
- Run `node tests/browser/crm-entrance-test-result-pdf-browser-check.js`
- Run `npm run lint:entrance-crm`
- Expected: all three pass.

**Step 3: Run a real browser export**
- Export from `https://localhost:8443/crm-entrance-test-result.html?testId=14947400dbffa3defa47121610d37d49ee5c791b00ae3d98c5a44db1420dec8b` in a `1920px` viewport.
- Inspect the downloaded PDF with a PDF parser or image render.
- Expected: no text is cut in half at the page gaps, the `Enquiry` and `Student` boxes are absent, and only the student name remains in the header.

**Step 4: Final acceptance**
- Expected: the PDF can be opened in Chrome and scrolled page-by-page without visible clipping on the previously broken `Nghe & Viết` and long-objective-question sections.

## Assumptions
- No backend/API changes are needed.
- The existing html2pdf CDN bundle stays in place; no new dependency should be added unless the worker internals prove unusable.
- A higher page count is acceptable if it eliminates clipping.
- The student name in the header is the only identity field that should remain in the PDF.
