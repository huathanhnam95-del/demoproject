window.CrmStudent360 = (function () {
    function getValue(element) {
        return String(element?.value || '').trim();
    }

    function getNumberValue(element) {
        const raw = getValue(element);
        if (!raw) return null;
        const value = Number(raw);
        return Number.isFinite(value) ? value : null;
    }

    function parseDelimitedRows(value, shape) {
        return String(value || '')
            .split('\n')
            .map((row) => row.trim())
            .filter(Boolean)
            .map((row) => {
                const parts = row.split('|').map((part) => part.trim());
                const entry = {};
                shape.forEach((key, index) => {
                    entry[key] = parts[index] || null;
                });
                return entry;
            });
    }

    function buildPayload(elements) {
        return {
            targets: {
                exam: getValue(elements.inputTargetExam),
                score: getNumberValue(elements.inputTargetScore)
            },
            preferredSchedule: getValue(elements.inputPreferredSchedule),
            scoreHistory: parseDelimitedRows(getValue(elements.inputScoreHistory), ['date', 'score'])
                .map((entry) => ({ date: entry.date, score: entry.score ? Number(entry.score) : null })),
            contacts: {
                guardians: parseDelimitedRows(getValue(elements.inputGuardianContacts), ['name', 'phone', 'email']),
                companies: parseDelimitedRows(getValue(elements.inputCompanyContacts), ['name', 'email', 'phone'])
            },
            documentRefs: parseDelimitedRows(getValue(elements.inputDocumentRefs), ['name', 'storagePath']),
            counselingNotes: getValue(elements.inputCounselingNotes)
        };
    }

    function formatDelimitedRows(rows, keys) {
        return (rows || [])
            .map((row) => keys.map((key) => String(row?.[key] || '')).join('|'))
            .join('\n');
    }

    function applyToForm(elements, student) {
        if (elements.inputTargetExam) elements.inputTargetExam.value = String(student?.targets?.exam || '');
        if (elements.inputTargetScore) elements.inputTargetScore.value = student?.targets?.score ?? '';
        if (elements.inputPreferredSchedule) elements.inputPreferredSchedule.value = String(student?.preferredSchedule || '');
        if (elements.inputScoreHistory) elements.inputScoreHistory.value = formatDelimitedRows(student?.scoreHistory, ['date', 'score']);
        if (elements.inputGuardianContacts) elements.inputGuardianContacts.value = formatDelimitedRows(student?.contacts?.guardians, ['name', 'phone', 'email']);
        if (elements.inputCompanyContacts) elements.inputCompanyContacts.value = formatDelimitedRows(student?.contacts?.companies, ['name', 'email', 'phone']);
        if (elements.inputDocumentRefs) elements.inputDocumentRefs.value = formatDelimitedRows(student?.documentRefs, ['name', 'storagePath']);
        if (elements.inputCounselingNotes) elements.inputCounselingNotes.value = String(student?.counselingNotes || '');
    }

    return {
        buildPayload,
        applyToForm
    };
})();
