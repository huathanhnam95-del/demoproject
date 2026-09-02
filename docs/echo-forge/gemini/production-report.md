# Echo Forge Asset Package Report — Stage A Documentation Gate

## Status

This Gemini handoff remains a Stage A specification-only package. It records the approved visual contract and planned generation inputs; it does not claim that Gemini generated any PNG or other production binary.

The approved internal production package is now deterministic and project-authored. Its runtime manifest is `../../public/assets/echo-forge/v1/visual-manifest.v1.json` and its closed schema/report are under `docs/echo-forge/production/`. Those binaries are not Gemini output and must not be attributed to Gemini.

The **Stage B timing gate passed** on 2026-08-25: the empirical export reports `timingGate.ready: true` for 170 records. Binary generation, provenance completion, visual review, and runtime integration remain pending. The v1 motion specification and Gemini request are approved for empirical timing, not for final visual production.

## Authoritative documents

- Visual behavior and immutable 13-field slots: `visual-contract.v1.json` and `visual-contract.schema.json`.
- Stage A asset manifest and sidecars: `asset-manifest.draft.json`, validated by the distinct closed `../asset-manifest.schema.json`.
- Prompt data: `prompt-log.jsonl`. Every record remains `not_generated` with `sha256: null`, `binaryPath: null`, and unverified license/review status.
- Timing evidence: `../timing/timing-evidence.v1.json`.
- Timing summary: `../timing/timing-report.v1.md`.

## Gate audit

| Gate | Status | Evidence or remaining requirement |
| :--- | :---: | :--- |
| Visual contract | PASS | The immutable visual contract remains the source of event and slot semantics. |
| Distinct asset-manifest schema | PASS | The draft points to `asset-manifest.schema.json`; top-level, slot, and sidecar objects are closed. |
| 13-field slot separation | PASS | Each draft slot contains exactly the contract's 13 visual fields; provenance remains in sidecars. |
| Stage A generation truthfulness | PASS | Draft sidecars and prompt records remain `not_generated`; hashes, binary paths, dimensions, and alpha are null. |
| Placeholder hash rejection | PASS | Empty-content, single-character, repeated-character, and malformed hashes are not accepted as generated provenance. |
| Stage B timing gate | PASS | `timing-evidence.v1.json` has `timingGate.ready: true` across 170 records; see the v1 timing report for measured scope and limitations. |
| Gemini handoff real binaries | BLOCKED | The Gemini handoff contains no generated binaries; the internal package is separate. |
| Gemini handoff integration | BLOCKED | Gemini did not generate or integrate production assets. |
| Deterministic internal production package | READY | Project-authored SVG sources rasterize to 9 hashed transparent PNG frames; manifest validates dimensions, alpha, paths, source hash, and approved internal review. |
| Internal runtime integration | READY | Same-origin loader and event-only presenter consume the internal manifest with CSS fallback and reduced-motion static equivalence. |

## Empirical timing boundary

The timing corpus used local Kokoro `af_heart` generated reference audio in memory, a stateless local Azure proxy with real Azure Speech Comprehensive results, and the local active V3 backed by a ready phoneme recognizer. It measures service/runtime behavior for this local corpus, not human-speaker score distributions, production network behavior, or deployed-service latency. Deployed V3 was not used because it reported `V3_NOT_ACTIVE`. Audio bytes, raw analysis, recognized/reference text, identity fields, and token fields remain excluded.

The timing gate does not alter combat/scoring semantics, the protected backend boundary, or the approved `minimal-luminous-training-arena` art direction. Suggested motion values are visual guidance only; they are not combat or network timeouts.

## Slot shape

The visual slot record remains exactly these 13 fields and no provenance fields:

1. `assetId`
2. `stateEvents`
3. `canvas`
4. `frameCount`
5. `frameOrder`
6. `pivot`
7. `padding`
8. `zOrder`
9. `paletteConstraints`
10. `staticFallbackFrame`
11. `mobileSafeCrop`
12. `loop`
13. `timingVariable`

No enemy slot, combat formula, event, or creative direction is introduced by this timing-gate correction. The backend boundary and static-first/reduced-motion requirements remain unchanged.

## Next authorized step

After Stage A references are reviewed, the authorized owner may generate the final assets, record real binary hashes and dimensions/alpha evidence, update the sidecars and prompt log, and publish `asset-manifest.v1.json`. Until those gates pass, no final visual production or runtime release is claimed.
