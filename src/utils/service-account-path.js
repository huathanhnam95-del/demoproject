const fs = require('fs');
const path = require('path');

function resolveServiceAccountPath(startDir = process.cwd()) {
    let currentDir = path.resolve(startDir);
    const seen = new Set();

    while (!seen.has(currentDir)) {
        seen.add(currentDir);
        const candidate = path.join(currentDir, 'serviceAccountKey.json');
        if (fs.existsSync(candidate)) {
            return candidate;
        }

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            break;
        }
        currentDir = parentDir;
    }

    return null;
}

module.exports = { resolveServiceAccountPath };
