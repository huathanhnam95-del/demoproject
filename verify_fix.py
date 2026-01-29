import requests
import json

def test_inheritance():
    word = "photograph"
    url = f"https://localhost:8081/dictionary/{word}"
    
    try:
        print(f"Fetching data for '{word}' from {url}...")
        resp = requests.get(url, timeout=10, verify=False)
        data = resp.json()
        
        if not data.get("found"):
            print("FAILED: Word not found")
            return
            
        primary = data.get("data", {})
        alternatives = data.get("alternatives", [])
        
        print(f"\nPrimary Form ({primary.get('partOfSpeech')}):")
        print(f"  IPA: {primary.get('pronunciation')}")
        print(f"  Syllables: {primary.get('syllableCount')}")
        print(f"  Stress: {primary.get('stressedSyllable')}")
        
        # Look for Verb form
        verb_form = next((alt for alt in alternatives if alt.get("partOfSpeech") == "verb"), None)
        
        if verb_form:
            print(f"\nVerb Form:")
            print(f"  IPA: {verb_form.get('pronunciation')}")
            print(f"  Syllables: {verb_form.get('syllableCount')}")
            print(f"  Stress: {verb_form.get('stressedSyllable')}")
            print(f"  Inherited: {verb_form.get('inheritedPronunciation', False)}")
            
            # Check syllables and stress
            if verb_form.get("syllableCount") == 3 and verb_form.get("stressedSyllable") == 0:
                print("\n✅ VERIFICATION PASSED: Verb inherited correct syllable count and stress.")
            else:
                print(f"\n❌ VERIFICATION FAILED: Expected 3 syllables and stress 0, got {verb_form.get('syllableCount')} and {verb_form.get('stressedSyllable')}.")
        else:
            print("\n⚠️ Verb form not found in alternatives")
            
    except requests.exceptions.ConnectionError:
        print("FAILED: Could not connect to backend. Is server.py running?")
    except Exception as e:
        print(f"FAILED: An error occurred: {e}")

if __name__ == "__main__":
    test_inheritance()
