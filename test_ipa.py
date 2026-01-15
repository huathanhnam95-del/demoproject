import re
import unicodedata
import sys
import io

# Set encoding for stdout to handle IPA characters
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def count_ipa_syllables_test(ipa):
    """Test version with detailed logging."""
    print(f"\n{'='*60}")
    print(f"INPUT: '{ipa}'")
    
    # 1. Normalize Unicode (some sources use different representations)
    ipa_norm = unicodedata.normalize('NFC', ipa)
    
    # Also handle regular colon as length mark and standard 'g'
    ipa_norm = ipa_norm.replace(':', 'ː').replace('ɡ', 'g').replace("'", "ˈ")
    
    # Remove stress markers and syllable separators for counting
    ipa_clean = ipa_norm.replace('ˈ', '').replace('ˌ', '').replace('.', '').replace('-', '')
    print(f"CLEANED: '{ipa_clean}'")
    
    # IPA vowel nuclei patterns - order matters! Longer sequences first
    vowel_patterns = [
        # Diphthongs
        'aɪ', 'eɪ', 'ɔɪ', 'aʊ', 'oʊ', 'əʊ',
        'ɪə', 'eə', 'ʊə', 'ɛə', 'ɔə',
        # Long vowels
        'iː', 'uː', 'ɑː', 'ɔː', 'ɜː', 'eː', 'oː', 'æː', 'aː', 'ɛː', 'œː',
        # MW Long vowels
        'äː', 'ëː', 'ïː', 'öː', 'üː',
    ]
    
    short_vowels = 'ɪieɛæəɐʌɑɒɔouʊaɚɝɨʉɤøœyɯɵʏæäëïöüAEIOUaeiou'
    syllabic_consonants = 'l̩n̩m̩ŋ̩'
    
    count = 0
    i = 0
    matched_clusters = []
    
    while i < len(ipa_clean):
        matched = False
        
        # Try multi-character patterns first
        for pattern in vowel_patterns:
            if ipa_clean[i:].startswith(pattern):
                count += 1
                matched_clusters.append(pattern)
                i += len(pattern)
                # Check for trailing glides or length marks
                while i < len(ipa_clean) and ipa_clean[i] in 'ːjwi':
                     i += 1
                matched = True
                break
        
        if not matched:
            # Check single vowel
            if ipa_clean[i] in short_vowels or ipa_clean[i] in syllabic_consonants:
                count += 1
                matched_clusters.append(ipa_clean[i])
            i += 1
            
    print(f"MATCHES: {matched_clusters}")
    print(f"COUNT: {count}")
    print(f"{'='*60}\n")
    
    return count

# Test with various possible inputs for "anonymous"
test_cases = [
    "əˈnɑːnəməs",      # Proper IPA
    "ə'nɑːnəməs",      # MW IPA variant
    "ə-ˈnä-nə-məs",    # MW style
    "əˈnanəməs",       # Shortened
    "\\əˈnɑːnəməs\\"   # With slashes
]

for test in test_cases:
    count_ipa_syllables_test(test)
