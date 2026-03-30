window.CrmFinance = (function () {
    const SUPPORTED_CURRENCIES = ['VND', 'AUD', 'USD'];
    const DEFAULT_CURRENCY = 'VND';

    function getValue(element) {
        return String(element?.value || '').trim();
    }

    function getNumberValue(element) {
        const raw = getValue(element);
        if (!raw) return 0;
        const value = Number(raw.replace(/,/g, ''));
        return Number.isFinite(value) ? value : 0;
    }

    function normalizeCurrency(value) {
        const normalized = String(value || '').trim().toUpperCase();
        return SUPPORTED_CURRENCIES.includes(normalized) ? normalized : DEFAULT_CURRENCY;
    }

    function currencyDecimals(currency) {
        return normalizeCurrency(currency) === 'VND' ? 0 : 2;
    }

    function formatMoney(value, currency = DEFAULT_CURRENCY) {
        const normalizedCurrency = normalizeCurrency(currency);
        const decimals = currencyDecimals(normalizedCurrency);
        const amount = Number(value || 0);
        const safeAmount = Number.isFinite(amount) ? amount : 0;
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        }).format(safeAmount);
    }

    function normalizeMoneyText(value, currency = DEFAULT_CURRENCY) {
        const normalizedCurrency = normalizeCurrency(currency);
        const decimals = currencyDecimals(normalizedCurrency);
        const cleaned = String(value || '')
            .replace(/,/g, '')
            .replace(/[^\d.]/g, '');
        if (!cleaned) return '';
        const parts = cleaned.split('.');
        const whole = parts.shift() || '';
        const fraction = parts.join('');
        const safeWhole = whole.replace(/\D/g, '') || '0';
        if (decimals === 0) return safeWhole;
        return fraction ? `${safeWhole}.${fraction.replace(/\D/g, '').slice(0, decimals)}` : safeWhole;
    }

    function bindMoneyInput(input, currencyElement, options = {}) {
        if (!input) return () => {};
        const relatedInputs = Array.isArray(options.relatedInputs) ? options.relatedInputs.filter(Boolean) : [];

        const formatCurrentValue = () => {
            const currency = normalizeCurrency(currencyElement?.value || options.currency || DEFAULT_CURRENCY);
            const normalized = normalizeMoneyText(input.value, currency);
            if (!normalized) {
                input.value = '';
                return;
            }
            const numeric = Number(normalized);
            if (!Number.isFinite(numeric)) {
                input.value = '';
                return;
            }
            input.value = formatMoney(numeric, currency);
            relatedInputs.forEach((relatedInput) => {
                if (!relatedInput || relatedInput === input) return;
                const relatedNormalized = normalizeMoneyText(relatedInput.value, currency);
                if (!relatedNormalized) {
                    relatedInput.value = '';
                    return;
                }
                const relatedNumeric = Number(relatedNormalized);
                relatedInput.value = Number.isFinite(relatedNumeric) ? formatMoney(relatedNumeric, currency) : '';
            });
            if (typeof options.onChange === 'function') {
                options.onChange(numeric, currency);
            }
        };

        const onInput = () => {
            formatCurrentValue();
        };
        const onBlur = () => {
            formatCurrentValue();
        };
        input.addEventListener('input', onInput);
        input.addEventListener('blur', onBlur);
        if (currencyElement) {
            currencyElement.addEventListener('change', onBlur);
        }

        return () => {
            input.removeEventListener('input', onInput);
            input.removeEventListener('blur', onBlur);
            if (currencyElement) {
                currencyElement.removeEventListener('change', onBlur);
            }
        };
    }

    function buildInvoicePayload(elements) {
        const currency = normalizeCurrency(elements.selectInvoiceCurrency?.value || DEFAULT_CURRENCY);
        return {
            amount: getNumberValue(elements.inputInvoiceAmount),
            discountAmount: getNumberValue(elements.inputInvoiceDiscount),
            dueDate: getValue(elements.inputInvoiceDueDate),
            currency
        };
    }

    function buildPaymentPayload(elements) {
        const currency = normalizeCurrency(elements.selectPaymentCurrency?.value || DEFAULT_CURRENCY);
        return {
            amount: getNumberValue(elements.inputPaymentAmount),
            method: getValue(elements.inputPaymentMethod) || 'bank-transfer',
            currency
        };
    }

    function deriveWorkflowState(payload) {
        const workflow = window.CrmFinanceWorkflow;
        if (!workflow || typeof workflow.deriveFinanceWorkflowState !== 'function') {
            throw new Error('Finance workflow helpers are not available.');
        }
        return workflow.deriveFinanceWorkflowState(payload || {});
    }

    return {
        buildInvoicePayload,
        buildPaymentPayload,
        formatMoney,
        normalizeCurrency,
        normalizeMoneyText,
        bindMoneyInput,
        deriveWorkflowState
    };
})();
