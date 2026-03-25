# Pronunciation Test Validation Protocol

## Scope

This protocol validates the v1 segmental screening flow as a provisional diagnostic screen.

It does not validate:

- prosody or suprasegmentals
- pass/fail decisions
- score remapping
- summative claims

## Human Rating Rubric

Rate the target phoneme only.

- `1`: clearly incorrect target sound
- `2`: mostly incorrect
- `3`: borderline
- `4`: mostly correct
- `5`: clearly correct target sound

## Rater Rules

- Use at least 2 human raters.
- Raters must have prior phonetic-rating experience or documented training on the rubric.
- Focus on the target segment, not accent likability.
- Mark `needs_adjudication=true` when raters differ by `2` points or more.

## Dataset Requirements

The validation dataset must include:

- both vowel and consonant target classes
- native-control recordings and Vietnamese learner recordings
- multiple speakers per contrast, not repeated tokens from one speaker
- enough rows to support stable correlation estimates

Minimum launch-review bar:

- `20+` scored rows before reading correlation output at all
- `5+` scored rows per contrast before treating a per-contrast mean as stable

## Data Capture

Required CSV schema:

```text
speaker_id,item_id,contrast_id,target_phoneme,azure_score,azure_top_candidate,human_rater_1,human_rater_2,heard_label_r1,heard_label_r2,needs_adjudication,notes
```

Allowed `heard_label_*` values:

- `target`
- `paired_contrast`
- `deleted_final`
- `epenthesis`
- `other`

## Metrics

Run:

```bash
node scripts/evals/pronunciation-test-metrics.js data/evals/pronunciation-test/template.csv
```

Track at minimum:

- Pearson correlation between Azure score and mean human score
- Spearman correlation between Azure score and mean human score
- adjudication rate
- per-contrast Azure mean
- per-contrast human mean
- heard-label confusion summary
- top disagreement items

## Launch Gate

The screen can ship only as a provisional diagnostic tool until a completed validation review exists.

Do not:

- remap raw scores
- assign pass/fail
- claim validated assessment accuracy
