import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('scripts/write_essay_support/academic_collocation_glossary.json', 'r', encoding='utf-8') as f:
    g = json.load(f)

print(f"Total entries: {len(g)}")
for i, (k, v) in enumerate(list(g.items())[:30]):
    print(f"{k:30} -> vi: {v.get('viGloss')} | en: {v.get('enGloss')}")
