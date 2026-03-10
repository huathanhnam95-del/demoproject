window.CrmCommunications = (function () {
    function getValue(element) {
        return String(element?.value || '').trim();
    }

    function buildTemplatePayload(elements) {
        return {
            name: getValue(elements.inputTemplateName),
            channel: getValue(elements.inputTemplateChannel),
            subject: getValue(elements.inputTemplateSubject),
            body: getValue(elements.inputTemplateBody)
        };
    }

    function buildRulePayload(elements) {
        return {
            name: getValue(elements.inputRuleName),
            triggerType: getValue(elements.inputRuleTriggerType),
            templateId: getValue(elements.inputRuleTemplateId)
        };
    }

    function formatQueueStatus(value) {
        const normalized = String(value || '').trim().toLowerCase();
        if (!normalized) return 'Pending';
        return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }

    return {
        buildTemplatePayload,
        buildRulePayload,
        formatQueueStatus
    };
})();
