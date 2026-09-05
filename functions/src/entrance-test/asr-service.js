const fs = require('fs');
const path = require('path');
const https = require('https');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

function getHuggingFaceApiKey() {
    if (process.env.HUGGINGFACE_API_KEY && process.env.HUGGINGFACE_API_KEY.trim()) {
        return process.env.HUGGINGFACE_API_KEY.trim();
    }
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
                    if (trimmed.startsWith('HUGGINGFACE_API_KEY=')) {
                        const val = trimmed.split('=')[1]?.trim().replace(/^['"]|['"]$/g, '');
                        if (val) return val;
                    }
                }
            }
        } catch (e) {}
    }
    return null;
}

function getGeminiApiKeys() {
    const keys = [];
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
        keys.push(process.env.GEMINI_API_KEY.trim());
    }
    if (process.env.GEMINI_API_KEY_BACKUP && process.env.GEMINI_API_KEY_BACKUP.trim()) {
        keys.push(process.env.GEMINI_API_KEY_BACKUP.trim());
    }

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
                    if (trimmed.startsWith('GEMINI_API_KEY=')) {
                        const val = trimmed.split('=')[1]?.trim().replace(/^['"]|['"]$/g, '');
                        if (val && !keys.includes(val)) keys.push(val);
                    } else if (trimmed.startsWith('GEMINI_API_KEY_BACKUP=')) {
                        const val = trimmed.split('=')[1]?.trim().replace(/^['"]|['"]$/g, '');
                        if (val && !keys.includes(val)) keys.push(val);
                    }
                }
            }
        } catch (e) {}
    }
    return keys.filter((k, i, self) => self.indexOf(k) === i);
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
            } catch (e) {}
        }
    }
    return { key, region: region || 'southeastasia' };
}

/**
 * Resolves appropriate audio MIME type for Azure Speech REST API.
 */
function resolveAzureAudioMimeType(contentType, audioBuffer) {
    if (Buffer.isBuffer(audioBuffer) && audioBuffer.length >= 4) {
        // RIFF header -> WAV
        if (audioBuffer[0] === 0x52 && audioBuffer[1] === 0x49 && audioBuffer[2] === 0x46 && audioBuffer[3] === 0x46) {
            return 'audio/wav; codecs=audio/pcm';
        }
        // ID3 or MP3 sync frame
        if ((audioBuffer[0] === 0x49 && audioBuffer[1] === 0x44 && audioBuffer[2] === 0x33) ||
            (audioBuffer[0] === 0xFF && (audioBuffer[1] & 0xE0) === 0xE0)) {
            return 'audio/mp3';
        }
        // EBML (WebM)
        if (audioBuffer[0] === 0x1A && audioBuffer[1] === 0x45 && audioBuffer[2] === 0xDF && audioBuffer[3] === 0xA3) {
            return 'audio/webm; codecs=opus';
        }
        // OggS
        if (audioBuffer[0] === 0x4F && audioBuffer[1] === 0x67 && audioBuffer[2] === 0x67 && audioBuffer[3] === 0x53) {
            return 'audio/ogg; codecs=opus';
        }
    }
    const ct = String(contentType || '').toLowerCase().trim();
    if (ct.includes('wav')) return 'audio/wav; codecs=audio/pcm';
    if (ct.includes('mp3') || ct.includes('mpeg')) return 'audio/mp3';
    if (ct.includes('ogg')) return 'audio/ogg; codecs=opus';
    return 'audio/webm; codecs=opus';
}

/**
 * Normalizes audio content type to standard MIME type accepted by Gemini.
 */
function resolveGeminiAudioMimeType(contentType) {
    const raw = String(contentType || '').toLowerCase();
    if (raw.includes('webm')) return 'audio/webm';
    if (raw.includes('mp4') || raw.includes('m4a') || raw.includes('aac')) return 'audio/mp4';
    if (raw.includes('wav')) return 'audio/wav';
    if (raw.includes('ogg') || raw.includes('opus')) return 'audio/ogg';
    if (raw.includes('mp3') || raw.includes('mpeg')) return 'audio/mp3';
    return 'audio/webm';
}

/**
 * Defensive post-processor to collapse repetitive hallucination loops
 * (e.g. "Yeah Yeah Yeah..." or "Các bác sĩ, các bác sĩ...")
 * and filter out hallucinated Vietnamese words from English tests.
 */
