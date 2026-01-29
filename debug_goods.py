import requests
import json
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def debug_goods():
    url = "https://localhost:8081/dictionary/goods"
    try:
        r = requests.get(url, verify=False)
        data = r.json()
        print(f"Found: {data.get('found')}")
        alts = data.get('alternatives', [])
        print(f"Number of alternatives: {len(alts)}")
        for i, alt in enumerate(alts):
            print(f"Alt {i}: {alt.get('partOfSpeech')} - IPA: {alt.get('pronunciation')} - Inherited: {alt.get('inheritedPronunciation')}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    debug_goods()
