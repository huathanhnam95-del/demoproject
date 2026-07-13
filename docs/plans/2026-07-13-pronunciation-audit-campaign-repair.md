# Pronunciation Audit Campaign Repair Implementation Plan

> **For Antigravity:** REQUIRED SUB-SKILL: Load `executing-plans`, `systematic-debugging`, `test-driven-development`, and `verification-before-completion` to implement this plan task-by-task.

**Goal:** Repair the pronunciation audit campaign so that it refuses stale or unidentified targets, produces exactly one terminal result per manifest word, proves every cumulative gate from complete provenance, and supports a trustworthy 3,000-word candidate audit followed by a smaller production smoke.

**Architecture:** Keep the existing audit CLI as the operator entry point, but move campaign identity, manifest validation, transactional resume state, deterministic export, and aggregation into a testable Python module. Use a small SQLite state database from the Python standard library for atomic claims and unique terminal results; generate canonical JSON/JSONL evidence from that state instead of appending directly from worker threads. Require a successful versioned `/health` preflight before any word request, verify TLS by default, and permit `verify=False` only behind an explicit loopback-only flag.

**Tech Stack:** Python 3.10, `requests`, `sqlite3`, `unittest`, Flask fixture servers, PowerShell/npm operator commands, GitHub Actions, Cloud Run, Playwright Chrome.

---

## 1. Review baseline and confirmed defects

This plan treats the current campaign as failed evidence, not as an accepted accuracy run.

### Machine-evidence contradictions

- `test-results/pronunciation-audit-3000/report-1000.json`, `report-2000.json`, and `report-3000.json` all contain `gates.passed: false`.
- `incorrectScoreable` is respectively 1,000, 2,000, and 3,000.
- The 3,000-word report contains 5,047 source-dialect violations and 5,047 non-US-label violations.
- All reports identify the target deployment and algorithm as `unknown`.
- Cohort rows came from `pronunciation-reference-v2` with `deploymentVersion: local-development`, not the required v3 candidate contract.
- The base URL was `https://127.0.0.1:8081`; the run was not a candidate-deployment audit despite the walkthrough calling it production-scale verification.
- The ledger has 6,001 events: 3,001 `in_progress` and 3,000 `terminal_failure` events. `loop` was claimed twice.
- No manual-review decision artifact exists for the required 50 rows and 20 native-audio checks per cohort.

### Implementation defects

- A failed or missing `/health` response silently becomes `unknown`, and execution continues.
- Campaign identity excludes normalized base URL, schema version, and analysis version.
- `unknown` versions are accepted as a resumable identity, so unrelated or repaired targets can incorrectly reuse failed rows.
- Direct JSONL appends are not atomic with ledger state. A crash between row append and terminal ledger append can duplicate results.
- The directory lock can wait forever after a stale lock and does not handle the Windows access-denied failure observed during the campaign.
- Worker exceptions are printed, but `run_cohort_audit()` still returns exit code 0.
- Aggregation checks row count but not the exact expected word set for each cohort.
- Aggregation accepts missing/unknown provenance, multiple base URLs, missing schema/analysis versions, and rows without manifest/cohort identity.
- `split_into_cohorts()` silently drops remainder words for non-divisible manifest sizes.
- The committed npm cohort commands depend on `PRONUNCIATION_AUDIT_BASE_URL`, but committed CLI parsing does not read that environment variable.
- The uncommitted workaround globally disables TLS verification and suppresses `InsecureRequestWarning` for every target.
- The CI workflow runs the new Python test without installing `requests`; the suite fails in a clean virtual environment.
- The seven passing tests do not execute the campaign CLI, do not serve `/health`, do not assert request counts on resume, do not test worker failures, and do not test 1K/2K/3K exact cohort membership.
- The Markdown summary omits the overall failed state and provenance, allowing a failed campaign to look successful.

### Fixed user decisions

- Preserve the current artifacts under an explicitly failed/quarantined path.
- Run the replacement 3,000-word campaign against a no-traffic v3 candidate.
- After authorized promotion, run a smaller production confirmation rather than repeating all 3,000 words.
- Verify TLS by default. Allow self-signed HTTPS only with an explicit flag and only for loopback hosts.

