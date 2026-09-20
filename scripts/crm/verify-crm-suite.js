const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const selection = require('./verification-selection.cjs');

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

function buildLegacyChecks() {
    return [
        ['node', ['tests/crm/projects/v2-entry.test.js']],
        ['node', ['tests/crm/projects/v2-shell.test.js']],
        ['node', ['tests/crm/projects/v2-columns.test.js']],
        ['node', ['tests/crm/projects/v2-row-editors.test.js']],
        ['node', ['tests/crm/projects/v2-quick-create.test.js']],
        ['node', ['tests/crm/projects/v2-task-detail.test.js']],
        ['node', ['tests/crm/projects/v2-views-navigation.test.js']],
        ['node', ['tests/crm/projects/v2-automations.test.js']],
        ['node', ['tests/crm/projects/v2-mobile-accessibility.test.js']],
        ['node', ['tests/crm/projects/v2-performance-reconciliation.test.js']],
        ['node', ['tests/crm/projects/v2-rollout-readiness.test.js']],
        ['node', ['tests/crm/projects/field-save-feedback.test.js']],
        ['node', ['tests/crm/projects/board-local-save-lineage.test.js']],
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
        ['node', ['tests/crm/enrollment-1on1-scheduling.test.js']],
        ['node', ['tests/crm/student-route-deep-link.test.js']],
        ['node', ['tests/crm/scheduling-service.test.js']],
        ['node', ['tests/crm/scheduling-operation-service.test.js']],
        ['node', ['tests/crm/classroom-api-operation-id.test.js']],
        ['node', ['tests/crm/teacher-scheduler-router-contract.test.js']],
        ['node', ['tests/crm/teacher-scheduler-behavior.test.js']],
        ['node', ['tests/crm/teacher-scheduler-series-route.test.js']],
        ['node', ['tests/crm/teacher-scheduler-client-controller.test.js']],
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
        ['node', ['tests/crm/teaching-session-service.test.js']],
        ['node', ['tests/crm/teaching-sessions-frontend-contract.test.js']],
        ['node', ['tests/browser/crm-nav-dropdown-browser-check.js']],
        ['node', ['tests/browser/crm-books-ui-browser-check.js']],
        ['node', ['tests/browser/crm-books-mind-map-browser-check.js']],
        ['node', ['tests/browser/mindmap-wheel-zoom-check.js']],
        ['node', ['tests/browser/crm-pronunciation-samples-browser-check.js']],
        ['node', ['tests/browser/crm-admin-workflow-browser-check.js']],
        ['node', ['tests/browser/crm-scheduler-browser-check.js']],
        ['node', ['tests/browser/crm-entrance-test-result-pdf-browser-check.js']],
        ['node', ['tests/browser/crm-teaching-session-mindmap-browser-check.js']],
        ['node', ['tests/browser/crm-teaching-session-pdf-browser-check.js']],
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
        ['eslint', ['public/crm-admin.js', 'public/js/classroom-api.js', 'public/js/crm/**/*.{js,cjs,mjs}', 'functions/src/routes/admin/**/*.{js,cjs,mjs}', 'functions/src/crm/**/*.{js,cjs,mjs}', 'functions/src/routes/crm/**/*.{js,cjs,mjs}', 'services/crm-voice-relay/**/*.{js,cjs,mjs}', 'src/routes/admin.js', '--quiet']]
    ];

}

const ORIGINAL_CHECKS = buildLegacyChecks();

function lintCheck() {
    return ORIGINAL_CHECKS.find(([kind]) => kind === 'eslint');
}

function normalizeSelection(result) {
    if (!result || result.ok !== true) {
        const errors = result && (result.errors || result.diagnostics);
        throw new Error((errors || [{ message: 'CRM verification selection is invalid' }]).map((item) => item.message || String(item)).join('; '));
    }
    return result;
}

function composeChecks(options = {}) {
    const root = path.resolve(options.root || process.cwd());
    const registryPath = options.registryPath;
    const selected = normalizeSelection(options.selection || selection.selectUnitTests({ root, registryPath }));
    const legacyNodeTests = new Set(ORIGINAL_CHECKS.filter(([kind]) => kind === 'node').flatMap(([, args]) => args.filter((arg) => /\.test\.(?:js|cjs|mjs)$/i.test(arg))));
    const duplicates = selected.unitTests.filter((testPath) => legacyNodeTests.has(testPath));
    if (duplicates.length) throw new Error(`registered unit test is already in the CRM suite; remove the duplicate registration: ${duplicates.join(', ')}`);
    const unitChecks = selected.unitTests.map((testPath) => ['node', [testPath]]);
    if (options.lintOnly) return [lintCheck()];
    return [...unitChecks, ...ORIGINAL_CHECKS];
}

function listChecks(checks) {
    return checks.map(([kind, args]) => ({ kind, command: kind === 'node' ? 'node' : 'eslint', args: [...args] }));
}

function executeChecks(checks, options = {}) {
    let executor = options.executor;
    if (!executor) {
        const node = options.node || process.execPath;
        const lintBinPath = resolveLintBinPath();
        const env = lintBinPath
            ? { PATH: `${lintBinPath}${path.delimiter}${process.env.PATH || ''}` }
            : {};
        const eslintCommand = (lintBinPath
            ? path.join(lintBinPath, process.platform === 'win32' ? 'eslint.cmd' : 'eslint')
            : (process.platform === 'win32'
                ? 'C:\\Cursor AI\\node_modules\\.bin\\eslint.cmd'
                : path.join(process.cwd(), 'node_modules', '.bin', 'eslint')));
        executor = (kind, args) => run(kind === 'eslint' ? eslintCommand : node, args, env);
    }
    for (const [kind, args] of checks) {
        const result = executor(kind, [...args]);
        if ((typeof result === 'number' && result !== 0) || (result && typeof result.status === 'number' && result.status !== 0)) {
            throw new Error(`Command failed: ${kind} ${args.join(' ')}`);
        }
    }
}

function runChecks(optionsOrChecks, maybeOptions = {}) {
    if (Array.isArray(optionsOrChecks)) return executeChecks(optionsOrChecks, maybeOptions);
    const options = optionsOrChecks || {};
    return executeChecks(options.checks || [], options);
}

function parseArgs(argv) {
    const result = { list: false, lint: false };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--list') result.list = true;
        else if (arg === '--lint') result.lint = true;
        else if (arg === '--root' || arg === '--registry') {
            if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) throw new Error(`${arg} requires a value`);
            result[arg.slice(2)] = argv[++index];
        } else throw new Error(`unknown argument: ${arg}`);
    }
    return result;
}

function main(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    if (!args.list && (args.root || args.registry)) throw new Error('--root and --registry are available only with --list');
    const root = path.resolve(args.root || process.cwd());
    const selected = normalizeSelection(selection.selectUnitTests({ root, registryPath: args.registry }));
    const checks = composeChecks({ root, selection: selected, lintOnly: args.lint });
    if (args.list) {
        process.stdout.write(`${JSON.stringify({ checks: listChecks(checks), unitTests: selected.unitTests }, null, 2)}\n`);
        return;
    }
    runChecks({ checks });
    console.log(args.lint ? 'CRM lint passed' : 'crm verification suite passed');
}

module.exports = {
    ORIGINAL_CHECKS,
    buildLegacyChecks,
    composeChecks,
    listChecks,
    executeChecks,
    runChecks,
    parseArgs,
    main
};

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
