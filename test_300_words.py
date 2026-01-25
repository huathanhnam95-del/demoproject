import requests
import json
import re
import time

# 300 common English words with multiple syllables
test_words = [
    # Original 10
    "photograph", "consecutive", "beautiful", "information", "education",
    "advertisement", "communication", "application", "pronunciation", "international",
    # Batch 2 (10 more)
    "organization", "opportunity", "responsibility", "university", "technology",
    "development", "relationship", "environment", "experience", "professional",
    # Batch 3 (10 more)
    "administration", "particularly", "immediately", "unfortunately", "independently",
    "competition", "conversation", "celebration", "introduction", "investigation",
    # Batch 4 (10 more)
    "imagination", "determination", "accommodation", "consideration", "discrimination",
    "recommendation", "representation", "identification", "communication", "organization",
    # Batch 5 (10 more)
    "ability", "activity", "authority", "community", "electricity",
    "facility", "majority", "minority", "possibility", "probability",
    # Batch 6 (10 more)
    "beautiful", "wonderful", "comfortable", "reasonable", "responsible",
    "available", "incredible", "impossible", "inevitable", "unforgettable",
    # Batch 7 (10 more)
    "absolutely", "completely", "definitely", "extremely", "particularly",
    "specifically", "apparently", "consequently", "subsequently", "ultimately",
    # Batch 8 (10 more)
    "economic", "automatic", "democratic", "diplomatic", "enthusiastic",
    "fantastic", "optimistic", "pessimistic", "realistic", "romantic",
    # Batch 9 (10 more)
    "elementary", "extraordinary", "contemporary", "documentary", "revolutionary",
    "vocabulary", "dictionary", "missionary", "secretary", "anniversary",
    # Batch 10 (10 more)
    "psychology", "technology", "methodology", "terminology", "archaeology",
    "biology", "sociology", "philosophy", "geography", "photography",
    # Batch 11-20 (100 more common words)
    "computer", "important", "different", "government", "understand",
    "remember", "together", "continue", "consider", "important",
    "example", "another", "because", "between", "company",
    "country", "family", "general", "history", "interest",
    "question", "problem", "program", "public", "research",
    "result", "service", "society", "special", "student",
    "system", "teacher", "through", "woman", "answer",
    "become", "believe", "building", "business", "century",
    "change", "children", "community", "complete", "condition",
    "control", "create", "decision", "describe", "determine",
    "develop", "discover", "discuss", "economy", "effect",
    "election", "establish", "evidence", "exactly", "explain",
    "follow", "forward", "freedom", "future", "garden",
    "hospital", "however", "human", "hundred", "husband",
    "include", "indicate", "industry", "instead", "involve",
    "language", "leader", "letter", "level", "library",
    "living", "local", "machine", "magazine", "maintain",
    "manage", "market", "material", "matter", "measure",
    "medical", "meeting", "member", "memory", "mention",
    "message", "method", "middle", "million", "minister",
    # Additional words to reach 200+
    "model", "modern", "moment", "money", "morning",
    "mother", "mountain", "movement", "murder", "museum",
    "nature", "necessary", "network", "never", "number",
    "office", "officer", "often", "operation", "opinion",
    "opportunity", "option", "order", "original", "other",
    "outside", "owner", "paper", "parent", "parliament",
    "particular", "partner", "party", "patient", "pattern",
    "payment", "people", "percent", "performance", "perhaps",
    "period", "person", "picture", "place", "player",
    "please", "police", "policy", "political", "popular",
    "population", "position", "positive", "possible", "power",
    "practice", "prepare", "present", "president", "pressure",
    "previous", "primary", "private", "probably", "problem",
    "process", "produce", "product", "professor", "program",
    "project", "property", "protect", "provide", "purpose",
    "quality", "quarter", "question", "quickly", "radio",
    "rather", "reason", "receive", "recent", "record",
    "reduce", "refer", "region", "regular", "relate"
]

# Remove duplicates while preserving order
seen = set()
unique_words = []
for w in test_words:
    if w.lower() not in seen:
        seen.add(w.lower())
        unique_words.append(w)

test_words = unique_words[:300]  # Limit to 300

print(f"Testing {len(test_words)} words on local backend...")
print("-" * 90)

results: list[dict] = []
mismatches = []

for i, word in enumerate(test_words):
    try:
        resp = requests.get(f"http://localhost:8080/dictionary/{word}", timeout=15)
        data = resp.json()
        
        if not data.get("found"):
            results.append({"word": word, "status": "NOT_FOUND"})
            continue
            
        word_data = data.get("data", {})
        ipa = word_data.get("pronunciation", "")
        stress = word_data.get("stressedSyllable", 0)
        syllables = word_data.get("syllableCount", 0)
        
        # Calculate expected stress from IPA by counting vowels before ˈ
        if ipa and 'ˈ' in ipa:
            stress_pos = ipa.find('ˈ')
            before_stress = ipa[:stress_pos]
            vowel_regex = r'(aɪ|eɪ|ɔɪ|aʊ|oʊ|ɪə|eə|ʊə|iː|uː|ɑː|ɔː|ɜː|eːɪ|[ɪieɛæəʌɑɒɔouʊaɚɝ])'
            matches = re.findall(vowel_regex, before_stress)
            expected_stress = len(matches)
        else:
            expected_stress = 0
        
        match = stress == expected_stress
        
        results.append({
            "word": word,
            "ipa": ipa,
            "backend_stress": stress,
            "expected_stress": expected_stress,
            "match": match
        })
        
        if not match:
            mismatches.append(f"{word}: Backend={stress}, Expected={expected_stress}, IPA={ipa}")
        
        # Progress indicator every 50 words
        if (i + 1) % 50 == 0:
            print(f"Progress: {i + 1}/{len(test_words)} words tested...")
            
    except Exception as e:
        results.append({"word": word, "error": str(e)})

print("-" * 90)

# Calculate statistics
found = [r for r in results if "match" in r]
not_found = [r for r in results if r.get("status") == "NOT_FOUND"]
errors = [r for r in results if "error" in r]
matches = sum(1 for r in found if r.get("match"))

print(f"\n=== RESULTS ===")
print(f"Total Words Tested: {len(test_words)}")
print(f"Words Found: {len(found)}")
print(f"Words Not Found: {len(not_found)}")
print(f"Errors: {len(errors)}")
print(f"Matches: {matches}/{len(found)} ({100*matches/len(found) if found else 0:.1f}%)")

if mismatches:
    print(f"\n=== MISMATCHES ({len(mismatches)}) ===")
    for m in mismatches[:20]:  # Show first 20
        print(f"  {m}")
    if len(mismatches) > 20:
        print(f"  ... and {len(mismatches) - 20} more")
else:
    print("\n✅ ALL WORDS MATCHED!")

# Save results to file
with open("stress_test_results.json", "w") as f:
    json.dump({
        "total": len(test_words),
        "found": len(found),
        "not_found": len(not_found),
        "errors": len(errors),
        "match_rate": 100*matches/len(found) if found else 0,
        "mismatches": mismatches
    }, f, indent=2)
print("\nResults saved to stress_test_results.json")