function cleanHallucinatedLoops(text, options = {}) {
    if (!text || typeof text !== 'string') return '';
    let cleaned = text.trim();

    // Remove markdown fences or surrounding quotes if model added them
    cleaned = cleaned.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
    if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
        cleaned = cleaned.slice(1, -1).trim();
    }

    let prev = '';
    let iterations = 0;
    while (prev !== cleaned && iterations < 5) {
        prev = cleaned;
        iterations += 1;
        // Collapse multi-word phrase repetitions (1 to 5 words repeating)
        cleaned = cleaned.replace(/(?<![\p{L}\p{N}])([\p{L}\p{N}]+(?:[\s,]+[\p{L}\p{N}]+){1,4})(?:[\s,]+\1)+(?![\p{L}\p{N}])/giu, '$1');
        // Collapse single-word rapid repetitions
        cleaned = cleaned.replace(/(?<![\p{L}\p{N}])([\p{L}\p{N}]+)(?:[\s,]+\1)+(?![\p{L}\p{N}])/giu, '$1');
    }

    // For English tests, strip any words containing Vietnamese tone/diacritical marks
    const stripVietnamese = options.stripVietnamese !== false;
    if (stripVietnamese) {
        const vietnameseWordPattern = /(?:^|\s+)[\p{L}]*[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]+[\p{L}]*(?=\s+|$)/giu;
        cleaned = cleaned.replace(vietnameseWordPattern, ' ');
    }

    // Normalize whitespace
    return cleaned.replace(/\s+/g, ' ').trim();
}

// === Oxford American IPA Normalization & Articulatory Coaching ===

