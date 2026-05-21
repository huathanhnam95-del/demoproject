/**
 * Difficulty Filter Module
/**
 * Difficulty Filter Module
 * Handles filtering questions by difficulty level (1, 2, 3)
 */

const DifficultyFilter = (() => {
    'use strict';

    const SUPPORTED_MODES = ['type', 'speak', 'extended', 'notes', 'rop'];
    const STORAGE_PREFIX = 'questionDifficulty';
    const LEGACY_STORAGE_PREFIX = 'difficultyFilter';
    const VALID_VALUES = new Set(['all', '1', '2', '3']);

    // State
    const currentDifficultyByMode = {
        type: 'all',
        speak: 'all',
        extended: 'all',
        notes: 'all',
        rop: 'all'
    };
    let isInitialized = false;

    /**
     * Initialize the difficulty filter module
     */
    function init() {
        if (isInitialized) return;

        SUPPORTED_MODES.forEach((mode) => initFilterDropdown(mode));

        updateFilterVisibility();

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
        reloadSavedDifficulty(mode);
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
        const normalizedValue = normalizeDifficultyValue(value);
        const menu = document.getElementById(`difficulty-filter-menu-${mode}`);
        const label = document.getElementById(`difficulty-filter-label-${mode}`);

        // Update visual selection
        if (menu) {
            menu.querySelectorAll('.filter-option').forEach(opt => {
                opt.classList.toggle('selected', opt.getAttribute('data-value') === normalizedValue);
            });
        }

        // Update label text
        if (label) {
            if (normalizedValue === 'all') {
                label.textContent = 'Recommended';
            } else {
                const levelNames = { '1': 'Level 1 (Easy)', '2': 'Level 2 (Medium)', '3': 'Level 3 (Hard)' };
                label.textContent = levelNames[normalizedValue] || `Level ${normalizedValue}`;
            }
        }

        if (Object.prototype.hasOwnProperty.call(currentDifficultyByMode, mode)) {
            currentDifficultyByMode[mode] = normalizedValue;
        }

        // Save to localStorage under the new key name.
        saveDifficultySetting(mode, normalizedValue);

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
            }
        } else if (mode === 'rop') {
            if (window.ROPMode && typeof window.ROPMode.applyFilters === 'function') {
                window.ROPMode.applyFilters();
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
        const key = getDifficultyStorageKey(mode, userId);
        const normalizedValue = normalizeDifficultyValue(value);
        localStorage.setItem(key, normalizedValue);
        localStorage.removeItem(getLegacyDifficultyStorageKey(mode, userId));
    }

    function getDifficultyStorageKey(mode, userId) {
        return `${STORAGE_PREFIX}_${mode}_${userId}`;
    }

    function getLegacyDifficultyStorageKey(mode, userId) {
        return `${LEGACY_STORAGE_PREFIX}_${mode}_${userId}`;
    }

    function readDifficultySetting(mode) {
        const userId = window.authUI?.getCurrentUserId?.() || 'guest';
        const key = getDifficultyStorageKey(mode, userId);
        const legacyKey = getLegacyDifficultyStorageKey(mode, userId);
        const rawSaved = localStorage.getItem(key);
        const rawLegacy = localStorage.getItem(legacyKey);

        if (rawSaved !== null) {
            const saved = normalizeDifficultyValue(rawSaved);
            if (saved !== rawSaved) {
                localStorage.setItem(key, saved);
            }
            if (rawLegacy !== null) {
                localStorage.removeItem(legacyKey);
            }
            return saved;
        }

        if (rawLegacy !== null) {
            const legacySaved = normalizeDifficultyValue(rawLegacy);
            localStorage.setItem(key, legacySaved);
            localStorage.removeItem(legacyKey);
            return legacySaved;
        }

        return 'all';
    }

    function normalizeDifficultyValue(value) {
        const normalized = String(value || '').trim();
        return VALID_VALUES.has(normalized) ? normalized : 'all';
    }

    /**
     * Load saved difficulty from localStorage
     */
    function loadSavedDifficulty(mode) {
        reloadSavedDifficulty(mode);
    }

    function reloadSavedDifficulty(mode) {
        if (!Object.prototype.hasOwnProperty.call(currentDifficultyByMode, mode)) {
            return;
        }

        const value = readDifficultySetting(mode);
        currentDifficultyByMode[mode] = value;

        const menu = document.getElementById(`difficulty-filter-menu-${mode}`);
        const label = document.getElementById(`difficulty-filter-label-${mode}`);
        if (menu) {
            menu.querySelectorAll('.filter-option').forEach(opt => {
                opt.classList.toggle('selected', opt.getAttribute('data-value') === value);
            });
        }

        if (label) {
            if (value === 'all') {
                label.textContent = 'Recommended';
            } else {
                const levelNames = { '1': 'Level 1 (Easy)', '2': 'Level 2 (Medium)', '3': 'Level 3 (Hard)' };
                label.textContent = levelNames[value] || `Level ${value}`;
            }
        }

        applyFilter(mode);
    }

    /**
     * Update filter visibility based on progression unlock status
     */
    function updateFilterVisibility() {
        SUPPORTED_MODES.forEach(mode => {
            const container = document.getElementById(`difficulty-filter-container-${mode}`);
            if (container) {
                const unlocked = !!window.shopModule?.isSkillUnlocked?.('difficulty_filter');
                container.style.display = unlocked ? 'block' : 'none';
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
        updateFilterVisibility,
        reloadSavedDifficulty
    };
})();

// Expose to window
window.DifficultyFilter = DifficultyFilter;
