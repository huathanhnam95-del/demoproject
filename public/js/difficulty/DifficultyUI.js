/**
 * DifficultyUI.js
 * Handles visual feedback (Toasts, Modals, Badges) for difficulty changes.
 */
import { DifficultyConfig } from './DifficultyConfig.js';

export class DifficultyUI {
    constructor() {
        this.toastContainer = null;
        this.settingsModal = null;
    }

    init() {
        this.ensureToastContainer();
        // Listen for global custom events if needed, but Manager will likely call methods directly
    }

    ensureToastContainer() {
        if (document.getElementById('difficulty-toast-container')) {
            this.toastContainer = document.getElementById('difficulty-toast-container');
            return;
        }
        this.toastContainer = document.createElement('div');
        this.toastContainer.id = 'difficulty-toast-container';
        document.body.appendChild(this.toastContainer);
    }

    showToast(message, type, iconName) {
        this.ensureToastContainer();
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        if (iconName) {
            const emoji = iconName === 'trending-up' ? '🚀' : (iconName === 'trending-down' ? '🛡️' : 'ℹ️');
            message = `${emoji} ${message}`;
        }

        const span = document.createElement('span');
        span.textContent = message;
        toast.appendChild(span);
        this.toastContainer.appendChild(toast);

        // Animate
        void toast.offsetWidth; // Force reflow
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    showAscensionModal(level, levelName) {
        let modal = document.getElementById('ascension-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'ascension-modal';
            modal.innerHTML = `
                <div class="ascension-content">
                    <div class="ascension-icon">🏆</div>
                    <h2>LEVEL UP!</h2>
                    <p class="ascension-level" id="ascension-level-text"></p>
                    <p class="ascension-sub">Difficulty increased. Keep pushing!</p>
                </div>
            `;
            document.body.appendChild(modal);
        }

        const levelText = document.getElementById('ascension-level-text');
        if (levelText) levelText.textContent = levelName;

        modal.style.display = 'flex';
        void modal.offsetWidth;
        modal.style.opacity = '1';
        const content = modal.querySelector('.ascension-content');
        if (content) content.style.transform = 'scale(1)';

        setTimeout(() => {
            modal.style.opacity = '0';
            if (content) content.style.transform = 'scale(0.8)';
            setTimeout(() => { modal.style.display = 'none'; }, 500);
        }, 3000);
    }

    updateBadge(mode, level, isManual) {
        const badge = document.getElementById('difficulty-badge');
        if (!badge) return;

        const levelName = DifficultyConfig.LEVELS.NAMES[level];
        const suffix = isManual ? ' (M)' : '';
        const textEl = document.getElementById('diff-level-text');

        if (textEl) textEl.textContent = `${levelName}${suffix}`;

        badge.className = `difficulty-badge level-${level}`;
        badge.style.display = 'inline-flex';
        badge.title = `Smart Difficulty: ${mode.toUpperCase()} Mode (Level ${level} - ${levelName})`;
    }

    openSettingsModal(settings, onSave) {
        const oldModal = document.getElementById('difficulty-settings-modal');
        if (oldModal) oldModal.remove();

        const modal = document.createElement('div');
        modal.id = 'difficulty-settings-modal';
        modal.className = 'shop-modal';
        modal.style.zIndex = '11000';

        modal.innerHTML = `
            <div class="shop-modal-content" style="max-width: 450px; padding: 0;">
                <div class="shop-header">
                    <h2>Smart Difficulty (CEFR)</h2>
                    <button class="shop-close-btn" id="diff-s-close">&times;</button>
                </div>
                <div class="shop-body">
                    <div class="setting-group">
                        <label class="setting-label">
                            <span>Auto-Adjust Levels</span>
                            <div class="toggle-switch">
                                <input type="checkbox" id="diff-s-toggle" ${settings.autoAdjustEnabled ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </div>
                        </label>
                        <p class="setting-desc">AI will promote/demote you between A1-C2 based on performance.</p>
                    </div>
                    <div id="diff-s-manual-container" class="setting-group" style="display: ${settings.autoAdjustEnabled ? 'none' : 'block'};">
                        <label class="setting-label">Manual Level (CEFR)</label>
                        <select id="diff-s-manual-level" class="setting-select">
                            ${[1, 2, 3, 4, 5, 6].map(l => `<option value="${l}" ${settings.manualLevel === l ? 'selected' : ''}>${DifficultyConfig.LEVELS.NAMES[l]}</option>`).join('')}
                        </select>
                    </div>
                    <div id="diff-s-sensitivity-container" class="setting-group" style="display: ${settings.autoAdjustEnabled ? 'block' : 'none'};">
                        <label class="setting-label">Sensitivity</label>
                        <select id="diff-s-sensitivity" class="setting-select">
                            <option value="low" ${settings.adjustmentSensitivity === 'low' ? 'selected' : ''}>Low (Stable)</option>
                            <option value="medium" ${settings.adjustmentSensitivity === 'medium' ? 'selected' : ''}>Medium (Recommended)</option>
                            <option value="high" ${settings.adjustmentSensitivity === 'high' ? 'selected' : ''}>High (Responsive)</option>
                        </select>
                    </div>
                    <div style="text-align:right; margin-top:10px;">
                        <button id="diff-s-save" class="shop-item-btn buy" style="width: auto; padding: 12px 32px;">Save Settings</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Bind events
        const toggle = document.getElementById('diff-s-toggle');
        const manualContainer = document.getElementById('diff-s-manual-container');
        const sensitivityContainer = document.getElementById('diff-s-sensitivity-container');

        toggle.addEventListener('change', () => {
            if (toggle.checked) {
                manualContainer.style.display = 'none';
                sensitivityContainer.style.display = 'block';
            } else {
                manualContainer.style.display = 'block';
                sensitivityContainer.style.display = 'none';
            }
        });

        document.getElementById('diff-s-save').addEventListener('click', () => {
            const newSettings = {
                autoAdjustEnabled: toggle.checked,
                adjustmentSensitivity: document.getElementById('diff-s-sensitivity').value,
                manualLevel: parseInt(document.getElementById('diff-s-manual-level').value, 10)
            };
            onSave(newSettings);
            modal.remove();
        });

        const closeFn = () => modal.remove();
        document.getElementById('diff-s-close').onclick = closeFn;
        modal.onclick = (e) => { if (e.target === modal) closeFn(); };

        modal.style.display = 'flex';
        void modal.offsetWidth;
        modal.classList.add('active');
    }
}
