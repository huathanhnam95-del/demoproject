# Latest Session Work

## V4 follow-up handoff — 2026-09-01

- Durable plan: `docs/plans/2026-09-01-v4-follow-up-handoff.md`.
- Start point: clean `origin/main` at `4a48bff847efd9c59474cbbf1a582e20b6cebf8c`; do not copy changes from the dirty primary checkout.
- Begin with `V4-A2-AVAIL-01`: collect correlated production evidence for `RECOGNIZER_BUSY`, add privacy-safe inference-gate observability, classify the cause, and test one evidence-selected zero-traffic candidate. Do not guess a concurrency fix.
- Next, preregister `V4-A2-EVAL-01`: keep holdout locked until roles, manual annotation instructions, dataset/protocol hashes, metrics, and numerical thresholds are approved. Never tune on revealed holdout results.
- Then implement `V4-A2-SMOKE-01`: read-only CLI and authenticated Chrome checks for full SHA/revision, Cloud Run traffic/IAM, recognizer readiness, Firebase Node runtime, three-origin CORS, Study UI, and no task mutation.
- Keep `FBASE-ADMIN-14-01` separate: inventory official breaking changes, characterize every exported function on Node 22, update only Firebase Admin through normal npm resolution, and require a separate deployment authorization.
- Production anchors at handoff: pronunciation `praat-api-00074-zuv` from application SHA `d509e6f36ce76cd6e023c91453f5097069d1002f` (rollback `praat-api-00069-fub`); recognizer `phoneme-recognizer-00016-lum`; Firebase API `api-00087-moq` on Node 22 (rollback `api-00085-yaw`). Re-resolve all anchors before any mutation.
- Required execution skill: load `executing-plans` in a separate session and execute one package at a time. Production deploy, promotion, holdout unlock/export, and Firestore/Storage/Hosting mutation always require explicit authorization.
