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

        const essayAiState = {
            active: false,
            ready: false,
            previewJobId: null,
            previewStatus: null,
            enqueueJobId: null,
            enqueueStatus: null,
            pollTimer: null,
            abortController: null
        };

        const onPreviewClick = () => {
            startEssayAiPreview().catch((error) => {
                if (elements.essayAiAdminStatus) elements.essayAiAdminStatus.textContent = error?.message || 'Preview failed.';
                if (typeof showToast === 'function') showToast(error?.message || 'Essay AI preview failed.', 'error');
            });
        };
        const onTriggerClick = () => {
            const confirmed = typeof window.confirm !== 'function'
                || window.confirm('Queue every essay in this preview for local AI scoring?');
            if (!confirmed) return;
            triggerEssayAiBackfill().catch((error) => {
                if (elements.essayAiAdminStatus) elements.essayAiAdminStatus.textContent = error?.message || 'Trigger failed.';
                if (typeof showToast === 'function') showToast(error?.message || 'Essay AI trigger failed.', 'error');
            });
        };

        function createRequestId() {
            if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
                const value = Math.floor(Math.random() * 16);
                return (token === 'x' ? value : ((value & 0x3) | 0x8)).toString(16);
            });
        }

        function heartbeatMillis(value) {
            if (value && typeof value.toDate === 'function') return value.toDate().getTime();
            if (value && Number.isFinite(Number(value._seconds))) return Number(value._seconds) * 1000;
            const parsed = new Date(value).getTime();
            return Number.isFinite(parsed) ? parsed : 0;
        }

        function isWorkerReady(worker) {
            if (!worker) return false;
            if (typeof worker.ready === 'boolean') return worker.ready;
            const ageMs = Date.now() - heartbeatMillis(worker.lastHeartbeatAt);
            return ageMs >= 0
                && ageMs <= 45_000
                && worker.ollamaReachable === true
                && worker.modelsReady === true;
        }

        function updateEssayAiControls() {
            if (elements.btnEssayAiPreview) {
                elements.btnEssayAiPreview.disabled = !essayAiState.ready || essayAiState.previewStatus === 'pending' || essayAiState.previewStatus === 'processing';
            }
            if (elements.btnEssayAiTrigger) {
                elements.btnEssayAiTrigger.disabled = !essayAiState.ready
                    || essayAiState.previewStatus !== 'completed'
                    || essayAiState.enqueueStatus === 'pending'
                    || essayAiState.enqueueStatus === 'processing';
            }
        }

        async function loadEssayAiStatus() {
            if (!elements.essayAiAdminStatus) return null;
            const result = await apiFetchJson('/api/admin/essay-ai/status', { method: 'GET' });
            essayAiState.ready = isWorkerReady(result.worker);
            elements.essayAiAdminStatus.textContent = `${essayAiState.ready ? 'Worker ready' : 'Worker not ready'} · ${Number(result.pendingCount || 0)} queued`;
            updateEssayAiControls();
            return result;
        }

        async function pollEssayAiJob(jobId) {
            if (!jobId || !essayAiState.active && essayAiState.previewJobId !== jobId && essayAiState.enqueueJobId !== jobId) return null;
            const result = await apiFetchJson(`/api/admin/essay-ai/backfill-jobs/${encodeURIComponent(jobId)}`, { method: 'GET' });
            const isPreview = result.mode === 'preview';
            if (isPreview) {
                essayAiState.previewJobId = jobId;
                essayAiState.previewStatus = result.status;
            } else {
                essayAiState.enqueueJobId = jobId;
                essayAiState.enqueueStatus = result.status;
            }
            if (elements.essayAiAdminStatus) {
                if (result.status === 'completed' && isPreview) {
                    elements.essayAiAdminStatus.textContent = `${Number(result.candidateCount || 0)} unscored essays · ${Number(result.invalidCount || 0)} invalid`;
                } else if (result.status === 'completed') {
                    elements.essayAiAdminStatus.textContent = `${Number(result.enqueuedCount || 0)} queued · ${Number(result.skippedCount || 0)} skipped`;
                } else if (result.status === 'failed') {
                    elements.essayAiAdminStatus.textContent = result.error || 'Essay AI job failed.';
                } else {
                    elements.essayAiAdminStatus.textContent = `Scanning… ${Number(result.scannedCount || 0)} checked`;
                }
            }
            updateEssayAiControls();
            if (essayAiState.active && (result.status === 'pending' || result.status === 'processing')) {
                clearTimeout(essayAiState.pollTimer);
                essayAiState.pollTimer = setTimeout(() => {
                    pollEssayAiJob(jobId).catch(() => {});
                }, 2000);
            }
            return result;
        }

        async function startEssayAiPreview() {
            if (!essayAiState.ready) throw new Error('Essay AI worker is not ready.');
            essayAiState.previewStatus = 'pending';
            updateEssayAiControls();
            try {
                const result = await apiFetchJson('/api/admin/essay-ai/preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ requestId: createRequestId(), includeFailed: false })
                });
                essayAiState.previewJobId = result.jobId;
                return pollEssayAiJob(result.jobId);
            } catch (error) {
                essayAiState.previewStatus = null;
                updateEssayAiControls();
                throw error;
            }
        }

        async function triggerEssayAiBackfill() {
            if (!essayAiState.ready) throw new Error('Essay AI worker is not ready.');
            if (!essayAiState.previewJobId || essayAiState.previewStatus !== 'completed') {
                throw new Error('Run and complete a preview before triggering scoring.');
            }
            essayAiState.enqueueStatus = 'pending';
            updateEssayAiControls();
            try {
                const result = await apiFetchJson('/api/admin/essay-ai/trigger', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ requestId: createRequestId(), previewJobId: essayAiState.previewJobId })
                });
                essayAiState.enqueueJobId = result.jobId;
                return pollEssayAiJob(result.jobId);
            } catch (error) {
                essayAiState.enqueueStatus = null;
                updateEssayAiControls();
                throw error;
            }
        }

        async function activate() {
            if (!essayAiState.active) {
                essayAiState.active = true;
                elements.btnEssayAiPreview?.addEventListener('click', onPreviewClick);
                elements.btnEssayAiTrigger?.addEventListener('click', onTriggerClick);
            }
            return loadEssayAiStatus();
        }

        function dispose() {
            essayAiState.active = false;
            clearTimeout(essayAiState.pollTimer);
            essayAiState.pollTimer = null;
            essayAiState.abortController?.abort();
            essayAiState.abortController = null;
            elements.btnEssayAiPreview?.removeEventListener('click', onPreviewClick);
            elements.btnEssayAiTrigger?.removeEventListener('click', onTriggerClick);
        }

        function getEssayAiState() {
            return { ...essayAiState, pollTimer: null, abortController: null };
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
                const peak = rows.reduce((max, row) => Math.max(max, Number(row.count) || 0), 0);

                if (!peak) {
                    // Nine identical rows of "0" told an operator nothing and offered
                    // nowhere to go — and a fresh tenant sees only this.
                    elements.dashboardFunnel.innerHTML = `
        <div class="crm-empty-state">
          <p class="crm-empty-state-title">No leads in the pipeline yet</p>
          <p class="crm-muted">Stage counts appear here once enquiries are recorded.</p>
          <button type="button" class="crm-btn crm-btn-primary" data-goto-main="enquiry">Add the first lead</button>
        </div>
      `;
                } else {
                    // Proportional bars plus stage-to-stage drop-off — the information a
                    // funnel exists to carry, which a flat count list cannot.
                    elements.dashboardFunnel.innerHTML = rows.map((row, index) => {
                        const count = Number(row.count) || 0;
                        const width = peak ? Math.max((count / peak) * 100, count > 0 ? 2 : 0) : 0;
                        const prev = index > 0 ? Number(rows[index - 1].count) || 0 : null;
                        const drop = (prev && prev > 0) ? Math.round((1 - count / prev) * 100) : null;
                        const dropLine = drop === null
                            ? ''
                            : `<div class="crm-funnel-drop">${drop > 0 ? `−${drop}% from previous stage` : 'no drop-off'}</div>`;
                        return `
        <div class="crm-funnel-row">
          <div class="crm-funnel-head">
            <strong>${escapeHtml(window.CrmDashboard.formatStageLabel(row.stage))}</strong>
            <span class="crm-funnel-count">${escapeHtml(String(count))}</span>
          </div>
          <div class="crm-funnel-track">
            <div class="crm-funnel-bar" style="width: ${width.toFixed(1)}%"></div>
          </div>
          ${dropLine}
        </div>
      `;
                    }).join('');
                }
            }

            if (elements.dashboardRevenue) {
                if (!revenue.length) {
                    elements.dashboardRevenue.innerHTML = '<div class="crm-empty-state"><p class="crm-empty-state-title">No invoice activity yet</p><p class="crm-muted">Course revenue, collections and outstanding balances appear here once invoices are raised.</p></div>';
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
                    elements.dashboardDuplicates.innerHTML = '<div class="crm-empty-state"><p class="crm-empty-state-title">No duplicates found</p><p class="crm-muted">Students sharing an email or phone number are flagged here for review.</p></div>';
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
                    elements.dashboardAuditLogs.innerHTML = '<div class="crm-empty-state"><p class="crm-empty-state-title">No audit logs yet</p><p class="crm-muted">Admin changes to student, course and finance records are recorded here.</p></div>';
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
            createMergeJob,
            loadEssayAiStatus,
            startEssayAiPreview,
            triggerEssayAiBackfill,
            pollEssayAiJob,
            activate,
            dispose,
            getEssayAiState
        };
    }

    return {
        createController
    };
})();
