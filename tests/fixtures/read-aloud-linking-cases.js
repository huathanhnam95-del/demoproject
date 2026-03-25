const PHASE1_LINKING_CASES = [
  {
    id: 'back-into',
    text: 'back into',
    leftWord: 'back',
    rightWord: 'into',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'catenation', confidence: 'high', source: 'cmu' },
    lookup: {
      back: { source: 'cmu', ipa: 'bæk' },
      into: { source: 'cmu', ipa: 'ˈɪntu' }
    }
  },
  {
    id: 'pick-it',
    text: 'pick it',
    leftWord: 'pick',
    rightWord: 'it',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'catenation', confidence: 'medium' }
  },
  {
    id: 'take-it',
    text: 'take it',
    leftWord: 'take',
    rightWord: 'it',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'catenation', confidence: 'high', source: 'cmu' },
    lookup: {
      take: { source: 'cmu', ipa: 'teɪk' },
      it: { source: 'cmu', ipa: 'ɪt' }
    }
  },
  {
    id: 'made-of',
    text: 'made of',
    leftWord: 'made',
    rightWord: 'of',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'catenation', confidence: 'high', source: 'cmu' },
    lookup: {
      made: { source: 'cmu', ipa: 'meɪd' },
      of: { source: 'cmu', ipa: 'əv' }
    }
  },
  {
    id: 'save-it',
    text: 'save it',
    leftWord: 'save',
    rightWord: 'it',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'catenation', confidence: 'high', source: 'cmu' },
    lookup: {
      save: { source: 'cmu', ipa: 'seɪv' },
      it: { source: 'cmu', ipa: 'ɪt' }
    }
  },
  {
    id: 'move-in',
    text: 'move in',
    leftWord: 'move',
    rightWord: 'in',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'catenation', confidence: 'high', source: 'cmu' },
    lookup: {
      move: { source: 'cmu', ipa: 'muːv' },
      in: { source: 'cmu', ipa: 'ɪn' }
    }
  },
  {
    id: 'use-it',
    text: 'use it',
    leftWord: 'use',
    rightWord: 'it',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'catenation', confidence: 'high', source: 'cmu' },
    lookup: {
      use: { source: 'cmu', ipa: 'juːz' },
      it: { source: 'cmu', ipa: 'ɪt' }
    }
  },
  {
    id: 'close-up',
    text: 'close up',
    leftWord: 'close',
    rightWord: 'up',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'catenation', confidence: 'high', source: 'cmu' },
    lookup: {
      close: { source: 'cmu', ipa: 'kloʊz' },
      up: { source: 'cmu', ipa: 'ʌp' }
    }
  },
  {
    id: 'breathe-in',
    text: 'breathe in',
    leftWord: 'breathe',
    rightWord: 'in',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'catenation', confidence: 'high', source: 'cmu' },
    lookup: {
      breathe: { source: 'cmu', ipa: 'briːð' },
      in: { source: 'cmu', ipa: 'ɪn' }
    }
  },
  {
    id: 'leave-early',
    text: 'leave early',
    leftWord: 'leave',
    rightWord: 'early',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'catenation', confidence: 'high', source: 'cmu' },
    lookup: {
      leave: { source: 'cmu', ipa: 'liːv' },
      early: { source: 'cmu', ipa: 'ˈɜːrli' }
    }
  },
  {
    id: 'turn-off',
    text: 'turn off',
    leftWord: 'turn',
    rightWord: 'off',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'catenation', confidence: 'medium' }
  },
  {
    id: 'send-it',
    text: 'send it',
    leftWord: 'send',
    rightWord: 'it',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'catenation', confidence: 'medium' }
  },
  {
    id: 'good-idea',
    text: 'good idea',
    leftWord: 'good',
    rightWord: 'idea',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'catenation', confidence: 'medium' }
  },
  {
    id: 'stop-asking',
    text: 'stop asking',
    leftWord: 'stop',
    rightWord: 'asking',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'catenation', confidence: 'medium' }
  },
  {
    id: 'big-apple',
    text: 'big apple',
    leftWord: 'big',
    rightWord: 'apple',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'catenation', confidence: 'medium' }
  },
  {
    id: 'an-hour',
    text: 'an hour',
    leftWord: 'an',
    rightWord: 'hour',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'catenation', confidence: 'high', source: 'cmu' },
    lookup: {
      an: { source: 'cmu', ipa: 'æn' },
      hour: { source: 'cmu', ipa: 'ˈaʊɚ' }
    }
  },
  {
    id: 'that-earth',
    text: 'that Earth',
    leftWord: 'that',
    rightWord: 'earth',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'catenation', confidence: 'high', source: 'cmu' },
    lookup: {
      that: { source: 'cmu', ipa: 'ðæt' },
      earth: { source: 'cmu', ipa: 'ɝθ' }
    }
  },
  {
    id: 'an-heir',
    text: 'an heir',
    leftWord: 'an',
    rightWord: 'heir',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'catenation', confidence: 'high', source: 'cmu' },
    lookup: {
      an: { source: 'cmu', ipa: 'æn' },
      heir: { source: 'cmu', ipa: 'ɛr' }
    }
  },
  {
    id: 'an-honor',
    text: 'an honor award',
    leftWord: 'an',
    rightWord: 'honor',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'catenation', confidence: 'high', source: 'cmu' },
    lookup: {
      an: { source: 'cmu', ipa: 'æn' },
      honor: { source: 'cmu', ipa: 'ˈɑnɚ' }
    }
  },
  {
    id: 'an-herb',
    text: 'an herb garden',
    leftWord: 'an',
    rightWord: 'herb',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'catenation', confidence: 'high', source: 'cmu' },
    lookup: {
      an: { source: 'cmu', ipa: 'æn' },
      herb: { source: 'cmu', ipa: 'ɝb' }
    }
  },
  {
    id: 'an-honest',
    text: 'an honest answer',
    leftWord: 'an',
    rightWord: 'honest',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'catenation', confidence: 'high', source: 'cmu' },
    lookup: {
      an: { source: 'cmu', ipa: 'æn' },
      honest: { source: 'cmu', ipa: 'ˈɑnəst' }
    }
  },
  {
    id: 'mri-exam',
    text: 'MRI exam',
    leftWord: 'mri',
    rightWord: 'exam',
    expected: { blocked: false, category: 'vowel_to_vowel', subtype: 'y_glide', confidence: 'medium' }
  },
  {
    id: 'fbi-agent',
    text: 'FBI agent',
    leftWord: 'fbi',
    rightWord: 'agent',
    expected: { blocked: false, category: 'vowel_to_vowel', subtype: 'y_glide', confidence: 'medium' }
  },
  {
    id: 'mba-application',
    text: 'MBA application',
    leftWord: 'mba',
    rightWord: 'application',
    expected: { blocked: false, category: 'vowel_to_vowel', subtype: 'y_glide', confidence: 'medium' }
  },
  {
    id: 'fcc-audit',
    text: 'FCC audit',
    leftWord: 'fcc',
    rightWord: 'audit',
    expected: { blocked: false, category: 'vowel_to_vowel', subtype: 'y_glide', confidence: 'medium' }
  },
  {
    id: 'sos-alert',
    text: 'SOS alert',
    leftWord: 'sos',
    rightWord: 'alert',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'special_token', confidence: 'medium' }
  },
  {
    id: 'phd-exam',
    text: 'Ph.D. exam',
    leftWord: 'ph.d.',
    rightWord: 'exam',
    expected: { blocked: false, category: 'vowel_to_vowel', subtype: 'y_glide', confidence: 'medium' }
  },
  {
    id: '8-apples',
    text: '8 apples',
    leftWord: '8',
    rightWord: 'apples',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'special_token', confidence: 'medium' }
  },
  {
    id: '11-emails',
    text: '11 emails',
    leftWord: '11',
    rightWord: 'emails',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'special_token', confidence: 'medium' }
  },
  {
    id: '18-hours',
    text: '18 hours',
    leftWord: '18',
    rightWord: 'hours',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'special_token', confidence: 'medium' }
  },
  {
    id: '8-00-appointment',
    text: '8:00 appointment',
    leftWord: '8:00',
    rightWord: 'appointment',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'special_token', confidence: 'medium' }
  },
  {
    id: '11-08-arrival',
    text: '11:08 arrival',
    leftWord: '11:08',
    rightWord: 'arrival',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'special_token', confidence: 'medium' }
  },
  {
    id: '8-1-ounces',
    text: '8.1 ounces',
    leftWord: '8.1',
    rightWord: 'ounces',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'special_token', confidence: 'medium' }
  },
  {
    id: '18-5-acres',
    text: '18.5 acres',
    leftWord: '18.5',
    rightWord: 'acres',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'special_token', confidence: 'medium' }
  },
  {
    id: 'see-it',
    text: 'see it',
    leftWord: 'see',
    rightWord: 'it',
    expected: { blocked: false, category: 'vowel_to_vowel', subtype: 'y_glide', confidence: 'medium' }
  },
  {
    id: 'be-honest',
    text: 'be honest',
    leftWord: 'be',
    rightWord: 'honest',
    expected: { blocked: false, category: 'vowel_to_vowel', subtype: 'y_glide', confidence: 'medium' }
  },
  {
    id: 'free-entry',
    text: 'free entry',
    leftWord: 'free',
    rightWord: 'entry',
    expected: { blocked: false, category: 'vowel_to_vowel', subtype: 'y_glide', confidence: 'medium' }
  },
  {
    id: 'i-agree',
    text: 'I agree',
    leftWord: 'i',
    rightWord: 'agree',
    expected: { blocked: false, category: 'vowel_to_vowel', subtype: 'y_glide', confidence: 'high', source: 'cmu' },
    lookup: {
      i: { source: 'cmu', ipa: 'aɪ' },
      agree: { source: 'cmu', ipa: 'əˈɡriː' }
    }
  },
  {
    id: 'day-off',
    text: 'day off',
    leftWord: 'day',
    rightWord: 'off',
    expected: { blocked: false, category: 'vowel_to_vowel', subtype: 'y_glide', confidence: 'high', source: 'cmu' },
    lookup: {
      day: { source: 'cmu', ipa: 'deɪ' },
      off: { source: 'cmu', ipa: 'ɔf' }
    }
  },
  {
    id: 'go-out',
    text: 'go out',
    leftWord: 'go',
    rightWord: 'out',
    expected: { blocked: false, category: 'vowel_to_vowel', subtype: 'w_glide', confidence: 'high', source: 'cmu' },
    lookup: {
      go: { source: 'cmu', ipa: 'ɡoʊ' },
      out: { source: 'cmu', ipa: 'aʊt' }
    }
  },
  {
    id: 'do-it',
    text: 'do it',
    leftWord: 'do',
    rightWord: 'it',
    expected: { blocked: false, category: 'vowel_to_vowel', subtype: 'w_glide', confidence: 'high', source: 'cmu' },
    lookup: {
      do: { source: 'cmu', ipa: 'duː' },
      it: { source: 'cmu', ipa: 'ɪt' }
    }
  },
  {
    id: 'blue-ocean',
    text: 'blue ocean',
    leftWord: 'blue',
    rightWord: 'ocean',
    expected: { blocked: false, category: 'vowel_to_vowel', subtype: 'w_glide', confidence: 'high', source: 'cmu' },
    lookup: {
      blue: { source: 'cmu', ipa: 'bluː' },
      ocean: { source: 'cmu', ipa: 'ˈoʊʃən' }
    }
  },
  {
    id: 'no-idea',
    text: 'no idea',
    leftWord: 'no',
    rightWord: 'idea',
    expected: { blocked: false, category: 'vowel_to_vowel', subtype: 'w_glide', confidence: 'high', source: 'cmu' },
    lookup: {
      no: { source: 'cmu', ipa: 'noʊ' },
      idea: { source: 'cmu', ipa: 'aɪˈdiːə' }
    }
  },
  {
    id: 'two-apples',
    text: 'two apples',
    leftWord: 'two',
    rightWord: 'apples',
    expected: { blocked: false, category: 'vowel_to_vowel', subtype: 'w_glide', confidence: 'high', source: 'cmu' },
    lookup: {
      two: { source: 'cmu', ipa: 'tuː' },
      apples: { source: 'cmu', ipa: 'ˈæpəlz' }
    }
  },
  {
    id: 'low-income',
    text: 'low income',
    leftWord: 'low',
    rightWord: 'income',
    expected: { blocked: false, category: 'vowel_to_vowel', subtype: 'w_glide', confidence: 'high', source: 'cmu' },
    lookup: {
      low: { source: 'cmu', ipa: 'loʊ' },
      income: { source: 'cmu', ipa: 'ˈɪnkʌm' }
    }
  },
  {
    id: 'big-game',
    text: 'big game',
    leftWord: 'big',
    rightWord: 'game',
    expected: { blocked: false, category: 'consonant_to_consonant', subtype: 'same_consonant_merge', confidence: 'medium' }
  },
  {
    id: 'good-day',
    text: 'good day',
    leftWord: 'good',
    rightWord: 'day',
    expected: { blocked: false, category: 'consonant_to_consonant', subtype: 'same_consonant_merge', confidence: 'medium' }
  },
  {
    id: 'red-door',
    text: 'red door',
    leftWord: 'red',
    rightWord: 'door',
    expected: { blocked: false, category: 'consonant_to_consonant', subtype: 'same_consonant_merge', confidence: 'medium' }
  },
  {
    id: 'black-coffee',
    text: 'black coffee',
    leftWord: 'black',
    rightWord: 'coffee',
    expected: { blocked: false, category: 'consonant_to_consonant', subtype: 'same_consonant_merge', confidence: 'medium' }
  },
  {
    id: 'cheap-pen',
    text: 'cheap pen',
    leftWord: 'cheap',
    rightWord: 'pen',
    expected: { blocked: false, category: 'consonant_to_consonant', subtype: 'same_consonant_merge', confidence: 'medium' }
  },
  {
    id: 'less-sugar',
    text: 'less sugar',
    leftWord: 'less',
    rightWord: 'sugar',
    expected: { blocked: false, category: 'consonant_to_consonant', subtype: 'same_consonant_merge', confidence: 'medium' }
  },
  {
    id: 'take-care',
    text: 'take care',
    leftWord: 'take',
    rightWord: 'care',
    expected: { blocked: false, category: 'consonant_to_consonant', subtype: 'same_consonant_merge', confidence: 'medium' }
  }
];

