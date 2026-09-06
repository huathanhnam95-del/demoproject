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

verbs = [
    'take', 'make', 'have', 'give', 'bear', 'hold', 'cast', 'draw', 'run', 'set',
    'put', 'bring', 'lead', 'raise', 'address', 'adopt', 'apply', 'formulate',
    'yield', 'strike', 'achieve', 'acquire', 'accept', 'allow', 'carry', 'change',
    'create', 'develop', 'establish', 'expand', 'extend', 'find', 'follow', 'gain',
    'generate', 'identify', 'implement', 'improve', 'increase', 'indicate', 'introduce',
    'maintain', 'obtain', 'play', 'present', 'produce', 'promote', 'provide', 'reach',
    'receive', 'reduce', 'remain', 'require', 'seek', 'show', 'suggest', 'support'
]

print("Checking verb-based collocations:")
for term in sorted(all_collocs):
    w1 = term.split()[0]
    if w1 in verbs:
        print(f"  {term:32} -> {combined.get(term, 'MISSING')}")
