#!/usr/bin/env python3
"""Minimal test for anonymous syllable count."""
import re
import unicodedata
import requests

MW_API_KEY = "e25675ce-96d8-4949-a7bc-26825dedeb6e"

def count_ipa_syllables(ipa):
    if not ipa:
        return 0, []
    
    ipa_normalized = unicodedata.normalize('NFC', ipa)
    ipa_normalized = ipa_normalized.replace(':', 'ː').replace('ɡ', 'g').replace("'", "ˈ")
    ipa_clean = re.sub(r'[ˈˌ\'\"\.·\-\s\\/()]', '', ipa_normalized)
    
    vowel_patterns = [
        'aɪ', 'eɪ', 'ɔɪ', 'aʊ', 'oʊ', 'əʊ',
        'ɪə', 'eə', 'ʊə', 'ɛə', 'ɔə',
        'aɪə', 'aʊə',
        'iː', 'uː', 'ɑː', 'ɔː', 'ɜː', 'eː', 'oː', 'æː', 'aː', 'ɛː', 'œː',
        'äː', 'ëː', 'ïː', 'öː', 'üː',
    ]
    
    short_vowels = 'ɪieɛæəɐʌɑɒɔouʊaɚɝɨʉɤøœyɯɵʏäëïöü'
    
    count = 0
    i = 0
    matched = []
    
    while i < len(ipa_clean):
        found = False
        for pattern in vowel_patterns:
            if ipa_clean[i:].startswith(pattern):
                count += 1
                matched.append(pattern)
                i += len(pattern)
                while i < len(ipa_clean) and ipa_clean[i] == 'ː':
                    i += 1
                found = True
                break
        
        if not found:
            if ipa_clean[i] in short_vowels:
                count += 1
                matched.append(ipa_clean[i])
            i += 1
    
    return count, matched

# Test with MW Learner's dictionary
url = f"https://www.dictionaryapi.com/api/v3/references/learners/json/anonymous?key={MW_API_KEY}"
resp = requests.get(url, timeout=10)
data = resp.json()

entry = data[0]
hwi = entry.get('hwi', {})
prs = hwi.get('prs', [])
ipa = prs[0].get('ipa', '') if prs else ''
mw = prs[0].get('mw', '') if prs else ''
pron = ipa or mw

print(f"IPA: {ipa}")
print(f"MW:  {mw}")
print(f"Using: {pron}")

count, vowels = count_ipa_syllables(pron)
print(f"Vowels found: {vowels}")
print(f"Syllable count: {count}")

if count == 4:
    print("SUCCESS: anonymous = 4 syllables")
else:
    print(f"FAIL: Expected 4, got {count}")