## 2. Corrected public invariants

### Target preflight

No dictionary or analysis request may run until `/health` returns HTTP 200 and all of these fields are known and supported:

```json
{
  "schemaVersion": 9,
  "algorithmVersion": "pronunciation-reference-v3",
  "analysisVersion": "pronunciation-analysis-v2",
  "deploymentVersion": "<non-empty-git-sha>"
}
```

The operator must pass `--expected-deployment-version <sha>`. A mismatch, missing field, invalid JSON response, unreachable health endpoint, or unsupported version exits nonzero before the first audited word.

### TLS policy

- HTTPS certificate verification is on by default for health, dictionary, analysis, proxy-audio, and native-audio requests.
- `--insecure-localhost` may set `verify=False` only when the parsed hostname is `localhost`, `127.0.0.1`, or `::1`.
- Passing `--insecure-localhost` for any non-loopback target is a usage error.
- Do not call `urllib3.disable_warnings()` globally.
- Store `tlsVerification: "verified"` or `"insecure-loopback-explicit"` in campaign provenance.

### Manifest v2

The replacement manifest contains:

```json
{
  "manifestVersion": 2,
  "seed": 20260712,
  "requestedSize": 3000,
  "normalization": "casefold-trim-alpha-a-z",
  "samplingFrame": {
    "oxfordPath": "The_Oxford_5000.csv",
    "oxfordSha256": "...",
    "cmuPath": "public/cmudict.json",
    "cmuSha256": "...",
    "eligibleCount": 0
  },
  "words": [],
  "manifestHash": "..."
}
```

`manifestHash` is SHA-256 over canonical UTF-8 JSON containing every field except `manifestHash` and non-deterministic timestamps. Campaign mode requires exactly 3,000 unique eligible words and three exact slices of 1,000.

### Campaign identity

The campaign ID is SHA-256 over normalized:

```text
manifestHash|baseUrl|deploymentVersion|schemaVersion|algorithmVersion|analysisVersion|tlsVerification
```

No component may be missing or `unknown`.

### Exactly-once evidence

- SQLite is the resume source of truth; worker threads do not append directly to JSONL files.
- The database has a unique key on `(campaign_id, cohort, word)`.
- A word may have multiple attempt events only after an interrupted `in_progress` claim is explicitly reclaimed.
- A campaign identity has exactly one current terminal result per word.
- Cohort JSONL is regenerated atomically in manifest order from terminal database rows.
- Internal HTTP retries remain allowed, but they cannot create multiple terminal rows.
- A changed deployment/schema/algorithm/analysis version creates a new campaign identity. Cumulative reports never mix identities.
- If a candidate changes after any cohort, reuse the immutable manifest but start a new campaign output directory and rerun from Cohort 1.

### Command exits

- `0`: requested operation completed and all applicable gates passed.
- `1`: complete evidence exists but one or more audit gates failed.
- `2`: invalid CLI usage or unsupported option combination.
- `3`: target preflight/provenance failure; zero word requests made.
- `4`: incomplete cohort caused by worker, state, export, or infrastructure failure.

## 3. Target artifact layout

```text
test-results/
├── pronunciation-audit-failed/
│   └── 2026-07-12-local-v2-unknown/
│       ├── FAILURE.md
│       └── <preserved current artifacts>
└── pronunciation-audit-3000/
    ├── manifest-3000-seed-20260712.json
    ├── campaign-metadata.json
    ├── ledger.jsonl
    ├── cohort-1-rows.jsonl
    ├── cohort-2-rows.jsonl
    ├── cohort-3-rows.jsonl
    ├── report-1000.json
    ├── report-2000.json
    ├── report-3000.json
    ├── review-queue-1000.json
    ├── review-queue-2000.json
    ├── review-queue-3000.json
    ├── manual-review-cohort-1.jsonl
    ├── manual-review-cohort-2.jsonl
    ├── manual-review-cohort-3.jsonl
    └── summary.md
```

