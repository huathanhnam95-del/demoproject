/**
 * Shop Module
 * Handles the in-app shop, coin balance, and unlocking features.
 */

const ShopModule = (() => {
    // defined items
    const SHOP_ITEMS = [
        {
            id: 'speak',
            title: 'Speak Mode',
            description: 'Unlock the ability to practice speaking and pronunciation.',
            icon: '🎙️',
            cost: 50,
            unlocksMode: 'speak'
        },
        {
            id: 'extended',
            title: 'Fill in the Blank',
            description: 'Challenge yourself with longer sentences and missing words.',
            icon: '📝',
            cost: 50,
            unlocksMode: 'extended'
        },
        {
            id: 'watch',
            title: 'Watch Mode',
            description: 'Learn from real-world videos and context.',
            icon: '🎬',
            cost: 50,
            unlocksMode: 'watch'
        },
        {
            id: 'notes',
            title: 'Notes Mode',
            description: 'Unlock the ability to take notes during practice.',
            icon: '📓',
            cost: 50,
            unlocksMode: 'notes'
        },
        {
            id: 'pronounce',
            title: 'Pronunciation Analyzer',
            description: 'Analyze your pitch and stress accuracy.',
            icon: '🗣️',
            cost: 50,
            unlocksMode: 'pronounce'
        },
        {
            id: 'lengthFilter',
            title: 'Length Filter',
            description: 'Filter sentences by length (Short, Medium, Long).',
            icon: '📏',
            cost: 20,
            unlocksMode: 'lengthFilter'
        },
        {
            id: 'difficultyFilter',
            title: 'Difficulty Filter',
            description: 'Filter questions by CEFR-aligned difficulty (Easy, Medium, Hard).',
            icon: '🎚️',
            cost: 30,
            unlocksMode: 'difficultyFilter'
        },
        {
            id: 'vocabBook',
            title: 'Vocab Book',
            description: 'Save difficult words and review them later.',
            icon: '📖',
            cost: 30,
            unlocksMode: 'vocabBook'
        },
        {
            id: 'autoAdjust',
            title: 'Smart Difficulty',
            description: 'AI keeps you in the optimal learning zone automatically.',
            icon: '🎯',
            cost: 100,
            unlocksMode: 'autoAdjust'
        }
    ];

    let userCoins = 0;
    let unlockedModes = ['type', 'difficultyFilter']; // default
    let purchaseHistory = []; // Cache for purchase dates
    let isInitialized = false;

    // DOM Elements - retrieved in init() to ensure DOM is ready
    let modal = null;
    let closeBtn = null;
    let balanceDisplay = null;
    let shopGrid = null;
    let notificationDot = null;

    /**
     * Initialize the shop module
     */
    function init() {
        if (isInitialized) return;

        // Retrieve DOM elements now that DOM is ready
        modal = document.getElementById('shop-modal');
        closeBtn = document.getElementById('shop-close-btn');
        balanceDisplay = document.getElementById('shop-balance-display');
        shopGrid = document.getElementById('shop-grid');
        notificationDot = document.querySelector('.shop-notification');

        // Event listeners
        if (closeBtn) closeBtn.addEventListener('click', closeShop);
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeShop();
            });
        }

        // Subscribe to auth changes to refresh data
        if (window.authUI) {
            // we rely on global auth state or events. 
            // script.js often reloads stuff on login.
            // We can expose a refresh method.
        }

        // Initialize data
        refreshUserData().then(() => {
            isInitialized = true;
            console.log('🛒 Shop Module Initialized and data refreshed');
        });
    }

    /**
     * Open the shop modal
     */
    async function openShop() {
        if (!modal) return;

        await refreshUserData();
        renderShop();
        modal.classList.add('active');

        // Hide notification when opening shop
        if (notificationDot) notificationDot.style.display = 'none';

        // Mark tutorial as seen if needed (handled in tutorial.js)
    }

    /**
     * Close the shop modal
     */
    function closeShop() {
        if (!modal) return;
        modal.classList.remove('active');
    }

    /**
     * Refresh user data (coins, unlocked modes, purchases) from Firestore or AuthUI
     * With localStorage fallback to preserve unlock state when Firestore fails
     */
    async function refreshUserData() {
        const userId = window.authUI?.getCurrentUserId?.();
        if (!userId) {
            // Guest mode defaults
            userCoins = 0;
            unlockedModes = ['type'];
            purchaseHistory = [];
            return;
        }

        // Try to load from localStorage as fallback
        const cachedModes = localStorage.getItem(`unlockedModes_${userId}`);
        const cachedCoins = localStorage.getItem(`coins_${userId}`);

        try {
            const result = await window.firebaseFirestoreFunctions.getUserProfile(userId);
            if (result.success) {
                userCoins = result.data.coins || 0;
                unlockedModes = result.data.unlockedModes || ['type'];
                updateBalanceDisplay();

                // Cache to localStorage for fallback
                localStorage.setItem(`unlockedModes_${userId}`, JSON.stringify(unlockedModes));
                localStorage.setItem(`coins_${userId}`, String(userCoins));
            } else {
                // Firestore failed - use cached data if available
                console.warn('Firestore getUserProfile failed, using localStorage fallback');
                if (cachedModes) {
                    try {
                        unlockedModes = JSON.parse(cachedModes);
                    } catch (e) {
                        unlockedModes = ['type'];
                    }
                }
                if (cachedCoins) {
                    userCoins = parseInt(cachedCoins, 10) || 0;
                }
                updateBalanceDisplay();
            }

            // Fetch purchase history to get dates (non-critical)
            try {
                const purchasesResult = await window.firebaseFirestoreFunctions.getPurchases(userId);
                if (purchasesResult && purchasesResult.success) {
                    purchaseHistory = purchasesResult.data;
                }
            } catch (purchaseError) {
                console.warn('Failed to load purchase history (permissions):', purchaseError);
                // Non-critical, continue with what we have
            }
        } catch (error) {
            console.error('Error refreshing shop data:', error);
            // Ensure we have some data from cache
            if (!unlockedModes || unlockedModes.length <= 1) {
                if (cachedModes) {
                    try {
                        unlockedModes = JSON.parse(cachedModes);
                    } catch (e) {
                        unlockedModes = unlockedModes || ['type'];
                    }
                }
            }
            if (userCoins === 0 && cachedCoins) {
                userCoins = parseInt(cachedCoins, 10) || 0;
            }
            updateBalanceDisplay();
        }
    }

    /**
     * Update the balance display in the modal
     */
    function updateBalanceDisplay() {
        if (balanceDisplay) {
            balanceDisplay.textContent = userCoins;
            // animate change?
        }
    }

    /**
     * Render the shop items
     */
    function renderShop() {
        if (!shopGrid) return;
        shopGrid.innerHTML = '';

        SHOP_ITEMS.forEach(item => {
            const isOwned = unlockedModes.includes(item.unlocksMode);
            const canAfford = userCoins >= item.cost;
            let unlockedDate = null;

            if (isOwned) {
                const purchase = purchaseHistory.find(p => p.itemId === item.id);
                if (purchase && purchase.purchasedAt) {
                    unlockedDate = purchase.purchasedAt.toLocaleDateString();
                }
            }

            const card = document.createElement('div');
            card.className = `shop-item ${isOwned ? 'purchased' : ''}`;

            let actionButtons = '';
            if (isOwned) {
                if (item.id === 'autoAdjust') {
                    // Smart Difficulty: Settings + What's this? (No Try Now)
                    actionButtons = `
                        <div class="shop-owned-actions">
                            <button class="shop-settings-btn" data-id="${item.id}">Settings ⚙️</button>
                            <button class="shop-tutorial-btn" data-id="${item.id}">What's this ❓</button>
                        </div>
                    `;
                } else {
                    // Standard: Try Now + What's this?
                    actionButtons = `
                        <div class="shop-owned-actions">
                            <button class="shop-play-btn" data-id="${item.id}">Try Now ▶️</button>
                            <button class="shop-tutorial-btn" data-id="${item.id}">What's this ❓</button>
                        </div>
                    `;
                }
            } else {
                actionButtons = `
                    <button class="shop-item-btn ${isOwned ? 'owned' : 'buy'}" 
                        ${isOwned ? 'disabled' : (canAfford ? '' : 'disabled')}
                        data-id="${item.id}">
                        ${isOwned ? 'Owned' : 'Buy'}
                    </button>
                `;
            }

            card.innerHTML = `
                ${!isOwned && canAfford ? '<div class="shop-item-tag">Unlockable!</div>' : ''}
                <div class="shop-item-icon">${item.icon}</div>
                <div class="shop-item-title">${item.title}</div>
                <div class="shop-item-desc">${item.description}</div>
                <div class="shop-item-price">
                    ${isOwned ? (unlockedDate ? `<span class="unlocked-date">Unlocked: ${unlockedDate}</span>` : 'Purchased') : `🪙 ${item.cost}`}
                </div>
                ${actionButtons}
            `;

            // Attach handlers
            if (isOwned) {
                const playBtn = card.querySelector('.shop-play-btn');
                const tutorialBtn = card.querySelector('.shop-tutorial-btn');
                const settingsBtn = card.querySelector('.shop-settings-btn');

                if (playBtn) playBtn.onclick = () => activateFeature(item);
                if (tutorialBtn) tutorialBtn.onclick = () => replayTutorial(item);
                if (settingsBtn) settingsBtn.onclick = () => {
                    closeShop();
                    if (window.DifficultyManager && window.DifficultyManager.openSettings) {
                        window.DifficultyManager.openSettings();
                    }
                };
            } else {
                const btn = card.querySelector('.shop-item-btn');
                if (canAfford) {
                    btn.onclick = () => purchaseItem(item);
                }
            }

            shopGrid.appendChild(card);
        });
    }

    /**
     * Activate the feature (switch tab, etc.)
     */
    function activateFeature(item) {
        closeShop();

        // Map item ID to tab ID or action
        const tabMap = {
            'speak': 'tab-speak',
            'extended': 'tab-extended',
            'watch': 'tab-watch',
            'notes': 'tab-notes',
            'pronounce': 'tab-pronounce',
            'vocabBook': 'tab-vocab',
        };

        if (tabMap[item.id]) {
            const tab = document.getElementById(tabMap[item.id]);
            if (tab) tab.click();
        } else if (item.id === 'lengthFilter') {
            // Special handling for length filter (maybe focus on filter dropdown?)
            const filter = document.getElementById('length-filter');
            if (filter) {
                filter.focus();
                filter.classList.add('highlight-pulse');
                setTimeout(() => filter.classList.remove('highlight-pulse'), 2000);
            }
        }
    }

    /**
     * Replay tutorial for the feature
     */
    function replayTutorial(item) {
        closeShop();
        if (window.startTutorial) {
            // Map item ID to tutorial mode name if different
            // For most, item.id matches tutorial mode
            window.startTutorial(item.id, true); // true = force replay
        }
    }

    /**
     * Handle item purchase
     */
    /**
     * Show a generic confirmation modal
     */
    function showConfirmModal(title, message) {
        return new Promise((resolve) => {
            const modalId = 'shop-confirm-modal';
            let modal = document.getElementById(modalId);

            if (modal) modal.remove();

            modal = document.createElement('div');
            modal.id = modalId;
            modal.className = 'shop-modal active';
            modal.style.zIndex = '11000'; // Above shop modal

            modal.innerHTML = `
                <div class="shop-modal-content" style="max-width: 400px; text-align: center; padding: 30px;">
                    <h3 style="margin-top: 0; color: #1e293b;">${title}</h3>
                    <p style="color: #64748b; margin-bottom: 24px; line-height: 1.5;">${message}</p>
                    <div style="display: flex; gap: 12px; justify-content: center;">
                        <button id="${modalId}-cancel" style="padding: 10px 20px; border: 1px solid #e2e8f0; background: white; border-radius: 8px; cursor: pointer; font-weight: 600; color: #64748b;">Cancel</button>
                        <button id="${modalId}-confirm" style="padding: 10px 20px; border: none; background: #2563eb; color: white; border-radius: 8px; cursor: pointer; font-weight: 600;">Confirm</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            const confirmBtn = document.getElementById(`${modalId}-confirm`);
            const cancelBtn = document.getElementById(`${modalId}-cancel`);

            function cleanup() {
                modal.remove();
            }

            confirmBtn.onclick = () => {
                cleanup();
                resolve(true);
            };

            cancelBtn.onclick = () => {
                cleanup();
                resolve(false);
            };

            // Close on click outside
            modal.onclick = (e) => {
                if (e.target === modal) {
                    cleanup();
                    resolve(false);
                }
            };
        });
    }

    /**
     * Show a generic alert modal
     */
    function showAlertModal(message, isError = false) {
        const modalId = 'shop-alert-modal';
        let modal = document.getElementById(modalId);

        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = modalId;
        modal.className = 'shop-modal active';
        modal.style.zIndex = '11000'; // Above shop modal

        modal.innerHTML = `
            <div class="shop-modal-content" style="max-width: 400px; text-align: center; padding: 30px;">
                <div style="font-size: 3rem; margin-bottom: 16px;">${isError ? '⚠️' : '✅'}</div>
                <p style="color: #64748b; margin-bottom: 24px; line-height: 1.5; font-size: 1.1rem;">${message}</p>
                <button id="${modalId}-ok" style="padding: 10px 30px; border: none; background: ${isError ? '#ef4444' : '#22c55e'}; color: white; border-radius: 8px; cursor: pointer; font-weight: 600;">OK</button>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById(`${modalId}-ok`).onclick = () => modal.remove();
        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };
    }

    /**
     * Handle item purchase
     */
    async function purchaseItem(item) {
        const userId = window.authUI?.getCurrentUserId?.();
        if (!userId) {
            showAlertModal('Please log in to make purchases.', true);
            return;
        }

        const confirmed = await showConfirmModal(
            'Confirm Purchase',
            `Purchase <strong>${item.title}</strong> for <strong>${item.cost} coins</strong>?`
        );

        if (confirmed) {
            // Optimistic UI update
            const originalCoins = userCoins;
            userCoins -= item.cost;
            unlockedModes.push(item.unlocksMode);
            updateBalanceDisplay();
            renderShop();

            try {
                // 1. Deduct coins
                const deductResult = await window.firebaseFirestoreFunctions.deductCoins(userId, item.cost);
                if (!deductResult.success) {
                    throw new Error(deductResult.error);
                }

                // 2. Unlock mode
                const unlockResult = await window.firebaseFirestoreFunctions.updateUnlockedModes(userId, unlockedModes);
                if (!unlockResult.success) {
                    throw new Error(unlockResult.error);
                }

                // 3. Record purchase history
                await window.firebaseFirestoreFunctions.recordPurchase(userId, item);

                // Success!
                // Trigger refresh in main script to unlock tabs
                if (window.refreshLockedTabs) window.refreshLockedTabs();

                // Dispatch event for other modules (e.g., DifficultyManager)
                window.dispatchEvent(new CustomEvent('shop-unlock', {
                    detail: { mode: item.unlocksMode }
                }));

                // Refresh full data to get correct server timestamp for UI
                await refreshUserData();
                renderShop();

                // Show success modal
                showAlertModal(`Successfully unlocked ${item.title}!`);

            } catch (error) {
                console.error('Purchase failed:', error);

                // Revert
                userCoins = originalCoins;
                unlockedModes = unlockedModes.filter(m => m !== item.unlocksMode);
                updateBalanceDisplay();
                renderShop();

                showAlertModal('Purchase failed. Please try again.', true);
            }
        }
    }

    /**
     * Check if a mode is unlocked (synchronous check against cached data)
     * Useful for script.js to check before switching tabs
     * Enhanced with localStorage fallback for resilience
     */
    function isModeUnlocked(mode) {
        // 'type' is always unlocked
        if (mode === 'type') return true;

        // If user is guest, only 'type' is allowed
        const userId = window.authUI?.getCurrentUserId?.();
        if (!userId) return false;

        // Check in-memory cache first
        if (unlockedModes.includes(mode)) {
            return true;
        }

        // Fallback: Check localStorage directly (in case Firestore failed but cache exists)
        try {
            // Check unlockedModes cache
            const cachedModes = localStorage.getItem(`unlockedModes_${userId}`);
            if (cachedModes) {
                const modes = JSON.parse(cachedModes);
                if (Array.isArray(modes) && modes.includes(mode)) {
                    // Update in-memory cache for future checks
                    unlockedModes = modes;
                    return true;
                }
            }

            // Check userProfile cache
            const cachedProfile = localStorage.getItem(`userProfile_${userId}`);
            if (cachedProfile) {
                const profile = JSON.parse(cachedProfile);
                if (profile.unlockedModes && Array.isArray(profile.unlockedModes) && profile.unlockedModes.includes(mode)) {
                    // Update in-memory cache for future checks
                    unlockedModes = profile.unlockedModes;
                    return true;
                }
            }
        } catch (e) {
            console.warn('Error checking localStorage for unlocked modes:', e);
        }

        return false;
    }

    /**
     * Update local cache of unlocked modes (called by script.js on login)
     */
    function setUnlockedModes(modes) {
        if (Array.isArray(modes)) {
            unlockedModes = modes;
        }
    }

    function setCoins(amount) {
        userCoins = amount;
        updateBalanceDisplay();

        // Check for affordable items to show notification
        checkForAffordableItems();
    }

    function checkForAffordableItems() {
        if (!notificationDot) return;

        const affordableItem = SHOP_ITEMS.find(item =>
            !unlockedModes.includes(item.unlocksMode) && userCoins >= item.cost
        );

        if (affordableItem) {
            notificationDot.style.display = 'block';
        } else {
            notificationDot.style.display = 'none';
        }
    }

    // Initialize on load
    document.addEventListener('DOMContentLoaded', init);

    return {
        init,
        openShop,
        refreshUserData,
        isModeUnlocked,
        setUnlockedModes,
        setCoins,
        showConfirmModal,
        showAlertModal
    };
})();

// Expose to window
window.shopModule = ShopModule;
