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
        const facebook = getValue(elements.inputLeadFacebook || elements.inputLeadFacebookDisplayName || elements.inputStudentFacebook);
        const name = getValue(elements.inputLeadName || elements.inputStudentName);
        const label = getValue(elements.inputLeadLabel || elements.inputStudentLabel);
        const email = getValue(elements.inputLeadEmail || elements.inputStudentEmail);
        const phone = getValue(elements.inputLeadPhone || elements.inputStudentPhone);
        const zalo = getValue(elements.inputLeadZalo || elements.inputStudentZalo);
        const facebookProfileUrl = getValue(elements.inputLeadFacebookProfileUrl || elements.inputStudentFacebookProfileUrl);
        const facebookPersonalOwner = getValue(elements.inputLeadFacebookPersonalOwner || elements.inputStudentFacebookPersonalOwner);
        const source = getValue(elements.inputLeadSource || elements.inputStudentAcquisitionSource);
        const agentSourceId = getValue(elements.inputLeadAgentSource || elements.inputStudentAgentSource);
        const stage = getValue(elements.inputLeadStage || elements.inputStudentStage) || 'new';
        const probability = getNumberValue(elements.inputLeadProbability || elements.inputStudentProbability);

        return {
            name,
            label,
            email,
            phone,
            zalo,
            facebook: facebook || null,
            facebookDisplayName: facebook || null,
            facebookProfileUrl: facebookProfileUrl || null,
            facebookPersonalOwner: facebookPersonalOwner || null,
            realName: getValue(elements.inputLeadRealName) || null,
            dateOfBirth: getValue(elements.inputLeadDateOfBirth) || null,
            learningNeeds: getValue(elements.inputLeadLearningNeeds) || null,
            preferredLearningDays: getListValue(elements.inputLeadPreferredLearningDays),
            preferredLearningHours: getListValue(elements.inputLeadPreferredLearningHours),
            messengerThreadUrl: getValue(elements.inputLeadMessengerThreadUrl) || null,
            messengerLastContactAt: getValue(elements.inputLeadMessengerLastContactAt) || null,
            messengerStatus: getValue(elements.inputLeadMessengerStatus) || null,
            source,
            agentSourceId,
            stage,
            probability,
            learningProfile: {
                overall: getNumberValue(elements.inputScoreOverall),
                listening: getNumberValue(elements.inputScoreListening),
                reading: getNumberValue(elements.inputScoreReading),
                speaking: getNumberValue(elements.inputScoreSpeaking),
                writing: getNumberValue(elements.inputScoreWriting),
                entryLevel: getValue(elements.inputStudentLevel),
                testResultDueDate: getValue(elements.inputStudentDueDate),
                visaType: getValue(elements.inputVisaType),
                targetLevel: getValue(elements.inputTargetLevel)
            },
            targets: {
                exam: getValue(elements.inputTargetExam),
                score: getNumberValue(elements.inputTargetScore)
            }
        };
    }

    function applyToForm(elements, lead) {
        const learning = lead?.learningProfile || {};
        const targets = lead?.targets || {};
        const targetInputName = elements.inputLeadName || elements.inputStudentName;
        const targetInputLabel = elements.inputLeadLabel || elements.inputStudentLabel;
        const targetInputPhone = elements.inputLeadPhone || elements.inputStudentPhone;
        const targetInputEmail = elements.inputLeadEmail || elements.inputStudentEmail;
        const targetInputZalo = elements.inputLeadZalo || elements.inputStudentZalo;
        const targetInputFacebook = elements.inputLeadFacebook || elements.inputStudentFacebook;
        const targetInputFacebookProfileUrl = elements.inputLeadFacebookProfileUrl || elements.inputStudentFacebookProfileUrl;
        const targetInputFacebookPersonalOwner = elements.inputLeadFacebookPersonalOwner || elements.inputStudentFacebookPersonalOwner;
        const targetInputSource = elements.inputLeadSource || elements.inputStudentAcquisitionSource;
        const targetInputAgentSource = elements.inputLeadAgentSource || elements.inputStudentAgentSource;
        const targetInputStage = elements.inputLeadStage || elements.inputStudentStage;
        const targetInputProbability = elements.inputLeadProbability || elements.inputStudentProbability;

        if (targetInputName) targetInputName.value = String(lead?.name || '');
        if (targetInputLabel) targetInputLabel.value = String(lead?.label || '');
        if (targetInputPhone) targetInputPhone.value = String(lead?.phone || '');
        if (targetInputEmail) targetInputEmail.value = String(lead?.email || '');
        if (targetInputZalo) targetInputZalo.value = String(lead?.zalo || '');
        if (targetInputFacebook) targetInputFacebook.value = String(lead?.facebook || '');
        if (targetInputFacebookProfileUrl) targetInputFacebookProfileUrl.value = String(lead?.facebookProfileUrl || '');
        if (targetInputFacebookPersonalOwner) targetInputFacebookPersonalOwner.value = String(lead?.facebookPersonalOwner || 'Nam');
        if (targetInputSource) targetInputSource.value = String(lead?.source || 'Facebook - Personal');
        if (targetInputAgentSource) targetInputAgentSource.value = String(lead?.agentSourceId || '');
        if (targetInputStage) targetInputStage.value = String(lead?.stage || 'new');
        if (targetInputProbability) targetInputProbability.value = lead?.probability ?? '';

        if (window.updateStudentSourceVisibility) window.updateStudentSourceVisibility();
        if (window.updateLeadSourceVisibility) window.updateLeadSourceVisibility();

        if (elements.inputScoreOverall) elements.inputScoreOverall.value = learning.overall ?? '';
        if (elements.inputScoreListening) elements.inputScoreListening.value = learning.listening ?? '';
        if (elements.inputScoreReading) elements.inputScoreReading.value = learning.reading ?? '';
        if (elements.inputScoreSpeaking) elements.inputScoreSpeaking.value = learning.speaking ?? '';
        if (elements.inputScoreWriting) elements.inputScoreWriting.value = learning.writing ?? '';
        if (elements.inputStudentDueDate) elements.inputStudentDueDate.value = String(learning.testResultDueDate || '');
        if (elements.inputStudentLevel) elements.inputStudentLevel.value = String(learning.entryLevel || '');
        if (elements.inputVisaType) elements.inputVisaType.value = String(learning.visaType || '');
        if (elements.inputTargetLevel) elements.inputTargetLevel.value = String(learning.targetLevel || '');
        if (elements.inputTargetExam) elements.inputTargetExam.value = String(targets.exam || '');
        if (elements.inputTargetScore) elements.inputTargetScore.value = targets.score ?? '';
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
            facebookPersonalOwner: String(lead?.facebookPersonalOwner || 'Nam').trim(),
            acquisitionSource: String(lead?.source || '').trim(),
            agentSourceId: String(lead?.agentSourceId || '').trim(),
            lifecycleStage: 'potential',
            learningProfile: lead?.learningProfile || null,
            targets: lead?.targets || null,
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
        applyToForm,
        buildPayload,
        buildStudentPayloadFromLead,
        formatStageLabel,
        getSelectableStages,
        hasAnyContact,
        isConvertedLead,
        summarize
    };
})();
