import requests
import json
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def debug_thorough():
    url = "https://localhost:8081/dictionary/goods"
    try:
        r = requests.get(url, verify=False)
        data = r.json()
        alts = data.get('alternatives', [])
        print(f"Total Alternatives: {len(alts)}")
        for i, alt in enumerate(alts):
            pos = str(alt.get('partOfSpeech')).lower().strip()
            ipa = str(alt.get('pronunciation') or "").lower().strip()
            word = str(alt.get('word')).lower().strip()
            key = f"{pos}:{ipa or word}"
            print(f"Alt {i}: POS='{alt.get('partOfSpeech')}', IPA='{alt.get('pronunciation')}', KEY='{key}'")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    debug_thorough()
