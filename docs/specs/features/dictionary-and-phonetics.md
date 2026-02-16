# Dictionary & Phonetics Spec

**Status**: Implemented
**Owner**: Admin

## 1. Overview
>
> Provide fast, learner-friendly word support: **definitions**, **Vietnamese translations**, **example sentences**, **collocations**, and **phonetics** (IPA / pronunciation helpers) across practice modes and the Writing Challenge.

## 2. Goals (The "Why")

- Reduce lookup friction so users stay in the practice loop.
- Teach usage (examples + collocations), not just meaning.
- Keep lookups cached and resilient to API failures.

## 3. Requirements (The "What")

### Functional

- English definition lookup (with part-of-speech support when available).
- Vietnamese translation lookup with sentence examples when available.
- Collocation support:
  - local collocations dataset
  - optional online collocation expansion (when online)
- Phonetics support:
  - IPA/phonetic displays where available
  - helpers for mapping between phonetic systems (ARPAbet/IPA)

### Non-Functional

- Performance: cache aggressively (localStorage) to avoid repeated API calls.
- Resilience: multiple fallbacks per lookup path; never block the main loop.

## 4. Data & Contracts (The "Contract")

- Client dictionary service: `public/dictionary-service.js`
  - Primary sources:
    - Definitions: Wiktionary REST API
    - Translations: Glosbe API
  - Fallback sources:
    - Definitions: dictionaryapi.dev
    - Translations: MyMemory API
  - Includes local dictionary overrides for very common words.
  - Caches in `localStorage` (definitions + translations).
- Collocations:
  - Local dataset: `public/collocations.json`
  - Optional online expansion (e.g., Datamuse) when online.
- Phonetics helpers:
  - `public/phonetics.js`
  - `public/arpabet-ipa-map.js`
  - `public/cmudict.json`
- Optional local services (advanced / dev tooling):
  - Flask endpoints in `backend/local_server/server.py` (e.g., additional dictionary/sentences helpers and audio analysis).

## 5. Taste Invariants (The "How")

- Prefer "good enough instantly" over "perfect after 5 seconds".
- Show sources and be transparent about fallbacks (when practical in UI).

## 6. Verification

- Manual:
  - Look up a frequent word (should hit local cache fast).
  - Look up an uncommon word (should hit external sources, then cache).
  - In Writing Challenge, open "More help" and confirm examples/collocations render.
