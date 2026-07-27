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
        ipaDictUrl: 'ipa-dict.json',
        cmuDictUrl: 'cmudict.json',
        // Free Dictionary API - provides IPA from Wiktionary data
        dictionaryApiBase: 'https://api.dictionaryapi.dev/api/v2/entries/en/',
        cacheEnabled: true,
        debug: false
    };

    // === STATE ===
    let ipaDict = null;
    let ipaDictLoading = null;
    let cmuDict = null;
    let cmuDictLoading = null;
    // Cache stores { ipa: string, alternatives: string[], source: 'ipa-dict'|'dictionary'|'cmu'|null }
    const ipaCache = new Map();

    // === IPA-DICT (PRIMARY SOURCE) ===

    /**
     * Load ipa-dict Dictionary (lazy loading)
     */
    async function loadIpaDict() {
        if (ipaDict) return ipaDict;
        if (ipaDictLoading) return ipaDictLoading;

        ipaDictLoading = (async () => {
            try {
                const response = await fetch(CONFIG.ipaDictUrl);
                if (!response.ok) {
                    throw new Error(`Failed to load ipa-dict: ${response.status}`);
                }
                ipaDict = await response.json();
                log(`ipa-dict loaded: ${Object.keys(ipaDict).length} entries`);
                return ipaDict;
            } catch (error) {
                console.error('[Phonetics] ipa-dict load failed:', error);
                ipaDict = {}; // Empty fallback
                return ipaDict;
            }
        })();

        return ipaDictLoading;
    }

    /**
     * Lookup word in ipa-dict Dataset
     * @param {string} word 
     * @returns {string[]|null} Array of IPA variants or null
     */
    async function lookupIpaDict(word) {
        const dict = await loadIpaDict();
        const normalized = (word || '')
            .toLowerCase()
            .trim()
            .replace(/[’]/g, "'")
            .replace(/^[^a-z'-]+|[^a-z'-]+$/g, '');

        if (!/^[a-z][a-z'-]{0,29}$/.test(normalized)) return null;

        if (dict[normalized]) {
            const entry = dict[normalized];
            return Array.isArray(entry) ? entry : [entry];
        }

        const noApostrophe = normalized.replace(/'/g, '');
        if (dict[noApostrophe]) {
            const entry = dict[noApostrophe];
            return Array.isArray(entry) ? entry : [entry];
        }

        return null;
    }

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
        const normalized = (word || '')
            .toLowerCase()
            .trim()
            .replace(/[’]/g, "'")
            .replace(/^[^a-z'-]+|[^a-z'-]+$/g, '');

        // Unified Guard: Match strictness (1-30 chars)
        if (!/^[a-z][a-z'-]{0,29}$/.test(normalized)) return null;

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

    // === FREE DICTIONARY API (LEGACY/UNUSED) ===

    /**
     * Fetch IPA from Free Dictionary API (dictionaryapi.dev)
     * Suppressed to avoid CORS/network errors
     * 
     * @param {string} word 
     * @returns {string|null} IPA transcription or null
     */
    async function lookupDictionary(word) {
        return null;
    }

    // === MAIN API ===

    /**
     * Normalize IPA to Oxford/Cambridge Dictionary format:
     * - Replaces rhotic vowels (ɝ, ɚ) with 'ər'
     * - Replaces turned-r (ɹ) with 'r'
     * - Cleans up multiple slashes or misplaced stress marks
     */
    function normalizeIPA(ipa) {
        if (!ipa || typeof ipa !== 'string') return '';
        let cleaned = ipa
            .replace(/[ɝɚ]/g, 'ər')
            .replace(/ɹ/g, 'r')
            .replace(/\/+/g, '/')
            .trim();
        return cleaned;
    }

    /**
     * Get IPA transcription for a word
     * 
     * Strategy (order matters!):
     * 1. PRIMARY: ipa-dict (Wiktionary dataset (~126k entries))
     * 2. FALLBACK: CMU Dictionary (computed/approximate IPA)
     * 
     * @param {string} word - The word to transcribe
     * @returns {Promise<string>} IPA transcription or empty string
     */
    async function getIPA(word) {
        if (!word || typeof word !== 'string') {
            return '';
        }

        const normalized = (word || '')
            .toLowerCase()
            .trim()
            .replace(/[’]/g, "'")
            .replace(/^[^a-z'-]+|[^a-z'-]+$/g, '');

        // Unified Guard: Match strictness (1-30 chars)
        if (!/^[a-z][a-z'-]{0,29}$/.test(normalized)) return '';

        // Check cache first
        if (CONFIG.cacheEnabled && ipaCache.has(normalized)) {
            const cached = ipaCache.get(normalized);
            return typeof cached === 'object' ? cached.ipa : cached;
        }

        let ipa = '';
        let alternatives = [];
        let source = null;

        // 1. PRIMARY: Try ipa-dict dataset first (~126K Wiktionary entries)
        const ipaDictResult = await lookupIpaDict(normalized);
        if (ipaDictResult && ipaDictResult.length > 0) {
            ipa = ipaDictResult[0];
            alternatives = ipaDictResult.slice(1);
            source = 'ipa-dict';
            log(`ipa-dict (primary): "${normalized}" → ${ipa} (alts: ${alternatives.join(', ')})`);
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

        // Safety normalization: convert to Oxford/Cambridge IPA standard
        if (ipa) {
            ipa = normalizeIPA(ipa);
        }

        // Cache result with source metadata and alternatives
        if (CONFIG.cacheEnabled) {
            ipaCache.set(normalized, { ipa: ipa || '', alternatives, source });
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
     * @returns {Promise<{ipa: string, alternatives: string[], source: 'ipa-dict'|'wiktionary'|'cmu'|null, isApproximate: boolean}>}
     */
    async function getIPAWithSource(word) {
        const normalized = (word || '')
            .toLowerCase()
            .trim()
            .replace(/[’]/g, "'")
            .replace(/^[^a-z'-]+|[^a-z'-]+$/g, '');

        if (!/^[a-z][a-z'-]{0,29}$/.test(normalized)) {
            return { ipa: '', alternatives: [], source: null, isApproximate: false };
        }

        // Ensure word is looked up (populates cache)
        await getIPA(normalized);

        const cached = ipaCache.get(normalized);

        if (cached && typeof cached === 'object') {
            return {
                ipa: cached.ipa,
                alternatives: cached.alternatives || [],
                source: cached.source,
                isApproximate: cached.source === 'cmu'
            };
        }

        return { ipa: '', alternatives: [], source: null, isApproximate: false };
    }

    /**
     * Preload IPA Dictionaries (ipa-dict + CMU)
     */
    async function preload() {
        await Promise.all([loadIpaDict(), loadCMUDict()]);
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
        normalizeIPA,
        preload,
        clearCache,

        // For debugging
        _lookupIpaDict: lookupIpaDict,
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
