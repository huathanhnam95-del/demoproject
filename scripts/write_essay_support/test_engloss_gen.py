"""
Prototype generator for 832 English glosses.
Generates concise, non-boilerplate academic explanations.
"""
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('scripts/write_essay_support/all_832_collocations.json', 'r', encoding='utf-8') as f:
    terms = json.load(f)

print(f"Total terms to define: {len(terms)}")
