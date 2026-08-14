# Segmentation Accuracy Reanalysis and CRM Study

## Decision

The six-recording replay does not justify making the confidence-threshold/Praat-blending change, or an 80 ms tolerance, the primary solution. The reproduced baseline is useful as a regression set, but it is too small and too correlated to tune a learner-facing algorithm.

The next step is a production CRM record-and-review study, followed by a preregistered offline spectrogram experiment. Learner-facing Pronounce remains unchanged unless a later rollout is separately approved.

## Reproduced baseline

The six paired recordings in `test-results/pronounce-local-samples/` were replayed against their manual labels:

| Metric | V2 Praat | V3 CTC | V4 hybrid |
| --- | ---: | ---: | ---: |
| Internal-boundary MAE | 48.9 ms | 60.2 ms | 63.3 ms |
| Within 30 ms | 19/36 (53%) | 13/36 (36%) | 11/36 (31%) |
| Within 80 ms | 86% | 69% | 69% |

| Tolerance | V2 | V3 | V4 |
| --- | ---: | ---: | ---: |
| 20 ms | 42% | 28% | 28% |
| 30 ms | 53% | 36% | 31% |
| 40 ms | 61% | 39% | 33% |
| 50 ms | 72% | 47% | 42% |
| 80 ms | 86% | 69% | 69% |

V2 is better on four of six recordings, while V3 is much better on one. V4 worsens the `recording` sample (46.9 ms to 65.5 ms) after moving one onset 55.7 ms earlier. The current 40 ms movement guard would not protect every good V3 case. These results reject blind boundary movement and threshold tuning as the primary fix.

Per-recording MAE from the replay is retained here as the named regression reference:

| Recording | V2 | V3 | V4 | Best |
| --- | ---: | ---: | ---: | --- |
| photograph-20260809 | 51.7 ms | 65.6 ms | 65.6 ms | V2 |
| photograph-20260811a | 23.0 ms | 90.4 ms | 90.4 ms | V2 |
| photograph-20260811b | 43.9 ms | 82.2 ms | 82.2 ms | V2 |
| photograph-20260811c | 58.5 ms | 58.2 ms | 58.2 ms | V3 |
| photograph-20260811d | 98.5 ms | 17.9 ms | 17.9 ms | V3 |
| recording-20260812 | 18.0 ms | 46.9 ms | 65.5 ms | V2 |

## Why analyze the spectrogram?

Spectral change can provide useful boundary evidence, but the cue must be selected from the surrounding phones. Fricatives and affricates benefit from sub-band spectral flux; stops need broadband change, closure/release energy, and voicing transition; nasal, liquid, glide, and vowel transitions need a combination of log-Mel variation, energy slope, and voicing change. The literature supports context-aware acoustic cues, not moving every boundary to the strongest spectral peak:

