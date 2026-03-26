window.CrmDashboardWorkspace = (function () {
    function createController(deps = {}) {
        const {
            elements,
            showToast,
            apiFetchJson,
            formatDateTime,
            escapeHtml,
            getAdminCapabilities
        } = deps;

        function hasCapability(name) {
            const capabilities = typeof getAdminCapabilities === 'function'
                ? (getAdminCapabilities() || {})
                : {};
            return capabilities[name] === true;
        }

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
            let readAloudPromptSummary = null;
            let readAloudUsageSummary = null;

            if (hasCapability('readAloudReporting')) {
                const [readAloudPromptResult, readAloudUsageResult] = await Promise.allSettled([
                    apiFetchJson('/api/admin/read-aloud/prompt-summary', { method: 'GET' }),
                    apiFetchJson('/api/admin/read-aloud/usage-summary?days=7', { method: 'GET' })
                ]);
                readAloudPromptSummary = readAloudPromptResult.status === 'fulfilled'
                    ? (readAloudPromptResult.value.promptSummary || null)
                    : null;
                readAloudUsageSummary = readAloudUsageResult.status === 'fulfilled'
                    ? (readAloudUsageResult.value.usageSummary || null)
                    : null;
            }

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

            if (elements.readAloudPromptSummaryCards) {
                if (!readAloudPromptSummary) {
                    elements.readAloudPromptSummaryCards.innerHTML = '<div class="crm-muted">Read Aloud prompt inventory unavailable.</div>';
                } else {
                    const cards = [
                        { label: 'Prompts', value: String(readAloudPromptSummary.promptCount || 0), footnote: `Index ${escapeHtml(readAloudPromptSummary.indexVersion || 'n/a')}` },
                        { label: 'Audio Available', value: String(readAloudPromptSummary.audioAvailableCount || 0), footnote: 'Prompts with sample audio' },
                        { label: 'Any Connected', value: String(readAloudPromptSummary.anyConnectedCount || 0), footnote: 'Linking, reduced words, or sound changes' },
                        { label: 'Sound Changes', value: String(readAloudPromptSummary.soundChangeCount || 0), footnote: 'Level 3 prompts' }
                    ];
                    elements.readAloudPromptSummaryCards.innerHTML = cards.map((card) => `
        <div class="crm-summary-card" data-card-key="${escapeHtml(card.label || '')}">
          <div class="crm-summary-card-label">${escapeHtml(card.label || '')}</div>
          <div class="crm-summary-card-value">${escapeHtml(card.value || '0')}</div>
          <div class="crm-summary-card-footnote">${escapeHtml(card.footnote || '')}</div>
        </div>
      `).join('');
                }
            }

            if (elements.readAloudPromptSamples) {
                if (!readAloudPromptSummary?.samplePrompts?.length) {
                    elements.readAloudPromptSamples.innerHTML = '<div class="crm-muted">No prompt examples available.</div>';
                } else {
                    elements.readAloudPromptSamples.innerHTML = readAloudPromptSummary.samplePrompts.slice(0, 8).map((prompt) => {
                        const flags = [];
                        if (prompt.hasLinking) flags.push('linking');
                        if (prompt.hasReducedWords) flags.push('reduced words');
                        if (prompt.hasSoundChanges) flags.push(`sound changes: ${(prompt.soundChangeSubtypes || []).join(', ') || 'yes'}`);
                        if (prompt.hasSampleAudio) flags.push('audio');
                        return `
            <div class="crm-task-item">
              <div class="crm-task-head">
                <strong>${escapeHtml(prompt.questionId || prompt.rowKey || 'unknown')}</strong>
                <span class="crm-task-priority medium">${escapeHtml(String(flags.length || 0))}</span>
              </div>
              <div class="crm-task-meta">${escapeHtml(prompt.title || '')}</div>
              <div class="crm-timeline-meta" style="margin-top: 6px;">${escapeHtml(flags.join(' · ') || 'No flags')}</div>
            </div>
          `;
                    }).join('');
                }
            }

            if (elements.readAloudUsageSummaryCards) {
                if (!readAloudUsageSummary) {
                    elements.readAloudUsageSummaryCards.innerHTML = '<div class="crm-muted">Read Aloud usage unavailable.</div>';
                } else {
                    const cards = [
                        { label: 'Attempts', value: String(readAloudUsageSummary.attemptCount || 0), footnote: `${Number(readAloudUsageSummary.periodDays || 7)} day window` },
                        { label: 'Guide Levels', value: String(Object.keys(readAloudUsageSummary.guideLevelCounts || {}).length || 0), footnote: 'Distinct client guide states' },
                        { label: 'Requested Modes', value: String(Object.keys(readAloudUsageSummary.requestedAlignmentModeCounts || {}).length || 0), footnote: 'Requested rollout modes' },
                        { label: 'Actual Modes', value: String(Object.keys(readAloudUsageSummary.actualScoringModeCounts || readAloudUsageSummary.scoringModeCounts || {}).length || 0), footnote: 'Learner-facing scoring modes' },
                        { label: 'Shadow Attempts', value: String((readAloudUsageSummary.realShadowAttemptCount || 0) + (readAloudUsageSummary.shadowPlaceholderCount || 0)), footnote: 'Real shadow plus scaffold records' },
                        { label: 'V3 No Sound Change', value: String(readAloudUsageSummary.v3NoSoundChangeCount || 0), footnote: 'Level 3 attempts without a sound change' }
                    ];
                    elements.readAloudUsageSummaryCards.innerHTML = cards.map((card) => `
        <div class="crm-summary-card" data-card-key="${escapeHtml(card.label || '')}">
          <div class="crm-summary-card-label">${escapeHtml(card.label || '')}</div>
          <div class="crm-summary-card-value">${escapeHtml(card.value || '0')}</div>
          <div class="crm-summary-card-footnote">${escapeHtml(card.footnote || '')}</div>
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
