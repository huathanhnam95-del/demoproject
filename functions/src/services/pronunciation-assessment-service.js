const fs = require('fs');
const path = require('path');
const { readScore, readAssessmentField, normalizeFinalResult } = require('./azure-speech/normalize');

// === Oxford American IPA Normalization & Articulatory Coaching ===

const OXFORD_DIPHTHONGS = ['eɪ', 'aɪ', 'ɔɪ', 'aʊ', 'oʊ'];
const OXFORD_NUCLEI = new Set(['i', 'ɪ', 'e', 'ɛ', 'æ', 'ɑ', 'ɔ', 'o', 'ʊ', 'u', 'ə', 'ʌ', 'ɝ', 'ɚ', 'ɜ']);

/**
 * Normalizes an IPA string to standard Oxford American English IPA notation.
 * Converts turned-r ɹ -> r, flap ɾ -> t, /ɚ/ -> /ər/, /ɝ/ -> /ɜːr/, /ɛ/ -> /e/,
 * restores length marks, and removes diacritical tie-bars.
 * @param {string} ipa
 * @returns {string}
 */
function normalizeToOxfordAmericanIPA(ipa) {
    if (!ipa || typeof ipa !== 'string') return '';
    const hasSlashes = ipa.trim().startsWith('/') && ipa.trim().endsWith('/');
    let cleaned = ipa.trim().replace(/^\/+|\/+$/g, '');

    // 1. Standardize Azure IPA artifacts
    cleaned = cleaned
        .replace(/ɹ/g, 'r')
        .replace(/:/g, 'ː')
        .replace(/[\u0361\u035C\u0329]/g, '') // tie bars & syllabic diacritic
        .replace(/ɾ/g, 't')
        .replace(/ɡ/g, 'g')
        .replace(/[0-9]/g, '')
        .replace(/'/g, 'ˈ');

    // 2. Direct phoneme / syllable mappings
    if (/ː/.test(cleaned)) {
        cleaned = cleaned.replace(/ɛ/g, 'e').replace(/ɚ/g, 'ər').replace(/ɝ/g, 'ɜːr');
    } else {
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
            const wordFinal = index === symbols.length - 1 || next === ' ' || next === '-';

            if (nucleus === 'ɝ') {
                out.push('ɜːr');
                if (followedByR) index += 1;
            } else if (nucleus === 'ɚ' || nucleus === 'ɜ') {
                out.push(isStressed ? 'ɜːr' : 'ər');
                if (followedByR) index += 1;
            } else if (nucleus === 'ə' && followedByR && isStressed) {
                out.push('ɜːr');
                index += 1;
            } else if (nucleus === 'ɛ') {
                out.push('e');
            } else if (nucleus === 'ɑ' || nucleus === 'ɔ') {
                out.push(`${nucleus}ː`);
            } else if (nucleus === 'i') {
                out.push(isStressed && (isPrimary || !wordFinal) ? 'iː' : 'i');
            } else if (nucleus === 'u') {
                out.push(isStressed || wordFinal ? 'uː' : 'u');
            } else {
                out.push(nucleus);
            }
        }
        cleaned = out.join('');
    }

    cleaned = cleaned.trim();
    return hasSlashes ? `/${cleaned}/` : cleaned;
}

/**
 * Normalizes all /ipa/ tokens inside a text passage.
 * @param {string} text
 * @returns {string}
 */
