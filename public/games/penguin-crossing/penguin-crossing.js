import { PenguinCrossingGame } from './src/GameEngine.js';

let gameInstance = null;

/**
 * Open the Penguin Crossing game overlay and start the game.
 * Exposed on `window` so the HTML card's onclick can call it.
 *
 * NOTE: We do NOT hide page-layout-wrapper. The overlay is position:fixed
 * with z-index:10000, so it covers everything already. Hiding the wrapper
 * would also hide the overlay if it's nested inside the wrapper.
 */
window.openPenguinGame = function () {
    const overlay = document.getElementById('penguin-game-overlay');
    if (!overlay) return;

    overlay.style.display = 'flex';

    if (!gameInstance) {
        gameInstance = new PenguinCrossingGame('penguin-canvas');
    }
    gameInstance.start();
};

/**
 * Close the game overlay and restore the main layout.
 */
window.closePenguinGame = function () {
    const overlay = document.getElementById('penguin-game-overlay');
    if (!overlay) return;

    overlay.style.display = 'none';

    if (gameInstance) {
        gameInstance.stop();
        gameInstance = null;
    }
};

/* Bind close button after DOM is ready (module scripts are deferred). */
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('close-penguin-btn')
        ?.addEventListener('click', window.closePenguinGame);
});
