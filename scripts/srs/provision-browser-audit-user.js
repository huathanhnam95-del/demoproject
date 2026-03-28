const path = require('path');

const {
    createAuditUser,
    getManifestPath,
    sanitizeRunId,
    writeJson
} = require('./browser-audit-fixture-lib');

function parseArgs(argv) {
    const args = {
        runId: sanitizeRunId(new Date().toISOString()),
        manifestPath: null
    };

    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--run-id') {
            args.runId = sanitizeRunId(argv[i + 1]);
            i += 1;
            continue;
        }
        if (arg === '--manifest') {
            args.manifestPath = path.resolve(argv[i + 1]);
            i += 1;
            continue;
        }
    }

    if (!args.manifestPath) {
        args.manifestPath = getManifestPath(args.runId);
    }

    return args;
}

async function main() {
    const args = parseArgs(process.argv);
    const provisioned = await createAuditUser(args.runId);
    const manifest = {
        runId: provisioned.runId,
        createdAt: provisioned.createdAt,
        cleanupCompleted: false,
        user: {
            uid: provisioned.uid,
            email: provisioned.email,
            password: provisioned.password
        }
    };

    writeJson(args.manifestPath, manifest);
    process.stdout.write(`${JSON.stringify({ ...manifest, manifestPath: args.manifestPath }, null, 2)}\n`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
