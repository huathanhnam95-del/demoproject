const WORKFLOW_REVIEW_CHECKS = [
    {
        id: 'admin-router-contract',
        label: 'Admin router contract',
        reviewArea: 'cross-cutting-contracts',
        runner: 'node',
        args: ['tests/crm/admin-router-contract.test.js']
    },
    {
        id: 'collection-contracts',
        label: 'Collection contracts',
        reviewArea: 'cross-cutting-contracts',
        runner: 'node',
        args: ['tests/crm/collection-contracts.test.js']
    },
    {
        id: 'crm-shell-static',
        label: 'CRM shell static contract',
        reviewArea: 'cross-cutting-contracts',
        runner: 'node',
        args: ['tests/crm/crm-shell-static.test.js']
    },
    {
        id: 'student-service',
        label: 'Student service',
        reviewArea: 'student-profile-and-identity',
        runner: 'node',
        args: ['tests/crm/student-service.test.js']
    },
    {
        id: 'course-classroom-service',
        label: 'Course and classroom service',
        reviewArea: 'classroom-and-schedule',
        runner: 'node',
        args: ['tests/crm/course-classroom-service.test.js']
    },
    {
        id: 'lead-service',
        label: 'Lead service',
        reviewArea: 'lead-and-conversion',
        runner: 'node',
        args: ['tests/crm/lead-service.test.js']
    },
    {
        id: 'activity-service',
        label: 'Activity service',
        reviewArea: 'lead-and-conversion',
        runner: 'node',
        args: ['tests/crm/activity-service.test.js']
    },
    {
        id: 'enrollment-attendance',
        label: 'Enrollment and attendance service',
        reviewArea: 'attendance-and-delivery',
        runner: 'node',
        args: ['tests/crm/enrollment-attendance.test.js']
    },
    {
        id: 'finance-service',
        label: 'Finance service',
        reviewArea: 'finance-and-reporting',
        runner: 'node',
        args: ['tests/crm/finance-service.test.js']
    },
    {
        id: 'student-360',
        label: 'Student 360 service',
        reviewArea: 'student-profile-and-identity',
        runner: 'node',
        args: ['tests/crm/student-360.test.js']
    },
    {
        id: 'automation-service',
        label: 'Automation service',
        reviewArea: 'communications-and-governance',
        runner: 'node',
        args: ['tests/crm/automation-service.test.js']
    },
    {
        id: 'reporting-governance',
        label: 'Reporting and governance service',
        reviewArea: 'finance-and-reporting',
        runner: 'node',
        args: ['tests/crm/reporting-governance.test.js']
    },
    {
        id: 'migrate-courses-dry-run',
        label: 'Course migration dry run',
        reviewArea: 'cross-cutting-contracts',
        runner: 'node',
        args: ['scripts/crm/migrate-courses-to-crmCourses.js', '--dry-run']
    },
    {
        id: 'export-crm-dry-run',
        label: 'CRM export dry run',
        reviewArea: 'cross-cutting-contracts',
        runner: 'node',
        args: ['scripts/crm/export-crm-data.js', '--dry-run']
    },
    {
        id: 'import-crm-dry-run',
        label: 'CRM import dry run',
        reviewArea: 'cross-cutting-contracts',
        runner: 'node',
        args: ['scripts/crm/import-crm-data.js', '--dry-run']
    },
    {
        id: 'smoke-student-profile',
        label: 'Student profile smoke',
        reviewArea: 'student-profile-and-identity',
        runner: 'node',
        args: ['scripts/crm/smoke-student-profile.js']
    },
    {
        id: 'smoke-classroom-admin',
        label: 'Classroom admin smoke',
        reviewArea: 'classroom-and-schedule',
        runner: 'node',
        args: ['scripts/crm/smoke-classroom-admin.js']
    },
    {
        id: 'smoke-lead-pipeline',
        label: 'Lead pipeline smoke',
        reviewArea: 'lead-and-conversion',
        runner: 'node',
        args: ['scripts/crm/smoke-lead-pipeline.js']
    },
    {
        id: 'smoke-activity-timeline',
        label: 'Activity timeline smoke',
        reviewArea: 'lead-and-conversion',
        runner: 'node',
        args: ['scripts/crm/smoke-activity-timeline.js']
    },
    {
        id: 'smoke-attendance',
        label: 'Attendance smoke',
        reviewArea: 'attendance-and-delivery',
        runner: 'node',
        args: ['scripts/crm/smoke-attendance.js']
    },
    {
        id: 'smoke-finance',
        label: 'Finance smoke',
        reviewArea: 'finance-and-reporting',
        runner: 'node',
        args: ['scripts/crm/smoke-finance.js']
    },
    {
        id: 'smoke-student-360',
        label: 'Student 360 smoke',
        reviewArea: 'student-profile-and-identity',
        runner: 'node',
        args: ['scripts/crm/smoke-student-360.js']
    },
    {
        id: 'smoke-communications',
        label: 'Communications smoke',
        reviewArea: 'communications-and-governance',
        runner: 'node',
        args: ['scripts/crm/smoke-communications.js']
    },
    {
        id: 'smoke-dashboard',
        label: 'Dashboard smoke',
        reviewArea: 'finance-and-reporting',
        runner: 'node',
        args: ['scripts/crm/smoke-dashboard.js']
    },
    {
        id: 'crm-eslint',
        label: 'CRM lint',
        reviewArea: 'cross-cutting-contracts',
        runner: 'eslint',
        args: [
            'public/crm-admin.js',
            'public/js/classroom-api.js',
            'public/js/crm/*.js',
            'functions/src/routes/admin/*.js',
            'functions/src/crm/*.js',
            'src/routes/admin.js',
            '--quiet'
        ]
    }
];

