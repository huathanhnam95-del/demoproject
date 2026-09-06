import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('scripts/write_essay_support/all_832_collocations.json', 'r', encoding='utf-8') as f:
    all_collocs = json.load(f)

with open('scripts/write_essay_support/academic_collocation_glossary.json', 'r', encoding='utf-8') as f:
    existing = json.load(f)

print(f"Total collocations: {len(all_collocs)}")
print(f"Existing in glossary: {len(existing)}")

missing = [c for c in all_collocs if c not in existing]
print(f"Missing: {len(missing)}")

# Check what kind of terms are missing
print("\nSample 40 missing:")
for c in missing[:40]:
    print(" ", c)
