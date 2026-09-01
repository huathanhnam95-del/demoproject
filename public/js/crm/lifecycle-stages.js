/**
 * lifecycle-stages.js — the single source of truth for CRM lead lifecycle stages.
 *
 * The dashboard funnel and the Enquiry board previously each carried their own list:
 * js/crm/dashboard.js had nine stages ending in `converted`, js/crm/leads.js had eight
 * and dropped it. Two views of the same pipeline disagreed about what the pipeline is.
 * Both now read from here.
 *
 * `converted` is a terminal outcome rather than a working stage, so the Enquiry board —
 * which exists to move leads along — omits it while the funnel, which reports on
 * outcomes, includes it. That distinction is now explicit instead of accidental.
 */
window.CrmLifecycleStages = (function () {
    const WORKING_STAGES = Object.freeze([
        'new',
        'contacted',
        'test_scheduled',
        'test_completed',
        'counseling',
        'trial',
        'won',
        'lost'
    ]);

    const TERMINAL_STAGES = Object.freeze(['converted']);

    const ALL_STAGES = Object.freeze([...WORKING_STAGES, ...TERMINAL_STAGES]);

    /** Stages a lead can be moved between on the Enquiry board. */
    function getWorkingStages() {
        return WORKING_STAGES.slice();
    }

    /** Every stage the funnel reports on, in pipeline order. */
    function getFunnelOrder() {
        return ALL_STAGES.slice();
    }

    function formatStageLabel(value) {
        return String(value || '')
            .split('_')
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ') || 'Unknown';
    }

    return {
        getWorkingStages,
        getFunnelOrder,
        formatStageLabel,
        WORKING_STAGES,
        TERMINAL_STAGES,
        ALL_STAGES
    };
})();
