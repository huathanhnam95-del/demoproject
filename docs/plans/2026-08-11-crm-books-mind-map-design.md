# CRM Books Mind Map Feature - Design Document

**Date:** 2026-08-11  
**Status:** Approved by User  
**Target Component:** CRM Books Workspace (`public/js/crm/books-workspace.js`, `public/crm-admin.html`, `public/crm-admin.css`, `functions/src/routes/admin/books.js`)

---

## 1. Requirement & Goals

The **CRM Books Notes** tab currently lists saved user notes chronologically as plain cards. Users need a way to synthesize these notes into a coherent visual structure.

**Key Requirements:**
1. **"🧠 Create Mind Map" Button**: Added to the top of the Notes tab in CRM Books.
2. **AI Semantic Grouping**:
   - Calls backend route `/api/admin/books/:bookId/mind-map`.
   - Uses Gemini AI to cluster saved notes by topic/theme, generating a structured mind map hierarchy: `Central Book Node -> Core Themes -> Subtopics -> Source Notes`.
   - Strictly subject to the CRM Books monthly AI budget check ($10/month limit + admin approval overage logic).
3. **Interactive Fullscreen Modal**:
   - Clicking "Create Mind Map" launches a full-screen modal container with a dark glassmorphic canvas background.
   - Dynamic SVG/HTML interactive node graph (Central concept -> Branch categories -> Note blocks).
   - Pan (drag canvas) & Zoom (+ / - / Fit / Reset controls).
   - Expand / Collapse category branches.
4. **Node Click Full Note Inspector**:
   - Clicking any note block/card in the mind map opens a slide-over/popover details panel inside the fullscreen modal showing the full note text, timestamp, and source reference.
5. **Caching & Persistence**:
   - Generated mind map structure cached in Firestore under `CRM_BOOKS/{bookId}/artifacts/mind_map` so reopening doesn't incur extra AI cost unless forced or new notes are added.

---

## 2. Architecture & Data Flow

```
[User clicks "Create Mind Map"]
            │
            ▼
[Check Local/Firestore Mind Map Cache] ──(Exists & Up to date?)──► [Render Mind Map Modal]
            │ (No or Stale/Regenerate)
            ▼
[POST /api/admin/books/:bookId/mind-map]
            │
  ┌─────────┴─────────┐
  │ Budget Check OK?  │
  └─────────┬─────────┘
            │ Yes
            ▼
[Gemini AI Structuring Prompt] ──► Returns JSON Hierarchy ──► Save to Firestore ──► [Render Modal]
```

### JSON Schema Output from AI:
```json
{
  "bookId": "string",
  "centralTopic": "Book / Topic Title",
  "generatedAt": 1786440000000,
  "nodes": [
    {
      "id": "theme_1",
      "title": "Theme Category Name",
      "color": "#4f46e5",
      "children": [
        {
          "id": "sub_1",
          "title": "Subtopic Title",
          "summary": "Brief summary",
          "noteId": "note_123",
          "fullText": "Original saved note text..."
        }
      ]
    }
  ]
}
```

---

## 3. UI/UX Specifications

- **Notes Tab Header**:
  - Insert `<button class="crm-btn crm-btn-secondary crm-books-mindmap-btn">🧠 Create Mind Map</button>` next to the notes count.
- **Fullscreen Modal (`#crm-books-mindmap-modal`)**:
  - Fixed full viewport (`100vw x 100vh`, z-index 10000).
  - Top Bar: Book Title, Node Count, "⚡ Regenerate", "Fit View", "Zoom In/Out", "Close (Esc)" button.
  - Main Canvas Area: Interactive SVG node graph with bezier curved connectors.
  - Side Inspector Drawer: Opens smoothly when a node block is clicked, showing:
    - Node Category Tag
    - Node Title & Summary
    - Full Saved Note Content (scrollable, formatted)
    - "Delete Note" / "Highlight Source" actions.

---

## 4. Verification Plan

1. Manual UI click test on Notes tab in CRM Books.
2. AI Budget enforcement check (exceeding budget returns budget banner / requires approval).
3. Mind Map SVG rendering: verify zoom, pan, expand/collapse, and click node to inspect note.
4. E2E browser test with Playwright.
