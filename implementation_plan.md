---
ArtifactMetadata:
  RequestFeedback: true
  Route: Heavy
  PackageId: BOOKTXT-FIX-01
  Status: Awaiting approval
---

# CRM Books Text Accuracy Recovery Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Load `executing-plans`, `test-driven-development`, and `verification-before-completion` before implementation. Use the Heavy-route specialist sequence and preserve unrelated dirty work.

**Goal:** Replace the unreliable embedded-PDF-text path with a revisioned, image-OCR-backed Books text pipeline, repair the affected 211-page book without mixed revisions, and verify every rendered page against an approved source-grounded text manifest.

**Architecture:** Build every extraction as an immutable text revision containing the source identity, pinned OCR provenance, pages, chunks, embeddings, sections, and generated summaries. Submit and poll Document AI OCR as fenced asynchronous job states, with native PDF parsing explicitly disabled so the known-corrupt embedded text layer is not reused. Verify the candidate before one Firestore transaction advances `activeTextRevisionId`; all readers resolve that pointer, so promotion and rollback cannot expose mixed page/chunk/summary state.

**Tech stack:** Node.js 22 Firebase Functions, Firestore, Cloud Storage, `unpdf` diagnostics, Google Cloud Enterprise Document OCR batch processing, Playwright/Chrome, deterministic Node test fixtures.

---

## Confirmed root cause and current evidence

- The source PDF raster is correct, but its invisible embedded text layer is corrupt. `functions/src/crm/book-pdf-extractor.js:7-21` accepts it because it checks only average characters per page; this file reports `1657` characters/page and passes.
- `functions/src/crm/book-ingest-service.js:135-158` writes the `unpdf` strings directly to `crm-books/<bookId>/pages.json`; `functions/src/routes/admin/books.js:925-953` returns them unchanged.
- `public/js/crm/books-workspace.js:199-202` always applies the production dictionary segmenter. It amplifies `Specias` to `Spec ias` and `IIMIWIN` to `IIMIW IN`; it does not create the upstream glyph errors.
- Fresh production proof for book `if1GtQHgGoU7uolTPVXC`: source PDF SHA-256 `2618f0ffc604680f2990af25f4055ea1920674b955cfc11bca11fb80165229ab`; 211 pages; 273 current chunks; Storage `pages.json` exactly matches the authenticated Pages API.
- The problem is systemic: 197/211 stored pages have less than 1% spaces; 206/211 contain alphabetic runs of at least 20 characters. Page 6 visibly says `A Neglected Species`, while stored/API text says `ANeglectedSpecias`. Page 7 contains no visible `IIMIWIN`, `itt`, or leading `j`, but those tokens are in the embedded/stored text.
- Existing Books unit and Playwright suites pass because they verify mechanics, formatting, navigation, and layout—not source-raster fidelity. The primary browser fixture also omits `books-word-segmenter.js`.
- Current dirty Books changes implement an unrelated Elaborate feature. They do not change the extraction, Pages API, or page-rendering pipeline and must be preserved.

## Non-negotiable design decisions

1. PDF bytes and rendered page raster are authoritative. Embedded `unpdf` text is diagnostic input only, never the sole accuracy oracle.
2. Use a pinned Enterprise Document OCR processor with `enableNativePdfParsing: false`, English hints, image-quality scores, and word/layout confidence. Persist processor resource, region, version, request options, operation name, and output hashes.
3. OCR confidence and image-quality scores route pages to review; they never prove correctness.
4. Candidate data is immutable and revision-scoped. Do not overwrite canonical pages, chunks, sections, embeddings, or summaries before verification.
5. Activation and rollback each update one active-revision pointer transactionally. No in-place rebuild may expose new Pages text with old retrieval data, or vice versa.
6. OCR-v2 text preserves OCR spacing. The client segmenter remains only for explicitly marked legacy revisions.
7. “Full verification” means all 211 physical pages are source-reviewed and all 211 browser-rendered page texts are compared with that approved manifest. Sampling or confidence thresholds alone do not satisfy this.
8. No push, API enablement, processor creation, production mutation, deployment, or revision activation occurs without later explicit approval.

## Task 1: Lock a reproducible corruption fixture and accuracy metrics

**Files:**
- Create: `tests/crm/fixtures/build-corrupt-text-layer-pdf.js`
- Create: `tests/fixtures/crm-books/corrupt-text-layer.expected.json`
- Create: `tests/crm/book-text-quality.test.js`
- Modify: `tests/crm/book-pdf-extractor.test.js`

