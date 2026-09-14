'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const pairs = [
    ['state/session.mjs', 'functions/src/crm/presentation-demo/core/state/session.mjs', 'public/js/presentation-demo/core/state/session.mjs'],
    ['state/progression.mjs', 'functions/src/crm/presentation-demo/core/state/progression.mjs', 'public/js/presentation-demo/core/state/progression.mjs'],
    ['world/simulation.mjs', 'functions/src/crm/presentation-demo/core/world/simulation.mjs', 'public/js/presentation-demo/core/world/simulation.mjs'],
    ['world/scenes.mjs', 'functions/src/crm/presentation-demo/core/world/scenes.mjs', 'public/js/presentation-demo/core/world/scenes.mjs'],
    ['world/geometry.mjs', 'functions/src/crm/presentation-demo/core/world/geometry.mjs', 'public/js/presentation-demo/core/world/geometry.mjs'],
    ['activities/bridge.mjs', 'functions/src/crm/presentation-demo/core/activities/bridge.mjs', 'public/js/presentation-demo/core/activities/bridge.mjs'],
    ['activities/reversal.mjs', 'functions/src/crm/presentation-demo/core/activities/reversal.mjs', 'public/js/presentation-demo/core/activities/reversal.mjs'],
    ['activities/cubes.mjs', 'functions/src/crm/presentation-demo/core/activities/cubes.mjs', 'public/js/presentation-demo/core/activities/cubes.mjs'],
    ['content/source.mjs', 'functions/src/crm/presentation-demo/core/content/source.mjs', 'public/js/presentation-demo/core/content/source.mjs']
];

function checkOrCopy({ check = false } = {}) {
    const mismatches = [];
    for (const [sourceLabel, canonicalLabel, outputLabel] of pairs) {
        const canonical = path.join(root, canonicalLabel);
        const output = path.join(root, outputLabel);
        if (!fs.existsSync(canonical)) throw new Error(`Missing canonical source: ${canonicalLabel} (${sourceLabel})`);
        if (check) {
            if (!fs.existsSync(output) || !Buffer.from(fs.readFileSync(canonical)).equals(fs.readFileSync(output))) mismatches.push(outputLabel);
            continue;
        }
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.copyFileSync(canonical, output);
    }
    if (mismatches.length) throw new Error(`Generated core mismatch: ${mismatches.join(', ')}`);
    return { pairs: pairs.length, mismatches };
}

if (require.main === module) {
    const check = process.argv.includes('--check');
    try {
        const result = checkOrCopy({ check });
        console.log(`${check ? 'checked' : 'built'} ${result.pairs} online core pairs`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = { pairs, checkOrCopy };
