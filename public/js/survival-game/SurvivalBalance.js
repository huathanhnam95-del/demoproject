function normalizeTypeToken(value) {
    return String(value || '').trim().toLowerCase();
}

function getEnemyIntroSequence(introConfig = {}, splitterConfig = {}) {
    return [
        { type: 'rusher', unlockWave: Number.isFinite(introConfig.RUSHER_WAVE) ? introConfig.RUSHER_WAVE : 3 },
        { type: 'turret', unlockWave: Number.isFinite(introConfig.TURRET_WAVE) ? introConfig.TURRET_WAVE : 5 },
        { type: 'tank', unlockWave: Number.isFinite(introConfig.TANK_WAVE) ? introConfig.TANK_WAVE : 7 },
        { type: 'splitter', unlockWave: Number.isFinite(splitterConfig.UNLOCK_WAVE) ? splitterConfig.UNLOCK_WAVE : 9 }
    ];
}

function normalizeIntroducedTypes(introducedTypes, sequence) {
    const requested = introducedTypes instanceof Set
        ? Array.from(introducedTypes)
        : Array.isArray(introducedTypes)
            ? introducedTypes
            : [];

    const requestedSet = new Set(
        requested
            .map(normalizeTypeToken)
            .filter(Boolean)
    );

    const normalized = ['drone'];
    for (const stage of sequence) {
        if (requestedSet.has(stage.type)) normalized.push(stage.type);
    }
    return normalized;
}

export function canSpawnShieldedEnemy(activeShieldedCount = 0, maxShielded = 2) {
    const active = Number.isFinite(activeShieldedCount) ? activeShieldedCount : 0;
    const limit = Number.isFinite(maxShielded) ? Math.max(0, Math.floor(maxShielded)) : 2;
    return active < limit;
}

export function isStableRhythm(metrics = {}, introConfig = {}) {
    const wpm = Number.isFinite(metrics.wpm) ? metrics.wpm : 0;
    const combo = Number.isFinite(metrics.combo) ? metrics.combo : 0;
    const mistakePenalty = Number.isFinite(metrics.mistakePenalty) ? metrics.mistakePenalty : 0;
    const loadRatio = Number.isFinite(metrics.loadRatio) ? metrics.loadRatio : Infinity;

    const minWpm = Number.isFinite(introConfig.STABLE_WPM_MIN) ? introConfig.STABLE_WPM_MIN : 28;
    const minCombo = Number.isFinite(introConfig.STABLE_COMBO_MIN) ? introConfig.STABLE_COMBO_MIN : 12;
    const maxLoad = Number.isFinite(introConfig.STABLE_LOAD_MAX) ? introConfig.STABLE_LOAD_MAX : 0.72;

    return wpm >= minWpm
        && combo >= minCombo
        && mistakePenalty <= 0
        && loadRatio <= maxLoad;
}

export function updateEnemyIntroState(
    state = {},
    metrics = {},
    deltaTime = 0,
    introConfig = {},
    splitterConfig = {}
) {
    const sequence = getEnemyIntroSequence(introConfig, splitterConfig);
    const introducedTypes = normalizeIntroducedTypes(state.introducedTypes, sequence);
    const requiredSeconds = Number.isFinite(introConfig.STABLE_SECONDS_REQUIRED)
        ? Math.max(1, introConfig.STABLE_SECONDS_REQUIRED)
        : 24;
    const decayPerSecond = Number.isFinite(introConfig.STABLE_DECAY_PER_SECOND)
        ? Math.max(0, introConfig.STABLE_DECAY_PER_SECOND)
        : 1.5;
    const wave = Number.isFinite(metrics.wave) ? metrics.wave : 1;
    const step = Number.isFinite(deltaTime) ? Math.max(0, deltaTime) : 0;

    const nextStage = sequence.find(stage => !introducedTypes.includes(stage.type) && wave >= stage.unlockWave);
    if (!nextStage) {
        return {
            stableTime: 0,
            introducedTypes,
            unlockedType: ''
        };
    }

    let stableTime = Number.isFinite(state.stableTime) ? Math.max(0, state.stableTime) : 0;
    if (isStableRhythm(metrics, introConfig)) {
        stableTime += step;
    } else {
        stableTime = Math.max(0, stableTime - (step * decayPerSecond));
    }

    if (stableTime + 1e-9 < requiredSeconds) {
        return {
            stableTime,
            introducedTypes,
            unlockedType: ''
        };
    }

    return {
        stableTime: 0,
        introducedTypes: [...introducedTypes, nextStage.type],
        unlockedType: nextStage.type
    };
}

export function pickSpawnEnemyType(options = {}) {
    const introConfig = (options.introConfig && typeof options.introConfig === 'object') ? options.introConfig : {};
    const splitterConfig = (options.splitterConfig && typeof options.splitterConfig === 'object') ? options.splitterConfig : {};
    const sequence = getEnemyIntroSequence(introConfig, splitterConfig);
    const introduced = new Set(normalizeIntroducedTypes(options.introducedTypes, sequence));
    const wave = Number.isFinite(options.wave) ? options.wave : 1;
    const typeRoll = Number.isFinite(options.typeRoll) ? options.typeRoll : Math.random();
    const splitterRoll = Number.isFinite(options.splitterRoll) ? options.splitterRoll : Math.random();

    const splitterUnlock = Number.isFinite(splitterConfig.UNLOCK_WAVE) ? splitterConfig.UNLOCK_WAVE : 9;
    const splitterStart = Number.isFinite(splitterConfig.CHANCE_START) ? splitterConfig.CHANCE_START : 0.06;
    const splitterMax = Number.isFinite(splitterConfig.CHANCE_MAX) ? splitterConfig.CHANCE_MAX : 0.12;
    const splitterRamp = Number.isFinite(splitterConfig.CHANCE_RAMP_PER_WAVE) ? splitterConfig.CHANCE_RAMP_PER_WAVE : 0.004;
    const splitterChance = introduced.has('splitter') && wave >= splitterUnlock
        ? Math.max(0, Math.min(splitterMax, splitterStart + (wave - splitterUnlock) * splitterRamp))
        : 0;

    if (splitterChance > 0 && splitterRoll < splitterChance) return 'splitter';

    const rusherWave = Number.isFinite(introConfig.RUSHER_WAVE) ? introConfig.RUSHER_WAVE : 3;
    const turretWave = Number.isFinite(introConfig.TURRET_WAVE) ? introConfig.TURRET_WAVE : 5;
    const tankWave = Number.isFinite(introConfig.TANK_WAVE) ? introConfig.TANK_WAVE : 7;

    if (wave >= tankWave) {
        if (introduced.has('tank') && typeRoll < 0.12) return 'tank';
        if (introduced.has('turret') && typeRoll < 0.30) return 'turret';
        if (introduced.has('rusher') && typeRoll < 0.55) return 'rusher';
        return 'drone';
    }

    if (wave >= turretWave) {
        if (introduced.has('turret') && typeRoll < 0.15) return 'turret';
        if (introduced.has('rusher') && typeRoll < 0.40) return 'rusher';
        return 'drone';
    }

    if (wave >= rusherWave && introduced.has('rusher') && typeRoll < 0.25) {
        return 'rusher';
    }

    return 'drone';
}