The uncommitted SQLite file lives at `test-results/pronunciation-audit-3000/.state/campaign.sqlite3` and is ignored by Git. Committed JSON/JSONL artifacts are deterministic exports.

---

## 4. Implementation tasks

### Execution waves and dependencies

Treat this document as the master specification. Execute it in five bounded waves, with a fresh verification checkpoint and review of the produced artifacts after each wave:

| Wave | Tasks | Depends on | Checkpoint |
|---|---|---|---|
| A — Evidence and target safety | 1–3 | None | Failed run quarantined; unsupported or unknown targets make zero word requests |
| B — Deterministic data and execution | 4–6 | Wave A | Manifest v2, transactional state, crash-safe resume, and failure-aware CLI pass |
| C — Reporting and operations | 7–9 | Wave B | Strict 1K/2K/3K aggregation and passing/failing mock campaigns verified |
| D — Candidate campaign | 10–12 | Wave C | No-traffic v3 candidate passes 100-word smoke, full 3K gates, and manual review |
| E — Production confirmation | 13–14 | Wave D plus explicit production authorization | Exact audited revision promoted, production smoke passes, narrative matches evidence |

Do not begin a later wave while an earlier checkpoint has unresolved failures. Any candidate identity change during Wave D invalidates its campaign state and returns execution to Task 11, Cohort 1.

### Task 1: Isolate the repair and quarantine the invalid campaign

**Files:**

- Move: `test-results/pronunciation-audit-3000/` to `test-results/pronunciation-audit-failed/2026-07-12-local-v2-unknown/`
- Create: `test-results/pronunciation-audit-failed/2026-07-12-local-v2-unknown/FAILURE.md`
- Modify: `.gitignore`
- Preserve without editing: unrelated dirty Read Aloud datasets, Firebase cache, PowerPoint/Excel temporary files, and tracked bytecode in `C:\Cursor AI`

**Step 1: Create an isolated worktree**

First stage and commit only this plan file, or copy only this plan file into the new worktree as its first scoped documentation commit. Then create `codex/pronunciation-audit-campaign-repair` from local campaign commit `c0c0c764` plus that plan commit, not from stale `origin/main`. Do not copy unrelated dirty-worktree changes.

Expected: the new worktree contains the five local campaign commits and this plan, while `git status --short` is clean before implementation begins.

**Step 2: Record why the current artifacts failed**

`FAILURE.md` must include:

- all three `gates.passed: false` results;
- `incorrectScoreable` counts 1,000/2,000/3,000;
- v2/local-development target identity;
- unknown health provenance;
- duplicate `loop` claim;
- missing manual review;
- a statement that the artifacts are forensic evidence and must not support an accuracy claim.

**Step 3: Move the artifacts safely**

Verify both resolved paths remain inside the repair worktree before using `git mv`.

**Step 4: Ignore only transient campaign state**

Add:

```gitignore
test-results/pronunciation-audit-3000/.state/
```

Do not ignore final reports, cohort exports, manual-review evidence, or failed-run evidence.

**Step 5: Commit**

```text
docs: quarantine invalid pronunciation audit campaign
```

### Task 2: Freeze failing tests for target preflight and secure TLS

**Files:**

- Modify: `backend/test_pronunciation_audit.py`
- Create: `backend/test_pronunciation_audit_campaign.py`
- Create: `tests/fixtures/pronunciation-reference/audit-health-v3.json`
- Modify later: `scripts/audit/pronunciation-reference-audit.py`

**Step 1: Extend the fixture server**

Add `/health`, `/dictionary/v2/<word>`, and `/analyze-url/v2`. Count requests by route and word so tests can prove preflight happens before all word requests.

**Step 2: Write RED tests**

Cover:

- valid v3 health plus exact expected deployment;
- health HTTP failure;
- invalid JSON;
- missing deployment/schema/algorithm/analysis fields;
- v2 algorithm rejection;
- expected deployment mismatch;
- zero dictionary requests after any preflight failure;
- TLS verification defaults to true for every request boundary;
- `--insecure-localhost` works only for the three loopback host forms;
- the insecure flag is rejected for candidate and production hostnames;
- environment-variable base URL is read by committed code;
- conflicting `--base-url` and environment values are resolved deterministically, with the explicit CLI value winning.

