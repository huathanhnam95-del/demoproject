# Mind Map Visual Upgrade — Handoff Plan

**Date:** 2026-08-16
**Status:** Pending Approval
**Target Files:**
- `public/crm-admin.css` (lines 5754–7416 — mind map section)
- `public/js/crm/books-workspace.js` (lines 2454–2834 — rendering + SVG)

---

## Problem Statement

The CRM Books mind map is functional but visually flat and lifeless:

| What | Current State | Problem |
|---|---|---|
| Nodes | All-white cards, identical look | No visual hierarchy, no personality |
| Connections | 1–1.8px, opacity 0.22–0.28 | Nearly invisible, feel disconnected |
| Central node | White card + 3px gradient top bar | Doesn't stand out as the focal point |
| Hover | `translateY(-1px)` lift only | Barely noticeable, no relationship context |
| Entrance | Instant `innerHTML` replace | Nodes pop in abruptly, no sense of flow |
| Background | Static dot grid | Canvas feels inert |
| Click | No feedback animation | Clicks feel unresponsive |

---

## Design Constraint Compliance

**CLAUDE.md Rule — "Avoid Nested Card Structures":**
All 7 upgrades modify existing DOM elements via CSS properties, pseudo-elements (`::before`, `::after`), and JS class toggling. Zero new wrapper divs. Zero structural nesting changes.

**Dark Mode:**
Every upgrade must respect the existing `--mm-*` CSS variable system. Light mode values on `.crm-books-mindmap-modal`, dark overrides on `.crm-books-mindmap-modal.books-dark`. The dark mode override at line 7165 already redefines all tokens — new animations must use these tokens, not hardcoded colors.

**Existing dark path override at line 7355:**
```css
.books-dark .crm-mindmap-svg path { stroke: rgba(255,255,255,0.1); }
```
This blanket rule overrides all SVG path strokes in dark mode. Upgrades 2 and 3 (which modify path strokes) must account for this by using inline `stroke` attributes or more specific selectors.

---

## Upgrade 1: Staggered Node Entrance Animations

**What:** Nodes cascade in with spring physics when the mind map renders.

**CSS additions** (add after line 5956, within `.crm-mindmap-node` block):

```css
/* New keyframe */
@keyframes mmNodeEntrance {
  0% { opacity: 0; transform: scale(0.6); }
  60% { transform: scale(1.04); }
  100% { opacity: 1; transform: scale(1); }
}

/* Applied via class */
.crm-mindmap-node.mm-entering {
  opacity: 0;
  animation: mmNodeEntrance 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
```

**JS changes** in `renderMindMapNodes()` (around line 2792, after `canvas.innerHTML = canvasHtml`):

```javascript
// After setting innerHTML, stagger entrance animations
const allNodes = canvas.querySelectorAll('.crm-mindmap-node');
allNodes.forEach((node, i) => {
  node.classList.add('mm-entering');
  const isCentral = node.classList.contains('central');
  const isCat = node.classList.contains('category');
  // Central: 0ms, categories: 80ms base, subtopics: 160ms base
  const baseDelay = isCentral ? 0 : (isCat ? 80 : 160);
  node.style.animationDelay = `${baseDelay + i * 40}ms`;
  node.addEventListener('animationend', () => {
    node.classList.remove('mm-entering');
    node.style.animationDelay = '';
  }, { once: true });
});
```

**SVG connection draw-in** — add to `rebuildSVGPaths()` after `svg.innerHTML = pathsHtml` (line 2549):

```css
@keyframes mmPathDraw {
  from { stroke-dashoffset: var(--path-length); }
  to { stroke-dashoffset: 0; }
}

.crm-mindmap-svg path:not(.crm-mindmap-conn-hitarea) {
  animation: mmPathDraw 0.6s ease-out forwards;
}
```

