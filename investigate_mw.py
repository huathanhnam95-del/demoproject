import requests
import json

def check_word(word):
    print(f"\n=== Checking Word: {word} ===")
    try:
        url = f"https://localhost:8081/dictionary/{word}"
        response = requests.get(url, verify=False)
        if response.ok:
            data = response.json()
            print(f"Found: {data.get('found')}")
            if data.get('found'):
                alts = data.get('alternatives', [])
                print(f"Number of Alternatives: {len(alts)}")
                for i, alt in enumerate(alts):
                    print(f"\nAlt {i+1}:")
                    print(f"  POS: {alt.get('partOfSpeech')}")
                    print(f"  Pronunciation: {alt.get('pronunciation')}")
                    print(f"  Audio: {'Yes' if alt.get('audioUrl') else 'No'}")
                    definition = alt.get('definition') or "No definition"
                    print(f"  Def: {definition[:50]}...")
            else:
                print(f"Suggestions: {data.get('suggestions')}")
        else:
            print(f"Error: {response.status_code}")
    except Exception as e:
        print(f"Exception: {e}")

if __name__ == "__main__":
    check_word("imperfect")
    check_word("record")
