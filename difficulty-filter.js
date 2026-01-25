/**
 * Difficulty Filter Module
 * Handles filtering questions by difficulty level (1, 2, 3)
 */

const DifficultyFilter = (() => {
    'use strict';

    // State
    let currentDifficultyType = 'all';
    let currentDifficultySpeak = 'all';
    let isInitialized = false;

    /**
     * Initialize the difficulty filter module
     */
    function init() {
        if (isInitialized) return;

        // Initialize for Type mode
        initFilterDropdown('type');

        // Initialize for Speak mode
        initFilterDropdown('speak');

        // Check if filter should be visible based on shop unlock
        updateFilterVisibility();

        // Listen for shop unlock events
        window.addEventListener('shop-unlock', (e) => {
            if (e.detail && e.detail.mode === 'difficultyFilter') {
                updateFilterVisibility();
            }
        });

        isInitialized = true;
        console.log('🎚️ Difficulty Filter Module Initialized');
    }

    /**
     * Initialize dropdown for a specific mode
     */
    function initFilterDropdown(mode) {
        const btn = document.getElementById(`difficulty-filter-btn-${mode}`);
        const menu = document.getElementById(`difficulty-filter-menu-${mode}`);
        const container = document.getElementById(`difficulty-filter-container-${mode}`);

        if (!btn || !menu || !container) {
            console.warn(`Difficulty filter elements not found for mode: ${mode}`);
            return;
        }

        // Toggle dropdown on button click
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = container.classList.contains('open');
            closeAllDropdowns();
            if (!isOpen) {
                container.classList.add('open');
                menu.style.display = 'block';
            }
        });

        // Handle option selection
        menu.querySelectorAll('.filter-option').forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const value = option.getAttribute('data-value');
                selectDifficulty(mode, value);
                closeAllDropdowns();
            });
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!container.contains(e.target)) {
                container.classList.remove('open');
                menu.style.display = 'none';
            }
        });

        // Load saved difficulty setting
        loadSavedDifficulty(mode);
    }

    /**
     * Close all difficulty dropdowns
     */
    function closeAllDropdowns() {
        ['type', 'speak'].forEach(mode => {
            const container = document.getElementById(`difficulty-filter-container-${mode}`);
            const menu = document.getElementById(`difficulty-filter-menu-${mode}`);
            if (container) container.classList.remove('open');
            if (menu) menu.style.display = 'none';
        });
    }

    /**
     * Select a difficulty level
     */
    function selectDifficulty(mode, value) {
        const menu = document.getElementById(`difficulty-filter-menu-${mode}`);
        const label = document.getElementById(`difficulty-filter-label-${mode}`);

        // Update visual selection
        if (menu) {
            menu.querySelectorAll('.filter-option').forEach(opt => {
                opt.classList.toggle('selected', opt.getAttribute('data-value') === value);
            });
        }

        // Update label text
        if (label) {
            if (value === 'all') {
                label.textContent = 'Filter by Difficulty';
            } else {
                const levelNames = { '1': 'Level 1 (Easy)', '2': 'Level 2 (Medium)', '3': 'Level 3 (Hard)' };
                label.textContent = levelNames[value] || `Level ${value}`;
            }
        }

        // Store selection
        if (mode === 'type') {
            currentDifficultyType = value;
        } else {
            currentDifficultySpeak = value;
        }

        // Save to localStorage
        saveDifficultySetting(mode, value);

        // Apply filter
        applyFilter(mode);
    }

    /**
     * Apply the difficulty filter to the question list
     */
    function applyFilter(mode) {
        if (typeof window.populateQuestionSelect === 'function') {
            window.populateQuestionSelect(mode);
        }

        console.log(`🎚️ Difficulty filter triggered refresh for ${mode}`);
    }

    /**
     * Save difficulty setting to localStorage
     */
    function saveDifficultySetting(mode, value) {
        const userId = window.authUI?.getCurrentUserId?.() || 'guest';
        localStorage.setItem(`difficultyFilter_${mode}_${userId}`, value);
    }

    /**
     * Load saved difficulty from localStorage
     */
    function loadSavedDifficulty(mode) {
        const userId = window.authUI?.getCurrentUserId?.() || 'guest';
        const saved = localStorage.getItem(`difficultyFilter_${mode}_${userId}`);
        if (saved) {
            selectDifficulty(mode, saved);
        }
    }

    /**
     * Update filter visibility based on shop unlock status
     */
    function updateFilterVisibility() {
        const isUnlocked = window.shopModule?.isModeUnlocked?.('difficultyFilter');

        ['type', 'speak'].forEach(mode => {
            const container = document.getElementById(`difficulty-filter-container-${mode}`);
            if (container) {
                container.style.display = isUnlocked ? 'block' : 'none';
            }
        });
    }

    /**
     * Reset filter to 'all' for a mode
     */
    function resetFilter(mode) {
        selectDifficulty(mode, 'all');
    }

    /**
     * Get current difficulty level for a mode
     */
    function getCurrentDifficulty(mode) {
        return mode === 'type' ? currentDifficultyType : currentDifficultySpeak;
    }

    // Initialize on DOMContentLoaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // DOM already loaded
        setTimeout(init, 100);
    }

    // Public API
    return {
        init,
        selectDifficulty,
        applyFilter,
        resetFilter,
        getCurrentDifficulty,
        updateFilterVisibility
    };
})();

// Expose to window
window.DifficultyFilter = DifficultyFilter;