**Step 3: Run RED**

```powershell
python -m unittest backend.test_pronunciation_audit_campaign.PronunciationAuditPreflightTest -v
```

Expected: failures because strict preflight and scoped TLS policy do not exist.

**Step 4: Commit tests**

```text
test: define pronunciation audit preflight contract
```

### Task 3: Implement strict preflight and loopback-only insecure TLS

**Files:**

- Modify: `scripts/audit/pronunciation-reference-audit.py`
- Modify: `backend/test_pronunciation_audit_campaign.py`

**Step 1: Remove the unsafe working-tree workaround**

Delete global warning suppression and all unconditional `verify=False` defaults.

**Step 2: Add a request policy**

Create a small immutable configuration carrying normalized base URL, TLS verification setting, and timeouts. Route `get_health_info()`, `request_json()`, and native-audio downloads through the same policy.

**Step 3: Validate the insecure flag**

Parse with `urllib.parse.urlsplit()` and `ipaddress`. Reject non-loopback hosts before making a request.

**Step 4: Require supported health data**

Replace the silent `{}` fallback with a typed preflight error and exit code 3. Validate exact schema/algorithm/analysis versions and expected deployment.

**Step 5: Run GREEN**

Run the focused tests from Task 2. Expected: all pass and request counters remain zero in every rejected-target case.

**Step 6: Commit**

```text
fix: fail closed on pronunciation audit target identity
```

### Task 4: Upgrade manifest and cohort contracts

**Files:**

- Create: `scripts/audit/pronunciation_audit_campaign.py`
- Modify: `scripts/audit/pronunciation-reference-audit.py`
- Modify: `backend/test_pronunciation_audit.py`
- Create: `tests/fixtures/pronunciation-reference/audit-manifest-small-v2.json`

**Step 1: Write RED tests**

Assert:

- canonical manifest hashing includes seed, normalization, sampling-frame hashes, eligible count, requested size, and ordered words;
- changed Oxford/CMU source bytes change the manifest hash;
- changed word order changes the hash;
- duplicate, uppercase, nonalphabetic, ineligible, missing, or extra words are rejected;
- campaign mode rejects any size other than 3,000;
- generic splitting rejects a remainder instead of dropping words;
- the three production cohorts are exactly manifest indices `0..999`, `1000..1999`, and `2000..2999`.

**Step 2: Run RED**

```powershell
python -m unittest backend.test_pronunciation_audit.PronunciationAuditManifestV2Test -v
```

Expected: failures because manifest v1 contains only seed/hash/words.

**Step 3: Implement pure manifest helpers**

Move hashing, sampling-frame normalization, manifest validation, and cohort slicing to `pronunciation_audit_campaign.py`. Keep network behavior out of this module.

**Step 4: Run GREEN**

Expected: fixture and generated 3,000-word manifests validate identically across repeated runs.

**Step 5: Commit**

```text
feat: version pronunciation audit manifests and cohorts
```

### Task 5: Replace JSONL locking with transactional campaign state

**Files:**

- Modify: `scripts/audit/pronunciation_audit_campaign.py`
- Modify: `backend/test_pronunciation_audit_campaign.py`
- Remove from CLI after migration: `FileLock`, `write_ledger_event()`, and `get_completed_words_from_ledger()`

**Step 1: Write RED state-store tests**

Test two independent SQLite connections and concurrent claims for the same word. Assert:

- one campaign identity row;
- one work item per campaign/cohort/word;
- only one worker can claim a pending word;
- a terminal item cannot be claimed again under the same identity;
- a different deployment creates a different campaign identity;
- an interrupted item remains `in_progress` until explicitly reclaimed;
- reclaim requires an age threshold and records a new attempt number;
- terminal failure and success each retain exactly one current result;
- database transactions roll back cleanly after injected exceptions.