function normalizeIPAsInText(text) {
    if (!text || typeof text !== 'string') return '';
    return text.replace(/\/([^/\s]+)\//g, (m, ipa) => `/${normalizeToOxfordAmericanIPA(ipa).replace(/^\/+|\/+$/g, '')}/`);
}

/**
 * Articulatory coaching table for Vietnamese L1 / ESL learners.
 */
const ARTICULATORY_COACHING = [
    // /f/ -> /t/
    {
        match: (exp, hrd) => exp === 'f' && hrd === 't',
        obs: 'You stopped the air with your tongue like "at"',
        tip: 'Rest your upper teeth lightly on your lower lip and blow air out steadily without stopping it.'
    },
    // /f/ -> /p/
    {
        match: (exp, hrd) => exp === 'f' && hrd === 'p',
        obs: 'You popped your lips together like "p"',
        tip: 'Rest your upper teeth lightly on your lower lip and blow air out—don\'t press both lips together.'
    },
    // General /f/
    {
        match: (exp) => exp === 'f',
        obs: 'Upper teeth lost light contact with lower lip',
        tip: 'Rest your upper teeth lightly on your lower lip and blow air out steadily.'
    },
    // /v/ -> /b/ or /w/
    {
        match: (exp, hrd) => exp === 'v' && (hrd === 'b' || hrd === 'w'),
        obs: (exp, hrd) => `You closed your lips like "${hrd}" instead of using your teeth`,
        tip: 'Bite your lower lip gently with your front teeth and turn on your vocal cords to make a buzzing "vvv".'
    },
    // General /v/
    {
        match: (exp) => exp === 'v',
        obs: 'Lower lip didn\'t buzz against upper teeth',
        tip: 'Bite your lower lip gently with your front teeth and let your voice vibrate through.'
    },
    // /w/ -> /v/
    {
        match: (exp, hrd) => exp === 'w' && hrd === 'v',
        obs: 'Your teeth touched your lip like "v"',
        tip: 'Round your lips into a tight small circle like you\'re about to whistle—don\'t let your teeth touch your lip.'
    },
    // General /w/
    {
        match: (exp) => exp === 'w',
        obs: 'Lips weren\'t rounded into a circle',
        tip: 'Round your lips forward into a small circle like you\'re whistling.'
    },
    // /θ/ (unvoiced th)
    {
        match: (exp) => exp === 'θ',
        obs: 'Tongue didn\'t go between front teeth for the soft "th"',
        tip: 'Put the tip of your tongue gently between your front teeth and blow air through.'
    },
    // /ð/ (voiced th)
    {
        match: (exp) => exp === 'ð',
        obs: 'Tongue didn\'t buzz between front teeth for the voiced "th"',
        tip: 'Put the tip of your tongue gently between your front teeth and buzz with your voice.'
    },
    // /s/ -> /t/ or /d/
    {
        match: (exp, hrd) => exp === 's' && (hrd === 't' || hrd === 'd'),
        obs: 'You stopped the airflow like a tap instead of keeping the "sss" going',
        tip: 'Keep your teeth lightly together and let air hiss smoothly over the center of your tongue.'
    },
    // /s/ -> /ʃ/
    {
        match: (exp, hrd) => exp === 's' && hrd === 'ʃ',
        obs: 'Flared your lips into a "sh" sound',
        tip: 'Keep your lips relaxed and tongue tip near your upper teeth for a clean, sharp "sss".'
    },
    // General /s/
    {
        match: (exp) => exp === 's',
        obs: (exp, hrd) => hrd === 'r'
            ? 'Curled your tongue into an "r" instead of a clean "s"'
            : 'Lost the continuous hissing "sss" airflow',
        tip: 'Keep your teeth close and blow a continuous stream of air over the tip of your tongue.'
    },
    // /z/ -> ending omission or /s/, /t/, /r/, etc.
    {
        match: (exp) => exp === 'z',
        obs: (exp, hrd) => hrd === 's'
            ? 'Sounded whispery like an unvoiced "s" without voice vibration'
            : (hrd === 'r' || hrd === 't' || hrd === 'd' || !hrd
                ? 'The ending "s" was dropped or swallowed'
                : 'Ending sound lacked vocal cord vibration'),
        tip: 'Don\'t forget the ending "s"—make a buzzing bee "zzz" sound at the end.'
    },
    // /d/ -> /p/ or /b/
    {
        match: (exp, hrd) => exp === 'd' && (hrd === 'p' || hrd === 'b'),
        obs: (exp, hrd) => `You closed your lips like "${hrd}" instead of tapping your tongue`,
        tip: 'Tap the tip of your tongue against the roof of your mouth just behind your upper front teeth—keep your lips apart.'
    },
    // /d/ -> /t/
    {
        match: (exp, hrd) => exp === 'd' && hrd === 't',
        obs: 'Sounded like a dry "t" without vocal vibration',
        tip: 'Tap your tongue behind your top front teeth while humming with your vocal cords.'
    },
    // General /d/
    {
        match: (exp) => exp === 'd',
        obs: 'Tongue tip didn\'t bounce with vocal cord vibration',
        tip: 'Tap the tip of your tongue against the ridge behind your upper front teeth with a voiced bounce.'
    },
    // /t/ -> /d/
    {
        match: (exp, hrd) => exp === 't' && hrd === 'd',
        obs: 'Sounded voiced like "d" instead of a crisp /t/',
        tip: 'Tap the tip of your tongue quickly behind your front teeth and release a tiny, crisp puff of unvoiced air.'
    },
    // General /t/
    {
        match: (exp) => exp === 't',
        obs: 'Didn\'t release a crisp puff of air',
        tip: 'Tap the tip of your tongue against the bumpy ridge behind your front teeth with a crisp puff of air.'
    },
    // /p/ -> /b/
    {
        match: (exp, hrd) => exp === 'p' && hrd === 'b',
        obs: 'Sounded voiced like "b" instead of "p"',
        tip: 'Press your lips together and release with a light puff of unvoiced air (like whispering "pop").'
    },
    // General /p/
    {
        match: (exp) => exp === 'p',
        obs: 'Lips didn\'t pop open with unvoiced air',
        tip: 'Press both lips together firmly and pop them open with a puff of unvoiced air.'
    },
    // /b/ -> /p/
    {
        match: (exp, hrd) => exp === 'b' && hrd === 'p',
        obs: 'Sounded whispery like "p" without vocal vibration',
        tip: 'Press your lips together and turn on your vocal cords right as you release the sound.'
    },
    // General /b/
    {
        match: (exp) => exp === 'b',
        obs: 'Lips didn\'t voice the burst cleanly',
        tip: 'Press your lips together and hum in your throat as you open your lips.'
    },
    // /k/ -> /g/
    {
        match: (exp, hrd) => exp === 'k' && hrd === 'g',
        obs: 'Sounded voiced like "g" instead of /k/',
        tip: 'Tap the back of your tongue against your soft palate and let out a quick, dry puff of air.'
    },
    // General /k/
    {
        match: (exp) => exp === 'k',
        obs: 'Back of tongue didn\'t pop cleanly against soft palate',
        tip: 'Tap the back of your tongue against the roof of your mouth with a dry puff of air.'
    },
    // /g/ -> /k/
    {
        match: (exp, hrd) => exp === 'g' && hrd === 'k',
        obs: 'Sounded unvoiced like "k" instead of /g/',
        tip: 'Tap the back of your tongue against your soft palate while engaging your vocal cords.'
    },
    // General /g/
    {
        match: (exp) => exp === 'g',
        obs: 'Back of tongue didn\'t voice the release',
        tip: 'Tap the back of your tongue against your soft palate with a voiced burst.'
    },
    // /l/
    {
        match: (exp) => exp === 'l',
        obs: (exp, hrd) => `The "l" sound was swallowed or replaced by /${hrd}/`,
        tip: 'Press the tip of your tongue firmly against the ridge behind your upper teeth.'
    },
    // /r/, /ər/, /ɜːr/
    {
        match: (exp) => exp === 'r' || exp === 'ər' || exp === 'ɜːr',
        obs: 'Sounded a bit flat without the American "r"',
        tip: 'Curl the tip of your tongue slightly backward and pull it back to get that rich American "r".'
    },
    // /ə/ -> /r/
    {
        match: (exp, hrd) => exp === 'ə' && hrd === 'r',
        obs: 'Curled your tongue into an "r"',
        tip: 'Relax your tongue flat in the middle of your mouth for a neutral "uh"—don\'t curl it backward.'
    },
    // /ə/ (schwa) general
    {
        match: (exp) => exp === 'ə',
        obs: (exp, hrd) => /[aeiouɪʊæɑɔʌ]/.test(hrd)
            ? 'Vowel shifted away from a relaxed schwa'
            : 'Schwa vowel was interrupted or swallowed',
        tip: 'Relax your tongue and jaw completely—make a very short, effortless "uh".'
    },
    // /ŋ/ -> /n/
    {
        match: (exp, hrd) => exp === 'ŋ' && hrd === 'n',
        obs: 'Sounded like "n" instead of the nasal "ng"',
        tip: 'Raise the back of your tongue against your soft palate and let the sound resonate through your nose.'
    },
    // /ʃ/ (SH)
    {
        match: (exp) => exp === 'ʃ',
        obs: 'Lips weren\'t flared for a shushing "sh"',
        tip: 'Flare your lips outward and blow air through your teeth like you\'re shushing someone ("shh").'
    },
    // /tʃ/ (CH)
    {
        match: (exp) => exp === 'tʃ',
        obs: 'Didn\'t release an energetic sneeze-like burst',
        tip: 'Start with your tongue on the roof of your mouth and release with an energetic burst of air like a sneeze ("ch").'
    },
    // /dʒ/ (J)
    {
        match: (exp) => exp === 'dʒ',
        obs: 'Didn\'t buzz with a voiced release',
        tip: 'Press your tongue against the roof of your mouth and release with a voiced, buzzing burst ("j").'
    },
    // /æ/ (TRAP vowel)
    {
        match: (exp) => exp === 'æ',
        obs: (exp, hrd) => (hrd === 'ə' || hrd === 'ʌ' || hrd === 'e')
            ? 'Mouth wasn\'t open enough'
            : 'Mouth shape was too closed',
        tip: 'Drop your jaw lower and open your mouth wide, like at the doctor saying "ah".'
    },
    // /iː/ or /i/ (FLEECE vowel)
    {
        match: (exp) => exp === 'iː' || exp === 'i',
        obs: 'Vowel was too short or relaxed',
        tip: 'Smile wide and stretch your lips sideways like you\'re posing for a photo.'
    },
    // /ɪ/ (KIT vowel)
    {
        match: (exp) => exp === 'ɪ',
        obs: (exp, hrd) => (hrd === 'iː' || hrd === 'i')
            ? 'Stretched too wide like /iː/'
            : 'Vowel was held too tense',
        tip: 'Relax your lips and jaw into a neutral position—make a quick, effortless sound without smiling wide.'
    },
    // /e/ or /ɛ/
    {
        match: (exp) => exp === 'e' || exp === 'ɛ',
        obs: 'Tongue was too high or mouth was too closed for /e/',
        tip: 'Open your mouth mid-way with your tongue relaxed in the middle, like saying "bed".'
    },
    // /uː/ or /u/ (GOOSE vowel)
    {
        match: (exp) => exp === 'uː' || exp === 'u',
        obs: 'Lips weren\'t puckered tightly forward',
        tip: 'Pucker your lips forward tightly like you\'re blowing out a candle.'
    },
    // /ʊ/ (FOOT vowel)
    {
        match: (exp) => exp === 'ʊ',
        obs: 'Lips were too tense or mouth was too closed',
        tip: 'Round your lips slightly but keep them relaxed and short, like in "book".'
    },
    // /ʌ/ (STRUT vowel)
    {
        match: (exp) => exp === 'ʌ',
        obs: 'Mouth wasn\'t relaxed in the middle',
        tip: 'Keep your mouth relaxed and mid-open, making a short, gut-level sound like you\'re punched in the stomach.'
    },
    // /ɑː/ or /ɑ/
    {
        match: (exp) => exp === 'ɑː' || exp === 'ɑ',
        obs: 'Jaw wasn\'t dropped low enough',
        tip: 'Drop your jaw wide and keep your tongue low and flat in the back of your mouth.'
    },
    // /ɔː/ or /ɔ/
    {
        match: (exp) => exp === 'ɔː' || exp === 'ɔ',
        obs: 'Lips weren\'t rounded into an oval',
        tip: 'Drop your jaw slightly and round your lips into an open oval shape.'
    },
    // /eɪ/
    {
        match: (exp) => exp === 'eɪ',
        obs: 'Vowel cut short before completing the glide into "ee"',
        tip: 'Glide smoothly from an open "eh" to a smiling "ee" without cutting it short.'
    },
    // /aɪ/
    {
        match: (exp) => exp === 'aɪ',
        obs: 'Gliding cut short before rising to "ee"',
        tip: 'Open wide on "ah" and glide smoothly up into a high "ee".'
    },
    // /oʊ/
    {
        match: (exp) => exp === 'oʊ',
        obs: 'Vowel cut short before rounding into "oo"',
        tip: 'Start with an open "oh" and round your lips tightly forward into "oo".'
    },
    // /aʊ/
    {
        match: (exp) => exp === 'aʊ',
        obs: 'Gliding cut short before rounding into "oo"',
        tip: 'Open wide on "ah" and glide smoothly into rounded "oo".'
    },
    // /ɔɪ/
    {
        match: (exp) => exp === 'ɔɪ',
        obs: 'Gliding cut short before sliding to "ee"',
        tip: 'Start with rounded lips on "aw" and glide into a smiling "ee".'
    }
];

function findCoachingRule(expected, heard) {
    const normExp = normalizeToOxfordAmericanIPA(expected);
    const normHrd = normalizeToOxfordAmericanIPA(heard);
    for (const rule of ARTICULATORY_COACHING) {
        if (rule.match(normExp, normHrd)) {
            const obsStr = typeof rule.obs === 'function' ? rule.obs(normExp, normHrd) : rule.obs;
            return {
                obs: normalizeIPAsInText(obsStr),
                tip: normalizeIPAsInText(rule.tip)
            };
        }
    }
    const isVowel = /[aeiouɪʊæɑɔʌə]/.test(normExp);
    return {
        obs: isVowel
            ? 'Vowel shape drifted or was held inconsistently'
            : 'Tongue or lips did not articulate this sound cleanly',
        tip: isVowel
            ? 'Keep your tongue steady and hold this vowel shape clearly without drifting.'
            : 'Pay extra attention to where your tongue and lips touch to articulate this sound cleanly.'
    };
}

function generateSyllableCoaching({ text, expectedIpa, heardIpa, substitutions, constituents, sAccuracy }) {
    let diagnosis = null;
    let tip = null;

    if (substitutions && substitutions.length > 0) {
        // Deduplicate substitution pairs to prevent repetitive "(d instead of t, d instead of t)"
        const uniqueSubs = [];
        const seenPairs = new Set();
        for (const sp of substitutions) {
            const expNorm = normalizeToOxfordAmericanIPA(sp.expected);
            const hrdNorm = normalizeToOxfordAmericanIPA(sp.heard);
            if (expNorm === hrdNorm) continue; // Ignore identical normalized sounds
            const pairKey = `${expNorm}->${hrdNorm}`;
            if (!seenPairs.has(pairKey)) {
                seenPairs.add(pairKey);
                uniqueSubs.push({ ...sp, expected: expNorm, heard: hrdNorm });
            }
        }

        if (uniqueSubs.length > 0) {
            const sorted = [...uniqueSubs].sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
            const worst = sorted[0];
            const coaching = findCoachingRule(worst.expected, worst.heard);

            const details = uniqueSubs.map(sp => `/${normalizeToOxfordAmericanIPA(sp.heard).replace(/^\/+|\/+$/g, '')}/ instead of /${normalizeToOxfordAmericanIPA(sp.expected).replace(/^\/+|\/+$/g, '')}/`).join(', ');
            const cleanHeardIpa = normalizeToOxfordAmericanIPA(heardIpa).replace(/^\/+|\/+$/g, '');

            if (coaching.obs && !coaching.obs.startsWith('Sounded like') && !coaching.obs.includes('instead of')) {
                diagnosis = `Sounded like /${cleanHeardIpa}/ (${details}) — ${coaching.obs}`;
            } else {
                diagnosis = `Sounded like /${cleanHeardIpa}/ (${details})`;
            }
            tip = coaching.tip;
        }
    }

    if (!diagnosis && sAccuracy < 80) {
        const lowPhonemes = (constituents || []).filter(p => Math.round(Number(p.AccuracyScore ?? 0)) < 75);
        if (lowPhonemes.length > 0) {
            const sortedLow = [...lowPhonemes].sort((a, b) => Number(a.AccuracyScore ?? 0) - Number(b.AccuracyScore ?? 0));
            const worstLow = sortedLow[0];
            const worstPh = normalizeToOxfordAmericanIPA(worstLow.Phoneme);

            // Deduplicate phonemes in phList
            const seenLow = new Set();
            const uniqueLow = [];
            for (const p of lowPhonemes) {
                const normP = normalizeToOxfordAmericanIPA(p.Phoneme);
                if (!seenLow.has(normP)) {
                    seenLow.add(normP);
                    uniqueLow.push({ ...p, normPhoneme: normP });
                }
            }

            const phList = uniqueLow.map(p => `/${p.normPhoneme}/ (${Math.round(Number(p.AccuracyScore ?? 0))}%)`).join(', ');
            const coaching = findCoachingRule(worstPh, '');

            if (worstPh === 'ər' || worstPh === 'ɜːr' || worstPh === 'r') {
                diagnosis = `Weak acoustic match on ${phList} — sounded a bit flat without the American "r"`;
                tip = 'Curl the tip of your tongue slightly backward and pull it back to get that rich American "r".';
            } else if (worstPh === 'l') {
                diagnosis = `Weak acoustic match on ${phList} — the "l" sound wasn't fully formed`;
                tip = 'Press the tip of your tongue firmly against the ridge behind your upper teeth.';
            } else if (worstPh === 'æ') {
                diagnosis = `Weak acoustic match on ${phList} — vowel was muffled or not open enough`;
                tip = 'Drop your jaw lower and open your mouth wide, like at the doctor saying "ah".';
            } else if (worstPh === 'iː' || worstPh === 'i') {
                diagnosis = `Weak acoustic match on ${phList} — vowel lacked clear resonance`;
                tip = 'Smile wide and stretch your lips sideways like you\'re posing for a photo.';
            } else if (worstPh === 'z' || worstPh === 's') {
                diagnosis = `Weak acoustic match on ${phList} — ending sound was weak or cut short`;
                tip = 'Don\'t forget the ending "s"—make a buzzing bee "zzz" sound at the end.';
            } else if (worstPh === 'θ' || worstPh === 'ð') {
                diagnosis = `Weak acoustic match on ${phList} — "th" sound wasn't clear`;
                tip = 'Put the tip of your tongue gently between your front teeth and blow air through.';
            } else {
                const obsSuffix = coaching.obs && !coaching.obs.startsWith('Sounded like') && !coaching.obs.includes('instead of')
                    ? ` — ${coaching.obs}`
                    : '';
                diagnosis = `Weak acoustic match on ${phList}${obsSuffix}`;
                tip = coaching.tip || `Slow down slightly on this syllable and shape the /${worstPh}/ sound deliberately.`;
            }
        } else {
            diagnosis = `Acoustic match was ${sAccuracy}% due to non-native resonance or rushed timing`;
            tip = 'Slow down slightly on this syllable and shape each sound deliberately.';
        }
    }

    return {
        diagnosis: diagnosis ? normalizeIPAsInText(diagnosis) : null,
        tip: tip ? normalizeIPAsInText(tip) : null
    };
}

/**
 * Extracts words and rich syllable breakdowns from raw Azure NBest.Words.
 * Handles constituent phonemes correlation, candidate phonemes from NBestPhonemes,
 * acoustic boundary calibration, and articulatory coaching.
 *
 * @param {Array<Object>} rawWords - Azure speech NBest[0].Words
 * @returns {Array<Object>} Enriched word objects
 */
function extractWordsAndSyllablesFromAzure(rawWords, options = {}) {
    if (!Array.isArray(rawWords)) return [];

    const mappedWords = rawWords.map(w => {
        const rawOffset = Number(w.Offset);
        const rawDuration = Number(w.Duration);
        const startMs = Number.isFinite(rawOffset) ? rawOffset / 10000 : null;
        const durMs = Number.isFinite(rawDuration) ? rawDuration / 10000 : null;
        const endMs = startMs != null && durMs != null ? startMs + durMs : null;

        const syllables = Array.isArray(w.Syllables) && w.Syllables.length > 0
            ? w.Syllables.map(s => {
                const sOffset = Number(s.Offset);
                const sDuration = Number(s.Duration);
                const sStartMs = Number.isFinite(sOffset) && sOffset >= 0 ? Math.round(sOffset / 10000) : null;
                const sDurMs = Number.isFinite(sDuration) && sDuration > 0 ? Math.round(sDuration / 10000) : null;
                const sEndMs = sStartMs != null && sDurMs != null ? sStartMs + sDurMs : null;
                const sAccuracy = Math.round(Number(s.AccuracyScore ?? s.PronunciationAssessment?.AccuracyScore ?? 0));

                // Correlate constituent phonemes within this syllable interval
                const constituents = (Array.isArray(w.Phonemes) ? w.Phonemes : []).filter(p => {
                    const pOffset = Number(p.Offset);
                    return Number.isFinite(pOffset) && pOffset >= sOffset && pOffset < (sOffset + sDuration);
                });

                let heardPhonemes = [];
                let substitutions = [];

                for (const p of constituents) {
                    const rawExpectedPh = String(p.Phoneme || '').trim();
                    const rawTopCand = p.NBestPhonemes?.[0]?.Phoneme ? String(p.NBestPhonemes[0].Phoneme).trim() : rawExpectedPh;
                    const phAcc = Math.round(Number(p.AccuracyScore ?? 0));

                    const expectedPh = normalizeToOxfordAmericanIPA(rawExpectedPh);
                    const topCand = normalizeToOxfordAmericanIPA(rawTopCand);
                    heardPhonemes.push(topCand);

                    if (topCand !== expectedPh && phAcc < 80) {
                        substitutions.push({ expected: expectedPh, heard: topCand, score: phAcc });
                    }
                }

                const rawExpectedSyl = String(s.Syllable || s.Grapheme || '').trim();
                const expectedIpa = normalizeToOxfordAmericanIPA(rawExpectedSyl);
                const heardIpa = normalizeToOxfordAmericanIPA(heardPhonemes.join(''));

                const coaching = generateSyllableCoaching({
                    text: String(s.Grapheme || s.Syllable || '').trim(),
                    expectedIpa,
                    heardIpa,
                    substitutions,
                    constituents,
                    sAccuracy
                });

                return {
                    text: String(s.Grapheme || s.Syllable || '').trim(),
                    ipa: expectedIpa,
                    accuracyScore: sAccuracy,
                    startMs: sStartMs,
                    endMs: sEndMs,
                    heardIpa: heardIpa && heardIpa !== expectedIpa ? heardIpa : null,
                    diagnosis: coaching.diagnosis,
                    tip: coaching.tip
                };
            }).filter(s => s.text.length > 0)
            : null;

        const parsedScore = readScore(w);
        const wordObj = {
            word: String(w.Word || '').trim(),
            startMs,
            endMs,
            rawStartMs: startMs,
            rawEndMs: endMs,
            accuracyScore: parsedScore !== null ? Math.round(parsedScore) : 0,
            errorType: String(readAssessmentField(w, 'ErrorType') || 'None')
        };
        if (syllables) {
            wordObj.syllables = syllables;
        }
        return wordObj;
    }).filter(w => w.word.length > 0);

    if (!options || !options.calibrateBoundaries) {
        return mappedWords;
    }

    // DEPRECATED: Acoustic boundary calibration (calibrateBoundaries).
    // Per BEL Spec §5.8, do NOT overwrite primary endMs with trimmed boundaries, which destroys word endings.
    // Instead, preserve raw acoustic endpoints as primary endMs / rawEndMs, and expose legacy_trimmed_playback.
    const words = mappedWords.map((curr, idx) => {
        const next = mappedWords[idx + 1];
        if (!next || curr.startMs == null || curr.endMs == null || next.startMs == null) {
            return {
                ...curr,
                legacy_trimmed_playback: curr.endMs
            };
        }
        const rawGap = next.startMs - curr.endMs;
        let calibratedEndMs = curr.endMs;
        // When words are contiguous (gap < 25ms):
        if (rawGap < 25) {
            const isMispronounced = curr.errorType !== 'None' || (curr.accuracyScore > 0 && curr.accuracyScore < 60);
            const safetyPad = isMispronounced ? 25 : 15;
            calibratedEndMs = Math.min(curr.endMs, next.startMs - safetyPad);
        }
        // Ensure minimum audible duration (at least 75ms)
        if (calibratedEndMs - curr.startMs < 75) {
            calibratedEndMs = Math.max(curr.startMs + 75, curr.endMs);
        }
        return {
            ...curr,
            // Keep endMs unchanged to preserve true phonetic word endings
            legacy_trimmed_playback: calibratedEndMs
        };
    });

    return words;
}

function getAzureSpeechCredentials() {
    let key = process.env.AZURE_SPEECH_KEY ? process.env.AZURE_SPEECH_KEY.trim() : '';
    let region = process.env.AZURE_SPEECH_REGION ? process.env.AZURE_SPEECH_REGION.trim() : '';

    if (!key || !region) {
        const candidates = [
            path.resolve(__dirname, '..', '..', '.env'),
            path.resolve(__dirname, '..', '..', '..', '.env')
        ];
        for (const p of candidates) {
            try {
                if (fs.existsSync(p)) {
                    const content = fs.readFileSync(p, 'utf8');
                    for (const line of content.split('\n')) {
                        const trimmed = line.trim();
                        if (!key && trimmed.startsWith('AZURE_SPEECH_KEY=')) {
                            key = trimmed.split('=')[1]?.trim().replace(/^['"]|['"]$/g, '') || '';
                        }
                        if (!region && trimmed.startsWith('AZURE_SPEECH_REGION=')) {
                            region = trimmed.split('=')[1]?.trim().replace(/^['"]|['"]$/g, '') || '';
                        }
                    }
                }
            } catch (e) { /* ignore */ }
        }
    }
    return { key, region: region || 'southeastasia' };
}

function buildPronunciationAssessmentHeader(referenceText) {
    const cleanRef = String(referenceText || '')
        .replace(/[.,;:!?\u2019'"]/g, ' ')
        .replace(/\$/g, ' dollars ')
        .replace(/\s+/g, ' ')
        .trim();

    const config = {
        ReferenceText: cleanRef,
        GradingSystem: 'HundredMark',
        Granularity: 'Phoneme',
        Dimension: 'Comprehensive',
        PhonemeAlphabet: 'IPA',
        EnableMiscue: true,
        NBestPhonemeCount: 5
    };
    return Buffer.from(JSON.stringify(config)).toString('base64');
}

module.exports = {
    normalizeToOxfordAmericanIPA,
    normalizeIPAsInText,
    ARTICULATORY_COACHING,
    findCoachingRule,
    generateSyllableCoaching,
    extractWordsAndSyllablesFromAzure,
    getAzureSpeechCredentials,
    buildPronunciationAssessmentHeader,
    normalizeFinalResult
};
