window.CrmGovernance = (function () {
    function getValue(element) {
        return String(element?.value || '').trim();
    }

    function buildMergeJobPayload(elements) {
        const primaryStudentId = getValue(elements.inputMergePrimaryStudentId);
        const duplicateStudentIds = getValue(elements.inputMergeDuplicateStudentIds)
            .split(/[\n,]+/)
            .map((value) => value.trim())
            .filter(Boolean);

        return {
            primaryStudentId,
            duplicateStudentIds
        };
    }

    function formatDuplicateGroup(group) {
        const kind = String(group?.kind || 'match').trim();
        const key = String(group?.key || '').trim();
        const ids = Array.isArray(group?.studentIds) ? group.studentIds : [];
        return {
            title: `${kind.toUpperCase()} match`,
            subtitle: key || 'No key',
            detail: ids.join(', ')
        };
    }

    function formatAuditAction(action) {
        return String(action || '')
            .split('.')
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ') || 'Unknown';
    }

    return {
        buildMergeJobPayload,
        formatDuplicateGroup,
        formatAuditAction
    };
})();
