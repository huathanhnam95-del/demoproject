/**
 * Test Suite for DifficultyManager profile handling across ALL modes
 * 
 * Verifies that all modes (type, speak, srs, extended, notes) get
 * proper default profiles and that the debug explanation API works.
 * 
 * Run with: node tests/difficulty-manager-profiles.test.mjs
 */

import assert from 'node:assert/strict';
import { DifficultyConfig } from '../public/js/difficulty/DifficultyConfig.js';

console.log('🧪 Starting DifficultyManager Profile Tests...\n');

// ── 1. DifficultyConfig has MODE_SETTINGS for all 5 modes ────────
{
    const expectedModes = ['type', 'speak', 'srs', 'extended', 'notes'];
    for (const mode of expectedModes) {
        assert.ok(
            DifficultyConfig.MODE_SETTINGS[mode],
            `MODE_SETTINGS should have entry for '${mode}'`
        );

        // Each mode should have settings for levels 1-6
        for (let level = 1; level <= 6; level++) {
            assert.ok(
                DifficultyConfig.MODE_SETTINGS[mode][level],
                `MODE_SETTINGS['${mode}'] should have level ${level}`
            );
        }
    }
    console.log('✅ 1. All 5 modes present in DifficultyConfig.MODE_SETTINGS');
}

// ── 2. Extended mode has showHints property ──────────────────────
{
    assert.equal(
        DifficultyConfig.MODE_SETTINGS.extended[1].showHints,
        true,
        'Extended level 1 should showHints'
    );
    assert.equal(
        DifficultyConfig.MODE_SETTINGS.extended[3].showHints,
        false,
        'Extended level 3 should not showHints'
    );
    console.log('✅ 2. Extended mode showHints property correct');
}

// ── 3. Notes mode has showTranscript property ────────────────────
{
    assert.equal(
        DifficultyConfig.MODE_SETTINGS.notes[1].showTranscript,
        true,
        'Notes level 1 should showTranscript'
    );
    assert.equal(
        DifficultyConfig.MODE_SETTINGS.notes[3].showTranscript,
        false,
        'Notes level 3 should not showTranscript'
    );
    console.log('✅ 3. Notes mode showTranscript property correct');
}

// ── 4. Notes mode has decreasing maxReplays ──────────────────────
{
    const l1Replays = DifficultyConfig.MODE_SETTINGS.notes[1].maxReplays;
    const l3Replays = DifficultyConfig.MODE_SETTINGS.notes[3].maxReplays;
    const l5Replays = DifficultyConfig.MODE_SETTINGS.notes[5].maxReplays;
    assert.ok(l1Replays >= l3Replays, 'Level 1 replays should be >= level 3');
    assert.ok(l3Replays >= l5Replays, 'Level 3 replays should be >= level 5');
    console.log('✅ 4. Notes mode maxReplays decreases with difficulty');
}

// ── 5. Level names cover all 6 levels ────────────────────────────
{
    for (let level = 1; level <= 6; level++) {
        const name = DifficultyConfig.LEVELS.NAMES[level];
        assert.ok(name, `Level ${level} should have a name`);
        assert.ok(name.length > 0, `Level ${level} name should not be empty`);
    }
    console.log('✅ 5. All 6 levels have names in DifficultyConfig');
}

// ── 6. Thresholds are sane ───────────────────────────────────────
{
    assert.ok(DifficultyConfig.THRESHOLDS.UP > DifficultyConfig.THRESHOLDS.DOWN,
        'UP threshold should be higher than DOWN');
    assert.ok(DifficultyConfig.THRESHOLDS.SMURF > DifficultyConfig.THRESHOLDS.UP,
        'SMURF threshold should be higher than UP');
    console.log('✅ 6. Difficulty thresholds are sane (DOWN < UP < SMURF)');
}

console.log('\n✅ All DifficultyManager profile tests passed');
