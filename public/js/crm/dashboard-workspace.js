window.CrmDashboardWorkspace = (function () {
    function createController(deps = {}) {
        const {
            elements,
            showToast,
            apiFetchJson,
            formatDateTime,
            escapeHtml
        } = deps;

        async function refreshDashboard() {
            if (!window.CrmDashboard) return;

            const [summaryJson, funnelJson, revenueJson, duplicatesJson, auditJson] = await Promise.all([
                apiFetchJson('/api/admin/dashboard/summary', { method: 'GET' }),
                apiFetchJson('/api/admin/dashboard/funnel', { method: 'GET' }),
                apiFetchJson('/api/admin/dashboard/revenue', { method: 'GET' }),
                apiFetchJson('/api/admin/duplicates', { method: 'GET' }),
                apiFetchJson('/api/admin/audit-logs', { method: 'GET' })
            ]);

            const summary = summaryJson.summary || {};
            const funnel = funnelJson.funnel || {};
            const revenue = Array.isArray(revenueJson.revenue) ? revenueJson.revenue : [];
            const duplicates = Array.isArray(duplicatesJson.duplicates) ? duplicatesJson.duplicates : [];
            const auditLogs = Array.isArray(auditJson.auditLogs) ? auditJson.auditLogs : [];

            if (elements.dashboardSummaryCards) {
                const cards = window.CrmDashboard.buildSummaryCards(summary);
                elements.dashboardSummaryCards.innerHTML = cards.map((card) => `
        <div class="crm-summary-card" data-card-key="${escapeHtml(card.key || '')}">
          <div class="crm-summary-card-label">${escapeHtml(card.label || '')}</div>
          <div class="crm-summary-card-value">${escapeHtml(card.value || '0')}</div>
          <div class="crm-summary-card-footnote">${escapeHtml(card.footnote || '')}</div>
        </div>
      `).join('');
            }

            if (elements.dashboardFunnel) {
                const rows = window.CrmDashboard.buildFunnelRows(funnel);
                elements.dashboardFunnel.innerHTML = rows.map((row) => `
        <div class="crm-task-item">
          <div class="crm-task-head">
            <strong>${escapeHtml(window.CrmDashboard.formatStageLabel(row.stage))}</strong>
            <span class="crm-task-priority medium">${escapeHtml(String(row.count || 0))}</span>
          </div>
        </div>
      `).join('');
            }

            if (elements.dashboardRevenue) {
                if (!revenue.length) {
                    elements.dashboardRevenue.innerHTML = '<div class="crm-muted" style="padding: 18px;">No invoice activity yet.</div>';
                } else {
                    elements.dashboardRevenue.innerHTML = `
          <div class="crm-table-container">
            <table class="crm-table">
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Invoiced</th>
                  <th>Collected</th>
                  <th>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                ${revenue.map((row) => `
                  <tr>
                    <td>${escapeHtml(row.courseId || 'unassigned')}</td>
                    <td>${escapeHtml(window.CrmDashboard.toMoney(row.invoicedAmount))}</td>
                    <td>${escapeHtml(window.CrmDashboard.toMoney(row.collectedAmount))}</td>
                    <td>${escapeHtml(window.CrmDashboard.toMoney(row.outstandingAmount))}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
                }
            }

            if (elements.dashboardDuplicates) {
                if (!duplicates.length) {
                    elements.dashboardDuplicates.innerHTML = '<div class="crm-muted">No duplicate candidates found.</div>';
                } else {
                    elements.dashboardDuplicates.innerHTML = duplicates.slice(0, 10).map((group) => {
                        const item = window.CrmGovernance
                            ? window.CrmGovernance.formatDuplicateGroup(group)
                            : {
                                title: String(group.kind || 'match'),
                                subtitle: String(group.key || ''),
                                detail: Array.isArray(group.studentIds) ? group.studentIds.join(', ') : ''
                            };
                        return `
            <div class="crm-task-item">
              <div class="crm-task-head">
                <strong>${escapeHtml(item.title)}</strong>
                <span class="crm-task-priority high">${escapeHtml(String((group.studentIds || []).length || 0))}</span>
              </div>
              <div class="crm-task-meta">${escapeHtml(item.subtitle)}</div>
              <div class="crm-timeline-meta" style="margin-top: 6px;">${escapeHtml(item.detail)}</div>
            </div>
          `;
                    }).join('');
                }
            }

            if (elements.dashboardAuditLogs) {
                if (!auditLogs.length) {
                    elements.dashboardAuditLogs.innerHTML = '<div class="crm-muted">No audit logs yet.</div>';
                } else {
                    elements.dashboardAuditLogs.innerHTML = auditLogs.slice(0, 12).map((entry) => `
          <div class="crm-timeline-item">
            <div class="crm-timeline-head">
              <span class="crm-activity-chip">${escapeHtml(window.CrmGovernance ? window.CrmGovernance.formatAuditAction(entry.action) : entry.action)}</span>
              <span class="crm-timeline-meta">${escapeHtml(formatDateTime(entry.createdAt))}</span>
            </div>
            <strong>${escapeHtml(entry.entityType || 'entity')} / ${escapeHtml(entry.entityId || 'unknown')}</strong>
            <div class="crm-timeline-meta" style="margin-top: 6px;">${escapeHtml(entry.actorEmail || entry.actorUid || 'system')}</div>
          </div>
        `).join('');
                }
            }
        }

        async function createMergeJob() {
            if (!window.CrmGovernance || typeof window.CrmGovernance.buildMergeJobPayload !== 'function') {
                throw new Error('Governance helpers are not available.');
            }

            const payload = window.CrmGovernance.buildMergeJobPayload({
                inputMergePrimaryStudentId: elements.inputMergePrimaryStudentId,
                inputMergeDuplicateStudentIds: elements.inputMergeDuplicateStudentIds
            });

            await apiFetchJson('/api/admin/merge-jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (elements.inputMergePrimaryStudentId) elements.inputMergePrimaryStudentId.value = '';
            if (elements.inputMergeDuplicateStudentIds) elements.inputMergeDuplicateStudentIds.value = '';
            await refreshDashboard();
            showToast('Merge job created.', 'success');
        }

        return {
            refreshDashboard,
            createMergeJob
        };
    }

    return {
        createController
    };
})();
