// Quick lightweight script for the 2D Preloader
// Shows on cold start (first load in the browser session) only.

// A hard 6500ms floor meant the splash held the screen for six and a half seconds even
// when the app was ready in one — the dominant share of a measured 8.5-11.5s time to
// interactive. 2200ms still reads as a deliberate brand beat and lets the fill animation
// complete; tests/browser/preloader-browser-check.js samples at 1500ms, so cold start is
// still showing it there.
const PRELOADER_MIN_DURATION_MS = 2200;

/**
 * Determine whether the preloader should display.
 * It should show when:
 *   1. This is the first page load in the browser session (cold start)
 * It should be skipped when:
 *   - The app has already loaded once in this browser session, wherever the user is
 *     navigating (index.html included — the practice app lives there).
 */
function shouldShowPreloader() {
    const hasLoadedBefore = sessionStorage.getItem('bel_app_loaded') === '1';

    // First load in this session? Always show (cold start / tab opened).
    if (!hasLoadedBefore) return true;

    // There used to be a second `if (isHomepage) return true` here. But the practice app
    // IS /index.html, so every in-session return to it — including leaving a practice
    // mode — replayed the full branded splash. The brand moment belongs to the cold
    // start; after that, navigation should be immediate.
    return false;
}

document.addEventListener('DOMContentLoaded', () => {
    const preloader = document.getElementById('app-preloader');
    const fillWrapper = document.getElementById('preloader-text-fill-wrapper');
    const progressFill = document.getElementById('preloader-progress-fill');

    if (!preloader || !fillWrapper) return;

    // The stylesheet handles prefers-reduced-motion on its own, but the class is what
    // tests/browser/preloader-browser-check.js asserts on — and nothing was setting it
    // once the 3D preloader stopped being loaded here.
    const prefersReducedMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) preloader.classList.add('reduced-motion');

    // ── Skip path: hide preloader instantly ──
    if (!shouldShowPreloader()) {
        preloader.style.display = 'none';
        preloader.style.opacity = '0';
        preloader.style.pointerEvents = 'none';
        document.body.classList.remove('loading-active');

        // Provide a no-op so script.js doesn't error
        window.finishBelPreloader = () => {};
        return;
    }

    // ── Show path: run the full branded preloader ──
    const startTime = performance.now();
    let rafId;
    let appReady = false;

    // Simulate progress fill based purely on elapsed time relative to min duration
    function updateProgress() {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / PRELOADER_MIN_DURATION_MS, 1.0);

        // Ease-out curve for the fill width (fast start, slowing down)
        const easedProgress = 1 - Math.pow(1 - progress, 3);
        fillWrapper.style.width = `${easedProgress * 100}%`;
        if (progressFill) progressFill.style.width = `${easedProgress * 100}%`;

        if (elapsed >= PRELOADER_MIN_DURATION_MS && appReady) {
            finishPreloader();
        } else {
            rafId = requestAnimationFrame(updateProgress);
        }
    }

    function finishPreloader() {
        cancelAnimationFrame(rafId);
        fillWrapper.style.width = '100%'; // Ensure full fill
        if (progressFill) progressFill.style.width = '100%';
        preloader.classList.add('is-complete');

        // Mark that the app has loaded in this session
        try { sessionStorage.setItem('bel_app_loaded', '1'); } catch (e) { /* quota */ }

        // Smooth transition out
        preloader.style.transition = 'opacity 600ms ease-out, transform 600ms ease-in';
        preloader.style.opacity = '0';
        if (!prefersReducedMotion) preloader.style.transform = 'scale(1.05)';
        preloader.style.pointerEvents = 'none';

        setTimeout(() => {
            preloader.style.display = 'none';
            document.body.classList.remove('loading-active');
        }, 600);
    }

    // Hook into the main app initialization
    document.body.classList.add('loading-active');

    // Expose a global method that script.js or other modules can call to signal readiness.
    // Wait slightly before setting true just to give UI time to render.
    window.finishBelPreloader = () => {
        appReady = true;
    };

    // For testing or fallback if nothing calls finishBelPreloader within 10 seconds.
    setTimeout(() => {
        appReady = true;
    }, 10000);

    rafId = requestAnimationFrame(updateProgress);
});
