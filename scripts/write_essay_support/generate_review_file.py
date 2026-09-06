import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open('scripts/write_essay_support/all_832_collocations.json', 'r', encoding='utf-8') as f:
    all_collocs = json.load(f)

with open('scripts/write_essay_support/all_832_draft_vi.json', 'r', encoding='utf-8') as f:
    draft = json.load(f)

with open('scripts/write_essay_support/all_832_review.txt', 'w', encoding='utf-8') as f:
    for i, t in enumerate(sorted(all_collocs)):
        f.write(f"{i+1:3}. {t:35} | vi: {draft.get(t, '')}\n")

print("Wrote review file with 832 items.")
