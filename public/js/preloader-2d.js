// Quick lightweight script for the 2D Preloader

const PRELOADER_MIN_DURATION_MS = 6500;

document.addEventListener('DOMContentLoaded', () => {
    const preloader = document.getElementById('app-preloader');
    const fillWrapper = document.getElementById('preloader-text-fill-wrapper');

    if (!preloader || !fillWrapper) return;

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
