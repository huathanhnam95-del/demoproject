const path = require('path');

const {
    destroyAuditUser,
    getManifestPath,
    readJson,
    sanitizeRunId,
    writeJson
} = require('./browser-audit-fixture-lib');

function parseArgs(argv) {
    const args = {
        runId: null,
        uid: null,
        manifestPath: null
    };

    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--run-id') {
            args.runId = sanitizeRunId(argv[i + 1]);
            i += 1;
            continue;
        }
        if (arg === '--uid') {
            args.uid = String(argv[i + 1] || '').trim();
            i += 1;
            continue;
        }
        if (arg === '--manifest') {
            args.manifestPath = path.resolve(argv[i + 1]);
            i += 1;
            continue;
        }
    }

    if (!args.manifestPath && args.runId) {
        args.manifestPath = getManifestPath(args.runId);
    }

    return args;
}

async function main() {
    const args = parseArgs(process.argv);
    let manifest = null;
    let manifestPath = args.manifestPath;

    if (manifestPath && !args.uid) {
        manifest = readJson(manifestPath);
        args.uid = String(manifest?.user?.uid || '').trim();
    }

    if (!manifestPath && args.runId) {
        manifestPath = getManifestPath(args.runId);
    }

    if (!args.uid) {
        throw new Error('cleanup-browser-audit-user requires --uid or --manifest');
    }

    await destroyAuditUser(args.uid);

    if (manifestPath) {
        const nextManifest = {
            ...(manifest || (fsExists(manifestPath) ? readJson(manifestPath) : {})),
            cleanupCompleted: true,
            cleanupCompletedAt: new Date().toISOString()
        };
        writeJson(manifestPath, nextManifest);
    }

    process.stdout.write(`${JSON.stringify({ uid: args.uid, cleanupCompleted: true, manifestPath }, null, 2)}\n`);
}

function fsExists(filePath) {
    try {
        return require('fs').existsSync(filePath);
    } catch {
        return false;
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
