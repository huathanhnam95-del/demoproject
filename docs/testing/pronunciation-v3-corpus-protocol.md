# Pronunciation Segmentation V3 — Evaluation Corpus Protocol

## 1. Purpose

This document defines the evaluation corpus used to validate the **phoneme-based syllable segmentation v3** pipeline. The corpus provides ground-truth labels for measuring segmentation accuracy across clean speech, adversarial edge-cases, and accented speakers.

## 2. Manifest Schema

Each row in the corpus manifest (`manifest.json`) contains:

| Field               | Type          | Description                                                       |
|---------------------|---------------|-------------------------------------------------------------------|
| `sampleId`          | string        | Deidentified ID (`^[a-z0-9\-]+$`). Never contains PII.           |
| `targetWord`        | string        | The word the speaker was prompted to say.                         |
| `referenceIpa`      | string        | Canonical IPA transcription for the target word.                  |
| `expectedObservedCount` | integer   | Expected number of syllables observed in the recording.           |
| `targetSyllableCount` | integer     | Independently verified canonical syllable count for the prompt.   |
| `category`          | enum          | One of: `clean`, `omission`, `insertion`, `accented`, `unrateable`. |
| `speakerCohort`     | string        | Speaker group descriptor (never a name or account ID).            |
| `sourceHash`        | string        | SHA-256 hash of the source audio file for provenance.             |
| `labelProvenance`   | enum          | How the label was created: `manual`, `deterministic-transform`, or `automated`. |
| `verifiedSpans`     | array \| null | Optional array of `{start, end}` time-span objects (seconds).     |

The full JSON Schema is at `tests/fixtures/pronunciation-segmentation/manifest.schema.json`.

## 3. Privacy Rules

- **Raw recordings are stored outside the repository.** Only hashes and deidentified metadata are committed.
- **No PII** may appear in the manifest — no names, email addresses, account IDs, or device identifiers.
- Speaker cohort descriptors must be generalised (e.g., `"L1-Vietnamese"`, `"child-7-9"`), never identifying.
- Audio files referenced by `sourceHash` must be stored in a secure, access-controlled location documented in the team's internal wiki.

## 4. Corpus Composition

The corpus targets **120 samples** across three tiers:

| Tier          | Count | Description                                                    |
|---------------|-------|----------------------------------------------------------------|
| **Clean**     | 60    | Native or near-native speakers, clear articulation, low noise. |
| **Adversarial** | 30 | Deliberate edge-cases: omissions, insertions, hesitations, background noise. |
| **Accented**  | 30    | Non-native speakers representing diverse L1 backgrounds.       |

### 4.1 Mandatory Prompts

Every corpus version **must** include at least one sample for each of the following words (expected syllable counts in parentheses):

| Word           | Expected Syllables |
|----------------|-------------------|
| busy           | 2                 |
| photograph     | 3                 |
| photography    | 4                 |
| banana         | 3                 |
| camera         | 2                 |
| university     | 5                 |

These words were chosen to exercise varied syllable counts, common reduction patterns, and stress-shift pairs (`photograph` / `photography`).

## 5. L2-ARCTIC Usage Restrictions

If samples are sourced from the [L2-ARCTIC corpus](https://psi.engr.tamu.edu/l2-arctic-corpus/):

- Adhere to the L2-ARCTIC licence terms (research use only, attribution required).
- Do **not** redistribute raw audio inside this repository.
- Record the L2-ARCTIC speaker ID in `speakerCohort` using the published anonymised codes (e.g., `"l2arctic-SVBI"`).
- Set `labelProvenance` to `"deterministic-transform"` when labels are derived algorithmically from L2-ARCTIC's forced-alignment annotations.

## 6. Versioning and Provenance

- The manifest carries a **semantic version** (`version` field). Increment the minor version when adding samples; increment the major version for schema-breaking changes.
- `createdAt` records the ISO 8601 timestamp of manifest generation.
- Every entry's `sourceHash` (SHA-256) provides an immutable link to the exact audio file used, enabling reproducibility even if filenames change.
- Changes to the manifest should be committed alongside a summary in the repository's changelog.
- Automated builds (`scripts/audit/build-pronunciation-segmentation-corpus.py`) regenerate the manifest from source audio and validate it against the JSON Schema before committing.
