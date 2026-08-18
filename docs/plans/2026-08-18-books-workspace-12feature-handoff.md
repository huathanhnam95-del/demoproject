# Mind Map & Books Workspace — 12-Feature Upgrade Handoff

**Date:** 2026-08-18  
**Branch:** `codex/mindmap-citation-repair`  
**Status:** All 4 phases complete (12/12 features)  
**Task Tracker:** #684 (Phase 1, Done), #685 (Phase 2, Done), #687 (Phase 3, Done), #688 (Phase 4, Done)

---

## Summary

12-feature upgrade across 4 phases, adding interactivity, reading enhancements, workspace layout, and collaboration to the CRM Books workspace. Study/retention features (flashcards, quizzes, spaced repetition) and Anki export were explicitly excluded by the user.

**Total diff:** +3,339 lines across 6 files.

---

## Phase 1 — Mind Map Interactivity (4 features) ✅

| # | Feature | Storage | Backend |
|---|---------|---------|---------|
| 1 | **Force-directed physics layout** | — | — |
| 2 | **AI node expansion** | — | New route + service |
| 3 | **Node commenting + emoji reactions** | `mindMapUserEdits` | Existing PATCH |
| 4 | **Idea voting + heatmap** | `mindMapUserEdits` | Existing PATCH |

**Feature 1 — Physics Layout**
- Toggle button `#crm-mindmap-physics-btn` in mind map header toolbar
- Velocity Verlet engine: Coulomb repulsion (`PHYSICS_REPULSION=120000`), Hooke spring (`PHYSICS_SPRING_K=0.005`), damping 0.88, center gravity
- `requestAnimationFrame` loop updates DOM positions + rebuilds SVG paths
- Drag pins nodes; central node permanently pinned; on toggle-off positions persist
- State: `physicsEnabled`, `physicsNodes[]`, `physicsEdges[]`, `physicsRAF`, `physicsDragNodeId`

**Feature 2 — AI Node Expansion**
- Context menu item "Expand with AI" → `expandNodeWithAI(nodeId)`
- Frontend: `apiPost('/api/admin/books/${bookId}/mind-map/expand', { nodeId, nodeTitle, nodeSummary, parentCategory })`
- Backend route: `POST /books/:bookId/mind-map/expand` in `books.js`
- Service function: `expandMindMapNode(db, bookId, nodeTitle, nodeSummary)` in `book-summary-service.js`
  - Uses `retrieveTopChunks()` for RAG context, then Gemini prompt to generate 3-5 child subtopics
  - Returns `{ subtopics: [{ title, summary, pageRef }], model }`
- Children created as `userNodes` with `parentId`, positioned in arc around parent, flagged `aiGenerated: true`
- Spinner animation class `.crm-mindmap-expanding` during generation

**Feature 3 — Comments + Reactions**
- 5 reactions: 💡🔥❓✅⭐ (`MINDMAP_REACTIONS` array)
- Inspector sections: `#crm-mindmap-inspector-reactions`, `#crm-mindmap-inspector-comments`
- Comment compose box with Post button; delete button per comment
- Data path: `mindMapUserEdits[nodeId].reactions` (object), `.comments[]` (array)
- Badge functions: `getReactionBadgeHtml(nodeId)`, `getCommentBadgeHtml(nodeId)` rendered on nodes

**Feature 4 — Voting + Heatmap**
- Upvote/downvote buttons in inspector; net vote badge on nodes
- Heatmap toggle `#crm-mindmap-heatmap-btn` → overlays vote intensity as CSS `--heat-intensity` variable
- Data path: `mindMapUserEdits[nodeId].votes` (object, key=memberId, value=+1 or -1)

---

## Phase 2 — Book Reading Enhancements (3 features) ✅

| # | Feature | Storage | Backend |
|---|---------|---------|---------|
| 5 | **Text highlighting + annotation** | localStorage per book | — |
| 6 | **Reading progress tracker** | localStorage per book | — |
| 7 | **Bookmark system** | localStorage global | — |

**Feature 5 — Text Highlighting**
- Select text on any page → floating color picker popup with 4 colors (`HIGHLIGHT_COLORS`)
- Creates `<mark class="crm-highlight">` with `--hl-color` CSS variable
- Stored in `localStorage` key `crm_books_highlights_{bookId}` → `{ [pageNum]: [{ id, text, color, createdAt }] }`
- Click a highlight to remove it; re-applied on every page navigation via `applyHighlightsToPage()`
- Uses `TreeWalker` + `Range.surroundContents()` for DOM wrapping

