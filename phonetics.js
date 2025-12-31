/**
 * Phonetics Service Module
 * 
 * High-accuracy IPA phonetic transcription pipeline for ESL learners.
 * 
 * Lookup Order:
 * 1. CMU Pronouncing Dictionary (ARPABET → IPA) - 126,051 words
 * 2. Wiktionary API (US IPA preferred)
 * 
 * All outputs are American English IPA.
 */

const Phonetics = (function () {
    'use strict';

    // === CONFIGURATION ===
    const CONFIG = {
        cmuDictUrl: 'cmudict.json',
        wiktionaryApiBase: 'https://en.wiktionary.org/api/rest_v1/page/definition/',
        cacheEnabled: true,
        debug: false
    };

    // === STATE ===
    let cmuDict = null;
    let cmuDictLoading = null;
    const ipaCache = new Map();

    // === CMU DICTIONARY ===

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

    // === WIKTIONARY FALLBACK ===

    /**
     * Fetch IPA from Wiktionary API
     * @param {string} word 
     * @returns {string|null} IPA transcription or null
     */
    async function lookupWiktionary(word) {
        const normalized = word.toLowerCase().trim();

        try {
            const response = await fetch(
                `${CONFIG.wiktionaryApiBase}${encodeURIComponent(normalized)}`,
                {
                    headers: {
                        'Api-User-Agent': 'DictationPractice/1.0 (ESL Learning App)'
                    }
                }
            );

            if (!response.ok) {
                return null;
            }

            const data = await response.json();

            // Parse English section
            const english = data.en;
            if (!english || !Array.isArray(english)) {
                return null;
            }

            // Look for pronunciations
            for (const entry of english) {
                if (entry.pronunciations) {
                    for (const pron of entry.pronunciations) {
                        // Prefer US pronunciation
                        if (pron.ipa) {
                            // Check if it's specifically US
                            const hasUS = pron.tags &&
                                (pron.tags.includes('US') ||
                                    pron.tags.includes('General American') ||
                                    pron.tags.includes('GenAm'));

                            if (hasUS || !pron.tags || pron.tags.length === 0) {
                                // Return IPA (already in /.../ format usually)
                                let ipa = pron.ipa;
                                if (!ipa.startsWith('/')) ipa = '/' + ipa;
                                if (!ipa.endsWith('/')) ipa = ipa + '/';
                                return ipa;
                            }
                        }
                    }

                    // If no US found, return first IPA
                    const firstIPA = entry.pronunciations.find(p => p.ipa);
                    if (firstIPA) {
                        let ipa = firstIPA.ipa;
                        if (!ipa.startsWith('/')) ipa = '/' + ipa;
                        if (!ipa.endsWith('/')) ipa = ipa + '/';
                        return ipa;
                    }
                }
            }

            return null;
        } catch (error) {
            log('Wiktionary lookup failed:', error.message);
            return null;
        }
    }

    // === NO ESPEAK-NG ===
    // Decision: espeak-ng WASM adds 10-15MB and produces less accurate IPA.
    // CMU Dict (126k words) + Wiktionary covers 99%+ of ESL vocabulary.
    // For rare/unknown words, showing "-" is better UX than incorrect IPA.

    // === MAIN API ===

    /**
     * Get IPA transcription for a word
     * Uses fallback chain: CMU Dict → Wiktionary
     * 
     * @param {string} word - The word to transcribe
     * @returns {Promise<string>} IPA transcription or empty string
     */
    async function getIPA(word) {
        if (!word || typeof word !== 'string') {
            return '';
        }

        const normalized = word.toLowerCase().trim().replace(/[^a-z']/g, '');
        if (!normalized) {
            return '';
        }

        // Check cache first
        if (CONFIG.cacheEnabled && ipaCache.has(normalized)) {
            return ipaCache.get(normalized);
        }

        let ipa = '';

        // 1. Try CMU Dictionary
        const arpabet = await lookupCMU(normalized);
        if (arpabet) {
            // Convert ARPABET to IPA using the mapping
            if (typeof arpabetToIPA === 'function') {
                ipa = arpabetToIPA(arpabet);
                log(`CMU: "${normalized}" → ${ipa}`);
            } else {
                console.warn('[Phonetics] arpabetToIPA function not found');
            }
        }

        // 2. Fallback to Wiktionary
        if (!ipa) {
            ipa = await lookupWiktionary(normalized);
            if (ipa) {
                log(`Wiktionary: "${normalized}" → ${ipa}`);
            }
        }

        // Note: No espeak-ng fallback - CMU Dict + Wiktionary covers 99%+ of ESL vocabulary
        // For rare/unknown words, returning empty is better UX than incorrect IPA

        // Cache result
        if (CONFIG.cacheEnabled) {
            ipaCache.set(normalized, ipa || '');
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
        preload,
        clearCache,

        // For debugging
        _lookupCMU: lookupCMU,
        _lookupWiktionary: lookupWiktionary,
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