- [Yang & Tang, 2024](https://arxiv.org/abs/2409.09646) — spectral/temporal representations for speech boundary detection.
- [Baby et al., Interspeech 2017](https://www.isca-archive.org/interspeech_2017/baby17_interspeech.html) — acoustic boundary cues vary with phonetic context.
- [Dusan & Rabiner, 2006](https://www.isca-archive.org/interspeech_2006/dusan06_interspeech.html) — phone-transition boundary evidence is heterogeneous.
- [Huang et al., 2024](https://arxiv.org/abs/2406.02560) — learned boundary representations should use local context rather than a single universal peak.

The naive strongest-spectral-peak replay is therefore a named negative-control baseline, not the proposed production rule.

## Production CRM record-and-review mode

Add `Segmentation Study` inside the existing Pronunciation Samples area. Do not create another CRM page and do not change learner Pronounce behavior.

- Seed a fixed `study-v1` manifest of 100 unique clean-speech Oxford words: 25 each with 2, 3, 4, and 5 syllables. Each word has one authoritative IPA pronunciation and syllable split, with balanced stop, fricative/affricate, nasal, liquid/glide, and vowel transitions.
- Import the six historical sample pairs into a separate `Previous samples` queue, de-duplicated by WAV SHA-256. They do not count toward the 100 new recordings.
- Ask for the operator name once and retain it in that browser. A generated browser session ID distinguishes people sharing one CRM account.
- Reserve one word for ten minutes, heartbeat every two minutes, release on Skip, and return expired claims to the shared queue.
- Guide every task through `Record → Analyze → Check → Save → Next`. Preserve an audio recording when analysis fails and permit retry without re-recording.
- Show shared available, reserved, completed, uncertain, and failed counts.

## Review interface

Use four tabs: `V2`, `V3`, `V4`, and `Manual review`. All automatic versions are visible from the start and reports persist `automaticBoundariesVisible: true` so anchoring is disclosed.

Use one aligned timeline with waveform, a Hann-window Mel spectrogram, IPA syllable labels, whole-word and syllable playback, playback speed, boundary times, and analysis revision. Use WaveSurfer v7 Regions, Timeline, and Spectrogram plugins rather than an independent renderer. Manual review is contiguous phonological syllable segmentation with click placement, drag, Undo/Clear, coarse/fine keyboard movement, and a required `Certain` or `Unsure` decision. Uncertain recordings remain in the corpus but are excluded from the primary benchmark. Keep the mode full-width and flat; do not add nested card layers. Use proper tab semantics, visible focus, screen-reader status text, and text labels in addition to color.

## Admin APIs and saved data

Admin-only production and local-development equivalents are required:

| Interface | Behavior |
| --- | --- |
| `GET /api/admin/dev/segmentation-study/v1` | Manifest, progress, caller claim, and previous-sample queue |
| `POST /api/admin/dev/segmentation-study/v1/claim-next` | Transactionally reserve the next available word |
| `POST .../tasks/:taskId/heartbeat` | Extend only the caller's active reservation |
| `POST .../tasks/:taskId/release` | Release an unfinished task |
| `POST .../tasks/:taskId/complete` | Validate claim, WAV, metadata, and idempotently save the corpus sample |
| `POST /api/admin/dev/corpus-samples/:sampleId/manual-reviews` | Append an immutable review without re-uploading audio |

Store task state in `pronunciationSegmentationStudyTasks` with study version, word definition, order, transition classes, status, claim, expiry, operator, and completed sample ID. Store immutable reviews in a sample subcollection; update the active-review pointer and denormalized current segments transactionally. Reject stale claims, conflicting completions, mismatched syllable counts, non-contiguous reviews, and raw measurement-provenance mutations. Add only the required study-version/status/order index.

The dry-run-safe helper `scripts/audit/import-segmentation-study-previous-samples.js` seeds the 100 manifest tasks and uploads the six historical WAV/JSON pairs idempotently when a release operator explicitly passes `--apply`; it records hashes and preserves the legacy labels as historical provenance without treating them as the new contiguous review.

Extend `/analyze/compare` additively. Preserve `v2`, `v3`, and active `observed_syllables`; add `v3.analysis.partitionVariants.v3` for the pre-V4 snapshot and `.v4` for the post-V4 snapshot plus diagnostics. Build both snapshots before/after mutation so the tabs cannot alias the same array. Do not change raw CTC, nucleus, or measurement spans.

## Offline spectrogram reanalysis

The six historical recordings are a named regression set only; they never select parameters. The 100-word manifest is split into development (70: 18/18/17/17) and holdout (30: 7/7/8/8), with transition families balanced across both groups.

Extract deterministic features using 25 ms Hann windows, 5 ms hops, a 512-point zero-padded FFT, and 40 log-Mel bands from 0–8 kHz. Compare V2, exact V3-before-V4, exact current V4, naive strongest-spectral-peak, and a context-aware spectral candidate. Search only within the two neighboring vowel-nucleus centres intersected with ±80 ms around V3. Move a boundary only when the relevant context cues meet a prominence threshold and at least two cue families agree; otherwise retain V3.

Tune a fixed parameter grid on development words only. Select lexicographically by: development no-regression guard, lowest internal-boundary MAE, highest within-40-ms rate, and smallest movement from V3. Freeze the selected configuration and hash before loading holdout labels.

Count each shared internal boundary once; report word start/end separately. Report MAE, median, p90, maximum, signed bias, and within 20/30/40/80 ms. Generate versioned JSON, CSV, and Markdown outputs with aggregate metrics, per-word results, boundary-context results, selected/rejected corrections, configuration hash, and explicit before/after results for all six historical samples.

The candidate passes only if holdout MAE beats both V3 and V4, within-40-ms is at least the better baseline, a fixed-seed 10,000-resample word-cluster bootstrap has a positive 95% interval against both, no holdout word is more than 20 ms worse than V4, the historical aggregate beats both baselines, no historical sample is more than 10 ms worse than V4, and `recording` does not regress. A failed gate leaves the candidate offline. A passing gate triggers a separate learner-rollout plan; it does not automatically change Pronounce.

## Verification and rollout gates

Add coverage for manifest balance, metadata validation, immutable review history, claim collisions/expiry/release, idempotent completion, SHA de-duplication, independent V3/V4 snapshots, raw-span immutability, deterministic feature extraction, split/tuning/metrics/bootstrap calculations, and every acceptance gate. Run the existing V4, replay, corpus-route, comparison, frontend, and CRM suites.

Test the complete Chrome flow with Playwright using `C:\Cursor AI\.local\browser-test-credentials.md`, then confirm it in a live browser with screenshots: operator entry, claim/resume, recording, retry, all four tabs, aligned spectrogram, playback, manual keyboard editing, uncertainty exclusion, save/next, refresh recovery, and simultaneous-claim rejection.

Release only from a clean allowlisted commit. For a later production release, deploy `praat-api` as a zero-traffic Cloud Run candidate, test `/health` and `/analyze/compare`, verify IAM, promote that exact revision, and deploy only required Hosting, Functions, and Firestore index changes. Do not redeploy `phoneme-recognizer`. Seed the 100 tasks and import the six historical samples idempotently. Record Git SHA, Firebase releases, Cloud Run digest/revision, evidence, and rollback targets separately. Rollback code/traffic without deleting study data.

## Approved assumptions

- One shared CRM login; operators enter their names.
- One clean recording and immediate manual check per word.
- Exactly 100 unique words balanced across 2–5 syllables.
- Automatic V2/V3/V4 boundaries are visible before manual marking.
- No second-review stage; uncertain labels are excluded from primary scoring.
- Six historical samples are re-reviewed separately.
- CRM and comparison infrastructure may be released, but the experimental algorithm remains offline until every gate passes.
