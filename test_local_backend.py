import requests
import json
import re

test_words = [
    "photograph", "consecutive", "beautiful", "information", "education",
    "advertisement", "communication", "application", "pronunciation", "international"
]

print("Testing local backend stress detection...")
print("-" * 90)
print(f"{'Word':20} | {'IPA':30} | {'Backend':8} | {'Expected':8} | Match")
print("-" * 90)

results = []
for word in test_words:
    try:
        resp = requests.get(f"http://localhost:8080/dictionary/{word}", timeout=15)
        data = resp.json()
        
        if not data.get("found"):
            print(f"{word:20} | NOT FOUND")
            continue
            
        word_data = data.get("data", {})
        ipa = word_data.get("pronunciation", "N/A")
        stress = word_data.get("stressedSyllable", "N/A")
        syllables = word_data.get("syllableCount", "N/A")
        
        # Calculate expected stress from IPA by counting vowels before ˈ
        if ipa and 'ˈ' in ipa:
            stress_pos = ipa.find('ˈ')
            before_stress = ipa[:stress_pos]
            vowel_regex = r'(aɪ|eɪ|ɔɪ|aʊ|oʊ|ɪə|eə|ʊə|iː|uː|ɑː|ɔː|ɜː|eːɪ|[ɪieɛæəʌɑɒɔouʊaɚɝ])'
            matches = re.findall(vowel_regex, before_stress)
            expected_stress = len(matches)
        else:
            expected_stress = 0
        
        match = "✅" if stress == expected_stress else "❌"
        
        results.append({
            "word": word,
            "ipa": ipa,
            "backend_stress": stress,
            "expected_stress": expected_stress,
            "match": match
        })
        
        print(f"{word:20} | {ipa[:30]:30} | {stress:8} | {expected_stress:8} | {match}")
        
    except Exception as e:
        print(f"{word:20} | ERROR: {e}")
        results.append({"word": word, "error": str(e)})

print("-" * 90)
matches = sum(1 for r in results if r.get("match") == "✅")
total = len([r for r in results if "match" in r])
print(f"Results: {matches}/{total} matched ({100*matches/total if total > 0 else 0:.0f}%)")
