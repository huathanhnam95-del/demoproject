window.CrmStudents = (function () {
    const preEnrollmentStages = new Set([
        'potential',
        'test_scheduled',
        'test_completed',
        'counseling',
        'trial'
    ]);

    const enrolledStages = new Set([
        'enrolled',
        'paused',
        'completed',
        'alumni'
    ]);

    function getValue(element) {
        return String(element?.value || '').trim();
    }

    function getNumberValue(element) {
        const raw = getValue(element);
        if (!raw) return null;
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
    }

    function isLikelyFacebookUrl(value) {
        const text = getValue({ value });
        return /^https?:\/\//i.test(text) && /facebook\.com/i.test(text);
    }

    function buildPayload(elements) {
        return {
            name: getValue(elements.inputStudentName),
            label: getValue(elements.inputStudentLabel),
            phone: getValue(elements.inputStudentPhone),
            email: getValue(elements.inputStudentEmail),
            zalo: getValue(elements.inputStudentZalo),
            facebook: getValue(elements.inputStudentFacebook),
            facebookProfileUrl: getValue(elements.inputStudentFacebookProfileUrl),
            acquisitionSource: getValue(elements.inputStudentAcquisitionSource),
            agentSourceId: getValue(elements.inputStudentAgentSource),
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
            }
        };
    }

    function hasAnyInfoField(payload) {
        return [payload.name, payload.label, payload.phone, payload.email, payload.zalo, payload.facebook, payload.facebookProfileUrl].some(Boolean);
    }

    function syncScoreInput(element, options = {}) {
        if (!element) return;

        const raw = getValue(element);
        const digitsOnly = raw.replace(/\D+/g, '');
        const digitCount = digitsOnly.length || (raw ? raw.length : 0);

        element.dataset.scoreState = raw ? 'value' : 'empty';
        element.dataset.scoreDigits = String(digitCount);
        element.placeholder = options.emptyLabel || '';
    }

    function syncScoreDecorations(elements) {
        syncScoreInput(elements.inputScoreOverall, { emptyLabel: 'N/A' });
        syncScoreInput(elements.inputScoreListening);
        syncScoreInput(elements.inputScoreReading);
        syncScoreInput(elements.inputScoreSpeaking);
        syncScoreInput(elements.inputScoreWriting);
    }

    function applyToForm(elements, student) {
        const learning = student?.learningProfile || {};
        if (elements.inputStudentName) elements.inputStudentName.value = String(student?.name || '');
        if (elements.inputStudentLabel) elements.inputStudentLabel.value = String(student?.label || '');
        if (elements.inputStudentPhone) elements.inputStudentPhone.value = String(student?.phone || '');
        if (elements.inputStudentEmail) elements.inputStudentEmail.value = String(student?.email || '');
        if (elements.inputStudentZalo) elements.inputStudentZalo.value = String(student?.zalo || '');
        if (elements.inputStudentFacebook) {
            const facebookName = isLikelyFacebookUrl(student?.facebook) ? '' : String(student?.facebook || '');
            elements.inputStudentFacebook.value = facebookName;
        }
        if (elements.inputStudentFacebookProfileUrl) {
            const facebookLink = String(student?.facebookProfileUrl || (isLikelyFacebookUrl(student?.facebook) ? student.facebook : '') || '');
            elements.inputStudentFacebookProfileUrl.value = facebookLink;
        }
        if (elements.inputStudentAcquisitionSource) elements.inputStudentAcquisitionSource.value = String(student?.acquisitionSource || '');
        if (elements.inputStudentAgentSource) elements.inputStudentAgentSource.value = String(student?.agentSourceId || '');
        if (elements.inputScoreOverall) elements.inputScoreOverall.value = learning.overall ?? '';
        if (elements.inputScoreListening) elements.inputScoreListening.value = learning.listening ?? '';
        if (elements.inputScoreReading) elements.inputScoreReading.value = learning.reading ?? '';
        if (elements.inputScoreSpeaking) elements.inputScoreSpeaking.value = learning.speaking ?? '';
        if (elements.inputScoreWriting) elements.inputScoreWriting.value = learning.writing ?? '';
        if (elements.inputStudentDueDate) elements.inputStudentDueDate.value = String(learning.testResultDueDate || '');
        if (elements.inputStudentLevel) elements.inputStudentLevel.value = String(learning.entryLevel || '');
        if (elements.inputVisaType) elements.inputVisaType.value = String(learning.visaType || '');
        if (elements.inputTargetLevel) elements.inputTargetLevel.value = String(learning.targetLevel || '');
        syncScoreDecorations(elements);
    }

    function classify(student) {
        const stage = String(student?.lifecycleStage || 'potential').trim().toLowerCase() || 'potential';
        if (enrolledStages.has(stage)) return 'studentData';
        if (preEnrollmentStages.has(stage)) return 'potential';
        return 'potential';
    }

    function splitStudents(students) {
        const buckets = {
            potential: [],
            studentData: []
        };

        for (const student of students || []) {
            const key = classify(student);
            buckets[key].push(student);
        }

        return buckets;
    }

    return {
        applyToForm,
        buildPayload,
        classify,
        hasAnyInfoField,
        syncScoreDecorations,
        splitStudents
    };
})();
