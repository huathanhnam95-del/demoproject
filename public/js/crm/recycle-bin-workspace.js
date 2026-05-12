window.CrmRecycleBinWorkspace = (function () {
    function createController(deps = {}) {
        const {
            elements,
            apiFetchJson,
            showToast,
            escapeHtml,
            formatDateTime,
            refreshLeadPipeline,
            refreshStudentLists,
            refreshCourseCatalog,
            refreshClassroomList,
            refreshDashboard,
            showBulkActionConfirm
        } = deps;

        const state = {
            activeFilter: 'all',
            page: 1,
            limit: 25,
            total: 0,
            hasMore: false,
            loading: false,
            items: []
        };
        const itemIndex = new Map();
        const selectedRecycleIds = new Set();

        const FILTERS = [
            { id: 'all', label: 'All', entityTypes: [] },
            { id: 'lead', label: 'Enquiries', entityTypes: ['lead'] },
            { id: 'student', label: 'Students', entityTypes: ['student'] },
            { id: 'course', label: 'Courses', entityTypes: ['course'] },
            { id: 'classroom', label: 'Classrooms', entityTypes: ['classroom'] }
        ];

        function humanizeEntityType(entityType) {
            const value = String(entityType || '').trim().toLowerCase();
            if (value === 'lead') return 'Enquiry';
            if (value === 'student') return 'Student';
            if (value === 'course') return 'Course';
            if (value === 'classroom') return 'Classroom';
            return 'Record';
        }

        function humanizeSourcePanel(sourcePanel) {
            const value = String(sourcePanel || '').trim();
            if (!value) return 'CRM';
            const map = {
                enquiry: 'Enquiry',
                leads: 'Enquiry',
                'students/potential': 'Potential Students',
                'students/data': 'Student Data',
                students: 'Students',
                'courses/courses': 'Courses Catalog',
                'courses/classes': 'Class Scheduling (legacy)',
                'courses/class-management': 'Class Management',
                courses: 'Courses',
                classrooms: 'Classrooms'
            };
            return map[value.toLowerCase()] || value;
        }

        function formatImpactSummary(impactSummary) {
            const list = Array.isArray(impactSummary) ? impactSummary : [];
            if (!list.length) return 'No dependency summary available.';
            return list.map((item) => {
                const label = String(item?.label || 'Item').trim() || 'Item';
                const count = Number(item?.count || 0);
                return `${label}${Number.isFinite(count) && count > 0 ? ` (${count})` : ''}`;
            }).join(', ');
        }

        function getKnownItem(recycleId) {
            const id = String(recycleId || '').trim();
            if (!id) return null;
            return itemIndex.get(id) || state.items.find((item) => String(item.recycleId || '').trim() === id) || null;
        }

        function selectedItems() {
            return Array.from(selectedRecycleIds)
                .map((id) => getKnownItem(id))
                .filter(Boolean);
        }

        function clearSelection() {
            selectedRecycleIds.clear();
        }

        function updateSelection(recycleId, selected) {
            const id = String(recycleId || '').trim();
            if (!id) return;
            if (selected) selectedRecycleIds.add(id);
            else selectedRecycleIds.delete(id);
        }

        function activeEntityTypes() {
            const current = FILTERS.find((item) => item.id === state.activeFilter) || FILTERS[0];
            return current.entityTypes;
        }

        function selectedCount() {
            return selectedRecycleIds.size;
        }

        function renderFilterChips() {
            return FILTERS.map((filter) => {
                const active = filter.id === state.activeFilter;
                return `
                    <button type="button" class="crm-recycle-bin-chip ${active ? 'active' : ''}" data-action="filter" data-filter="${escapeHtml(filter.id)}">
                        ${escapeHtml(filter.label)}
                    </button>
                `;
            }).join('');
        }

        function renderImpactSummary(item) {
            const impactText = formatImpactSummary(item?.impactSummary);
            const recordCount = Number(item?.bundleDocCount || 0);
            const parts = [];
            if (recordCount > 0) parts.push(`${recordCount} record${recordCount === 1 ? '' : 's'}`);
            if (impactText) parts.push(impactText);
            return parts.join(' · ');
        }

        function renderRowActions(item) {
            return `
                <div class="crm-recycle-bin-actions">
                    <button type="button" class="crm-btn-primary" data-action="restore-entry" data-recycle-id="${escapeHtml(item.recycleId)}">Restore</button>
                    <button type="button" class="crm-btn-secondary" data-action="purge-entry" data-recycle-id="${escapeHtml(item.recycleId)}">Purge</button>
                </div>
            `;
        }

        function renderEmptyState(message) {
            const container = elements.recycleBinWorkspace;
            if (!container) return;
            container.classList.add('crm-placeholder-card');
            container.classList.remove('crm-table-host');
            container.innerHTML = `<div class="crm-muted">${escapeHtml(message || 'No recycle bin entries yet.')}</div>`;
        }

        function renderTable() {
            const container = elements.recycleBinWorkspace;
            if (!container) return;

            const list = Array.isArray(state.items) ? state.items : [];
            const selected = selectedCount();
            const filterLabel = FILTERS.find((item) => item.id === state.activeFilter)?.label || 'All';

            if (!list.length) {
                renderEmptyState(state.loading ? 'Loading recycle bin entries...' : 'No recycle bin entries yet.');
                return;
            }

            container.classList.remove('crm-placeholder-card');
            container.classList.add('crm-table-host');

            const allChecked = list.length > 0 && list.every((item) => selectedRecycleIds.has(String(item.recycleId || '').trim()));
            const rows = list.map((item) => {
                const recycleId = String(item.recycleId || '').trim();
                const checked = selectedRecycleIds.has(recycleId);
                const impactText = renderImpactSummary(item);
                const itemType = humanizeEntityType(item.rootEntityType);
                const sourceLabel = humanizeSourcePanel(item.sourcePanel || '');
                const deletedAt = formatDateTime(item.deletedAt);
                const expiresAt = formatDateTime(item.expiresAt);
                const expiredBadge = item.isExpired
                    ? '<span class="crm-risk-badge risk">Expired</span>'
                    : '<span class="crm-activity-chip">Active</span>';
                return `
                    <tr>
                        <td style="width:56px; text-align:center; padding-left:14px; padding-right:14px;">
                            <input type="checkbox" data-recycle-select="${escapeHtml(recycleId)}" ${checked ? 'checked' : ''}>
                        </td>
                        <td class="td-bold">
                            <div class="crm-recycle-bin-item">
                                <strong>${escapeHtml(item.displayTitle || recycleId)}</strong>
                                <div class="crm-muted">${escapeHtml(item.displaySubtitle || itemType)}</div>
                                <div class="crm-recycle-bin-badges">
                                    <span class="crm-activity-chip">${escapeHtml(itemType)}</span>
                                    ${expiredBadge}
                                </div>
                            </div>
                        </td>
                        <td>${escapeHtml(sourceLabel)}</td>
                        <td>${escapeHtml(deletedAt)}</td>
                        <td>${escapeHtml(expiresAt)}</td>
                        <td>${escapeHtml(impactText || 'No summary')}</td>
                        <td>${renderRowActions(item)}</td>
                    </tr>
                `;
            }).join('');

            container.innerHTML = `
                <div class="crm-recycle-bin-shell">
                    <div class="crm-recycle-bin-toolbar">
                        <div class="crm-recycle-bin-filters" role="tablist" aria-label="Recycle bin filters">
                            ${renderFilterChips()}
                        </div>
                        <div class="crm-inline-fields">
                            <button type="button" class="crm-btn-secondary" data-action="bulk-restore" ${selected ? '' : 'disabled'}>Restore Selected</button>
                            <button type="button" class="crm-btn-secondary" data-action="bulk-purge" ${selected ? '' : 'disabled'}>Purge Selected</button>
                        </div>
                    </div>
                    <div class="crm-recycle-bin-summary">
                        Showing ${escapeHtml(String(list.length))} of ${escapeHtml(String(state.total))} archived record${state.total === 1 ? '' : 's'} in ${escapeHtml(filterLabel)}.
                        Archived records are kept for 30 days before auto purge.
                    </div>
                    <div class="crm-table-container">
                        <table class="crm-table crm-recycle-bin-table">
                            <thead>
                                <tr>
                                    <th style="width:56px; text-align:center; padding-left:14px; padding-right:14px;">
                                        <input type="checkbox" data-recycle-select-all ${allChecked ? 'checked' : ''}>
                                    </th>
                                    <th>Item</th>
                                    <th>Source</th>
                                    <th>Deleted</th>
                                    <th>Expires</th>
                                    <th>Impact</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                    <div class="crm-recycle-bin-pagination">
                        <div class="crm-muted">Selected: ${selected} · Page ${state.page}${state.hasMore ? ' · More results available' : ''}</div>
                        <div class="crm-inline-fields">
                            <button type="button" class="crm-btn-secondary" data-page-action="prev-page" ${state.page <= 1 ? 'disabled' : ''}>Previous</button>
                            <button type="button" class="crm-btn-secondary" data-page-action="next-page" ${state.hasMore ? '' : 'disabled'}>Next</button>
                        </div>
                    </div>
                </div>
            `;
        }

        function bindContainer() {
            const container = elements.recycleBinWorkspace;
            if (!container || container.__crmRecycleBinBound) return;

            container.addEventListener('change', (event) => {
                const checkbox = event.target && typeof event.target.closest === 'function'
                    ? event.target.closest('input[type="checkbox"][data-recycle-select]')
                    : null;
                if (!checkbox || !container.contains(checkbox)) return;
                updateSelection(checkbox.dataset.recycleSelect, checkbox.checked);
                renderTable();
            });

            container.addEventListener('click', (event) => {
                const filterButton = event.target && typeof event.target.closest === 'function'
                    ? event.target.closest('button[data-action="filter"]')
                    : null;
                if (filterButton && container.contains(filterButton)) {
                    const filterId = String(filterButton.dataset.filter || 'all').trim() || 'all';
                    if (state.activeFilter !== filterId) {
                        clearSelection();
                        state.activeFilter = filterId;
                        state.page = 1;
                        refreshRecycleBin().catch((error) => {
                            console.error('[CRM Admin] Recycle bin filter refresh failed:', error);
                            showToast(error?.message || 'Failed to refresh recycle bin.', 'error');
                        });
                    }
                    return;
                }

                const selectAll = event.target && typeof event.target.closest === 'function'
                    ? event.target.closest('input[type="checkbox"][data-recycle-select-all]')
                    : null;
                if (selectAll && container.contains(selectAll)) {
                    const items = Array.isArray(state.items) ? state.items : [];
                    if (selectAll.checked) {
                        items.forEach((item) => {
                            const id = String(item.recycleId || '').trim();
                            if (id) selectedRecycleIds.add(id);
                        });
                    } else {
                        clearSelection();
                    }
                    renderTable();
                    return;
                }

                const actionButton = event.target && typeof event.target.closest === 'function'
                    ? event.target.closest('button[data-action]')
                    : null;
                if (!actionButton || !container.contains(actionButton)) return;

                const action = String(actionButton.dataset.action || '').trim();
                const recycleId = String(actionButton.dataset.recycleId || '').trim();

                if (action === 'bulk-restore') {
                    restoreEntries(Array.from(selectedRecycleIds)).catch((error) => {
                        console.error('[CRM Admin] Bulk restore recycle bin failed:', error);
                        showToast(error?.message || 'Failed to restore recycle bin entries.', 'error');
                    });
                    return;
                }

                if (action === 'bulk-purge') {
                    purgeEntries(Array.from(selectedRecycleIds)).catch((error) => {
                        console.error('[CRM Admin] Bulk purge recycle bin failed:', error);
                        showToast(error?.message || 'Failed to purge recycle bin entries.', 'error');
                    });
                    return;
                }

                if (action === 'restore-entry' && recycleId) {
                    restoreEntries([recycleId]).catch((error) => {
                        console.error('[CRM Admin] Restore recycle bin entry failed:', error);
                        showToast(error?.message || 'Failed to restore recycle bin entry.', 'error');
                    });
                    return;
                }

                if (action === 'purge-entry' && recycleId) {
                    purgeEntries([recycleId]).catch((error) => {
                        console.error('[CRM Admin] Purge recycle bin entry failed:', error);
                        showToast(error?.message || 'Failed to purge recycle bin entry.', 'error');
                    });
                }
            });

            container.addEventListener('click', (event) => {
                const pageButton = event.target && typeof event.target.closest === 'function'
                    ? event.target.closest('button[data-page-action]')
                    : null;
                if (!pageButton || !container.contains(pageButton)) return;
                const action = String(pageButton.dataset.pageAction || '').trim();
                if (action === 'prev-page' && state.page > 1) {
                    state.page -= 1;
                    refreshRecycleBin().catch((error) => {
                        console.error('[CRM Admin] Recycle bin previous page failed:', error);
                        showToast(error?.message || 'Failed to load previous recycle bin page.', 'error');
                    });
                } else if (action === 'next-page' && state.hasMore) {
                    state.page += 1;
                    refreshRecycleBin().catch((error) => {
                        console.error('[CRM Admin] Recycle bin next page failed:', error);
                        showToast(error?.message || 'Failed to load next recycle bin page.', 'error');
                    });
                }
            });

            container.__crmRecycleBinBound = true;
        }

        function buildSelectedDetailItems(items) {
            return (Array.isArray(items) ? items : []).map((item) => {
                const type = humanizeEntityType(item?.rootEntityType);
                const source = humanizeSourcePanel(item?.sourcePanel || item?.displaySubtitle || '');
                return {
                    title: item?.displayTitle || item?.recycleId || 'Archived record',
                    subtitle: [type, source].filter(Boolean).join(' · '),
                    detailText: `Deleted ${formatDateTime(item?.deletedAt)} · Expires ${formatDateTime(item?.expiresAt)}`,
                    details: Array.isArray(item?.impactSummary) ? item.impactSummary : []
                };
            });
        }

        async function refreshRelatedPanels() {
            const tasks = [
                typeof refreshLeadPipeline === 'function' ? refreshLeadPipeline() : Promise.resolve(),
                typeof refreshStudentLists === 'function' ? refreshStudentLists() : Promise.resolve(),
                typeof refreshCourseCatalog === 'function' ? refreshCourseCatalog() : Promise.resolve(),
                typeof refreshClassroomList === 'function' ? refreshClassroomList() : Promise.resolve(),
                typeof refreshDashboard === 'function' ? refreshDashboard() : Promise.resolve()
            ];
            await Promise.allSettled(tasks);
        }

        async function restoreEntries(recycleIds) {
            const ids = Array.isArray(recycleIds) ? recycleIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
            if (!ids.length) return;

            const result = await apiFetchJson('/api/admin/recycle-bin/restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids })
            });

            const restoredSet = new Set(Array.isArray(result.restoredIds) ? result.restoredIds.map((id) => String(id || '').trim()).filter(Boolean) : []);
            Array.from(selectedRecycleIds).forEach((id) => {
                if (restoredSet.has(id)) {
                    selectedRecycleIds.delete(id);
                }
            });
            await refreshRecycleBin();
            await refreshRelatedPanels();

            const restoredCount = Array.isArray(result.restoredIds) ? result.restoredIds.length : 0;
            const failed = Array.isArray(result.failed) ? result.failed : [];
            const failedCount = failed.length;
            const notFoundCount = Array.isArray(result.notFoundIds) ? result.notFoundIds.length : 0;
            const firstFailureReason = String(failed[0]?.reason || '').trim();
            if (restoredCount > 0) {
                const suffix = failedCount || notFoundCount
                    ? ` ${failedCount + notFoundCount} item${failedCount + notFoundCount === 1 ? '' : 's'} could not be restored.${firstFailureReason ? ` ${firstFailureReason}` : ''}`
                    : '';
                showToast(`Restored ${restoredCount} recycle bin item${restoredCount === 1 ? '' : 's'}.${suffix}`, 'success');
            } else {
                showToast(firstFailureReason || 'No recycle bin items were restored.', 'error');
            }
        }

        async function confirmPurge(items) {
            const dialog = typeof showBulkActionConfirm === 'function'
                ? showBulkActionConfirm
                : (window.CrmAdminDialogs && typeof window.CrmAdminDialogs.showBulkDeleteWarning === 'function'
                    ? window.CrmAdminDialogs.showBulkDeleteWarning
                    : null);
            if (!dialog) {
                showToast('Recycle bin confirm dialog is unavailable.', 'error');
                return false;
            }

            const list = Array.isArray(items) ? items : [];
            return dialog({
                title: `Purge ${list.length} archived item${list.length === 1 ? '' : 's'}?`,
                badgeText: 'Danger',
                note: 'This permanently removes the archived copy. It cannot be restored after purge.',
                summaryCards: [
                    { label: 'Selected', value: String(list.length) },
                    { label: 'Will purge', value: String(list.length) },
                    { label: 'Permanent', value: 'Yes' }
                ],
                detailTitle: 'Items to purge',
                detailNote: 'These archived records will be removed permanently.',
                detailItems: buildSelectedDetailItems(list),
                proceedLabel: 'Purge Now',
                confirmLabel: 'Purge Now',
                requiresText: 'purge'
            });
        }

        async function purgeEntries(recycleIds) {
            const ids = Array.isArray(recycleIds) ? recycleIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
            if (!ids.length) return;

            const items = ids.map((id) => getKnownItem(id)).filter(Boolean);
            const proceed = await confirmPurge(items.length ? items : ids.map((id) => ({
                recycleId: id,
                displayTitle: id,
                rootEntityType: 'record',
                sourcePanel: 'CRM'
            })));
            if (!proceed) return;

            const result = await apiFetchJson('/api/admin/recycle-bin/purge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids })
            });

            const purgedSet = new Set(Array.isArray(result.purgedIds) ? result.purgedIds.map((id) => String(id || '').trim()).filter(Boolean) : []);
            Array.from(selectedRecycleIds).forEach((id) => {
                if (purgedSet.has(id)) {
                    selectedRecycleIds.delete(id);
                }
            });
            await refreshRecycleBin();

            const purgedCount = Array.isArray(result.purgedIds) ? result.purgedIds.length : 0;
            const notFoundCount = Array.isArray(result.notFoundIds) ? result.notFoundIds.length : 0;
            if (purgedCount > 0) {
                const suffix = notFoundCount ? ` ${notFoundCount} item${notFoundCount === 1 ? '' : 's'} were not found.` : '';
                showToast(`Purged ${purgedCount} recycle bin item${purgedCount === 1 ? '' : 's'}.${suffix}`, 'success');
            } else {
                showToast('No recycle bin items were purged.', 'error');
            }
        }

        async function loadRecycleBin() {
            if (!elements.recycleBinWorkspace) return;
            bindContainer();

            if (elements.btnRefreshRecycleBin) {
                elements.btnRefreshRecycleBin.disabled = true;
            }
            state.loading = true;
            let encounteredError = false;
            renderTable();

            try {
                const params = new URLSearchParams();
                params.set('page', String(state.page || 1));
                params.set('limit', String(state.limit || 25));
                const entityTypes = activeEntityTypes();
                if (entityTypes.length) {
                    entityTypes.forEach((entityType) => params.append('entityTypes', entityType));
                }

                const json = await apiFetchJson(`/api/admin/recycle-bin?${params.toString()}`, {
                    method: 'GET'
                });
                const items = Array.isArray(json.items) ? json.items : [];
                state.items = items;
                state.total = Number(json.total || 0);
                state.hasMore = !!json.hasMore;
                state.page = Number(json.page || state.page || 1);
                state.limit = Number(json.limit || state.limit || 25);
                items.forEach((item) => {
                    const id = String(item.recycleId || '').trim();
                    if (id) itemIndex.set(id, item);
                });
                renderTable();
            } catch (error) {
                encounteredError = true;
                console.error('[CRM Admin] Load recycle bin failed:', error);
                state.items = [];
                state.total = 0;
                state.hasMore = false;
                renderEmptyState(error?.message || 'Failed to load recycle bin entries.');
                throw error;
            } finally {
                state.loading = false;
                if (elements.btnRefreshRecycleBin) {
                    elements.btnRefreshRecycleBin.disabled = false;
                }
                if (!encounteredError) {
                    renderTable();
                }
            }
        }

        if (elements.btnRefreshRecycleBin && !elements.btnRefreshRecycleBin.__crmRecycleBinRefreshBound) {
            elements.btnRefreshRecycleBin.addEventListener('click', () => {
                refreshRecycleBin().catch((error) => {
                    console.error('[CRM Admin] Manual recycle bin refresh failed:', error);
                    showToast(error?.message || 'Failed to refresh recycle bin.', 'error');
                });
            });
            elements.btnRefreshRecycleBin.__crmRecycleBinRefreshBound = true;
        }

        function refreshRecycleBin() {
            return loadRecycleBin();
        }

        return {
            refreshRecycleBin
        };
    }

    return {
        createController
    };
})();
