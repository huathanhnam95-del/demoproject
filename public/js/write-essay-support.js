/**
 * Offline Guided Write Essay support loader and learner-preference helpers.
 * Content is generated offline; this module only loads, validates, and
 * presents the versioned support packs.
 */
(function (global) {
    'use strict';

    const MANIFEST_PATH = '/database/Write Essay/support/v1/manifest.json';
    const PREF_KEY = 'pte_write_essay_guided_preferences_v1';
    const HISTORY_KEY = 'pte_write_essay_guided_history_v1';
    const LEVELS = Object.freeze(['a2_b1', 'b2', 'c1']);
    const LANGUAGE_CODES = Object.freeze(['en', 'vi']);
    const packCache = new Map();
    let manifestPromise = null;
    let activePackController = null;

    class EssaySupportUnavailableError extends Error {
        constructor(message, code = 'unavailable') {
            super(message);
            this.name = 'EssaySupportUnavailableError';
            this.code = code;
        }
    }

    function normalizeLevel(value) {
        const level = String(value || '').trim().toLowerCase();
        if (LEVELS.includes(level)) return level;
        if (level === 'a1' || level === 'a2' || level === 'b1' || level === 'beginner' || level === 'elementary' || level === 'pre-intermediate') return 'a2_b1';
        if (level === 'c1' || level === 'c2' || level === 'advanced' || level === 'proficient') return 'c1';
        return 'b2';
    }

    function readProfileLevel(profile) {
        return profile?.cefrLevels?.writing || profile?.writingLevel || profile?.englishLevel || null;
    }

    function resolveSupportLevel({ profile = null, onboardingLevel = null, manualOverride = null } = {}) {
        if (manualOverride && LEVELS.includes(String(manualOverride))) return String(manualOverride);
        return normalizeLevel(readProfileLevel(profile) || onboardingLevel || 'b2');
    }

    function readPreferences() {
        try {
            const value = JSON.parse(global.localStorage?.getItem(PREF_KEY) || '{}');
            return value && typeof value === 'object' ? value : {};
        } catch (_) {
            return {};
        }
    }

    function writePreferences(patch) {
        const next = { ...readPreferences(), ...patch };
        try { global.localStorage?.setItem(PREF_KEY, JSON.stringify(next)); } catch (_) { /* private mode */ }
        return next;
    }

    function readHistory() {
        try {
            const value = JSON.parse(global.localStorage?.getItem(HISTORY_KEY) || '[]');
            return Array.isArray(value) ? value : [];
        } catch (_) {
            return [];
        }
    }

    function recordGuidedUsage({ questionId, targetIds = [], level, language = 'en' } = {}) {
        const previous = readHistory();
        const counts = new Map(previous.map(item => [String(item.id), Number(item.count) || 0]));
        [...new Set(targetIds.filter(Boolean).map(String))].forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
        const next = [...counts.entries()].map(([id, count]) => ({ id, count })).slice(-80);
        try { global.localStorage?.setItem(HISTORY_KEY, JSON.stringify(next)); } catch (_) { /* private mode */ }
        return {
            questionId: String(questionId || ''),
            level: normalizeLevel(level),
            language: LANGUAGE_CODES.includes(language) ? language : 'en',
            targetIds: [...new Set(targetIds.filter(Boolean).map(String))],
            history: next,
        };
    }

    function getRecycledTargetIds({ exclude = [], limit = 2 } = {}) {
        const excluded = new Set(exclude.map(String));
        return readHistory()
            .filter(item => !excluded.has(String(item.id)))
            .sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))
            .slice(0, Math.max(0, Math.min(2, limit)))
            .map(item => String(item.id));
    }

    async function sha256Hex(text) {
        if (!global.crypto?.subtle || typeof TextEncoder === 'undefined') return null;
        const bytes = new TextEncoder().encode(text);
        const digest = await global.crypto.subtle.digest('SHA-256', bytes);
        return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    }

    function validateManifestShape(manifest) {
        if (!manifest || manifest.schemaVersion !== 'EssaySupportManifestV1' || manifest.contentVersion !== 'v1' || !manifest.questions || typeof manifest.questions !== 'object') {
            throw new EssaySupportUnavailableError('The Guided support manifest is incompatible.', 'incompatible_manifest');
        }
        return manifest;
    }

    async function loadManifest({ force = false } = {}) {
        if (force) manifestPromise = null;
        if (manifestPromise) return manifestPromise;
        manifestPromise = fetch(MANIFEST_PATH, { cache: 'no-store' })
            .then(response => {
                if (!response.ok) throw new EssaySupportUnavailableError(`Support manifest unavailable (${response.status}).`, 'manifest_http');
                return response.json();
            })
            .then(validateManifestShape)
            .catch(error => {
                manifestPromise = null;
                throw error;
            });
        return manifestPromise;
    }

    async function loadPack(questionId, { signal, force = false } = {}) {
        const id = String(questionId || '').trim();
        if (!id) throw new EssaySupportUnavailableError('No essay question was selected.', 'missing_question');
        if (!force && packCache.has(id)) return packCache.get(id);
        if (activePackController) activePackController.abort();
        const controller = typeof global.AbortController === 'function'
            ? new global.AbortController()
            : { signal: undefined, abort() {} };
        activePackController = controller;
        const combinedSignal = signal || controller.signal;
        try {
            const manifest = await loadManifest();
            const record = manifest.questions[id];
            if (!record || record.status !== 'PUBLISHED') throw new EssaySupportUnavailableError('Guided support is not published for this prompt yet.', 'not_published');
            const response = await fetch(record.url, { signal: combinedSignal, cache: 'force-cache' });
            if (!response.ok) throw new EssaySupportUnavailableError(`Guided support pack unavailable (${response.status}).`, 'pack_http');
            const text = await response.text();
            const actualHash = await sha256Hex(text);
            if (actualHash && actualHash !== record.sha256) throw new EssaySupportUnavailableError('This Guided support pack failed its integrity check.', 'hash_mismatch');
            const pack = JSON.parse(text);
            if (pack.schemaVersion !== 'EssaySupportPackV1' || String(pack.questionId) !== id || !pack.levels || !pack.common) {
                throw new EssaySupportUnavailableError('This Guided support pack is incompatible.', 'incompatible_pack');
            }
            packCache.set(id, pack);
            return pack;
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            if (error instanceof EssaySupportUnavailableError) throw error;
            throw new EssaySupportUnavailableError('Guided support could not be loaded. Please retry.', 'pack_parse');
        } finally {
            if (activePackController === controller) activePackController = null;
        }
    }

    function abortPackLoad() {
        if (activePackController) activePackController.abort();
    }

    global.WriteEssaySupport = Object.freeze({
        MANIFEST_PATH,
        LEVELS,
        normalizeLevel,
        resolveSupportLevel,
        readPreferences,
        writePreferences,
        readHistory,
        recordGuidedUsage,
        getRecycledTargetIds,
        loadManifest,
        loadPack,
        abortPackLoad,
        sha256Hex,
        EssaySupportUnavailableError,
    });
})(typeof window !== 'undefined' ? window : globalThis);
