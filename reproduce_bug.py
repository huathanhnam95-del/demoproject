import re
import unicodedata

def count_ipa_syllables(ipa):
    if not ipa:
        return 0
    
    ipa_normalized = unicodedata.normalize('NFC', ipa)
    ipa_normalized = ipa_normalized.replace(':', 'ː').replace('ɡ', 'g').replace("'", "ˈ")
    ipa_clean = re.sub(r'[ˈˌ\'\"\.·\-\s\\/()]', '', ipa_normalized)
    
    vowel_patterns = [
        'aɪ', 'eɪ', 'ɔɪ', 'aʊ', 'oʊ', 'əʊ',
        'ɪə', 'eə', 'ʊə', 'ɛə', 'ɔə',
        'aɪə', 'aʊə',
        'oɚ', 'ɔɚ', 'aɚ', 'ɪɚ', 'eɚ', 'ʊɚ', 'ɛɚ', 'uɚ',
        'iː', 'uː', 'ɑː', 'ɔː', 'ɜː', 'eː', 'oː', 'æː', 'aː', 'ɛː', 'œː',
        'äː', 'ëː', 'ïː', 'öː', 'üː',
    ]
    
    short_vowels = 'ɪieɛæəɐʌɑɒɔouʊaɚɝɨʉɤøœyɯɵʏäëïöü'
    
    count = 0
    i = 0
    matched_clusters = []
    
    while i < len(ipa_clean):
        matched = False
        for pattern in vowel_patterns:
            if ipa_clean[i:].startswith(pattern):
                count += 1
                matched_clusters.append(pattern)
                i += len(pattern)
                while i < len(ipa_clean) and ipa_clean[i] == 'ː':
                    i += 1
                matched = True
                break
        
        if not matched:
            if ipa_clean[i] in short_vowels:
                count += 1
                matched_clusters.append(ipa_clean[i])
            i += 1
            
    print(f"DEBUG Syllables: '{ipa}' -> clusters: {matched_clusters}, count: {count}")
    return count

# Test cases
test_cases = [
    "ˈfoʊtəˌɡræf",  # photograph
    "ˈfoʊ.tə.ɡræf", # with dots
    "foʊtəɡræf",    # no stress
    "ˈiːvnɪŋ",      # evening
    "ˈæd.və.taɪz.mənt" # advertisement
]

for tc in test_cases:
    count = count_ipa_syllables(tc)
    print(f"Result for '{tc}': {count}")
