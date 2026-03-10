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
        ['node', ['tests/crm/collection-contracts.test.js']],
        ['node', ['tests/crm/crm-shell-static.test.js']],
        ['node', ['tests/crm/student-service.test.js']],
        ['node', ['tests/crm/course-classroom-service.test.js']],
        ['node', ['tests/crm/lead-service.test.js']],
        ['node', ['tests/crm/activity-service.test.js']],
        ['node', ['tests/crm/enrollment-attendance.test.js']],
        ['node', ['tests/crm/finance-service.test.js']],
        ['node', ['tests/crm/student-360.test.js']],
        ['node', ['tests/crm/automation-service.test.js']],
        ['node', ['tests/crm/reporting-governance.test.js']],
        ['node', ['scripts/crm/migrate-courses-to-crmCourses.js', '--dry-run']],
        ['node', ['scripts/crm/export-crm-data.js', '--dry-run']],
        ['node', ['scripts/crm/import-crm-data.js', '--dry-run']],
        ['node', ['scripts/crm/smoke-student-profile.js']],
        ['node', ['scripts/crm/smoke-classroom-admin.js']],
        ['node', ['scripts/crm/smoke-lead-pipeline.js']],
        ['node', ['scripts/crm/smoke-activity-timeline.js']],
        ['node', ['scripts/crm/smoke-attendance.js']],
        ['node', ['scripts/crm/smoke-finance.js']],
        ['node', ['scripts/crm/smoke-student-360.js']],
        ['node', ['scripts/crm/smoke-communications.js']],
        ['node', ['scripts/crm/smoke-dashboard.js']],
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
