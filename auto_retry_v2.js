/* eslint-disable no-console */
/**
 * Auto-Retry HUD v2.0
 * Specialized for Cursor AI IDE
 * Combines robust iframe-aware button detection with a draggable control interface.
 */
(function () {
    'use strict';

    // ==================== CONFIGURATION ====================
    const CFG = {
        scanIntervalMs: 500,
        clickRetry: true,
        log: false,
        patterns: ['retry', 'try again', 'restart', 'regenerate']
    };

    // ==================== STATE MANAGEMENT ====================
    const state = {
        timer: null,
        clicks: 0,
        lastActionAt: 0,
        clickedElements: new WeakSet(), // Prevent clicking the same instance twice
        ui: null,
        dragging: false,
        drag: { startX: 0, startY: 0, offX: 0, offY: 0 },
        lastScannedAt: 0,
        collapsed: false
    };

    // ==================== UTILITIES ====================
    function cleanText(s) {
        return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function isVisible(el) {
        if (!el || el.nodeType !== 1) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const style = window.getComputedStyle(el);
        if (!style) return true;
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function labelOf(el) {
        const text = el.innerText || el.textContent || '';
        const aria = el.getAttribute ? el.getAttribute('aria-label') : '';
        const title = el.getAttribute ? el.getAttribute('title') : '';
        return cleanText(`${text} ${aria} ${title}`);
    }

    function safeClick(el, reason) {
        const now = Date.now();
        if (!el || el.disabled || state.clickedElements.has(el)) return false;
        if (!isVisible(el)) return false;

        try {
            el.click();
            state.clickedElements.add(el);
            state.clicks++;
            state.lastActionAt = now;
            if (CFG.log) console.log(`[Auto-Retry] 🎯 Clicked: ${reason} | Total: ${state.clicks}`);
            setStatus(`Clicked: ${reason}`);
            refreshHUD();
            return true;
        } catch (e) {
            console.error('[Auto-Retry] Click failed', e);
            setStatus('Click failed');
            return false;
        }
    }

    // ==================== SEARCH LOGIC ====================
    function findAndClickRetry() {
        const now = Date.now();
        if (now - state.lastScannedAt < 200) return; // Debounce
        state.lastScannedAt = now;

        // 1. Search top-level document
        const topButtons = document.querySelectorAll('button, [role="button"]');
        for (const btn of topButtons) {
            const label = labelOf(btn);
            if (CFG.patterns.some(p => label === p || (label.includes(p) && label.length < 20))) {
                if (safeClick(btn, label)) return;
            }
        }

        // 2. Search iframes (AI panes often use iframes)
        const iframes = document.querySelectorAll('iframe');
        iframes.forEach((iframe) => {
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                if (!iframeDoc || !iframeDoc.body) return;

                const buttons = iframeDoc.querySelectorAll('button, [role="button"]');
                for (const btn of buttons) {
                    const label = labelOf(btn);
                    if (CFG.patterns.some(p => label === p || (label.includes(p) && label.length < 20))) {
                        if (safeClick(btn, label)) return;
                    }
                }
            } catch (e) {
                // Ignore cross-origin errors
            }
        });
    }

    // ==================== HUD INTERFACE ====================
    function setStatus(msg) {
        if (!state.ui) return;
        const el = state.ui.querySelector('[data-role="status"]');
        if (el) el.textContent = msg;
    }

    function refreshHUD() {
        if (!state.ui) return;
        state.ui.querySelector('[data-role="running"]').textContent = state.timer ? 'ACTIVE' : 'IDLE';
        state.ui.querySelector('[data-role="clicks"]').textContent = String(state.clicks);
        state.ui.querySelector('[data-role="interval"]').textContent = `${CFG.scanIntervalMs}ms`;
        const btn = state.ui.querySelector('[data-role="toggle"]');
        btn.textContent = state.timer ? 'Stop' : 'Start';
        btn.style.background = state.timer ? 'rgba(232, 17, 35, 0.85)' : 'rgba(0, 122, 204, 0.85)';
    }

    function toggle() {
        if (state.timer) {
            clearInterval(state.timer);
            state.timer = null;
            setStatus('Stopped');
        } else {
            setStatus('Monitoring...');
            findAndClickRetry();
            state.timer = setInterval(findAndClickRetry, CFG.scanIntervalMs);
        }
        refreshHUD();
    }

    function createHUD() {
        const old = document.getElementById('__cursor_auto_retry_hud__');
        if (old) old.remove();

        const hud = document.createElement('div');
        hud.id = '__cursor_auto_retry_hud__';
        hud.style.cssText = `
            position: fixed; top: 20px; right: 20px; z-index: 999999;
            background: rgba(30,30,30,0.95); color: #fff; border: 1px solid #444;
            border-radius: 8px; padding: 12px; font-family: Segoe UI, sans-serif;
            font-size: 12px; min-width: 180px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            user-select: none; backdrop-filter: blur(4px);
        `;

        const header = document.createElement('div');
        header.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid #444; margin-bottom: 8px; cursor: move;';

        const headerTitle = document.createElement('b');
        headerTitle.textContent = 'Auto-Retry';
        header.appendChild(headerTitle);

        const collapseBtn = document.createElement('button');
        collapseBtn.textContent = '–';
        collapseBtn.style.cssText = 'width: 20px; height: 20px; background: rgba(255,255,255,0.1); border: 1px solid #555; color: #fff; cursor: pointer; border-radius: 4px; line-height: 1;';
        header.appendChild(collapseBtn);

        const body = document.createElement('div');

        const stats = document.createElement('div');
        stats.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 8px;';

        function makeStat(label, role) {
            const div = document.createElement('div');
            div.style.padding = '4px';

            const span = document.createElement('span');
            span.style.opacity = '0.7';
            span.textContent = `${label}:`;

            const br = document.createElement('br');

            const b = document.createElement('b');
            b.setAttribute('data-role', role);
            b.textContent = '-';

            div.appendChild(span);
            div.appendChild(br);
            div.appendChild(b);
            return div;
        }

        stats.appendChild(makeStat('State', 'running'));
        stats.appendChild(makeStat('Retries', 'clicks'));
        stats.appendChild(makeStat('Interval', 'interval'));

        const toggleBtn = document.createElement('button');
        toggleBtn.setAttribute('data-role', 'toggle');
        toggleBtn.style.cssText = 'width: 100%; padding: 6px; border: none; border-radius: 4px; color: #fff; font-weight: bold; cursor: pointer;';
        toggleBtn.addEventListener('click', toggle);

        const statusLabel = document.createElement('div');
        statusLabel.setAttribute('data-role', 'status');
        statusLabel.style.cssText = 'margin-top: 8px; font-size: 10px; opacity: 0.6; text-align: center;';
        statusLabel.textContent = 'Ready';

        body.appendChild(stats);
        body.appendChild(toggleBtn);
        body.appendChild(statusLabel);

        hud.appendChild(header);
        hud.appendChild(body);
        document.body.appendChild(hud);

        collapseBtn.addEventListener('click', () => {
            state.collapsed = !state.collapsed;
            body.style.display = state.collapsed ? 'none' : 'block';
            collapseBtn.textContent = state.collapsed ? '+' : '–';
            hud.style.minWidth = state.collapsed ? '100px' : '180px';
        });

        // Draggable logic
        header.onmousedown = (e) => {
            state.dragging = true;
            state.drag.startX = e.clientX;
            state.drag.startY = e.clientY;
            const m = (hud.style.transform || '').match(/translate3d\(([-0-9.]+)px,\s*([-0-9.]+)px,\s*0px\)/);
            state.drag.offX = m ? Number(m[1]) : 0;
            state.drag.offY = m ? Number(m[2]) : 0;
        };

        window.onmousemove = (e) => {
            if (!state.dragging) return;
            const dx = e.clientX - state.drag.startX;
            const dy = e.clientY - state.drag.startY;
            hud.style.transform = `translate3d(${state.drag.offX + dx}px, ${state.drag.offY + dy}px, 0px)`;
        };

        window.onmouseup = () => state.dragging = false;

        return hud;
    }

    // Initialize
    state.ui = createHUD();
    toggle(); // Start automatically
    console.log('[Auto-Retry] HUD Loaded. Watching for Retry buttons...');

})();