**Steps:**

1. Generate a small test PDF whose visible raster contains the correct page-6/page-7 phrases while its invisible text layer contains representative corrupt strings. Do not commit the copyrighted 211-page source PDF.
2. Write failing assertions that the current character-volume gate incorrectly accepts the fixture and the current segmenter changes corruption rather than recovering source truth.
3. Implement diagnostic metrics: physical page count, blank handling, whitespace ratio, longest alphabetic run, suspicious tokens, line-dehyphenation-tolerant CER/WER, and embedded-vs-OCR disagreement. Do not auto-correct words.
4. Run `node tests/crm/book-text-quality.test.js` and `node tests/crm/book-pdf-extractor.test.js`. Expected after implementation: both pass and the corrupt fixture is never accepted as source-accurate native text.

## Task 2: Add the pinned Document AI OCR adapter

**Files:**
- Create: `functions/src/crm/book-document-ocr-service.js`
- Create: `tests/crm/book-document-ocr-service.test.js`
- Modify: `functions/package.json`
- Modify: `functions/package-lock.json`

**Steps:**

1. Add `@google-cloud/documentai` as an explicit Functions dependency.
2. Require `CRM_BOOKS_DOCUMENT_AI_PROCESSOR`, `CRM_BOOKS_DOCUMENT_AI_LOCATION`, and an approved processor-version resource; fail closed if missing. Recommended candidate: stable Enterprise Document OCR `pretrained-ocr-v2.1-2024-08-07`, subject to processor availability and data-residency approval.
3. Submit `batchProcessDocuments` from the private Storage source. Set `enableNativePdfParsing: false`, `enableImageQualityScores: true`, and `languageHints: ['en']`; write output to a private revision prefix.
4. Parse all output shards in numeric page order. Reconstruct page text from UTF-8 text anchors and retain physical page number, word boxes/confidence, quality scores, output hashes, and explicit missing-value semantics.
5. Test shard ordering, multi-byte anchors, missing confidence, blank pages, duplicate output, processor errors, wrong source generation, and page-count mismatch.
6. Run `node tests/crm/book-document-ocr-service.test.js`. Expected: all adapter/parser cases pass without a live billable request.

## Task 3: Build a fenced OCR long-running-operation state machine

**Files:**
- Create: `functions/src/crm/book-text-revision-service.js`
- Create: `tests/crm/book-text-revision-service.test.js`
- Modify: `functions/src/crm/book-ingest-service.js`
- Modify: `functions/src/index.js`

**Steps:**

1. Add durable stages `ocr_submit`, `ocr_wait`, `ocr_parse`, `candidate_chunk`, `candidate_embed`, `candidate_summarize`, `candidate_verify`, and `ready_for_activation`.
2. Persist revision ID, source SHA/generation, worker fence, operation name, output prefix, submit attempt, polling time, processor identity, and error before releasing the lease.
3. Submit exactly once per fenced revision. Scheduled invocations poll the stored operation rather than waiting past the seven-minute worker deadline or resubmitting.
4. Reject stale completion when the source generation, fence, or processor differs. Separate bounded transient retries from permanent schema/page-count failures.
5. Enforce server-side PDF MIME, exact source generation, 100 MB application limit, 500-page processor limit, per-book concurrency, monthly budget, and quota checks before submit.
6. Test duplicate workers, lease expiry, stale completion, source replacement, timeout, retry exhaustion, and restart/resume.
7. Run `node tests/crm/book-text-revision-service.test.js`. Expected: one OCR submit per revision and no stale worker can publish.

## Task 4: Make all generated Books data revision-scoped

**Files:**
- Modify: `functions/src/crm/book-ingest-service.js`
- Modify: `functions/src/crm/book-chunker.js`
- Modify: `functions/src/crm/book-embeddings.js`
- Modify: `functions/src/crm/book-summary-service.js`
- Modify: `functions/src/crm/book-retrieval.js`
- Modify: `functions/src/crm/book-chat-service.js`
- Create: `tests/crm/book-text-revision-integration.test.js`

**Contract:**

- Storage: `crm-books/<bookId>/text-revisions/<revisionId>/pages.json` plus private temporary OCR output beneath the revision prefix.
- Firestore: `crmBooks/<bookId>/textRevisions/<revisionId>` with revision-scoped chunks, sections, embeddings, and generated summaries.
- Active pointer: `crmBooks/<bookId>.activeTextRevisionId`; books without it use the legacy path until migrated.

