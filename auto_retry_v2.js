/* eslint-disable no-console */
/**
 * Auto-Retry HUD v2.1
 * Specialized for Cursor AI IDE
 * Combines robust iframe-aware button detection with a draggable control interface.
 *
 * Public API (available after load):
 *   window.__autoRetry.toggle()   – Start / Stop scanning
 *   window.__autoRetry.destroy()  – Remove HUD, clear timers, detach listeners
 */
(function () {
    'use strict';

    // ==================== CONFIGURATION ====================
    const CFG = {
        scanIntervalMs: 500,
        debounceMs: 200,
        maxLabelLength: 40,
        clickRetry: true,
        log: false,
        patterns: ['retry', 'try again', 'restart', 'regenerate', 'run', 'accept', 'run command'],
        scrollIntervalMs: 1500, // How often to auto-scroll chat pane
        hudId: '__cursor_auto_retry_hud__',
        zIndex: 999999,
    };

    // ==================== STATE ====================
    const state = {
        timer: null,
        clicks: 0,
        lastActionAt: 0,
        clickedElements: new WeakSet(),
        ui: null,
        dragging: false,
        drag: { startX: 0, startY: 0, offX: 0, offY: 0 },
        lastScannedAt: 0,
        collapsed: false,
        listeners: [], // Track listeners for cleanup
    };

    // ==================== UTILITIES ====================

    /** Normalize text to lowercase with collapsed whitespace. */
    function cleanText(s) {
        return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    /** Check if an element is rendered (has dimensions and not display:none). */
    function isRendered(el) {
        if (!el || el.nodeType !== 1) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const style = window.getComputedStyle(el);
        if (!style) return true;
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    /** Check if an element is within the visible viewport. */
    function isInViewport(el) {
        const rect = el.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    }

    /** Scroll the element into view if it exists but is off-screen. */
    function scrollToElement(el) {
        try {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (_) { /* ignore */ }
    }

    /** Extract a combined label from element text, aria-label, and title. */
    function labelOf(el) {
        const text = el.innerText || el.textContent || '';
        const aria = el.getAttribute?.('aria-label') || '';
        const title = el.getAttribute?.('title') || '';
        return cleanText(`${text} ${aria} ${title}`);
    }

    /** Test whether a button label matches any retry pattern. */
    function isRetryLabel(label) {
        return CFG.patterns.some(
            (p) => label === p || (label.includes(p) && label.length < CFG.maxLabelLength)
        );
    }

    /** Safely click a button with guard checks. Returns true on success. */
    function safeClick(el, reason) {
        if (!el || el.disabled || state.clickedElements.has(el)) return false;
        if (!isRendered(el)) return false;

        try {
            // Scroll into view first if off-screen
            if (!isInViewport(el)) {
                scrollToElement(el);
                if (CFG.log) console.log(`[Auto-Retry] 📜 Scrolled to: ${reason}`);
            }
            el.click();
            state.clickedElements.add(el);
            state.clicks++;
            state.lastActionAt = Date.now();
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

    /**
     * Scroll the chat/conversation pane to the bottom so new buttons are visible.
     * Tries multiple selectors to find the scrollable container.
     */
    function scrollChatToBottom() {
        // Common scrollable container selectors in Cursor/VS Code
        const selectors = [
            '.monaco-scrollable-element',
            '[class*="chat"] [class*="scroll"]',
            '[class*="conversation"]',
            '[class*="response"]',
            '.overflow-y-auto',
            '[style*="overflow"]',
        ];
        for (const sel of selectors) {
            try {
                const containers = document.querySelectorAll(sel);
                for (const c of containers) {
                    if (c.scrollHeight > c.clientHeight + 100) {
                        c.scrollTop = c.scrollHeight;
                    }
                }
            } catch (_) { /* ignore */ }
        }

        // Also try iframes
        for (const iframe of document.querySelectorAll('iframe')) {
            try {
                const iDoc = iframe.contentDocument || iframe.contentWindow?.document;
                if (!iDoc) continue;
                for (const sel of selectors) {
                    const containers = iDoc.querySelectorAll(sel);
                    for (const c of containers) {
                        if (c.scrollHeight > c.clientHeight + 100) {
                            c.scrollTop = c.scrollHeight;
                        }
                    }
                }
            } catch (_) { /* ignore cross-origin */ }
        }
    }

    /**
     * Scan a document for retry/accept/run buttons and click the first match.
     * @param {Document} doc – document to scan
     * @returns {boolean} true if a button was clicked
     */
    function scanDocument(doc) {
        if (!doc?.body) return false;
        const buttons = doc.querySelectorAll('button, [role="button"], a[class*="btn"], div[class*="btn"]');
        for (const btn of buttons) {
            const label = labelOf(btn);
            if (isRetryLabel(label) && safeClick(btn, label)) return true;
        }
        return false;
    }

    /** Main scan: scroll down first, then search top-level document + all iframes. */
    function findAndClickRetry() {
        const now = Date.now();
        if (now - state.lastScannedAt < CFG.debounceMs) return;
        state.lastScannedAt = now;

        // 0. Scroll the chat pane to the bottom to reveal new buttons
        scrollChatToBottom();

        // 1. Search top-level document
        if (scanDocument(document)) return;

        // 2. Search iframes (AI panes often use iframes)
        for (const iframe of document.querySelectorAll('iframe')) {
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                if (scanDocument(iframeDoc)) return;
            } catch (_) {
                // Ignore cross-origin errors
            }
        }
    }

    // ==================== HUD INTERFACE ====================

    /** Safely query a data-role element inside the HUD. */
    function hudEl(role) {
        return state.ui?.querySelector(`[data-role="${role}"]`) ?? null;
    }

    function setStatus(msg) {
        const el = hudEl('status');
        if (el) el.textContent = msg;
    }

    function refreshHUD() {
        if (!state.ui) return;

        const running = hudEl('running');
        const clicks = hudEl('clicks');
        const interval = hudEl('interval');
        const btn = hudEl('toggle');

        if (running) running.textContent = state.timer ? 'ACTIVE' : 'IDLE';
        if (clicks) clicks.textContent = String(state.clicks);
        if (interval) interval.textContent = `${CFG.scanIntervalMs}ms`;
        if (btn) {
            btn.textContent = state.timer ? 'Stop' : 'Start';
            btn.style.background = state.timer
                ? 'rgba(232, 17, 35, 0.85)'
                : 'rgba(0, 122, 204, 0.85)';
        }
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

    // ==================== HUD STYLES ====================

    /** Inject a <style> block (once) for the HUD. Returns the style element. */
    function injectStyles() {
        const id = `${CFG.hudId}-style`;
        if (document.getElementById(id)) return;

        const style = document.createElement('style');
        style.id = id;
        style.textContent = /* css */ `
            #${CFG.hudId} {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: ${CFG.zIndex};
                background: rgba(30,30,30,0.95);
                color: #fff;
                border: 1px solid #444;
                border-radius: 8px;
                padding: 12px;
                font-family: 'Segoe UI', sans-serif;
                font-size: 12px;
                min-width: 180px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                user-select: none;
                backdrop-filter: blur(4px);
            }
            #${CFG.hudId} .hud-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding-bottom: 8px;
                border-bottom: 1px solid #444;
                margin-bottom: 8px;
                cursor: move;
            }
            #${CFG.hudId} .hud-stats {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 4px;
                margin-bottom: 8px;
            }
            #${CFG.hudId} .hud-stat { padding: 4px; }
            #${CFG.hudId} .hud-stat span { opacity: 0.7; }
            #${CFG.hudId} .hud-collapse {
                width: 20px;
                height: 20px;
                background: rgba(255,255,255,0.1);
                border: 1px solid #555;
                color: #fff;
                cursor: pointer;
                border-radius: 4px;
                line-height: 1;
            }
            #${CFG.hudId} .hud-toggle {
                width: 100%;
                padding: 6px;
                border: none;
                border-radius: 4px;
                color: #fff;
                font-weight: bold;
                cursor: pointer;
            }
            #${CFG.hudId} .hud-status {
                margin-top: 8px;
                font-size: 10px;
                opacity: 0.6;
                text-align: center;
            }
        `;
        document.head.appendChild(style);
    }

    // ==================== HUD CONSTRUCTION ====================

    /** Register a window-level event listener and track it for cleanup. */
    function addTrackedListener(target, event, handler) {
        target.addEventListener(event, handler);
        state.listeners.push({ target, event, handler });
    }

    /** Create a stat display cell. */
    function makeStat(label, role) {
        const div = document.createElement('div');
        div.className = 'hud-stat';

        const span = document.createElement('span');
        span.textContent = `${label}:`;

        const b = document.createElement('b');
        b.setAttribute('data-role', role);
        b.textContent = '-';

        div.appendChild(span);
        div.appendChild(document.createElement('br'));
        div.appendChild(b);
        return div;
    }

    function createHUD() {
        const old = document.getElementById(CFG.hudId);
        if (old) old.remove();

        injectStyles();

        const hud = document.createElement('div');
        hud.id = CFG.hudId;

        // — Header (draggable) —
        const header = document.createElement('div');
        header.className = 'hud-header';

        const headerTitle = document.createElement('b');
        headerTitle.textContent = 'Auto-Retry';
        header.appendChild(headerTitle);

        const collapseBtn = document.createElement('button');
        collapseBtn.className = 'hud-collapse';
        collapseBtn.textContent = '–';
        header.appendChild(collapseBtn);

        // — Body —
        const body = document.createElement('div');

        const stats = document.createElement('div');
        stats.className = 'hud-stats';
        stats.appendChild(makeStat('State', 'running'));
        stats.appendChild(makeStat('Retries', 'clicks'));
        stats.appendChild(makeStat('Interval', 'interval'));

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'hud-toggle';
        toggleBtn.setAttribute('data-role', 'toggle');
        toggleBtn.addEventListener('click', toggle);

        const statusLabel = document.createElement('div');
        statusLabel.className = 'hud-status';
        statusLabel.setAttribute('data-role', 'status');
        statusLabel.textContent = 'Ready';

        body.appendChild(stats);
        body.appendChild(toggleBtn);
        body.appendChild(statusLabel);

        hud.appendChild(header);
        hud.appendChild(body);
        document.body.appendChild(hud);

        // — Collapse toggle —
        collapseBtn.addEventListener('click', () => {
            state.collapsed = !state.collapsed;
            body.style.display = state.collapsed ? 'none' : 'block';
            collapseBtn.textContent = state.collapsed ? '+' : '–';
            hud.style.minWidth = state.collapsed ? '100px' : '180px';
        });

        // — Draggable logic (addEventListener, not onmouse*) —
        header.addEventListener('mousedown', (e) => {
            state.dragging = true;
            state.drag.startX = e.clientX;
            state.drag.startY = e.clientY;
            const m = (hud.style.transform || '').match(
                /translate3d\(([-0-9.]+)px,\s*([-0-9.]+)px,\s*0px\)/
            );
            state.drag.offX = m ? Number(m[1]) : 0;
            state.drag.offY = m ? Number(m[2]) : 0;
        });

        addTrackedListener(window, 'mousemove', (e) => {
            if (!state.dragging) return;
            const dx = e.clientX - state.drag.startX;
            const dy = e.clientY - state.drag.startY;
            hud.style.transform = `translate3d(${state.drag.offX + dx}px, ${state.drag.offY + dy}px, 0px)`;
        });

        addTrackedListener(window, 'mouseup', () => {
            state.dragging = false;
        });

        return hud;
    }

    // ==================== LIFECYCLE ====================

    /** Remove HUD, clear timers, detach all tracked listeners. */
    function destroy() {
        if (state.timer) {
            clearInterval(state.timer);
            state.timer = null;
        }

        // Remove tracked window listeners
        for (const { target, event, handler } of state.listeners) {
            target.removeEventListener(event, handler);
        }
        state.listeners.length = 0;

        // Remove DOM
        const hud = document.getElementById(CFG.hudId);
        if (hud) hud.remove();
        const style = document.getElementById(`${CFG.hudId}-style`);
        if (style) style.remove();

        state.ui = null;
        console.log('[Auto-Retry] Destroyed.');
    }

    // ==================== INIT ====================
    state.ui = createHUD();
    toggle(); // Start automatically
    console.log('[Auto-Retry] HUD Loaded. Watching for Retry buttons...');

    // Public API
    window.__autoRetry = { toggle, destroy };
})();
