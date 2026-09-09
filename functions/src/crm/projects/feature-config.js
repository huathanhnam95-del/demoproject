'use strict';

const DEFAULT_FEATURE_CONFIG = Object.freeze({
    projects: false,
    automations: false,
    paidVoice: false
});

const FEATURE_ENV_KEYS = Object.freeze({
    projects: 'CRM_PROJECTS_ENABLED',
    automations: 'CRM_PROJECTS_AUTOMATIONS_ENABLED',
    paidVoice: 'CRM_PROJECTS_PAID_VOICE_ENABLED'
});

const PAID_VOICE_HARD_CAP_ENV_KEY = 'CRM_PROJECTS_PAID_VOICE_HARD_CAP_PASSED';

function parseBooleanFlag(value) {
    const normalized = String(value ?? '').trim();
    return normalized === 'true' || normalized === '1';
}

function getProjectsFeatureConfig(env = process.env) {
    const requested = getRequestedProjectsFeatureConfig(env);
    return Object.freeze({
        ...requested,
        paidVoice: requested.paidVoice && parseBooleanFlag(env?.[PAID_VOICE_HARD_CAP_ENV_KEY])
    });
}

function getRequestedProjectsFeatureConfig(env = process.env) {
    return Object.freeze(Object.fromEntries(
        Object.entries(FEATURE_ENV_KEYS).map(([feature, envKey]) => [
            feature,
            parseBooleanFlag(env?.[envKey])
        ])
    ));
}

function isProjectsFeatureEnabled(feature, env = process.env) {
    if (!Object.prototype.hasOwnProperty.call(FEATURE_ENV_KEYS, feature)) {
        return false;
    }
    return getProjectsFeatureConfig(env)[feature] === true;
}

module.exports = {
    DEFAULT_FEATURE_CONFIG,
    FEATURE_ENV_KEYS,
    PAID_VOICE_HARD_CAP_ENV_KEY,
    getProjectsFeatureConfig,
    getRequestedProjectsFeatureConfig,
    isProjectsFeatureEnabled,
    parseBooleanFlag
};
