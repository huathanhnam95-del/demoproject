# Target-Aligned Learner Pronunciation Design

## Goal

Restore the pre-July learner experience in which every valid recording is segmented into the predetermined target syllable count, allowing pitch, intensity, duration, and stress feedback to be shown for each expected syllable.

## Scope decision

The approved policy is **always target-align**. The system will not use independent learner syllable-count detection to decide how many feedback regions to render. The canonical target count from the selected American-English pronunciation remains authoritative for learner segmentation.

This is a targeted behavior restoration, not a repository rollback. The following recent work remains intact:

- pronunciation reference and modeled fallback graphs;
- fresh-word caching and retry behavior;
- production corpus recording and cloud storage;
- V2/V3 response-shape compatibility;
- audio validation, silence rejection, and existing CRM changes.

## Architecture

The production pronunciation analyzer will use the V2 Praat learner endpoint. The frontend already sends the selected pronunciation's expected syllable count with the recording. V2 will pass that count to the existing Praat adjustment pipeline with expected-count adjustment enabled.

The adjustment pipeline will continue to use the recording's real intensity peaks, valleys, voicing, pitch, and speech bounds. When the initial acoustic candidates do not equal the target count, it may add, split, or prune candidates to produce exactly the expected number of feedback regions. Each resulting region retains measured acoustic properties from the learner's recording.

The V3 phoneme implementation remains in the codebase for future research but will not silently replace the approved production learner policy. The client-side production feature flag will keep learner analysis on V2 unless a future explicitly approved change enables V3 again.

## Data and response contract

For valid speech with an expected count:

- `observed.syllableCount` equals the predetermined target count;
- `observed.syllables` contains one time-bounded region per target syllable;
- stress evidence is computed across those target-aligned measured regions;
- the segmentation method is labeled `target-aligned-acoustic-feedback` so diagnostics do not claim independent count recognition.

For silence or unusable audio:

- no syllables are fabricated;
- the result remains unrateable;
- existing no-speech guidance remains visible.

## User experience

The learner always receives the established per-syllable feedback interface for a valid recording. For a two-syllable target such as `busy`, the recording produces two feedback regions even when the raw detector initially finds only one prominent acoustic peak. The learner can therefore compare the stress, duration, and pitch of both `BUS` and `y` instead of seeing an incorrect one-syllable result or no chart.

This mode is intentionally pedagogical alignment. It should not be described to learners as independent omission/insertion detection.

## Alternatives considered

### Independent detection with mismatch fallback

This would sometimes use independent regions and sometimes target-aligned regions. It was rejected because the user selected consistent target alignment for every attempt.

### Full pre-July rollback

This would restore old files wholesale but would also remove unrelated fixes and recreate known caching, blank-graph, and deployment problems. It was rejected in favor of restoring only the desired analysis policy.

## Failure handling

- Missing or invalid expected counts continue through the existing defensive path rather than forcing an arbitrary count.
- No-speech recordings remain empty and unrateable.
- Backend failures continue to use the existing frontend fallback/error behavior.
- V3 remains available only as dormant implementation code; it is not part of the approved production learner flow.

## Verification

- A test must first fail while learner V2 disables expected-count adjustment.
- After the implementation, that test must prove learner V2 enables target alignment and labels the method honestly.
- Existing silence tests must continue to pass.
- Existing pronunciation backend and browser suites must pass.
- The saved production `busy` WAV must return two learner syllables through the V2 endpoint when the expected count is two.
- Chrome verification must confirm that the per-syllable feedback UI still renders through the normal practice flow.

## Deployment boundary

This design authorizes local implementation and verification. Production deployment remains a separate explicit user-approved action.
