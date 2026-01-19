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
            id: 'vocabBook',
            title: 'Vocab Book',
            description: 'Save difficult words and review them later.',
            icon: '📖',
            cost: 30,
            unlocksMode: 'vocabBook'
        }
    ];

    let userCoins = 0;
    let unlockedModes = ['type']; // default
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

        isInitialized = true;
        console.log('🛒 Shop Module Initialized');
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

        try {
            const result = await window.firebaseFirestoreFunctions.getUserProfile(userId);
            if (result.success) {
                userCoins = result.data.coins || 0;
                unlockedModes = result.data.unlockedModes || ['type'];
                updateBalanceDisplay();
            }

            // Fetch purchase history to get dates
            const purchasesResult = await window.firebaseFirestoreFunctions.getPurchases(userId);
            if (purchasesResult.success) {
                purchaseHistory = purchasesResult.data;
            }
        } catch (error) {
            console.error('Error refreshing shop data:', error);
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
                actionButtons = `
                    <div class="shop-owned-actions">
                        <button class="shop-play-btn" data-id="${item.id}">Play ▶️</button>
                        <button class="shop-tutorial-btn" data-id="${item.id}">Tutorial ❓</button>
                    </div>
                `;
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

                if (playBtn) playBtn.onclick = () => activateFeature(item);
                if (tutorialBtn) tutorialBtn.onclick = () => replayTutorial(item);
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
    async function purchaseItem(item) {
        const userId = window.authUI?.getCurrentUserId?.();
        if (!userId) {
            alert('Please log in to make purchases.');
            return;
        }

        if (confirm(`Purchase ${item.title} for ${item.cost} coins?`)) {
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

                // Refresh full data to get correct server timestamp for UI
                await refreshUserData();
                renderShop();

                // Show success toast instead of alert?
                // alert(`Successfully unlocked ${item.title}!`);

            } catch (error) {
                console.error('Purchase failed:', error);
                alert('Purchase failed. Please try again.');
                // Revert
                userCoins = originalCoins;
                unlockedModes = unlockedModes.filter(m => m !== item.unlocksMode);
                updateBalanceDisplay();
                renderShop();
            }
        }
    }

    /**
     * Check if a mode is unlocked (synchronous check against cached data)
     * Useful for script.js to check before switching tabs
    */
    function isModeUnlocked(mode) {
        // 'type' is always unlocked
        if (mode === 'type') return true;

        // If user is guest, only 'type' is allowed
        const userId = window.authUI?.getCurrentUserId?.();
        if (!userId) return false;

        return unlockedModes.includes(mode);
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
        setCoins
    };
})();

// Expose to window
window.shopModule = ShopModule;
