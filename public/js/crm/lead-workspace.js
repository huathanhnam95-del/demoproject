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
            fetchTasks,
            fetchActivities,
            applyReminderBadge,
            getReminderSummary,
            renderTaskList,
            renderActivityList,
            renderReminderBadgeMarkup,
            escapeHtml
        } = deps;

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
                            await apiFetchJson(`/api/admin/leads/${encodeURIComponent(leadId)}/convert`, {
                                method: 'POST'
                            });
                            await Promise.all([
                                refreshLeadPipeline(),
                                refreshStudentLists()
                            ]);
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

            elements.leadListContainer.innerHTML = `
      <div class="crm-table-container">
        <table class="crm-table">
          <thead>
            <tr><th>Name</th><th>Contact</th><th>Source</th><th>Stage</th><th>Probability</th><th>Actions</th></tr>
          </thead>
          <tbody>
            ${leads.map((lead) => `
              ${(() => {
                const isConverted = window.CrmLeads.isConvertedLead(lead);
                const stageOptions = window.CrmLeads.getSelectableStages(lead.stage);
                return `
              <tr>
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
            const leads = Array.isArray(json.leads) ? json.leads : [];
            dataCache.leads = leads;
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
