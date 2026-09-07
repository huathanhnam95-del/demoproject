'use strict';

const fs = require('fs');
const path = require('path');

const CRM_SOURCE_ROOTS = Object.freeze([
    'public/js/crm',
    'functions/src/routes/admin',
    'functions/src/crm'
]);
const TEST_ROOT_PREFIX = 'tests/crm/';
const UNIT_TEST_PATTERN = /\.test\.(?:js|cjs|mjs)$/i;
const REGISTRY_PATH = 'scripts/crm/verification-selection.json';

function diagnostic(code, target, message) {
    return { code, path: target || '', message };
}

function normalizeRepoPath(value) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error('repository path must be a nonempty string');
    }
    if (value.includes('\0')) throw new Error(`repository path contains NUL: ${value}`);
    if (value.includes('\\')) throw new Error(`repository path must use POSIX separators: ${value}`);
    if (value.startsWith('/') || value.startsWith('//') || /^[A-Za-z]:/.test(value)) {
        throw new Error(`repository path must be relative: ${value}`);
    }
    const parts = value.split('/');
    if (parts.some((part) => part === '' || part === '.' || part === '..')) {
        throw new Error(`repository path contains an invalid segment: ${value}`);
    }
    if (path.posix.normalize(value) !== value) throw new Error(`repository path is not normalized: ${value}`);
    return value;
}

function isInside(relativePath, parentPath) {
    return relativePath === parentPath || relativePath.startsWith(`${parentPath}/`);
}

function rootPath(root, relativePath) {
    const normalizedRoot = path.resolve(root || process.cwd());
    const relative = normalizeRepoPath(relativePath);
    const absolute = path.resolve(normalizedRoot, ...relative.split('/'));
    const relativeBack = path.relative(normalizedRoot, absolute);
    if (relativeBack === '..' || relativeBack.startsWith(`..${path.sep}`) || path.isAbsolute(relativeBack)) {
        throw new Error(`repository path escapes root: ${relativePath}`);
    }
    return absolute;
}

function assertRealPathInside(root, absolute, relative, requireExists = true) {
    const rootReal = fs.realpathSync.native(path.resolve(root));
    let current = path.resolve(root);
    for (const segment of relative.split('/')) {
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch (error) {
            throw new Error(`cannot inspect path component ${current}: ${error.message}`);
        }
        const exact = entries.find((entry) => entry.name === segment);
        if (!exact) {
            const folded = entries.find((entry) => entry.name.toLocaleLowerCase() === segment.toLocaleLowerCase());
            if (folded) throw new Error(`path case does not match filesystem: ${relative}`);
            if (requireExists) throw new Error(`path does not exist: ${relative}`);
            break;
        }
        current = path.join(current, exact.name);
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink() || (typeof stat.isJunction === 'function' && stat.isJunction())) {
            throw new Error(`symlink or junction is not allowed: ${relative}`);
        }
        const real = fs.realpathSync.native(current);
        const back = path.relative(rootReal, real);
        if (back === '..' || back.startsWith(`..${path.sep}`) || path.isAbsolute(back)) {
            throw new Error(`path resolves outside repository: ${relative}`);
        }
    }
    if (requireExists && !fs.existsSync(absolute)) throw new Error(`path does not exist: ${relative}`);
    return absolute;
}

function resolveRepoPath(root, relativePath, options = {}) {
    const absolute = rootPath(root, relativePath);
    return assertRealPathInside(root, absolute, relativePath, options.requireExists !== false);
}

function comparePath(a, b) {
    return String(a || '').localeCompare(String(b || ''), 'en', { numeric: false, sensitivity: 'variant' });
}

