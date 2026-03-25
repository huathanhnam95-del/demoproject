# Read Aloud Connected-Speech Validation Protocol

## Scope

This protocol validates the current connected-speech screen as a provisional event-level diagnostic tool.

It does not validate:

- a global connected-speech score
- pass/fail decisions
- dialect coverage outside General American
- MFA performance

## Labels

Use the following human labels for each event:

- `detected`
- `not_detected`
- `uncertain`
- `not_rateable`

Use `not_rateable` when the clip cannot be judged because of:

- clipping
- truncation
- silence-only audio
- severe noise
- missing or unusable timing evidence

## Rater Rules

- Rate the event family, not the learner overall.
- Prefer abstention over forced judgment when the evidence is weak.
- If the prompt has repeated words, use the event index and not the word string alone.
- If punctuation or a hard boundary breaks the candidate link, do not force a positive label.

## Dataset Requirements

The validation dataset must include:

- all supported event families
- both clear positives and clear negatives
- at least some `uncertain` and `not_rateable` examples
- multiple prompts, not only one prompt family

## CSV Schema

Required columns:

```text
attemptId,questionId,eventId,family,phrase,referenceText,recognizedText,systemStatus,humanLabel,raterNotes,audioStatus,workerStatus,audioQualityReason,audioQualityPassed,leftWord,rightWord,startMs,endMs,gapMs,leftAccuracy,rightAccuracy,relativeDuration,variant
```

## Metrics

Run:

```bash
node scripts/evals/read-aloud-connected-speech-metrics.js data/evals/read-aloud-connected-speech/template.csv
```

Track at minimum:

- per-family counts of `detected`, `not_detected`, `uncertain`, and `not_rateable`
- agreement rate where `humanLabel` is present
- abstention rate per family
- top disagreement rows
- coverage of audio-quality failures and worker failures
- audio-quality reason coverage so `not_rateable` can be separated from worker/network failures

## Launch Guidance

Promote a family only if:

- the detector is stable on its curated prompt set
- false positives are lower than the heuristic baseline
- abstention is used for ambiguous clips instead of confident guesses
- the learner feedback remains understandable and not punitive
