# Echo Forge — Empirical Timing Report v1

**Date:** 2026-08-25
**Evidence export:** [`timing-evidence.v1.json`](./timing-evidence.v1.json)
**Scope:** service/runtime timing evidence for the Echo Forge visual timing gate

## Gate result

The timing gate is **READY**. The export contains 170 records with `timingGate.ready: true`:

| Gate outcome | Count |
| --- | ---: |
| Azure word scored | 30 |
| Azure phrase scored | 30 |
| Formal V3 word scored | 31 |
| Unavailable or unrateable | 69 |

The overall unavailable rate is `0`; the overall unrateable rate is `0.40588235294117647` (69/170). These are gate outcome counts, not human-speaker score distributions.

## Request-duration evidence

Values below are milliseconds from the machine-readable export; p95 and maximum are included to bound a readable visual cadence, not to set a completion deadline.

| Evaluation path | Min | P50 | P75 | P90 | P95 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Azure word | 147.2 | 313.5 | 354.2 | 417.8 | 436.1 | 484.2 |
| Azure phrase | 294.3 | 390.9 | 476.0 | 512.2 | 534.0 | 561.9 |
| Active local V3 word | 163.9 | 242.4 | 256.1 | 280.1 | 300.3 | 345.3 |

The observed overall maximum request duration is approximately 561.9 ms. A roughly **600 ms analysis-hold cycle** is therefore a visual readability cadence that covers the observed p95/max range; it does not determine analyzer completion, combat timing, or a network timeout. The hold remains event-driven, loopable, and cancellable, with a one-frame safe stop.

## Measurement boundary and limitations

- The corpus used local Kokoro `af_heart` generated reference audio in memory, a stateless local Azure proxy returning real Azure Speech Comprehensive results, and the local active V3 backed by a ready phoneme recognizer.
- This measures service/runtime behavior for the local corpus. It does **not** measure human-speaker score distributions, production network behavior, or deployed-service latency.
- Deployed V3 was not used because it reported `V3_NOT_ACTIVE`.
- Audio bytes, raw analysis, recognized/reference text, identity fields, and token fields are intentionally excluded from this report and export summary.
- The evidence does not change combat/scoring semantics, the protected backend boundary, or the approved `minimal-luminous-training-arena` art direction.

## Approval and next gate

This evidence satisfies the empirical timing gate for the v1 motion specification and Gemini request. Suggested motion values remain visual guidance only. Stage B binary generation, provenance, visual review, and runtime integration remain separate pending gates; no production asset or final visual release is claimed here.
