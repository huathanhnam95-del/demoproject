(function (scope) {
    'use strict';

    function escape(str) {
        return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function createController(deps = {}) {
        const drafts = new Map();
        let active = null;
        let disposed = false;
        let isSubmitting = false;

        function draftKey(params = {}) {
            const actor = String(deps.getCurrentUser?.()?.uid || '');
            const projectId = String(deps.getProjectId?.() || '');
            const sectionId = String(params.sectionId || '');
            const parentTaskId = String(params.parentTaskId || '');
            const anchorId = String(params.anchorId || params.placement?.siblingId || '');
            const kind = String(params.kind || 'task');
            const placementKind = String(params.placement?.kind || '');
            return JSON.stringify([actor, projectId, sectionId, parentTaskId, anchorId, kind, placementKind]);
        }

        function getDraft(key) {
            return drafts.get(key) || { text: '', intentId: deps.operationId?.('ctx') || `op-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
        }

        function saveDraft(key, draft) {
            drafts.set(key, draft);
        }

        function clearDraft(key) {
            drafts.delete(key);
        }

        function cancel() {
            if (!active || isSubmitting) return;
            const current = active;
            active = null;
            if (current.node?.parentNode) {
                current.node.remove();
            }
            deps.onUnmount?.(current);
            if (current.trigger && current.trigger.isConnected && !current.trigger.disabled) {
                try { current.trigger.focus(); } catch (_) { /* ignore */ }
            }
        }

        function mount(params = {}) {
            if (disposed) return null;
            cancel();

            let key = draftKey(params);
            let draft = getDraft(key);
            saveDraft(key, draft);

            const kind = params.kind || 'task'; // 'task' | 'subtask' | 'section'
            const isSubtask = kind === 'subtask' || !!params.parentTaskId;
            const isSection = kind === 'section';

            const section = params.sectionId ? deps.getSection?.(params.sectionId) : null;
            const sectionTitle = section?.title || 'Section';
            const parent = params.parentTaskId ? deps.getTask?.(params.parentTaskId) : null;
            const parentTitle = parent?.title || 'Parent task';
            const anchor = params.anchorId ? (isSection ? deps.getSection?.(params.anchorId) : deps.getTask?.(params.anchorId)) : null;
            const anchorTitle = anchor?.title || '';

            let accessibleLabel = 'Add task';
            let placeholder = 'Add task…';
            let submitLabel = 'Add task';

            if (isSection) {
                accessibleLabel = params.placement?.kind === 'before'
                    ? `Add section above ${anchorTitle || sectionTitle}`
                    : `Add section below ${anchorTitle || sectionTitle}`;
                placeholder = 'Section name…';
                submitLabel = 'Add section';
            } else if (isSubtask) {
                accessibleLabel = `New subtask of ${parentTitle}`;
                placeholder = 'Add subtask…';
                submitLabel = 'Add subtask';
            } else {
                accessibleLabel = `Add task to ${sectionTitle}`;
                placeholder = 'Add task…';
                submitLabel = 'Add task';
            }

            const escAccessibleLabel = escape(accessibleLabel);
            const escPlaceholder = escape(placeholder);
            const escSubmitLabel = escape(submitLabel);

            const form = document.createElement('form');
            form.className = 'crm-quick-create crm-contextual-composer';
            form.dataset.quickCreate = '';
            form.dataset.contextualCreate = '';
            form.dataset.composerKind = kind;
            if (params.inDrawer) form.dataset.inDrawer = 'true';

            const sectionOptionsMarkup = !params.parentTaskId && !isSection && !params.sectionId ? `
                <label>
                    <span class="crm-composer-label-text">Section</span>
                    <select name="section" class="crm-input" aria-label="Task section">
                        <option value="">Choose a section…</option>
                        ${(deps.getSections?.() || []).filter(s => !s.isOptimistic).map(s => `<option value="${escape(s.id)}">${escape(s.title)}</option>`).join('')}
                    </select>
                </label>` : '';

            form.innerHTML = `
                <label>
                    <span class="crm-composer-label-text">${escAccessibleLabel}</span>
                    <input name="title" class="crm-input" type="text" maxlength="200"
                           placeholder="${escPlaceholder}" aria-label="${escAccessibleLabel}"
                           aria-describedby="pj-ctx-status" autocomplete="off">
                </label>
                ${sectionOptionsMarkup}
                <div class="crm-inline-fields">
                    <button type="submit" class="crm-btn-primary crm-btn-sm">${escSubmitLabel}</button>
                    <button type="button" class="crm-btn-secondary crm-btn-sm" data-cancel-create aria-label="Cancel ${escape(accessibleLabel.toLowerCase())}">Cancel</button>
                    <span id="pj-ctx-status" role="status" class="crm-composer-status" aria-live="polite"></span>
                </div>
            `;

            const input = form.querySelector('input[name="title"]');
            const sectionSelect = form.querySelector('select[name="section"]');
            const submitBtn = form.querySelector('button[type="submit"]');
            const cancelBtn = form.querySelector('[data-cancel-create]');
            const statusEl = form.querySelector('[role="status"]');

            if (input) input.value = draft.text || '';
            if (sectionSelect && params.sectionId) sectionSelect.value = params.sectionId;

            let isComposing = false;
            input?.addEventListener('compositionstart', () => { isComposing = true; });
            input?.addEventListener('compositionend', () => { isComposing = false; });

            input?.addEventListener('input', () => {
                draft.text = input.value;
                saveDraft(key, draft);
            });

            sectionSelect?.addEventListener('change', () => {
                const prevKey = key;
                params.sectionId = sectionSelect.value;
                const nextKey = draftKey(params);
                if (prevKey !== nextKey) {
                    drafts.delete(prevKey);
                    key = nextKey;
                    if (active) active.key = nextKey;
                }
                draft.text = input?.value || '';
                saveDraft(key, draft);
            });

            form.addEventListener('keydown', (e) => {
                if (isComposing || e.isComposing || e.keyCode === 229) return;
                if (e.key === 'Enter' && e.target === input) {
                    e.preventDefault();
                    form.requestSubmit();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancel();
                }
            });

            cancelBtn?.addEventListener('click', () => {
                cancel();
            });

            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                if (isComposing || isSubmitting || !deps.canWrite?.()) return;

                const text = String(input.value || '').trim();
                if (!text || text.length > 200) {
                    if (statusEl) statusEl.textContent = 'Enter a title (up to 200 characters).';
                    input.focus();
                    return;
                }

                isSubmitting = true;
                submitBtn.disabled = true;
                if (statusEl) statusEl.textContent = 'Adding…';

                try {
                    let result;
                    if (isSection) {
                        result = await deps.createSection?.(text, params.placement);
                    } else {
                        const targetSectionId = params.sectionId || sectionSelect?.value || null;
                        result = await deps.createTask?.(params.parentTaskId || null, targetSectionId, {
                            initialTitle: text,
                            intentId: draft.intentId,
                            placement: params.placement,
                            keepComposerFocus: true
                        });
                    }

                    if (result) {
                        clearDraft(key);
                        draft = { text: '', intentId: deps.operationId?.('ctx') || `op-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
                        saveDraft(key, draft);
                        input.value = '';
                        if (statusEl) statusEl.textContent = 'Saved';
                        submitBtn.disabled = false;
                        // Rapid entry: keep input focused ready for next entry if still active
                        if (active && (!document.activeElement || document.activeElement === document.body || form.contains(document.activeElement))) {
                            input.focus();
                        }
                    } else {
                        submitBtn.disabled = false;
                        if (statusEl) statusEl.textContent = 'Creation failed. Text retained.';
                    }
                } catch (err) {
                    submitBtn.disabled = false;
                    if (statusEl) statusEl.textContent = err.message || 'Error creating item.';
                } finally {
                    isSubmitting = false;
                }
            });

            const activeInstance = {
                key,
                params,
                kind,
                node: form,
                input,
                trigger: params.trigger || document.activeElement,
                anchorId: params.anchorId,
                anchorRowId: params.anchorRowId,
                inDrawer: !!params.inDrawer
            };
            active = activeInstance;

            deps.onMount?.(active);
            setTimeout(() => {
                if (!disposed && active === activeInstance && form.isConnected) {
                    input?.focus();
                }
            }, 0);

            return active;
        }

        function settleId(temporaryId, canonicalId, sectionId) {
            for (const [key, draft] of Array.from(drafts.entries())) {
                try {
                    const parsed = JSON.parse(key);
                    const [actor, proj, sec, parent, anchor, kind, placementKind] = parsed;
                    let changed = false;
                    let nextParent = parent;
                    let nextAnchor = anchor;
                    let nextSec = sec;
                    if (sec === temporaryId) {
                        nextSec = canonicalId;
                        changed = true;
                    }
                    if (parent === temporaryId) {
                        nextParent = canonicalId;
                        if (sectionId) nextSec = sectionId;
                        changed = true;
                    }
                    if (anchor === temporaryId) {
                        nextAnchor = canonicalId;
                        changed = true;
                    }
                    if (changed) {
                        const nextKey = JSON.stringify([actor, proj, nextSec, nextParent, nextAnchor, kind, placementKind || '']);
                        drafts.delete(key);
                        drafts.set(nextKey, draft);
                        if (active?.key === key) {
                            active.key = nextKey;
                            if (active.params.sectionId === temporaryId) active.params.sectionId = canonicalId;
                            if (active.params.parentTaskId === temporaryId) active.params.parentTaskId = canonicalId;
                            if (active.params.anchorId === temporaryId) active.params.anchorId = canonicalId;
                            if (active.params.placement?.siblingId === temporaryId) active.params.placement.siblingId = canonicalId;
                            const sel = active.node?.querySelector('select[name="section"]');
                            if (sel && sel.value === temporaryId) sel.value = canonicalId;
                        }
                    }
                } catch (_) { /* ignore unparseable keys */ }
            }
        }

        return {
            mount,
            cancel,
            getActive: () => active,
            getDraft,
            clearDraft,
            settleId,
            dispose() {
                disposed = true;
                cancel();
                drafts.clear();
            }
        };
    }

    scope.CrmProjectsContextualCreate = { createController };
})(typeof window !== 'undefined' ? window : globalThis);