function inventoryUnitTests(testRoot, options = {}) {
    const root = path.resolve(options.root || process.cwd());
    const relativeRoot = normalizeRepoPath(testRoot);
    const absoluteRoot = resolveRepoPath(root, relativeRoot);
    if (!fs.statSync(absoluteRoot).isDirectory()) throw new Error(`testRoot must be a directory: ${relativeRoot}`);
    const found = [];
    function visit(directory, relativeDirectory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => comparePath(left.name, right.name))) {
            const child = path.join(directory, entry.name);
            const relative = `${relativeDirectory}/${entry.name}`.replaceAll(path.sep, '/');
            const stat = fs.lstatSync(child);
            if (stat.isSymbolicLink() || (typeof stat.isJunction === 'function' && stat.isJunction())) {
                throw new Error(`symlink or junction is not allowed: ${relative}`);
            }
            assertRealPathInside(root, child, relative, true);
            if (stat.isDirectory()) visit(child, relative);
            else if (stat.isFile() && UNIT_TEST_PATTERN.test(relative)) found.push(relative);
        }
    }
    visit(absoluteRoot, relativeRoot);
    return found.sort(comparePath);
}

function exactKeys(value, expected, label, errors) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(diagnostic('REGISTRY.TYPE', label, `${label} must be an object`));
        return;
    }
    const expectedSet = new Set(expected);
    for (const key of Object.keys(value)) if (!expectedSet.has(key)) errors.push(diagnostic('REGISTRY.UNKNOWN_FIELD', label, `unknown field ${key}`));
    for (const key of expected) if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(diagnostic('REGISTRY.MISSING_FIELD', label, `missing field ${key}`));
}

function checkFeatureRoot(root, relativePath, errors) {
    try {
        const normalized = normalizeRepoPath(relativePath);
        if (!CRM_SOURCE_ROOTS.some((allowed) => isInside(normalized, allowed))) {
            errors.push(diagnostic('REGISTRY.SOURCE_ROOT', normalized, 'sourceRoot must be within an approved CRM lint root'));
            return null;
        }
        const absolute = resolveRepoPath(root, normalized);
        if (!fs.statSync(absolute).isDirectory()) errors.push(diagnostic('REGISTRY.SOURCE_ROOT_TYPE', normalized, 'sourceRoot must be a directory'));
        return normalized;
    } catch (error) {
        errors.push(diagnostic('REGISTRY.SOURCE_ROOT', String(relativePath), error.message));
        return null;
    }
}

