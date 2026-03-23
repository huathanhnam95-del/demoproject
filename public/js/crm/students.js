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

    function buildPayload(elements) {
        return {
            name: getValue(elements.inputStudentName),
            label: getValue(elements.inputStudentLabel),
            phone: getValue(elements.inputStudentPhone),
            email: getValue(elements.inputStudentEmail),
            zalo: getValue(elements.inputStudentZalo),
            facebook: getValue(elements.inputStudentFacebook),
            acquisitionSource: getValue(elements.inputStudentAcquisitionSource),
            learningProfile: {
                overall: getNumberValue(elements.inputScoreOverall),
                listening: getNumberValue(elements.inputScoreListening),
                reading: getNumberValue(elements.inputScoreReading),
                speaking: getNumberValue(elements.inputScoreSpeaking),
                writing: getNumberValue(elements.inputScoreWriting),
                entryLevel: getValue(elements.inputStudentLevel),
                testResultDueDate: getValue(elements.inputStudentDueDate)
            }
        };
    }

    function hasAnyInfoField(payload) {
        return [payload.name, payload.label, payload.phone, payload.email, payload.zalo, payload.facebook].some(Boolean);
    }

    function applyToForm(elements, student) {
        const learning = student?.learningProfile || {};
        if (elements.inputStudentName) elements.inputStudentName.value = String(student?.name || '');
        if (elements.inputStudentLabel) elements.inputStudentLabel.value = String(student?.label || '');
        if (elements.inputStudentPhone) elements.inputStudentPhone.value = String(student?.phone || '');
        if (elements.inputStudentEmail) elements.inputStudentEmail.value = String(student?.email || '');
        if (elements.inputStudentZalo) elements.inputStudentZalo.value = String(student?.zalo || '');
        if (elements.inputStudentFacebook) elements.inputStudentFacebook.value = String(student?.facebook || '');
        if (elements.inputStudentAcquisitionSource) elements.inputStudentAcquisitionSource.value = String(student?.acquisitionSource || '');
        if (elements.inputScoreOverall) elements.inputScoreOverall.value = learning.overall ?? '';
        if (elements.inputScoreListening) elements.inputScoreListening.value = learning.listening ?? '';
        if (elements.inputScoreReading) elements.inputScoreReading.value = learning.reading ?? '';
        if (elements.inputScoreSpeaking) elements.inputScoreSpeaking.value = learning.speaking ?? '';
        if (elements.inputScoreWriting) elements.inputScoreWriting.value = learning.writing ?? '';
        if (elements.inputStudentDueDate) elements.inputStudentDueDate.value = String(learning.testResultDueDate || '');
        if (elements.inputStudentLevel) elements.inputStudentLevel.value = String(learning.entryLevel || '');
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
        splitStudents
    };
})();
