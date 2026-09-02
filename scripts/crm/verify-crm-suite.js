const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function resolveLintBinPath() {
    const eslintName = process.platform === 'win32' ? 'eslint.cmd' : 'eslint';
    const localBin = path.join(process.cwd(), 'node_modules', '.bin');
    if (fs.existsSync(path.join(localBin, eslintName))) return localBin;

    const siblingOriginal = 'C:\\Cursor AI\\node_modules\\.bin';
    if (fs.existsSync(path.join(siblingOriginal, eslintName))) return siblingOriginal;

    return null;
}

function run(command, args, extraEnv = {}) {
    const isCmdWrapper = /\.cmd$/i.test(String(command || ''));
    const spawnCommand = isCmdWrapper ? 'powershell.exe' : command;
    const spawnArgs = isCmdWrapper
        ? ['-NoProfile', '-Command', `& '${String(command).replace(/'/g, "''")}' ${args.map((arg) => `'${String(arg).replace(/'/g, "''")}'`).join(' ')}`]
        : args;

    const result = spawnSync(spawnCommand, spawnArgs, {
        cwd: process.cwd(),
        stdio: 'inherit',
        shell: false,
        env: {
            ...process.env,
            ...extraEnv
        }
    });

    if (result.status !== 0) {
        throw new Error(`Command failed: ${command} ${args.join(' ')}`);
    }
}

function main() {
    const node = process.execPath;
    const lintBinPath = resolveLintBinPath();
    const env = lintBinPath
        ? { PATH: `${lintBinPath}${path.delimiter}${process.env.PATH || ''}` }
        : {};
    const eslintCommand = (lintBinPath
        ? path.join(lintBinPath, process.platform === 'win32' ? 'eslint.cmd' : 'eslint')
        : (process.platform === 'win32'
            ? 'C:\\Cursor AI\\node_modules\\.bin\\eslint.cmd'
            : path.join(process.cwd(), 'node_modules', '.bin', 'eslint')));

    const checks = [
        ['node', ['tests/crm/admin-router-contract.test.js']],
        ['node', ['tests/crm/accounts-role-management.test.js']],
        ['node', ['tests/crm/collection-contracts.test.js']],
        ['node', ['tests/crm/agent-source-service.test.js']],
        ['node', ['tests/crm/agent-source-workspace.test.js']],
        ['node', ['tests/crm/agent-source-route-behavior.test.js']],
        ['node', ['tests/crm/agent-course-rates-route-behavior.test.js']],
        ['node', ['tests/crm/finance-route-behavior.test.js']],
        ['node', ['tests/crm/crm-shell-static.test.js']],
        ['node', ['tests/crm/admin-scheduling-route-behavior.test.js']],
        ['node', ['tests/crm/lead-entrance-conversion-route-behavior.test.js']],
        ['node', ['tests/crm/public-entrance-test-link-retention.test.js']],
        ['node', ['tests/crm/local-admin-entrance-tests.test.js']],
        ['node', ['tests/crm/homework-service.test.js']],
        ['node', ['tests/crm/live-session-service.test.js']],
        ['node', ['tests/crm/classroom-match-service.test.js']],
        ['node', ['tests/crm/schedule-normalizer.test.js']],
        ['node', ['tests/crm/student-service.test.js']],
        ['node', ['tests/crm/recycle-bin-service.test.js']],
        ['node', ['tests/crm/course-classroom-service.test.js']],
        ['node', ['tests/crm/lead-service.test.js']],
        ['node', ['tests/crm/lead-entrance-stage-sync.test.js']],
        ['node', ['tests/crm/activity-service.test.js']],
        ['node', ['tests/crm/enrollment-attendance.test.js']],
        ['node', ['tests/crm/finance-workflow-shared.test.js']],
        ['node', ['tests/crm/finance-route-behavior.test.js']],
        ['node', ['tests/crm/finance-service.test.js']],
        ['node', ['tests/crm/finance-enrollment-handoff.test.js']],
        ['node', ['tests/crm/student-360.test.js']],
        ['node', ['tests/crm/automation-service.test.js']],
        ['node', ['tests/crm/reporting-governance.test.js']],
        ['node', ['tests/crm/pronunciation-corpus-production-route.test.js']],
        ['node', ['tests/crm/books-routes.test.js']],
        ['node', ['tests/crm/book-usage-metadata.test.js']],
        ['node', ['tests/crm/book-mind-map-citations.test.js']],
        ['node', ['tests/crm/books-download-route.test.js']],
        ['node', ['tests/crm/books-workspace.test.js']],
        ['node', ['tests/crm/books-ui-layout.test.js']],
        ['node', ['tests/browser/crm-nav-dropdown-browser-check.js']],
        ['node', ['tests/browser/crm-books-ui-browser-check.js']],
        ['node', ['tests/browser/crm-books-mind-map-browser-check.js']],
        ['node', ['tests/browser/mindmap-wheel-zoom-check.js']],
        ['node', ['tests/browser/crm-pronunciation-samples-browser-check.js']],
        ['node', ['tests/browser/crm-admin-workflow-browser-check.js']],
        ['node', ['tests/browser/crm-scheduler-browser-check.js']],
        ['node', ['tests/browser/crm-entrance-test-result-pdf-browser-check.js']],
        ['node', ['scripts/crm/migrate-courses-to-crmCourses.js', '--dry-run']],
        ['node', ['scripts/crm/export-crm-data.js', '--dry-run']],
        ['node', ['scripts/crm/import-crm-data.js', '--dry-run']],
        ['node', ['scripts/crm/smoke-student-profile.js']],
        ['node', ['scripts/crm/smoke-classroom-admin.js']],
        ['node', ['scripts/crm/smoke-homework-flow.js']],
        ['node', ['scripts/crm/smoke-live-sessions.js']],
        ['node', ['scripts/crm/smoke-lead-pipeline.js']],
        ['node', ['scripts/crm/smoke-activity-timeline.js']],
        ['node', ['scripts/crm/smoke-attendance.js']],
        ['node', ['scripts/crm/smoke-finance.js']],
        ['node', ['scripts/crm/smoke-student-360.js']],
        ['node', ['scripts/crm/smoke-communications.js']],
        ['node', ['scripts/crm/smoke-dashboard.js']],
        ['node', ['scripts/crm/backfill-schedules.js']],
        ['eslint', ['public/crm-admin.js', 'public/js/classroom-api.js', 'public/js/crm/*.js', 'functions/src/routes/admin/*.js', 'functions/src/crm/*.js', 'src/routes/admin.js', '--quiet']]
    ];

    checks.forEach(([kind, args]) => {
        if (kind === 'eslint') {
            run(eslintCommand, args, env);
            return;
        }
        run(node, args, env);
    });

    console.log('crm verification suite passed');
}

main();
