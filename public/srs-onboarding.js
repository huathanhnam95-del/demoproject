/**
 * SRS Onboarding & Tutorial Module
 * Handles first-time algorithm selection and in-app tutorials for the SRS system.
 * 
 * Dependencies:
 *   - Requires srs-onboarding.css for styling
 *   - Integrates with VocabTutorial if available
 */

import { SRS_STORAGE_KEYS } from './js/srs-constants.js';
import {
    getStoredAlgorithmPreference,
    migrateLegacyAlgorithmPreference,
    setStoredAlgorithmPreference
} from './js/srs-storage.js';

const SRSOnboarding = (function () {
    'use strict';

    // Storage Keys
    // Default Algorithm
    const DEFAULT_ALGORITHM = 'SM2';

    // --- Settings Management ---

    /**
     * Get the user's preferred algorithm
     * @returns {string} 'SM2' or 'FSRS'
     */
    function getPreferredAlgorithm() {
        return migrateLegacyAlgorithmPreference(localStorage)
            || getStoredAlgorithmPreference(localStorage)
            || DEFAULT_ALGORITHM;
    }

    /**
     * Set the user's preferred algorithm
     * @param {string} algorithm - 'SM2' or 'FSRS'
     */
    function setPreferredAlgorithm(algorithm) {
        setStoredAlgorithmPreference(algorithm, localStorage);
        console.log('[SRS Onboarding] Algorithm set to:', algorithm);
    }

    /**
     * Check if onboarding is complete
     * @returns {boolean}
     */
    function isOnboardingComplete() {
        return localStorage.getItem(SRS_STORAGE_KEYS.ONBOARDING_COMPLETE) === 'true';
    }

    /**
     * Mark onboarding as complete
     */
    function markOnboardingComplete() {
        localStorage.setItem(SRS_STORAGE_KEYS.ONBOARDING_COMPLETE, 'true');
    }

    /**
     * Check if the main SRS tutorial has been seen
     * @returns {boolean}
     */
    function hasSeenTutorial() {
        return localStorage.getItem(SRS_STORAGE_KEYS.TUTORIAL_SEEN) === 'true';
    }

    /**
     * Mark tutorial as seen
     */
    function markTutorialSeen() {
        localStorage.setItem(SRS_STORAGE_KEYS.TUTORIAL_SEEN, 'true');
    }

    /**
     * Reset onboarding state (for testing)
     */
    function resetOnboarding() {
        localStorage.removeItem(SRS_STORAGE_KEYS.ALGORITHM);
        localStorage.removeItem(SRS_STORAGE_KEYS.LEGACY_ALGORITHM);
        localStorage.removeItem(SRS_STORAGE_KEYS.ONBOARDING_COMPLETE);
        localStorage.removeItem(SRS_STORAGE_KEYS.TUTORIAL_SEEN);
        console.log('[SRS Onboarding] State reset');
    }

    // --- Algorithm Selection Modal ---

    /**
     * Show the algorithm selection modal
     * @param {function} onComplete - Callback when selection is made
     * @returns {Promise<string>} Selected algorithm
     */
    function showAlgorithmSelectionModal(onComplete) {
        return new Promise((resolve) => {
            // Remove any existing modal
            const existingModal = document.getElementById('srs-algo-select-modal');
            if (existingModal) existingModal.remove();

            // Create modal structure
            const modalHTML = `
                <div class="srs-algo-modal-overlay" id="srs-algo-modal-overlay">
                    <div class="srs-algo-modal" id="srs-algo-select-modal" role="dialog" aria-modal="true" aria-labelledby="srs-algo-modal-title">
                        <div class="srs-algo-modal-header">
                            <span class="srs-algo-modal-icon">🧠</span>
                            <h2 id="srs-algo-modal-title">Choose Your Learning Engine</h2>
                            <p class="srs-algo-modal-subtitle">Pick how you want to schedule your vocabulary reviews. You can change this later in Settings.</p>
                        </div>
                        
                        <div class="srs-algo-options">
                            <button class="srs-algo-option" data-algorithm="SM2" id="srs-algo-sm2">
                                <div class="srs-algo-option-icon">📚</div>
                                <div class="srs-algo-option-content">
                                    <h3>Classic</h3>
                                    <p class="algo-engine-tag">The Reliable Standard (SM-2)</p>
                                    <ul class="srs-algo-features">
                                        <li>✓ The algorithm popularized by Anki</li>
                                        <li>✓ Stable, predictable review schedules</li>
                                        <li>✓ Proven results for millions of users</li>
                                    </ul>
                                </div>
                                <span class="srs-algo-recommended">Recommended</span>
                            </button>
                            
                            <button class="srs-algo-option" data-algorithm="FSRS" id="srs-algo-fsrs">
                                <div class="srs-algo-option-icon">🚀</div>
                                <div class="srs-algo-option-content">
                                    <h3>Smart AI</h3>
                                    <p class="algo-engine-tag">High-Efficiency Study (FSRS)</p>
                                    <ul class="srs-algo-features">
                                        <li>✓ Adapts uniquely to <strong>your</strong> memory</li>
                                        <li>✓ Up to 30% fewer reviews for the same retention</li>
                                        <li>✓ Optimized for maximum study efficiency</li>
                                    </ul>
                                </div>
                            </button>
                        </div>
                        
                        <div class="srs-algo-modal-footer">
                            <p class="srs-algo-change-note">💡 You can switch algorithms anytime in <strong>Settings > SRS Options</strong></p>
                        </div>
                    </div>
                </div>
            `;

            // Inject modal into DOM
            document.body.insertAdjacentHTML('beforeend', modalHTML);

            const overlay = document.getElementById('srs-algo-modal-overlay');
            const modal = document.getElementById('srs-algo-select-modal');

            // Animate in
            requestAnimationFrame(() => {
                overlay.classList.add('visible');
                modal.classList.add('visible');
            });

            // Handle option clicks
            const options = modal.querySelectorAll('.srs-algo-option');
            options.forEach(option => {
                option.addEventListener('click', () => {
                    const algo = option.dataset.algorithm;

                    // Visual feedback
                    options.forEach(o => o.classList.remove('selected'));
                    option.classList.add('selected');

                    // Save and close after brief delay
                    setTimeout(() => {
                        setPreferredAlgorithm(algo);
                        markOnboardingComplete();
                        closeAlgorithmModal();

                        if (onComplete) onComplete(algo);
                        resolve(algo);
                    }, 300);
                });
            });

            // Prevent closing without selection (no overlay click close)
        });
    }

    /**
     * Close the algorithm selection modal
     */
    function closeAlgorithmModal() {
        const overlay = document.getElementById('srs-algo-modal-overlay');
        const modal = document.getElementById('srs-algo-select-modal');

        if (modal) modal.classList.remove('visible');
        if (overlay) overlay.classList.remove('visible');

        // Remove from DOM after animation
        setTimeout(() => {
            if (overlay) overlay.remove();
        }, 300);
    }

    // --- In-App Tutorial for SRS Buttons ---

    /**
     * Start the SRS Rating Buttons Tutorial
     * This teaches users what Again/Hard/Good/Easy buttons do.
     */
    function startRatingButtonsTutorial() {
        if (hasSeenTutorial()) {
            console.log('[SRS Onboarding] Tutorial already seen, skipping');
            return;
        }

        // Ensure the SRS panel is visible
        const srsPanel = document.getElementById('srs-review-panel');
        if (!srsPanel || !srsPanel.classList.contains('active')) {
            console.warn('[SRS Onboarding] SRS panel not active, deferring tutorial');
            return;
        }

        // Use VocabTutorial if available, otherwise show simple tooltip flow
        if (window.VocabTutorial && typeof window.VocabTutorial.startCustomTutorial === 'function') {
            startTutorialWithVocabTutorial();
        } else {
            startSimpleTutorial();
        }
    }

    /**
     * Start tutorial using the VocabTutorial system
     */
    function startTutorialWithVocabTutorial() {
        const steps = [
            {
                target: '.srs-flashcard',
                title: 'Your Flashcard',
                content: 'Tap the card to flip it and see the answer. Then rate how well you remembered!',
                position: 'bottom'
            },
            {
                target: '[data-quality="1"]',
                title: '🔴 Again',
                content: 'Forgot completely? Press "Again" to review in 1 minute, then 10 minutes.',
                position: 'top'
            },
            {
                target: '[data-quality="2"]',
                title: '🟠 Hard',
                content: 'Remembered but struggled? "Hard" gives you a slightly longer wait.',
                position: 'top'
            },
            {
                target: '[data-quality="3"]',
                title: '🟢 Good',
                content: 'Remembered with normal effort? "Good" is your default choice.',
                position: 'top'
            },
            {
                target: '[data-quality="4"]',
                title: '🔵 Easy',
                content: 'Knew it instantly? "Easy" pushes the card far into the future.',
                position: 'top'
            }
        ];

        window.VocabTutorial.startCustomTutorial(steps, {
            onComplete: () => {
                markTutorialSeen();
                console.log('[SRS Onboarding] Tutorial completed');
            }
        });
    }

    /**
     * Simple tutorial fallback using tooltips
     */
    function startSimpleTutorial() {
        // Create a simple tooltip-based tutorial
        const steps = [
            { message: 'Tap the flashcard to reveal the answer!', delay: 500 },
            { message: 'Rate your recall: Again (forgot), Good (remembered), Easy (too easy)', delay: 3000 }
        ];

        let currentStep = 0;

        function showStep() {
            if (currentStep >= steps.length) {
                markTutorialSeen();
                return;
            }

            const step = steps[currentStep];
            showTooltip(step.message);

            setTimeout(() => {
                hideTooltip();
                currentStep++;
                showStep();
            }, step.delay);
        }

        showStep();
    }

    /**
     * Show a simple tooltip
     * @param {string} message
     */
    function showTooltip(message) {
        let tooltip = document.getElementById('srs-simple-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'srs-simple-tooltip';
            tooltip.className = 'srs-simple-tooltip';
            document.body.appendChild(tooltip);
        }
        tooltip.textContent = message;
        tooltip.classList.add('visible');
    }

    /**
     * Hide the simple tooltip
     */
    function hideTooltip() {
        const tooltip = document.getElementById('srs-simple-tooltip');
        if (tooltip) tooltip.classList.remove('visible');
    }

    // --- Integration Hook ---

    /**
     * Initialize SRS Onboarding
     * Should be called when SRS Review is first accessed.
     * @param {function} onAlgorithmSet - Callback with selected algorithm
     */
    async function init(onAlgorithmSet) {
        console.log('[SRS Onboarding] Initializing...');

        // Check if first time
        if (!isOnboardingComplete()) {
            console.log('[SRS Onboarding] First time user, showing algorithm selection');
            const algorithm = await showAlgorithmSelectionModal(onAlgorithmSet);
            return algorithm;
        } else {
            const algorithm = getPreferredAlgorithm();
            console.log('[SRS Onboarding] Returning user, algorithm:', algorithm);
            if (onAlgorithmSet) onAlgorithmSet(algorithm);
            return algorithm;
        }
    }

    // --- Public API ---
    return {
        init,
        getPreferredAlgorithm,
        setPreferredAlgorithm,
        isOnboardingComplete,
        hasSeenTutorial,
        startRatingButtonsTutorial,
        showAlgorithmSelectionModal,
        resetOnboarding // For testing
    };
})();

if (typeof window !== 'undefined') {
    window.SRSOnboarding = SRSOnboarding;
}

// Export for ES modules
export { SRSOnboarding };

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SRSOnboarding;
}
