# Vocabulary Book Spec

**Status**: Implemented
**Owner**: Admin

## 1. Overview
>
> The Vocabulary Book is the user's personal word list: they can **bookmark words**, track **frequently missed** words, and push words into the **SRS** so weak vocabulary becomes durable.

## 2. Goals (The "Why")

- Let users "capture" new vocabulary at the moment of need.
- Turn mistakes into a structured backlog (missed -> review -> mastered).
- Keep vocab management fast and accessible from any mode.

## 3. Requirements (The "What")

### Functional

- Bookmark words from practice modes and from "missed word" harvests (excluding grammar/function words automatically).
- Maintain two key lists:
  - Bookmarks (user-curated, sortable by 'Date Added')
  - Frequently missed (system-curated from errors)
- Guest users can open the Vocabulary Book, manually add words, and continue to SRS without forced login.
- Integrate with SRS:
  - adding a word initializes SRS tracking for that lemma
  - SRS completion can promote a word to "mastered"
- Provide list management UI:
  - view/search/sort
  - remove from bookmarks

### Non-Functional

- Data must persist for authenticated users (Firestore) and for guests (local browser storage).
- UI must remain usable even when offline (cached view; writes may queue).
- Saves should be debounced and no-op guarded to reduce write pressure without dropping user edits.
- Firestore failures must be non-blocking for practice loops (log + keep local in-memory state interactive).

## 4. Data & Contracts (The "Contract")

- UI/module: `public/vocab-book.js`
- Persistence:
  - Firestore-backed for logged-in users.
  - Guest-local fallback cache: `localStorage['bel_guest_vocab_v1']`.
  - Debounced save flow (`saveTimeout`) with `beforeunload` flush to reduce lost updates on navigation.
  - Local in-memory cache (`vocabCache`) as immediate render source while async saves complete/fail.
- SRS integration:
  - Calls into the SRS module to initialize cards for new words.
  - On load, existing vocab entries are back-synced to SRS initialization to preserve review continuity.
- Guest behavior contract:
  - Guests can use manual-add/local vocab persistence.
  - Missed-word modal add remains login-gated (`showAddModal` returns early for unauthenticated sessions).

## 5. Rewards & Progression

- Vocab mastery can award points (e.g., mastering frequently missed words).
- Guest mode skips coin/point awards that require authenticated cloud writes.
- Vocab actions should be low-friction and never interrupt a practice loop with heavy modals.

## 6. Verification

- Manual:
  - Bookmark a word -> confirm it appears in the bookmarks list.
  - Miss the same word multiple times -> confirm it becomes "frequently missed".
  - As guest, use manual add -> refresh -> confirm data is restored from local guest cache.
  - Start SRS review -> confirm bookmarked words are included.
  - Simulate Firestore write failure -> confirm list updates stay visible and app remains usable.
  - Add/edit multiple words rapidly -> confirm debounced save behavior still persists final state.
  - Close tab shortly after edits -> confirm `beforeunload` flush prevents obvious data loss.