**Feature 6 — Reading Progress**
- Auto-tracks pages as read via `markPageRead()` called from `commitPageNavigation()`
- Progress bar on source panel book cards via `renderProgressBar(bookId, totalPages)`
- Heatmap grid in pages nav (`renderProgressHeatmap()`) — clickable cells per page
- Resume from last-read page on book reopen
- Stored in `localStorage` key `crm_books_progress_{bookId}`

**Feature 7 — Bookmark System**
- Bookmark toggle button in pages nav bar
- "All bookmarks" button opens slide-over panel (current book + other books)
- Click bookmark → jumps to page (cross-book navigation supported)
- Stored in `localStorage` key `crm_books_bookmarks`

---

## Phase 3 — Workspace Layout + Export (2 features) ✅

| # | Feature | Storage | Backend |
|---|---------|---------|---------|
| 8 | **Side-by-side page + chat view** | State var | — |
| 9 | **Research compilation document** | — | New route + service |

**Feature 8 — Split View**
- "Split" toggle button in pages nav → `splitViewEnabled` state
- `renderSplitView()` creates flex container: `.crm-books-split-page` + `.crm-books-split-divider` + `.crm-books-split-chat`
- Text selection in split-view page → "Send to Chat" floating button → prefills chat composer with quoted passage
- Auto-loads chat threads when split view is activated

**Feature 9 — Research Compilation**
- "Compile Research" button in Notes tab header
- `openCompilationModal()` → full-screen overlay with source selection (notes, highlights, mind map branches, chat messages) and preview pane
- Backend route: `POST /books/:bookId/compile` → `compileResearch(db, bookId, bookTitle, sources)` in `book-summary-service.js`
- Gemini synthesizes selected materials into structured Markdown
- Download as `.md` file via `downloadCompilation()`

---

## Phase 4 — Collaboration Infrastructure (3 features) ✅

| # | Feature | Storage | Backend |
|---|---------|---------|---------|
| 10 | **Cross-book knowledge graph** | Firestore `crmBookLinks` | 3 new routes |
| 11 | **Shareable mind map links** | Firestore `crmBookShares` | 2 new routes |
| 12 | **Shared book collections** | Firestore `crmBookCollections` | 4 new routes |

**Feature 10 — Knowledge Graph**
- "Knowledge Graph" button in sources panel → modal with SVG visualization
- Books rendered as circular nodes in radial layout, edges show links
- "Link Books" picker: select from/to books + label → `POST /api/admin/book-links`
- Links list with delete capability
- Backend routes: `GET/POST /book-links`, `DELETE /book-links/:linkId`
- New Firestore collection: `crmBookLinks`

**Feature 11 — Shareable Mind Map Links**
- "Share" button `#crm-mindmap-share-btn` in mind map modal header
- `shareMindMap()` → `POST /books/:bookId/mind-map/share` → generates 48-char hex token
- Creates snapshot of mind map data in `crmBookShares` collection with 30-day expiry
- Public read route: `GET /shared/mind-map/:token` (no admin auth required)
- Share URL copied to clipboard automatically

**Feature 12 — Shared Book Collections**
- "New Collection" button in sources panel → prompt for name
- Collection filter chips in sources panel: click to filter, delete to remove
- Backend routes: `GET/POST /book-collections`, `PATCH/DELETE /book-collections/:collectionId`
- New Firestore collection: `crmBookCollections` with `{ name, description, bookIds[], createdBy, createdAt }`

---

## Files Changed

| File | Lines | What |
|------|-------|------|
| `public/js/crm/books-workspace.js` | +1,742 | All 12 features frontend |
| `public/crm-admin.css` | +1,137 | All 12 features styling + dark mode |
| `functions/src/routes/admin/books.js` | +213 | 9 new routes (expand, compile, links, shares, collections) |
| `functions/src/crm/book-summary-service.js` | +306 | expandMindMapNode, compileResearch, prompts |
| `public/crm-admin.html` | +42 | Physics/Heatmap/Share buttons, context menu, inspector sections, source actions |
| `functions/src/crm/collections.js` | +6 | 3 new collection constants |

