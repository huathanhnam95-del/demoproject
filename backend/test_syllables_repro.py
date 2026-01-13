
import re

def parse_syllables(hw):
    """Parse syllables from 'hw' field: 'pho·to·graph' -> ['pho', 'to', 'graph']"""
    if not hw:
        return []
    cleaned = hw.lstrip('*')
    return [s for s in cleaned.split('*') if s] if '*' in cleaned else [s for s in cleaned.split('·') if s]

def count_ipa_vowels(pronunciation):
    vowel_regex = r'(aɪ|eɪ|ɔɪ|aʊ|oʊ|ɪə|eə|ʊə|iː|uː|ɑː|ɔː|ɜː|eːɪ|[ɪieɛæəʌɑɒɔouʊaɚɝ])'
    matches = re.findall(vowel_regex, pronunciation)
    return len(matches), matches

def test():
    cases = [
        ("im*ag*ine", "Collegiate Style"),
        ("im·ag·ine", "Learners Style"),
        ("im-ag-ine", "Hyphenated"),
        ("im.ag.ine", "Dot separated"),
        ("imagine", "No separators")
    ]

    print(f"{'Input':<15} | {'Parsed':<20} | {'Count':<5} | {'Type'}")
    print("-" * 60)
    for hw, label in cases:
        parsed = parse_syllables(hw)
        print(f"{hw:<15} | {str(parsed):<20} | {len(parsed):<5} | {label}")

    print("\n--- IPA Check ---")
    ipa = "ɪˈmædʒən"
    count, matches = count_ipa_vowels(ipa)
    print(f"IPA: {ipa}")
    print(f"Vowels found: {count} {matches}")

if __name__ == "__main__":
    test()
