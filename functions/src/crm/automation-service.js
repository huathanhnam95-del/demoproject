const AUTOMATION_TRIGGER_TYPES = [
    'overdue_next_action',
    'upcoming_test_result_due',
    'unpaid_invoice',
    'attendance_intervention'
];

function cleanOptionalString(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function normalizeTriggerType(value) {
    const normalized = cleanOptionalString(value);
    if (!AUTOMATION_TRIGGER_TYPES.includes(normalized)) {
        throw new Error(`Invalid automation trigger type: ${normalized}`);
    }
    return normalized;
}

function buildTemplateCreateData(input, context = {}) {
    const name = cleanOptionalString(input?.name);
    const channel = cleanOptionalString(input?.channel);
    const subject = cleanOptionalString(input?.subject);
    const body = cleanOptionalString(input?.body);
    if (!name || !channel || !subject || !body) {
        throw new Error('Template requires name, channel, subject, and body.');
    }
    return {
        name,
        channel,
        subject,
        body,
        createdAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        createdBy: context.user?.uid || null,
        createdByEmail: context.user?.email || null
    };
}

function buildAutomationRuleCreateData(input, context = {}) {
    const name = cleanOptionalString(input?.name);
    const templateId = cleanOptionalString(input?.templateId);
    if (!name || !templateId || !cleanOptionalString(input?.triggerType)) {
        throw new Error('Automation rule requires name, triggerType, and templateId.');
    }
    const triggerType = normalizeTriggerType(input?.triggerType);
    return {
        name,
        triggerType,
        templateId,
        active: input?.active !== false,
        createdAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        createdBy: context.user?.uid || null,
        createdByEmail: context.user?.email || null
    };
}

function generateQueueEntries({ rule, template, targets, existingKeys }, context = {}) {
    const existing = existingKeys instanceof Set ? existingKeys : new Set();
    return (targets || [])
        .filter((target) => target?.dedupeKey && !existing.has(target.dedupeKey))
        .map((target) => ({
            ruleId: rule.ruleId || null,
            templateId: template.templateId || null,
            studentId: target.studentId || null,
            leadId: target.leadId || null,
            channel: template.channel,
            subject: template.subject,
            body: template.body,
            dedupeKey: target.dedupeKey,
            payload: target.payload || {},
            status: 'pending',
            createdAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
            createdBy: context.user?.uid || 'system'
        }));
}

function markQueueEntryStatus(entry, update, context = {}) {
    return {
        ...entry,
        status: cleanOptionalString(update?.status) || entry.status || 'pending',
        errorMessage: cleanOptionalString(update?.errorMessage),
        processedAt: context.serverTimestamp ? context.serverTimestamp() : new Date(),
        processedBy: context.user?.uid || 'system'
    };
}

function evaluateRuleTargets({ rule, datasets, now = new Date() }) {
    const leads = Array.isArray(datasets?.leads) ? datasets.leads : [];
    const students = Array.isArray(datasets?.students) ? datasets.students : [];
    const invoices = Array.isArray(datasets?.invoices) ? datasets.invoices : [];
    const attendance = Array.isArray(datasets?.attendance) ? datasets.attendance : [];
    const nowTime = now.getTime();
    const in3Days = nowTime + (3 * 24 * 60 * 60 * 1000);

    switch (rule.triggerType) {
        case 'overdue_next_action':
            return leads
                .filter((lead) => lead.nextActionAt && new Date(lead.nextActionAt).getTime() < nowTime)
                .map((lead) => ({
                    studentId: lead.studentId || null,
                    leadId: lead.leadId || null,
                    dedupeKey: `${rule.ruleId}:${lead.leadId || lead.studentId}:overdue-next-action`,
                    payload: { email: lead.email || null }
                }));
        case 'upcoming_test_result_due':
            return students
                .filter((student) => {
                    const due = student.learningProfile?.testResultDueDate;
                    if (!due) return false;
                    const time = new Date(due).getTime();
                    return time >= nowTime && time <= in3Days;
                })
                .map((student) => ({
                    studentId: student.studentId,
                    dedupeKey: `${rule.ruleId}:${student.studentId}:test-result-due`,
                    payload: { email: student.email || null }
                }));
        case 'unpaid_invoice':
            return invoices
                .filter((invoice) => Number(invoice.outstandingAmount || 0) > 0)
                .map((invoice) => ({
                    studentId: invoice.studentId,
                    dedupeKey: `${rule.ruleId}:${invoice.invoiceId}:unpaid-invoice`,
                    payload: { invoiceId: invoice.invoiceId }
                }));
        case 'attendance_intervention':
            return attendance
                .filter((row) => row.atRisk?.isAtRisk)
                .map((row) => ({
                    studentId: row.studentId,
                    dedupeKey: `${rule.ruleId}:${row.studentId}:attendance-risk`,
                    payload: { reasons: row.atRisk.reasons }
                }));
        default:
            return [];
    }
}

module.exports = {
    AUTOMATION_TRIGGER_TYPES,
    buildTemplateCreateData,
    buildAutomationRuleCreateData,
    generateQueueEntries,
    markQueueEntryStatus,
    evaluateRuleTargets
};
