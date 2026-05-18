window.CrmAgentSourcesWorkspace = (function () {
    'use strict';

    function fallbackEscapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = String(value ?? '');
        return div.innerHTML;
    }

    function clean(value) {
        return String(value || '').trim();
    }

    function normalizeList(source) {
        return (Array.isArray(source) ? source : [])
            .map((item) => ({
                agentSourceId: clean(item?.agentSourceId || item?.id),
                name: clean(item?.name),
                status: clean(item?.status || 'active').toLowerCase() || 'active',
                notes: clean(item?.notes),
                createdAt: item?.createdAt || null,
                updatedAt: item?.updatedAt || null
            }))
            .filter((item) => item.agentSourceId || item.name)
            .sort((left, right) => left.name.localeCompare(right.name));
    }

    function createController(deps = {}) {
        const elements = deps.elements || {};
        const dataCache = deps.dataCache || {};
        const showToast = typeof deps.showToast === 'function' ? deps.showToast : null;
        const apiFetchJson = typeof deps.apiFetchJson === 'function' ? deps.apiFetchJson : null;
        const escapeHtml = typeof deps.escapeHtml === 'function' ? deps.escapeHtml : fallbackEscapeHtml;
        const formatDateTime = typeof deps.formatDateTime === 'function' ? deps.formatDateTime : (value) => clean(value) || '-';

        let bound = false;
        let selectedAgentSourceId = '';

        function getAgentSources() {
            dataCache.agentSources = normalizeList(dataCache.agentSources);
            return dataCache.agentSources;
        }

        function renderAgentOption(row) {
            const label = row.status === 'inactive' ? `${row.name} (inactive)` : row.name;
            return `<option value="${escapeHtml(row.agentSourceId)}">${escapeHtml(label)}</option>`;
        }

        function hydrateSelect(select, currentValue) {
            if (!select) return;
            const selectedValue = clean(currentValue || select.value);
            const list = getAgentSources();
            select.innerHTML = '<option value="">No agent source</option>' + list.map(renderAgentOption).join('');
            if (selectedValue && list.some((row) => row.agentSourceId === selectedValue)) {
                select.value = selectedValue;
            } else {
                select.value = '';
            }
        }

        function hydrateLinkedSelects() {
            hydrateSelect(elements.inputLeadAgentSource);
            hydrateSelect(elements.inputStudentAgentSource);
        }

        function setBusy(isBusy) {
            if (!elements.btnCreateAgentSource) return;
            elements.btnCreateAgentSource.disabled = !!isBusy;
            elements.btnCreateAgentSource.textContent = isBusy
                ? 'Saving...'
                : (selectedAgentSourceId ? 'Update Agent Source' : 'Save Agent Source');
        }

        function resetForm() {
            selectedAgentSourceId = '';
            if (elements.inputAgentSourceName) elements.inputAgentSourceName.value = '';
            if (elements.inputAgentSourceStatus) elements.inputAgentSourceStatus.value = 'active';
            if (elements.inputAgentSourceNotes) elements.inputAgentSourceNotes.value = '';
            setBusy(false);
            renderList();
        }

        function applyToForm(agentSource) {
            if (!agentSource) {
                resetForm();
                return;
            }
            selectedAgentSourceId = clean(agentSource.agentSourceId);
            if (elements.inputAgentSourceName) elements.inputAgentSourceName.value = clean(agentSource.name);
            if (elements.inputAgentSourceStatus) elements.inputAgentSourceStatus.value = clean(agentSource.status || 'active') || 'active';
            if (elements.inputAgentSourceNotes) elements.inputAgentSourceNotes.value = clean(agentSource.notes);
            setBusy(false);
            renderList();
        }

        function renderList() {
            if (!elements.agentSourcesList) return;
            const list = getAgentSources();
            if (!list.length) {
                elements.agentSourcesList.innerHTML = '<div class="crm-muted">No agent sources yet.</div>';
                return;
            }

            elements.agentSourcesList.innerHTML = list.map((row) => {
                const selected = clean(row.agentSourceId) === clean(selectedAgentSourceId);
                const statusClass = row.status === 'active' ? 'medium' : 'low';
                const timestamp = row.updatedAt || row.createdAt || null;
                return `
                    <div class="crm-task-item${selected ? ' active' : ''}" data-agent-source-id="${escapeHtml(row.agentSourceId)}">
                        <div class="crm-task-head">
                            <button type="button" class="crm-student-link crm-agent-source-select" data-agent-source-id="${escapeHtml(row.agentSourceId)}">${escapeHtml(row.name || 'Unnamed agent source')}</button>
                            <span class="crm-task-priority ${escapeHtml(statusClass)}">${escapeHtml(row.status || 'active')}</span>
                        </div>
                        ${row.notes ? `<div class="crm-task-meta">${escapeHtml(row.notes)}</div>` : ''}
                        <div class="crm-task-meta">${escapeHtml(timestamp ? formatDateTime(timestamp) : 'Ready for lead and student selection')}</div>
                    </div>
                `;
            }).join('');
        }

        function buildPayload() {
            return {
                name: clean(elements.inputAgentSourceName?.value),
                status: clean(elements.inputAgentSourceStatus?.value || 'active') || 'active',
                notes: clean(elements.inputAgentSourceNotes?.value) || null
            };
        }

        async function refresh() {
            if (!apiFetchJson) return [];
            const json = await apiFetchJson('/api/admin/agent-sources?limit=500', { method: 'GET' });
            dataCache.agentSources = normalizeList(json?.agentSources);
            hydrateLinkedSelects();
            renderList();
            return dataCache.agentSources;
        }

        async function save() {
            if (!apiFetchJson) return;

            const payload = buildPayload();
            if (!payload.name) {
                elements.inputAgentSourceName?.focus?.();
                throw new Error('Agent source name is required.');
            }

            const selectedId = clean(selectedAgentSourceId);
            const path = selectedId
                ? `/api/admin/agent-sources/${encodeURIComponent(selectedId)}`
                : '/api/admin/agent-sources';
            const method = selectedId ? 'PATCH' : 'POST';

            setBusy(true);
            try {
                const json = await apiFetchJson(path, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const nextSelectedId = selectedId || clean(json?.agentSourceId || json?.agentSource?.agentSourceId);
                await refresh();
                const createdOrUpdated = getAgentSources().find((row) => row.agentSourceId === nextSelectedId) || null;
                if (createdOrUpdated) {
                    hydrateSelect(elements.inputLeadAgentSource, createdOrUpdated.agentSourceId);
                    hydrateSelect(elements.inputStudentAgentSource, createdOrUpdated.agentSourceId);
                }
                showToast?.(selectedId ? 'Agent source updated.' : 'Agent source created.', 'success');
                resetForm();
            } catch (error) {
                showToast?.(error?.message || 'Failed to save agent source.', 'error');
                throw error;
            } finally {
                setBusy(false);
            }
        }

        async function fetchWithAuth(path) {
            const user = window.firebase?.auth?.().currentUser;
            if (!user) throw new Error('Please log in as admin first.');
            const idToken = await user.getIdToken();
            const res = await fetch(path, {
                method: 'GET',
                headers: { Authorization: `Bearer ${idToken}` },
                cache: 'no-store'
            });
            if (!res.ok) {
                const json = await res.json().catch(() => null);
                throw new Error(json?.message || `Request failed (${res.status})`);
            }
            return res;
        }

        function getReportFilename(res, month) {
            const header = res.headers.get('Content-Disposition') || '';
            const match = header.match(/filename="?([^"]+)"?/i);
            if (match && match[1]) return match[1];
            return `agent-report-${month || 'current'}.xlsx`;
        }

        async function exportReport() {
            const month = clean(elements.inputAgentReportMonth?.value);
            const params = new URLSearchParams({ format: 'xlsx' });
            if (month) params.set('month', month);
            const res = await fetchWithAuth(`/api/admin/agent-sources/report?${params.toString()}`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = getReportFilename(res, month);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            showToast?.('Agent source report exported.', 'success');
        }

        function bindEvents() {
            if (bound) return;
            bound = true;

            if (elements.btnNewAgentSource) {
                elements.btnNewAgentSource.addEventListener('click', () => {
                    resetForm();
                });
            }

            if (elements.btnRefreshAgentSources) {
                elements.btnRefreshAgentSources.addEventListener('click', () => {
                    refresh()
                        .then(() => showToast?.('Agent sources refreshed.', 'success'))
                        .catch((error) => {
                            console.error('[CRM Admin] Refresh agent sources failed:', error);
                            showToast?.(error?.message || 'Failed to refresh agent sources.', 'error');
                        });
                });
            }

            if (elements.btnCreateAgentSource) {
                elements.btnCreateAgentSource.addEventListener('click', () => {
                    save().catch((error) => {
                        console.error('[CRM Admin] Save agent source failed:', error);
                    });
                });
            }

            if (elements.agentSourcesList) {
                elements.agentSourcesList.addEventListener('click', (event) => {
                    const button = event.target && typeof event.target.closest === 'function'
                        ? event.target.closest('.crm-agent-source-select[data-agent-source-id]')
                        : null;
                    if (!button || !elements.agentSourcesList.contains(button)) return;
                    const id = clean(button.dataset.agentSourceId);
                    const row = getAgentSources().find((item) => item.agentSourceId === id) || null;
                    applyToForm(row);
                });
            }

            if (elements.btnExportAgentReport) {
                elements.btnExportAgentReport.addEventListener('click', () => {
                    exportReport().catch((error) => {
                        console.error('[CRM Admin] Export agent source report failed:', error);
                        showToast?.(error?.message || 'Failed to export agent source report.', 'error');
                    });
                });
            }
        }

        function init() {
            bindEvents();
            hydrateLinkedSelects();
            renderList();
        }

        return {
            init,
            refresh,
            hydrateLinkedSelects,
            renderList
        };
    }

    return {
        createController
    };
})();