function validateRegistry(registry, options = {}) {
    const root = path.resolve(options.root || process.cwd());
    const errors = [];
    exactKeys(registry, ['schemaVersion', 'features'], 'registry', errors);
    if (!registry || registry.schemaVersion !== 1) errors.push(diagnostic('REGISTRY.SCHEMA_VERSION', 'schemaVersion', 'schemaVersion must equal 1'));
    if (!registry || !Array.isArray(registry.features)) {
        errors.push(diagnostic('REGISTRY.FEATURES', 'features', 'features must be an array'));
        return { ok: false, errors, diagnostics: errors, features: [], unitTests: [] };
    }

    const features = [];
    const ids = new Set();
    const testRoots = [];
    for (let index = 0; index < registry.features.length; index += 1) {
        const feature = registry.features[index];
        const label = `features[${index}]`;
        exactKeys(feature, ['id', 'sourceRoots', 'testRoot', 'unitTests'], label, errors);
        if (!feature || typeof feature !== 'object' || Array.isArray(feature)) continue;
        if (typeof feature.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(feature.id)) {
            errors.push(diagnostic('REGISTRY.ID', `${label}.id`, 'id must be a stable alphanumeric, dot, underscore or hyphen name'));
        } else if (ids.has(feature.id)) errors.push(diagnostic('REGISTRY.DUPLICATE_ID', `${label}.id`, `duplicate feature id: ${feature.id}`));
        else ids.add(feature.id);

        const sourceRoots = [];
        if (!Array.isArray(feature.sourceRoots) || feature.sourceRoots.length === 0) errors.push(diagnostic('REGISTRY.SOURCE_ROOTS', `${label}.sourceRoots`, 'sourceRoots must be a nonempty array'));
        else {
            const seenRoots = new Set();
            for (const value of feature.sourceRoots) {
                const normalized = checkFeatureRoot(root, value, errors);
                if (normalized && seenRoots.has(normalized)) errors.push(diagnostic('REGISTRY.DUPLICATE_SOURCE_ROOT', normalized, 'sourceRoot is duplicated'));
                if (normalized) { seenRoots.add(normalized); sourceRoots.push(normalized); }
            }
        }

        let testRoot = null;
        try {
            testRoot = normalizeRepoPath(feature.testRoot);
            if (!testRoot.startsWith(TEST_ROOT_PREFIX) || !testRoot.slice(TEST_ROOT_PREFIX.length)) {
                errors.push(diagnostic('REGISTRY.TEST_ROOT', testRoot, 'testRoot must be a dedicated subfolder under tests/crm'));
            } else {
                const absolute = resolveRepoPath(root, testRoot);
                if (!fs.statSync(absolute).isDirectory()) errors.push(diagnostic('REGISTRY.TEST_ROOT_TYPE', testRoot, 'testRoot must be a directory'));
            }
        } catch (error) {
            errors.push(diagnostic('REGISTRY.TEST_ROOT', String(feature.testRoot), error.message));
        }
        if (testRoot) {
            for (const existing of testRoots) if (isInside(testRoot, existing) || isInside(existing, testRoot)) errors.push(diagnostic('REGISTRY.OVERLAPPING_TEST_ROOT', testRoot, `testRoot overlaps ${existing}`));
            testRoots.push(testRoot);
        }

        const unitTests = [];
        if (!Array.isArray(feature.unitTests) || feature.unitTests.length === 0) errors.push(diagnostic('REGISTRY.UNIT_TESTS', `${label}.unitTests`, 'unitTests must be a nonempty array'));
        else {
            const seenTests = new Set();
            for (const value of feature.unitTests) {
                let normalized;
                try { normalized = normalizeRepoPath(value); } catch (error) { errors.push(diagnostic('REGISTRY.UNIT_TEST_PATH', String(value), error.message)); continue; }
                if (seenTests.has(normalized)) errors.push(diagnostic('REGISTRY.DUPLICATE_UNIT_TEST', normalized, 'unitTests contains a duplicate path'));
                seenTests.add(normalized);
                if (!testRoot || !isInside(normalized, testRoot)) errors.push(diagnostic('REGISTRY.UNIT_TEST_ROOT', normalized, 'unitTest must be under its feature testRoot'));
                if (!UNIT_TEST_PATTERN.test(normalized)) errors.push(diagnostic('REGISTRY.UNIT_TEST_EXTENSION', normalized, 'unitTest must end in .test.js, .test.cjs or .test.mjs'));
                try {
                    const absolute = resolveRepoPath(root, normalized);
                    if (!fs.statSync(absolute).isFile()) errors.push(diagnostic('REGISTRY.UNIT_TEST_TYPE', normalized, 'unitTest must be a regular file'));
                } catch (error) { errors.push(diagnostic('REGISTRY.UNIT_TEST_PATH', normalized, error.message)); }
                unitTests.push(normalized);
            }
        }

        if (testRoot) {
            try {
                const inventory = inventoryUnitTests(testRoot, { root });
                const listed = new Set(unitTests);
                for (const found of inventory) if (!listed.has(found)) errors.push(diagnostic('REGISTRY.UNREGISTERED_TEST', found, 'matching unit test is not explicitly registered'));
                const found = new Set(inventory);
                for (const listedPath of unitTests) if (!found.has(listedPath)) errors.push(diagnostic('REGISTRY.MISSING_UNIT_TEST', listedPath, 'registered unit test is missing from inventory'));
            } catch (error) { errors.push(diagnostic('REGISTRY.INVENTORY', testRoot, error.message)); }
        }
        features.push({ id: feature.id, sourceRoots: sourceRoots.sort(comparePath), testRoot, unitTests: unitTests.sort(comparePath) });
    }

    const sortedFeatures = features.sort((left, right) => comparePath(left.id, right.id));
    const unitTests = sortedFeatures.flatMap((feature) => feature.unitTests).sort((left, right) => {
        const featureForPath = sortedFeatures.find((feature) => feature.unitTests.includes(left));
        const otherFeature = sortedFeatures.find((feature) => feature.unitTests.includes(right));
        return comparePath(featureForPath ? featureForPath.id : '', otherFeature ? otherFeature.id : '') || comparePath(left, right);
    });
    return { ok: errors.length === 0, errors, diagnostics: errors, features: sortedFeatures, unitTests };
}

