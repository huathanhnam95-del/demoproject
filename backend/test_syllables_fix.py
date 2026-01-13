
import re

def parse_syllables(hw):
    """Parse syllables from 'hw' field: 'pho·to·graph' -> ['pho', 'to', 'graph']"""
    if not hw:
        return []
    cleaned = hw.lstrip('*')
    
    # Try multiple common separators
    if '*' in cleaned:
        return [s for s in cleaned.split('*') if s]
    if '·' in cleaned:
        return [s for s in cleaned.split('·') if s]
    if '-' in cleaned:
        return [s for s in cleaned.split('-') if s]
    if '.' in cleaned:
        return [s for s in cleaned.split('.') if s]
        
    return [cleaned]

def count_ipa_syllables(ipa):
    """Count syllables by counting vowel sounds in IPA."""
    if not ipa:
        return 0
    # Include all IPA vowels and diphthongs
    vowel_regex = r'(aɪ|eɪ|ɔɪ|aʊ|oʊ|ɪə|eə|ʊə|iː|uː|ɑː|ɔː|ɜː|eːɪ|[ɪieɛæəʌɑɒɔouʊaɚɝ])'
    matches = re.findall(vowel_regex, ipa)
    return len(matches), matches

def test():
    cases = [
        ("im*ag*ine", None, "Collegiate Style"),
        ("im·ag·ine", None, "Learners Style"),
        ("im-ag-ine", None, "Hyphenated"),
        ("im.ag.ine", None, "Dot separated"),
        ("imagine", "ɪˈmædʒən", "No separators + IPA")
    ]

    print(f"{'Input HW':<15} | {'Parsed':<20} | {'Count':<5}")
    print("-" * 60)
    for hw, ipa, label in cases:
        parsed = parse_syllables(hw)
        count = len(parsed)
        
        # Simulate logic in parse_mw_response
        if ipa:
            ipa_count, _ = count_ipa_syllables(ipa)
            if ipa_count > count:
                count = ipa_count
                parsed = f"Overridden by IPA ({ipa_count})"
        
        print(f"{hw:<15} | {str(parsed):<20} | {count:<5} | {label}")

if __name__ == "__main__":
    test()