const MANUAL_REVIEW_AREAS = [
    {
        area: 'facebook-messenger-intake-context',
        reason: 'Facebook/Messenger conversation state is not modeled beyond lead source/contact fields and must be reviewed operationally.'
    },
    {
        area: 'class-hosting-live-delivery',
        reason: 'The product supports schedule and attendance, but no built-in live-class hosting, meeting links, or teacher join/start flow.'
    },
    {
        area: 'homework-return-revision',
        reason: 'Returned homework, revision feedback, and resubmission are not implemented end to end in the shipped UI flow.'
    },
    {
        area: 'student-classroom-access-consistency',
        reason: 'Student classroom loading and submission flows contain transitional inconsistencies that need explicit manual review.'
    }
];

function buildCommandString(check) {
    return [check.runner === 'eslint' ? 'eslint' : 'node', ...(check.args || [])].join(' ');
}

function summarizeResults(results) {
    const summary = {
        totals: {
            total: 0,
            passed: 0,
            failed: 0
        },
        byArea: {}
    };

    for (const result of results || []) {
        const area = result.reviewArea || 'uncategorized';
        if (!summary.byArea[area]) {
            summary.byArea[area] = {
                total: 0,
                passed: 0,
                failed: 0
            };
        }

        summary.totals.total += 1;
        summary.byArea[area].total += 1;

        if (Number(result.exitCode) === 0) {
            summary.totals.passed += 1;
            summary.byArea[area].passed += 1;
        } else {
            summary.totals.failed += 1;
            summary.byArea[area].failed += 1;
        }
    }

    return summary;
}

function formatMarkdownReport({ generatedAt, summary, results, manualAreas }) {
    const lines = [
        '# CRM Workflow Review Baseline',
        '',
        `Generated at: ${generatedAt || new Date().toISOString()}`,
        '',
        '## Automated Coverage Summary',
        '',
        `- Total checks: ${summary.totals.total}`,
        `- Passed: ${summary.totals.passed}`,
        `- Failed: ${summary.totals.failed}`,
        '',
        '## Coverage By Review Area',
        '',
        '| Review Area | Total | Passed | Failed |',
        '| --- | ---: | ---: | ---: |'
    ];

    Object.keys(summary.byArea)
        .sort()
        .forEach((area) => {
            const row = summary.byArea[area];
            lines.push(`| ${area} | ${row.total} | ${row.passed} | ${row.failed} |`);
        });

    lines.push('', '## Check Results', '', '| Check | Review Area | Status | Command |', '| --- | --- | --- | --- |');

    for (const result of results || []) {
        lines.push(`| ${result.label} | ${result.reviewArea} | ${Number(result.exitCode) === 0 ? 'PASS' : 'FAIL'} | \`${result.command}\` |`);
    }

    lines.push('', '## Manual Review Areas', '');
    for (const area of manualAreas || []) {
        lines.push(`- ${area.area}: ${area.reason}`);
    }

    return `${lines.join('\n')}\n`;
}

module.exports = {
    WORKFLOW_REVIEW_CHECKS,
    MANUAL_REVIEW_AREAS,
    buildCommandString,
    summarizeResults,
    formatMarkdownReport
};
