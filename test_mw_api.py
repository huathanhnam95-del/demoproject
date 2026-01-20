import requests
import json

word = "anonymous"
import os
from dotenv import load_dotenv
load_dotenv()
key = os.environ.get("MW_API_KEY")
url = f"https://www.dictionaryapi.com/api/v3/references/learners/json/{word}?key={key}"

print(f"Testing URL: {url}")
resp = requests.get(url)
print(f"Status: {resp.status_code}")
print(f"Headers: {resp.headers.get('Content-Type')}")
print(f"Text preview: {resp.text[:200]}")

try:
    data = resp.json()
    print("JSON Parse: SUCCESS")
    print(f"First entry ID: {data[0].get('meta', {}).get('id')}")
except Exception as e:
    print(f"JSON Parse: FAILED - {str(e)}")