**Steps:**

1. Store a versioned `pages.json` with compatible string `pages[]`, schema version, renderer contract, source identity, OCR provenance, per-page diagnostics, and verification-manifest hash.
2. Build chunks, vectors, sections, and summaries only under the candidate revision. Record `textRevisionId` on every generated citation and retrieval result.
3. Preserve user-authored notes/mind maps. Mark old generated summaries/study notes historical or stale rather than silently rebinding them.
4. Resolve Pages, retrieval, summaries, and new chats through the same active pointer. Label records without a revision ID as legacy.
5. Test a candidate with fewer chunks/sections and prove no old tail record is returned; test activation failure and rollback.
6. Run `node tests/crm/book-text-revision-integration.test.js`. Expected: every read surface resolves one revision only.

## Task 5: Add audited reprocess, verify, activate, and rollback APIs

**Files:**
- Modify: `functions/src/routes/admin/books.js`
- Modify: `tests/crm/books-routes.test.js`
- Create: `tests/crm/books-text-revision-routes.test.js`

**Steps:**

1. Add admin-only `POST /books/:bookId/text-revisions` with `expectedSourceSha256`, `expectedSourceGeneration`, `reason`, and repair mode. Keep it separate from normal ingestion, which rejects ready books with `ALREADY_READY`.
2. Add read-only revision/status endpoints and an activation endpoint requiring expected current revision, candidate revision, source identity, completed verification, and manifest hash.
3. Make rollback an audited activation of a retained prior revision, not a destructive rewrite.
4. Record requester, verifier, activator, and rollback actor. Never return temporary OCR URLs to the browser.
5. Test admin guards, idempotency, stale revision, unverified activation, source mismatch, duplicate request, and rollback.
6. Run `node tests/crm/books-routes.test.js && node tests/crm/books-text-revision-routes.test.js`.

## Task 6: Make Pages API, cache, and renderer revision-aware

**Files:**
- Modify: `functions/src/routes/admin/books.js`
- Modify: `public/js/crm/books-workspace.js`
- Modify: `tests/crm/books-workspace.test.js`
- Modify: `tests/browser/crm-books-ui-browser-check.js`
- Create: `tests/browser/crm-books-text-revision-browser-check.js`

**Steps:**

1. Return text revision, schema version, renderer contract, source hash, total pages, and pages.
2. Key server cache by book plus active revision and invalidate after activation. Key client `pagesData` by revision and refresh on pointer change.
3. Pass renderer contract to formatting. Run `repairMissingSpaces` only for legacy collapsed-space data; preserve OCR-v2 spacing except safe reflow/escaping.
4. Load the real production segmenter in the browser fixture. Prove legacy behavior remains isolated and OCR-v2 rare words are not split.
5. Test an open reader across revision swap, physical page preservation, citation navigation, cache refresh, and absence of stale DOM text.
6. Run `node tests/crm/books-workspace.test.js && node tests/browser/crm-books-ui-browser-check.js && node tests/browser/crm-books-text-revision-browser-check.js`.

## Task 7: Create the 211-page verification and correction package

**Files:**
- Create: `scripts/crm/audit-book-text-revision.js`
- Create: `tests/crm/book-text-audit.test.js`
- Runtime only: `test-results/crm-books-text/<bookId>/<revisionId>/`

**Steps:**

1. Generate a private side-by-side package per physical page: source raster, candidate text, embedded text, OCR boxes/confidence, quality signals, CER/WER disagreement, source-image hash, and revision hash.
2. Produce an immutable manifest with exactly one entry per page. Passing states are `accepted` or `corrected`; confidence-only, waived, or unreviewed pages fail.
3. Corrections record before/after text, reviewer, time, reason, source-image hash, and resulting page hash. Spellcheck/LLM suggestions cannot approve or silently rewrite text.
4. Require all 211 pages accepted/corrected. Require exact regressions: `Species`; no bogus `IIMIWIN`, `itt Training`, `ASTD isa`, or `jof ASTD`; correct physical mapping.
5. Any correction invalidates and rebuilds candidate chunks, sections, embeddings, and summaries from the approved text.
6. Run `node tests/crm/book-text-audit.test.js`. Missing pages, stale hashes, or stale derived artifacts must fail closed.

## Task 8: Independent local verification and Heavy-route review loop