**Step 2: Define the schema**

Use:

```sql
CREATE TABLE campaigns (...);
CREATE TABLE work_items (
  campaign_id TEXT NOT NULL,
  cohort INTEGER NOT NULL,
  word TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL,
  claimed_at TEXT,
  completed_at TEXT,
  row_json TEXT,
  PRIMARY KEY (campaign_id, cohort, word)
);
```

Enable `PRAGMA busy_timeout`; use explicit transactions for claim and terminal update.

**Step 3: Export deterministic evidence**

Add atomic temp-file plus `os.replace()` exporters for:

- one terminal ledger line per word;
- one cohort row per expected word;
- manifest order regardless of worker completion order.

**Step 4: Run GREEN**

```powershell
python -m unittest backend.test_pronunciation_audit_campaign.PronunciationAuditStateTest -v
```

Expected: concurrent claims yield one owner and exported files contain no duplicates.

**Step 5: Commit**

```text
fix: make pronunciation audit resume state transactional
```

### Task 6: Make cohort execution complete, deterministic, and failure-aware

**Files:**

- Modify: `scripts/audit/pronunciation-reference-audit.py`
- Modify: `scripts/audit/pronunciation_audit_campaign.py`
- Modify: `backend/test_pronunciation_audit_campaign.py`

**Step 1: Write end-to-end CLI RED tests**

Use the fixture server through `subprocess.run()` and assert:

- Cohort 1 requests only its assigned words;
- a second run makes zero word requests;
- out-of-order worker completion exports manifest order;
- an injected worker exception creates explicit failure evidence and exits 4;
- a row-level audit error exits 1;
- an incomplete export cannot report success;
- interrupted claims can be explicitly resumed without duplicate terminal rows;
- a second process cannot claim the same pending word;
- terminal rows contain base URL, deployment, schema, algorithm, analysis, TLS policy, manifest hash, seed, cohort, audit-tool Git SHA, start/end timestamps, and sanitized command arguments.

**Step 2: Run RED**

Expected: current `run_cohort_audit()` returns 0 after worker exceptions and appends directly to JSONL.

**Step 3: Implement execution through the state store**

- Claim work before submitting it to the pool.
- Let workers return rows only; do not let workers write shared files.
- Complete work items transactionally in the coordinator.
- Convert unhandled worker exceptions to `INTERNAL_WORKER_ERROR` evidence.
- Verify the expected terminal word set before export.
- Return the defined nonzero exit code whenever evidence is failed or incomplete.

**Step 4: Run GREEN twice**

The second invocation must report zero pending words, zero dictionary calls, and byte-identical cohort JSONL.

**Step 5: Commit**

```text
fix: enforce complete pronunciation audit cohorts
```

### Task 7: Harden cumulative aggregation and human-readable reporting

**Files:**

- Modify: `scripts/audit/pronunciation_audit_campaign.py`
- Modify: `scripts/audit/pronunciation-reference-audit.py`
- Modify: `backend/test_pronunciation_audit_campaign.py`

**Step 1: Write RED aggregation tests**

Generate 3,000 small synthetic terminal rows in a temporary directory. Assert exact 1K/2K/3K reports and rejection of:

- missing cohort files;
- missing, duplicate, extra, or wrong-cohort words;
- words not in the manifest;
- mismatched manifest hash or seed;
- mixed or unknown base URL/deployment/schema/algorithm/analysis/TLS identity;
- missing start/end timestamps or command arguments;
- multiple audit-tool SHAs when not explicitly allowed;
- graph count mismatch;
- a conflict that remains selectable;
- any unresolved disagreement that remains scoreable.

**Step 2: Verify report exit semantics**

Test one passing 3,000-row fixture and one failing fixture. Expected report-builder exit codes are respectively 0 and 1.

**Step 3: Implement exact-set validation**

Compare each cohort's observed word set to its exact manifest slice before calling `summarize()`.

**Step 4: Make review queues checkpoint-specific and compact**

