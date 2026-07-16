# Corpus Pronunciation Version Sequence Design

**Goal:** Make every Oxford 5000 pronunciation word collect a deterministic sequence of five versioned attempts with clear, inline instructions and Previous/Next Version navigation.

## Sequence

1. **Clean** — say the word once naturally, clearly, with the reference syllable count and normal American-English stress.
2. **Omission** — say the word while intentionally omitting one target syllable; keep the remaining sounds audible and do not add another word.
3. **Insertion** — say the word while intentionally adding one extra syllable; keep the target word recognizable and do not add another word.
4. **Accented** — say every target syllable, but intentionally place the strongest stress on a non-primary syllable.
5. **Unrateable** — provide an unusable attempt (silence, heavy noise, or unintelligible speech) without speaking another word.

## UI behavior

- The instruction panel beside the metadata is the sole fixed-test instruction surface.
- It updates with the selected word and version, and includes the version name, expected count, and exact action.
- Category and expected-count controls remain read-only/disabled; the sequence controls their values.
- The recorder displays `Version N of 5` and provides Previous Version and Next Version controls.
- Saving is required before advancing. Navigating away from a captured-but-unsaved recording asks for confirmation.
- Each saved version remains an independent cloud sample and is available for per-sample analysis.

## Compatibility

Existing clean samples remain valid. The backend schema already accepts all five categories; this change only schedules the deterministic UI metadata and navigation. Existing Next Word, pagination, filtering, and analyzer behavior remain intact.

