const IPA_VOWEL_NUCLEI = /(?:eɪ|aɪ|ɔɪ|aʊ|oʊ|[iɪeɛæɑɔoʊuəʌɝɚɜ])ː?/g;

export function primaryStressPosition(ipa) {
    const stripped = String(ipa || '').replace(/^\/|\/$/g, '');
    const stressPos = stripped.indexOf('ˈ');
    if (stressPos < 0) return -1;
    const before = stripped.slice(0, stressPos);
    const nuclei = before.match(IPA_VOWEL_NUCLEI);
    return nuclei ? nuclei.length : 0;
}

export function matchLearnerIPA(variant, candidates) {
    if (candidates.length === 0) return '';
    if (candidates.length === 1) return candidates[0];
    if (!Number.isInteger(variant.primaryStress)) return candidates[0];

    for (const candidate of candidates) {
        if (primaryStressPosition(candidate) === variant.primaryStress) {
            return candidate;
        }
    }
    return candidates[0];
}