```javascript
// After svg.innerHTML = pathsHtml (line 2549):
svg.querySelectorAll('path:not(.crm-mindmap-conn-hitarea)').forEach(path => {
  const len = path.getTotalLength();
  path.style.setProperty('--path-length', len);
  path.style.strokeDasharray = len;
  path.style.strokeDashoffset = len;
});
```

**Constraint:** Only animate on first render, not on `preserveTransform = true` (drag/collapse re-renders). Gate with a flag.

---

## Upgrade 2: Animated Flowing Connections

**What:** SVG paths become thicker, more visible, with flowing dash animation.

**CSS additions** (add after `.crm-mindmap-svg` block, ~line 5941):

```css
@keyframes mmFlowDash {
  to { stroke-dashoffset: -20; }
}

.crm-mindmap-svg path:not(.crm-mindmap-conn-hitarea):not(.crm-mindmap-custom-conn) {
  stroke-dasharray: 6, 4;
  animation: mmFlowDash 1.2s linear infinite;
}
```

**JS changes** in `rebuildSVGPaths()`:

| Line | Current | New |
|---|---|---|
| 2486 | `stroke-width="1.8" ... opacity="0.28"` | `stroke-width="2.5" ... opacity="0.4"` |
| 2498 | `stroke-width="1" stroke-dasharray="4,6" ... opacity="0.22"` | `stroke-width="1.5" ... opacity="0.35"` (remove inline dasharray — CSS handles it) |
| 2538 | `stroke-width="2" ... opacity="0.55"` | `stroke-width="2.5" ... opacity="0.65"` |

**Dark mode:** The blanket `.books-dark .crm-mindmap-svg path` rule (line 7355) overrides inline strokes. Change it to only target non-colored structural paths, or remove it entirely since paths already carry their category color inline.

---

## Upgrade 3: Rich Node Hover & Branch Highlighting

**What:** Hovering a node highlights its entire branch and dims everything else.

**CSS additions** (add after `.crm-mindmap-node:hover` block, ~line 5963):

```css
.crm-mindmap-node:hover {
  transform: translateY(-2px) scale(1.02);
  box-shadow: 0 8px 24px rgba(0,0,0,0.1), 0 0 0 1px var(--node-color, var(--mm-accent));
  z-index: 20;
}

/* When any node is hovered, dim non-related nodes */
.crm-mindmap-canvas.mm-branch-highlight .crm-mindmap-node {
  opacity: 0.3;
  transition: opacity 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
}
.crm-mindmap-canvas.mm-branch-highlight .crm-mindmap-node.mm-branch-active {
  opacity: 1;
}

/* Selected/active node pulse */
.crm-mindmap-node.mm-selected {
  box-shadow: 0 0 0 2px var(--node-color, var(--mm-accent)),
              0 0 16px rgba(79,70,229,0.2);
}
```

**JS additions** — new function + mouseenter/mouseleave handlers:

```javascript
function highlightBranch(nodeId) {
  const canvas = docQs('#crm-mindmap-canvas');
  if (!canvas) return;
  
  // Find related nodes: parent, siblings, children
  const related = new Set([nodeId, 'central']);
  const cats = currentMindMapData?.categories || [];
  
  cats.forEach((cat, ci) => {
    const catId = cat.id || `cat_${ci}`;
    const subs = (cat.subtopics || []).map((s, si) => s.id || `sub_${ci}_${si}`);
    
    if (catId === nodeId || subs.includes(nodeId)) {
      related.add(catId);
      subs.forEach(s => related.add(s));
    }
  });
  
  // User node connections
  mindMapUserNodes.forEach(un => {
    if (un.id === nodeId || un.parentId === nodeId) {
      related.add(un.id);
      if (un.parentId) related.add(un.parentId);
    }
  });
  
  canvas.classList.add('mm-branch-highlight');
  canvas.querySelectorAll('.crm-mindmap-node').forEach(n => {
    n.classList.toggle('mm-branch-active', related.has(n.dataset.nodeId));
  });
}

function clearBranchHighlight() {
  const canvas = docQs('#crm-mindmap-canvas');
  if (!canvas) return;
  canvas.classList.remove('mm-branch-highlight');
  canvas.querySelectorAll('.mm-branch-active').forEach(n => n.classList.remove('mm-branch-active'));
}
```