Write `review-queue-1000.json`, `review-queue-2000.json`, and `review-queue-3000.json`. Store stable, sorted reasons plus `(cohort, word, rowFile, rowIndex)`; keep the full reference only in the raw row file.

**Step 5: Make `summary.md` impossible to misread**

The first section must state `PASS` or `FAIL`, list every failed gate, and show base URL, deployment, schema, algorithm, analysis version, manifest hash, and audit-tool SHA. Define conflict metrics as either word rates or variant counts; do not label variants-per-word as a percentage rate.

**Step 6: Run GREEN**

Expected: all generated reports are deterministic except an explicitly separated generation timestamp.

**Step 7: Commit**

```text
fix: validate pronunciation audit reports end to end
```

### Task 8: Repair CLI modes, npm commands, runbook, and CI

**Files:**

- Modify: `scripts/audit/pronunciation-reference-audit.py`
- Modify: `package.json`
- Modify: `docs/runbooks/pronunciation-audit-campaign.md`
- Modify: `.github/workflows/verify.yml`
- Modify: `backend/test_pronunciation_audit_campaign.py`

**Step 1: Reject ambiguous CLI combinations**

Test and implement one unambiguous mode per invocation:

- manifest creation;
- cohort execution;
- cumulative aggregation;
- legacy one-off audit.

Reject `--cohort` without `--manifest`, `--aggregate-through` without `--manifest`, simultaneous create/execute/aggregate flags, and campaign execution without a base URL and expected deployment.

**Step 2: Commit environment support safely**

Read `PRONUNCIATION_AUDIT_BASE_URL`, but let explicit `--base-url` win. Add `PRONUNCIATION_AUDIT_EXPECTED_DEPLOYMENT` or the equivalent explicit flag to every cohort command.

**Step 3: Repair npm commands**

Add commands for:

- manifest create and validate;
- preflight only;
- cohorts 1/2/3;
- reports 1K/2K/3K;
- deterministic manual-review sample generation;
- full fast test suite.

No command defaults to production. Do not include `--insecure-localhost` in candidate commands.

**Step 4: Install Python dependencies in CI**

Before Python audit tests, run:

```yaml
- name: Install pronunciation audit test dependencies
  run: python -m pip install requests==2.32.5
```

**Step 5: Add a clean-environment verification command**

Document a temporary-venv check proving the campaign tests do not depend on globally installed packages.

**Step 6: Update the runbook**

Document preflight, candidate-only full campaign, exit codes, state recovery, TLS policy, full restart after any candidate identity change, manual review, artifact quarantine, and promotion authorization.

**Step 7: Run verification**

```powershell
python -m unittest backend.test_pronunciation_audit backend.test_pronunciation_audit_campaign -v
npm run test:pronounce:logic
```

Expected: all pass without network access beyond fixture servers.

**Step 8: Commit**

```text
chore: make pronunciation audit operations reproducible
```

### Task 9: Run a destructive-test-free mock campaign

**Files:**

- Create under temporary directory only: mock manifest, SQLite state, row files, reports, and review queues
- Do not modify: quarantined or future candidate artifacts

**Step 1: Run a 30-word passing campaign**

Use a fixture server with valid v3 health, three ten-word cohorts, and supported graph responses.

Expected:

- reports at 10/20/30 all pass;
- 30 unique terminal results;
- resume makes zero requests;
- deterministic exports are byte-identical.

**Step 2: Run a failing campaign**

Inject one stale version, one worker crash, one conflict capability violation, and one graph mismatch in separate runs.

Expected: each failure returns its documented nonzero code and cannot produce a misleading PASS summary.

**Step 3: Test local TLS policy**

Use a self-signed loopback fixture:

- without `--insecure-localhost`: preflight fails;
- with the flag: preflight succeeds and provenance records the insecure exception;
- the same flag with a non-loopback hostname: usage fails before network access.

**Step 4: Commit only reusable tests, not temporary artifacts**

```text
test: verify pronunciation audit campaign recovery
```

### Task 10: Deploy and preflight a no-traffic v3 candidate

**Files:**