1. `coder` implements in an isolated worktree and runs focused red/green checks.
2. `reviewer` examines the actual diff for revision consistency, LRO fencing, IAM/budget, historical semantics, cache behavior, and rollback.
3. The same `coder` repairs valid findings and reruns checks.
4. `tester` independently runs new tests, `npm run lint:crm`, `npm run verify:crm`, failure injection, and `git diff --check`.
5. Playwright Chrome verifies the local Books reader and emits DOM/network/console/screenshots.
6. `browser_debugger` performs the second-step confirmation after the ChatGPT Browser extension/native host is restored.

**Acceptance:** all focused/broader checks pass; no assertions are weakened; no unexpected files change; unrelated dirty Elaborate work remains intact.

## Task 9: Candidate production repair and full live verification (separate approval)

**Prerequisites:** approved processor/region/version, API/billing approval, least-privilege identity, private OCR-output lifecycle, clean allowlisted worktree, and explicit deploy/data authorization.

1. Record current Hosting/Functions revisions, source/pages generations/hashes, legacy active state, and rollback pointer.
2. Deploy verified code only after separate approval. Deployment does not activate a revision.
3. Queue one candidate for `if1GtQHgGoU7uolTPVXC` against the exact source SHA/generation; prove exactly one OCR operation and no active-reader change.
4. Complete the 211/211 review package; Terra audits the manifest/hash chain and derived-artifact consistency.
5. Activate the candidate pointer only after separate explicit activation approval.
6. Authenticated Playwright iterates all 211 Pages DOM surfaces and compares normalized rendered text to the approved manifest. It also verifies API revision/hash, retrieval/chunk uniformity, summary revision, citations, network, and console.
7. Recheck pages 6–7 with screenshots. After browser tooling repair, obtain browser-agent screenshot/DOM/network/console confirmation.
8. Roll back by pointer immediately if any hash, page count, DOM text, retrieval revision, citation, summary, log, or browser result differs.

## Release acceptance gates

- Source identity remains SHA-256 `2618f0ffc604680f2990af25f4055ea1920674b955cfc11bca11fb80165229ab` unless separately replaced.
- Candidate has exactly 211 pages and a 211-entry manifest; every entry is accepted or corrected against its exact source-image hash.
- Golden fixture reaches exact expected text (CER 0/WER 0 after documented normalization). Whole-book confidence/CER/WER remain diagnostics, not substitutes for review.
- Active Pages, chunks, embeddings, sections, summaries, retrieval, and new citations share the same `textRevisionId` and candidate hash.
- Production API and all 211 DOM texts match the approved manifest; OCR-v2 pages receive no legacy segmenter mutation.
- Known bad strings/rendered variants are absent where the source does not contain them.
- Prior revision remains retained and pointer rollback is tested.
- Local verification, deployment, candidate creation, activation, and live verification are reported as separate states.

## Security, cost, and retention controls

- Dedicated service identity: Document AI batch permission plus read/write only on exact source/revision prefixes.
- OCR output remains private and lifecycle-deleted only after accepted immutable artifacts/hashes exist.
- Enforce MIME, object generation/hash, size, page count, concurrency, quota, and monthly budget server-side.
- Record billable pages and operation identity; check current official pricing/allowances at implementation time rather than assuming 211 pages are free.
- Never copy credentials, OCR output, or source-book content into tracked logs/fixtures.

## Approval decisions

1. Approve Enterprise Document OCR plus immutable revision architecture.
2. Approve processor region/version after residency/availability check.
3. Approve one named primary reviewer plus independent Terra/hash-chain audit for the 211-page manifest.
4. Confirm legacy generated chats/summaries remain viewable under their old revision while new artifacts use the active revision; preserve user-authored notes/mind maps.
5. Implementation approval does not authorize API enablement, paid OCR, push, deployment, production reprocessing, or activation; each is a separate gate.

Prepared: Tuesday, September 1, 2026, 06:58:07 PM Vietnam Time

---

<details>
<summary>Archived prior implementation plan: V3 vowel-measurement correction</summary>

# V3 Vowel-Measurement Correction Plan

## Review Findings

