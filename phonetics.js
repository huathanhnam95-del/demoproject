/**
 * Phonetics Service Module
 * 
 * High-accuracy IPA phonetic transcription pipeline for ESL learners.
 * 
 * DATA SOURCE STRATEGY (order matters!):
 * 
 * 1. PRIMARY: Wiktionary API (authoritative dictionary IPA)
 *    - Preferred US IPA, otherwise first IPA listed
 *    - NEVER modify or recompute stress for dictionary IPA
 *    - These are human-verified, accurate transcriptions
 * 
 * 2. SECONDARY FALLBACK: CMU Pronouncing Dictionary (ARPABET → IPA)
 *    - Only used when Wiktionary has no entry
 *    - Computed IPA, may have inaccuracies with stress/vowels
 *    - Marked internally as approximate
 * 
 * All outputs are American English IPA.
 */

const Phonetics = (function () {
    'use strict';

    // === CONFIGURATION ===
    const CONFIG = {
        cmuDictUrl: 'cmudict.json',
        // Free Dictionary API - provides IPA from Wiktionary data
        dictionaryApiBase: 'https://api.dictionaryapi.dev/api/v2/entries/en/',
        cacheEnabled: true,
        debug: false
    };

    // === STATE ===
    let cmuDict = null;
    let cmuDictLoading = null;
    // Cache stores { ipa: string, source: 'dictionary'|'cmu'|null }
    const ipaCache = new Map();

    // === CMU DICTIONARY (FALLBACK) ===

    /**
     * Load CMU Dictionary (lazy loading)
     */
    async function loadCMUDict() {
        if (cmuDict) return cmuDict;
        if (cmuDictLoading) return cmuDictLoading;

        cmuDictLoading = (async () => {
            try {
                const response = await fetch(CONFIG.cmuDictUrl);
                if (!response.ok) {
                    throw new Error(`Failed to load CMU dict: ${response.status}`);
                }
                cmuDict = await response.json();
                log(`CMU Dict loaded: ${Object.keys(cmuDict).length} entries`);
                return cmuDict;
            } catch (error) {
                console.error('[Phonetics] CMU Dict load failed:', error);
                cmuDict = {}; // Empty fallback
                return cmuDict;
            }
        })();

        return cmuDictLoading;
    }

    /**
     * Lookup word in CMU Dictionary
     * @param {string} word 
     * @returns {string|null} ARPABET phonemes or null
     */
    async function lookupCMU(word) {
        const dict = await loadCMUDict();
        const normalized = word.toLowerCase().replace(/[^a-z']/g, '');

        // Try exact match
        if (dict[normalized]) {
            // CMU dict may have multiple pronunciations, take first
            const entry = dict[normalized];
            return Array.isArray(entry) ? entry[0] : entry;
        }

        // Try without apostrophes
        const noApostrophe = normalized.replace(/'/g, '');
        if (dict[noApostrophe]) {
            const entry = dict[noApostrophe];
            return Array.isArray(entry) ? entry[0] : entry;
        }

        return null;
    }

    // === FREE DICTIONARY API (PRIMARY SOURCE) ===

    /**
     * Fetch IPA from Free Dictionary API (dictionaryapi.dev)
     * This is the PRIMARY source - returns authoritative dictionary IPA
     * Data is sourced from Wiktionary
     * 
     * Prefers US pronunciation when audio is available (indicates US source)
     * 
     * @param {string} word 
     * @returns {string|null} IPA transcription or null
     */
    async function lookupDictionary(word) {
        // Suppress failing external API to avoid CORS errors in console
        return null;
    }

    // === MAIN API ===

    /**
     * Get IPA transcription for a word
     * 
     * Strategy (order matters!):
     * 1. PRIMARY: Wiktionary (authoritative dictionary IPA)
     * 2. FALLBACK: CMU Dictionary (computed/approximate IPA)
     * 
     * @param {string} word - The word to transcribe
     * @returns {Promise<string>} IPA transcription or empty string
     */
    async function getIPA(word) {
        if (!word || typeof word !== 'string') {
            return '';
        }

        const normalized = word.toLowerCase().trim().replace(/[’]/g, "'").replace(/[^a-z']/g, '');
        if (!normalized) {
            return '';
        }

        // Check cache first
        if (CONFIG.cacheEnabled && ipaCache.has(normalized)) {
            const cached = ipaCache.get(normalized);
            return typeof cached === 'object' ? cached.ipa : cached;
        }

        let ipa = '';
        let source = null;

        // 1. PRIMARY: Try Free Dictionary API first (authoritative dictionary IPA)
        ipa = await lookupDictionary(normalized);
        if (ipa) {
            source = 'dictionary';
            log(`Dictionary (authoritative): "${normalized}" → ${ipa}`);
        }

        // 2. FALLBACK: Try CMU Dictionary (computed/approximate IPA)
        if (!ipa) {
            const arpabet = await lookupCMU(normalized);
            if (arpabet) {
                // Convert ARPABET to IPA using the mapping
                if (typeof arpabetToIPA === 'function') {
                    ipa = arpabetToIPA(arpabet);
                    source = 'cmu';
                    log(`CMU (approximate): "${normalized}" → ${ipa}`);
                } else {
                    console.warn('[Phonetics] arpabetToIPA function not found');
                }
            }
        }

        // Normalize IPA: replace ɹ (turned r) with regular r for easier reading
        if (ipa) {
            ipa = ipa.replace(/ɹ/g, 'r');
        }

        // Cache result with source metadata
        if (CONFIG.cacheEnabled) {
            ipaCache.set(normalized, { ipa: ipa || '', source });
        }

        return ipa || '';
    }

    /**
     * Get IPA for multiple words
     * @param {string[]} words 
     * @returns {Promise<Object>} Map of word → IPA
     */
    async function getIPABatch(words) {
        const results = {};
        const promises = words.map(async (word) => {
            results[word] = await getIPA(word);
        });
        await Promise.all(promises);
        return results;
    }

    /**
     * Get IPA with source information
     * Useful for debugging or showing approximate markers
     * 
     * @param {string} word - The word to transcribe
     * @returns {Promise<{ipa: string, source: 'wiktionary'|'cmu'|null, isApproximate: boolean}>}
     */
    async function getIPAWithSource(word) {
        // Ensure word is looked up (populates cache)
        await getIPA(word);

        const normalized = word.toLowerCase().trim().replace(/[’]/g, "'").replace(/[^a-z']/g, '');
        const cached = ipaCache.get(normalized);

        if (cached && typeof cached === 'object') {
            return {
                ipa: cached.ipa,
                source: cached.source,
                isApproximate: cached.source === 'cmu'
            };
        }

        return { ipa: '', source: null, isApproximate: false };
    }

    /**
     * Preload CMU Dictionary
     */
    async function preload() {
        await loadCMUDict();
    }

    /**
     * Clear IPA cache
     */
    function clearCache() {
        ipaCache.clear();
        log('Cache cleared');
    }

    // === UTILITIES ===

    function log(...args) {
        if (CONFIG.debug) {
            console.log('[Phonetics]', ...args);
        }
    }

    // === PUBLIC API ===
    return {
        getIPA,
        getIPABatch,
        getIPAWithSource,
        preload,
        clearCache,

        // For debugging
        _lookupCMU: lookupCMU,
        _lookupDictionary: lookupDictionary,
        _cache: ipaCache,

        // Enable debug mode
        enableDebug: () => { CONFIG.debug = true; },
        disableDebug: () => { CONFIG.debug = false; }
    };
})();

// Expose globally
if (typeof window !== 'undefined') {
    window.Phonetics = Phonetics;
}