const OXFORD_DIPHTHONGS = ['eɪ', 'aɪ', 'ɔɪ', 'aʊ', 'oʊ'];
const OXFORD_NUCLEI = new Set(['i', 'ɪ', 'e', 'ɛ', 'æ', 'ɑ', 'ɔ', 'o', 'ʊ', 'u', 'ə', 'ʌ', 'ɝ', 'ɚ', 'ɜ']);

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

            if (nucleus === 'ɝ' || nucleus === 'ɚ' || nucleus === 'ɜ') {
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

function normalizeIPAsInText(text) {
    if (!text || typeof text !== 'string') return '';
    return text.replace(/\/([^/\s]+)\//g, (m, ipa) => `/${normalizeToOxfordAmericanIPA(ipa).replace(/^\/+|\/+$/g, '')}/`);
}

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
        obs: 'Gliding cut short before rounding forward into "oo"',
        tip: 'Open wide on "ah" and glide forward into a rounded "oo".'
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

function generateSyllableCoaching({ expectedIpa, heardIpa, substitutions, constituents, sAccuracy }) {
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
 * Performs high-precision forced acoustic alignment using Azure Speech Pronunciation Assessment.
 * Aligns the spoken transcript text directly against acoustic audio frames, returning millisecond-accurate
 * word boundaries (Offset and Duration) matching the Read Aloud engine.
 *
 * @param {Buffer} audioBuffer - Audio data
 * @param {string} referenceText - Target text to align against (candidate transcript or expected passage)
 * @param {string} [contentType] - Input MIME type
 * @returns {Promise<Array<{word: string, startMs: number, endMs: number, accuracyScore: number, errorType: string, syllables?: Array<{text: string, ipa: string, accuracyScore: number}>|null}>|null>}
 */
async function alignAudioWithAzure(audioBuffer, referenceText, contentType) {
    const { key, region } = getAzureSpeechCredentials();
    if (!key || !region) return null;

    const cleanRef = String(referenceText || '')
        .replace(/[.,;:!?\u2019'"]/g, ' ')
        .replace(/\$/g, ' dollars ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleanRef) return null;

    let finalBuffer = audioBuffer;
    let mime = resolveAzureAudioMimeType(contentType, audioBuffer);

    // Convert audio to 16kHz mono PCM WAV if ffmpeg is available for highest acoustic alignment fidelity
    try {
        const { spawnSync } = require('child_process');
        const ffmpegRes = spawnSync('ffmpeg', [
            '-loglevel', 'error',
            '-i', 'pipe:0',
            '-ac', '1',
            '-ar', '16000',
            '-f', 'wav',
            'pipe:1'
        ], {
            input: audioBuffer,
            maxBuffer: 50 * 1024 * 1024,
            windowsHide: true
        });
        if (ffmpegRes.status === 0 && Buffer.isBuffer(ffmpegRes.stdout) && ffmpegRes.stdout.length > 44) {
            finalBuffer = ffmpegRes.stdout;
            mime = 'audio/wav; codecs=audio/pcm; samplerate=16000';
        }
    } catch (_) {
        // Fallback to sending original buffer with resolved mime type
    }

    const config = {
        ReferenceText: cleanRef,
        GradingSystem: 'HundredMark',
        Granularity: 'Phoneme',
        Dimension: 'Comprehensive',
        PhonemeAlphabet: 'IPA',
        EnableMiscue: true,
        NBestPhonemeCount: 5
    };
    const header = Buffer.from(JSON.stringify(config)).toString('base64');
    const endpoint = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                Accept: 'application/json',
                'Content-Type': mime,
                'Ocp-Apim-Subscription-Key': key,
                'Pronunciation-Assessment': header
            },
            body: finalBuffer
        });

        if (!res.ok) {
            console.warn(`[EntranceTest ASR] Azure alignment returned status ${res.status}`);
            return null;
        }
        const resJson = await res.json();
        const rawWords = resJson.NBest?.[0]?.Words || [];

        const mappedWords = rawWords.map(w => {
            const rawOffset = Number(w.Offset);
            const rawDuration = Number(w.Duration);
            const startMs = Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.round(rawOffset / 10000) : null;
            const durMs = Number.isFinite(rawDuration) && rawDuration > 0 ? Math.round(rawDuration / 10000) : null;
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

            return {
                word: String(w.Word || '').trim(),
                startMs,
                endMs,
                accuracyScore: Math.round(Number((w.AccuracyScore ?? w.PronunciationAssessment?.AccuracyScore)) || 0),
                errorType: String((w.ErrorType ?? w.PronunciationAssessment?.ErrorType) || 'None'),
                syllables
            };
        }).filter(w => w.word.length > 0 && w.startMs != null && w.endMs != null && w.endMs > w.startMs);

        // Acoustic boundary calibration: prevent abutting words from bleeding into the next word's onset
        const words = mappedWords.map((curr, idx) => {
            const next = mappedWords[idx + 1];
            if (!next) return curr;
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
                endMs: calibratedEndMs
            };
        });

        return words.length > 0 ? words : null;
    } catch (err) {
        console.warn('[EntranceTest ASR] Azure alignment error:', err?.message || err);
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Transcribe entrance test audio using Gemini Multimodal Audio
 * with multi-model fallback and silence loop protection.
 *
 * @param {Buffer} audioBuffer - Binary audio buffer
 * @param {string} contentType - Audio MIME type (e.g. 'audio/webm; codecs=opus')
 * @param {Object} [options]
 * @param {string} [options.expectedText] - Optional reference reading text
 * @param {number} [options.timeoutMs=35000] - Timeout per model attempt
 * @returns {Promise<string>} Cleaned English transcript
 */
async function transcribeAudio(audioBuffer, contentType, options = {}) {
    const apiKeys = getGeminiApiKeys();
    if (apiKeys.length === 0) {
        throw new Error('GEMINI_API_KEY is not configured on the server.');
    }

    if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
        throw new Error('Audio buffer is empty or invalid.');
    }

    const mimeType = resolveGeminiAudioMimeType(contentType);
    const base64Data = audioBuffer.toString('base64');
    const timeoutMs = options.timeoutMs || 15000;

    const primaryModel = process.env.ENTRANCE_TEST_ASR_MODEL || 'gemini-3.8-flash';
    const candidateModels = [
        primaryModel,
        'gemini-3.6-flash',
        'gemini-3.5-flash',
        'gemini-3-flash-preview',
        'gemini-3.5-transcribe'
    ].filter((val, idx, self) => self.indexOf(val) === idx);

    const expectedText = options.expectedText ? String(options.expectedText).trim() : '';
    const prompt = expectedText
        ? `You are an accurate English speech-to-text transcriber for an English proficiency entrance test.\nThe candidate was asked to read the following reference passage:\n"${expectedText}"\n\nListen to the audio and transcribe what the candidate actually spoke in English verbatim.\n- Transcribe their actual spoken English words, reflecting their spoken speech even if words were omitted, mispronounced, or substituted.\n- Do NOT hallucinate words or repeat loops during silent intervals or pauses.\n- Output ONLY the plain transcription text with no commentary, no markdown code blocks, and no quotation marks.`
        : `You are an accurate English speech-to-text transcriber. Listen to the audio and transcribe what the candidate spoke in English verbatim. Do NOT hallucinate words or repeat loops during silence. Output ONLY the plain transcription text with no commentary, no markdown code blocks, and no quotation marks.`;

    let lastError = null;

    for (let keyIdx = 0; keyIdx < apiKeys.length; keyIdx += 1) {
        const apiKey = apiKeys[keyIdx];
        const genAI = new GoogleGenerativeAI(apiKey.trim());

        for (const modelName of candidateModels) {
            try {
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    generationConfig: {
                        temperature: 0.0
                    }
                });

                const generatePromise = model.generateContent([
                    {
                        inlineData: {
                            mimeType,
                            data: base64Data
                        }
                    },
                    prompt
                ]);

                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(`ASR timeout after ${timeoutMs}ms for ${modelName}`)), timeoutMs);
                });

                const res = await Promise.race([generatePromise, timeoutPromise]);
                const rawText = res?.response?.text() || '';
                const cleaned = cleanHallucinatedLoops(rawText);

                if (cleaned) {
                    let words = null;
                    try {
                        const trimmedExpected = options.expectedText ? String(options.expectedText).trim() : '';
                        const targetText = trimmedExpected || cleaned;
                        words = await alignAudioWithAzure(audioBuffer, targetText, contentType);
                    } catch (alignErr) {
                        console.warn('[EntranceTest ASR] Azure alignment attempt failed:', alignErr?.message || alignErr);
                    }

                    // Fallback to Whisper for word timestamps if Azure alignment yielded no words
                    if (!words || words.length === 0) {
                        try {
                            const hfRes = await transcribeWithHuggingFace(audioBuffer, contentType);
                            if (Array.isArray(hfRes?.words) && hfRes.words.length > 0) {
                                words = hfRes.words;
                            }
                        } catch (_) {
                            // Non-blocking fallback
                        }
                    }

                    return Object.assign(new String(cleaned), {
                        text: cleaned,
                        words: words && words.length > 0 ? words : null
                    });
                }
            } catch (err) {
                lastError = err;
                const errMsg = err?.message || String(err);
                console.warn(`[EntranceTest ASR] Key #${keyIdx + 1} with model ${modelName} failed:`, errMsg);

                // If error is auth or quota exhaustion, jump immediately to the backup key
                const isKeyFailure = /API_KEY_INVALID|API key not valid|RESOURCE_EXHAUSTED|429|403|400|quota/i.test(errMsg);
                if (isKeyFailure && keyIdx < apiKeys.length - 1) {
                    console.warn(`[EntranceTest ASR] API key #${keyIdx + 1} encountered auth/quota error. Failing over to backup key #${keyIdx + 2}...`);
                    break;
                }
            }
        }
    }

    // Safety Net: If all Gemini keys and models failed, invoke hardened Hugging Face Whisper
    console.warn('[EntranceTest ASR] All Gemini keys/models exhausted. Falling back to hardened Hugging Face safety net...');
    try {
        const hfTranscript = await transcribeWithHuggingFace(audioBuffer, contentType);
        if (hfTranscript) {
            console.log('[EntranceTest ASR] Transcribed successfully using Hugging Face safety net.');
            return hfTranscript;
        }
    } catch (hfErr) {
        console.warn('[EntranceTest ASR] Hugging Face safety net failed:', hfErr?.message || hfErr);
    }

    throw lastError || new Error('All ASR providers (Gemini and Hugging Face) failed to transcribe audio.');
}

