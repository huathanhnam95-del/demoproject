import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('scripts/write_essay_support/all_832_collocations.json', 'r', encoding='utf-8') as f:
    all_collocs = json.load(f)

with open('scripts/write_essay_support/academic_collocation_glossary.json', 'r', encoding='utf-8') as f:
    existing = json.load(f)

with open('scripts/write_essay_support/raw_translated_375.json', 'r', encoding='utf-8') as f:
    raw375 = json.load(f)

combined = {}
for k, v in existing.items():
    combined[k] = v.get('viGloss', '')
for k, v in raw375.items():
    combined[k] = v

polysemous_words = [
    'body', 'arm', 'party', 'plant', 'exercise', 'address', 'conduct', 'draw',
    'pose', 'cast', 'field', 'room', 'force', 'subject', 'matter', 'right',
    'interest', 'treat', 'hold', 'bear', 'yield', 'press', 'strike', 'sound',
    'soundly', 'board', 'court', 'case', 'figure', 'measure', 'account', 'charge',
    'spring', 'mean', 'means', 'current', 'state', 'term', 'terms', 'fair', 'light'
]

print("Checking polysemous collocations:")
for term in sorted(all_collocs):
    words = term.split()
    matched = [w for w in words if w in polysemous_words]
    if matched:
        print(f"  {term:30} -> {combined.get(term, 'MISSING')} (word: {matched})")
