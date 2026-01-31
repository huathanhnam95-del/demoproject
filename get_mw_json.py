import requests
import json
import os
from dotenv import load_dotenv

load_dotenv()
MW_API_KEY = os.getenv('MW_API_KEY')

def get_can_json():
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    
    # Try learners as it often has the IPA and structure we are interested in for "can"
    # But checking Collegiate as well since that's the primary source
    
    # Let's fetch the Learners dictionary for "can" as it usually has the clear weak/strong distinction
    url = f'https://www.dictionaryapi.com/api/v3/references/learners/json/can?key={MW_API_KEY}'
    
    print(f"Fetching from: {url}")
    response = requests.get(url, headers=headers)
    
    if response.status_code != 200:
        print(f"Error: {response.status_code}")
        return

    try:
        data = response.json()
        if isinstance(data, list) and len(data) > 0:
            # Print the hwi.prs object for the first few entries
            for i, entry in enumerate(data):
                if not isinstance(entry, dict): continue
                
                meta_id = entry.get('meta', {}).get('id', 'unknown')
                fl = entry.get('fl', 'unknown')
                
                print(f"\n// --- Entry {i}: {meta_id} ({fl}) ---")
                
                if 'hwi' in entry and 'prs' in entry['hwi']:
                    print(json.dumps(entry['hwi']['prs'], indent=2))
                else:
                    print("// No hwi.prs found")
                    
    except Exception as e:
        print(f"JSON Error: {e}")

if __name__ == "__main__":
    get_can_json()
