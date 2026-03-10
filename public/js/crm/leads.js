window.CrmLeads = (function () {
    const STAGES = [
        'new',
        'contacted',
        'test_scheduled',
        'test_completed',
        'counseling',
        'trial',
        'won',
        'lost'
    ];

    function getValue(element) {
        return String(element?.value || '').trim();
    }

    function getNumberValue(element) {
        const raw = getValue(element);
        if (!raw) return null;
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
    }

    function buildPayload(elements) {
        return {
            name: getValue(elements.inputLeadName),
            email: getValue(elements.inputLeadEmail),
            phone: getValue(elements.inputLeadPhone),
            source: getValue(elements.inputLeadSource),
            stage: getValue(elements.inputLeadStage) || 'new',
            probability: getNumberValue(elements.inputLeadProbability)
        };
    }

    function formatStageLabel(stage) {
        return String(stage || '')
            .split('_')
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    }

    function summarize(leads) {
        const counts = {};
        STAGES.forEach((stage) => {
            counts[stage] = 0;
        });

        (leads || []).forEach((lead) => {
            const stage = String(lead?.stage || 'new').trim();
            if (Object.prototype.hasOwnProperty.call(counts, stage)) {
                counts[stage] += 1;
            }
        });

        return counts;
    }

    return {
        STAGES,
        buildPayload,
        formatStageLabel,
        summarize
    };
})();
