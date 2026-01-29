import requests
import json

def debug_http():
    url = "http://localhost:8081/dictionary/goods"
    try:
        r = requests.get(url, timeout=5)
        print(f"Status: {r.status_code}")
        data = r.json()
        alts = data.get('alternatives', [])
        print(f"Count: {len(alts)}")
        for i, alt in enumerate(alts):
            print(f"Alt {i}: {alt.get('partOfSpeech')}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    debug_http()
