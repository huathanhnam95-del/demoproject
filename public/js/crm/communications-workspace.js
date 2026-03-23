window.CrmCommunicationsWorkspace = (function () {
    function createController(deps = {}) {
        const {
            elements,
            showToast,
            apiFetchJson,
            refreshDashboard,
            escapeHtml
        } = deps;

        async function refreshCommunicationsManager() {
            if (!window.CrmCommunications || !elements.automationList) return;

            const [templatesJson, automationsJson] = await Promise.all([
                apiFetchJson('/api/admin/templates', { method: 'GET' }),
                apiFetchJson('/api/admin/automations', { method: 'GET' })
            ]);

            const templates = Array.isArray(templatesJson.templates) ? templatesJson.templates : [];
            const rules = Array.isArray(automationsJson.rules) ? automationsJson.rules : [];
            const queue = Array.isArray(automationsJson.queue) ? automationsJson.queue : [];

            if (elements.inputRuleTemplateId) {
                const current = String(elements.inputRuleTemplateId.value || '').trim();
                elements.inputRuleTemplateId.innerHTML = '<option value="">Select a template...</option>' + templates.map((template) => `
        <option value="${escapeHtml(template.templateId || '')}">${escapeHtml(template.name || template.templateId || 'Template')}</option>
      `).join('');
                if (current) {
                    elements.inputRuleTemplateId.value = current;
                }
            }

            if (!rules.length) {
                elements.automationList.innerHTML = '<div class="crm-muted">No automations yet.</div>';
                return;
            }

            elements.automationList.innerHTML = rules.map((rule) => {
                const relatedQueue = queue.filter((entry) => String(entry.ruleId || '') === String(rule.ruleId || ''));
                return `
        <div class="crm-task-item">
          <div class="crm-task-head">
            <strong>${escapeHtml(rule.name || 'Rule')}</strong>
            <span class="crm-task-priority medium">${escapeHtml(rule.triggerType || '')}</span>
          </div>
          <div class="crm-timeline-meta">${escapeHtml(`Queue entries: ${relatedQueue.length}`)}</div>
          <div class="crm-task-actions">
            <button type="button" class="crm-btn-secondary btn-run-automation" data-rule-id="${escapeHtml(rule.ruleId || '')}">Run Now</button>
          </div>
          ${relatedQueue.length ? `<div class="crm-timeline-meta" style="margin-top:8px;">${escapeHtml(relatedQueue.slice(0, 3).map((entry) => window.CrmCommunications.formatQueueStatus(entry.status)).join(', '))}</div>` : ''}
        </div>
      `;
            }).join('');

            Array.from(elements.automationList.querySelectorAll('.btn-run-automation')).forEach((button) => {
                button.addEventListener('click', async () => {
                    const ruleId = String(button.dataset.ruleId || '').trim();
                    try {
                        button.disabled = true;
                        await apiFetchJson(`/api/admin/automations/${encodeURIComponent(ruleId)}/run-now`, {
                            method: 'POST'
                        });
                        await refreshCommunicationsManager();
                        showToast('Automation queued.', 'success');
                    } catch (error) {
                        console.error('[CRM Admin] Run automation failed:', error);
                        showToast(error?.message || 'Failed to run automation.', 'error');
                        button.disabled = false;
                    }
                });
            });
        }

        async function createCommunicationTemplate() {
            if (!window.CrmCommunications || typeof window.CrmCommunications.buildTemplatePayload !== 'function') {
                throw new Error('Communication helpers are not available.');
            }

            const payload = window.CrmCommunications.buildTemplatePayload({
                inputTemplateName: elements.inputTemplateName,
                inputTemplateChannel: elements.inputTemplateChannel,
                inputTemplateSubject: elements.inputTemplateSubject,
                inputTemplateBody: elements.inputTemplateBody
            });

            await apiFetchJson('/api/admin/templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (elements.inputTemplateName) elements.inputTemplateName.value = '';
            if (elements.inputTemplateSubject) elements.inputTemplateSubject.value = '';
            if (elements.inputTemplateBody) elements.inputTemplateBody.value = '';
            await refreshCommunicationsManager();
            showToast('Template created.', 'success');
        }

        async function createAutomationRule() {
            if (!window.CrmCommunications || typeof window.CrmCommunications.buildRulePayload !== 'function') {
                throw new Error('Communication helpers are not available.');
            }

            const payload = window.CrmCommunications.buildRulePayload({
                inputRuleName: elements.inputRuleName,
                inputRuleTriggerType: elements.inputRuleTriggerType,
                inputRuleTemplateId: elements.inputRuleTemplateId
            });

            await apiFetchJson('/api/admin/automations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (elements.inputRuleName) elements.inputRuleName.value = '';
            await refreshCommunicationsManager();
            await refreshDashboard();
            showToast('Automation rule created.', 'success');
        }

        return {
            refreshCommunicationsManager,
            createCommunicationTemplate,
            createAutomationRule
        };
    }

    return {
        createController
    };
})();