const PHASE1_BLOCKED_CASES = [
  {
    id: 'climb-up',
    text: 'climb up',
    leftWord: 'climb',
    rightWord: 'up',
    expected: { blocked: true, blockedReason: 'low_confidence' }
  },
  {
    id: 'debt-owed',
    text: 'debt owed',
    leftWord: 'debt',
    rightWord: 'owed',
    expected: { blocked: true, blockedReason: 'low_confidence' }
  },
  {
    id: 'subtle-answer',
    text: 'subtle answer',
    leftWord: 'subtle',
    rightWord: 'answer',
    expected: { blocked: true, blockedReason: 'low_confidence' }
  },
  {
    id: 'a-university',
    text: 'a university',
    leftWord: 'a',
    rightWord: 'university',
    expected: { blocked: true, blockedReason: 'semivowel_onset' }
  },
  {
    id: 'the-user-interface',
    text: 'the user interface',
    leftWord: 'the',
    rightWord: 'user',
    expected: { blocked: true, blockedReason: 'semivowel_onset' }
  },
  {
    id: 'a-european-trip',
    text: 'a European trip',
    leftWord: 'a',
    rightWord: 'european',
    expected: { blocked: true, blockedReason: 'semivowel_onset' }
  },
  {
    id: 'a-eulogy',
    text: 'a eulogy',
    leftWord: 'a',
    rightWord: 'eulogy',
    expected: { blocked: true, blockedReason: 'semivowel_onset' }
  },
  {
    id: 'a-ubiquitous-app',
    text: 'a ubiquitous app',
    leftWord: 'a',
    rightWord: 'ubiquitous',
    expected: { blocked: true, blockedReason: 'semivowel_onset' }
  },
  {
    id: 'go-away',
    text: 'go, away',
    leftWord: 'go',
    rightWord: 'away',
    expected: { blocked: true, blockedReason: 'hard_boundary' }
  },
  {
    id: 'stop-it',
    text: 'stop. It',
    leftWord: 'stop',
    rightWord: 'it',
    expected: { blocked: true, blockedReason: 'hard_boundary' }
  },
  {
    id: 'quoted-go',
    text: '"go" away',
    leftWord: 'go',
    rightWord: 'away',
    expected: { blocked: true, blockedReason: 'hard_boundary' }
  },
  {
    id: 'turn-linebreak-off',
    text: 'turn\noff',
    leftWord: 'turn',
    rightWord: 'off',
    expected: { blocked: true, blockedReason: 'hard_boundary' }
  }
];

