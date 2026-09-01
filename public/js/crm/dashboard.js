window.CrmDashboard = (function () {
    function toPercent(value) {
        const normalized = Number(value);
        if (!Number.isFinite(normalized)) return '0%';
        return `${Math.round(normalized * 100)}%`;
    }

    function toMoney(value) {
        const normalized = Number(value);
        if (!Number.isFinite(normalized)) return '0';
        return normalized.toLocaleString('en-US');
    }

    function buildSummaryCards(summary) {
        const safe = summary && typeof summary === 'object' ? summary : {};
        return [
            {
                key: 'conversion',
                label: 'Conversion Rate',
                value: toPercent(safe.funnelConversionRate),
                footnote: `${Number(safe.sourceRoiCount || 0)} tracked sources`
            },
            {
                key: 'counselors',
                label: 'Active Owners',
                value: String(Number(safe.counselorProductivityCount || 0)),
                footnote: 'Counselors with assigned students'
            },
            {
                key: 'classes',
                label: 'Class Fill Rate',
                value: toPercent(safe.classFillRate),
                footnote: 'Active enrollments across classrooms'
            },
            {
                key: 'risk',
                label: 'Attendance Risk',
                value: String(Number(safe.attendanceRiskCount || 0)),
                footnote: 'Students flagged for intervention'
            },
            {
                key: 'collected',
                label: 'Collected Revenue',
                value: toMoney(safe.totalRevenueCollected),
                footnote: 'Payments recorded in CRM'
            },
            {
                key: 'outstanding',
                label: 'Outstanding Balance',
                value: toMoney(safe.totalOutstandingBalance),
                footnote: 'Unpaid invoice amount'
            }
        ];
    }

    // Shared with the Enquiry board — see js/crm/lifecycle-stages.js. The literal is kept
    // only as a fallback for contexts that load this module standalone (browser tests).
    function getFunnelOrder() {
        return window.CrmLifecycleStages
            ? window.CrmLifecycleStages.getFunnelOrder()
            : ['new', 'contacted', 'test_scheduled', 'test_completed', 'counseling', 'trial', 'won', 'lost', 'converted'];
    }

    function buildFunnelRows(funnel) {
        const safe = funnel && typeof funnel === 'object' ? funnel : {};
        const seen = new Set();
        const rows = [];

        getFunnelOrder().forEach((stage) => {
            rows.push({ stage, count: Number(safe[stage] || 0) });
            seen.add(stage);
        });

        Object.keys(safe).forEach((stage) => {
            if (!seen.has(stage)) {
                rows.push({ stage, count: Number(safe[stage] || 0) });
            }
        });

        return rows;
    }

    function formatStageLabel(value) {
        return String(value || '')
            .split('_')
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ') || 'Unknown';
    }

    return {
        buildSummaryCards,
        buildFunnelRows,
        formatStageLabel,
        toMoney,
        toPercent
    };
})();
