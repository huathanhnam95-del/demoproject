import requests
import json
import os
from dotenv import load_dotenv

load_dotenv()
MW_API_KEY = os.getenv('MW_API_KEY')

def fetch_mw(word):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    
    data = None
    for ref in ['collegiate', 'learners', 'sd4']:
        url = f'https://www.dictionaryapi.com/api/v3/references/{ref}/json/{word}?key={MW_API_KEY}'
        print(f"Trying {ref}...")
        response = requests.get(url, headers=headers)
        
        if response.status_code == 200:
            if "Not subscribed for this reference" in response.text:
                continue
            try:
                data = response.json()
                if isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
                    print(f"Success with {ref}!")
                    break
            except:
                continue
    
    if not data:
        print("Failed to fetch data from any reference.")
        return
        
    print(f"Total entries for {word}: {len(data)}")
    
    for i, entry in enumerate(data):
        if not isinstance(entry, dict):
            continue
        
        meta = entry.get('meta', {})
        entry_id = meta.get('id', 'N/A')
        fl = entry.get('fl', 'N/A')
        
        print(f"\n--- Entry {i}: {entry_id} ({fl}) ---")
        
        hwi = entry.get('hwi', {})
        prs = hwi.get('prs', [])
        
        for j, pr in enumerate(prs):
            ipa = pr.get('ipa', 'N/A')
            mw = pr.get('mw', 'N/A')
            sound = pr.get('sound', {}).get('audio', 'N/A')
            label = pr.get('l', 'N/A') # Sometimes there's a label like "strong", "weak"
            pun = pr.get('pun', 'N/A') # Sometimes punctuation
            
            print(f"  Pronunciation {j}: IPA: {ipa}, MW: {mw}, Audio: {sound}, Label: {label}, Pun: {pun}")
            
        # Also check for 'vrs' (variants) or other locations for pronunciations
        vrs = entry.get('vrs', [])
        for v in vrs:
            v_prs = v.get('vls', []) # Actually vrs often has its own hwi/prs structure
            # MW Collegiate structure is complex
            pass

if __name__ == "__main__":
    fetch_mw("can")
