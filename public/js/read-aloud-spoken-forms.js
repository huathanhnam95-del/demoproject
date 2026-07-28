(function (root) {
  'use strict';

  const SILENT_INITIAL_WORDS = new Set([
    'hour',
    'honest',
    'honor',
    'honour',
    'heir',
    'herb',
    'honorable',
    'honourable'
  ]);

  const SEMIVOWEL_Y_WORDS = new Set([
    'university',
    'user',
    'union',
    'european',
    'eulogy',
    'ewe',
    'ubiquitous',
    'usual',
    'uniform',
    'unique',
    'unit',
    'united',
    'unicorn',
    'unanimous',
    'use',
    'used',
    'useful',
    'usage',
    'utility'
  ]);

  const SEMIVOWEL_W_WORDS = new Set([
    'one',
    'once',
    'one-off',
    'one-time',
    'one-eyed',
    'won',
    'womb',
    'woman',
    'women'
  ]);

  const SILENT_FINAL_TRAPS = new Set([
    'climb',
    'debt',
    'subtle',
    'thumb',
    'bomb',
    'lamb',
    'comb'
  ]);

  const ABBREVIATION_TITLE_WORDS = new Map([
    ['mr', 'mister'],
    ['mrs', 'missus'],
    ['ms', 'miz'],
    ['dr', 'doctor'],
    ['prof', 'professor'],
    ['st', 'saint'],
    ['jr', 'junior'],
    ['sr', 'senior']
  ]);

  const LETTER_SOUNDS = new Map([
    ['a', { initialClass: 'vowel', initialKey: 'eɪ', finalClass: 'vowel', finalKey: 'eɪ' }],
    ['b', { initialClass: 'consonant', initialKey: 'b', finalClass: 'vowel', finalKey: 'iː' }],
    ['c', { initialClass: 'consonant', initialKey: 's', finalClass: 'vowel', finalKey: 'iː' }],
    ['d', { initialClass: 'consonant', initialKey: 'd', finalClass: 'vowel', finalKey: 'iː' }],
    ['e', { initialClass: 'vowel', initialKey: 'iː', finalClass: 'vowel', finalKey: 'iː' }],
    ['f', { initialClass: 'vowel', initialKey: 'ɛ', finalClass: 'consonant', finalKey: 'f' }],
    ['g', { initialClass: 'consonant', initialKey: 'dʒ', finalClass: 'vowel', finalKey: 'iː' }],
    ['h', { initialClass: 'vowel', initialKey: 'eɪ', finalClass: 'consonant', finalKey: 'tʃ' }],
    ['i', { initialClass: 'vowel', initialKey: 'aɪ', finalClass: 'vowel', finalKey: 'aɪ' }],
    ['j', { initialClass: 'consonant', initialKey: 'dʒ', finalClass: 'vowel', finalKey: 'eɪ' }],
    ['k', { initialClass: 'consonant', initialKey: 'k', finalClass: 'vowel', finalKey: 'eɪ' }],
    ['l', { initialClass: 'vowel', initialKey: 'ɛ', finalClass: 'consonant', finalKey: 'l' }],
    ['m', { initialClass: 'vowel', initialKey: 'ɛ', finalClass: 'consonant', finalKey: 'm' }],
    ['n', { initialClass: 'vowel', initialKey: 'ɛ', finalClass: 'consonant', finalKey: 'n' }],
    ['o', { initialClass: 'vowel', initialKey: 'oʊ', finalClass: 'vowel', finalKey: 'oʊ' }],
    ['p', { initialClass: 'consonant', initialKey: 'p', finalClass: 'vowel', finalKey: 'iː' }],
    ['q', { initialClass: 'consonant', initialKey: 'k', finalClass: 'vowel', finalKey: 'juː' }],
    ['r', { initialClass: 'vowel', initialKey: 'ɑ', finalClass: 'consonant', finalKey: 'r' }],
    ['s', { initialClass: 'vowel', initialKey: 'ɛ', finalClass: 'consonant', finalKey: 's' }],
    ['t', { initialClass: 'consonant', initialKey: 't', finalClass: 'vowel', finalKey: 'iː' }],
    ['u', { initialClass: 'consonant', initialKey: 'j', finalClass: 'vowel', finalKey: 'juː' }],
    ['v', { initialClass: 'consonant', initialKey: 'v', finalClass: 'vowel', finalKey: 'iː' }],
    ['w', { initialClass: 'consonant', initialKey: 'w', finalClass: 'vowel', finalKey: 'juː' }],
    ['x', { initialClass: 'vowel', initialKey: 'ɛ', finalClass: 'consonant', finalKey: 'ks' }],
    ['y', { initialClass: 'consonant', initialKey: 'w', finalClass: 'vowel', finalKey: 'aɪ' }],
    ['z', { initialClass: 'consonant', initialKey: 'z', finalClass: 'consonant', finalKey: 'z' }]
  ]);

  const WORD_HINTS = new Map([
    ['a', { initialClass: 'vowel', initialKey: 'ə', finalClass: 'vowel', finalKey: 'ə' }],
    ['an', { initialClass: 'vowel', initialKey: 'æ', finalClass: 'consonant', finalKey: 'n' }],
    ['and', { initialClass: 'vowel', initialKey: 'æ', finalClass: 'consonant', finalKey: 'd' }],
    ['the', { initialClass: 'consonant', initialKey: 'ð', finalClass: 'vowel', finalKey: 'ə' }],
    ['of', { initialClass: 'vowel', initialKey: 'ə', finalClass: 'consonant', finalKey: 'v' }],
    ['to', { initialClass: 'consonant', initialKey: 't', finalClass: 'vowel', finalKey: 'uː' }],
    ['for', { initialClass: 'consonant', initialKey: 'f', finalClass: 'consonant', finalKey: 'r' }],
    ['with', { initialClass: 'consonant', initialKey: 'w', finalClass: 'consonant', finalKey: 'θ' }],
    ['have', { initialClass: 'consonant', initialKey: 'h', finalClass: 'consonant', finalKey: 'v' }],
    ['has', { initialClass: 'consonant', initialKey: 'h', finalClass: 'consonant', finalKey: 'z' }],
    ['had', { initialClass: 'consonant', initialKey: 'h', finalClass: 'consonant', finalKey: 'd' }],
    ['as', { initialClass: 'vowel', initialKey: 'æ', finalClass: 'consonant', finalKey: 'z' }],
    ['can', { initialClass: 'consonant', initialKey: 'k', finalClass: 'consonant', finalKey: 'n' }],
    ['will', { initialClass: 'consonant', initialKey: 'w', finalClass: 'consonant', finalKey: 'l' }],
    ['would', { initialClass: 'consonant', initialKey: 'w', finalClass: 'consonant', finalKey: 'd' }],
    ['should', { initialClass: 'consonant', initialKey: 'ʃ', finalClass: 'consonant', finalKey: 'd' }],
    ['could', { initialClass: 'consonant', initialKey: 'k', finalClass: 'consonant', finalKey: 'd' }],
    ['i', { initialClass: 'vowel', initialKey: 'aɪ', finalClass: 'vowel', finalKey: 'aɪ' }],
    ['you', { initialClass: 'consonant', initialKey: 'j', finalClass: 'vowel', finalKey: 'uː' }],
    ['your', { initialClass: 'consonant', initialKey: 'j', finalClass: 'consonant', finalKey: 'r' }],
    ['we', { initialClass: 'consonant', initialKey: 'w', finalClass: 'vowel', finalKey: 'iː' }],
    ['he', { initialClass: 'consonant', initialKey: 'h', finalClass: 'vowel', finalKey: 'iː' }],
    ['she', { initialClass: 'consonant', initialKey: 'ʃ', finalClass: 'vowel', finalKey: 'iː' }],
    ['they', { initialClass: 'consonant', initialKey: 'ð', finalClass: 'vowel', finalKey: 'eɪ' }],
    ['me', { initialClass: 'consonant', initialKey: 'm', finalClass: 'vowel', finalKey: 'iː' }],
    ['us', { initialClass: 'vowel', initialKey: 'ʌ', finalClass: 'consonant', finalKey: 's' }],
    ['day', { initialClass: 'consonant', initialKey: 'd', finalClass: 'vowel', finalKey: 'eɪ' }],
    ['see', { initialClass: 'consonant', initialKey: 's', finalClass: 'vowel', finalKey: 'iː' }],
    ['be', { initialClass: 'consonant', initialKey: 'b', finalClass: 'vowel', finalKey: 'iː' }],
    ['free', { initialClass: 'consonant', initialKey: 'f', finalClass: 'vowel', finalKey: 'iː' }],
    ['eight', { initialClass: 'vowel', initialKey: 'eɪ', finalClass: 'consonant', finalKey: 't' }],
    ['eleven', { initialClass: 'vowel', initialKey: 'ɪ', finalClass: 'consonant', finalKey: 'n' }],
    ['eighteen', { initialClass: 'vowel', initialKey: 'eɪ', finalClass: 'consonant', finalKey: 'n' }],
    ['five', { initialClass: 'consonant', initialKey: 'f', finalClass: 'consonant', finalKey: 'v' }],
    ['go', { initialClass: 'consonant', initialKey: 'g', finalClass: 'vowel', finalKey: 'oʊ' }],
    ['do', { initialClass: 'consonant', initialKey: 'd', finalClass: 'vowel', finalKey: 'uː' }],
    ['blue', { initialClass: 'consonant', initialKey: 'b', finalClass: 'vowel', finalKey: 'uː' }],
    ['no', { initialClass: 'consonant', initialKey: 'n', finalClass: 'vowel', finalKey: 'oʊ' }],
    ['two', { initialClass: 'consonant', initialKey: 't', finalClass: 'vowel', finalKey: 'uː' }],
    ['low', { initialClass: 'consonant', initialKey: 'l', finalClass: 'vowel', finalKey: 'oʊ' }],
    ['made', { initialClass: 'consonant', initialKey: 'm', finalClass: 'consonant', finalKey: 'd' }],
    ['save', { initialClass: 'consonant', initialKey: 's', finalClass: 'consonant', finalKey: 'v' }],
    ['move', { initialClass: 'consonant', initialKey: 'm', finalClass: 'consonant', finalKey: 'v' }],
    ['use', { initialClass: 'glide-y', initialKey: 'j', finalClass: 'consonant', finalKey: 's' }],
    ['take', { initialClass: 'consonant', initialKey: 't', finalClass: 'consonant', finalKey: 'k' }],
    ['leave', { initialClass: 'consonant', initialKey: 'l', finalClass: 'consonant', finalKey: 'v' }],
    ['close', { initialClass: 'consonant', initialKey: 'k', finalClass: 'consonant', finalKey: 'z' }],
    ['breathe', { initialClass: 'consonant', initialKey: 'b', finalClass: 'consonant', finalKey: 'ð' }],
    ['coffee', { initialClass: 'consonant', initialKey: 'k', finalClass: 'vowel', finalKey: 'iː' }],
    ['care', { initialClass: 'consonant', initialKey: 'k', finalClass: 'vowel', finalKey: 'eɪ' }],
    ['hour', { initialClass: 'vowel', initialKey: 'aʊ', finalClass: 'consonant', finalKey: 'r' }],
    ['hours', { initialClass: 'vowel', initialKey: 'aʊ', finalClass: 'consonant', finalKey: 'z' }],
    ['honest', { initialClass: 'vowel', initialKey: 'ɑ', finalClass: 'consonant', finalKey: 't' }],
    ['honor', { initialClass: 'vowel', initialKey: 'ɑ', finalClass: 'consonant', finalKey: 'r' }],
    ['honour', { initialClass: 'vowel', initialKey: 'ɑ', finalClass: 'consonant', finalKey: 'r' }],
    ['heir', { initialClass: 'vowel', initialKey: 'ɛ', finalClass: 'consonant', finalKey: 'r' }],
    ['herb', { initialClass: 'vowel', initialKey: 'ɝ', finalClass: 'consonant', finalKey: 'b' }],
    ['earth', { initialClass: 'vowel', initialKey: 'ɝ', finalClass: 'consonant', finalKey: 'θ' }],
    ['idea', { initialClass: 'vowel', initialKey: 'aɪ', finalClass: 'vowel', finalKey: 'ə' }],
    ['away', { initialClass: 'vowel', initialKey: 'ə', finalClass: 'vowel', finalKey: 'eɪ' }],
    ['again', { initialClass: 'vowel', initialKey: 'ə', finalClass: 'consonant', finalKey: 'n' }],
    ['apple', { initialClass: 'vowel', initialKey: 'æ', finalClass: 'vowel', finalKey: 'əl' }],
    ['old', { initialClass: 'vowel', initialKey: 'oʊ', finalClass: 'consonant', finalKey: 'd' }],
    ['one', { initialClass: 'consonant', initialKey: 'w', finalClass: 'consonant', finalKey: 'n' }],
    ['once', { initialClass: 'consonant', initialKey: 'w', finalClass: 'consonant', finalKey: 's' }],
    ['year', { initialClass: 'glide-y', initialKey: 'j', finalClass: 'consonant', finalKey: 'r' }],
    ['union', { initialClass: 'consonant', initialKey: 'j', finalClass: 'consonant', finalKey: 'n' }],
    ['university', { initialClass: 'consonant', initialKey: 'j', finalClass: 'consonant', finalKey: 'ti' }],
    ['user', { initialClass: 'consonant', initialKey: 'j', finalClass: 'consonant', finalKey: 'r' }],
    ['european', { initialClass: 'consonant', initialKey: 'j', finalClass: 'consonant', finalKey: 'n' }],
    ['eulogy', { initialClass: 'consonant', initialKey: 'j', finalClass: 'consonant', finalKey: 'i' }],
    ['ubiquitous', { initialClass: 'consonant', initialKey: 'j', finalClass: 'consonant', finalKey: 's' }]
  ]);

  const SMALL_NUMBER_WORDS = new Map([
    [0, 'zero'],
    [1, 'one'],
    [2, 'two'],
    [3, 'three'],
    [4, 'four'],
    [5, 'five'],
    [6, 'six'],
    [7, 'seven'],
    [8, 'eight'],
    [9, 'nine'],
    [10, 'ten'],
    [11, 'eleven'],
    [12, 'twelve'],
    [13, 'thirteen'],
    [14, 'fourteen'],
    [15, 'fifteen'],
    [16, 'sixteen'],
    [17, 'seventeen'],
    [18, 'eighteen'],
    [19, 'nineteen']
  ]);

  const TENS_WORDS = new Map([
    [20, 'twenty'],
    [30, 'thirty'],
    [40, 'forty'],
    [50, 'fifty'],
    [60, 'sixty'],
    [70, 'seventy'],
    [80, 'eighty'],
    [90, 'ninety']
  ]);

  function normalizeComparableValue(value) {
    return String(value || '')
      .replace(/[\u2018\u2019]/g, '\'')
      .replace(/[\u201C\u201D]/g, '"')
      .trim();
  }

  function normalizeIpa(ipa) {
    return String(ipa || '')
      .replace(/^\/|\/$/g, '')
      .replace(/^[ˈˌ'`]+/g, '')
      .replace(/[ˈˌ'`.ː\s]+$/g, '')
      .replace(/\s+/g, '');
  }

  function resolveTokenProfile(token, options = {}) {
    const raw = typeof token === 'string' ? token : String(token?.raw || token?.display || '');
    const display = typeof token === 'string' ? raw : String(token?.display || token?.raw || '');
    const normalized = normalizeComparableValue(token?.normalized || raw).toLowerCase();
    const subtype = String(token?.subtype || options.subtype || inferSubtype(raw)).toLowerCase();
    const accentProfile = String(options.accentProfile || 'en-US');
    const phoneticLookup = typeof options.phoneticLookup === 'function' ? options.phoneticLookup : null;

    const base = {
      raw,
      display,
      normalized,
      subtype,
      accentProfile,
      kind: 'word',
      source: null,
      ipa: '',
      spokenForm: null,
      initialSoundClass: 'unknown',
      initialSoundKey: null,
      finalSoundClass: 'unknown',
      finalSoundKey: null,
      startsWithVowelSound: false,
      startsWithGlideY: false,
      startsWithGlideW: false,
      endsWithConsonantSound: false,
      endsWithVowelSound: false,
      endsWithPotentialLinkingR: false,
      ambiguous: false
    };

    if (!raw) {
      return base;
    }

    if (subtype === 'abbreviation') {
      return resolveAbbreviationProfile(base, raw, normalized, options);
    }

    if (subtype === 'time' || subtype === 'decimal' || subtype === 'number') {
      return resolveNumberLikeProfile(base, raw, normalized, subtype, options);
    }

    return resolveWordProfile(base, raw, normalized, phoneticLookup, accentProfile);
  }

  async function resolveWordProfile(base, raw, normalized, phoneticLookup, accentProfile) {
    const profile = { ...base };

    const specialHint = getWordHint(normalized, accentProfile);
    if (specialHint) {
      applySoundHint(profile, specialHint);
      applyFinalSoundHint(profile, specialHint);
      profile.kind = 'word';
    }

    if (phoneticLookup) {
      try {
        const result = await phoneticLookup(normalized || raw);
        if (result && typeof result === 'object') {
          profile.source = result.source || null;
          profile.ipa = String(result.selected?.ipa || result.ipa || '');
          profile.pronunciationForms = Array.isArray(result.forms) ? result.forms : [];
        } else if (typeof result === 'string') {
          profile.ipa = result;
        }
      } catch (_) {
        profile.source = null;
        profile.ipa = '';
      }
    }

    if (profile.ipa) {
      const applied = applyIpa(profile, profile.ipa);
      if (applied) {
        return profile;
      }
    }

    applySpellingFallback(profile, normalized);

    if (SILENT_INITIAL_WORDS.has(normalized)) {
      applySoundHint(profile, { initialClass: 'vowel', initialKey: normalized[0] || 'ə' });
      profile.source = profile.source || 'curated';
    }

    if (SEMIVOWEL_Y_WORDS.has(normalized)) {
      applySoundHint(profile, { initialClass: 'glide-y', initialKey: 'j' });
      profile.source = profile.source || 'curated';
    }

    if (SEMIVOWEL_W_WORDS.has(normalized)) {
      applySoundHint(profile, { initialClass: 'glide-w', initialKey: 'w' });
      profile.source = profile.source || 'curated';
    }

    if (SILENT_FINAL_TRAPS.has(normalized)) {
      profile.ambiguous = true;
      profile.endsWithConsonantSound = false;
      profile.endsWithVowelSound = false;
      profile.finalSoundClass = 'unknown';
      profile.finalSoundKey = null;
      profile.source = profile.source || 'curated';
    }

    if (profile.source == null) {
      profile.source = specialHint ? 'curated' : profile.source;
    }
    profile.endsWithPotentialLinkingR = /r$/i.test(normalized) && accentProfile !== 'en-US';
    return profile;
  }

  function resolveAbbreviationProfile(base, raw, normalized, options) {
    const profile = { ...base, kind: 'abbreviation' };
    const lookupKey = normalized.replace(/[^a-z]/g, '');
    const titleWord = ABBREVIATION_TITLE_WORDS.get(lookupKey);
    if (titleWord) {
      profile.spokenForm = titleWord;
      applySoundHint(profile, getWordHint(titleWord, options.accentProfile) || hintFromSpokenWord(titleWord));
      profile.source = 'curated';
      return profile;
    }

    const letters = raw.replace(/[^A-Za-z]/g, '').toLowerCase();
    if (!letters) {
      profile.ambiguous = true;
      applySpellingFallback(profile, normalized);
      return profile;
    }

    const spokenWords = letters.split('').map((letter) => letterNameSpokenWord(letter)).filter(Boolean);
    profile.spokenForm = spokenWords.join(' ');
    const firstLetter = letters[0];
    const lastLetter = letters[letters.length - 1];
    const firstHint = LETTER_SOUNDS.get(firstLetter) || hintFromSpokenWord(spokenWords[0] || '');
    const lastHint = LETTER_SOUNDS.get(lastLetter) || hintFromSpokenWord(spokenWords[spokenWords.length - 1] || '');
    if (firstHint) applySoundHint(profile, firstHint);
    if (lastHint) applyFinalSoundHint(profile, lastHint);
    profile.kind = 'abbreviation';
    profile.source = 'curated';
    return profile;
  }

  function resolveNumberLikeProfile(base, raw, normalized, subtype, options) {
    const profile = { ...base, kind: subtype };
    let spokenForm = '';

    if (subtype === 'time') {
      spokenForm = resolveTimeSpokenForm(raw);
    } else if (subtype === 'decimal') {
      spokenForm = resolveDecimalSpokenForm(raw);
    } else {
      spokenForm = resolveNumberSpokenForm(raw);
    }

    if (!spokenForm) {
      profile.ambiguous = true;
      applySpellingFallback(profile, normalized);
      return profile;
    }

    profile.spokenForm = spokenForm;
    const firstWord = spokenForm.split(/\s+/)[0] || '';
    const lastWord = spokenForm.split(/\s+/).slice(-1)[0] || '';
    const firstHint = getWordHint(firstWord, options.accentProfile) || hintFromSpokenWord(firstWord);
    const lastHint = getWordHint(lastWord, options.accentProfile) || hintFromSpokenWord(lastWord);
    if (firstHint) applySoundHint(profile, firstHint);
    if (lastHint) applyFinalSoundHint(profile, lastHint);
    profile.source = 'curated';
    return profile;
  }

  function applyIpa(profile, ipa) {
    const normalizedIpa = normalizeIpa(ipa);
    if (!normalizedIpa) {
      return false;
    }

    const initial = extractLeadingSound(normalizedIpa);
    const final = extractTrailingSound(normalizedIpa);
    applySoundHint(profile, soundHintFromIpaToken(initial));
    applyFinalSoundHint(profile, soundHintFromIpaToken(final));
    return profile.initialSoundClass !== 'unknown' && profile.finalSoundClass !== 'unknown';
  }

  function applySpellingFallback(profile, normalized) {
    const firstChar = normalized[0] || '';
    const lastChar = normalized[normalized.length - 1] || '';
    if (profile.initialSoundClass === 'unknown') {
      if (/[aeiou]/i.test(firstChar)) {
        profile.initialSoundClass = 'vowel';
        profile.initialSoundKey = firstChar.toLowerCase();
        profile.startsWithVowelSound = true;
      } else {
        profile.initialSoundClass = 'consonant';
        profile.initialSoundKey = firstChar.toLowerCase();
      }
    }

    if (profile.finalSoundClass === 'unknown') {
      if (/[aeiou]/i.test(lastChar)) {
        profile.finalSoundClass = 'vowel';
        profile.finalSoundKey = lastChar.toLowerCase();
        profile.endsWithVowelSound = true;
      } else {
        profile.finalSoundClass = 'consonant';
        profile.finalSoundKey = lastChar.toLowerCase();
        profile.endsWithConsonantSound = true;
      }
    }
  }

  function applySoundHint(profile, hint = {}) {
    const safeHint = hint || {};
    if (safeHint.initialClass) {
      profile.initialSoundClass = safeHint.initialClass;
    }
    if (safeHint.initialKey) {
      profile.initialSoundKey = safeHint.initialKey;
    }
    profile.startsWithVowelSound = profile.initialSoundClass === 'vowel';
    profile.startsWithGlideY = profile.initialSoundClass === 'glide-y';
    profile.startsWithGlideW = profile.initialSoundClass === 'glide-w';
  }

  function applyFinalSoundHint(profile, hint = {}) {
    const safeHint = hint || {};
    if (safeHint.finalClass) {
      profile.finalSoundClass = safeHint.finalClass;
    }
    if (safeHint.finalKey) {
      profile.finalSoundKey = safeHint.finalKey;
    }
    profile.endsWithConsonantSound = profile.finalSoundClass === 'consonant';
    profile.endsWithVowelSound = profile.finalSoundClass === 'vowel';
    if (safeHint.finalKey === 'r') {
      profile.endsWithPotentialLinkingR = true;
    }
  }

  function hintFromSpokenWord(word) {
    const normalized = normalizeComparableValue(word).toLowerCase();
    if (!normalized) return null;
    if (WORD_HINTS.has(normalized)) {
      const hint = WORD_HINTS.get(normalized);
      return { ...hint };
    }

    if (/^\d+$/.test(normalized)) {
      const spoken = resolveNumberSpokenWord(normalized);
      if (spoken) {
        return hintFromSpokenWord(spoken);
      }
    }

    return null;
  }

  function getWordHint(word, accentProfile) {
    const normalized = normalizeComparableValue(word).toLowerCase();
    if (!normalized) return null;
    if (accentProfile !== 'en-US' && normalized === 'herb') {
      return { initialClass: 'vowel', initialKey: 'ɜ' };
    }
    return WORD_HINTS.get(normalized) || null;
  }

  function soundHintFromIpaToken(token) {
    const sound = String(token || '').trim();
    if (!sound) return null;

    if (isVowelSoundKey(sound)) {
      return { initialClass: 'vowel', initialKey: sound };
    }
    if (sound === 'j') {
      return { initialClass: 'glide-y', initialKey: sound };
    }
    if (sound === 'w') {
      return { initialClass: 'glide-w', initialKey: sound };
    }
    return { initialClass: 'consonant', initialKey: sound };
  }

  function isVowelSoundKey(sound) {
    return /^(?:aɪ|eɪ|oʊ|aʊ|ɔɪ|ɑ|æ|ʌ|ɔ|a|ɛ|e|ɪ|i|ə|u|ʊ|ɚ|ɝ|ɜ|ɐ|ɨ|ɵ|ʉ|œ|ø|ɞ|ʏ)$/i.test(sound);
  }

  function extractLeadingSound(ipa) {
    const normalized = normalizeIpa(ipa);
    const prefixes = ['aɪ', 'eɪ', 'oʊ', 'aʊ', 'ɔɪ', 'tʃ', 'dʒ', 'ʃ', 'ʒ', 'θ', 'ð', 'ŋ', 'ɚ', 'ɝ', 'j', 'w'];
    for (const prefix of prefixes) {
      if (normalized.startsWith(prefix)) {
        return prefix;
      }
    }
    return normalized[0] || '';
  }

  function extractTrailingSound(ipa) {
    const normalized = normalizeIpa(ipa);
    const suffixes = ['aɪ', 'eɪ', 'oʊ', 'aʊ', 'ɔɪ', 'tʃ', 'dʒ', 'ʃ', 'ʒ', 'θ', 'ð', 'ŋ', 'ɚ', 'ɝ'];
    for (const suffix of suffixes) {
      if (normalized.endsWith(suffix)) {
        return suffix;
      }
    }
    return normalized.slice(-1) || '';
  }

  function resolveTimeSpokenForm(raw) {
    const [hour, minute = ''] = String(raw || '').split(':');
    const hourWords = resolveNumberSpokenWord(hour);
    if (!hourWords) return '';
    if (!minute || /^0+$/.test(minute)) return hourWords;
    const minuteWords = resolveNumberSpokenWord(minute.replace(/^0+/, '') || '0');
    return minuteWords ? `${hourWords} ${minuteWords}` : hourWords;
  }

  function resolveDecimalSpokenForm(raw) {
    const [integerPart, fractionPart = ''] = String(raw || '').split('.');
    const integerWords = resolveNumberSpokenWord(integerPart);
    if (!integerWords) return '';
    if (!fractionPart) return integerWords;
    const fractionWords = fractionPart.split('').map((digit) => resolveNumberSpokenWord(digit)).filter(Boolean);
    return fractionWords.length ? `${integerWords} point ${fractionWords.join(' ')}` : integerWords;
  }

  function resolveNumberSpokenForm(raw) {
    const normalized = String(raw || '').replace(/,/g, '').trim();
    const ordinalMatch = normalized.match(/^(\d+)(st|nd|rd|th)$/i);
    if (ordinalMatch) {
      const spoken = resolveOrdinalSpokenWord(Number(ordinalMatch[1]));
      return spoken || '';
    }

    if (/^\d+$/.test(normalized)) {
      return resolveNumberSpokenWord(normalized);
    }

    return '';
  }

  function resolveOrdinalSpokenWord(value) {
    const ordinals = new Map([
      [1, 'first'],
      [2, 'second'],
      [3, 'third'],
      [4, 'fourth'],
      [5, 'fifth'],
      [6, 'sixth'],
      [7, 'seventh'],
      [8, 'eighth'],
      [9, 'ninth'],
      [10, 'tenth'],
      [11, 'eleventh'],
      [12, 'twelfth'],
      [13, 'thirteenth'],
      [14, 'fourteenth'],
      [15, 'fifteenth'],
      [16, 'sixteenth'],
      [17, 'seventeenth'],
      [18, 'eighteenth'],
      [19, 'nineteenth'],
      [20, 'twentieth']
    ]);
    if (ordinals.has(value)) {
      return ordinals.get(value);
    }
    return resolveNumberSpokenWord(String(value));
  }

  function resolveNumberSpokenWord(raw) {
    const normalized = String(raw || '').replace(/,/g, '');
    if (!/^\d+$/.test(normalized)) {
      return '';
    }

    const value = Number(normalized);
    if (!Number.isFinite(value)) return '';

    if (normalized.length > 1 && /^0+/.test(normalized)) {
      return `oh ${normalized.replace(/^0+/, '').split('').map((digit) => SMALL_NUMBER_WORDS.get(Number(digit)) || '').filter(Boolean).join(' ')}`.trim();
    }

    if (SMALL_NUMBER_WORDS.has(value)) {
      return SMALL_NUMBER_WORDS.get(value);
    }

    if (value < 100) {
      const tens = Math.floor(value / 10) * 10;
      const ones = value % 10;
      const tensWord = TENS_WORDS.get(tens);
      if (!tensWord) return '';
      return ones ? `${tensWord} ${SMALL_NUMBER_WORDS.get(ones)}` : tensWord;
    }

    if (value < 1000) {
      const hundreds = Math.floor(value / 100);
      const remainder = value % 100;
      const hundredWords = `${SMALL_NUMBER_WORDS.get(hundreds)} hundred`;
      if (!remainder) return hundredWords;
      const remainderWords = resolveNumberSpokenWord(String(remainder));
      return remainderWords ? `${hundredWords} ${remainderWords}` : hundredWords;
    }

    if (value < 1000000) {
      const thousands = Math.floor(value / 1000);
      const remainder = value % 1000;
      const thousandWords = `${resolveNumberSpokenWord(String(thousands))} thousand`;
      if (!remainder) return thousandWords;
      const remainderWords = resolveNumberSpokenWord(String(remainder));
      return remainderWords ? `${thousandWords} ${remainderWords}` : thousandWords;
    }

    return String(value);
  }

  function inferSubtype(raw) {
    if (/^(?:[A-Za-z]{1,3}\.){2,}$/.test(raw) || /^(?:[AaPp])\.[Mm]\.$/.test(raw) || /^(?:Mr|Mrs|Ms|Dr|Prof)\./i.test(raw)) {
      return 'abbreviation';
    }
    if (/^\d{1,2}:\d{2}$/.test(raw)) return 'time';
    if (/^\d+\.\d+$/.test(raw)) return 'decimal';
    if (/^\d+(?:st|nd|rd|th)?$/i.test(raw)) return 'number';
    return 'word';
  }

  function letterNameSpokenWord(letter) {
    if (!letter) return '';
    const lower = letter.toLowerCase();
    const letterToWord = new Map([
      ['a', 'ay'],
      ['b', 'bee'],
      ['c', 'see'],
      ['d', 'dee'],
      ['e', 'ee'],
      ['f', 'ef'],
      ['g', 'gee'],
      ['h', 'aitch'],
      ['i', 'eye'],
      ['j', 'jay'],
      ['k', 'kay'],
      ['l', 'el'],
      ['m', 'em'],
      ['n', 'en'],
      ['o', 'oh'],
      ['p', 'pee'],
      ['q', 'cue'],
      ['r', 'ar'],
      ['s', 'ess'],
      ['t', 'tee'],
      ['u', 'you'],
      ['v', 'vee'],
      ['w', 'doubleyou'],
      ['x', 'ex'],
      ['y', 'why'],
      ['z', 'zee']
    ]);
    return letterToWord.get(lower) || lower;
  }

  const api = {
    resolveTokenProfile,
    normalizeComparableValue,
    normalizeIpa,
    getWordHint,
    resolveNumberSpokenWord,
    resolveNumberSpokenForm,
    resolveDecimalSpokenForm,
    resolveTimeSpokenForm,
    SILENT_INITIAL_WORDS,
    SEMIVOWEL_Y_WORDS,
    SEMIVOWEL_W_WORDS,
    ABBREVIATION_TITLE_WORDS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.ReadAloudSpokenForms = api;
  }
  return api;
})(typeof window !== 'undefined' ? window : globalThis);