const PHASE2_REDUCED_WORD_CASES = [
  {
    id: 'i-can-ask',
    text: 'I can ask',
    word: 'can',
    expected: { layer: 'weak_forms', subtype: 'can', confidence: 'medium' }
  },
  {
    id: 'the-apple',
    text: 'the apple',
    word: 'the',
    expected: { layer: 'weak_forms', subtype: 'the', confidence: 'medium' }
  },
  {
    id: 'a-simple-answer',
    text: 'a simple answer',
    word: 'a',
    expected: { layer: 'weak_forms', subtype: 'a', confidence: 'medium' }
  },
  {
    id: 'an-honest-answer',
    text: 'an honest answer',
    word: 'an',
    expected: { layer: 'weak_forms', subtype: 'an', confidence: 'medium' }
  },
  {
    id: 'to-ask',
    text: 'to ask',
    word: 'to',
    expected: { layer: 'weak_forms', subtype: 'to', confidence: 'medium' }
  },
  {
    id: 'of-tea',
    text: 'of tea',
    word: 'of',
    expected: { layer: 'weak_forms', subtype: 'of', confidence: 'medium' }
  },
  {
    id: 'and-ask',
    text: 'and ask',
    word: 'and',
    expected: { layer: 'weak_forms', subtype: 'and', confidence: 'medium' }
  },
  {
    id: 'for-help',
    text: 'for help',
    word: 'for',
    expected: { layer: 'weak_forms', subtype: 'for', confidence: 'medium' }
  },
  {
    id: 'have-apples',
    text: 'have apples',
    word: 'have',
    expected: { layer: 'weak_forms', subtype: 'have', confidence: 'medium' }
  },
  {
    id: 'was-awake',
    text: 'was awake',
    word: 'was',
    expected: { layer: 'weak_forms', subtype: 'was', confidence: 'medium' }
  },
  {
    id: 'were-able',
    text: 'were able',
    word: 'were',
    expected: { layer: 'weak_forms', subtype: 'were', confidence: 'medium' }
  },
  {
    id: 'has-ideas',
    text: 'has ideas',
    word: 'has',
    expected: { layer: 'weak_forms', subtype: 'has', confidence: 'medium' }
  }
];

