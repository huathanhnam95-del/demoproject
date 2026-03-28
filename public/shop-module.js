/**
 * Journey Module (Skill Tree modal).
 * Kept as ShopModule for backward compatibility with existing callers.
 */

const ShopModule = (() => {
    // Core modes/features are always available (no gating).
    const CORE_ALWAYS_UNLOCKED_MODES = new Set(['type', 'speak', 'extended', 'watch', 'notes', 'pronounce', 'survival', 'autoAdjust']);

    // Legacy "modes" mapped to passive skill IDs.
    const FILTER_SKILL_MAP = {
        lengthFilter: 'length_filter'
    };

    let userCoins = 0;
    let unlockedModes = [...CORE_ALWAYS_UNLOCKED_MODES];
    let unlockedSkills = {};
    let userProfileSnapshot = {};
    let isInitialized = false;

    // DOM elements (resolved in init()).
    let modal = null;
    let closeBtn = null;

    function init() {
        if (isInitialized) return;

        modal = document.getElementById('shop-modal');
        closeBtn = document.getElementById('shop-close-btn');

        if (closeBtn) closeBtn.addEventListener('click', closeShop);
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeShop();
            });
        }

        // Prime caches.
        refreshUserData().finally(() => {
            isInitialized = true;
        });
    }

    /**
     * Open the Journey modal (Skill Tree only).
     * Kept as openShop for backward compatibility with existing callers.
     */
    async function openShop() {
        if (!modal) return;
        await refreshUserData();
        modal.classList.add('active');
        await renderSkillTree();
    }

    function closeShop() {
        if (!modal) return;
        modal.classList.remove('active');
    }

    /**
     * Refresh user data (coins, unlocked modes, skill unlocks) from Firestore.
     * Falls back to localStorage caches when Firestore fails.
     */
    async function refreshUserData() {
        const userId = window.authUI?.getCurrentUserId?.();
        if (!userId) {
            userCoins = 0;
            unlockedModes = [...CORE_ALWAYS_UNLOCKED_MODES];
            unlockedSkills = {};
            userProfileSnapshot = {};
            return;
        }

        const cachedModes = localStorage.getItem(`unlockedModes_${userId}`);
        const cachedCoins = localStorage.getItem(`coins_${userId}`);
        const cachedSkills = localStorage.getItem(`unlockedSkills_${userId}`);

        try {
            const result = await window.firebaseFirestoreFunctions.getUserProfile(userId);
            if (!result?.success) {
                throw new Error('getUserProfile failed');
            }

            userProfileSnapshot = result.data || {};
            userCoins = Number(userProfileSnapshot.coins) || 0;
            const remoteModes = Array.isArray(userProfileSnapshot.unlockedModes) ? userProfileSnapshot.unlockedModes : [];
            unlockedModes = [...new Set([...remoteModes, ...CORE_ALWAYS_UNLOCKED_MODES])];
            unlockedSkills = userProfileSnapshot.unlockedSkills && typeof userProfileSnapshot.unlockedSkills === 'object'
                ? userProfileSnapshot.unlockedSkills
                : {};

            localStorage.setItem(`unlockedModes_${userId}`, JSON.stringify(unlockedModes));
            localStorage.setItem(`coins_${userId}`, String(userCoins));
            localStorage.setItem(`unlockedSkills_${userId}`, JSON.stringify(unlockedSkills));
        } catch (error) {
            console.warn('[ShopModule] refreshUserData fallback:', error);

            if (cachedModes) {
                try {
                    unlockedModes = JSON.parse(cachedModes);
                } catch (e) {
                    unlockedModes = [...CORE_ALWAYS_UNLOCKED_MODES];
                }
            } else {
                unlockedModes = [...CORE_ALWAYS_UNLOCKED_MODES];
            }

            if (cachedCoins) {
                userCoins = parseInt(cachedCoins, 10) || 0;
            } else {
                userCoins = 0;
            }

            if (cachedSkills) {
                try {
                    unlockedSkills = JSON.parse(cachedSkills) || {};
                } catch (e) {
                    unlockedSkills = {};
                }
            } else {
                unlockedSkills = {};
            }

            unlockedModes = [...new Set([...(unlockedModes || []), ...CORE_ALWAYS_UNLOCKED_MODES])];
            userProfileSnapshot = userProfileSnapshot && typeof userProfileSnapshot === 'object'
                ? userProfileSnapshot
                : {};
        }
    }

    function isSkillGranted(skillId) {
        if (!skillId) return false;
        if (unlockedSkills && unlockedSkills[skillId] === true) return true;
        if (userProfileSnapshot?.unlockedSkills?.[skillId] === true) return true;
        if (userProfileSnapshot?.skillPassives?.[skillId]) return true;
        return false;
    }

    // Backward-compatible helpers expected by older callers (script.js, hint system).
    function isSkillUnlocked(skillId) {
        if (!skillId) return false;
        if (isSkillGranted(skillId)) return true;

        const userId = window.authUI?.getCurrentUserId?.();
        if (!userId) return false;

        try {
            const cachedSkills = localStorage.getItem(`unlockedSkills_${userId}`);
            if (cachedSkills) {
                const parsed = JSON.parse(cachedSkills);
                if (parsed && parsed[skillId] === true) {
                    unlockedSkills = parsed;
                    return true;
                }
            }

            const cachedProfile = localStorage.getItem(`userProfile_${userId}`);
            if (cachedProfile) {
                const profile = JSON.parse(cachedProfile);
                if (profile?.unlockedSkills?.[skillId] === true || profile?.skillPassives?.[skillId]) {
                    userProfileSnapshot = profile;
                    if (profile?.unlockedSkills && typeof profile.unlockedSkills === 'object') {
                        unlockedSkills = profile.unlockedSkills;
                    }
                    return true;
                }
            }
        } catch (e) {
            console.warn('[ShopModule] Error checking localStorage unlockedSkills:', e);
        }

        return false;
    }

    function hasSkill(skillId) {
        return isSkillUnlocked(skillId);
    }

    function getCoins() {
        return Number(userCoins) || 0;
    }

    function setCoins(nextCoins) {
        const userId = window.authUI?.getCurrentUserId?.();
        userCoins = Math.max(0, parseInt(nextCoins, 10) || 0);
        if (userProfileSnapshot && typeof userProfileSnapshot === 'object') {
            userProfileSnapshot.coins = userCoins;
        }

        if (userId) {
            try {
                localStorage.setItem(`coins_${userId}`, String(userCoins));
            } catch (e) {
                // Ignore storage failures (private mode / quota)
            }

            try {
                const cachedProfile = localStorage.getItem(`userProfile_${userId}`);
                if (cachedProfile) {
                    const profile = JSON.parse(cachedProfile);
                    if (profile && typeof profile === 'object') {
                        profile.coins = userCoins;
                        localStorage.setItem(`userProfile_${userId}`, JSON.stringify(profile));
                    }
                }
            } catch (e) {
                // Ignore cache update failures
            }
        }
    }

    function isModeUnlockedFromLegacyCaches(mode, userId) {
        if (unlockedModes.includes(mode)) return true;
        if (!userId) return false;

        try {
            const cachedModes = localStorage.getItem(`unlockedModes_${userId}`);
            if (cachedModes) {
                const modes = JSON.parse(cachedModes);
                if (Array.isArray(modes) && modes.includes(mode)) {
                    unlockedModes = modes;
                    return true;
                }
            }

            const cachedProfile = localStorage.getItem(`userProfile_${userId}`);
            if (cachedProfile) {
                const profile = JSON.parse(cachedProfile);
                if (Array.isArray(profile?.unlockedModes) && profile.unlockedModes.includes(mode)) {
                    unlockedModes = profile.unlockedModes;
                    return true;
                }
            }
        } catch (e) {
            console.warn('[ShopModule] Error checking localStorage unlockedModes:', e);
        }

        return false;
    }

    /**
     * Check if a mode/feature is unlocked.
     * Filters are now passive skill unlocks with legacy unlockedModes fallback.
     */
    function isModeUnlocked(mode) {
        if (CORE_ALWAYS_UNLOCKED_MODES.has(mode)) return true;

        const filterSkillId = FILTER_SKILL_MAP[mode];
        if (filterSkillId && isSkillGranted(filterSkillId)) {
            return true;
        }

        const userId = window.authUI?.getCurrentUserId?.();
        if (!userId) return false;

        if (isModeUnlockedFromLegacyCaches(mode, userId)) {
            return true;
        }

        if (!filterSkillId) return false;

        try {
            const cachedSkills = localStorage.getItem(`unlockedSkills_${userId}`);
            if (cachedSkills) {
                const parsed = JSON.parse(cachedSkills);
                if (parsed && parsed[filterSkillId] === true) {
                    unlockedSkills = parsed;
                    return true;
                }
            }

            const cachedProfile = localStorage.getItem(`userProfile_${userId}`);
            if (cachedProfile) {
                const profile = JSON.parse(cachedProfile);
                if (profile?.unlockedSkills?.[filterSkillId] === true || profile?.skillPassives?.[filterSkillId]) {
                    userProfileSnapshot = profile;
                    return true;
                }
            }
        } catch (e) {
            console.warn('[ShopModule] Error checking localStorage unlockedSkills:', e);
        }

        return false;
    }

    /**
     * Update local cache of unlocked modes (called by auth-ui on login).
     */
    function setUnlockedModes(modes) {
        if (Array.isArray(modes)) {
            unlockedModes = [...new Set([...modes, ...CORE_ALWAYS_UNLOCKED_MODES])];
        }
    }

    /**
     * Handle RPG skill purchase via purchaseSkill Cloud Function.
     */
    async function purchaseTreeSkill(skillNode) {
        const userId = window.authUI?.getCurrentUserId?.();
        if (!userId) {
            showAlertModal('Please log in to unlock skills.', true);
            return { success: false };
        }

        if (!skillNode || !skillNode.id) {
            showAlertModal('Invalid skill node.', true);
            return { success: false };
        }

        const skillTitle = skillNode.title || skillNode.id;
        const progressionUnlock = window.SkillCatalog?.getProgressionUnlockById?.(skillNode.id);
        if (progressionUnlock) {
            showAlertModal(
                `${skillTitle} now unlocks automatically through practice progression.`,
                true
            );
            return { success: false, deprecated: true };
        }

        showAlertModal('Manual skill purchases have been retired.', true);
        return { success: false, deprecated: true };
    }

    /**
     * Render the Skill Tree using LevelSystem.
     */
    async function renderSkillTree() {
        const container = document.getElementById('level-system-container');
        if (!container || !window.LevelSystem) return;

        await refreshUserData();
        const userProfile = userProfileSnapshot && typeof userProfileSnapshot === 'object'
            ? userProfileSnapshot
            : { coins: userCoins || 0, unlockedSkills: unlockedSkills || {}, skillPoints: {} };

        window.LevelSystem.renderSkillTree(container, userProfile, async (skillNode) => {
            return purchaseTreeSkill(skillNode);
        });
    }

    /**
     * Show a generic confirmation modal.
     */
    function showConfirmModal(title, message) {
        return new Promise((resolve) => {
            const modalId = 'shop-confirm-modal';
            let confirmModal = document.getElementById(modalId);

            if (confirmModal) confirmModal.remove();

            confirmModal = document.createElement('div');
            confirmModal.id = modalId;
            confirmModal.className = 'shop-modal active';
            confirmModal.style.zIndex = '11000'; // Above Journey modal

            confirmModal.innerHTML = `
                <div class="shop-modal-content" style="max-width: 400px; text-align: center; padding: 30px;">
                    <h3 style="margin-top: 0; color: #1e293b;">${title}</h3>
                    <p style="color: #64748b; margin-bottom: 24px; line-height: 1.5;">${message}</p>
                    <div style="display: flex; gap: 12px; justify-content: center;">
                        <button id="${modalId}-cancel" style="padding: 10px 20px; border: 1px solid #e2e8f0; background: white; border-radius: 8px; cursor: pointer; font-weight: 600; color: #64748b;">Cancel</button>
                        <button id="${modalId}-confirm" style="padding: 10px 20px; border: none; background: #2563eb; color: white; border-radius: 8px; cursor: pointer; font-weight: 600;">Confirm</button>
                    </div>
                </div>
            `;

            document.body.appendChild(confirmModal);

            const confirmBtn = document.getElementById(`${modalId}-confirm`);
            const cancelBtn = document.getElementById(`${modalId}-cancel`);

            function cleanup(result) {
                confirmModal.remove();
                resolve(result);
            }

            confirmBtn.onclick = () => cleanup(true);
            cancelBtn.onclick = () => cleanup(false);
            confirmModal.onclick = (e) => {
                if (e.target === confirmModal) cleanup(false);
            };
        });
    }

    /**
     * Show a generic alert modal.
     */
    function showAlertModal(message, isError = false) {
        const modalId = 'shop-alert-modal';
        let alertModal = document.getElementById(modalId);

        if (alertModal) alertModal.remove();

        alertModal = document.createElement('div');
        alertModal.id = modalId;
        alertModal.className = 'shop-modal active';
        alertModal.style.zIndex = '11000'; // Above Journey modal

        alertModal.innerHTML = `
            <div class="shop-modal-content" style="max-width: 400px; text-align: center; padding: 30px;">
                <div style="font-size: 3rem; margin-bottom: 16px;">${isError ? '⚠️' : '✅'}</div>
                <p style="color: #64748b; margin-bottom: 24px; line-height: 1.5; font-size: 1.1rem;">${message}</p>
                <button id="${modalId}-ok" style="padding: 10px 30px; border: none; background: ${isError ? '#ef4444' : '#22c55e'}; color: white; border-radius: 8px; cursor: pointer; font-weight: 600;">OK</button>
            </div>
        `;

        document.body.appendChild(alertModal);

        document.getElementById(`${modalId}-ok`).onclick = () => alertModal.remove();
        alertModal.onclick = (e) => {
            if (e.target === alertModal) alertModal.remove();
        };
    }

    document.addEventListener('DOMContentLoaded', init);

    return {
        init,
        openShop,
        refreshUserData,
        isModeUnlocked,
        isSkillUnlocked,
        hasSkill,
        getCoins,
        setCoins,
        setUnlockedModes,
        showAlertModal,
        renderSkillTree
    };
})();

window.shopModule = ShopModule;
