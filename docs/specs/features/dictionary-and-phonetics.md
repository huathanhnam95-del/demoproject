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
- Lookup failures must degrade to partial/empty result objects (not uncaught exceptions in the learner UI).
- In-flight request deduplication should prevent duplicate external calls for the same normalized word.

## 4. Data & Contracts (The "Contract")

- Client dictionary service: `public/dictionary-service.js`
  - Definition path:
    - Primary: Wiktionary REST API
    - Fallback: dictionaryapi.dev
  - Translation path (ordered):
    - local dictionary overrides
    - `/api/tracau` proxy (rich translation + example sentences)
    - Wiktionary Vietnamese endpoint (kept in chain, currently reliability-limited)
    - Glosbe API
    - MyMemory API
  - Fallback sources:
    - empty-safe object return when all sources fail
  - Caches in `localStorage`:
    - definitions: `vocab_definitions_cache`
    - translations: `vocab_translations_cache`
  - Request dedupe contracts:
    - `tracauInFlight` suppresses duplicate `/api/tracau` calls
    - `upgradeInFlight` suppresses duplicate cache-upgrade jobs
- Collocations:
  - Local dataset: `public/collocations.json`
  - Optional online expansion (e.g., Datamuse) when online.
- Phonetics helpers:
  - `public/phonetics.js` (dictionary API lookup + CMU/heuristic fallback + in-memory cache)
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
  - Disable network and look up a cached word -> verify instant cache response.
  - Disable network and look up an uncached word -> verify graceful empty/partial result (no practice-loop crash).
  - Force `/api/tracau` failure -> verify translation chain falls through and UI remains responsive.
