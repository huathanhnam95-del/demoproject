import requests
import json

# Test against Cloud Run
words = ["international", "consecutive", "communication", "pronunciation", "advertisement"]
base_url = "https://parselmouth-backend-1071929245506.us-central1.run.app"

print(f"Testing Cloud Run: {base_url}")
print("-" * 70)

for word in words:
    resp = requests.get(f"{base_url}/dictionary/{word}", timeout=15)
    data = resp.json()
    
    if data.get("found"):
        d = data["data"]
        ipa = d.get("pronunciation", "N/A")
        stress = d.get("stressedSyllable", "N/A")
        syllables = d.get("syllableCount", "N/A")
        print(f"{word:20} | IPA: {ipa:25} | Stress: {stress} (syllable {stress + 1 if isinstance(stress, int) else 'N/A'})")
    else:
        print(f"{word:20} | NOT FOUND")
