window.CrmFinance = (function () {
    function getValue(element) {
        return String(element?.value || '').trim();
    }

    function getNumberValue(element) {
        const raw = getValue(element);
        if (!raw) return 0;
        const value = Number(raw);
        return Number.isFinite(value) ? value : 0;
    }

    function buildInvoicePayload(elements) {
        return {
            amount: getNumberValue(elements.inputInvoiceAmount),
            discountAmount: getNumberValue(elements.inputInvoiceDiscount),
            dueDate: getValue(elements.inputInvoiceDueDate)
        };
    }

    function buildPaymentPayload(elements) {
        return {
            amount: getNumberValue(elements.inputPaymentAmount),
            method: getValue(elements.inputPaymentMethod) || 'bank-transfer'
        };
    }

    function formatMoney(value) {
        return String(Number(value || 0));
    }

    return {
        buildInvoicePayload,
        buildPaymentPayload,
        formatMoney
    };
})();