- The truncation diagnosis is valid, but the current patch also changes raw V3 syllable spans from gapped CTC coverage into contiguous partitions in `backend/phoneme_service/stress_alignment.py`. That silently changes UI and saved-comparison semantics.
- The changed test only verifies that syllable boundaries touch. It does not test vowel-nucleus extension, acoustic features, odd/even gaps, or contract compatibility.
- Focused evidence: 60 Python tests pass. On the local `photograph` recording, the patch expands the first nucleus from 20 ms to 121 ms and the second from 20 ms to 81 ms, changing the expected-stress duration margin from approximately 0 to 40 ms. This supports correcting measurement spans, but not redefining raw spans.
- The current production verifier artifact is count-only with stress scoring disabled. Validation must report acoustic-feature improvements without claiming a new learner stress verdict.

## Implementation Changes

- Preserve existing `start_*`/`end_*` syllable fields and `nucleus_*` fields as raw, half-open CTC token-coverage intervals.
- Replace `_close_ctc_gaps` with a non-mutating derivation that adds `measurement_start_*` and `measurement_end_*` fields:
  - Split each inter-syllable gap at `start + ceil(gap / 2)`.
  - Extend a preceding measurement nucleus only when its raw nucleus ends at the syllable edge.
  - Extend a following measurement nucleus only when its raw nucleus begins at the syllable edge.
  - Never allocate leading/trailing silence, change confidence, overlap measurements, or modify non-edge nuclei.
- Make acoustic extraction prefer `measurement_*`, then raw `nucleus_*`, then raw syllable spans.
- Add recognizer metadata:
  - `span_contract_version: "ctc-alignment-v2"`
  - `frame_interval: "half-open"`
  - `syllable_span_type: "ctc-token-coverage"`
  - `nucleus_span_type: "ctc-vowel-token-coverage"`
  - `measurement_span_type: "ctc-blank-midpoint-v1"`
- Propagate raw nucleus and measurement times through the V3 response. Keep UI boundary overlays on raw `startTime`/`endTime`; label them “CTC token coverage.”
- Persist the contract metadata with new comparison records. Treat records without it as legacy/unknown; do not rewrite historical records.

## Test and Acceptance Plan

- Add deterministic unit cases for zero, one, odd, and even blank gaps; open/open, open/onset, vowel-initial, and closed-syllable controls; multiple syllables; time conversion; bounds; and non-overlap.
- Assert raw spans and confidence remain unchanged while only eligible measurement fields change.
- Add downstream tests proving `aligned_acoustic_features` uses measurement spans and that the V3 adapter/UI preserves raw display boundaries.
- Pin the `photograph` regression to the current model revision:
  - Raw syllable frames remain `32–37`, `47–50`, and `56–73`.
  - Measurement nuclei become `36–42`, `49–53`, and unchanged `60–61`.
- Create a 12-recording vowel-nucleus benchmark with explicit `vowel-nucleus-acoustic` annotations: six open-syllable targets, three vowel-initial boundaries, and three closed/non-edge controls. Existing manifests with `verifiedSpans: null` are not ground truth.
- Acceptance gates:
  - Median nucleus-boundary error no worse than two model frames and p90 no worse than four frames.
  - Open-syllable median error improves by at least one frame over raw CTC coverage.
  - Control nuclei and all raw display spans remain unchanged.
  - No invalid, overlapping, zero-duration, or out-of-audio spans.
  - Focused Python tests, pronunciation logic tests, release-contract tests, and the Chrome Playwright comparison flow pass.

## Candidate Release and Promotion

- Release only from a clean, allowlisted worktree so unrelated current changes remain untouched.
- Build the phoneme-recognizer image, record Git SHA and immutable digest, then deploy it at 0% traffic using `scripts/release/pronunciation-v3.ps1`.
- Smoke-test the private candidate `/readyz` and `/recognize/v2` endpoints with an identity token whose audience is the base service URL. Run the fixed regression and 12-record benchmark against that exact revision.
- Exercise the candidate payload in the local Chrome Playwright admin comparison flow using `C:\Cursor AI\.local\browser-test-credentials.md`, verifying raw gapped overlays, explicit measurement provenance, screenshots, and console output.
- Stop for explicit approval before routing production traffic. After promotion, repeat the Chrome production flow and obtain browser-agent screenshot/console confirmation.
- Roll back immediately to the configured explicit recognizer revision if response contracts, benchmark gates, logs, or live UI evidence differ. Update declared current/rollback revisions only after successful live verification.

## Assumptions

- No production deployment or traffic promotion occurs without separate explicit authorization.
- Stress scoring remains disabled; retraining or enabling a stress model is a later task after the corrected measurement corpus is available.
- No historical comparison backfill is included.

Prepared: Sunday, August 9, 2026, 03:10:14 PM

</details>
