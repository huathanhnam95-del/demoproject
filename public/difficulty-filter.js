/**
 * Difficulty Filter Module
 * Handles filtering questions by difficulty level (1, 2, 3)
 */

const DifficultyFilter = (() => {
    'use strict';

    const SUPPORTED_MODES = ['type', 'speak', 'extended', 'notes'];

    // State
    const currentDifficultyByMode = {
        type: 'all',
        speak: 'all',
        extended: 'all',
        notes: 'all'
    };
    let isInitialized = false;

    /**
     * Initialize the difficulty filter module
     */
    function init() {
        if (isInitialized) return;

        SUPPORTED_MODES.forEach((mode) => initFilterDropdown(mode));

        // Check if filter should be visible based on Skill Tree unlock
        updateFilterVisibility();

        // Listen for unlock events
        window.addEventListener('shop-unlock', (e) => {
            if (e.detail && e.detail.mode === 'difficultyFilter') {
                updateFilterVisibility();
            }
        });
        window.addEventListener('skill-unlock', (e) => {
            if (e.detail && e.detail.skillId === 'difficulty_filter') {
                updateFilterVisibility();
            }
        });

        isInitialized = true;
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
        SUPPORTED_MODES.forEach(mode => {
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

        if (Object.prototype.hasOwnProperty.call(currentDifficultyByMode, mode)) {
            currentDifficultyByMode[mode] = value;
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
        if (mode === 'notes') {
            if (window.TakeNotesMode && typeof window.TakeNotesMode.applyFilters === 'function') {
                window.TakeNotesMode.applyFilters();
            } else {
                console.debug('[DifficultyFilter] TakeNotesMode not ready yet, filter saved but not applied.');
            }
        } else if (typeof window.populateQuestionSelect === 'function') {
            window.populateQuestionSelect(mode);
        }
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
     * Update filter visibility based on Skill Tree unlock status
     */
    function updateFilterVisibility() {
        const profile = window.currentUserProfile && typeof window.currentUserProfile === 'object'
            ? window.currentUserProfile
            : null;
        const unlockedBySkillTree = !!(profile?.unlockedSkills?.difficulty_filter || profile?.skillPassives?.difficulty_filter);
        const isUnlocked = unlockedBySkillTree || window.shopModule?.isModeUnlocked?.('difficultyFilter');

        SUPPORTED_MODES.forEach(mode => {
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
        return currentDifficultyByMode[mode] || 'all';
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
