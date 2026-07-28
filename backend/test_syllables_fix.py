#!/usr/bin/env python3
"""
Test script to verify the IPA syllable counting logic.
Run: python test_syllables_fix.py
"""
import re
import unicodedata
import requests

import os
from dotenv import load_dotenv
load_dotenv()
MW_API_KEY = os.environ.get("MW_API_KEY")

def count_ipa_syllables(ipa):
    """
    Count syllables by counting vowel sounds in IPA or MW notation.
    """
    if not ipa:
        return 0, []
    
    # Normalize Unicode
    ipa_normalized = unicodedata.normalize('NFC', ipa)
    ipa_normalized = ipa_normalized.replace(':', 'ː').replace('ɡ', 'g').replace("'", "ˈ")
    
    # Remove stress markers and separators
    ipa_clean = re.sub(r'[ˈˌ\'\"\.·\-\s\\/()]', '', ipa_normalized)
    
    # Vowel patterns - longer first
    vowel_patterns = [
        'aɪ', 'eɪ', 'ɔɪ', 'aʊ', 'oʊ', 'əʊ',
        'ɪə', 'eə', 'ʊə', 'ɛə', 'ɔə',
        'aɪə', 'aʊə',
        'iː', 'uː', 'ɑː', 'ɔː', 'ɜː', 'eː', 'oː', 'æː', 'aː', 'ɛː', 'œː',
        'äː', 'ëː', 'ïː', 'öː', 'üː',
    ]
    
    # Standard vowels only (no consonants!)
    # ɚ and ɝ are syllabic rhotics (count as syllable nuclei)
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
                # Skip trailing length marks only
                while i < len(ipa_clean) and ipa_clean[i] == 'ː':
                    i += 1
                found = True
                break
        
        if not found:
            # Single vowel only
            if ipa_clean[i] in short_vowels:
                count += 1
                matched.append(ipa_clean[i])
            i += 1
    
    return count, matched

def run_word_test(word):
    """Test a word against MW API and count syllables."""
    print(f"\n{'='*60}")
    print(f"Testing: {word}")
    
    # Try Learner's dictionary (works with this key)
    url = f"https://www.dictionaryapi.com/api/v3/references/learners/json/{word}?key={MW_API_KEY}"
    
    try:
        resp = requests.get(url, timeout=10)
        data = resp.json()
        
        if not data or not isinstance(data[0], dict):
            print(f"No entry found for {word}")
            return
            
        entry = data[0]
        hwi = entry.get('hwi', {})
        hw = hwi.get('hw', '')
        prs = hwi.get('prs', [{}])
        
        pron_string = prs[0].get('ipa', prs[0].get('mw', '')) if prs else ''
        
        print(f"Headword: {hw}")
        print(f"Pronunciation: /{pron_string}/")
        
        # Count from headword dots
        hw_parts = hw.split('·') if '·' in hw else [hw]
        hw_count = len(hw_parts)
        
        # Count from pronunciation
        ipa_count, vowels = count_ipa_syllables(pron_string)
        
        print(f"\nHeadword syllables: {hw_parts} → {hw_count}")
        print(f"IPA vowels found: {vowels} → {ipa_count}")
        
        if ipa_count != hw_count:
            print(f"⚠️  MISMATCH: HW={hw_count}, IPA={ipa_count}")
            print(f"✅ Using IPA count: {ipa_count}")
        else:
            print(f"✓ Counts match: {ipa_count}")
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    # Test the problematic word
    run_word_test("anonymous")
    
    # Test a few more for validation
    run_word_test("economy")
    run_word_test("pronunciation") 
    run_word_test("comfortable")
