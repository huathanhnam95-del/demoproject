const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
    WORKFLOW_REVIEW_CHECKS,
    MANUAL_REVIEW_AREAS,
    buildCommandString,
    summarizeResults,
    formatMarkdownReport
} = require('./workflow-review-baseline-lib');

function resolveLintBinPath() {
    const eslintName = process.platform === 'win32' ? 'eslint.cmd' : 'eslint';
    const localBin = path.join(process.cwd(), 'node_modules', '.bin');
    if (fs.existsSync(path.join(localBin, eslintName))) return localBin;

    const siblingOriginal = 'C:\\Cursor AI\\node_modules\\.bin';
    if (fs.existsSync(path.join(siblingOriginal, eslintName))) return siblingOriginal;

    return null;
}

function resolveExecutable(check) {
    if (check.runner !== 'eslint') {
        return {
            command: process.execPath,
            args: check.args || []
        };
    }

    const eslintName = process.platform === 'win32' ? 'eslint.cmd' : 'eslint';
    const lintBinPath = resolveLintBinPath();
    return {
        command: lintBinPath
            ? path.join(lintBinPath, eslintName)
            : (process.platform === 'win32'
                ? 'C:\\Cursor AI\\node_modules\\.bin\\eslint.cmd'
                : path.join(process.cwd(), 'node_modules', '.bin', 'eslint')),
        args: check.args || []
    };
}

function runCheck(check) {
    const executable = resolveExecutable(check);
    const isCmdWrapper = /\.cmd$/i.test(String(executable.command || ''));
    const command = isCmdWrapper ? 'powershell.exe' : executable.command;
    const args = isCmdWrapper
        ? ['-NoProfile', '-Command', `& '${String(executable.command).replace(/'/g, "''")}' ${executable.args.map((arg) => `'${String(arg).replace(/'/g, "''")}'`).join(' ')}`]
        : executable.args;

    const result = spawnSync(command, args, {
        cwd: process.cwd(),
        shell: false,
        encoding: 'utf8'
    });

    return {
        ...check,
        command: buildCommandString(check),
        exitCode: Number.isInteger(result.status) ? result.status : 1,
        stdout: result.stdout || '',
        stderr: result.stderr || ''
    };
}

function main() {
    const wantsJson = process.argv.includes('--json');
    const results = WORKFLOW_REVIEW_CHECKS.map(runCheck);
    const summary = summarizeResults(results);

    if (wantsJson) {
        process.stdout.write(JSON.stringify({
            generatedAt: new Date().toISOString(),
            summary,
            results,
            manualAreas: MANUAL_REVIEW_AREAS
        }, null, 2));
    } else {
        process.stdout.write(formatMarkdownReport({
            generatedAt: new Date().toISOString(),
            summary,
            results,
            manualAreas: MANUAL_REVIEW_AREAS
        }));
    }

    process.exit(summary.totals.failed > 0 ? 1 : 0);
}

if (require.main === module) {
    main();
}
