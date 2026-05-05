window.CrmBelAssistant = (function () {
    'use strict';

    const ALLOWED_TARGETS = Object.freeze({
        'lead-name': { type: 'text' },
        'lead-email': { type: 'text' },
        'lead-phone': { type: 'text' },
        'lead-source': { type: 'text' },
        'lead-agent-source': { type: 'select' },
        'lead-stage': { type: 'select' },
        'lead-probability': { type: 'number' },

        'student-name': { type: 'text' },
        'student-label': { type: 'text' },
        'student-phone': { type: 'text' },
        'student-email': { type: 'text' },
        'student-zalo': { type: 'text' },
        'student-facebook': { type: 'text' },
        'student-acquisition-source': { type: 'text' },
        'student-agent-source': { type: 'select' },
        'student-level': { type: 'text' },
        'student-target-exam': { type: 'text' },
        'student-target-score': { type: 'text' },
        'student-preferred-learning-days': { type: 'text' },
        'student-preferred-learning-hours': { type: 'text' },
        'student-counseling-notes': { type: 'textarea' },
        'student-finance-enrollment': { type: 'select' },
        'invoice-amount': { type: 'number' },
        'invoice-discount': { type: 'number' },
        'invoice-due-date': { type: 'text' },
        'payment-amount': { type: 'number' },
        'payment-method': { type: 'select' },

        'course-name': { type: 'text' },
        'course-code': { type: 'text' },
        'course-label': { type: 'text' },
        'course-level': { type: 'text' },
        'course-category': { type: 'text' },
        'course-status': { type: 'select' },
        'course-agent-commission-percent': { type: 'number' },
        'course-description': { type: 'textarea' },
        'course-total-hours': { type: 'number' },
        'course-default-session-minutes': { type: 'number' },
        'course-duration-step': { type: 'number' },
        'course-timezone': { type: 'text' },

        'agent-source-name': { type: 'text' },
        'agent-source-status': { type: 'select' },
        'agent-source-notes': { type: 'text' },
        'agent-report-month': { type: 'text' }
    });

    const DOC_PATHS = Object.freeze({
        dashboard: ['/crm-docs/dashboard.md'],
        enquiry: ['/crm-docs/enquiry-leads.md'],
        students: ['/crm-docs/students.md', '/crm-docs/finance.md'],
        courses: ['/crm-docs/courses-classes.md'],
        agents: ['/crm-docs/agents-reporting.md'],
        default: ['/crm-docs/global-crm-workflows.md']
    });

    function sanitizeText(value, maxLength = 3000) {
        const text = String(value || '').trim();
        if (!text) return '';
        return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
    }

    function getPanelGroup(activePanel) {
        const panel = String(activePanel || '').trim().toLowerCase();
        if (panel.startsWith('dashboard')) return 'dashboard';
        if (panel.startsWith('enquiry')) return 'enquiry';
        if (panel.startsWith('students')) return 'students';
        if (panel.startsWith('courses')) return 'courses';
        if (panel.startsWith('agents')) return 'agents';
        return 'default';
    }

    async function fetchDocs(panelGroup) {
        const files = [...(DOC_PATHS[panelGroup] || []), ...DOC_PATHS.default];
        const uniqueFiles = Array.from(new Set(files));
        const chunks = await Promise.all(uniqueFiles.map(async (path) => {
            try {
                const response = await fetch(path, { cache: 'no-store' });
                if (!response.ok) return '';
                const content = await response.text();
                if (!content) return '';
                return `# ${path}\n${sanitizeText(content, 4500)}`;
            } catch (_error) {
                return '';
            }
        }));
        return chunks.filter(Boolean).join('\n\n');
    }

    function getVisibleFieldSnapshot() {
        const rows = [];
        Object.keys(ALLOWED_TARGETS).forEach((target) => {
            const element = document.getElementById(target);
            if (!element) return;
            if (element.closest('[style*="display: none"]')) return;
            const value = sanitizeText(element.value || '', 120);
            if (!value) return;
            rows.push(`${target}: ${value}`);
        });
        return rows.slice(0, 40).join('\n');
    }

    function parseActions(payload) {
        const base = payload && typeof payload === 'object' ? payload : {};
        const actions = Array.isArray(base.actions) ? base.actions : [];
        return actions
            .map((action) => {
                const op = String(action?.op || '').trim().toLowerCase();
                const target = String(action?.target || '').trim();
                const value = sanitizeText(action?.value, 300);
                if ((op !== 'set' && op !== 'select') || !target || !Object.prototype.hasOwnProperty.call(ALLOWED_TARGETS, target)) {
                    return null;
                }
                return {
                    op,
                    target,
                    value
                };
            })
            .filter(Boolean);
    }

    function appendMessage(container, role, text) {
        if (!container) return;
        const bubble = document.createElement('div');
        bubble.className = role === 'assistant' ? 'crm-task-item' : 'crm-muted';
        bubble.style.marginBottom = '10px';
        bubble.textContent = text;
        container.appendChild(bubble);
        container.scrollTop = container.scrollHeight;
    }

    function renderPreview(container, actions) {
        if (!container) return;
        if (!Array.isArray(actions) || !actions.length) {
            container.innerHTML = '<div class="crm-muted">No pending actions.</div>';
            return;
        }
        container.innerHTML = actions.map((action, index) => {
            return `<div class="crm-task-item" style="margin-bottom: 8px;">
                <div class="crm-task-head">
                    <strong>Step ${index + 1}</strong>
                    <span class="crm-task-priority low">${action.op}</span>
                </div>
                <div class="crm-task-meta">${action.target}</div>
                <div>${action.value}</div>
            </div>`;
        }).join('');
    }

    function applyAction(action) {
        const target = String(action?.target || '').trim();
        const spec = ALLOWED_TARGETS[target];
        if (!spec) return false;
        const element = document.getElementById(target);
        if (!element) return false;

        const value = String(action.value || '');
        if (spec.type === 'select' && element.tagName === 'SELECT') {
            const hasExact = Array.from(element.options || []).some((option) => String(option.value) === value);
            if (hasExact) {
                element.value = value;
            } else {
                const fallback = Array.from(element.options || []).find((option) => String(option.textContent || '').trim().toLowerCase() === value.trim().toLowerCase());
                if (fallback) {
                    element.value = String(fallback.value || '');
                } else {
                    return false;
                }
            }
        } else {
            element.value = value;
        }

        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    function createController(deps = {}) {
        const {
            elements,
            showToast,
            fetchGemmaJSON,
            getActivePanel
        } = deps;

        const state = {
            activePanel: '',
            pendingActions: [],
            busy: false
        };

        function setBusy(next) {
            state.busy = next === true;
            if (elements.belChatSend) elements.belChatSend.disabled = state.busy;
            if (elements.belChatApply) elements.belChatApply.disabled = state.busy || state.pendingActions.length === 0;
        }

        function setContextLabel() {
            if (!elements.belChatContext) return;
            elements.belChatContext.textContent = state.activePanel
                ? `Panel: ${state.activePanel}`
                : 'Ready';
        }

        async function generatePlan() {
            if (state.busy) return;
            const prompt = sanitizeText(elements.belChatInput?.value, 800);
            if (!prompt) {
                showToast('Enter a request for BEL first.', 'info');
                return;
            }
            if (typeof fetchGemmaJSON !== 'function') {
                showToast('BEL assistant is unavailable because Gemma helper is missing.', 'error');
                return;
            }

            appendMessage(elements.belChatThread, 'user', prompt);
            setBusy(true);
            try {
                const panelGroup = getPanelGroup(state.activePanel);
                const docs = await fetchDocs(panelGroup);
                const visibleFields = getVisibleFieldSnapshot();
                const allowedTargets = Object.keys(ALLOWED_TARGETS).join(', ');
                const assistantPrompt = `You are BEL assistant for CRM manual form-filling.
Return only JSON with this exact structure:
{"reply":"short explanation","actions":[{"op":"set|select","target":"field-id","value":"value"}]}

Rules:
- Use only the allowed field IDs.
- Only non-destructive field fill actions are allowed.
- Do not include click, submit, save, delete, or navigation actions.
- Keep values concise and realistic.
- If something is missing, return empty actions and explain in reply.

Allowed field IDs:
${allowedTargets}

Current panel: ${state.activePanel || 'unknown'}
Visible field snapshot:
${visibleFields || '(empty)'}

Workflow docs:
${docs || '(none)'}

User request:
${prompt}`;

                const result = await fetchGemmaJSON(assistantPrompt, {
                    ollamaOptions: { temperature: 0.1, num_predict: 400 }
                });
                const reply = sanitizeText(result?.reply || 'Preview ready.', 300);
                const actions = parseActions(result);
                state.pendingActions = actions;
                renderPreview(elements.belChatPreview, actions);
                if (elements.belChatApply) {
                    elements.belChatApply.disabled = actions.length === 0;
                }
                appendMessage(elements.belChatThread, 'assistant', `${reply}${actions.length ? ` (${actions.length} action(s) ready)` : ''}`);
            } catch (error) {
                showToast(error?.message || 'BEL could not generate a fill plan.', 'error');
                appendMessage(elements.belChatThread, 'assistant', `Failed to generate plan: ${error?.message || 'unknown error'}`);
            } finally {
                setBusy(false);
            }
        }

        function applyPendingActions() {
            if (!Array.isArray(state.pendingActions) || !state.pendingActions.length) {
                showToast('No preview actions to apply.', 'info');
                return;
            }
            const results = state.pendingActions.map((action) => applyAction(action));
            const applied = results.filter(Boolean).length;
            const skipped = results.length - applied;
            state.pendingActions = [];
            renderPreview(elements.belChatPreview, state.pendingActions);
            if (elements.belChatApply) elements.belChatApply.disabled = true;
            if (applied > 0) {
                showToast(`BEL applied ${applied} field update(s).`, 'success');
            }
            if (skipped > 0) {
                showToast(`${skipped} action(s) were skipped because fields were unavailable.`, 'info');
            }
        }

        function openDrawer() {
            if (!elements.belChatDrawer) return;
            elements.belChatDrawer.style.display = 'block';
            if (elements.belChatInput) elements.belChatInput.focus();
        }

        function closeDrawer() {
            if (!elements.belChatDrawer) return;
            elements.belChatDrawer.style.display = 'none';
        }

        function onRouteChange(nextPanel) {
            state.activePanel = String(nextPanel || '').trim();
            setContextLabel();
        }

        function init() {
            if (!elements.belChatLauncher || !elements.belChatDrawer) return;
            onRouteChange(typeof getActivePanel === 'function' ? getActivePanel() : '');

            if (!elements.belChatLauncher.__belBound) {
                elements.belChatLauncher.addEventListener('click', openDrawer);
                elements.belChatLauncher.__belBound = true;
            }
            if (elements.belChatClose && !elements.belChatClose.__belBound) {
                elements.belChatClose.addEventListener('click', closeDrawer);
                elements.belChatClose.__belBound = true;
            }
            if (elements.belChatSend && !elements.belChatSend.__belBound) {
                elements.belChatSend.addEventListener('click', () => {
                    generatePlan();
                });
                elements.belChatSend.__belBound = true;
            }
            if (elements.belChatApply && !elements.belChatApply.__belBound) {
                elements.belChatApply.addEventListener('click', applyPendingActions);
                elements.belChatApply.__belBound = true;
            }
        }

        return {
            init,
            onRouteChange
        };
    }

    return {
        createController
    };
})();
