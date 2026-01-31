import requests
import json

def test_dictionary_api(word):
    # Using the local backend on port 8081 (standard for this project)
    url = f"https://localhost:8081/dictionary/{word}"
    print(f"Testing {word} via {url}...")
    
    try:
        response = requests.get(url, verify=False)
        if not response.ok:
            print(f"Error: {response.status_code}")
            print(response.text)
            return
            
        data = response.json()
        if not data.get('found'):
            print(f"Word '{word}' not found.")
            return
            
        alternatives = data.get('alternatives', [])
        print(f"Found {len(alternatives)} alternatives for '{word}':")
        
        for i, alt in enumerate(alternatives):
            pos = alt.get('partOfSpeech', 'N/A')
            label = alt.get('label', '')
            ipa = alt.get('pronunciation', 'N/A')
            audio = alt.get('audioUrl', 'N/A')
            inherited = " (inherited)" if alt.get('inheritedAudio') else ""
            
            label_str = f" [{label}]" if label else ""
            print(f"  {i}: {pos}{label_str} /{ipa}/ Audio: {audio}{inherited}")

    except Exception as e:
        print(f"Connection error: {e}")

if __name__ == "__main__":
    import sys
    word = sys.argv[1] if len(sys.argv) > 1 else "can"
    test_dictionary_api(word)
