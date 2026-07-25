// Quick lightweight script for the 2D Preloader
// Shows on cold start (first load in session) or homepage.
// Skips for returning logged-in users navigating directly to sub-routes.

const PRELOADER_MIN_DURATION_MS = 6500;

/**
 * Determine whether the preloader should display.
 * It should show when:
 *   1. This is the first page load in the browser session (cold start)
 *   2. The user is on the homepage ("/")
 * It should be skipped when:
 *   - The app has already loaded once in this session AND
 *     the user is navigating to a sub-route (not homepage)
 */
function shouldShowPreloader() {
    const hasLoadedBefore = sessionStorage.getItem('bel_app_loaded') === '1';
    const isHomepage = window.location.pathname === '/' || window.location.pathname === '/index.html';

    // First load in this session? Always show (cold start / tab opened).
    if (!hasLoadedBefore) return true;

    // Returning to homepage? Show (brand entry point).
    if (isHomepage) return true;

    // Already loaded + navigating to a sub-route — skip.
    return false;
}

document.addEventListener('DOMContentLoaded', () => {
    const preloader = document.getElementById('app-preloader');
    const fillWrapper = document.getElementById('preloader-text-fill-wrapper');

    if (!preloader || !fillWrapper) return;

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

        if (elapsed >= PRELOADER_MIN_DURATION_MS && appReady) {
            finishPreloader();
        } else {
            rafId = requestAnimationFrame(updateProgress);
        }
    }

    function finishPreloader() {
        cancelAnimationFrame(rafId);
        fillWrapper.style.width = '100%'; // Ensure full fill

        // Mark that the app has loaded in this session
        try { sessionStorage.setItem('bel_app_loaded', '1'); } catch (e) { /* quota */ }

        // Smooth transition out
        preloader.style.transition = 'opacity 600ms ease-out, transform 600ms ease-in';
        preloader.style.opacity = '0';
        preloader.style.transform = 'scale(1.05)';
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
