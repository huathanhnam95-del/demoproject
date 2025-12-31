/**
 * ARPABET to IPA Mapping and Conversion
 * 
 * CMU Pronouncing Dictionary uses ARPABET notation with stress markers (0, 1, 2)
 * 
 * Stress rules:
 * - 0 = no stress (unstressed)
 * - 1 = primary stress (ˈ) - placed before syllable
 * - 2 = secondary stress (ˌ) - placed before syllable
 * - Monosyllabic words (1 vowel) = NO stress mark shown
 * - Stress marks appear BEFORE the syllable onset, not the vowel
 */

// === BASE PHONEME MAPPINGS (no stress marks) ===
const ARPABET_VOWELS = {
    // Vowels - base forms (stress handled separately)
    'AA': 'ɑ',   // "odd"
    'AE': 'æ',   // "at"
    'AH': 'ʌ',   // "hut" (stressed) / "ə" (unstressed)
    'AO': 'ɔ',   // "ought"
    'AW': 'aʊ',  // "cow"
    'AY': 'aɪ',  // "hide"
    'EH': 'ɛ',   // "ed"
    'ER': 'ɝ',   // "hurt" (stressed) / "ɚ" (unstressed)
    'EY': 'eɪ',  // "ate"
    'IH': 'ɪ',   // "it"
    'IY': 'i',   // "eat"
    'OW': 'oʊ',  // "oat"
    'OY': 'ɔɪ',  // "toy"
    'UH': 'ʊ',   // "hood"
    'UW': 'u',   // "two"
};

const ARPABET_CONSONANTS = {
    // Stops
    'B': 'b',
    'D': 'd',
    'G': 'g',    // User spec: g
    'K': 'k',
    'P': 'p',
    'T': 't',

    // Affricates
    'CH': 'tʃ',
    'JH': 'dʒ',

    // Fricatives
    'DH': 'ð',
    'F': 'f',
    'HH': 'h',
    'S': 's',
    'SH': 'ʃ',
    'TH': 'θ',
    'V': 'v',
    'Z': 'z',
    'ZH': 'ʒ',

    // Nasals
    'M': 'm',
    'N': 'n',
    'NG': 'ŋ',

    // Liquids
    'L': 'l',
    'R': 'r',    // User spec: r

    // Semivowels/Glides
    'W': 'w',
    'Y': 'j',
};

/**
 * Parse ARPABET phoneme into base + stress
 * @param {string} phoneme - e.g., "AH1", "T", "OW0"
 * @returns {{ base: string, stress: number|null, isVowel: boolean }}
 */
function parseArpabetPhoneme(phoneme) {
    const upper = phoneme.toUpperCase();

    // Check if ends with stress number (0, 1, 2)
    const stressMatch = upper.match(/^([A-Z]+)([012])$/);

    if (stressMatch) {
        const base = stressMatch[1];
        const stress = parseInt(stressMatch[2], 10);
        return { base, stress, isVowel: true };
    }

    // No stress number - it's a consonant
    return { base: upper, stress: null, isVowel: false };
}

/**
 * Get IPA for a vowel, handling AH/ER special cases
 * @param {string} base - Base vowel (e.g., "AH", "ER")
 * @param {number} stress - Stress level (0, 1, 2)
 * @returns {string} IPA vowel
 */
function getVowelIPA(base, stress) {
    // Special case: AH0 = schwa (ə), AH1/AH2 = ʌ
    if (base === 'AH') {
        return stress === 0 ? 'ə' : 'ʌ';
    }

    // Special case: ER0 = ɚ (unstressed rhotic), ER1/ER2 = ɝ
    if (base === 'ER') {
        return stress === 0 ? 'ɚ' : 'ɝ';
    }

    return ARPABET_VOWELS[base] || '';
}

/**
 * Convert ARPABET phoneme string to IPA with correct stress placement
 * 
 * Rules:
 * - Monosyllabic words (1 vowel): NO stress marks
 * - Stress marks placed before syllable onset (before consonants leading to vowel)
 * - Primary stress (1) = ˈ
 * - Secondary stress (2) = ˌ
 * 
 * @param {string} arpabet - Space-separated ARPABET phonemes (e.g., "HH AH0 L OW1")
 * @returns {string} IPA transcription with slashes (e.g., "/həˈloʊ/")
 */
function arpabetToIPA(arpabet) {
    if (!arpabet || typeof arpabet !== 'string') {
        return '';
    }

    const phonemes = arpabet.trim().split(/\s+/);

    // Parse all phonemes
    const parsed = phonemes.map(p => {
        const { base, stress, isVowel } = parseArpabetPhoneme(p);
        let ipa = '';

        if (isVowel) {
            ipa = getVowelIPA(base, stress);
        } else {
            ipa = ARPABET_CONSONANTS[base] || '';
        }

        return { base, stress, isVowel, ipa };
    });

    // Count vowels to determine if monosyllabic
    const vowelCount = parsed.filter(p => p.isVowel).length;
    const isMonosyllabic = vowelCount <= 1;

    // Build IPA string with correct stress placement
    let result = '';
    let pendingStress = null;  // Stress to insert before next syllable

    for (let i = 0; i < parsed.length; i++) {
        const current = parsed[i];

        if (current.isVowel) {
            // Before outputting this syllable, check if we need to go back
            // and insert stress before the syllable onset (consonants before this vowel)

            if (!isMonosyllabic && current.stress && current.stress > 0) {
                // Find where this syllable starts (first consonant after previous vowel)
                let syllableStart = i;

                // Walk backwards to find consonants that belong to this syllable
                // These are consonants immediately before this vowel
                for (let j = i - 1; j >= 0; j--) {
                    if (parsed[j].isVowel) {
                        break; // Stop at previous vowel
                    }
                    syllableStart = j;
                }

                // Calculate where to insert stress mark in result string
                // We need to count how many IPA characters we've added since syllableStart
                let charsToGoBack = 0;
                for (let j = syllableStart; j < i; j++) {
                    charsToGoBack += parsed[j].ipa.length;
                }

                // Insert stress mark
                const stressMark = current.stress === 1 ? 'ˈ' : 'ˌ';
                const insertPos = result.length - charsToGoBack;
                result = result.slice(0, insertPos) + stressMark + result.slice(insertPos);
            }

            result += current.ipa;
        } else {
            // Consonant - just add it
            result += current.ipa;
        }
    }

    return result ? `/${result}/` : '';
}

// Legacy compatibility - create the old-style map for any code that might use it directly
const ARPABET_TO_IPA = {};
for (const [key, val] of Object.entries(ARPABET_VOWELS)) {
    ARPABET_TO_IPA[key] = val;
    ARPABET_TO_IPA[key + '0'] = val;
    ARPABET_TO_IPA[key + '1'] = val;
    ARPABET_TO_IPA[key + '2'] = val;
}
for (const [key, val] of Object.entries(ARPABET_CONSONANTS)) {
    ARPABET_TO_IPA[key] = val;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ARPABET_TO_IPA, arpabetToIPA, ARPABET_VOWELS, ARPABET_CONSONANTS };
}

// Also expose globally for browser usage
if (typeof window !== 'undefined') {
    window.ARPABET_TO_IPA = ARPABET_TO_IPA;
    window.arpabetToIPA = arpabetToIPA;
}
