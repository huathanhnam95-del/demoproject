import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('scripts/write_essay_support/raw_translated_375.json', 'r', encoding='utf-8') as f:
    trans = json.load(f)

for k, v in sorted(trans.items()):
    print(f"{k:32} -> {v}")
