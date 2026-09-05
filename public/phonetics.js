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
        const symbols = Array.from(String(value || '').replace(/\//g, ''));
        for (let index = 0; index < symbols.length; index += 1) {
            const symbol = symbols[index];
            if (/[ˈˌː̯]/.test(symbol)) continue;
            // Compare pre- and post-Oxford spellings on the same footing: the
            // r-coloured vowels all reduce to schwa + r exactly once, so
            // /ɜːr/, /ɝ/ and /ər/ share one shape.
            if (symbol === 'ɝ' || symbol === 'ɚ' || symbol === 'ɜ') {
                tokens.push('ə');
                if (symbols[index + 1] !== 'r' && symbols[index + 2] !== 'r') tokens.push('r');
            } else if (symbol === 'ɛ') {
                tokens.push('e');
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
        const matches = Array.from(value.matchAll(STRESSED_SCHWA_RE_G));
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

    // === SYLLABIC CONSONANTS ===

    // Oxford writes a syllabic /n/ after coronal obstruents and /f v/
    // (button /ˈbʌtn/, listen /ˈlɪsn/, seven /ˈsevn/) but keeps the schwa after
    // labials and velars (open /ˈoʊpən/, bacon /ˈbeɪkən/).
    const SYLLABIC_N_TRIGGERS = new Set(['t', 'd', 's', 'z', 'ʃ', 'ʒ', 'θ', 'ð', 'f', 'v']);
    // Syllabic /l/ follows obstruents and nasals, but not liquids or glides:
    // barrel /ˈbærəl/ and usual /ˈjuːʒuəl/ keep their schwa.
    const SYLLABIC_L_BLOCKERS = new Set(['r', 'ɹ', 'l', 'w', 'j']);
    // Only voiced inflections attach to a syllabic consonant. Allowing /s/ here
    // would swallow stem-final clusters such as sentence /ˈsentəns/.
    const SYLLABIC_INFLECTION = '(z|d|ɪŋ)?';
    const SYLLABIC_N_RE = new RegExp(`([a-zɡʃʒθðŋ])ən${SYLLABIC_INFLECTION}$`, 'u');
    const SYLLABIC_L_RE = new RegExp(`([a-zɡʃʒθðŋmn])əl${SYLLABIC_INFLECTION}$`, 'u');
    const FULL_VOWELS = 'aeiouɪʊæɑɔʌɜ';

    /**
     * Collapse /ən/ and /əl/ to syllabic /n/ and /l/ in Oxford's word-final
     * contexts. Restricted to the end of the word (optionally plus one voiced
     * inflection) because medial cases are not mechanically predictable.
     */
    function applySyllabicConsonants(value) {
        let result = value.replace(SYLLABIC_N_RE, (match, consonant, inflection) => (
            SYLLABIC_N_TRIGGERS.has(consonant) ? `${consonant}n${inflection || ''}` : match
        ));

        result = result.replace(SYLLABIC_L_RE, (match, consonant, inflection) => {
            if (SYLLABIC_L_BLOCKERS.has(consonant)) return match;
            // In /ənəl/ the /n/ takes the syllable and the schwa stays
            // (national /ˈnæʃnəl/); after a full vowel the /l/ takes it
            // (tunnel /ˈtʌnl/).
            const index = result.lastIndexOf(match);
            const preceding = index > 0 ? result[index - 1] : '';
            if (consonant === 'n' && preceding && !FULL_VOWELS.includes(preceding)) return match;
            return `${consonant}l${inflection || ''}`;
        });

        // In a monosyllable the schwa is the nucleus, not a reduction: cull
        // /ˈkəl/ and chun /ˈtʃən/ must not collapse to /kl/ and /tʃn/.
        if (countVowelNuclei(result) === 0 && countVowelNuclei(value) > 0) {
            return value;
        }

        return result;
    }

    function selectMatchingReferenceIPA(sourceIPA, references) {
        return (references || []).find((referenceIPA) => (
            /ʌ/.test(stripSlashes(referenceIPA))
            && comparableShape(sourceIPA) === comparableShape(referenceIPA)
        )) || '';
    }

    // === OXFORD AMERICAN NOTATION ===

    // Two-symbol nuclei must be consumed whole so the stress walker never
    // mistakes the second half of /eɪ/ or /oʊ/ for a following vowel.
    const OXFORD_DIPHTHONGS = ['eɪ', 'aɪ', 'ɔɪ', 'aʊ', 'oʊ'];
    const OXFORD_NUCLEI = new Set(['i', 'ɪ', 'e', 'ɛ', 'æ', 'ɑ', 'ɔ', 'o', 'ʊ', 'u', 'ə', 'ʌ', 'ɝ', 'ɚ', 'ɜ']);

    /**
     * Rewrite an American transcription into Oxford American display notation:
     * long vowels carry /ː/, DRESS is /e/, and a stressed r-coloured vowel
     * becomes /ɜːr/ while an unstressed one stays /ər/.
     *
     * Stress is read from the marks already present, so this must run before
     * monosyllabic stress marks are stripped.
     */
    function toOxfordAmerican(value) {
        if (!value) return '';
        let cleaned = String(value)
            .replace(/ɹ/g, 'r')
            .replace(/:/g, 'ː')
            .replace(/[\u0361\u035C\u0329]/g, '')
            .replace(/ɾ/g, 't')
            .replace(/ɡ/g, 'g')
            .replace(/[0-9]/g, '');
        if (/ː/.test(cleaned)) {
            return cleaned.replace(/ɛ/g, 'e').replace(/ɚ/g, 'ər').replace(/ɝ/g, 'ɜːr');
        }

        const symbols = Array.from(cleaned);
        const out = [];
        let stressPending = false;
        let primaryPending = false;

        const nucleusAt = (index) => {
            const pair = symbols[index] + (symbols[index + 1] || '');
            if (OXFORD_DIPHTHONGS.includes(pair)) return pair;
            return OXFORD_NUCLEI.has(symbols[index]) ? symbols[index] : '';
        };

        for (let index = 0; index < symbols.length; index += 1) {
            const symbol = symbols[index];
            if (symbol === 'ˈ' || symbol === 'ˌ') {
                stressPending = true;
                primaryPending = symbol === 'ˈ';
                out.push(symbol);
                continue;
            }
            const nucleus = nucleusAt(index);
            if (!nucleus) {
                out.push(symbol);
                continue;
            }

            const isStressed = stressPending;
            const isPrimary = primaryPending;
            stressPending = false;
            primaryPending = false;
            index += nucleus.length - 1;
            const followedByR = symbols[index + 1] === 'r' || symbols[index + 1] === 'ɹ';
            const next = symbols[index + 1];
            // Phrase entries ("ice cream", "any more") end a word at a space or
            // hyphen, not only at the end of the string.
            const wordFinal = index === symbols.length - 1 || next === ' ' || next === '-';

            if (nucleus === 'ɝ' || nucleus === 'ɚ' || nucleus === 'ɜ') {
                // ipa-dict writes /ɝ/ in stressed and unstressed slots alike, so
                // position decides between NURSE and the weak r-coloured schwa.
                out.push(isStressed ? 'ɜːr' : 'ər');
                if (followedByR) index += 1;
            } else if (nucleus === 'ə' && followedByR && isStressed) {
                // hurry, curry, burroughs: NURSE written as a bare schwa.
                out.push('ɜːr');
                index += 1;
            } else if (nucleus === 'ɛ') {
                out.push('e');
            } else if (nucleus === 'ɑ' || nucleus === 'ɔ') {
                out.push(`${nucleus}ː`);
            } else if (nucleus === 'i') {
                // Oxford's weak /i/ covers every unstressed slot: happy,
                // radio, anti-, accompaniment. Unstressed FLEECE is vanishingly
                // rare, so stress alone decides length. Final -y stays weak
                // even when the corpus marks it with secondary stress
                // (probably, library); only a primary stress lengthens it.
                out.push(isStressed && (isPrimary || !wordFinal) ? 'iː' : 'i');
            } else if (nucleus === 'u') {
                // Weak /u/ is the unstressed medial vowel (situation,
                // occupation, regulation). Word-finally Oxford keeps GOOSE:
                // menu, value, argue, into.
                out.push(isStressed || wordFinal ? 'uː' : 'u');
            } else {
                out.push(nucleus);
            }
        }
        return out.join('');
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

        // Oxford notation is applied while the stress marks are still present,
        // because /ɜːr/ versus /ər/ depends on them.
        cleaned = toOxfordAmerican(cleaned.replace(/ɹ/g, 'r'));

        if (countVowelNuclei(cleaned) === 1 && !cleaned.includes('ˌ')) {
            cleaned = cleaned.replace(/ˈ/g, '');
        }

        // Syllabic consonants come last: they remove a schwa nucleus, and
        // running them earlier made button /ˈbʌtən/ look monosyllabic and lose
        // its stress mark.
        cleaned = applySyllabicConsonants(cleaned).trim();
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

            // ipa-dict orders variants arbitrarily and often lists a
            // conversational deletion first (don't /doʊn/, next /nɛks/, going
            // /ˈɡoʊɪn/, mostly /ˈmoʊsli/). Learners must be shown the citation
            // form, so promote the variant whose complete segment shape is
            // independently attested in the U.S. CMU reference.
            if (ipaDictResult.length > 1 && typeof arpabetToIPA === 'function') {
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

        // A function word looked up on its own is being shown in isolation, so
        // its citation form wins. Without this, getIPA and getPronunciations
        // disagreed on words whose corpus entry records a weak form first.
        const functionWordStrong = FUNCTION_WORD_FORMS[normalized]?.strong;
        if (functionWordStrong && !quarantined && functionWordStrong !== ipa) {
            alternatives = [ipa, ...alternatives].filter(
                (variant, index, values) => variant && variant !== functionWordStrong && values.indexOf(variant) === index
            );
            ipa = functionWordStrong;
            source = 'oxford-american-form';
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
            const profile = normalizeFormProfile(
                FUNCTION_WORD_FORMS[normalized] || await lookupOxfordFormProfile(normalized),
                normalized
            );
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
    // Form profiles are authored data, so they are rendered through the same
    // Oxford transform as corpus entries. Without this the strong/weak forms
    // were the one surface that could still emit pre-Oxford notation.
    function normalizeFormProfile(profile, word) {
        if (!profile) return profile;
        return {
            strong: profile.strong ? normalizeIPA(profile.strong, word) : profile.strong,
            strongAlternatives: (profile.strongAlternatives || []).map((ipa) => normalizeIPA(ipa, word)),
            weak: (profile.weak || []).map((form) => ({ ...form, ipa: normalizeIPA(form.ipa, word) }))
        };
    }

    async function getPronunciations(word, context = {}) {
        const normalized = normalizeLookupKey(word);
        const base = await getIPAWithSource(normalized);
        const profile = normalizeFormProfile(
            FUNCTION_WORD_FORMS[normalized] || await lookupOxfordFormProfile(normalized),
            normalized
        );
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
        toOxfordAmerican,
        preload,
        clearCache,

        // For debugging
        _lookupIpaDict: lookupIpaDict,
        _lookupOxfordVariants: lookupOxfordVariants,
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
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Phonetics;
}