/**
 * Hardened Hugging Face Whisper ASR safety net fallback.
 * Sends audio to Whisper Large V3, then routes output through cleanHallucinatedLoops.
 *
 * @param {Buffer} audioBuffer - Binary audio buffer
 * @param {string} contentType - Audio MIME type
 * @returns {Promise<string>} Cleaned transcript
 */
async function transcribeWithHuggingFace(audioBuffer, contentType) {
    const hfKey = getHuggingFaceApiKey();
    if (!hfKey) {
        throw new Error('HUGGINGFACE_API_KEY is not configured on the server.');
    }

    const model = process.env.HUGGINGFACE_ASR_MODEL || 'openai/whisper-large-v3';
    const url = `https://router.huggingface.co/hf-inference/models/${model}`;
    const base64Data = audioBuffer.toString('base64');

    let rawText = '';
    let chunks = [];

    // Primary request: Force English language decoding via generate_kwargs and return word timestamps
    try {
        const jsonRes = await axios({
            method: 'POST',
            url,
            headers: {
                Authorization: `Bearer ${hfKey}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'User-Agent': 'Mozilla/5.0'
            },
            httpsAgent: new https.Agent({ family: 4 }),
            data: {
                inputs: base64Data,
                parameters: {
                    return_timestamps: 'word',
                    generate_kwargs: {
                        language: 'english'
                    }
                }
            },
            timeout: 45000,
            validateStatus: () => true
        });

        if (jsonRes.status === 200 && jsonRes.data) {
            if (typeof jsonRes.data.text === 'string') {
                rawText = jsonRes.data.text;
            }
            if (Array.isArray(jsonRes.data.chunks)) {
                chunks = jsonRes.data.chunks;
            }
        }
    } catch (jsonErr) {
        console.warn('[EntranceTest ASR] Hugging Face JSON language=english request failed, attempting binary fallback:', jsonErr?.message || jsonErr);
    }

    // Secondary fallback: send binary audio if JSON payload is unsupported
    if (!rawText) {
        const asrContentType = resolveGeminiAudioMimeType(contentType) || 'application/octet-stream';
        const binaryRes = await axios({
            method: 'POST',
            url,
            headers: {
                Authorization: `Bearer ${hfKey}`,
                Accept: 'application/json',
                'Content-Type': asrContentType,
                'User-Agent': 'Mozilla/5.0'
            },
            httpsAgent: new https.Agent({ family: 4 }),
            data: audioBuffer,
            timeout: 45000,
            validateStatus: () => true
        });

        if (binaryRes.status !== 200 || !binaryRes.data || typeof binaryRes.data.text !== 'string') {
            const errMsg = binaryRes.data?.error || `Hugging Face ASR failed with status ${binaryRes.status}`;
            throw new Error(String(errMsg));
        }

        rawText = binaryRes.data.text || '';
        if (Array.isArray(binaryRes.data?.chunks)) {
            chunks = binaryRes.data.chunks;
        }
    }

    const cleaned = cleanHallucinatedLoops(rawText, { stripVietnamese: true });
    const words = extractWordsFromChunks(chunks);

    const result = Object.assign(new String(cleaned), {
        text: cleaned,
        words: words.length > 0 ? words : null
    });
    return result;
}

function extractWordsFromChunks(chunks) {
    if (!Array.isArray(chunks) || chunks.length === 0) return [];
    return chunks.map((c, idx) => {
        const rawWord = String(c.text || '').trim();
        const startMs = Math.round((c.timestamp?.[0] ?? 0) * 1000);
        let endMs = c.timestamp?.[1] != null ? Math.round(c.timestamp[1] * 1000) : null;
        if (endMs == null || endMs <= startMs) {
            if (idx < chunks.length - 1 && chunks[idx + 1]?.timestamp?.[0] != null) {
                endMs = Math.round(chunks[idx + 1].timestamp[0] * 1000);
            } else {
                endMs = startMs + 600;
            }
        }
        // Cap excessive chunk duration (e.g. >1.8s) to prevent absorbing inter-word pauses
        if (endMs - startMs > 1800) {
            endMs = startMs + 1000;
        }
        return {
            word: rawWord,
            startMs,
            endMs
        };
    }).filter((w) => w.word.length > 0);
}

module.exports = {
    transcribeAudio,
    transcribeWithHuggingFace,
    alignAudioWithAzure,
    normalizeToOxfordAmericanIPA,
    getAzureSpeechCredentials,
    resolveAzureAudioMimeType,
    extractWordsFromChunks,
    cleanHallucinatedLoops,
    resolveGeminiAudioMimeType,
    getGeminiApiKeys,
    getHuggingFaceApiKey
};

