import requests
import json

# Test a single word and see the full response
word = "consecutive"
resp = requests.get(f"http://localhost:8080/dictionary/{word}", timeout=15)
print(f"Status: {resp.status_code}")
print(f"Response:\n{json.dumps(resp.json(), indent=2)}")