function readRegistry(registryPath, root) {
    const resolvedRoot = path.resolve(root || process.cwd());
    const requested = registryPath || REGISTRY_PATH;
    const absolute = path.isAbsolute(requested) ? path.resolve(requested) : resolveRepoPath(resolvedRoot, requested);
    if (!fs.existsSync(absolute)) throw new Error(`verification registry does not exist: ${absolute}`);
    let current = absolute;
    while (true) {
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink() || (typeof stat.isJunction === 'function' && stat.isJunction())) throw new Error(`verification registry cannot use a symlink or junction: ${absolute}`);
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return { absolute, registry: JSON.parse(fs.readFileSync(absolute, 'utf8').replace(/^\uFEFF/, '')) };
}

function selectUnitTests(options = {}) {
    const root = path.resolve(options.root || process.cwd());
    let loaded;
    try { loaded = options.registry ? { absolute: null, registry: options.registry } : readRegistry(options.registryPath, root); }
    catch (error) {
        const errors = [diagnostic('REGISTRY.READ', options.registryPath || REGISTRY_PATH, error.message)];
        return { ok: false, errors, diagnostics: errors, features: [], unitTests: [], registryPath: options.registryPath || REGISTRY_PATH };
    }
    const result = validateRegistry(loaded.registry, { root });
    return { ...result, registryPath: loaded.absolute || options.registryPath || REGISTRY_PATH };
}

function checkSelection(options = {}) {
    const result = selectUnitTests(options);
    return { ...result, status: result.ok ? 0 : 1 };
}

function parseArgs(argv) {
    const result = { command: null, list: false, json: false };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === 'check') {
            if (result.command || result.list) throw new Error('check may only be provided once');
            result.command = 'check';
        } else if (arg === '--list') result.list = true;
        else if (arg === '--json') result.json = true;
        else if (arg === '--root' || arg === '--registry') {
            if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) throw new Error(`${arg} requires a value`);
            result[arg.slice(2)] = argv[++index];
        } else throw new Error(`unknown argument: ${arg}`);
    }
    if (!result.command) result.command = 'check';
    return result;
}

function cli(argv = process.argv.slice(2)) {
    try {
        const args = parseArgs(argv);
        const result = checkSelection({ root: args.root || process.cwd(), registryPath: args.registry });
        const output = { status: result.status, registryPath: result.registryPath, features: result.features, unitTests: result.unitTests, diagnostics: result.diagnostics };
        process.stdout.write(`${JSON.stringify(output, null, args.json || args.list ? 2 : 0)}\n`);
        return result.status;
    } catch (error) {
        process.stdout.write(`${JSON.stringify({ status: 1, diagnostics: [diagnostic('REGISTRY.CLI', '', error.message)] }, null, 2)}\n`);
        return 1;
    }
}

module.exports = {
    CRM_SOURCE_ROOTS,
    REGISTRY_PATH,
    UNIT_TEST_PATTERN,
    normalizeRepoPath,
    inventoryUnitTests,
    validateRegistry,
    selectUnitTests,
    checkSelection,
    cli
};

if (require.main === module) process.exitCode = cli();
