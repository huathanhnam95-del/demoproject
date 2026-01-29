import requests
import urllib3
import json

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def debug_port(url, name):
    print(f"\n--- Checking {name} ({url}) ---")
    try:
        r = requests.get(url, verify=False, timeout=2)
        print(f"Success! Status: {r.status_code}")
        data = r.json()
        alts = data.get('alternatives', [])
        print(f"Number of alternatives: {len(alts)}")
        if alts:
            print(f"First Alt POS: {alts[0].get('partOfSpeech')}")
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    debug_port("https://localhost:8081/dictionary/goods", "HTTPS on 8081")
    debug_port("http://localhost:8081/dictionary/goods", "HTTP on 8081")