**Bind in `renderMindMapNodes()`** after line 2792 (after `canvas.innerHTML`):

```javascript
canvas.querySelectorAll('.crm-mindmap-node').forEach(node => {
  node.addEventListener('mouseenter', () => highlightBranch(node.dataset.nodeId));
  node.addEventListener('mouseleave', clearBranchHighlight);
});
```

**Constraint:** Disable branch highlighting during drag (`isMindMapPanning` or `mindMapNodeDrag` active).

---

## Upgrade 4: Vibrant Central Node

**What:** The central node becomes the unmistakable focal point with animated gradient border, glow aura, and larger presence.

**CSS changes** — replace `.crm-mindmap-node.central` block (lines 5972–5998):

```css
.crm-mindmap-node.central {
  background: var(--mm-node-bg);
  border: none;
  border-left: none;
  color: var(--mm-node-text);
  font-weight: 800;
  font-size: 1.1rem;
  text-align: center;
  padding: 24px 36px;
  border-radius: 18px;
  box-shadow: 0 4px 20px rgba(79,70,229,0.12), 0 0 60px rgba(79,70,229,0.06);
  position: relative;
  overflow: visible;
}

/* Animated gradient border via pseudo-element */
.crm-mindmap-node.central::before {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 20px;
  background: conic-gradient(from var(--mm-central-angle, 0deg),
    #4F46E5, #7C3AED, #EC4899, #F59E0B, #10B981, #4F46E5);
  z-index: -1;
  animation: mmCentralRotate 6s linear infinite;
  opacity: 0.7;
}

/* Inner background mask */
.crm-mindmap-node.central::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 18px;
  background: var(--mm-node-bg);
  z-index: -1;
}

@keyframes mmCentralRotate {
  to { --mm-central-angle: 360deg; }
}

/* Register the custom property for animation */
@property --mm-central-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}

.crm-mindmap-node.central:hover {
  box-shadow: 0 8px 32px rgba(79,70,229,0.2), 0 0 80px rgba(79,70,229,0.1);
}
```

**JS change** in `renderMindMapNodes()` — increase central node width:

| Line | Current | New |
|---|---|---|
| 2688 | `const centralW = 300;` | `const centralW = 340;` |

**Dark mode addition** (add near line 7186):

```css
.books-dark .crm-mindmap-node.central {
  box-shadow: 0 4px 20px rgba(129,140,248,0.15), 0 0 60px rgba(129,140,248,0.08);
}
.books-dark .crm-mindmap-node.central::before {
  opacity: 0.5;
}
.books-dark .crm-mindmap-node.central:hover {
  box-shadow: 0 8px 32px rgba(129,140,248,0.25), 0 0 80px rgba(129,140,248,0.12);
}
```

**Fallback:** `@property` is not supported in Firefox < 128. Add a static gradient border fallback via `@supports not (animation-name: mmCentralRotate)` that shows a non-rotating gradient border instead.

---

## Upgrade 5: Color-Tinted Node Cards

**What:** Category nodes get a subtle background tint of their assigned color. Subtopics inherit a lighter tint.

**JS changes** in `renderMindMapNodes()` — modify the node HTML generation.

For **category nodes** (~line 2730), add inline style:

```javascript
// Add to the style attribute of .category nodes:
`background: linear-gradient(135deg, ${catColor}08, ${catColor}03);`
```

For **subtopic nodes** (~line 2764), add inline style:

```javascript
// Add to the style attribute of .subtopic nodes:
`background: linear-gradient(135deg, ${subColor}06, ${subColor}02);`
```

**CSS change** — remove the static `background: var(--mm-node-bg)` from `.category` and `.subtopic` rules (lines 6001, 6007) since inline styles will provide the tinted background. Keep them as fallbacks via `background` shorthand on the node base class.

