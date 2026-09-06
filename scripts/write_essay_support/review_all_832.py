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

with open('scripts/write_essay_support/all_832_draft_vi.json', 'w', encoding='utf-8') as f:
    json.dump({t: combined.get(t, '') for t in sorted(all_collocs)}, f, ensure_ascii=False, indent=2)

print(f"Dumped {len(all_collocs)} draft translations to all_832_draft_vi.json")