const PHASE3_SOUND_CHANGE_CASES = [
  {
    id: 'did-you',
    text: 'did you',
    leftWord: 'did',
    rightWord: 'you',
    expected: { blocked: false, category: 'connected_speech', subtype: 'coalescent_dj', confidence: 'medium' }
  },
  {
    id: 'would-you',
    text: 'would you',
    leftWord: 'would',
    rightWord: 'you',
    expected: { blocked: false, category: 'connected_speech', subtype: 'coalescent_dj', confidence: 'medium' }
  },
  {
    id: 'could-you',
    text: 'could you',
    leftWord: 'could',
    rightWord: 'you',
    expected: { blocked: false, category: 'connected_speech', subtype: 'coalescent_dj', confidence: 'medium' }
  },
  {
    id: 'dont-you',
    text: "don't you",
    leftWord: "don't",
    rightWord: 'you',
    expected: { blocked: false, category: 'connected_speech', subtype: 'coalescent_tj', confidence: 'medium' }
  },
  {
    id: 'cant-you',
    text: "can't you",
    leftWord: "can't",
    rightWord: 'you',
    expected: { blocked: false, category: 'connected_speech', subtype: 'coalescent_tj', confidence: 'medium' }
  },
  {
    id: 'this-year',
    text: 'this year',
    leftWord: 'this',
    rightWord: 'year',
    expected: { blocked: false, category: 'connected_speech', subtype: 'coalescent_sj', confidence: 'medium' }
  },
  {
    id: 'as-you',
    text: 'as you',
    leftWord: 'as',
    rightWord: 'you',
    expected: { blocked: false, category: 'connected_speech', subtype: 'coalescent_zj', confidence: 'medium' }
  },
  {
    id: 'miss-you',
    text: 'miss you',
    leftWord: 'miss',
    rightWord: 'you',
    expected: { blocked: false, category: 'connected_speech', subtype: 'coalescent_sj', confidence: 'medium' }
  }
];