**Dark mode:** The inline hex+alpha notation (`#4f46e508`) works in all modern browsers. Dark mode overrides at lines 7202–7207 currently force `background: var(--mm-node-bg) !important` — these must be updated to use tinted dark backgrounds instead:

```css
.books-dark .crm-mindmap-node.subtopic {
  /* Remove !important override — let inline tints show through */
}
.books-dark .crm-mindmap-node.user-node {
  /* Keep amber tint */
}
```

For dark mode, the JS should detect the `.books-dark` class and use higher-opacity tints (`0A` instead of `08`) since the dark background absorbs more color.

---

## Upgrade 6: Interactive Ripple & Click Effects

**What:** Material-style ripple on click, elastic bounce on drag drop, pop-in for new nodes.

**CSS additions:**

```css
/* Click ripple */
.crm-mindmap-node {
  overflow: hidden; /* contains ripple */
  position: relative;
}

.crm-mindmap-ripple {
  position: absolute;
  border-radius: 50%;
  background: var(--node-color, var(--mm-accent));
  opacity: 0.15;
  transform: scale(0);
  animation: mmRipple 0.5s ease-out forwards;
  pointer-events: none;
}

@keyframes mmRipple {
  to { transform: scale(3); opacity: 0; }
}

/* Drag drop bounce */
@keyframes mmDropBounce {
  0% { transform: scale(1.06); }
  40% { transform: scale(0.97); }
  70% { transform: scale(1.01); }
  100% { transform: scale(1); }
}

.crm-mindmap-node.mm-drop-bounce {
  animation: mmDropBounce 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

/* New node pop-in */
@keyframes mmNodePop {
  0% { opacity: 0; transform: scale(0.3); }
  50% { transform: scale(1.1); }
  70% { transform: scale(0.95); }
  100% { opacity: 1; transform: scale(1); }
}

.crm-mindmap-node.mm-pop-in {
  animation: mmNodePop 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
```

**JS — Ripple** (add to node click handler area):

```javascript
function createRipple(node, e) {
  const rect = node.getBoundingClientRect();
  const ripple = document.createElement('span');
  ripple.className = 'crm-mindmap-ripple';
  const size = Math.max(rect.width, rect.height);
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
  node.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
}
```

Call `createRipple(node, e)` inside the existing mousedown handler for nodes.

**JS — Drop bounce** (add at the end of the existing node drag mouseup handler):

```javascript
draggedNode.classList.add('mm-drop-bounce');
draggedNode.addEventListener('animationend', () => {
  draggedNode.classList.remove('mm-drop-bounce');
}, { once: true });
```

**JS — New node pop** (add inside `addUserNode()`, ~line 3035):

```javascript
// After appending the new node to canvas:
const newNodeEl = canvas.querySelector(`[data-node-id="${newNode.id}"]`);
if (newNodeEl) newNodeEl.classList.add('mm-pop-in');
```

**Constraint:** The ripple element is a flat `<span>`, not a container — no nesting violation. The `.overflow: hidden` change on `.crm-mindmap-node` must not clip the anchor points. Solution: set `overflow: hidden` only during ripple animation, then remove it. Or use `overflow: clip` with `overflow-clip-margin: 6px` to allow anchor overhang.

---

## Upgrade 7: Animated Background & Ambient Motion

**What:** Subtle ambient mesh gradient behind the dot grid. Smooth zoom transitions.

**CSS additions** (modify `.crm-mindmap-viewport`, line 5903):

```css
.crm-mindmap-viewport::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 600px 400px at 20% 30%, rgba(79,70,229,0.03), transparent),
    radial-gradient(ellipse 500px 350px at 70% 60%, rgba(236,72,153,0.025), transparent),
    radial-gradient(ellipse 450px 300px at 50% 80%, rgba(16,185,129,0.02), transparent);
  animation: mmAmbientDrift 20s ease-in-out infinite alternate;
  pointer-events: none;
  z-index: 0;
}

@keyframes mmAmbientDrift {
  0% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(30px, -20px) scale(1.05); }
  66% { transform: translate(-20px, 15px) scale(0.98); }
  100% { transform: translate(10px, -10px) scale(1.02); }
}
```

