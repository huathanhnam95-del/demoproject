# Pronunciation Reference UX Design

## Goal

Prevent dictionary senses without pronunciation evidence from becoming selectable pronunciation variants, keep the feature strictly en-US, and replace the dense pattern sentence with a learner-friendly stress summary.

## Confirmed causes

- Merriam-Webster can return an exact dictionary entry with a definition and no `hwi.prs`. The backend currently fabricates a zero-syllable conflicted variant for that metadata-only entry.
- The frontend renders every returned variant, including conflicts, as an enabled pronunciation choice.
- Merriam-Webster labels non-US pronunciations in each pronunciation record (for example `l: "British"`), but the backend drops that label and publishes the result inside an `en-US` response.
- In the fixed 100-word production audit, 44 words contained 60 conflicted variants; 54 were `MISSING_IPA` records alongside at least one valid pronunciation.

## Data design

The v2 `variants` array remains evidence-preserving: conflict records may remain in the API for diagnostics and audits. The learner-facing selectable set is narrower and contains only variants whose validation status is `valid`, whose source is an exact entry, and whose dialect is compatible with en-US.

The backend will retain the source pronunciation label while extracting Merriam-Webster records. Pronunciations explicitly labeled `British` are excluded from the en-US reference. Metadata-only entries remain conflict evidence and are never used to infer IPA, audio, count, or stress across parts of speech.

This means `photograph` exposes one selectable en-US noun pronunciation. Its metadata-only verb sense is not shown as a pronunciation choice. The validated pronunciation remains usable for practising the word; the UI does not imply that a dictionary sense is itself a separate sound.

## Stress authority

Stress remains source-faithful American English. For `photograph`, Merriam-Webster and Oxford Advanced American both mark secondary stress on `GRAPH`, so the canonical reference stays `/ˈfoʊtəˌɡræf/`, primary stress index `0`, secondary stress index `2`.

The UI makes primary stress visually dominant and secondary stress subordinate. It does not silently discard secondary stress.

## UI design

The pronunciation summary is a flat section inside the existing parent surface:

- A prominent IPA transcription.
- Compact facts: `3 syllables`, `Primary stress: PHO`, and `Secondary: GRAPH`.
- A syllable strip derived from canonical syllable objects: `PHO · to · GRAPH`.
- Primary stress uses the brand blue and strongest weight; secondary stress uses a quieter violet outline; unstressed syllables use neutral styling.
- A visually hidden sentence communicates the same information to screen readers.
- At narrow widths, facts and syllables wrap without overlapping or forcing the long two-column line seen in the production screenshot.

The pronunciation selector renders only selectable variants. If one remains, the selector is hidden. If multiple valid en-US variants remain, each button includes part of speech and IPA, with `aria-pressed` reflecting selection.

## Failure behavior

If no valid variant exists, the existing fail-closed unavailable state remains. Recording, scoring, native graphs, and detailed feedback stay disabled. Conflict evidence never becomes a clickable blank state.

## Verification

- Backend unit tests cover British filtering, preservation of metadata-only conflict evidence, and the `photograph` payload.
- Frontend logic tests cover selectable-variant filtering and stress-summary modeling.
- DOM/browser checks cover `photograph`, one-variant selector hiding, semantic stress rendering, keyboard state, and narrow layouts.
- The fixed 100-word audit must have zero incorrect scoreable results and zero selectable conflicted variants.

