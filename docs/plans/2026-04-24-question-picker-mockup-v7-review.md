# Question Picker Mockup v7 Review (Read Aloud baseline)

File reviewed:
- `C:\Cursor AI\docs\plans\question-picker-mockup-v7.html`

## Verdict
v7 is a **net improvement** over v6:
- It fixes the “native radios + custom ARIA radios” mixing issue by reverting to **native radios only**.
- It keeps the compact sticky bar + shared Jump/Filter sheet pattern intact.
- It aligns better with “instant apply” expectations by using `Done` instead of `Apply Filters`.

## What’s working well
- **Status** includes the full shared set (Not Started / In Progress / Completed / Consolidated / Mastered).  
  `C:\Cursor AI\docs\plans\question-picker-mockup-v7.html:321`
- **Segmented controls are now clean** (native radio inputs + `peer-focus-visible` ring on the visible segment; no duplicate tab stops).  
  `C:\Cursor AI\docs\plans\question-picker-mockup-v7.html:360`
- **Keyboard + SR-friendly icon buttons** for Prev/Next (sr-only labels).  
  `C:\Cursor AI\docs\plans\question-picker-mockup-v7.html:38`
- **Sheet CTA wording**: `Done` matches instant-apply mental model.  
  `C:\Cursor AI\docs\plans\question-picker-mockup-v7.html:452`

## Remaining implementation risks / recommendations

### 1) Read Aloud code compatibility: `textContent` updates
The real app (`C:\Cursor AI\public\read-aloud-mode.js`) updates `ra-record-btn` and `ra-next-btn` via `textContent = ...` in multiple states.
If the production UI uses icons + nested spans (as in v7), those assignments will wipe out the SVG/markup.

Recommendation:
- Refactor RA UI updates to target `[data-label]` / `[data-label-short]` spans instead of overwriting the whole button, and decide whether `ra-next-btn` should be icon-only or text-based in production.

#### Why this problem keeps recurring across mockup versions
This issue persists because it is **not a mockup/UI-layout problem** — it is a **DOM contract problem** between:
- the new design’s *structured button markup* (SVG + label spans + responsive variants), and
- the existing Read Aloud controller’s *imperative DOM writes* that assume buttons are plain text nodes.

Concretely, the current implementation mutates entire button contents:
- `recordBtn.textContent = ...` (e.g. `C:\Cursor AI\public\read-aloud-mode.js:1455`, `C:\Cursor AI\public\read-aloud-mode.js:1489`, `C:\Cursor AI\public\read-aloud-mode.js:1504`)
- `nextBtn.textContent = ...` (e.g. `C:\Cursor AI\public\read-aloud-mode.js:1452`, `C:\Cursor AI\public\read-aloud-mode.js:1486`)
- audio button content updates via `textContent` / `innerHTML` (e.g. `C:\Cursor AI\public\read-aloud-mode.js:2586`, `C:\Cursor AI\public\read-aloud-mode.js:2596`)

So even if the HTML mockup is “correct”, the first state transition in RA will overwrite the markup again. Repeated mockup fixes can’t solve it unless the **controller write pattern** changes.

#### Detailed, durable fix (production)
Goal: keep the new UI structure (icons + labels) while preserving existing IDs and event wiring.

1) **Define a button “label slot” contract**
   - For any button whose label is updated by JS (`ra-record-btn`, `ra-stop-btn`, `ra-next-btn`, `ra-play-audio-btn`, `ra-play-recording-btn`), ensure markup contains:
     - `[data-label]` (full/desktop label; can be `sr-only` if icon-only)
     - `[data-label-short]` (mobile/compact label; optional)
     - optional icon element with `aria-hidden="true"`

2) **Add a tiny shared helper in JS**
   - Implement once and use everywhere (RA first, other modes later):

```js
function setButtonLabels(button, labels) {
  if (!button) return;
  const full = button.querySelector('[data-label]');
  const short = button.querySelector('[data-label-short]');

  if (full) full.textContent = labels.full ?? '';
  if (short) short.textContent = labels.short ?? labels.full ?? '';

  // Back-compat for buttons that haven't been migrated yet:
  if (!full && !short && labels.full != null) {
    button.textContent = labels.full;
  }
}
```

3) **Refactor Read Aloud state updates to stop overwriting button markup**
   - Replace every `*.textContent = ...` (and `*.innerHTML = ...`) on the affected buttons with `setButtonLabels(...)`.
   - Keep using `disabled` and `style.display` (or classes) as today; just stop replacing the entire contents.

   Minimum set to change in `C:\Cursor AI\public\read-aloud-mode.js`:
   - `recordBtn.textContent = ...` → `setButtonLabels(recordBtn, { full: 'Start recording now', short: 'Start' })` (and other states).
   - `nextBtn.textContent = ...` → update a label span (likely `sr-only`) + update `title` to match.
   - `playBtn.innerHTML = ...` / `playBtn.textContent = ...` → update `[data-label]` only.

4) **Decide how `ra-next-btn` should look**
   - If you want icon-only: keep arrow SVG visible and set `[data-label]` as `sr-only` text that JS updates (e.g. “Next prompt”).
   - If you want icon + text: keep the label visible and still update via `[data-label]`.

5) **Unify header audio buttons without duplicate IDs**
   Choose one strategy and standardize it across modes:
   - **Move** the existing `ra-play-audio-btn` / `ra-play-recording-btn` elements into the header (preferred for least JS change), or
   - Keep the original buttons and make header buttons “proxy” them:
     - header click → `document.getElementById('ra-play-audio-btn')?.click()`
   - Avoid having two elements with the same ID in the DOM.

6) **Add one guardrail test**
   - Even a small Playwright smoke test is enough:
     - trigger a RA state transition (start → stop → next),
     - assert the button still contains an `<svg>` child (or `[data-label]` span) after state updates.

This is the smallest change that makes the “structured button markup” redesign stable, and it scales to other modes once RA is fixed.

### 2) Header audio buttons need a binding strategy
v7 uses `header-ra-play-audio-btn` / `header-ra-play-recording-btn` to avoid ID collisions. That’s good, but you still need one of:
- move the existing controls into the header (preserve original IDs), or
- proxy-click the existing buttons, or
- bind the same handler to both IDs.

### 3) Hidden select option values must match the real app
In the real RA implementation, `ra-question-select` values are typically **database indices** (plus a `random` option), not question IDs. Ensure the production `select` preserves the existing value semantics.

## Conclusion
v7 is the best “pure UI” version so far: clean segmented filters, consistent status set, and clearer “Done” behavior. The remaining work is mostly *implementation wiring* (RA `textContent` updates and audio button binding) rather than layout changes.
