# UI Changes + V3 Deployment — Independent Verification

**Date:** 2026-08-04 (Vietnam Time)
**Scope:** V1.8.45 Pronounce/Speaking UI changes and the live V3 pronunciation deployment
**Verdict:** **Functionally verified.** Every check passed. One governance issue is
open: production runs a commit that is **not on the working branch**, and neither
branch exists on `origin`.

---

## 1. What is actually live

| | Value |
|---|---|
| Deployed commit | `8195534d1eb1d5366bc94d9d0acd2158a9f28a77` — *"fix: ship pronunciation V3 comparison release"* |
| `praat-api` | `praat-api-00061-mel` (100%) |
| `phoneme-recognizer` | `phoneme-recognizer-00013-jud` (100%) |
| Hosting | matches HEAD byte-for-byte |
| App version | V1.8.45 |
| Mode | `pronunciationV3Mode: shadow`, `usePronunciationV3LearnerAnalysis: false` |

This supersedes the earlier release (`18b65ed4` / `praat-api-00057-fiv` /
`phoneme-recognizer-00010-rir`), which was deployed by an earlier session.

---

## 2. Verification performed

### Test suites — all green

| Suite | Command | Result |
|---|---|---|
| Pronunciation logic | `node --test "tests/pronunciation-analyzer/*.test.mjs"` | **55 pass, 0 fail** |
| Ops / release contracts | `node --test "tests/ops/*.test.mjs"` | **20 pass, 0 fail** |
| Backend | `python -m unittest backend.test_pronunciation_api_v2 …` (6 modules) | **185 pass, OK** |

### Browser checks — all pass

`pronounce-mode-browser-check` · `pronounce-version-comparison-browser-check` ·
`pronounce-manual-review-browser-check` · `pronounce-mode-syllable-playback-check`

### Production end-to-end (real Chrome, admin sign-in, fake microphone)

```
/warm/v3 calls observed : 2 (status 202,202)
comparison status       : complete
V2                      : available
V3                      : available
V3 segmentation source  : ctc
```

`pronounce-production-verify.js` also passed: deployed sources correct, admin API
fails closed (401), CORS allows the production origin, client/backend schema
aligned at 10, no console errors.

### Hosting is genuinely deployed

SHA-256 of live bytes vs working tree:

| File | Result |
|---|---|
| `version-comparison.js` | MATCH (`0229f2b39fb9`) |
| `app.js` | MATCH (`fa5c5b5bd6de`) |
| `style.css` | MATCH (`afbab096f516`) |

This closes the previously-open R5 gap. **`/warm/v3` now fires in production** —
it was 0 calls before Hosting was deployed, and is 2 calls now.

### Production invariants

`praat-api` public ✓ · `phoneme-recognizer` private ✓ · traffic pinned to one
explicit revision each with no `latestRevision` ✓ · Scheduler `ENABLED`,
`*/10 6-23 * * *`, `Asia/Ho_Chi_Minh` ✓.

### Keep-alive health

Three-hour window on the current revision:

```
scheduler : 18 finished / ~18 expected, 0 non-OK
/readyz   : median 3.4 ms, max 6.5 ms, 0 non-200
starts    : 0 expected, 0 UNPLANNED, 1 rollout
```

The verifier reported `evidenceComplete: False` on an 18-vs-8 mismatch. **This is
correct behaviour, not a fault:** the window spans a revision promotion. Confirmed
by revision breakdown — 9 pings on `00013-jud` and 9 on `00010-rir`, totalling the
18 finishes. Scheduler execution is perfect and there were **zero unplanned
evictions**.

---

## 3. Backend drift — investigated and cleared

V1.8.45 changed `backend/local_server/server.py` by 142 lines after the previous
image was built, which raised a drift concern. The change makes
`_build_v3_active_response` read the recognizer contract through the shared
`_recognizer_*` helpers instead of v1 keys directly, and returns
`edit_operations: None` rather than an all-deletion script when nothing decoded.

Tested by running the same saved sample against production and against HEAD
locally. **Byte-identical results:**

| Field | Production | HEAD (local) |
|---|---|---|
| `v3.status` | available | available |
| `syllable_count` | 3 | 3 |
| `confidence` | 0.752073 | 0.752073 |
| `phoneme_alignment` | False | False |
| `edit_operations` | None | None |
| `count_delta` | 0 | 0 |
| `observed_phonemes` | 0 | 0 |

The remaining source difference between the deployed commit and HEAD is a
`.pyc` and a stray file (`backend/local_server/emulators)`). The backend is
functionally aligned.

---

## 4. Open issue — release provenance

**Production runs a commit that is not on the working branch.**

```
8195534d1eb1  (deployed)  on codex/pronunciation-v3-production-release
     │
     └── parent: 27b0f7fc  ← on codex/speaking-ui-review-repair
                    │
                    ├── 067d3c87  V1.8.45
                    └── f78a4af0  HEAD
```

The two branches forked at `27b0f7fc` and have not been merged. Neither exists on
`origin` — `git ls-remote --heads origin` returns nothing for either.

**Why it matters:** the deployed commit is reachable only from a local branch on
this workstation. It is not on `main`, not on the branch being worked on, and not
backed up remotely. If this machine were lost, the running production code could
not be recovered, and `git log` on the working branch does not describe what is
live.

**Remedy:** merge `codex/pronunciation-v3-production-release` into the working
branch (or vice versa) so one lineage describes production, then push. Until then
the release is functionally sound but not reproducible from the remote.

---

## 5. Residual items (unchanged from the release report)

- 24-hour keep-alive observation still pending; the 3-hour sample is healthy.
- Cost figure remains arithmetic (~1.7% of free tier), not telemetry from
  `run.googleapis.com/container/billable_instance_time`.
- R3 allowlist, R6 candidate smoke test (needs
  `roles/iam.serviceAccountTokenCreator`), and R10 recognizer rollback rehearsal
  remain open.

---

## 6. Note on concurrent sessions

Files changed underneath this verification more than once — `app.js`'s
`spans.length === 0` guard was present on one read and removed minutes later, and
production revisions advanced from `00057-fiv` to `00061-mel` mid-check. Two
sessions are editing and deploying the same services. Verification results are
timestamped for that reason, and any re-audit should re-establish the deployed
revision before drawing conclusions.