---

## New Backend Routes

| Method | Path | Feature | Auth |
|--------|------|---------|------|
| POST | `/books/:bookId/mind-map/expand` | AI node expansion | Admin |
| POST | `/books/:bookId/compile` | Research compilation | Admin |
| GET | `/book-links` | List cross-book links | Admin |
| POST | `/book-links` | Create cross-book link | Admin |
| DELETE | `/book-links/:linkId` | Delete cross-book link | Admin |
| POST | `/books/:bookId/mind-map/share` | Generate share token | Admin |
| GET | `/shared/mind-map/:token` | Read shared mind map | Public |
| GET | `/book-collections` | List collections | Admin |
| POST | `/book-collections` | Create collection | Admin |
| PATCH | `/book-collections/:collectionId` | Update collection | Admin |
| DELETE | `/book-collections/:collectionId` | Delete collection | Admin |

---

## New Firestore Collections

| Collection | Purpose | Schema |
|------------|---------|--------|
| `crmBookLinks` | Cross-book knowledge graph edges | `{ sourceBookId, sourceNodeId, sourceTitle, targetBookId, targetNodeId, targetTitle, label, createdBy, createdAt }` |
| `crmBookShares` | Shareable mind map snapshots (doc ID = token) | `{ bookId, bookTitle, token, expiresAt, mindMapSnapshot, createdBy, createdAt }` |
| `crmBookCollections` | Named groups of books | `{ name, description, bookIds[], createdBy, createdAt, updatedAt }` |

---

## Architecture Notes

- **Data persistence pattern**: Phase 1 mind map features use `mindMapUserEdits` → auto-saved via `scheduleMindMapAutoSave()` → PATCH to Firestore. Phase 2 features use `localStorage` only. Phase 4 features use dedicated Firestore collections via API routes.
- **Team members**: 4 color-coded members stored in `localStorage`, not real multi-user Firestore collaboration.
- **Physics engine**: Central node permanently pinned. Frame-skips SVG rebuild to every 3rd frame for performance.
- **AI expansion**: Uses same `retrieveTopChunks()` RAG pipeline as chat. Gemini prompt constrained to book excerpts only.
- **Highlighting**: Uses `TreeWalker` + `Range.surroundContents()` — handles single-element text selections. Multi-element cross-boundary selections will silently skip.
- **Share links**: 30-day expiry. Mind map data is snapshotted at share time (not live). Public route has no admin auth.
- **CLAUDE.md compliance**: No nested card structures introduced anywhere.

---

## Verification Summary

| Check | Result |
|-------|--------|
| `node -c books-workspace.js` | Pass |
| `node -e "require('./book-summary-service')"` | Pass |
| `node -e "require('./collections')"` | Pass |
| Phase 1 CSS rules | 37 loaded |
| Phase 2 CSS rules | 34 loaded |
| Phase 3 CSS rules | 33 loaded |
| Phase 4 CSS rules | 33 loaded |
| Phase 1 HTML elements | 8/8 present |
| Phase 4 HTML elements | 4/4 present (KG btn, Collection btn, filter area, Share btn) |
| JS module exports | `CrmBooksWorkspace.createController` confirmed |
| Console errors from workspace | 0 |

---

## How to Test

1. Start dev server: `npx http-server public -p 8088 -c-1`
2. Navigate to `http://localhost:8088/crm-admin.html`
3. Log in with admin credentials (see `.local/browser-test-credentials.md`)
4. Navigate to **Books** tab

**Phase 1** (Mind Map): Open book → Mind Map → Physics toggle, right-click "Expand with AI", inspector votes/reactions/comments, Heatmap toggle

**Phase 2** (Pages): Open book → Pages → select text for highlighting, navigate pages for progress tracking, bookmark button, "All bookmarks" panel

**Phase 3** (Split/Compile): Pages tab → "Split" toggle for side-by-side view, select text → "Send to Chat". Notes tab → "Compile Research" button

**Phase 4** (Collaboration): Sources panel → "Knowledge Graph" button, "New Collection" button, collection filter chips. Mind Map → "Share" button

---

## Excluded (per user request)

- Flashcards / quizzes / spaced repetition
- Study timer
- Anki export
