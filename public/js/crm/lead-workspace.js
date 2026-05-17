window.CrmLeadWorkspace = (function () {
    function createController(deps = {}) {
        const {
            elements,
            dataCache,
            modalState,
            showToast,
            apiFetchJson,
            refreshDashboard,
            refreshStudentLists,
            openStudentProfile,
            fetchTasks,
            fetchActivities,
            applyReminderBadge,
            getReminderSummary,
            renderTaskList,
            renderActivityList,
            renderReminderBadgeMarkup,
            escapeHtml,
            formatDateTime
        } = deps;
        const selectedLeadIds = new Set();

        function formatList(values) {
            const list = Array.isArray(values) ? values : [];
            if (!list.length) return '-';
            return list
                .map((value) => String(value || '').trim())
                .filter(Boolean)
                .join(', ') || '-';
        }

        function leadPrimaryContact(lead) {
            const email = String(lead?.email || '').trim();
            const phone = String(lead?.phone || '').trim();
            const zalo = String(lead?.zalo || '').trim();
            if (email && phone) return `${email} / ${phone}`;
            if (email) return email;
            if (phone) return phone;
            if (zalo) return `Zalo: ${zalo}`;
            return '-';
        }

        function leadSourceSummary(lead) {
            const source = String(lead?.source || '').trim();
            const facebook = String(lead?.facebookDisplayName || lead?.facebook || '').trim();
            const profile = String(lead?.facebookProfileUrl || '').trim();
            if (!source && !facebook && !profile) return '-';
            const pieces = [source, facebook, profile].filter(Boolean);
            return pieces.join(' / ');
        }

        function resetLeadComposer() {
            const inputs = [
                elements.inputLeadName,
                elements.inputLeadEmail,
                elements.inputLeadPhone,
                elements.inputLeadFacebookDisplayName,
                elements.inputLeadFacebookProfileUrl,
                elements.inputLeadRealName,
                elements.inputLeadDateOfBirth,
                elements.inputLeadSource,
                elements.inputLeadAgentSource,
                elements.inputLeadProbability,
                elements.inputLeadLearningNeeds,
                elements.inputLeadPreferredLearningDays,
                elements.inputLeadPreferredLearningHours,
                elements.inputLeadMessengerThreadUrl,
                elements.inputLeadMessengerLastContactAt
            ];
            inputs.forEach((input) => {
                if (input) input.value = '';
            });
            if (elements.inputLeadStage) {
                elements.inputLeadStage.value = 'new';
            }
            if (elements.inputLeadMessengerStatus) {
                elements.inputLeadMessengerStatus.value = '';
            }
            if (elements.btnSaveLead) {
                elements.btnSaveLead.disabled = false;
                elements.btnSaveLead.textContent = 'Save Lead';
            }
            resetLeadEntranceTests();
        }

        function resetLeadTaskComposer() {
            if (elements.inputLeadTaskTitle) elements.inputLeadTaskTitle.value = '';
            if (elements.inputLeadTaskDueAt) elements.inputLeadTaskDueAt.value = '';
            if (elements.inputLeadTaskPriority) elements.inputLeadTaskPriority.value = 'medium';
        }

        function resetLeadActivityComposer() {
            if (elements.inputLeadActivityType) elements.inputLeadActivityType.value = 'note';
            if (elements.inputLeadActivitySubject) elements.inputLeadActivitySubject.value = '';
            if (elements.inputLeadActivityBody) elements.inputLeadActivityBody.value = '';
        }

        function clearLeadSelection() {
            selectedLeadIds.clear();
        }

        function pruneLeadSelection(validIds) {
            const keep = new Set((Array.isArray(validIds) ? validIds : []).map((id) => String(id || '').trim()).filter(Boolean));
            Array.from(selectedLeadIds).forEach((id) => {
                if (!keep.has(id)) {
                    selectedLeadIds.delete(id);
                }
            });
        }

        function updateLeadSelection(leadId, selected) {
            const id = String(leadId || '').trim();
            if (!id) return;
            if (selected) selectedLeadIds.add(id);
            else selectedLeadIds.delete(id);
        }

        async function showBulkDeleteWarningDialog({
            title,
            note,
            totalCount,
            deletableCount,
            blocked,
            entityLabel,
            summaryCards,
            detailTitle,
            detailNote,
            detailItems,
            confirmLabel,
            requiresText,
            badgeText
        }) {
            const dialog = window.CrmAdminDialogs && typeof window.CrmAdminDialogs.showBulkDeleteWarning === 'function'
                ? window.CrmAdminDialogs.showBulkDeleteWarning
                : null;
            if (!dialog) {
                showToast('Archive warning dialog is unavailable.', 'error');
                return false;
            }
            return dialog({
                title,
                note,
                totalCount,
                deletableCount,
                blocked,
                entityLabel,
                summaryCards,
                detailTitle,
                detailNote,
                detailItems,
                confirmLabel,
                requiresText,
                badgeText
            });
        }

        async function bulkDeleteLeads() {
            const ids = Array.from(selectedLeadIds);
            if (!ids.length) return;

            let preview;
            try {
                preview = await apiFetchJson('/api/admin/leads/bulk-delete/preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids, sourcePanel: 'enquiry' })
                });
            } catch (error) {
                if (Number(error?.status) === 404) {
                    throw new Error('Recycle-bin archive is not available in the currently running backend. Restart or redeploy the server, then try again.');
                }
                throw error;
            }

            const archiveable = Array.isArray(preview.archiveableIds) ? preview.archiveableIds : [];
            const notFoundIds = Array.isArray(preview.notFoundIds) ? preview.notFoundIds : [];
            const impactSummary = Array.isArray(preview.impactSummary) ? preview.impactSummary : [];
            const expiresAt = String(preview.expiresAt || '').trim();
            const previewItems = impactSummary.map((item) => ({
                title: String(item?.title || item?.id || 'Lead').trim() || 'Lead',
                subtitle: [String(item?.rootEntityType || 'lead').trim(), String(item?.subtitle || item?.sourcePanel || '').trim()].filter(Boolean).join(' · '),
                detailText: expiresAt ? `Expires ${formatDateTime(expiresAt)}` : 'Retained for 30 days',
                details: Array.isArray(item?.details) ? item.details : []
            })).concat(notFoundIds.map((id) => ({
                kind: 'missing',
                title: id,
                subtitle: 'Not found',
                detailText: 'Skipped during archive.'
            })));
            const proceed = await showBulkDeleteWarningDialog({
                title: `Move ${ids.length} lead${ids.length === 1 ? '' : 's'} to Recycle Bin?`,
                note: `${archiveable.length} lead${archiveable.length === 1 ? '' : 's'} will move to Recycle Bin and stay there for 30 days.`,
                totalCount: ids.length,
                deletableCount: archiveable.length,
                summaryCards: [
                    { label: 'Selected', value: String(ids.length) },
                    { label: 'Will archive', value: String(archiveable.length) },
                    { label: 'Not found', value: String(notFoundIds.length) }
                ],
                detailTitle: 'Archive preview',
                detailNote: expiresAt ? `Archived records are retained until ${formatDateTime(expiresAt)}.` : 'Archived records are retained for 30 days.',
                detailItems: previewItems,
                entityLabel: 'lead',
                confirmLabel: 'Move to Recycle Bin',
                requiresText: 'archive',
                badgeText: 'Warning'
            });
            if (!proceed) {
                return;
            }

            const result = await apiFetchJson('/api/admin/leads/bulk-delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids, sourcePanel: 'enquiry' })
            });

            clearLeadSelection();
            await refreshLeadPipeline();
            await refreshDashboard();
            const archivedCount = Array.isArray(result.archivedIds) ? result.archivedIds.length : 0;
            const notFoundCount = Array.isArray(result.notFoundIds) ? result.notFoundIds.length : 0;
            if (archivedCount > 0) {
                showToast(notFoundCount > 0
                    ? `Moved ${archivedCount} lead(s) to Recycle Bin. ${notFoundCount} were not found.`
                    : `Moved ${archivedCount} lead(s) to Recycle Bin.`, 'success');
                return;
            }
            showToast('No lead records were moved to Recycle Bin.', 'error');
        }

        function resetLeadEntranceTests() {
            modalState.leadCreatedTestLinks = new Map();
            if (elements.leadEntranceTestLinkInput) elements.leadEntranceTestLinkInput.value = '';
            if (elements.btnCopyLeadEntranceTestLink) elements.btnCopyLeadEntranceTestLink.disabled = true;
            if (elements.btnOpenLeadEntranceTestLink) elements.btnOpenLeadEntranceTestLink.disabled = true;
            if (elements.leadEntranceTestLinkNote) {
                elements.leadEntranceTestLinkNote.textContent = 'Create a test to generate a single-use learner link you can send.';
            }
            if (elements.leadEntranceTestsList) {
                elements.leadEntranceTestsList.innerHTML = '<div class="crm-muted">No tests yet.</div>';
            }
            if (elements.btnAddLeadEntranceTest) {
                elements.btnAddLeadEntranceTest.disabled = false;
                elements.btnAddLeadEntranceTest.textContent = 'Add new test';
            }
        }

        function renderLeadEntranceTests(tests) {
            if (!elements.leadEntranceTestsList) return;
            const list = Array.isArray(tests) ? tests : [];
            if (!list.length) {
                elements.leadEntranceTestsList.innerHTML = '<div class="crm-muted">No tests yet.</div>';
                return;
            }

            elements.leadEntranceTestsList.innerHTML = list.map((test) => {
                const status = String(test.status || 'created').toLowerCase();
                const testLink = String(test.testLink || modalState.leadCreatedTestLinks?.get(test.testId) || '').trim();
                const resultLink = String(test.resultLink || '').trim();
                return `
                    <div class="crm-task-item">
                        <div class="crm-task-head">
                            <strong>${escapeHtml(test.testId || 'Test')}</strong>
                            <span class="crm-task-priority ${status === 'submitted' ? 'medium' : 'low'}">${escapeHtml(status)}</span>
                        </div>
                        <div class="crm-task-meta">Created ${escapeHtml(String(test.createdAt || '-'))}</div>
                        <div class="crm-task-actions">
                            ${testLink ? `<a class="crm-btn-secondary" href="${escapeHtml(testLink)}" target="_blank" rel="noopener">Open</a>` : ''}
                            ${resultLink ? `<a class="crm-btn-secondary" href="${escapeHtml(resultLink)}" target="_blank" rel="noopener">Result</a>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }

        async function refreshLeadEntranceTests() {
            if (!modalState.leadId) return;
            if (!elements.leadEntranceTestsList) return;
            try {
                const json = await apiFetchJson(`/api/admin/leads/${encodeURIComponent(modalState.leadId)}/entrance-tests`, {
                    method: 'GET'
                });
                const tests = Array.isArray(json.tests) ? json.tests : [];
                const entranceTestUi = window.CrmEntranceTests || null;
                const viewModel = entranceTestUi && typeof entranceTestUi.buildViewModel === 'function'
                    ? entranceTestUi.buildViewModel(tests, modalState.leadCreatedTestLinks || new Map())
                    : { tests, latestActiveTest: tests.find((test) => String(test.status || '').toLowerCase() === 'created') || null };
                if (entranceTestUi && typeof entranceTestUi.applyControls === 'function') {
                    const latest = viewModel.latestActiveTest || null;
                    entranceTestUi.applyControls({
                        entranceTestLinkInput: elements.leadEntranceTestLinkInput,
                        btnCopyEntranceTestLink: elements.btnCopyLeadEntranceTestLink,
                        btnOpenEntranceTestLink: elements.btnOpenLeadEntranceTestLink,
                        entranceTestLinkNote: elements.leadEntranceTestLinkNote
                    }, latest, { hasAnyTests: viewModel.tests.length > 0 });
                }
                renderLeadEntranceTests(viewModel.tests);
            } catch (error) {
                console.error('[CRM Admin] Failed to refresh lead entrance tests:', error);
                elements.leadEntranceTestsList.innerHTML = '<div class="crm-muted">Failed to load tests.</div>';
            }
        }

        async function createLeadEntranceTest() {
            if (!modalState.leadId) throw new Error('Select a lead first.');
            if (elements.btnAddLeadEntranceTest) {
                elements.btnAddLeadEntranceTest.disabled = true;
                elements.btnAddLeadEntranceTest.textContent = 'Creating...';
            }
            try {
                const testType = String(elements.leadEntranceTestType?.value || 'entrance_test_36plus_v1').trim();
                const json = await apiFetchJson(`/api/admin/leads/${encodeURIComponent(modalState.leadId)}/entrance-tests`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ testType })
                });
                const testId = String(json.testId || '').trim();
                const testLink = String(json.testLink || '').trim();
                if (!testId || !testLink) throw new Error('Test link missing from server response.');
                if (!modalState.leadCreatedTestLinks) modalState.leadCreatedTestLinks = new Map();
                modalState.leadCreatedTestLinks.set(testId, testLink);
                if (elements.leadEntranceTestLinkInput) elements.leadEntranceTestLinkInput.value = testLink;
                if (elements.btnCopyLeadEntranceTestLink) elements.btnCopyLeadEntranceTestLink.disabled = false;
                if (elements.btnOpenLeadEntranceTestLink) elements.btnOpenLeadEntranceTestLink.disabled = false;
                if (elements.leadEntranceTestLinkNote) {
                    elements.leadEntranceTestLinkNote.textContent = 'Latest single-use learner link is ready to send. It will stop working after submission.';
                }
                await refreshLeadEntranceTests();
                showToast('Entrance test link created.', 'success');
            } finally {
                if (elements.btnAddLeadEntranceTest) {
                    elements.btnAddLeadEntranceTest.disabled = false;
                    elements.btnAddLeadEntranceTest.textContent = 'Add new test';
                }
            }
        }

        async function saveLead() {
            if (!window.CrmLeads || typeof window.CrmLeads.buildPayload !== 'function') {
                throw new Error('Lead helpers are not available.');
            }

            const payload = window.CrmLeads.buildPayload(elements);
            if (!window.CrmLeads.hasAnyContact(payload)) {
                throw new Error('Please fill at least 1 lead contact field before saving.');
            }

            if (elements.btnSaveLead) {
                elements.btnSaveLead.disabled = true;
                elements.btnSaveLead.textContent = 'Saving...';
            }

            try {
                await apiFetchJson('/api/admin/leads', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                elements.leadComposer.style.display = 'none';
                resetLeadComposer();
                await refreshLeadPipeline();
                await refreshDashboard();
                showToast('Lead saved.', 'success');
            } catch (error) {
                if (elements.btnSaveLead) {
                    elements.btnSaveLead.disabled = false;
                    elements.btnSaveLead.textContent = 'Save Lead';
                }
                throw error;
            }
        }

        function renderLeadContextSummary(lead) {
            if (!elements.leadContextSummary) return;
            if (!lead) {
                elements.leadContextSummary.innerHTML = '<div class="crm-muted">Structured intake details will appear here.</div>';
                return;
            }

            const rows = [
                ['Facebook', [lead?.facebookDisplayName || lead?.facebook, lead?.facebookProfileUrl].filter(Boolean).join(' / ')],
                ['Real Name', lead?.realName],
                ['Date of Birth', lead?.dateOfBirth],
                ['Learning Needs', lead?.learningNeeds],
                ['Preferred Days', formatList(lead?.preferredLearningDays)],
                ['Preferred Hours', formatList(lead?.preferredLearningHours)],
                ['Messenger', [lead?.messengerStatus, lead?.messengerLastContactAt, lead?.messengerThreadUrl].filter(Boolean).join(' / ')]
            ].filter(([, value]) => String(value || '').trim());

            if (!rows.length) {
                elements.leadContextSummary.innerHTML = '<div class="crm-muted">No structured intake context captured yet.</div>';
                return;
            }

            elements.leadContextSummary.innerHTML = rows.map(([label, value]) => `
      <div>
        <strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}
      </div>
    `).join('');
        }

        async function refreshLeadWorkspace() {
            if (!modalState.leadId) {
                if (elements.leadWorkspace) elements.leadWorkspace.style.display = 'none';
                renderLeadContextSummary(null);
                return;
            }

            const lead = dataCache.leads.find((item) => String(item.leadId || '') === String(modalState.leadId)) || null;
            const [tasks, activities] = await Promise.all([
                fetchTasks({ leadId: modalState.leadId, limit: 50 }),
                fetchActivities({ leadId: modalState.leadId, limit: 50 })
            ]);

            if (elements.leadWorkspace) elements.leadWorkspace.style.display = 'grid';
            if (elements.leadWorkspaceTitle) {
                elements.leadWorkspaceTitle.textContent = lead?.name || lead?.email || 'Lead Workspace';
            }
            if (elements.leadWorkspaceMeta) {
                elements.leadWorkspaceMeta.textContent = [
                    lead?.crmId ? `ID ${lead.crmId}` : null,
                    lead?.stage,
                    lead?.source,
                    lead?.email || lead?.phone || lead?.zalo || lead?.facebookDisplayName || lead?.facebook || lead?.facebookProfileUrl,
                    lead?.messengerStatus
                ]
                    .filter(Boolean)
                    .join(' | ') || 'Manage next actions and communication.';
            }

            applyReminderBadge(elements.leadWorkspaceBadge, getReminderSummary({ leadId: modalState.leadId }));
            renderLeadContextSummary(lead);
            renderTaskList(elements.leadTaskList, tasks, {
                emptyMessage: 'No lead tasks yet.',
                scope: 'lead'
            });
            renderActivityList(elements.leadActivityList, activities, 'No lead activity yet.');
            await refreshLeadEntranceTests();
        }

        function renderLeadStageBoard(leads) {
            if (!elements.leadStageBoard) return;
            if (!window.CrmLeads || typeof window.CrmLeads.summarize !== 'function') {
                elements.leadStageBoard.innerHTML = '';
                return;
            }

            const counts = window.CrmLeads.summarize(leads);
            elements.leadStageBoard.innerHTML = window.CrmLeads.STAGES.map((stage) => `
      <div class="crm-lead-stage-card">
        <div class="text-muted">${escapeHtml(window.CrmLeads.formatStageLabel(stage))}</div>
        <strong>${escapeHtml(String(counts[stage] || 0))}</strong>
      </div>
    `).join('');
        }

        function renderLeadTable(leads) {
            if (!elements.leadListContainer) return;
            if (!Array.isArray(leads) || !leads.length) {
                elements.leadListContainer.innerHTML = 'No leads yet.';
                return;
            }

            if (!elements.leadListContainer.__crmLeadTableHandlerBound) {
                elements.leadListContainer.addEventListener('click', async (event) => {
                    const target = event.target && typeof event.target.closest === 'function'
                        ? event.target.closest('[data-lead-id]')
                        : null;
                    if (!target || !elements.leadListContainer.contains(target)) return;

                    if (target.classList.contains('crm-lead-link')) {
                        const leadId = String(target.dataset.leadId || '').trim();
                        modalState.leadId = leadId;
                        const lead = Array.isArray(dataCache.leads)
                            ? dataCache.leads.find((row) => String(row.leadId || '').trim() === leadId) || null
                            : null;

                        // Once a lead is converted, clicking its name should open the student profile.
                        if (lead && window.CrmLeads && typeof window.CrmLeads.isConvertedLead === 'function'
                            && window.CrmLeads.isConvertedLead(lead)
                            && lead.studentId
                            && typeof openStudentProfile === 'function') {
                            try {
                                await openStudentProfile(String(lead.studentId || '').trim(), null, { crmId: lead.crmId || '' });
                            } catch (error) {
                                console.error('[CRM Admin] Open converted lead student profile failed:', error);
                                showToast(error?.message || 'Failed to open student profile.', 'error');
                            }
                            return;
                        }

                        if (elements.leadWorkspaceTitle) {
                            elements.leadWorkspaceTitle.textContent = lead?.name || lead?.email || 'Lead Workspace';
                        }
                        refreshLeadWorkspace().catch((error) => {
                            console.error('[CRM Admin] Open lead workspace failed:', error);
                            showToast(error?.message || 'Failed to load lead workspace.', 'error');
                        });
                        return;
                    }

                    if (target.classList.contains('btn-update-lead-stage')) {
                        const button = target;
                        const leadId = String(button.dataset.leadId || '').trim();
                        const select = elements.leadListContainer.querySelector(`.lead-stage-select[data-lead-id="${leadId}"]`);
                        const stage = String(select?.value || '').trim();
                        try {
                            button.disabled = true;
                            await apiFetchJson(`/api/admin/leads/${encodeURIComponent(leadId)}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ stage })
                            });
                            await refreshLeadPipeline();
                            showToast('Lead updated.', 'success');
                        } catch (error) {
                            console.error('[CRM Admin] Update lead stage failed:', error);
                            showToast(error?.message || 'Failed to update lead.', 'error');
                            button.disabled = false;
                        }
                        return;
                    }

                    if (target.classList.contains('btn-convert-lead')) {
                        const button = target;
                        const leadId = String(button.dataset.leadId || '').trim();
                        try {
                            button.disabled = true;
                            const json = await apiFetchJson(`/api/admin/leads/${encodeURIComponent(leadId)}/convert`, {
                                method: 'POST'
                            });
                            await Promise.all([
                                refreshLeadPipeline(),
                                refreshStudentLists()
                            ]);
                            if (json?.student && typeof openStudentProfile === 'function') {
                                await openStudentProfile(json.student.studentId || json.student.id || '', json.student);
                            }
                            showToast('Lead converted to student.', 'success');
                        } catch (error) {
                            console.error('[CRM Admin] Convert lead failed:', error);
                            showToast(error?.message || 'Failed to convert lead.', 'error');
                            button.disabled = false;
                        }
                    }
                });
                elements.leadListContainer.__crmLeadTableHandlerBound = true;
            }

            const checkedCount = selectedLeadIds.size;
            const allChecked = checkedCount > 0 && leads.every((lead) => selectedLeadIds.has(String(lead.leadId || '').trim()));
            elements.leadListContainer.innerHTML = `
      <div class="crm-inline-fields" style="justify-content: space-between; margin-bottom: 12px;">
        <div class="crm-muted">${checkedCount ? `${checkedCount} selected` : 'Select rows to move to Recycle Bin.'}</div>
        <button type="button" class="crm-btn-secondary" data-action="bulk-delete" ${checkedCount ? '' : 'disabled'}>Archive Selected</button>
      </div>
      <div class="crm-table-container">
        <table class="crm-table">
          <thead>
            <tr>
              <th style="width:56px; text-align:center; padding-left:14px; padding-right:14px;">
                <input type="checkbox" data-lead-select-all ${allChecked ? 'checked' : ''}>
              </th>
              <th>Name</th><th>Contact</th><th>Source</th><th>Stage</th><th>Probability</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${leads.map((lead) => `
              ${(() => {
                    const isConverted = window.CrmLeads.isConvertedLead(lead);
                    const stageOptions = window.CrmLeads.getSelectableStages(lead.stage);
                    const leadId = String(lead.leadId || '').trim();
                    const checked = selectedLeadIds.has(leadId);
                    return `
              <tr>
                <td style="width:56px; text-align:center; padding-left:14px; padding-right:14px;">
                  <input type="checkbox" data-lead-select="${escapeHtml(leadId)}" ${checked ? 'checked' : ''}>
                </td>
                <td class="td-bold">
                  <div class="crm-name-cell">
                    <button type="button" class="crm-student-link crm-lead-link" data-lead-id="${escapeHtml(lead.leadId)}">${escapeHtml(lead.name || lead.email || 'Unnamed lead')}</button>
                    ${renderReminderBadgeMarkup(getReminderSummary({ leadId: lead.leadId }))}
                  </div>
                </td>
                <td>${escapeHtml(leadPrimaryContact(lead))}</td>
                <td>${escapeHtml(leadSourceSummary(lead))}</td>
                <td>
                  <select class="crm-input crm-inline-select lead-stage-select" data-lead-id="${escapeHtml(lead.leadId)}" ${isConverted ? 'disabled' : ''}>
                    ${stageOptions.map((stage) => `
                      <option value="${stage}" ${stage === lead.stage ? 'selected' : ''}>${escapeHtml(window.CrmLeads.formatStageLabel(stage))}</option>
                    `).join('')}
                  </select>
                </td>
                <td>${escapeHtml(lead.probability == null ? '-' : `${lead.probability}%`)}</td>
                <td>
                  <div class="crm-inline-fields">
                    <button type="button" class="crm-btn-secondary btn-update-lead-stage" data-lead-id="${escapeHtml(lead.leadId)}" ${isConverted ? 'disabled' : ''}>Update</button>
                    <button type="button" class="crm-btn-primary btn-convert-lead" data-lead-id="${escapeHtml(lead.leadId)}" ${lead.studentId ? 'disabled' : ''}>${lead.studentId ? 'Converted' : 'Convert'}</button>
                  </div>
                </td>
              </tr>
            `;
                })()}
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
        }

        async function refreshLeadPipeline() {
            const json = await apiFetchJson('/api/admin/leads?limit=200', { method: 'GET' });
            const rawLeads = Array.isArray(json.leads) ? json.leads : [];
            const leads = rawLeads.filter((lead) => !window.CrmLeads.isConvertedLead(lead));
            dataCache.leads = leads;
            pruneLeadSelection(leads.map((lead) => lead.leadId));
            renderLeadStageBoard(leads);
            renderLeadTable(leads);
            if (modalState.leadId && !leads.find((lead) => String(lead.leadId || '') === String(modalState.leadId))) {
                modalState.leadId = null;
                if (elements.leadWorkspace) elements.leadWorkspace.style.display = 'none';
            } else if (modalState.leadId) {
                await refreshLeadWorkspace();
            }
        }

        function setupLeadComposer() {
            if (!elements.leadComposer) return;

            if (elements.btnNewLead) {
                elements.btnNewLead.addEventListener('click', () => {
                    resetLeadComposer();
                    elements.leadComposer.style.display = 'block';
                });
            }

            if (elements.btnCancelLead) {
                elements.btnCancelLead.addEventListener('click', () => {
                    elements.leadComposer.style.display = 'none';
                    resetLeadComposer();
                });
            }

            if (elements.btnSaveLead) {
                elements.btnSaveLead.addEventListener('click', () => {
                    saveLead().catch((error) => {
                        console.error('[CRM Admin] Save lead failed:', error);
                        showToast(error?.message || 'Failed to save lead.', 'error');
                    });
                });
            }

            if (elements.btnAddLeadEntranceTest) {
                elements.btnAddLeadEntranceTest.addEventListener('click', () => {
                    createLeadEntranceTest().catch((error) => {
                        console.error('[CRM Admin] Create lead entrance test failed:', error);
                        showToast(error?.message || 'Failed to create entrance test.', 'error');
                    });
                });
            }

            if (elements.btnCopyLeadEntranceTestLink) {
                elements.btnCopyLeadEntranceTestLink.addEventListener('click', async () => {
                    try {
                        const link = String(elements.leadEntranceTestLinkInput?.value || '').trim();
                        if (!link) return;
                        await navigator.clipboard.writeText(link);
                        showToast('Link copied.', 'success');
                    } catch (error) {
                        showToast(error?.message || 'Failed to copy link.', 'error');
                    }
                });
            }

            if (elements.btnOpenLeadEntranceTestLink) {
                elements.btnOpenLeadEntranceTestLink.addEventListener('click', () => {
                    const link = String(elements.leadEntranceTestLinkInput?.value || '').trim();
                    if (!link) return;
                    window.open(link, '_blank', 'noopener');
                });
            }

            if (elements.leadListContainer && !elements.leadListContainer.__crmLeadBulkDeleteBound) {
                elements.leadListContainer.addEventListener('change', (event) => {
                    const checkbox = event.target && typeof event.target.closest === 'function'
                        ? event.target.closest('input[type="checkbox"][data-lead-select]')
                        : null;
                    if (!checkbox || !elements.leadListContainer.contains(checkbox)) return;
                    updateLeadSelection(checkbox.dataset.leadSelect, checkbox.checked);
                    renderLeadTable(Array.isArray(dataCache.leads) ? dataCache.leads : []);
                });
                elements.leadListContainer.addEventListener('click', (event) => {
                    const checkbox = event.target && typeof event.target.closest === 'function'
                        ? event.target.closest('input[type="checkbox"][data-lead-select-all]')
                        : null;
                    if (!checkbox || !elements.leadListContainer.contains(checkbox)) return;
                    const leads = Array.isArray(dataCache.leads) ? dataCache.leads : [];
                    if (checkbox.checked) {
                        leads.forEach((lead) => {
                            const id = String(lead.leadId || '').trim();
                            if (id) selectedLeadIds.add(id);
                        });
                    } else {
                        clearLeadSelection();
                    }
                    renderLeadTable(leads);
                });
                elements.leadListContainer.addEventListener('click', (event) => {
                    const button = event.target && typeof event.target.closest === 'function'
                        ? event.target.closest('button[data-action="bulk-delete"]')
                        : null;
                    if (!button || !elements.leadListContainer.contains(button)) return;
                    bulkDeleteLeads().catch((error) => {
                        console.error('[CRM Admin] Bulk archive leads failed:', error);
                        showToast(error?.message || 'Failed to archive leads.', 'error');
                    });
                });
                elements.leadListContainer.__crmLeadBulkDeleteBound = true;
            }
        }

        return {
            resetLeadComposer,
            resetLeadTaskComposer,
            resetLeadActivityComposer,
            setupLeadComposer,
            saveLead,
            refreshLeadWorkspace,
            renderLeadContextSummary,
            renderLeadStageBoard,
            renderLeadTable,
            refreshLeadPipeline
        };
    }

    return {
        createController
    };
})();
