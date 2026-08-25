# Echo Forge external visual QA and rework handoff

Status: **Stage A documentation only; Stage B integration blocked**

Review date: August 24, 2026

This review covers the Claude visual-direction package, Claude prototype, Gemini reference package, draft manifest, prompt log, and their relationship to `visual-contract.v1.json`. It does not approve production art, production motion timing, or runtime integration.

## What passed

- The shared visual contract parses and retains its 21 immutable semantic events.
- Claude supplied the requested visual-direction, layout, state, accessibility, motion-draft, asset-request-draft, and prototype documents.
- The prototype renders at desktop and 360 px without horizontal overflow.
- All 21 semantic states can be selected in the prototype.
- Reduced-motion presentation, keyboard focus rings, neutral technical-failure language, and basic status/HUD changes are demonstrable.
- Gemini supplied text-based reference, pose, icon, effect, palette, crop, prompt-log, and draft-manifest documents.
- Existing Echo Forge Node and Chrome suites remained green before package correction.

## Blocking findings

### Gemini asset evidence

- No Echo Forge PNG, WebP, AVIF, sprite sheet, or other image binary was delivered.
- `public/assets/echo-forge/v1/` and `asset-manifest.v1.json` do not exist.
- Draft provenance values cannot be verified against bytes. At least two recorded hashes are known placeholder values: SHA-256 of empty content and SHA-256 of the single character `a`.
- The prompt log must not claim generation, cleanup, licensing, or review that cannot be tied to an existing file.
- Stage A may remain a documentation/reference package, but it must be labelled `not_generated` with nullable hashes and unverified provenance until binary evidence exists.

### Timing and approval

- The required empirical corpus is still absent: 30 scored Azure words, 30 scored Azure phrases, 30 formal V3 words, and 10 unavailable/unrateable results.
- `timing-report.md` contains static prototype observations and suggested values, not analyzer timing evidence.
- `motion-spec.v1.json` and `gemini-asset-request.v1.json` therefore cannot be approved. They must remain blocked pending the machine-readable timing gate and written approval.
- Fixed cadence suggestions conflict across Claude documents. The final motion spec must derive its variables from the measured report and preserve engine-controlled, cancellable analysis hold behavior.

### Contract and manifest identity

- A draft asset manifest is not the visual contract root and must validate against its own closed manifest schema.
- A final manifest must map every immutable asset ID to an actual file, dimensions, alpha requirement, content hash, and provenance record.
- The responsive specification references an enemy sprite, but no immutable enemy asset slot currently exists. Claude must either design within the approved three-slot contract or submit an explicit contract-change proposal for backend-owner review. Gemini must not invent an asset ID.

### Claude prototype behavior

- `heroClass` and `enemyClass` values are defined but not applied, so all combat states retain the idle CSS silhouettes.
- Victory and defeat lack a completed outcome surface and leave attack, block, parry, and microphone controls enabled.
- HUD text changes without synchronizing `aria-valuenow`; recording keeps an inactive accessible label; pending analysis lacks `aria-busy` synchronization.
- The recording badge overlaps the enemy label.
- Several prototype controls do not meet the 44 x 44 px touch-target requirement.
- The prototype relies on Google Fonts and requests a missing favicon. Final integration needs a local/system-font fallback and no avoidable console errors.

## Claude correction request

1. Keep the current art direction as a draft; do not change backend events, calculations, challenge content, or asset IDs.
2. Correct state-class application, action locking, outcome controls, HUD/recording/pending accessibility state, recording-badge placement, and touch targets in the prototype.
3. Reconcile motion-variable suggestions only after receiving the empirical timing export.
4. If an enemy asset is required, submit a small contract-change proposal describing the semantic need, event coverage, static fallback, crop, pivot, and accessibility impact. Do not assume approval.
5. Return an updated prototype QA checklist covering desktop, 360 px mobile, reduced motion, keyboard, static fallback, technical no-op, victory, and defeat.
6. Stop for backend-owner approval before producing `motion-spec.v1.json` or the final Gemini request.

## Gemini correction request

1. Treat the current Markdown package as design/reference documentation, not generated art.
2. Remove generated-file assertions and placeholder hashes wherever no matching bytes exist.
3. Do not begin Stage B until the approved Claude request and empirical timing gate are supplied.
4. For every generated binary, provide its immutable asset ID, relative file path, real SHA-256, width, height, alpha result, model/version, exact prompt, negative prompt, settings, references, cleanup tool/version, license status, and review status.
5. Do not embed text, instructions, URLs, secrets, learner data, analyzer payloads, or executable content in image files or metadata.
6. Return final assets only under `public/assets/echo-forge/v1/` with a schema-valid `asset-manifest.v1.json` and an evidence-based production report.

## Re-entry gate

Visual integration may resume only when all of the following are true:

- The empirical timing JSON reports `timingGate.ready: true` from real service results.
- Claude supplies a reconciled motion spec and final Gemini request with written approval evidence.
- Gemini supplies actual transparent binaries and a final manifest.
- Every file exists and matches its declared SHA-256, dimensions, alpha requirement, immutable asset ID, and provenance.
- Claude’s corrected prototype passes desktop, 360 px, reduced-motion, keyboard, state-locking, and accessibility checks.
- A reviewer confirms the visual layer cannot change combat/scoring semantics and technical failures remain neutral no-ops.

Until then, the animation-free Echo Forge sandbox remains the authoritative executable surface.