- Evidence only: `test-results/pronunciation-audit-3000/campaign-metadata.json`
- Follow: `backend/cloudbuild.pronunciation.yaml`
- Follow: `docs/runbooks/pronunciation-backend.md`

**Step 1: Build from the approved repair/release SHA**

Tag the image with the full Git SHA. Do not reuse an unidentifiable local server.

**Step 2: Deploy with zero production traffic**

Record candidate revision, tagged URL, image digest, Git SHA, build ID, and timestamp.

**Step 3: Run preflight only**

Expected:

- HTTP 200;
- schema 9;
- `pronunciation-reference-v3`;
- `pronunciation-analysis-v2`;
- deployment SHA equals the expected SHA;
- verified TLS;
- zero dictionary calls during preflight.

**Step 4: Run the existing deterministic 100-word smoke**

Acceptance:

- zero HTTP 500s;
- zero incorrect scoreable results;
- at least 95 validated words;
- zero selectable conflicts;
- zero graph/reference count mismatches.

Any failure stops before the 3,000-word campaign.

### Task 11: Execute Cohort 1 and complete its manual checkpoint

**Files:**

- Create: new canonical manifest and campaign state
- Create: `cohort-1-rows.jsonl`, `report-1000.json`, `review-queue-1000.json`, `manual-review-cohort-1.jsonl`

**Step 1: Freeze the manifest once**

Validate exact size, uniqueness, source hashes, and manifest hash before execution.

**Step 2: Run Cohort 1**

Expected: exactly 1,000 terminal rows, one candidate identity, no duplicate word, exit 0 only if the cohort evidence is complete and clean.

**Step 3: Aggregate 1,000**

All acceptance gates must pass before continuing.

**Step 4: Generate the manual sample**

Using a second fixed review seed, select 50 validated scoreable rows from Cohort 1, stratified to include:

- monosyllables;
- diphthongs and rhotics;
- syllabic consonants;
- primary and secondary stress;
- alternate part-of-speech variants;
- CMU fallbacks;
- graph-enabled and quarantined references.

**Step 5: Complete manual review**

For all 50, record IPA, syllable count, stress, part of speech, dialect/source evidence, reviewer decision, and source link. For at least 20, play native audio and record audio/graph agreement.

**Step 6: Stop on any confirmed defect**

Create a regression fixture, fix the defect, deploy a new candidate, create a new campaign identity/output directory, and restart from Cohort 1. Do not mix deployments.

### Task 12: Execute Cohorts 2 and 3 with identical gates

**Files:**

- Create: remaining cohort rows, cumulative reports, review queues, manual-review files, and final summary

**Step 1: Run Cohort 2 and aggregate 2,000**

Verify the cumulative report contains the exact union of manifest indices `0..1999` without rerequesting Cohort 1.

**Step 2: Complete the Cohort 2 manual review**

Review 50 newly added rows and at least 20 native-audio cases.

**Step 3: Run Cohort 3 and aggregate 3,000**

Verify the exact full manifest, identity consistency, and all gates.

**Step 4: Complete the Cohort 3 manual review**

Review 50 newly added rows and at least 20 native-audio cases.

**Step 5: Final candidate acceptance**

Require:

- 3,000 unique manifest words;
- 3,000 unique terminal rows;
- all three cumulative reports passing;
- at least 98% validated coverage at 1K, 2K, and 3K;
- zero incorrect scoreable results;
- zero HTTP 500s;
- zero selectable conflicts;
- zero dialect/source-label violations;
- zero graph/reference count mismatches;
- all manual decisions completed with no unresolved confirmed defects.

### Task 13: Request promotion authorization and run production smoke

**Files:**

- Create: `test-results/pronunciation-audit-production-smoke-<sha>.json`
- Create: Chrome screenshot evidence under `test-results/`

**Step 1: Stop for explicit authorization**

The successful candidate audit does not itself authorize production traffic or hosting deployment.

**Step 2: Promote the exact audited revision after authorization**

Confirm production `/health` returns the same deployment/schema/algorithm/analysis identity as the audited candidate.

