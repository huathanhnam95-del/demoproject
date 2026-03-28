(function (root) {
  'use strict';

  const FRONT_VOWEL_KEYS = new Set(['i', 'iː', 'ɪ', 'e', 'eɪ', 'ɛ', 'æ', 'aɪ']);
  const BACK_VOWEL_KEYS = new Set(['u', 'uː', 'ʊ', 'o', 'oʊ', 'ɔ', 'aʊ', 'ɔɪ']);
  const VOWEL_KEYS = new Set(['aɪ', 'eɪ', 'oʊ', 'aʊ', 'ɔɪ', 'ɑ', 'æ', 'ʌ', 'ɔ', 'a', 'ɛ', 'e', 'ɪ', 'i', 'ə', 'u', 'ʊ', 'ɚ', 'ɝ', 'ɜ', 'ɐ', 'ɨ', 'ɵ', 'ʉ', 'œ', 'ø', 'ɞ', 'ʏ']);

  function evaluateBoundary(boundary, leftProfile, rightProfile, options = {}) {
    const enabledRuleSet = String(options.enabledRuleSet || 'linking-v1');
    const accentProfile = String(options.accentProfile || 'en-US');

    if (!boundary || !leftProfile || !rightProfile) {
      return {
        ...boundary,
        blocked: true,
        blockedReason: 'low_confidence',
        category: 'none',
        subtype: null,
        confidence: 'low',
        source: leftProfile?.source || rightProfile?.source || null
      };
    }

    if (leftProfile.ambiguous || rightProfile.ambiguous) {
      return {
        ...boundary,
        blocked: true,
        blockedReason: 'low_confidence',
        category: 'none',
        subtype: null,
        confidence: 'low',
        source: leftProfile.source || rightProfile.source || null
      };
    }

    if (boundary.blockedReason === 'hard_boundary') {
      return {
        ...boundary,
        subtype: null
      };
    }

    if (enabledRuleSet === 'connected-speech-v3') {
      const coalescentBoundary = classifyCoalescentAssimilation(boundary, leftProfile, rightProfile, enabledRuleSet, accentProfile);
      if (coalescentBoundary) {
        return coalescentBoundary;
      }
      const bilabialBoundary = classifyBilabialAssimilation(boundary, leftProfile, rightProfile, enabledRuleSet, accentProfile);
      if (bilabialBoundary) {
        return bilabialBoundary;
      }
    }

    if (rightProfile.startsWithGlideY || rightProfile.startsWithGlideW) {
      return {
        ...boundary,
        blocked: true,
        blockedReason: 'semivowel_onset',
        category: 'none',
        subtype: null,
        confidence: 'low',
        source: leftProfile.source || rightProfile.source || null
      };
    }

    if (leftProfile.endsWithConsonantSound && rightProfile.startsWithVowelSound) {
      return classifyCatenation(boundary, leftProfile, rightProfile, enabledRuleSet);
    }

    if (leftProfile.endsWithVowelSound && rightProfile.startsWithVowelSound) {
      const glideBoundary = classifyVowelToVowel(boundary, leftProfile, rightProfile, enabledRuleSet, accentProfile);
      if (glideBoundary) {
        return glideBoundary;
      }
    }

    if (isSameConsonantMerge(leftProfile, rightProfile)) {
      return {
        ...boundary,
        blocked: false,
        blockedReason: null,
        category: 'consonant_to_consonant',
        subtype: 'same_consonant_merge',
        confidence: leftProfile.source === 'cmu' && rightProfile.source === 'cmu' ? 'high' : 'medium',
        source: leftProfile.source === 'cmu' && rightProfile.source === 'cmu'
          ? 'cmu'
          : leftProfile.source || rightProfile.source || 'curated'
      };
    }

    if (enabledRuleSet !== 'linking-v1') {
      return {
        ...boundary,
        blocked: true,
        blockedReason: 'low_confidence',
        category: 'none',
        subtype: null,
        confidence: 'low',
        source: leftProfile.source || rightProfile.source || null
      };
    }

    return {
      ...boundary,
      blocked: true,
      blockedReason: 'low_confidence',
      category: 'none',
      subtype: null,
      confidence: 'low',
      source: leftProfile.source || rightProfile.source || null
    };
  }

  function classifyCoalescentAssimilation(boundary, leftProfile, rightProfile, enabledRuleSet, accentProfile) {
    const rightNormalized = String(rightProfile.normalized || rightProfile.display || '').toLowerCase();
    const rightKey = String(rightProfile.initialSoundKey || '').toLowerCase();
    if (!rightProfile.startsWithGlideY && rightKey !== 'j') return null;
    if (rightNormalized !== 'you' && rightNormalized !== 'year') return null;

    const leftKey = String(leftProfile.finalSoundKey || '').toLowerCase();
    const subtypeMap = {
      d: 'coalescent_dj',
      t: 'coalescent_tj',
      s: 'coalescent_sj',
      z: 'coalescent_zj'
    };
    const subtype = subtypeMap[leftKey];
    if (!subtype) return null;

    const highConfidence = leftProfile.source === 'cmu' && rightProfile.source === 'cmu';
    return {
      ...boundary,
      blocked: false,
      blockedReason: null,
      category: 'connected_speech',
      subtype,
      layer: 'assimilation',
      teachingLevel: 'v3',
      legendLabel: 'Sound change',
      explanationKey: subtype,
      markerText: 'sound change',
      confidence: highConfidence ? 'high' : 'medium',
      source: highConfidence ? 'cmu' : (leftProfile.source || rightProfile.source || 'curated'),
      ruleSet: enabledRuleSet,
      accentProfile
    };
  }

  function classifyBilabialAssimilation(boundary, leftProfile, rightProfile, enabledRuleSet, accentProfile) {
    const leftKey = String(leftProfile.finalSoundKey || '').toLowerCase();
    const rightKey = String(rightProfile.initialSoundKey || '').toLowerCase();
    const bilabialSet = new Set(['b', 'p', 'm']);
    if (leftKey !== 'n' || !bilabialSet.has(rightKey)) return null;

    const highConfidence = leftProfile.source === 'cmu' && rightProfile.source === 'cmu';
    return {
      ...boundary,
      blocked: false,
      blockedReason: null,
      category: 'connected_speech',
      subtype: 'n_bilabial_assimilation',
      layer: 'assimilation',
      teachingLevel: 'v3',
      legendLabel: 'Sound change',
      explanationKey: 'n_bilabial_assimilation',
      markerText: 'sound change',
      confidence: highConfidence ? 'high' : 'medium',
      source: highConfidence ? 'cmu' : (leftProfile.source || rightProfile.source || 'curated'),
      ruleSet: enabledRuleSet,
      accentProfile
    };
  }

  function classifyCatenation(boundary, leftProfile, rightProfile, enabledRuleSet) {
    const specialBoundary = leftProfile.kind !== 'word' || rightProfile.kind !== 'word';
    const highConfidence = leftProfile.source === 'cmu' && rightProfile.source === 'cmu';
    const mediumConfidence = specialBoundary || leftProfile.source === 'curated' || rightProfile.source === 'curated';
    const confidence = highConfidence ? 'high' : (mediumConfidence ? 'medium' : 'medium');

    return {
      ...boundary,
      blocked: false,
      blockedReason: null,
      category: 'consonant_to_vowel',
      subtype: specialBoundary ? 'special_token' : 'catenation',
      confidence,
      source: highConfidence ? 'cmu' : (leftProfile.source || rightProfile.source || 'curated'),
      ruleSet: enabledRuleSet
    };
  }

  function classifyVowelToVowel(boundary, leftProfile, rightProfile, enabledRuleSet, accentProfile) {
    const leftKey = String(leftProfile.finalSoundKey || '').toLowerCase();
    const rightKey = String(rightProfile.initialSoundKey || '').toLowerCase();

    if (shouldUseYGlide(leftProfile, rightProfile)) {
      return {
        ...boundary,
        blocked: false,
        blockedReason: null,
        category: 'vowel_to_vowel',
        subtype: 'y_glide',
        confidence: leftProfile.source === 'cmu' && rightProfile.source === 'cmu' ? 'high' : 'medium',
        source: leftProfile.source === 'cmu' && rightProfile.source === 'cmu'
          ? 'cmu'
          : leftProfile.source || rightProfile.source || 'curated',
        ruleSet: enabledRuleSet,
        accentProfile
      };
    }

    if (shouldUseWGlide(leftProfile, rightProfile)) {
      return {
        ...boundary,
        blocked: false,
        blockedReason: null,
        category: 'vowel_to_vowel',
        subtype: 'w_glide',
        confidence: leftProfile.source === 'cmu' && rightProfile.source === 'cmu' ? 'high' : 'medium',
        source: leftProfile.source === 'cmu' && rightProfile.source === 'cmu'
          ? 'cmu'
          : leftProfile.source || rightProfile.source || 'curated',
        ruleSet: enabledRuleSet,
        accentProfile
      };
    }

    if (leftKey && rightKey && VOWEL_KEYS.has(leftKey) && VOWEL_KEYS.has(rightKey)) {
      return {
        ...boundary,
        blocked: false,
        blockedReason: null,
        category: 'vowel_to_vowel',
        subtype: 'generic_vowel_link',
        confidence: leftProfile.source === 'cmu' && rightProfile.source === 'cmu' ? 'medium' : 'medium',
        source: leftProfile.source || rightProfile.source || 'curated',
        ruleSet: enabledRuleSet,
        accentProfile
      };
    }

    return null;
  }

  function shouldUseYGlide(leftProfile, rightProfile) {
    const leftKey = String(leftProfile.finalSoundKey || '').toLowerCase();
    return FRONT_VOWEL_KEYS.has(leftKey) && rightProfile.startsWithVowelSound;
  }

  function shouldUseWGlide(leftProfile, rightProfile) {
    const leftKey = String(leftProfile.finalSoundKey || '').toLowerCase();
    return BACK_VOWEL_KEYS.has(leftKey) && rightProfile.startsWithVowelSound;
  }

  function isSameConsonantMerge(leftProfile, rightProfile) {
    return leftProfile.finalSoundClass === 'consonant'
      && rightProfile.initialSoundClass === 'consonant'
      && String(leftProfile.finalSoundKey || '').toLowerCase() === String(rightProfile.initialSoundKey || '').toLowerCase();
  }

  const api = {
    evaluateBoundary,
    classifyCoalescentAssimilation,
    classifyCatenation,
    classifyVowelToVowel,
    shouldUseYGlide,
    shouldUseWGlide,
    isSameConsonantMerge
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.ReadAloudConnectedSpeechRules = api;
  }
  return api;
})(typeof window !== 'undefined' ? window : globalThis);
