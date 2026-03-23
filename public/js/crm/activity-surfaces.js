window.CrmActivitySurfaces = (function () {
    function createController(deps = {}) {
        const {
            elements,
            createTaskForLead,
            createActivityForLead,
            createTaskForStudent,
            createActivityForStudent,
            createInvoiceForStudent,
            recordPaymentForStudent,
            createCommunicationTemplate,
            createAutomationRule,
            createMergeJob,
            showToast
        } = deps;

        function bindClick(button, handler, errorMessage) {
            if (!button) return;
            button.addEventListener('click', () => {
                handler().catch((error) => {
                    console.error(errorMessage, error);
                    showToast(error?.message || 'Action failed.', 'error');
                });
            });
        }

        function setupActivitySurfaces() {
            bindClick(elements.btnSaveLeadTask, createTaskForLead, '[CRM Admin] Save lead task failed:');
            bindClick(elements.btnSaveLeadActivity, createActivityForLead, '[CRM Admin] Save lead activity failed:');
            bindClick(elements.btnSaveStudentTask, createTaskForStudent, '[CRM Admin] Save student task failed:');
            bindClick(elements.btnSaveStudentActivity, createActivityForStudent, '[CRM Admin] Save student activity failed:');
            bindClick(elements.btnCreateStudentInvoice, createInvoiceForStudent, '[CRM Admin] Create student invoice failed:');
            bindClick(elements.btnRecordStudentPayment, recordPaymentForStudent, '[CRM Admin] Record student payment failed:');
            bindClick(elements.btnCreateTemplate, createCommunicationTemplate, '[CRM Admin] Create template failed:');
            bindClick(elements.btnCreateRule, createAutomationRule, '[CRM Admin] Create automation rule failed:');
            bindClick(elements.btnCreateMergeJob, createMergeJob, '[CRM Admin] Create merge job failed:');
        }

        return {
            setupActivitySurfaces
        };
    }

    return {
        createController
    };
})();