**Step 3: Run a smaller deterministic production API smoke**

Use 100 words, not another 3,000. Require the existing production acceptance gates.

**Step 4: Run Chrome-only UI verification**

Following workspace rules, use the local Playwright `webapp-testing` workflow first and `C:\Cursor AI\.local\browser-test-credentials.md` if login is required. Verify at minimum:

- `car` is `/kɑr/`, one syllable;
- `photograph` is `/ˈfoʊtəˌɡræf/`, three syllables, primary `PHO`, secondary `GRAPH`;
- variant switching clears old graphs/audio;
- conflict references fail closed;
- graph axes and tooltips retain correct units.

Use `browser-agent` only as the second visual-confirmation step.

### Task 14: Replace misleading narrative with evidence-derived documentation

**Files:**

- Modify: `C:\Users\Admin\.gemini\antigravity\brain\6ea08fb7-7490-45de-a626-a89e168ca32e\walkthrough.md`
- Modify: `docs/runbooks/pronunciation-audit-campaign.md`
- Preserve: quarantined `FAILURE.md`

**Step 1: Make the walkthrough state the old run failed**

Do not describe the v2/unknown-provenance reports as successful.

**Step 2: Generate final numbers from report files**

The final walkthrough must read `gates.passed`, provenance, and summary values from the accepted candidate and production-smoke artifacts. Do not hand-copy only favorable metrics.

**Step 3: Link manual-review evidence**

State how many rows and audio cases were reviewed and whether any defects remain.

**Step 4: Commit tracked documentation and evidence**

```text
docs: record verified pronunciation audit campaign
```

Do not commit the local-only Antigravity brain file unless the repository explicitly tracks it.

---

## 5. Required verification matrix

| Surface | Command/evidence | Required result |
|---|---|---|
| Manifest | `python -m unittest ...ManifestV2Test -v` | Deterministic, exact, source-hashed 3K manifest |
| Preflight | focused preflight tests | Unsupported/unknown target makes zero word requests |
| TLS | loopback and remote-host policy tests | Verified by default; insecure flag loopback-only |
| State | concurrent SQLite claim tests | One current terminal row per campaign word |
| Resume | second CLI run with request counters | Zero repeated requests and byte-identical export |
| Worker failure | injected exception | Explicit evidence and exit 4 |
| Aggregation | generated 1K/2K/3K fixtures | Exact cohort sets and strict provenance |
| Clean CI | fresh virtual environment | `requests` installed explicitly; tests pass |
| Candidate smoke | 100-word report | All smoke gates pass |
| Candidate campaign | reports 1K/2K/3K | All full gates pass |
| Manual review | 3 decision files | 150 rows and at least 60 audio checks completed |
| Production API | 100-word smoke | Same audited deployment identity and all gates pass |
| Production UI | Playwright Chrome | IPA/count/stress/variants/graphs verified |

## 6. Final acceptance criteria

- The failed local-v2 artifacts remain available only under a path that clearly labels them failed.
- No report or walkthrough describes the old campaign as accepted.
- No network audit can begin with an unavailable, unsupported, mismatched, or unknown target identity.
- TLS remains verified for every non-loopback request.
- Campaign commands work from committed code with documented environment variables.
- Exactly one terminal result exists for every campaign/cohort/word.
- Resume cannot duplicate terminal rows or silently mix candidate identities.
- Worker or export failures cannot return success.
- Aggregation validates exact manifest membership and complete provenance before computing gates.
- The full candidate campaign passes at 1K, 2K, and 3K.
- Manual IPA, syllable, stress, dialect, audio, and graph checks are preserved as evidence.
- The production smoke verifies the same audited revision after separate promotion authorization.
- The full test suite passes in a clean dependency environment and CI.

## 7. Execution handoff

Plan implementation should occur in the isolated `codex/pronunciation-audit-campaign-repair` worktree. Execute Tasks 1–9 first and review the repaired mock evidence before creating any Cloud Run candidate. Tasks 10–12 are candidate-only operational checkpoints. Task 13 requires explicit production authorization.
