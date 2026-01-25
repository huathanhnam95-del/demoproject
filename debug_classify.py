
from classify_v2 import classify_sentence

def test_cases():
    test_data = [
        # 1. Passive voice with adverbs
        ("The study was successfully conducted.", 2, "passive with adverb"),
        ("New rules are often followed in politics.", 2, "passive with adverb"),
        
        # 2. Perfect aspect with adverbs / negatives
        ("Researchers have recently revealed new data.", 2, "perfect with adverb"),
        ("They have not received the package yet.", 2, "perfect with negative"),
        
        # 3. Proper nouns after punctuation (if any in dataset, though rare in dictation)
        ("I saw Mr. Brice in London. London is big.", 1, "proper nouns should be excluded"),
        
        # 4. Level 3 validation (needs lex + grammar or high grammar)
        ("Although the results were inconclusive, the team decided to proceed with the project.", 3, "level 3 check"),
        
        # 5. Modal perfect with adverbs
        ("He should have definitely contacted the office.", 3, "modal perfect with adverb"),
    ]
    
    print(f"{'Status':<10} | {'Sentence':<60} | {'Expected':<10} | {'Got':<10} | {'Reason'}")
    print("-" * 120)
    
    all_passed = True
    for sentence, expected, note in test_data:
        res = classify_sentence(sentence)
        status = "PASSED" if res['level'] >= expected else "FAILED" # Using >= because some might be harder than I think
        if res['level'] < expected:
            all_passed = False
            
        print(f"{status:<10} | {sentence[:60]:<60} | {expected:<10} | {res['level']:<10} | {res['reasons'][:50]}")
        
    return all_passed

if __name__ == "__main__":
    test_cases()
