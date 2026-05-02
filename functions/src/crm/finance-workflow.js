function normalizeAmount(value) {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? amount : 0;
}

function deriveFinanceWorkflowState({ invoices, enrollments, matches }) {
    const invoiceList = Array.isArray(invoices) ? invoices : [];
    const enrollmentList = Array.isArray(enrollments) ? enrollments : [];
    const matchList = Array.isArray(matches) ? matches : [];
    const activeEnrollment = enrollmentList.find((row) => String(row?.status || '') === 'active') || null;
    const outstandingInvoices = invoiceList.filter((row) => normalizeAmount(row?.outstandingAmount) > 0);
    const settledInvoices = invoiceList.filter((row) => String(row?.status || '') === 'paid' || normalizeAmount(row?.outstandingAmount) === 0);
    const recommendedMatch = matchList.find((row) => !!row?.recommended) || matchList[0] || null;

    if (activeEnrollment) {
        return {
            nextAction: 'start_attendance',
            requiresPayment: false,
            primaryClassroomId: activeEnrollment?.classId || recommendedMatch?.classroomId || null,
            activeEnrollmentId: activeEnrollment?.enrollmentId || null,
            message: 'Student already has an active enrollment. Move into attendance and live class operations.'
        };
    }

    if (outstandingInvoices.length > 0 || invoiceList.length === 0) {
        return {
            nextAction: 'collect_payment',
            requiresPayment: true,
            primaryClassroomId: recommendedMatch?.classroomId || null,
            activeEnrollmentId: activeEnrollment?.enrollmentId || null,
            message: invoiceList.length
                ? 'Record payment confirmation before assigning the student to a classroom.'
                : 'Create an invoice and confirm payment before classroom assignment.'
        };
    }

    if (settledInvoices.length > 0 && matchList.length > 1) {
        return {
            nextAction: 'select_classroom',
            requiresPayment: false,
            primaryClassroomId: recommendedMatch?.classroomId || null,
            activeEnrollmentId: null,
            message: 'Payment is confirmed. Choose the best classroom before creating the enrollment.'
        };
    }

    return {
        nextAction: 'assign_classroom',
        requiresPayment: false,
        primaryClassroomId: recommendedMatch?.classroomId || null,
        activeEnrollmentId: null,
        message: recommendedMatch
            ? 'Payment is confirmed. Create the enrollment for the recommended classroom.'
            : 'Payment is confirmed. Pick a classroom, then create the enrollment.'
    };
}

module.exports = {
    deriveFinanceWorkflowState
};

