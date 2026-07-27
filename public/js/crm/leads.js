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

    function getListValue(element) {
        const raw = getValue(element);
        if (!raw) return [];
        return raw
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean);
    }

    function buildPayload(elements) {
        const facebook = getValue(elements.inputLeadFacebook || elements.inputLeadFacebookDisplayName);
        return {
            name: getValue(elements.inputLeadName),
            label: getValue(elements.inputLeadLabel),
            email: getValue(elements.inputLeadEmail),
            phone: getValue(elements.inputLeadPhone),
            zalo: getValue(elements.inputLeadZalo),
            facebook: facebook || null,
            facebookDisplayName: facebook || null,
            facebookProfileUrl: getValue(elements.inputLeadFacebookProfileUrl) || null,
            facebookPersonalOwner: getValue(elements.inputLeadFacebookPersonalOwner) || null,
            realName: getValue(elements.inputLeadRealName) || null,
            dateOfBirth: getValue(elements.inputLeadDateOfBirth) || null,
            learningNeeds: getValue(elements.inputLeadLearningNeeds) || null,
            preferredLearningDays: getListValue(elements.inputLeadPreferredLearningDays),
            preferredLearningHours: getListValue(elements.inputLeadPreferredLearningHours),
            messengerThreadUrl: getValue(elements.inputLeadMessengerThreadUrl) || null,
            messengerLastContactAt: getValue(elements.inputLeadMessengerLastContactAt) || null,
            messengerStatus: getValue(elements.inputLeadMessengerStatus) || null,
            source: getValue(elements.inputLeadSource),
            agentSourceId: getValue(elements.inputLeadAgentSource),
            stage: getValue(elements.inputLeadStage) || 'new',
            probability: getNumberValue(elements.inputLeadProbability)
        };
    }

    function buildStudentPayloadFromLead(lead) {
        const preferredDays = Array.isArray(lead?.preferredLearningDays) ? lead.preferredLearningDays : [];
        const preferredHours = Array.isArray(lead?.preferredLearningHours) ? lead.preferredLearningHours : [];
        const preferredScheduleParts = [];
        if (preferredDays.length) preferredScheduleParts.push(`Days: ${preferredDays.join(', ')}`);
        if (preferredHours.length) preferredScheduleParts.push(`Hours: ${preferredHours.join(', ')}`);

        const notesParts = [
            String(lead?.learningNeeds || '').trim(),
            String(lead?.dateOfBirth || '').trim() ? `DOB: ${String(lead.dateOfBirth).trim()}` : null,
            String(lead?.facebookProfileUrl || '').trim() ? `Facebook URL: ${String(lead.facebookProfileUrl).trim()}` : null,
            String(lead?.notes || '').trim()
        ].filter(Boolean);

        const counselingParts = [
            String(lead?.messengerStatus || '').trim() ? `Messenger: ${String(lead.messengerStatus).trim()}` : null,
            String(lead?.messengerLastContactAt || '').trim() ? `Last contact: ${String(lead.messengerLastContactAt).trim()}` : null,
            String(lead?.messengerThreadUrl || '').trim() ? `Thread: ${String(lead.messengerThreadUrl).trim()}` : null
        ].filter(Boolean);

        const name = String(lead?.realName || lead?.name || lead?.facebookDisplayName || lead?.facebook || lead?.facebookProfileUrl || '').trim();
        const facebook = String(lead?.facebookDisplayName || lead?.facebook || lead?.facebookProfileUrl || '').trim();

        return {
            name,
            label: String(lead?.label || lead?.facebookDisplayName || '').trim(),
            phone: String(lead?.phone || '').trim(),
            email: String(lead?.email || '').trim(),
            zalo: String(lead?.zalo || '').trim(),
            facebook,
            acquisitionSource: String(lead?.source || '').trim(),
            agentSourceId: String(lead?.agentSourceId || '').trim(),
            lifecycleStage: 'potential',
            notes: notesParts.join(' | '),
            preferredSchedule: preferredScheduleParts.join(' | '),
            counselingNotes: counselingParts.join(' | ')
        };
    }

    function hasAnyContact(payload) {
        return [
            payload?.name,
            payload?.email,
            payload?.phone,
            payload?.facebook,
            payload?.facebookDisplayName,
            payload?.facebookProfileUrl
        ].some(Boolean);
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

    function isConvertedLead(lead) {
        return String(lead?.stage || '').trim() === 'converted' || !!lead?.studentId;
    }

    function getSelectableStages(currentStage) {
        const normalized = String(currentStage || '').trim();
        if (normalized && !STAGES.includes(normalized)) {
            return [...STAGES, normalized];
        }
        return [...STAGES];
    }

    return {
        STAGES,
        buildPayload,
        buildStudentPayloadFromLead,
        formatStageLabel,
        getSelectableStages,
        hasAnyContact,
        isConvertedLead,
        summarize
    };
})();
