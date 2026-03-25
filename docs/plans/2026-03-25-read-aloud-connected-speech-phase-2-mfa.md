# Read Aloud Connected-Speech Phase 2: MFA Upgrade

## Purpose

Phase 1 shipped a low-cost connected-speech MVP that scores event-level feedback from Azure word timings plus heuristic rules. Phase 2 upgrades the backend to use Montreal Forced Aligner (MFA) as the alignment layer for higher-confidence connected-speech detection in fixed General American read-aloud prompts.

This is a future expansion, not an immediate implementation task.

## Why Phase 2 Exists

The current system is good enough for a narrow pilot, but it has clear limits:

- It infers connected-speech events from word timing gaps and Azure confidence fields.
- It does not align phones directly from the audio.
- It is weaker on subtle events such as assimilation, yod coalescence, and weak-form reduction.

MFA improves the alignment layer, but it does not replace the need for event-specific scoring logic.

## Phase 2 Scope

Move the connected-speech worker from heuristic scoring to an MFA-backed pipeline while keeping the current public API and UI contract stable.

Target families for the first MFA migration wave:

- `yod_coalescence`
- `n_bilabial_assimilation`
- `weak_form_reduction`

The existing heuristic path can remain as a fallback during rollout.

## What Should Be Done

### 1. Build the MFA worker runtime

- Add MFA and required English model assets to the Python worker container.
- Make the worker accept raw WAV audio and run alignment from the audio itself.
- Parse MFA word and phone boundaries into the existing connected-speech event contract.

### 2. Add prompt-specific pronunciation variants

- Create a curated lexicon strategy for fixed read-aloud prompts.
- Add canonical and connected-speech variants for the targeted event families.
- Support cross-word variants where needed instead of assuming one canonical phone path.

### 3. Replace heuristic event detection where it matters

- Use MFA phone spans as the primary evidence source.
- Keep family-specific scoring logic on top of alignment results.
- Return `uncertain` when the alignment or acoustic evidence is weak instead of forcing a binary label.

### 4. Validate against human labels

- Build a small labeled evaluation set from retained read-aloud attempts.
- Measure per-family agreement before widening scope.
- Tune thresholds and fallback rules from real data, not intuition.

### 5. Roll out safely

- Keep the current route and response shape stable.
- Start with the three highest-value families only.
- Retain the heuristic analyzer as a fallback until MFA performance is proven.

## Expected Cost and Effort

Estimated engineering effort:

- Narrow production MVP: about 3-5 engineer-weeks
- Stronger validation and calibration: about 6-10 engineer-weeks total

Estimated runtime cost at current traffic assumptions:

- Roughly `$20-$60/month` with cold-start-tolerant Cloud Run
- Roughly `$40-$100/month` with a warm instance to reduce latency

The main cost is implementation and validation time, not infrastructure.

## Success Criteria

Phase 2 is worth promoting only if it does all of the following:

- improves event-level accuracy for the targeted families over the heuristic baseline
- reduces false positives on subtle connected-speech events
- keeps learner-facing latency within the accepted 5-10 second range
- preserves soft-fail behavior when the advanced worker is unavailable

## Recommendation

Do not start Phase 2 MFA work until the current MVP has pilot usage and a small labeled evaluation set. The next best move is to learn from real learner attempts first, then upgrade the alignment layer for the families that show clear product value.