const PHASE3_BLOCKED_CASES = [
  {
    id: 'did-comma-you',
    text: 'did, you',
    leftWord: 'did',
    rightWord: 'you',
    expected: { blocked: true, blockedReason: 'hard_boundary' }
  },
  {
    id: 'go-you',
    text: 'go you',
    leftWord: 'go',
    rightWord: 'you',
    expected: { blocked: true, blockedReason: 'low_confidence' }
  },
  {
    id: 'blue-year',
    text: 'blue year',
    leftWord: 'blue',
    rightWord: 'year',
    expected: { blocked: true, blockedReason: 'semivowel_onset' }
  },
  {
    id: 'far-away',
    text: 'far away',
    leftWord: 'far',
    rightWord: 'away',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'catenation', confidence: 'medium' }
  },
  {
    id: 'ten-boys',
    text: 'ten boys',
    leftWord: 'ten',
    rightWord: 'boys',
    expected: { blocked: true, blockedReason: 'low_confidence' }
  }
];

const DEFERRED_CONNECTED_SPEECH_CASES = [
  {
    id: 'far-away',
    text: 'far away',
    leftWord: 'far',
    rightWord: 'away',
    expected: { blocked: true, blockedReason: 'low_confidence', phase: 'phase2' }
  },
  {
    id: 'did-you',
    text: 'did you',
    leftWord: 'did',
    rightWord: 'you',
    expected: { blocked: true, blockedReason: 'semivowel_onset', phase: 'phase2' }
  },
  {
    id: 'would-you',
    text: 'would you',
    leftWord: 'would',
    rightWord: 'you',
    expected: { blocked: true, blockedReason: 'semivowel_onset', phase: 'phase2' }
  },
  {
    id: 'next-please',
    text: 'next please',
    leftWord: 'next',
    rightWord: 'please',
    expected: { blocked: true, blockedReason: 'low_confidence', phase: 'phase2' }
  },
  {
    id: 'cup-of-tea',
    text: 'cup of tea',
    leftWord: 'cup',
    rightWord: 'of',
    expected: { blocked: false, category: 'consonant_to_vowel', subtype: 'catenation', confidence: 'medium', phase: 'phase2' }
  }
];

module.exports = {
  PHASE1_LINKING_CASES,
  PHASE1_BLOCKED_CASES,
  PHASE2_REDUCED_WORD_CASES,
  PHASE3_SOUND_CHANGE_CASES,
  PHASE3_BLOCKED_CASES,
  DEFERRED_CONNECTED_SPEECH_CASES
};
