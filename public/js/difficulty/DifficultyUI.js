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
                    <div id="diff-s-manual-container" class="setting-group setting-toggle-panel ${settings.autoAdjustEnabled ? 'setting-hidden' : 'setting-visible'}">
                        <label class="setting-label">Manual Level (CEFR)</label>
                        <select id="diff-s-manual-level" class="setting-select">
                            ${[1, 2, 3, 4, 5, 6].map(l => `<option value="${l}" ${settings.manualLevel === l ? 'selected' : ''}>${DifficultyConfig.LEVELS.NAMES[l]}</option>`).join('')}
                        </select>
                    </div>
                    <div id="diff-s-sensitivity-container" class="setting-group setting-toggle-panel ${settings.autoAdjustEnabled ? 'setting-visible' : 'setting-hidden'}">
                        <label class="setting-label">Sensitivity</label>
                        <p class="setting-desc" style="margin-bottom: 12px;">How quickly your level adjusts based on performance.</p>
                        <div class="sensitivity-options">
                            <label class="sensitivity-card ${settings.adjustmentSensitivity === 'low' ? 'selected' : ''}" data-value="low">
                                <input type="radio" name="diff-sensitivity" value="low" ${settings.adjustmentSensitivity === 'low' ? 'checked' : ''} style="display:none;">
                                <div class="sensitivity-card-header">
                                    <span class="sensitivity-icon">🛡️</span>
                                    <strong>Low (Stable)</strong>
                                </div>
                                <p class="sensitivity-desc">Conservative. Needs 10+ consistent exercises before adjusting. Best if you prefer a steady pace with fewer surprises.</p>
                            </label>
                            <label class="sensitivity-card ${settings.adjustmentSensitivity === 'medium' ? 'selected' : ''}" data-value="medium">
                                <input type="radio" name="diff-sensitivity" value="medium" ${settings.adjustmentSensitivity === 'medium' ? 'checked' : ''} style="display:none;">
                                <div class="sensitivity-card-header">
                                    <span class="sensitivity-icon">⚖️</span>
                                    <strong>Medium (Recommended)</strong>
                                </div>
                                <p class="sensitivity-desc">Balanced. Adjusts every 5–7 exercises. Good for most learners — adapts without overreacting.</p>
                            </label>
                            <label class="sensitivity-card ${settings.adjustmentSensitivity === 'high' ? 'selected' : ''}" data-value="high">
                                <input type="radio" name="diff-sensitivity" value="high" ${settings.adjustmentSensitivity === 'high' ? 'checked' : ''} style="display:none;">
                                <div class="sensitivity-card-header">
                                    <span class="sensitivity-icon">🚀</span>
                                    <strong>High (Responsive)</strong>
                                </div>
                                <p class="sensitivity-desc">Aggressive. Can adjust after just 2–3 exercises. Great for experienced learners who want maximum challenge.</p>
                            </label>
                        </div>
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
                manualContainer.classList.remove('setting-visible');
                manualContainer.classList.add('setting-hidden');
                sensitivityContainer.classList.remove('setting-hidden');
                sensitivityContainer.classList.add('setting-visible');
            } else {
                manualContainer.classList.remove('setting-hidden');
                manualContainer.classList.add('setting-visible');
                sensitivityContainer.classList.remove('setting-visible');
                sensitivityContainer.classList.add('setting-hidden');
            }
        });

        // Sensitivity card selection styling
        const sensitivityCards = modal.querySelectorAll('.sensitivity-card');
        sensitivityCards.forEach(card => {
            card.addEventListener('click', () => {
                sensitivityCards.forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
            });
        });

        document.getElementById('diff-s-save').addEventListener('click', () => {
            const checkedRadio = modal.querySelector('input[name="diff-sensitivity"]:checked');
            const newSettings = {
                autoAdjustEnabled: toggle.checked,
                adjustmentSensitivity: checkedRadio ? checkedRadio.value : 'medium',
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
