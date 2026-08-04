# Pronunciation V3 Integration & Test Review

**Date:** August 4, 2026  
**Branch:** `codex/speaking-ui-review-repair`  
**Review status:** Local fixes verified; commit/push approval still pending

## Overview

This report records the code review and fresh local verification for the V3 Pronunciation integration fixes. It covers browser-harness isolation and reconciliation of the recognizer V1/V2 response contracts. It is not a production deployment or a blanket authorization to commit the current worktree.

## 1. Browser test stability (`pronounce-mode-browser-check.js`)

### Root cause

Two independent boot hazards were present. The comparison browser check imports `startServer` from the base harness, while the base harness previously executed its full `run()` path whenever it was required because its runner was not guarded by `require.main === module`. Separately, `pitch-analyzer.js` imported `pitchfinder` from `https://esm.sh`; after the logic phase, the browser reproduced `net::ERR_CONNECTION_CLOSED` for that module, leaving the app constructor unstarted with an empty DOM. The earlier connection-reset observation therefore was not a sufficient diagnosis.

### Fix

The base harness now executes `--serve-only` or `run()` only when launched directly. Imports expose `startServer` and an awaited `closeServer` without starting a test. A module-contract regression test verifies start/close lifecycle behavior. The pitch analyzer now uses a local YIN implementation; the remote CDN dependency and unused npm package were removed, so app boot no longer depends on external module-network availability.

### Evidence

`npm run verify:pronounce` passed with one base check and one comparison check in the expected sequence; the duplicate `pronounce-mode browser check passed` output is gone. Five consecutive logic-plus-base runs also passed after the local YIN change. The complete browser phase passed:

* `pronounce-harness module contract passed`
* `pronounce-mode browser check passed`
* `pronounce-version-comparison browser check passed`
* `pronounce-mode syllable playback check passed`
* `pronounce-mode manual review browser check passed`

The logic phase includes `pitch-analyzer tests passed`, verifying a deterministic 220 Hz local fallback without network access.

## 2. V3 recognizer contract drift

### Root cause

V1 and V2 do not expose the same recognizer shape. V1 reports `is_rateable` and top-level `confidence`; V2 reports `contract_version: recognize-v2`, `decoded_is_rateable`, and confidence on canonical aligned syllables. Treating either rateability flag as interchangeable allowed a conflicting legacy field to override V2 and treated a missing required flag as rateable.

### Fix

`backend/local_server/server.py` now dispatches rateability by contract:

* V1 (no version or `recognize-v1`) reads only `is_rateable`.
* V2 reads only `decoded_is_rateable`.
* Missing, non-boolean, unknown-contract, or V2-shaped-without-version values fail closed.
* Formal V2 verification uses the same helper and no longer defaults a missing flag to `True`.

V2 confidence and canonical syllable spans continue to be read from the V2 alignment, while V1 retains its top-level confidence and phoneme edit script. Empty V2 decodes continue to report no fabricated all-deletion edit script.

### Evidence

The regression coverage includes contract-specific flags, missing/invalid flags, conflicting V1/V2 flags, degraded pipeline behavior, and formal verification behavior. The three targeted backend modules pass:

`131 passed, 2 subtests passed`

A broader `backend/test_pronunciation*.py` sweep also passed `266 passed, 54 subtests passed`.

## 3. Audit and release status

The infrastructure gaps in `release-status-and-next-steps.md` remain accurately scoped: R3 allowlist, R6 verification, R10 rollback behavior, and image-baked SHA still require their own release work. Local code and test verification does not close those deployment gaps.

The current worktree remains broad and dirty. `HEAD` is still `27b0f7fc`; the pronunciation fixes and this report are not committed, and unrelated modifications are present. Do not push or commit the entire worktree. The next release step is an explicit allowlisted diff review, followed by a commit containing only the reviewed pronunciation changes.

## Conclusion

The browser import side effect, external CDN boot dependency, and fail-open recognizer contract handling are fixed and covered by regression tests. `npm run verify:pronounce` and the targeted backend suites pass locally. The implementation is ready for an allowlisted commit review, not for an unreviewed wholesale commit or push.
