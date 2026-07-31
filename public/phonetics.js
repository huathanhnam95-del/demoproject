/**
 * Phonetics Service Module
 * 
 * High-accuracy IPA phonetic transcription pipeline for ESL learners.
 * 
 * DATA SOURCE STRATEGY (order matters!):
 *
 * 1. PRIMARY: Oxford-American review layer
 *    - Explicit US entries, aliases, phrases, and weak-form profiles
 *    - Quarantined learner-facing nonwords never fall through to another source
 * 
 * 2. SECONDARY: ipa-dict's American English corpus
 *    - Existing corpus forms are preserved unless the review layer overrides them
 * 
 * 3. FALLBACK: CMU Pronouncing Dictionary (ARPABET → IPA)
 *    - Only used when the local ipa-dict corpus has no entry
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
        oxfordIpaUrl: 'oxford-american-ipa.json',
        cacheEnabled: true,
        debug: false
    };

    // === STATE ===
    let ipaDict = null;
    let ipaDictLoading = null;
    let cmuDict = null;
    let cmuDictLoading = null;
    let oxfordDict = null;
    let oxfordDictLoading = null;
    // Cache stores { ipa: string, alternatives: string[], source: 'oxford-american'|'ipa-dict'|'cmu'|null }
    const ipaCache = new Map();

    async function loadOxfordDict() {
        if (oxfordDict) return oxfordDict;
        if (oxfordDictLoading) return oxfordDictLoading;

        oxfordDictLoading = (async () => {
            try {
                const response = await fetch(CONFIG.oxfordIpaUrl);
                if (!response.ok) {
                    throw new Error(`Failed to load Oxford-American IPA overrides: ${response.status}`);
                }
                const payload = await response.json();
                oxfordDict = payload && typeof payload === 'object' ? payload : {};
                return oxfordDict;
            } catch (error) {
                console.error('[Phonetics] Oxford-American IPA overrides load failed:', error);
                oxfordDict = {};
                return oxfordDict;
            }
        })();

        return oxfordDictLoading;
    }

    function normalizeLookupKey(word) {
        return String(word || '')
            .normalize('NFC')
            .toLowerCase()
            .trim()
            .replace(/[’]/g, "'")
            .replace(/\s+/g, ' ')
            .replace(/^[^a-z' -]+|[^a-z' -]+$/g, '');
    }

    function isValidLookupKey(word) {
        return /^[a-z][a-z' -]{0,79}$/.test(word);
    }

    function asIPAArray(value) {
        const values = Array.isArray(value)
            ? value
            : value && typeof value === 'object' && Array.isArray(value.variants)
                ? value.variants
                : value && typeof value === 'object' && typeof value.strong === 'string'
                    ? [value.strong, ...(Array.isArray(value.alternatives) ? value.alternatives : [])]
                    : typeof value === 'string'
                        ? [value]
                        : [];
        return [...new Set(values.filter((item) => typeof item === 'string' && /^\/.+\/$/.test(item)))];
    }

    async function lookupOxfordVariants(word) {
        const dict = await loadOxfordDict();
        const normalized = normalizeLookupKey(word);
        if (!isValidLookupKey(normalized)) return [];
        return asIPAArray(dict.entries?.[normalized]);
    }

    async function isOxfordQuarantined(word) {
        const dict = await loadOxfordDict();
        const normalized = normalizeLookupKey(word);
        return Array.isArray(dict.quarantine) && dict.quarantine.includes(normalized);
    }

    async function lookupOxfordFormProfile(word) {
        const dict = await loadOxfordDict();
        const normalized = normalizeLookupKey(word);
        const profile = dict.formProfiles?.[normalized];
        if (!profile || typeof profile !== 'object') return null;
        return {
            strong: typeof profile.strong === 'string' ? profile.strong : '',
            strongAlternatives: Array.isArray(profile.strongAlternatives)
                ? profile.strongAlternatives.filter((value) => typeof value === 'string')
                : [],
            weak: Array.isArray(profile.weak)
                ? profile.weak.filter((value) => value && typeof value.ipa === 'string')
                : []
        };
    }

    // === IPA-DICT (SECONDARY SOURCE) ===

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
        const normalized = normalizeLookupKey(word);

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
    async function lookupCMUVariants(word) {
        const dict = await loadCMUDict();
        const normalized = normalizeLookupKey(word);

        // Unified Guard: Match strictness (1-30 chars)
        if (!/^[a-z][a-z'-]{0,29}$/.test(normalized)) return [];

        const noApostrophe = normalized.replace(/'/g, '');
        const entry = dict[normalized] || dict[noApostrophe];
        if (!entry) return [];
        return (Array.isArray(entry) ? entry : [entry]).filter(
            (pronunciation) => typeof pronunciation === 'string' && pronunciation.trim()
        );
    }

    async function lookupCMU(word) {
        const variants = await lookupCMUVariants(word);
        return variants[0] || null;
    }

    // === FREE DICTIONARY API (LEGACY/UNUSED) ===

    /**
     * Retained as a no-op compatibility hook. IPA no longer comes from a
     * network dictionary API; all learner-facing lookups use the shared local
     * Oxford-American, ipa-dict, and CMU layers above.
     * 
     * @param {string} word 
     * @returns {string|null} IPA transcription or null
     */
    async function lookupDictionary(word) {
        return null;
    }

    // === MAIN API ===

    /**
     * Normalize IPA to the student-facing Oxford American display convention:
     * - Repair stressed schwa only when the full U.S. reference shape agrees.
     * - Remove primary stress from monosyllables, including diphthongs.
     * - Render Oxford length marks, the NURSE vowel /ɜːr/, and turned-r as /r/.
     */
    // ipa-dict occasionally marks weak function-word forms with a primary
    // stress mark. These are lexical/context exceptions, not evidence that
    // every stressed schwa should be rewritten as /ʌ/.
    const NONLEXICAL_STRESS_SCHWA_FORMS = new Map([
        ['ˈðə', 'ðə'],
        ['ˈə', 'ə'],
        ['ˈən', 'ən'],
        ['ˈənd', 'ənd'],
        ['ˈəz', 'əz'],
        ['ˈət', 'ət'],
        ['ˈəv', 'əv'],
        ['ˈðət', 'ðət'],
        ['ˈðən', 'ðən'],
        ['ˈtə', 'tə'],
        ['ˈfrəm', 'frəm']
    ]);

    // Oxford-style American weak forms for common function words. These are
    // metadata-driven forms: the lexical citation form remains available and
    // the connected-speech selector chooses a weak form only by context.
    // Weak forms are lexical, so they keep Oxford's short weak vowels (/ə/,
    // /i/, /u/) rather than the long citation vowels of the strong form.
    const FUNCTION_WORD_FORMS = {
        a: { strong: '/eɪ/', weak: [{ ipa: '/ə/' }] },
        an: { strong: '/æn/', weak: [{ ipa: '/ən/' }] },
        the: {
            strong: '/ðiː/',
            weak: [
                { ipa: '/ðə/', condition: { nextSound: 'consonant' } },
                { ipa: '/ði/', condition: { nextSound: 'vowel' } }
            ]
        },
        to: { strong: '/tuː/', weak: [{ ipa: '/tə/' }] },
        of: { strong: '/ʌv/', weak: [{ ipa: '/əv/' }, { ipa: '/ə/' }] },
        and: {
            strong: '/ænd/',
            weak: [{ ipa: '/ən/' }, { ipa: '/ənd/' }, { ipa: '/n/' }, { ipa: '/t/' }, { ipa: '/d/' }]
        },
        for: { strong: '/fɔːr/', weak: [{ ipa: '/fər/' }] },
        can: { strong: '/kæn/', weak: [{ ipa: '/kən/' }] },
        have: { strong: '/hæv/', weak: [{ ipa: '/həv/' }, { ipa: '/əv/' }, { ipa: '/v/' }] },
        has: { strong: '/hæz/', weak: [{ ipa: '/həz/' }, { ipa: '/əz/' }, { ipa: '/z/' }] },
        had: { strong: '/hæd/', weak: [{ ipa: '/həd/' }] },
        was: { strong: '/wʌz/', weak: [{ ipa: '/wəz/' }] },
        were: { strong: '/wɜːr/', weak: [{ ipa: '/wər/' }] },
        from: {
            strong: '/frʌm/',
            strongAlternatives: ['/frɑːm/'],
            weak: [{ ipa: '/frəm/' }]
        },
        that: { strong: '/ðæt/', weak: [{ ipa: '/ðət/' }] },
        some: { strong: '/sʌm/', weak: [{ ipa: '/səm/' }] },
        as: { strong: '/æz/', weak: [{ ipa: '/əz/' }] },
        at: { strong: '/æt/', weak: [{ ipa: '/ət/' }] },
        than: { strong: '/ðæn/', weak: [{ ipa: '/ðən/' }] },
        but: { strong: '/bʌt/', weak: [{ ipa: '/bət/' }] },
        or: { strong: '/ɔːr/', weak: [{ ipa: '/ər/' }] },
        are: { strong: '/ɑːr/', weak: [{ ipa: '/ər/' }] },
        you: { strong: '/juː/', weak: [{ ipa: '/jə/' }] },
        your: { strong: '/jɔːr/', weak: [{ ipa: '/jər/' }] },
        them: { strong: '/ðem/', weak: [{ ipa: '/ðəm/' }] },
        his: { strong: '/hɪz/', weak: [{ ipa: '/ɪz/' }] },
        her: { strong: '/hɜːr/', weak: [{ ipa: '/hər/' }] },
        do: { strong: '/duː/', weak: [{ ipa: '/də/' }] },
        does: { strong: '/dʌz/', weak: [{ ipa: '/dəz/' }] },
        must: { strong: '/mʌst/', weak: [{ ipa: '/məst/' }] },
        should: { strong: '/ʃʊd/', weak: [{ ipa: '/ʃəd/' }] },
        would: { strong: '/wʊd/', weak: [{ ipa: '/wəd/' }] },
        could: { strong: '/kʊd/', weak: [{ ipa: '/kəd/' }] },
        us: { strong: '/ʌs/', weak: [{ ipa: '/əs/' }] }
    };

    const IPA_VOWEL_NUCLEI = /(?:eɪ|aɪ|ɔɪ|aʊ|oʊ|ɪr|ɛr|ʊr|[iɪeɛæɑɔoʊuəʌɝɚɜ])/g;

    function stripSlashes(value) {
        const text = String(value || '').trim();
        return text.startsWith('/') && text.endsWith('/')
            ? text.slice(1, -1)
            : text;
    }

    function countVowelNuclei(value) {
        return (stripSlashes(value).match(IPA_VOWEL_NUCLEI) || []).length;
    }

    // A stressed schwa directly before /r/ is the NURSE vowel (hurry, curry,
    // burroughs), not a mis-transcribed STRUT. It is repaired by the Oxford
    // transform below, never by the /ʌ/ rule.
    const STRESSED_SCHWA_RE = /ˈ[bcdfghjklmnpqrstvwxyzŋʃʒθðɡrw]*ə(?!r)/;
    const STRESSED_SCHWA_RE_G = /ˈ[bcdfghjklmnpqrstvwxyzŋʃʒθðɡrw]*?ə(?!r)/g;

    function hasStressedSchwa(value) {
        return STRESSED_SCHWA_RE.test(stripSlashes(value));
    }

    function canonicalTokens(value, neutralizeStrut = false) {
        const tokens = [];
        for (const symbol of Array.from(String(value || '').replace(/\//g, ''))) {
            if (/[ˈˌː̯]/.test(symbol)) continue;
            if (symbol === 'ɝ' || symbol === 'ɚ') {
                tokens.push('ə', 'r');
            } else if (symbol === 'ɹ') {
                tokens.push('r');
            } else if (symbol === 'ɡ') {
                tokens.push('g');
            } else if (neutralizeStrut && symbol === 'ʌ') {
                tokens.push('ə');
            } else {
                tokens.push(symbol);
            }
        }
        return tokens;
    }

    function comparableShape(value) {
        return canonicalTokens(value, true).join('');
    }

    function exactComparableShape(value) {
        return canonicalTokens(value, false).join('');
    }

    function replaceSourceBackedStressedSchwa(value, referenceIPA) {
        if (!referenceIPA || !hasStressedSchwa(value)) return value;
        const sourceShape = comparableShape(value);
        const referenceShape = comparableShape(referenceIPA);
        if (sourceShape !== referenceShape || !/ʌ/.test(stripSlashes(referenceIPA))) return value;

        const referenceTokens = canonicalTokens(referenceIPA, false);
        const matches = Array.from(value.matchAll(/ˈ[bcdfghjklmnpqrstvwxyzŋʃʒθðɡrw]*?ə/g));
        let result = value;
        for (const match of matches.reverse()) {
            const schwaOffset = match[0].lastIndexOf('ə');
            const schwaIndex = match.index + schwaOffset;
            const tokenIndex = canonicalTokens(value.slice(0, schwaIndex), false).length;
            if (referenceTokens[tokenIndex] === 'ʌ') {
                result = `${result.slice(0, schwaIndex)}ʌ${result.slice(schwaIndex + 1)}`;
            }
        }
        return result;
    }

    function selectMatchingReferenceIPA(sourceIPA, references) {
        return (references || []).find((referenceIPA) => (
            /ʌ/.test(stripSlashes(referenceIPA))
            && comparableShape(sourceIPA) === comparableShape(referenceIPA)
        )) || '';
    }

    /**
     * Normalize IPA to Oxford American display form without inventing lexical
     * stress or vowel quality. Source-backed vowel repair is enabled only when
     * a matching U.S. reference transcription is supplied.
     */
    function normalizeIPA(ipa, word, options = {}) {
        if (!ipa || typeof ipa !== 'string') return '';
        let cleaned = stripSlashes(ipa);
        const normalizedWord = String(word || '').toLowerCase();
        const sourceBacked = replaceSourceBackedStressedSchwa(cleaned, options.referenceIPA);
        if (sourceBacked !== cleaned) {
            cleaned = sourceBacked;
        } else {
            const weakForm = NONLEXICAL_STRESS_SCHWA_FORMS.get(cleaned);
            if (weakForm && (!word || ['a', 'an', 'and', 'as', 'at', 'for', 'of', 'than', 'that', 'the', 'to'].includes(normalizedWord))) {
                cleaned = weakForm;
            }
        }

        if (countVowelNuclei(cleaned) === 1 && !cleaned.includes('ˌ')) {
            cleaned = cleaned.replace(/ˈ/g, '');
        }

        cleaned = cleaned
            .replace(/[ɝɚ]/g, 'ər')
            .replace(/ɹ/g, 'r')
            .trim();
        return ipa.trim().startsWith('/') ? `/${cleaned}/` : cleaned;
    }

    /**
     * Get IPA transcription for a word
     * 
     * Strategy (order matters!):
     * 1. PRIMARY: Oxford-American reviewed entries and form profiles
     * 2. SECONDARY: ipa-dict dataset
     * 3. FALLBACK: CMU Dictionary (computed/approximate IPA)
     * 
     * @param {string} word - The word to transcribe
     * @returns {Promise<string>} IPA transcription or empty string
     */
    async function getIPA(word) {
        if (!word || typeof word !== 'string') {
            return '';
        }

        const normalized = normalizeLookupKey(word);

        if (!isValidLookupKey(normalized)) return '';

        // Check cache first
        if (CONFIG.cacheEnabled && ipaCache.has(normalized)) {
            const cached = ipaCache.get(normalized);
            return typeof cached === 'object' ? cached.ipa : cached;
        }

        let ipa = '';
        let alternatives = [];
        let source = null;
        let referenceIPAs = [];

        const quarantined = await isOxfordQuarantined(normalized);
        const oxfordResult = quarantined ? [] : await lookupOxfordVariants(normalized);

        // 1. PRIMARY: Oxford-American reviewed entries and aliases.
        if (oxfordResult.length > 0) {
            ipa = oxfordResult[0];
            alternatives = oxfordResult.slice(1);
            source = 'oxford-american';
        }

        // 2. SECONDARY: ipa-dict dataset.
        const ipaDictResult = oxfordResult.length > 0 || quarantined
            ? null
            : await lookupIpaDict(normalized);
        if (!ipa && ipaDictResult && ipaDictResult.length > 0) {
            ipa = ipaDictResult[0];
            alternatives = ipaDictResult.slice(1);
            source = 'ipa-dict';
            log(`ipa-dict (primary): "${normalized}" → ${ipa} (alts: ${alternatives.join(', ')})`);

            // Unambiguous contractions can place a conversational deletion
            // before the full citation form (for example don't /doʊn/ before
            // /doʊnt/). Prefer the ipa-dict variant whose complete segment
            // shape is independently present in the U.S. CMU reference.
            const isUnambiguousContraction = /(?:n't|'(?:re|ve|ll|d|m))$/.test(normalized);
            if (isUnambiguousContraction && typeof arpabetToIPA === 'function') {
                const arpbets = await lookupCMUVariants(normalized);
                referenceIPAs = arpbets.map((arpabet) => arpabetToIPA(arpabet)).filter(Boolean);
                const citationIndex = ipaDictResult.findIndex((variant) => (
                    referenceIPAs.some((referenceIPA) => (
                        exactComparableShape(variant) === exactComparableShape(referenceIPA)
                    ))
                ));
                if (citationIndex > 0) {
                    const ordered = [
                        ipaDictResult[citationIndex],
                        ...ipaDictResult.filter((_variant, index) => index !== citationIndex)
                    ];
                    ipa = ordered[0];
                    alternatives = ordered.slice(1);
                }
            }
        }

        // 3. FALLBACK: Try CMU Dictionary (computed/approximate IPA)
        if (!ipa && !quarantined) {
            const arpbets = await lookupCMUVariants(normalized);
            if (arpbets.length > 0) {
                // Convert ARPABET to IPA using the mapping
                if (typeof arpabetToIPA === 'function') {
                    referenceIPAs = arpbets.map((arpabet) => arpabetToIPA(arpabet)).filter(Boolean);
                    ipa = referenceIPAs[0] || '';
                    source = 'cmu';
                    log(`CMU (approximate): "${normalized}" → ${ipa}`);
                } else {
                    console.warn('[Phonetics] arpabetToIPA function not found');
                }
            }
        }

        // Source-backed normalization: use CMU only to validate a stressed
        // schwa correction in the ipa-dict record. Never rewrite by symbol
        // pattern alone.
        if (referenceIPAs.length === 0 && ipa && /ˈ[^ˈˌ/]*ə/.test(ipa)) {
            const arpbets = await lookupCMUVariants(normalized);
            if (arpbets.length > 0 && typeof arpabetToIPA === 'function') {
                referenceIPAs = arpbets.map((arpabet) => arpabetToIPA(arpabet)).filter(Boolean);
            }
        }

        // Safety normalization: convert to Oxford American display form.
        if (ipa) {
            const primaryReference = selectMatchingReferenceIPA(ipa, referenceIPAs);
            ipa = normalizeIPA(ipa, normalized, { referenceIPA: primaryReference });
            alternatives = alternatives
                .map((variant) => normalizeIPA(variant, normalized, {
                    referenceIPA: selectMatchingReferenceIPA(variant, referenceIPAs)
                }))
                .filter((variant, index, values) => variant && variant !== ipa && values.indexOf(variant) === index);
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
     * @returns {Promise<{ipa: string, alternatives: string[], source: 'oxford-american'|'ipa-dict'|'cmu'|null, isApproximate: boolean}>}
     */
    async function getIPAWithSource(word) {
        const normalized = normalizeLookupKey(word);

        if (!isValidLookupKey(normalized)) {
            return { ipa: '', alternatives: [], source: null, isApproximate: false };
        }

        // Ensure word is looked up (populates cache)
        await getIPA(normalized);

        const cached = ipaCache.get(normalized);

        if (cached && typeof cached === 'object') {
            const profile = FUNCTION_WORD_FORMS[normalized] || await lookupOxfordFormProfile(normalized);
            const explicitFormAlternatives = profile
                ? [
                    ...(profile.strongAlternatives || []),
                    ...(profile.weak || []).map((form) => form.ipa)
                ]
                : [];
            const alternatives = [...new Set([
                ...(cached.alternatives || []),
                ...explicitFormAlternatives
            ])].filter((variant) => variant && variant !== cached.ipa);
            return {
                ipa: cached.ipa,
                alternatives,
                source: cached.source,
                isApproximate: cached.source === 'cmu'
            };
        }

        return { ipa: '', alternatives: [], source: null, isApproximate: false };
    }

    function formConditionMatches(condition, context) {
        if (!condition) return true;
        if (condition.nextSound && condition.nextSound !== context.nextSound) return false;
        return true;
    }

    /**
     * Return explicit citation/strong and weak forms for dictionary and
     * connected-speech consumers. Strong is selected for isolated use; weak is
     * selected only for connected speech when its condition matches.
     */
    async function getPronunciations(word, context = {}) {
        const normalized = normalizeLookupKey(word);
        const base = await getIPAWithSource(normalized);
        const profile = FUNCTION_WORD_FORMS[normalized] || await lookupOxfordFormProfile(normalized);
        if (!profile) {
            const citation = {
                id: `${normalized}:citation`,
                formRole: 'citation',
                ipa: base.ipa,
                source: base.source,
                isApproximate: base.isApproximate,
                acceptedContexts: ['isolated', 'connectedSpeech']
            };
            return {
                word: normalized,
                dialect: 'en-US',
                forms: base.ipa ? [citation] : [],
                selected: citation.ipa ? citation : null
            };
        }

        const strongForms = [profile.strong || base.ipa, ...(profile.strongAlternatives || [])]
            .filter(Boolean)
            .map((ipa, index) => ({
                id: index === 0 ? `${normalized}:strong` : `${normalized}:strong:${index + 1}`,
                formRole: 'strong',
                ipa,
                source: profile.strong ? 'oxford-american-form' : base.source,
                isApproximate: profile.strong ? false : base.isApproximate,
                acceptedContexts: ['isolated', 'connectedSpeech']
            }));
        const strong = strongForms[0];
        const weak = profile.weak.map((form, index) => ({
            id: `${normalized}:weak:${index + 1}`,
            formRole: 'weak',
            ipa: form.ipa,
            source: 'oxford-american-form',
            isApproximate: false,
            condition: form.condition || null,
            acceptedContexts: ['connectedSpeech']
        }));
        const forms = [...strongForms, ...weak];
        const isConnected = context.context === 'connectedSpeech';
        const selectedWeak = isConnected && context.isEmphasized !== true
            ? weak.find((form) => formConditionMatches(form.condition, context))
            : null;
        return {
            word: normalized,
            dialect: 'en-US',
            forms,
            selected: selectedWeak || strong
        };
    }

    /**
     * Preload the Oxford-American layer, ipa-dict, and CMU fallback dictionaries.
     */
    async function preload() {
        await Promise.all([loadOxfordDict(), loadIpaDict(), loadCMUDict()]);
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
        getPronunciations,
        normalizeIPA,
        preload,
        clearCache,

        // For debugging
        _lookupIpaDict: lookupIpaDict,
        _lookupOxfordVariants: lookupOxfordVariants,
  