**Dark mode:**

```css
.books-dark .crm-mindmap-viewport::before {
  background:
    radial-gradient(ellipse 600px 400px at 20% 30%, rgba(129,140,248,0.04), transparent),
    radial-gradient(ellipse 500px 350px at 70% 60%, rgba(236,72,153,0.03), transparent),
    radial-gradient(ellipse 450px 300px at 50% 80%, rgba(16,185,129,0.025), transparent);
}
```

**Smooth zoom transitions** — modify `applyMindMapTransform()` (line 2360):

Currently the SVG and canvas layers have `transition: transform 0.04s ease-out` (lines 5929, 5941). Change to:

```css
.crm-mindmap-svg,
.crm-mindmap-canvas {
  transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}

/* Disable smooth transition during active pan/drag for responsiveness */
.crm-mindmap-viewport.is-panning .crm-mindmap-svg,
.crm-mindmap-viewport.is-panning .crm-mindmap-canvas {
  transition: none;
}
```

---

## Implementation Order

Execute in this sequence to minimize conflicts:

| Step | Upgrade | Files Modified | Estimated Lines Changed |
|------|---------|---------------|------------------------|
| 1 | **4 — Vibrant Central Node** | CSS (replace 5972–5998), JS (line 2688) | ~35 CSS, ~1 JS |
| 2 | **5 — Color-Tinted Cards** | JS (lines 2730, 2764), CSS (lines 6001, 6007, 7202–7207) | ~10 CSS, ~6 JS |
| 3 | **2 — Flowing Connections** | CSS (~5941), JS (lines 2486, 2498, 2538), CSS (line 7355) | ~12 CSS, ~6 JS |
| 4 | **3 — Branch Highlighting** | CSS (~5963), JS (new function + event bindings after 2792) | ~20 CSS, ~35 JS |
| 5 | **1 — Entrance Animations** | CSS (after 5956), JS (after 2792, after 2549) | ~15 CSS, ~20 JS |
| 6 | **6 — Ripple & Click Effects** | CSS (new keyframes), JS (click handler, drag handler, addUserNode) | ~30 CSS, ~15 JS |
| 7 | **7 — Ambient Background** | CSS (viewport::before, transitions at 5929/5941) | ~25 CSS, ~0 JS |

**Total estimated:** ~147 CSS lines, ~83 JS lines

---

## Verification Plan

1. Open CRM Books, select a book with 3+ notes, click "Create Mind Map"
2. Verify entrance animation staggers (central first, then categories, then subtopics)
3. Hover category node — confirm branch highlights and non-related nodes dim
4. Verify central node gradient border rotates
5. Verify category/subtopic cards show subtle color tints
6. Click a node — verify ripple effect
7. Drag and drop a node — verify bounce
8. Add a user thought node — verify pop-in animation
9. Check connections are visible and flowing
10. Toggle dark mode — verify all effects work correctly
11. Test zoom in/out — verify smooth transitions
12. Test pan — verify no transition lag
13. Export PNG — verify animations don't interfere with html2canvas capture
14. Check performance: no jank on maps with 20+ nodes

---

## Risk Notes

- **`@property` CSS rule** for central node rotation: not supported in Firefox < 128. Provide static fallback.
- **`overflow: hidden` on nodes** (for ripple): conflicts with anchor point positioning. Use `overflow: clip` with margin, or toggle overflow dynamically.
- **Dark mode SVG path override** (line 7355): blanket stroke override will fight inline colors. Must be scoped or removed.
- **html2canvas export**: CSS animations may capture mid-frame. Consider pausing animations before PNG export and resuming after.
- **Performance**: All animations use `transform` and `opacity` only (GPU-composited properties). No layout-triggering properties animated.
