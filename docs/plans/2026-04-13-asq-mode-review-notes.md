# ASQ mode review notes

- Baseline on `2026-04-15`: `node tests/browser/asq-mode-browser-check.js` failed because overlays intercepted clicks, first on `#entry-modal` during the `Redo` click path.
- Confirmed the app already had a working overlay-dismissal pattern in `tests/browser/practice-scope-toggle-browser-check.js`.
- Tightened `tests/browser/asq-mode-browser-check.js` to dismiss shell overlays up front and to suppress first-use tutorials for the modes touched by the test harness.
- Added an explicit regression check that leaving ASQ while recording stops ASQ state and hides the stop button.
- Before the production fix, that new cleanup assertion failed when switching from ASQ to Speak.
- After adding `window.ASQMode?.onExit?.()` on ASQ exit in `public/script.js`, the ASQ browser check passed end-to-end.
