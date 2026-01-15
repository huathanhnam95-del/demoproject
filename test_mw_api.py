import requests
import json

word = "anonymous"
key = "e25675ce-96d8-4949-a7bc-26825dedeb6e"
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
